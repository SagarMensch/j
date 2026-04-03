from __future__ import annotations

import logging
from dataclasses import dataclass

import cv2
import numpy as np
import torch

from app.core.config import Settings
from app.services.artifact_service import ArtifactService
from app.services.preprocess_service import CPUFeatureBundle
from app.utils.image_ops import apply_heatmap, normalize_map
from app.utils.scoring import clamp01, map_score

try:
    import timm
except ImportError:  # pragma: no cover - depends on optional install
    timm = None


@dataclass(slots=True)
class PageEngineResult:
    ela_map: np.ndarray
    ela_score: float
    srm_map: np.ndarray
    srm_score: float
    noiseprint_map: np.ndarray
    noiseprint_score: float
    dino_map: np.ndarray
    dino_score: float
    ocr_proxy_map: np.ndarray
    ela_filename: str
    srm_filename: str
    noiseprint_filename: str
    dino_filename: str


class EngineService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.logger = logging.getLogger(self.__class__.__name__)
        self.device = "cuda" if torch.cuda.is_available() and settings.model_device != "cpu" else "cpu"
        self.srm_kernels = self._build_srm_kernel_bank()
        self.dino_model = self._load_dino_model()
        self.imagenet_mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
        self.imagenet_std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)

    def _load_dino_model(self) -> torch.nn.Module | None:
        if timm is None:
            return None
        try:
            model = timm.create_model(
                self.settings.dino_model_name,
                pretrained=True,
                num_classes=0,
            )
            model.eval()
            model.to(self.device)
            for parameter in model.parameters():
                parameter.requires_grad_(False)
            self.logger.info("DINO backend initialised", extra={"model_name": self.settings.dino_model_name})
            return model
        except Exception as exc:
            self.logger.warning("Falling back from timm DINO backend: %s", exc)
            return None

    def _build_srm_kernel_bank(self) -> np.ndarray:
        base_kernels = [
            np.array(
                [[0, 0, 0, 0, 0], [0, -1, 2, -1, 0], [0, 2, -4, 2, 0], [0, -1, 2, -1, 0], [0, 0, 0, 0, 0]],
                dtype=np.float32,
            )
            / 4.0,
            np.array(
                [[-1, 2, -2, 2, -1], [2, -6, 8, -6, 2], [-2, 8, -12, 8, -2], [2, -6, 8, -6, 2], [-1, 2, -2, 2, -1]],
                dtype=np.float32,
            )
            / 12.0,
            np.array(
                [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 1, -2, 1, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
                dtype=np.float32,
            )
            / 2.0,
            np.array(
                [[0, 0, 0, 0, 0], [0, 0, 1, 0, 0], [0, 1, -4, 1, 0], [0, 0, 1, 0, 0], [0, 0, 0, 0, 0]],
                dtype=np.float32,
            ),
            np.array(
                [[1, -2, 1, 0, 0], [-2, 4, -2, 0, 0], [1, -2, 1, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
                dtype=np.float32,
            )
            / 4.0,
        ]

        unique_kernels: list[np.ndarray] = []
        seen: set[bytes] = set()
        for kernel in base_kernels:
            for rotation in range(4):
                rotated = np.rot90(kernel, rotation)
                for variant in (rotated, np.fliplr(rotated)):
                    key = variant.tobytes()
                    if key not in seen:
                        seen.add(key)
                        unique_kernels.append(variant.astype(np.float32))
        while len(unique_kernels) < 30:
            unique_kernels.extend(unique_kernels[: 30 - len(unique_kernels)])
        return np.stack(unique_kernels[:30], axis=0)

    def analyze_page(
        self,
        features: CPUFeatureBundle,
        analysis_id: str,
        page_index: int,
        artifact_service: ArtifactService,
    ) -> PageEngineResult:
        ela_map = normalize_map(features.ela_rgb.mean(axis=2))
        srm_map = self._compute_srm_map(features.original_rgb)
        noiseprint_map = self._compute_noiseprint_map(features.original_rgb)
        dino_map = self._compute_dino_map(features.original_rgb)
        ocr_proxy_map = normalize_map(features.ocr_proxy)

        ela_filename = f"page_{page_index}_ela.png"
        srm_filename = f"page_{page_index}_srm.png"
        noiseprint_filename = f"page_{page_index}_noiseprint.png"
        dino_filename = f"page_{page_index}_dino.png"

        artifact_service.save_array(analysis_id, ela_filename, apply_heatmap(ela_map))
        artifact_service.save_array(analysis_id, srm_filename, apply_heatmap(srm_map))
        artifact_service.save_array(analysis_id, noiseprint_filename, apply_heatmap(noiseprint_map))
        artifact_service.save_array(analysis_id, dino_filename, apply_heatmap(dino_map))

        return PageEngineResult(
            ela_map=ela_map,
            ela_score=map_score(ela_map),
            srm_map=srm_map,
            srm_score=map_score(srm_map),
            noiseprint_map=noiseprint_map,
            noiseprint_score=map_score(noiseprint_map),
            dino_map=dino_map,
            dino_score=map_score(dino_map),
            ocr_proxy_map=ocr_proxy_map,
            ela_filename=ela_filename,
            srm_filename=srm_filename,
            noiseprint_filename=noiseprint_filename,
            dino_filename=dino_filename,
        )

    def build_combined_map(
        self,
        page_engines: PageEngineResult,
        segmentation_probability_map: np.ndarray,
    ) -> np.ndarray:
        combined = (
            0.25 * page_engines.ela_map
            + 0.25 * page_engines.srm_map
            + 0.20 * page_engines.noiseprint_map
            + 0.15 * page_engines.dino_map
            + 0.10 * normalize_map(segmentation_probability_map)
            + 0.05 * page_engines.ocr_proxy_map
        )
        return normalize_map(combined)

    def _compute_srm_map(self, image_rgb: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
        responses = []
        for kernel in self.srm_kernels:
            response = cv2.filter2D(gray, cv2.CV_32F, kernel)
            responses.append(np.abs(response))
        return normalize_map(np.mean(np.stack(responses, axis=0), axis=0))

    def _compute_noiseprint_map(self, image_rgb: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        residual = np.abs(gray - blurred)
        local_mean = cv2.blur(residual, (15, 15))
        inconsistency = np.abs(residual - local_mean)
        return normalize_map(inconsistency)

    def _compute_dino_map(self, image_rgb: np.ndarray) -> np.ndarray:
        if self.dino_model is not None:
            timm_map = self._compute_timm_dino_map(image_rgb)
            if timm_map is not None:
                return timm_map
        return self._compute_fallback_dino_map(image_rgb)

    def _compute_timm_dino_map(self, image_rgb: np.ndarray) -> np.ndarray | None:
        try:
            tensor = (
                torch.from_numpy(image_rgb.transpose(2, 0, 1))
                .unsqueeze(0)
                .float()
                .to(self.device)
                / 255.0
            )
            mean = self.imagenet_mean.to(self.device)
            std = self.imagenet_std.to(self.device)
            tensor = (tensor - mean) / std
            tensor = torch.nn.functional.interpolate(
                tensor,
                size=(224, 224),
                mode="bilinear",
                align_corners=False,
            )
            with torch.no_grad():
                features = self.dino_model.forward_features(tensor)

            patch_tokens: torch.Tensor | None = None
            cls_token: torch.Tensor | None = None
            if isinstance(features, dict):
                patch_tokens = features.get("x_norm_patchtokens")
                cls_token = features.get("x_norm_clstoken")
                if patch_tokens is None:
                    x_value = features.get("x")
                    if isinstance(x_value, torch.Tensor) and x_value.ndim == 3 and x_value.shape[1] > 1:
                        patch_tokens = x_value[:, 1:]
                        cls_token = x_value[:, :1]
            elif isinstance(features, torch.Tensor) and features.ndim == 3 and features.shape[1] > 1:
                patch_tokens = features[:, 1:]
                cls_token = features[:, :1]

            if patch_tokens is None or cls_token is None:
                return None

            distances = torch.norm(patch_tokens - cls_token, dim=-1)
            distances = distances - distances.amin(dim=1, keepdim=True)
            distances = distances / (distances.amax(dim=1, keepdim=True) + 1e-6)
            side = int(distances.shape[1] ** 0.5)
            distance_map = distances.reshape(1, 1, side, side)
            distance_map = torch.nn.functional.interpolate(
                distance_map,
                size=(image_rgb.shape[0], image_rgb.shape[1]),
                mode="bilinear",
                align_corners=False,
            )
            return normalize_map(distance_map.squeeze().detach().cpu().numpy())
        except Exception as exc:
            self.logger.warning("DINO timm path failed, using fallback: %s", exc)
            return None

    def _compute_fallback_dino_map(self, image_rgb: np.ndarray) -> np.ndarray:
        resized = cv2.resize(image_rgb, (224, 224), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
        patch_size = 16
        patch_vectors = []
        for y in range(0, 224, patch_size):
            for x in range(0, 224, patch_size):
                patch = resized[y : y + patch_size, x : x + patch_size]
                vector = np.concatenate([patch.mean(axis=(0, 1)), patch.std(axis=(0, 1))], axis=0)
                patch_vectors.append(vector)
        patch_matrix = np.stack(patch_vectors, axis=0)
        centroid = patch_matrix.mean(axis=0, keepdims=True)
        distances = np.linalg.norm(patch_matrix - centroid, axis=1)
        distances = distances.reshape(14, 14)
        return normalize_map(cv2.resize(distances, (image_rgb.shape[1], image_rgb.shape[0]), interpolation=cv2.INTER_LINEAR))
