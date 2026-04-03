from __future__ import annotations

import pytest

from app.core.config import build_settings
from app.core.model_loader import ModelLoader


pytest.importorskip("segmentation_models_pytorch")


def test_model_loader_matches_checkpoint() -> None:
    settings = build_settings()
    if not settings.checkpoint_path.exists():
        pytest.skip("Checkpoint file is not present.")

    loader = ModelLoader(settings)
    loader.load()

    assert loader.model_loaded, loader.load_error
    assert loader.input_channels == 13
    assert loader.selected_encoder == "efficientnet-b3"
