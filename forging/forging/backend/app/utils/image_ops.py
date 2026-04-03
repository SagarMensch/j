from __future__ import annotations

from math import ceil, sqrt
from typing import Iterable

import cv2
import numpy as np
from PIL import Image


def pil_to_rgb_np(image: Image.Image) -> np.ndarray:
    return np.array(image.convert("RGB"), dtype=np.uint8)


def rgb_np_to_pil(image: np.ndarray) -> Image.Image:
    array = ensure_uint8(image)
    if array.ndim == 2:
        return Image.fromarray(array, mode="L")
    return Image.fromarray(array, mode="RGB")


def ensure_uint8(array: np.ndarray) -> np.ndarray:
    if array.dtype == np.uint8:
        return array
    clipped = np.clip(array, 0, 255)
    return clipped.astype(np.uint8)


def normalize_map(array: np.ndarray) -> np.ndarray:
    arr = np.nan_to_num(array.astype(np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    min_value = float(arr.min()) if arr.size else 0.0
    max_value = float(arr.max()) if arr.size else 0.0
    if max_value - min_value < 1e-6:
        return np.zeros_like(arr, dtype=np.float32)
    return (arr - min_value) / (max_value - min_value)


def grayscale_uint8(array: np.ndarray) -> np.ndarray:
    normalized = normalize_map(array)
    return (normalized * 255.0).astype(np.uint8)


def apply_heatmap(array: np.ndarray) -> np.ndarray:
    gray = grayscale_uint8(array)
    heatmap_bgr = cv2.applyColorMap(gray, cv2.COLORMAP_TURBO)
    return cv2.cvtColor(heatmap_bgr, cv2.COLOR_BGR2RGB)


def blend_heatmap(image_rgb: np.ndarray, map_array: np.ndarray, alpha: float = 0.35) -> np.ndarray:
    heatmap = apply_heatmap(map_array)
    return ensure_uint8(
        cv2.addWeighted(
            ensure_uint8(image_rgb),
            1.0 - alpha,
            ensure_uint8(heatmap),
            alpha,
            0.0,
        )
    )


def resize_rgb(image_rgb: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    width, height = size
    return cv2.resize(image_rgb, (width, height), interpolation=cv2.INTER_AREA)


def resize_map(map_array: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    width, height = size
    return cv2.resize(map_array.astype(np.float32), (width, height), interpolation=cv2.INTER_LINEAR)


def document_collage(images: Iterable[Image.Image], tile_size: int = 128) -> Image.Image:
    pil_images = [image.convert("RGB") for image in images]
    if not pil_images:
        return Image.new("RGB", (tile_size, tile_size), color="black")

    columns = ceil(sqrt(len(pil_images)))
    rows = ceil(len(pil_images) / columns)
    canvas = Image.new("RGB", (columns * tile_size, rows * tile_size), color="black")
    for index, image in enumerate(pil_images):
        thumb = image.copy()
        thumb.thumbnail((tile_size, tile_size))
        x = (index % columns) * tile_size
        y = (index // columns) * tile_size
        offset_x = x + (tile_size - thumb.width) // 2
        offset_y = y + (tile_size - thumb.height) // 2
        canvas.paste(thumb, (offset_x, offset_y))
    return canvas
