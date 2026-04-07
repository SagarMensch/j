from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from app.core.config import ScoreWeights, Settings, VerdictThresholds
from app.services.document_routing_service import DocumentRoutingService


def build_settings(tmp_path: Path) -> Settings:
    data_dir = tmp_path / "data"
    return Settings(
        project_name="Routing Test Backend",
        checkpoint_path=tmp_path / "checkpoint.pth",
        inference_size=128,
        mask_threshold=0.5,
        pdf_dpi=72,
        cors_origins=["http://localhost:3000"],
        data_dir=data_dir,
        uploads_dir=data_dir / "uploads",
        outputs_dir=data_dir / "outputs",
        artifacts_dir=data_dir / "artifacts",
        calibration_profile_path=data_dir / "calibration" / "latest.json",
        parity_report_path=data_dir / "parity" / "latest.json",
        db_path=data_dir / "db" / "analysis.db",
        database_url=None,
        duplicate_near_threshold=8,
        duplicate_exact_threshold=0,
        enable_segmentation_in_final_score=True,
        score_weights=ScoreWeights(),
        verdict_thresholds=VerdictThresholds(clean_upper=0.2, suspicious_upper=0.5),
        dino_model_name="vit_small_patch16_224",
        min_region_area_px=8,
    )


def test_filename_heuristics_route_bank_statement_pdf_to_sarvam(tmp_path: Path) -> None:
    service = DocumentRoutingService(build_settings(tmp_path))
    document_type, confidence = service.classify_from_filename("bank_statement_apr_2026.pdf")
    provider = service.select_provider(
        filename="bank_statement_apr_2026.pdf",
        page_count=1,
        language_code="en-IN",
        document_type=document_type,
    )
    assert document_type == "bank_statement"
    assert confidence > 0.5
    assert provider == "sarvam"


def test_non_latin_legal_document_routes_to_sarvam(tmp_path: Path) -> None:
    service = DocumentRoutingService(build_settings(tmp_path))
    provider = service.select_provider(
        filename="न्यायालय_आदेश.pdf",
        page_count=3,
        language_code="hi-IN",
        document_type="legal_filing",
    )
    assert provider == "sarvam"


def test_page_texts_can_be_recovered_from_sarvam_archive(tmp_path: Path) -> None:
    service = DocumentRoutingService(build_settings(tmp_path))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("document.md", "Invoice\nTotal: 100.00\n")
        archive.writestr(
            "metadata/page_001.json",
            json.dumps(
                {
                    "page_num": 1,
                    "blocks": [
                        {"reading_order": 2, "text": "Total: 100.00"},
                        {"reading_order": 1, "text": "Invoice"},
                    ],
                }
            ),
        )
    page_texts = service.page_texts_from_sarvam_archive(buffer.getvalue())
    assert page_texts == ["Invoice\nTotal: 100.00"]
