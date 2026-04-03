from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from app.core.config import Settings
from app.utils.image_ops import ensure_uint8


class ArtifactService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def artifact_dir(self, analysis_id: str) -> Path:
        path = self.settings.artifacts_dir / analysis_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def artifact_path(self, analysis_id: str, filename: str) -> Path:
        return self.artifact_dir(analysis_id) / filename

    def save_image(self, analysis_id: str, filename: str, image: Image.Image) -> Path:
        path = self.artifact_path(analysis_id, filename)
        image.save(path, format="PNG")
        return path

    def save_array(self, analysis_id: str, filename: str, array: np.ndarray) -> Path:
        path = self.artifact_path(analysis_id, filename)
        image = Image.fromarray(ensure_uint8(array))
        image.save(path, format="PNG")
        return path

    def url_for(self, analysis_id: str, filename: str) -> str:
        return f"{self.settings.api_v1_prefix}/artifacts/{analysis_id}/{filename}"
