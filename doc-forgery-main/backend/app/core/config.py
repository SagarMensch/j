from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _backend_root() -> Path:
    return _repo_root() / "backend"


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _env_str(name: str, default: str) -> str:
    value = os.getenv(name)
    return value.strip() if value else default


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    return int(value) if value else default


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    return float(value) if value else default


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_list(name: str, default: list[str]) -> list[str]:
    value = os.getenv(name)
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


class ScoreWeights(BaseModel):
    ela: float = 0.20
    srm: float = 0.20
    noiseprint: float = 0.20
    dino_vit: float = 0.15
    ocr_anomaly: float = 0.15
    phash: float = 0.10
    segmentation: float = 0.0


class VerdictThresholds(BaseModel):
    clean_upper: float = 0.40
    suspicious_upper: float = 0.85


class Settings(BaseModel):
    project_name: str = "Document Forgery Backend"
    api_v1_prefix: str = "/api/v1"
    log_level: str = "INFO"
    model_device: Literal["auto", "cpu", "cuda"] = "auto"
    checkpoint_path: Path
    inference_size: int = 384
    mask_threshold: float = 0.50
    pdf_dpi: int = 200
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://localhost:3001",
            "http://localhost:5173",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5173",
        ]
    )
    data_dir: Path
    uploads_dir: Path
    outputs_dir: Path
    artifacts_dir: Path
    db_path: Path
    duplicate_near_threshold: int = 8
    duplicate_exact_threshold: int = 0
    enable_segmentation_in_final_score: bool = False
    score_weights: ScoreWeights = Field(default_factory=ScoreWeights)
    verdict_thresholds: VerdictThresholds = Field(default_factory=VerdictThresholds)
    dino_model_name: str = "vit_tiny_patch16_224"
    min_region_area_px: int = 64

    @property
    def backend_root(self) -> Path:
        return _backend_root()

    @property
    def allowed_upload_suffixes(self) -> set[str]:
        return {".pdf", ".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}


def build_settings() -> Settings:
    _load_env_file(_repo_root() / ".env")
    _load_env_file(_backend_root() / ".env")

    backend_root = _backend_root()
    data_dir = backend_root / "data"
    uploads_dir = data_dir / "uploads"
    outputs_dir = data_dir / "outputs"
    artifacts_dir = data_dir / "artifacts"
    db_path = data_dir / "db" / "analysis.db"
    checkpoint_default = _repo_root() / "working_forgery_best.pth"

    return Settings(
        project_name=_env_str("PROJECT_NAME", "Document Forgery Backend"),
        api_v1_prefix=_env_str("API_V1_PREFIX", "/api/v1"),
        log_level=_env_str("LOG_LEVEL", "INFO"),
        model_device=_env_str("MODEL_DEVICE", "auto"),
        checkpoint_path=Path(_env_str("CHECKPOINT_PATH", str(checkpoint_default))),
        inference_size=_env_int("INFERENCE_SIZE", 384),
        mask_threshold=_env_float("MASK_THRESHOLD", 0.50),
        pdf_dpi=_env_int("PDF_DPI", 200),
        cors_origins=_env_list(
            "CORS_ORIGINS",
            [
                "http://localhost:3000",
                "http://localhost:3001",
                "http://localhost:5173",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:5173",
            ],
        ),
        data_dir=Path(_env_str("DATA_DIR", str(data_dir))),
        uploads_dir=Path(_env_str("UPLOADS_DIR", str(uploads_dir))),
        outputs_dir=Path(_env_str("OUTPUTS_DIR", str(outputs_dir))),
        artifacts_dir=Path(_env_str("ARTIFACTS_DIR", str(artifacts_dir))),
        db_path=Path(_env_str("DB_PATH", str(db_path))),
        duplicate_near_threshold=_env_int("DUPLICATE_NEAR_THRESHOLD", 8),
        duplicate_exact_threshold=_env_int("DUPLICATE_EXACT_THRESHOLD", 0),
        enable_segmentation_in_final_score=_env_bool(
            "ENABLE_SEGMENTATION_IN_FINAL_SCORE", False
        ),
        score_weights=ScoreWeights(
            ela=_env_float("WEIGHT_ELA", 0.20),
            srm=_env_float("WEIGHT_SRM", 0.20),
            noiseprint=_env_float("WEIGHT_NOISEPRINT", 0.20),
            dino_vit=_env_float("WEIGHT_DINO_VIT", 0.15),
            ocr_anomaly=_env_float("WEIGHT_OCR_ANOMALY", 0.15),
            phash=_env_float("WEIGHT_PHASH", 0.10),
            segmentation=_env_float("WEIGHT_SEGMENTATION", 0.0),
        ),
        verdict_thresholds=VerdictThresholds(
            clean_upper=_env_float("THRESHOLD_CLEAN_UPPER", 0.40),
            suspicious_upper=_env_float("THRESHOLD_SUSPICIOUS_UPPER", 0.85),
        ),
        dino_model_name=_env_str("DINO_MODEL_NAME", "vit_tiny_patch16_224"),
        min_region_area_px=_env_int("MIN_REGION_AREA_PX", 64),
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return build_settings()
