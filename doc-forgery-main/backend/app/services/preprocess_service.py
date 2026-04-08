from __future__ import annotations

import io
from dataclasses import dataclass

import cv2
import numpy as np
import torch
from PIL import Image

from app.core.config import Settings
from app.utils.image_ops import pil_to_rgb_np, resize_map, resize_rgb


@dataclass(slots=True)
class CPUFeatureBundle:
    original_rgb: np.ndarray
    inference_rgb: np.ndarray
    ela_rgb: np.ndarray
    inference_ela_rgb: np.ndarray
    laplacian_rgb: np.ndarray
    inference_laplacian_rgb: np.ndarray
    ocr_proxy: np.ndarray
    inference_ocr_proxy: np.ndarray
    dct_residual: np.ndarray
    inference_dct_residual: np.ndarray
    width: int
    height: int


class PreprocessService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._channel_mean = torch.tensor(
            [
                123.675,
                116.28,
                103.53,
                127.5,
                127.5,
                127.5,
                127.5,
                127.5,
                127.5,
                32.0,
                8.0,
                127.5,
                127.5,
            ],
            dtype=torch.float32,
        ).view(1, 13, 1, 1)
        self._channel_std = torch.tensor(
            [
                58.395,
                57.12,
                57.375,
                64.0,
                64.0,
                64.0,
                64.0,
                64.0,
                64.0,
                48.0,
                15.0,
                64.0,
                64.0,
            ],
            dtype=torch.float32,
        ).view(1, 13, 1, 1)

    def extract_cpu_features(self, image: Image.Image) -> CPUFeatureBundle:
        original_rgb = pil_to_rgb_np(image)
        width, height = image.width, image.height
        inference_size = (self.settings.inference_size, self.settings.inference_size)

        ela_rgb = self.compute_ela_multi(image)
        laplacian_rgb = self.compute_laplacian(original_rgb)
        ocr_proxy = self.compute_ocr_proxy(original_rgb)
        dct_residual = self.compute_dct_residual(original_rgb)

        return CPUFeatureBundle(
            original_rgb=original_rgb,
            inference_rgb=resize_rgb(original_rgb, inference_size),
            ela_rgb=ela_rgb,
            inference_ela_rgb=resize_rgb(ela_rgb, inference_size),
            laplacian_rgb=laplacian_rgb,
            inference_laplacian_rgb=resize_rgb(laplacian_rgb, inference_size),
            ocr_proxy=ocr_proxy,
            inference_ocr_proxy=resize_map(ocr_proxy, inference_size),
            dct_residual=dct_residual,
            inference_dct_residual=resize_map(dct_residual, inference_size),
            width=width,
            height=height,
        )

    def build_segmentation_tensor(
        self,
        features: CPUFeatureBundle,
        srm_map: np.ndarray,
        noiseprint_map: np.ndarray,
        dino_map: np.ndarray,
    ) -> torch.Tensor:
        inference_size = (self.settings.inference_size, self.settings.inference_size)
        srm_resized = resize_map(srm_map, inference_size) * 255.0
        noiseprint_resized = resize_map(noiseprint_map, inference_size) * 255.0
        dino_resized = resize_map(dino_map, inference_size) * 255.0
        srm_dino_fused = np.maximum(srm_resized, dino_resized)

        channels = [
            features.inference_rgb[..., channel].astype(np.float32) for channel in range(3)
        ]
        channels.extend(
            features.inference_ela_rgb[..., channel].astype(np.float32) for channel in range(3)
        )
        channels.extend(
            features.inference_laplacian_rgb[..., channel].astype(np.float32)
            for channel in range(3)
        )
        channels.append(features.inference_ocr_proxy.astype(np.float32))
        channels.append(features.inference_dct_residual.astype(np.float32))
        channels.append(srm_dino_fused.astype(np.float32))
        channels.append(noiseprint_resized.astype(np.float32))

        tensor = torch.from_numpy(np.stack(channels, axis=0)).unsqueeze(0)
        mean = self._channel_mean.to(tensor.device)
        std = self._channel_std.to(tensor.device)
        return (tensor - mean) / (std + 1e-6)

    @staticmethod
    def compute_ela_multi(image: Image.Image) -> np.ndarray:
        original = np.array(image.convert("RGB"), dtype=np.float32)
        ela_layers: list[np.ndarray] = []
        for quality in (90, 75, 65):
            buffer = io.BytesIO()
            image.save(buffer, "JPEG", quality=quality)
            buffer.seek(0)
            compressed = np.array(Image.open(buffer).convert("RGB"), dtype=np.float32)
            residual = np.abs(original - compressed)
            residual = residual * (255.0 / (residual.max() + 1e-6))
            ela_layers.append(residual.astype(np.uint8))
        return np.mean(np.stack(ela_layers, axis=0), axis=0).astype(np.uint8)

    @staticmethod
    def compute_laplacian(image_rgb: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
        fine = np.abs(cv2.Laplacian(gray, cv2.CV_32F, ksize=1))
        medium = np.abs(cv2.Laplacian(cv2.GaussianBlur(gray, (3, 3), 0), cv2.CV_32F, ksize=3))
        coarse = np.abs(cv2.Laplacian(cv2.GaussianBlur(gray, (5, 5), 0), cv2.CV_32F, ksize=5))
        laplacian = np.stack([fine, medium, coarse], axis=2)
        laplacian = laplacian / (laplacian.max() + 1e-6)
        return (laplacian * 255.0).astype(np.uint8)

    @staticmethod
    def compute_ocr_proxy(image_rgb: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
        gradient_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        gradient = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, gradient_kernel)
        horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 3))
        text_map = cv2.morphologyEx(gradient, cv2.MORPH_CLOSE, horizontal_kernel)
        return text_map.astype(np.float32)

    @staticmethod
    def compute_dct_residual(image_rgb: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
        height, width = gray.shape
        padded_height = ((height + 7) // 8) * 8
        padded_width = ((width + 7) // 8) * 8
        padded = np.pad(gray, ((0, padded_height - height), (0, padded_width - width)), mode="reflect")

        block_variance = np.zeros_like(gray)
        for row in range(0, height, 8):
            for col in range(0, width, 8):
                block = padded[row : row + 8, col : col + 8]
                row_end = min(row + 8, height)
                col_end = min(col + 8, width)
                block_variance[row:row_end, col:col_end] = float(np.var(block))

        blurred = cv2.GaussianBlur(block_variance, (9, 9), 0)
        residual = np.abs(block_variance - blurred)
        residual = residual / (residual.max() + 1e-6)
        return (residual * 255.0).astype(np.float32)
