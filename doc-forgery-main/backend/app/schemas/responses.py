from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class Verdict(str, Enum):
    CLEAN = "CLEAN"
    SUSPICIOUS = "SUSPICIOUS"
    CONFIRMED_FORGERY = "CONFIRMED_FORGERY"


class DuplicateStatus(str, Enum):
    NO_MATCH = "NO_MATCH"
    NEAR_DUPLICATE = "NEAR_DUPLICATE"
    EXACT_DUPLICATE = "EXACT_DUPLICATE"


class OCRAnomalyType(str, Enum):
    AMOUNT_MISMATCH = "AMOUNT_MISMATCH"
    DUPLICATE_REFERENCE = "DUPLICATE_REFERENCE"
    SUSPICIOUS_KEYWORD = "SUSPICIOUS_KEYWORD"
    INVALID_DATE = "INVALID_DATE"
    OCR_WARNING = "OCR_WARNING"


class EngineScores(BaseModel):
    ela_score: float = Field(ge=0.0, le=1.0)
    srm_score: float = Field(ge=0.0, le=1.0)
    noiseprint_score: float = Field(ge=0.0, le=1.0)
    dino_vit_score: float = Field(ge=0.0, le=1.0)
    ocr_anomaly_score: float = Field(ge=0.0, le=1.0)
    phash_score: float = Field(ge=0.0, le=1.0)
    segmentation_score: float = Field(ge=0.0, le=1.0)


class OCRAnomaly(BaseModel):
    type: OCRAnomalyType
    description: str
    page_index: int | None = Field(default=None, ge=1)


class DuplicateCheck(BaseModel):
    md5_hash: str
    phash: str
    duplicate_status: DuplicateStatus
    nearest_match_analysis_id: str | None = None
    hamming_distance: int | None = None


class PageArtifacts(BaseModel):
    original_url: str
    mask_url: str
    overlay_url: str
    ela_heatmap_url: str
    srm_heatmap_url: str
    noiseprint_heatmap_url: str
    dino_heatmap_url: str
    combined_heatmap_url: str
    contours_url: str


class TamperedRegion(BaseModel):
    region_id: str
    page_index: int = Field(ge=1)
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(ge=0)
    height: int = Field(ge=0)
    area_px: int = Field(ge=0)
    mean_mask_score: float = Field(ge=0.0, le=1.0)
    max_mask_score: float = Field(ge=0.0, le=1.0)


class PageResult(BaseModel):
    page_index: int = Field(ge=1)
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    artifacts: PageArtifacts
    tampered_regions: list[TamperedRegion]


class AnalysisResponse(BaseModel):
    analysis_id: str
    filename: str
    document_type: str | None = None
    submitter_id: str | None = None
    page_count: int = Field(ge=1)
    device: str
    verdict: Verdict
    forensic_risk_score: float = Field(ge=0.0, le=1.0)
    engine_scores: EngineScores
    ocr_anomalies: list[OCRAnomaly]
    duplicate_check: DuplicateCheck
    pages: list[PageResult]
    warnings: list[str] = Field(default_factory=list)
    processing_time_ms: int = Field(ge=0)
    created_at: datetime


class AnalysisHistoryItem(BaseModel):
    analysis_id: str
    filename: str
    document_type: str | None = None
    page_count: int
    verdict: Verdict
    forensic_risk_score: float
    created_at: datetime


class AnalysisHistoryResponse(BaseModel):
    page: int
    page_size: int
    total: int
    items: list[AnalysisHistoryItem]


class DeleteAnalysisResponse(BaseModel):
    analysis_id: str
    deleted: bool


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    checkpoint_exists: bool
    database_ready: bool


class ModelInfoResponse(BaseModel):
    checkpoint_path: str
    selected_encoder: str | None
    input_channels: int | None
    checkpoint_input_channels: int | None
    device: str
    model_parameter_count: int | None
    model_loaded: bool
    load_error: str | None = None
    tried_architectures: list[str] = Field(default_factory=list)
