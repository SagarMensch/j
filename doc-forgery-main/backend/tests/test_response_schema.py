from __future__ import annotations

from app.schemas.responses import AnalysisResponse


def test_multi_page_response_schema() -> None:
    payload = {
        "analysis_id": "analysis-123",
        "filename": "invoice.pdf",
        "document_type": "invoice",
        "submitter_id": "user-1",
        "page_count": 2,
        "device": "cpu",
        "verdict": "SUSPICIOUS",
        "forensic_risk_score": 0.67,
        "engine_scores": {
            "ela_score": 0.62,
            "srm_score": 0.58,
            "noiseprint_score": 0.71,
            "dino_vit_score": 0.54,
            "ocr_anomaly_score": 0.40,
            "phash_score": 0.10,
            "segmentation_score": 0.83,
        },
        "ocr_anomalies": [
            {
                "type": "AMOUNT_MISMATCH",
                "description": "Line items do not match total",
                "page_index": 1,
            }
        ],
        "duplicate_check": {
            "md5_hash": "abc",
            "phash": "def",
            "duplicate_status": "NO_MATCH",
            "nearest_match_analysis_id": None,
            "hamming_distance": None,
        },
        "pages": [
            {
                "page_index": 1,
                "width": 2480,
                "height": 3508,
                "artifacts": {
                    "original_url": "/api/v1/artifacts/analysis-123/page_1_original.png",
                    "mask_url": "/api/v1/artifacts/analysis-123/page_1_mask.png",
                    "overlay_url": "/api/v1/artifacts/analysis-123/page_1_overlay.png",
                    "ela_heatmap_url": "/api/v1/artifacts/analysis-123/page_1_ela.png",
                    "srm_heatmap_url": "/api/v1/artifacts/analysis-123/page_1_srm.png",
                    "noiseprint_heatmap_url": "/api/v1/artifacts/analysis-123/page_1_noiseprint.png",
                    "dino_heatmap_url": "/api/v1/artifacts/analysis-123/page_1_dino.png",
                    "combined_heatmap_url": "/api/v1/artifacts/analysis-123/page_1_combined.png",
                    "contours_url": "/api/v1/artifacts/analysis-123/page_1_contours.png",
                },
                "tampered_regions": [
                    {
                        "region_id": "page1_region1",
                        "page_index": 1,
                        "x": 420,
                        "y": 610,
                        "width": 310,
                        "height": 90,
                        "area_px": 27900,
                        "mean_mask_score": 0.81,
                        "max_mask_score": 0.97,
                    }
                ],
            },
            {
                "page_index": 2,
                "width": 2480,
                "height": 3508,
                "artifacts": {
                    "original_url": "/api/v1/artifacts/analysis-123/page_2_original.png",
                    "mask_url": "/api/v1/artifacts/analysis-123/page_2_mask.png",
                    "overlay_url": "/api/v1/artifacts/analysis-123/page_2_overlay.png",
                    "ela_heatmap_url": "/api/v1/artifacts/analysis-123/page_2_ela.png",
                    "srm_heatmap_url": "/api/v1/artifacts/analysis-123/page_2_srm.png",
                    "noiseprint_heatmap_url": "/api/v1/artifacts/analysis-123/page_2_noiseprint.png",
                    "dino_heatmap_url": "/api/v1/artifacts/analysis-123/page_2_dino.png",
                    "combined_heatmap_url": "/api/v1/artifacts/analysis-123/page_2_combined.png",
                    "contours_url": "/api/v1/artifacts/analysis-123/page_2_contours.png",
                },
                "tampered_regions": [],
            },
        ],
        "warnings": [],
        "processing_time_ms": 1842,
        "created_at": "2026-04-02T12:00:00Z",
    }

    response = AnalysisResponse.model_validate(payload)

    assert response.page_count == 2
    assert len(response.pages) == 2
    assert response.pages[0].tampered_regions[0].region_id == "page1_region1"
