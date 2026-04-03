from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from app.core.config import build_settings
from app.core.model_loader import ModelLoader
from app.services.artifact_service import ArtifactService
from app.services.engine_service import EngineService
from app.services.preprocess_service import PreprocessService
from app.services.segmentation_service import SegmentationService


pytest.importorskip("segmentation_models_pytorch")


def test_single_page_inference(tmp_path: Path) -> None:
    base_settings = build_settings()
    if not base_settings.checkpoint_path.exists():
        pytest.skip("Checkpoint file is not present.")

    settings = base_settings.model_copy(
        update={
            "data_dir": tmp_path / "data",
            "uploads_dir": tmp_path / "data" / "uploads",
            "outputs_dir": tmp_path / "data" / "outputs",
            "artifacts_dir": tmp_path / "data" / "artifacts",
            "db_path": tmp_path / "data" / "db" / "analysis.db",
        }
    )
    for directory in (
        settings.data_dir,
        settings.uploads_dir,
        settings.outputs_dir,
        settings.artifacts_dir,
        settings.db_path.parent,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    model_loader = ModelLoader(settings)
    model_loader.load()
    if not model_loader.model_loaded:
        pytest.skip(model_loader.load_error)

    artifact_service = ArtifactService(settings)
    preprocess_service = PreprocessService(settings)
    engine_service = EngineService(settings)
    segmentation_service = SegmentationService(settings, model_loader, artifact_service)

    image = Image.new("RGB", (512, 512), "white")
    draw = ImageDraw.Draw(image)
    draw.text((40, 40), "Receipt RCP-2048", fill="black")
    draw.rectangle((300, 220, 420, 280), outline="red", width=4)

    features = preprocess_service.extract_cpu_features(image)
    page_engines = engine_service.analyze_page(
        features=features,
        analysis_id="test-analysis",
        page_index=1,
        artifact_service=artifact_service,
    )
    tensor = preprocess_service.build_segmentation_tensor(
        features=features,
        srm_map=page_engines.srm_map,
        noiseprint_map=page_engines.noiseprint_map,
        dino_map=page_engines.dino_map,
    )
    result = segmentation_service.segment_page(
        analysis_id="test-analysis",
        page_index=1,
        original_image=image,
        original_rgb=features.original_rgb,
        tensor=tensor,
    )

    assert result.probability_map.shape == (image.height, image.width)
    assert result.binary_mask.shape == (image.height, image.width)
    assert artifact_service.artifact_path("test-analysis", result.mask_filename).exists()
    assert artifact_service.artifact_path("test-analysis", result.overlay_filename).exists()
