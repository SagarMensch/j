from __future__ import annotations

import logging
import time
import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, UploadFile

from app.core.config import Settings
from app.core.model_loader import ModelLoader
from app.schemas.responses import (
    AnalysisHistoryItem,
    AnalysisHistoryResponse,
    AnalysisResponse,
    DeleteAnalysisResponse,
    DuplicateCheck,
    EngineScores,
    OCRAnomaly,
    PageArtifacts,
    PageResult,
    TamperedRegion,
)
from app.services.artifact_service import ArtifactService
from app.services.duplicate_service import DuplicateService
from app.services.engine_service import EngineService
from app.services.ocr_service import OCRService
from app.services.pdf_service import PDFService
from app.services.preprocess_service import PreprocessService
from app.services.segmentation_service import SegmentationService
from app.services.storage_service import StorageService
from app.utils.image_ops import apply_heatmap, rgb_np_to_pil
from app.utils.scoring import forensic_risk_score, verdict_for_score


class ReportService:
    def __init__(
        self,
        settings: Settings,
        model_loader: ModelLoader,
        storage_service: StorageService,
        artifact_service: ArtifactService,
        pdf_service: PDFService,
        preprocess_service: PreprocessService,
        engine_service: EngineService,
        ocr_service: OCRService,
        duplicate_service: DuplicateService,
        segmentation_service: SegmentationService,
    ) -> None:
        self.settings = settings
        self.model_loader = model_loader
        self.storage_service = storage_service
        self.artifact_service = artifact_service
        self.pdf_service = pdf_service
        self.preprocess_service = preprocess_service
        self.engine_service = engine_service
        self.ocr_service = ocr_service
        self.duplicate_service = duplicate_service
        self.segmentation_service = segmentation_service
        self.logger = logging.getLogger(self.__class__.__name__)

    async def analyze_upload(
        self,
        upload_file: UploadFile,
        document_type: str | None = None,
        submitter_id: str | None = None,
    ) -> AnalysisResponse:
        started = time.perf_counter()
        payload = await upload_file.read()
        if not payload:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        analysis_id = str(uuid.uuid4())
        filename = upload_file.filename or "upload.bin"
        upload_path = self.storage_service.save_upload(analysis_id, filename, payload)

        try:
            rendered_pages = self.pdf_service.render_document(upload_path)
        except ValueError as exc:
            if upload_path.exists():
                upload_path.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            if upload_path.exists():
                upload_path.unlink(missing_ok=True)
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        self.logger.info(
            "Document rendered",
            extra={"analysis_id": analysis_id, "page_count": len(rendered_pages)},
        )

        duplicate_result = self.duplicate_service.check_document(
            payload=payload,
            pages=[page.image for page in rendered_pages],
        )
        ocr_result = self.ocr_service.analyze_document([page.image for page in rendered_pages])

        page_scores = {
            "ela": [],
            "srm": [],
            "noiseprint": [],
            "dino": [],
            "segmentation": [],
        }
        page_results: list[PageResult] = []
        warnings = self._dedupe_warnings(duplicate_result.warnings + ocr_result.warnings)

        for rendered_page in rendered_pages:
            page_index = rendered_page.page_index
            features = self.preprocess_service.extract_cpu_features(rendered_page.image)

            original_filename = f"page_{page_index}_original.png"
            inference_filename = f"page_{page_index}_inference.png"
            self.artifact_service.save_image(
                analysis_id,
                original_filename,
                rgb_np_to_pil(features.original_rgb),
            )
            self.artifact_service.save_image(
                analysis_id,
                inference_filename,
                rgb_np_to_pil(features.inference_rgb),
            )

            page_engines = self.engine_service.analyze_page(
                features=features,
                analysis_id=analysis_id,
                page_index=page_index,
                artifact_service=self.artifact_service,
            )

            segmentation_tensor = self.preprocess_service.build_segmentation_tensor(
                features=features,
                srm_map=page_engines.srm_map,
                noiseprint_map=page_engines.noiseprint_map,
                dino_map=page_engines.dino_map,
            )
            segmentation_result = self.segmentation_service.segment_page(
                analysis_id=analysis_id,
                page_index=page_index,
                original_image=rendered_page.image,
                original_rgb=features.original_rgb,
                tensor=segmentation_tensor,
            )

            combined_map = self.engine_service.build_combined_map(
                page_engines=page_engines,
                segmentation_probability_map=segmentation_result.probability_map,
            )
            combined_filename = f"page_{page_index}_combined.png"
            self.artifact_service.save_array(
                analysis_id,
                combined_filename,
                apply_heatmap(combined_map),
            )

            warnings = self._dedupe_warnings(warnings + segmentation_result.warnings)
            page_scores["ela"].append(page_engines.ela_score)
            page_scores["srm"].append(page_engines.srm_score)
            page_scores["noiseprint"].append(page_engines.noiseprint_score)
            page_scores["dino"].append(page_engines.dino_score)
            page_scores["segmentation"].append(segmentation_result.score)

            page_results.append(
                PageResult(
                    page_index=page_index,
                    width=rendered_page.width,
                    height=rendered_page.height,
                    artifacts=PageArtifacts(
                        original_url=self.artifact_service.url_for(analysis_id, original_filename),
                        mask_url=self.artifact_service.url_for(
                            analysis_id, segmentation_result.mask_filename
                        ),
                        overlay_url=self.artifact_service.url_for(
                            analysis_id, segmentation_result.overlay_filename
                        ),
                        ela_heatmap_url=self.artifact_service.url_for(
                            analysis_id, page_engines.ela_filename
                        ),
                        srm_heatmap_url=self.artifact_service.url_for(
                            analysis_id, page_engines.srm_filename
                        ),
                        noiseprint_heatmap_url=self.artifact_service.url_for(
                            analysis_id, page_engines.noiseprint_filename
                        ),
                        dino_heatmap_url=self.artifact_service.url_for(
                            analysis_id, page_engines.dino_filename
                        ),
                        combined_heatmap_url=self.artifact_service.url_for(
                            analysis_id, combined_filename
                        ),
                        contours_url=self.artifact_service.url_for(
                            analysis_id, segmentation_result.contours_filename
                        ),
                    ),
                    tampered_regions=[TamperedRegion(**region) for region in segmentation_result.regions],
                )
            )

        engine_scores = EngineScores(
            ela_score=self._average(page_scores["ela"]),
            srm_score=self._average(page_scores["srm"]),
            noiseprint_score=self._average(page_scores["noiseprint"]),
            dino_vit_score=self._average(page_scores["dino"]),
            ocr_anomaly_score=ocr_result.score,
            phash_score=duplicate_result.phash_score,
            segmentation_score=self._average(page_scores["segmentation"]),
        )
        overall_score = forensic_risk_score(self.settings, engine_scores)
        verdict = verdict_for_score(self.settings, overall_score)
        created_at = datetime.now(UTC)

        response = AnalysisResponse(
            analysis_id=analysis_id,
            filename=filename,
            document_type=document_type,
            submitter_id=submitter_id,
            page_count=len(rendered_pages),
            device=self.model_loader.device,
            verdict=verdict,
            forensic_risk_score=overall_score,
            engine_scores=engine_scores,
            ocr_anomalies=[OCRAnomaly(**anomaly) for anomaly in ocr_result.anomalies],
            duplicate_check=DuplicateCheck(**duplicate_result.duplicate_check),
            pages=page_results,
            warnings=warnings,
            processing_time_ms=int((time.perf_counter() - started) * 1000),
            created_at=created_at,
        )

        payload_to_store = response.model_dump(mode="json")
        self.storage_service.store_analysis(payload_to_store, upload_path)
        self.duplicate_service.register_analysis(
            analysis_id=analysis_id,
            filename=filename,
            md5_hash=response.duplicate_check.md5_hash,
            phash=response.duplicate_check.phash,
            created_at=created_at,
        )
        return response

    def get_analysis(self, analysis_id: str) -> AnalysisResponse:
        payload = self.storage_service.get_analysis(analysis_id)
        if payload is None:
            raise HTTPException(status_code=404, detail="Analysis not found.")
        return AnalysisResponse.model_validate(payload)

    def list_analyses(self, page: int, page_size: int) -> AnalysisHistoryResponse:
        items, total = self.storage_service.list_analyses(page=page, page_size=page_size)
        return AnalysisHistoryResponse(
            page=page,
            page_size=page_size,
            total=total,
            items=[AnalysisHistoryItem.model_validate(item) for item in items],
        )

    def delete_analysis(self, analysis_id: str) -> DeleteAnalysisResponse:
        deleted = self.storage_service.delete_analysis(analysis_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Analysis not found.")
        return DeleteAnalysisResponse(analysis_id=analysis_id, deleted=True)

    @staticmethod
    def _average(values: list[float]) -> float:
        if not values:
            return 0.0
        return float(sum(values) / len(values))

    @staticmethod
    def _dedupe_warnings(values: list[str]) -> list[str]:
        deduped: list[str] = []
        seen: set[str] = set()
        for value in values:
            if value not in seen:
                seen.add(value)
                deduped.append(value)
        return deduped
