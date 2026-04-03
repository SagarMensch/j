from __future__ import annotations

import cv2
import numpy as np

from app.utils.image_ops import ensure_uint8, normalize_map


def threshold_mask(probability_map: np.ndarray, threshold: float) -> np.ndarray:
    return ((probability_map >= threshold).astype(np.uint8)) * 255


def overlay_mask(image_rgb: np.ndarray, probability_map: np.ndarray, alpha: float = 0.45) -> np.ndarray:
    image = ensure_uint8(image_rgb).copy()
    mask_strength = normalize_map(probability_map)
    red_layer = np.zeros_like(image, dtype=np.float32)
    red_layer[..., 0] = 255.0 * mask_strength
    blended = cv2.addWeighted(image.astype(np.float32), 1.0, red_layer, alpha, 0.0)
    return ensure_uint8(blended)


def draw_contours(image_rgb: np.ndarray, binary_mask: np.ndarray) -> np.ndarray:
    image = ensure_uint8(image_rgb).copy()
    contours, _ = cv2.findContours(binary_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(image, contours, -1, (255, 0, 0), 2)
    return image


def extract_regions(
    probability_map: np.ndarray,
    binary_mask: np.ndarray,
    page_index: int,
    min_area_px: int,
) -> list[dict[str, int | float | str]]:
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary_mask, connectivity=8)
    regions: list[dict[str, int | float | str]] = []
    region_number = 0

    for label_index in range(1, num_labels):
        x, y, width, height, area = stats[label_index].tolist()
        if area < min_area_px:
            continue
        component_mask = labels == label_index
        scores = probability_map[component_mask]
        region_number += 1
        regions.append(
            {
                "region_id": f"page{page_index}_region{region_number}",
                "page_index": page_index,
                "x": int(x),
                "y": int(y),
                "width": int(width),
                "height": int(height),
                "area_px": int(area),
                "mean_mask_score": float(scores.mean()) if scores.size else 0.0,
                "max_mask_score": float(scores.max()) if scores.size else 0.0,
            }
        )
    return regions
