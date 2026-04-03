from __future__ import annotations

import numpy as np
import torch
from PIL import Image, ImageDraw

from app.core.config import build_settings
from app.services.preprocess_service import PreprocessService


def test_preprocess_tensor_shape() -> None:
    settings = build_settings()
    service = PreprocessService(settings)

    image = Image.new("RGB", (512, 512), "white")
    draw = ImageDraw.Draw(image)
    draw.text((32, 32), "Invoice INV-1001", fill="black")
    draw.text((32, 80), "Total: 89.99", fill="black")

    features = service.extract_cpu_features(image)
    zeros = np.zeros((features.height, features.width), dtype=np.float32)
    tensor = service.build_segmentation_tensor(features, zeros, zeros, zeros)

    assert tensor.shape == (1, 13, settings.inference_size, settings.inference_size)
    assert tensor.dtype == torch.float32
