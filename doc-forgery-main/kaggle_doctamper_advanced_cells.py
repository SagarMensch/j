# =============================================================================
# CELL 00 - Notebook Overview
# =============================================================================
#
# Purpose
# - Train a stronger DocTamper segmentation checkpoint that still stays backend
#   compatible with the current FastAPI loader.
#
# What this notebook keeps compatible
# - Architecture: smp.Unet
# - Classes: 1
# - Input channels: 13
# - Channel layout:
#   0-2   RGB
#   3-5   ELA
#   6-8   Laplacian
#   9     OCR proxy
#   10    SRM
#   11    Noiseprint approximation
#   12    DINO anomaly
#
# What this notebook improves
# - Notebook-style cell layout instead of one giant cell
# - pHash-aware grouping to reduce train/val leakage
# - Progressive resizing for a 10 hour Kaggle run
# - EfficientNet-B4 encoder while keeping U-Net checkpoint compatibility
# - EMA weights for stabler validation and export
# - Better export metadata for backend deployment
#
# Recommended Kaggle runtime
# - GPU enabled
# - Internet enabled for pretrained timm backbone weights
# - The current defaults are tuned for roughly 4 hours and 10k training images
# - If you later have more time, increase `CFG.max_hours` and add another stage
#


# =============================================================================
# CELL 01 - Install Dependencies
# =============================================================================
import subprocess
import sys


def pip_install(*packages: str) -> None:
    cmd = [sys.executable, "-m", "pip", "install", "-q", *packages]
    subprocess.run(cmd, check=False)


pip_install("segmentation-models-pytorch==0.5.0")
pip_install("albumentations>=1.4.14")
pip_install("lmdb")
pip_install("timm>=1.0.0")
pip_install("imagehash")


# =============================================================================
# CELL 02 - Imports And Runtime Flags
# =============================================================================
import io
import json
import math
import os
import random
import time
import warnings
from collections import defaultdict
from contextlib import nullcontext
from copy import deepcopy
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import albumentations as A
import cv2
import imagehash
import lmdb
import numpy as np
import segmentation_models_pytorch as smp
import timm
import torch
import torch.nn as nn
import torch.nn.functional as F
from albumentations.pytorch import ToTensorV2
from PIL import Image
from torch.optim.lr_scheduler import CosineAnnealingLR, LinearLR, SequentialLR
from torch.utils.data import DataLoader, Dataset

warnings.filterwarnings("ignore")

torch.backends.cudnn.benchmark = True
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True


def seed_everything(seed: int = 42) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


seed_everything(42)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
GPU_FEATURE_DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"
GPU_COUNT = torch.cuda.device_count()
GPU_NAMES = [torch.cuda.get_device_name(i) for i in range(GPU_COUNT)]

print("PyTorch:", torch.__version__)
print("CUDA available:", torch.cuda.is_available())
print("GPU count:", GPU_COUNT)
print("GPU names:", GPU_NAMES if GPU_NAMES else ["cpu-only"])


def autocast_context():
    if DEVICE == "cuda":
        return torch.amp.autocast("cuda")
    return nullcontext()


def unwrap_model(model: nn.Module) -> nn.Module:
    return model.module if isinstance(model, nn.DataParallel) else model


# =============================================================================
# CELL 03 - Configuration
# =============================================================================
@dataclass
class TrainStage:
    name: str
    img_size: int
    epochs: int
    lr: float


@dataclass
class CFG:
    dataset_roots: list[str] = field(
        default_factory=lambda: [
            "/kaggle/input/datasets/dinmkeljiame/doctamper",
            "/kaggle/input/doctamper",
            "/kaggle/input/doc-tamper",
            "/kaggle/input/doctamperv1",
            "/kaggle/input",
        ]
    )
    save_dir: str = "/kaggle/working/advanced_docforgery"
    encoder_name: str = "efficientnet-b3"
    max_hours: float = 3.8
    patience: int = 4
    batch_size: int = 4
    grad_accum_steps: int = 2
    weight_decay: float = 1e-4
    num_workers: int = 2
    pin_memory: bool = True
    max_train_samples: int | None = 10_000
    max_val_samples: int | None = 1_500
    train_ratio_if_single_lmdb: float = 0.90
    phash_threshold: int = 8
    max_group_items_in_train: int = 4
    use_tta_last_n_epochs: int = 1
    mask_positive_weight: float = 5.0
    grad_clip_norm: float = 1.0
    ema_decay: float = 0.999
    forensic_channel_dropout_p: float = 0.08
    dino_model_name: str = "vit_tiny_patch16_224"
    stages: list[TrainStage] = field(
        default_factory=lambda: [
            TrainStage("stage1_384", 384, 7, 2.0e-4),
            TrainStage("stage2_448", 448, 2, 1.1e-4),
        ]
    )


cfg = CFG()


def tune_cfg_for_hardware(config: CFG) -> None:
    if DEVICE != "cuda":
        config.batch_size = 2
        config.grad_accum_steps = 2
        config.num_workers = 2
        config.stages = [TrainStage("cpu_debug", 384, 1, 1.0e-4)]
        return

    if GPU_COUNT <= 1:
        config.batch_size = 3
        config.grad_accum_steps = 2
        config.stages = [
            TrainStage("stage1_384", 384, 6, 2.0e-4),
            TrainStage("stage2_448", 448, 1, 1.0e-4),
        ]
        return

    config.batch_size = 4
    config.grad_accum_steps = 2
    config.stages = [
        TrainStage("stage1_384", 384, 7, 2.0e-4),
        TrainStage("stage2_448", 448, 2, 1.1e-4),
    ]


tune_cfg_for_hardware(cfg)

SAVE_DIR = Path(cfg.save_dir)
SAVE_DIR.mkdir(parents=True, exist_ok=True)

print(json.dumps({
    "encoder_name": cfg.encoder_name,
    "batch_size": cfg.batch_size,
    "grad_accum_steps": cfg.grad_accum_steps,
    "max_hours": cfg.max_hours,
    "stages": [asdict(stage) for stage in cfg.stages],
}, indent=2))


# =============================================================================
# CELL 04 - Dataset Discovery And LMDB Helpers
# =============================================================================
@dataclass
class LMDBInfo:
    path: Path
    count: int
    start_index: int


def find_lmdb_dirs(root: Path) -> list[Path]:
    results: list[Path] = []
    if not root.exists():
        return results
    for data_file in root.rglob("data.mdb"):
        results.append(data_file.parent)
    return sorted(set(results))


def detect_lmdb_layout(config: CFG) -> tuple[Path, Path | None]:
    lmdb_dirs: list[Path] = []
    for root_str in config.dataset_roots:
        root = Path(root_str)
        lmdb_dirs.extend(find_lmdb_dirs(root))

    lmdb_dirs = sorted(set(lmdb_dirs))
    if not lmdb_dirs:
        raise FileNotFoundError(
            "No LMDB dataset found under the configured Kaggle input roots. "
            "Update CFG.dataset_roots to point to your DocTamper input."
        )

    train_dir = None
    val_dir = None
    for directory in lmdb_dirs:
        name = directory.name.lower()
        if "train" in name or "training" in name:
            train_dir = directory
        elif "test" in name or "testing" in name or "val" in name:
            val_dir = directory

    if train_dir is not None:
        return train_dir, val_dir

    if len(lmdb_dirs) == 1:
        return lmdb_dirs[0], None

    return lmdb_dirs[0], lmdb_dirs[1]


def open_lmdb(path: Path) -> lmdb.Environment:
    return lmdb.open(
        str(path),
        readonly=True,
        lock=False,
        meminit=False,
        readahead=False,
        max_readers=1,
    )


def inspect_lmdb(path: Path) -> LMDBInfo:
    env = open_lmdb(path)
    try:
        with env.begin(write=False) as txn:
            raw_count = txn.get(b"num-samples")
            if raw_count is None:
                raise RuntimeError(f"LMDB at {path} is missing key 'num-samples'.")
            count = int(raw_count.decode() if isinstance(raw_count, bytes) else raw_count)

            if txn.get(b"image-000000001") is not None:
                start_index = 1
            elif txn.get(b"image-000000000") is not None:
                start_index = 0
            else:
                raise RuntimeError(
                    f"Unable to detect DocTamper index base in {path}. "
                    "Expected image-000000001 or image-000000000."
                )
    finally:
        env.close()

    return LMDBInfo(path=path, count=count, start_index=start_index)


def build_indices(info: LMDBInfo, limit: int | None = None) -> list[int]:
    count = info.count if limit is None else min(info.count, limit)
    return list(range(info.start_index, info.start_index + count))


def image_key(index: int) -> bytes:
    return f"image-{index:09d}".encode()


def label_key(index: int) -> bytes:
    return f"label-{index:09d}".encode()


train_lmdb_dir, val_lmdb_dir = detect_lmdb_layout(cfg)
train_info = inspect_lmdb(train_lmdb_dir)
val_info = inspect_lmdb(val_lmdb_dir) if val_lmdb_dir is not None else None

print("Train LMDB:", train_info)
print("Val LMDB:", val_info if val_info is not None else "single-lmdb mode")


# =============================================================================
# CELL 05 - pHash Grouping To Reduce Leakage
# =============================================================================
def pil_phash_to_int(image: Image.Image) -> int:
    return int(str(imagehash.phash(image)), 16)


def hamming_distance_int(a: int, b: int) -> int:
    return (a ^ b).bit_count()


class BKNode:
    __slots__ = ("value", "group_id", "children")

    def __init__(self, value: int, group_id: int) -> None:
        self.value = value
        self.group_id = group_id
        self.children: dict[int, BKNode] = {}


class BKTree:
    def __init__(self) -> None:
        self.root: BKNode | None = None

    def insert(self, value: int, group_id: int) -> None:
        if self.root is None:
            self.root = BKNode(value, group_id)
            return

        node = self.root
        while True:
            distance = hamming_distance_int(value, node.value)
            child = node.children.get(distance)
            if child is None:
                node.children[distance] = BKNode(value, group_id)
                return
            node = child

    def search(self, value: int, max_distance: int) -> tuple[int, int] | None:
        if self.root is None:
            return None

        best: tuple[int, int] | None = None
        stack = [self.root]
        while stack:
            node = stack.pop()
            distance = hamming_distance_int(value, node.value)
            if distance <= max_distance and (best is None or distance < best[0]):
                best = (distance, node.group_id)

            lower = distance - max_distance
            upper = distance + max_distance
            for edge_distance, child in node.children.items():
                if lower <= edge_distance <= upper:
                    stack.append(child)
        return best


def build_hash_cache_path(name: str) -> Path:
    return SAVE_DIR / f"{name}_phash_cache.json"


def build_hash_index(info: LMDBInfo, indices: list[int], cache_name: str) -> dict[int, int]:
    cache_path = build_hash_cache_path(cache_name)
    if cache_path.exists():
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
        if (
            payload.get("lmdb_path") == str(info.path)
            and payload.get("count") == info.count
            and payload.get("start_index") == info.start_index
        ):
            return {int(k): int(v) for k, v in payload["hashes"].items()}

    env = open_lmdb(info.path)
    hashes: dict[int, int] = {}
    try:
        with env.begin(write=False) as txn:
            for position, index in enumerate(indices, start=1):
                img_bytes = txn.get(image_key(index))
                if img_bytes is None:
                    raise KeyError(f"Missing image key for index {index} in {info.path}")
                image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                image.thumbnail((256, 256))
                hashes[index] = pil_phash_to_int(image)
                if position % 1000 == 0:
                    print(f"Computed pHash for {position}/{len(indices)} samples from {info.path.name}")
    finally:
        env.close()

    cache_payload = {
        "lmdb_path": str(info.path),
        "count": info.count,
        "start_index": info.start_index,
        "hashes": {str(k): str(v) for k, v in hashes.items()},
    }
    cache_path.write_text(json.dumps(cache_payload, indent=2), encoding="utf-8")
    return hashes


def group_hashes(hash_index: dict[int, int], threshold: int) -> dict[int, list[int]]:
    tree = BKTree()
    groups: dict[int, list[int]] = defaultdict(list)
    next_group_id = 0

    for index, hash_value in hash_index.items():
        hit = tree.search(hash_value, threshold)
        if hit is None:
            group_id = next_group_id
            next_group_id += 1
            tree.insert(hash_value, group_id)
        else:
            group_id = hit[1]
        groups[group_id].append(index)

    return groups


def split_groups(
    groups: dict[int, list[int]],
    train_ratio: float,
    seed: int = 42,
) -> tuple[list[int], list[int]]:
    rng = random.Random(seed)
    group_items = list(groups.values())
    rng.shuffle(group_items)
    group_items.sort(key=len, reverse=True)

    total_items = sum(len(items) for items in group_items)
    train_target = int(total_items * train_ratio)
    train_indices: list[int] = []
    val_indices: list[int] = []

    for group_indices in group_items:
        if len(train_indices) < train_target:
            train_indices.extend(group_indices)
        else:
            val_indices.extend(group_indices)

    return sorted(train_indices), sorted(val_indices)


def cap_group_size(
    groups: dict[int, list[int]],
    max_items_per_group: int,
    seed: int = 42,
) -> list[int]:
    rng = random.Random(seed)
    kept: list[int] = []
    for group_indices in groups.values():
        if len(group_indices) <= max_items_per_group:
            kept.extend(group_indices)
        else:
            kept.extend(rng.sample(group_indices, max_items_per_group))
    return sorted(kept)


def filter_train_against_reference_hashes(
    train_hash_index: dict[int, int],
    reference_hash_index: dict[int, int],
    threshold: int,
) -> list[int]:
    tree = BKTree()
    for group_id, hash_value in enumerate(reference_hash_index.values()):
        tree.insert(hash_value, group_id)

    kept: list[int] = []
    removed = 0
    for index, hash_value in train_hash_index.items():
        if tree.search(hash_value, threshold) is None:
            kept.append(index)
        else:
            removed += 1
    print(f"Removed {removed} train samples that were near-duplicates of validation data.")
    return sorted(kept)


if val_info is None:
    base_indices = build_indices(train_info, cfg.max_train_samples)
    base_hashes = build_hash_index(train_info, base_indices, "single_lmdb")
    base_groups = group_hashes(base_hashes, cfg.phash_threshold)
    train_indices, val_indices = split_groups(
        base_groups,
        train_ratio=cfg.train_ratio_if_single_lmdb,
        seed=42,
    )

    train_hash_subset = {index: base_hashes[index] for index in train_indices}
    train_groups = group_hashes(train_hash_subset, cfg.phash_threshold)
    train_indices = cap_group_size(train_groups, cfg.max_group_items_in_train, seed=42)
else:
    train_indices = build_indices(train_info, cfg.max_train_samples)
    val_indices = build_indices(val_info, cfg.max_val_samples)

    train_hashes = build_hash_index(train_info, train_indices, "train_lmdb")
    val_hashes = build_hash_index(val_info, val_indices, "val_lmdb")

    train_indices = filter_train_against_reference_hashes(
        train_hashes,
        val_hashes,
        cfg.phash_threshold,
    )
    filtered_train_hashes = {index: train_hashes[index] for index in train_indices}
    train_groups = group_hashes(filtered_train_hashes, cfg.phash_threshold)
    train_indices = cap_group_size(train_groups, cfg.max_group_items_in_train, seed=42)

print("Train samples after pHash grouping:", len(train_indices))
print("Validation samples:", len(val_indices))


# =============================================================================
# CELL 06 - CPU Forensic Features
# =============================================================================
def compute_ela(img_pil: Image.Image, quality: int = 90) -> np.ndarray:
    buffer = io.BytesIO()
    img_pil.save(buffer, format="JPEG", quality=quality)
    buffer.seek(0)
    compressed = np.array(Image.open(buffer).convert("RGB"), dtype=np.float32)
    original = np.array(img_pil.convert("RGB"), dtype=np.float32)
    ela = np.abs(original - compressed)
    ela = ela * (255.0 / (ela.max() + 1e-6))
    return ela.astype(np.uint8)


def compute_laplacian(img_np: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY).astype(np.float32)
    fine = np.abs(cv2.Laplacian(gray, cv2.CV_32F, ksize=1))
    medium = np.abs(cv2.Laplacian(cv2.GaussianBlur(gray, (3, 3), 0), cv2.CV_32F, ksize=3))
    coarse = np.abs(cv2.Laplacian(cv2.GaussianBlur(gray, (5, 5), 0), cv2.CV_32F, ksize=5))
    merged = np.stack([fine, medium, coarse], axis=2)
    merged = merged / (merged.max() + 1e-6)
    return (merged * 255.0).astype(np.uint8)


def compute_ocr_proxy(img_np: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
    grad_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = np.abs(grad_x) * 0.7 + np.abs(grad_y) * 0.3
    grad = np.clip(grad, 0, 255).astype(np.uint8)

    horiz = cv2.morphologyEx(
        grad,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (17, 3)),
    )
    vert = cv2.morphologyEx(
        grad,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (3, 17)),
    )
    merged = np.maximum(horiz, (0.6 * vert).astype(np.uint8))
    merged = cv2.GaussianBlur(merged, (3, 3), 0)
    return merged.astype(np.uint8)


def resize_rgb(img_np: np.ndarray, img_size: int) -> np.ndarray:
    return cv2.resize(img_np, (img_size, img_size), interpolation=cv2.INTER_AREA)


def resize_map(map_np: np.ndarray, img_size: int) -> np.ndarray:
    return cv2.resize(map_np.astype(np.float32), (img_size, img_size), interpolation=cv2.INTER_LINEAR)


# =============================================================================
# CELL 07 - GPU Forensic Extractors
# =============================================================================
def minmax_norm_tensor(tensor: torch.Tensor) -> torch.Tensor:
    flat = tensor.flatten(1)
    min_values = flat.min(dim=1).values.view(-1, 1, 1, 1)
    max_values = flat.max(dim=1).values.view(-1, 1, 1, 1)
    return (tensor - min_values) / (max_values - min_values + 1e-6)


def rgb_to_gray(rgb_raw: torch.Tensor) -> torch.Tensor:
    rgb = rgb_raw.float() / 255.0
    return (
        0.2989 * rgb[:, 0:1] +
        0.5870 * rgb[:, 1:2] +
        0.1140 * rgb[:, 2:3]
    )


def build_srm_kernel_bank() -> torch.Tensor:
    kernels = [
        np.array(
            [[0, 0, 0, 0, 0], [0, -1, 2, -1, 0], [0, 2, -4, 2, 0], [0, -1, 2, -1, 0], [0, 0, 0, 0, 0]],
            dtype=np.float32,
        ) / 4.0,
        np.array(
            [[-1, 2, -2, 2, -1], [2, -6, 8, -6, 2], [-2, 8, -12, 8, -2], [2, -6, 8, -6, 2], [-1, 2, -2, 2, -1]],
            dtype=np.float32,
        ) / 12.0,
        np.array(
            [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 1, -2, 1, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
            dtype=np.float32,
        ) / 2.0,
        np.array(
            [[0, 0, 0, 0, 0], [0, 0, 1, 0, 0], [0, 1, -4, 1, 0], [0, 0, 1, 0, 0], [0, 0, 0, 0, 0]],
            dtype=np.float32,
        ),
        np.array(
            [[1, -2, 1, 0, 0], [-2, 4, -2, 0, 0], [1, -2, 1, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
            dtype=np.float32,
        ) / 4.0,
    ]

    unique: list[np.ndarray] = []
    seen: set[bytes] = set()
    for kernel in kernels:
        for rotation in range(4):
            rotated = np.rot90(kernel, rotation)
            for variant in (rotated, np.fliplr(rotated)):
                key = variant.tobytes()
                if key not in seen:
                    seen.add(key)
                    unique.append(variant.astype(np.float32))

    while len(unique) < 30:
        unique.extend(unique[: 30 - len(unique)])

    bank = np.stack(unique[:30], axis=0)
    return torch.from_numpy(bank).unsqueeze(1)


class SRMExtractor(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.register_buffer("kernels", build_srm_kernel_bank())

    def forward(self, rgb_raw: torch.Tensor) -> torch.Tensor:
        gray = rgb_to_gray(rgb_raw)
        responses = F.conv2d(gray, self.kernels, padding=2)
        responses = responses.abs().mean(dim=1, keepdim=True)
        return minmax_norm_tensor(responses)


def gaussian_kernel(kernel_size: int = 5, sigma: float = 1.2) -> torch.Tensor:
    coords = torch.arange(kernel_size, dtype=torch.float32) - ((kernel_size - 1) / 2.0)
    grid_x, grid_y = torch.meshgrid(coords, coords, indexing="ij")
    kernel = torch.exp(-(grid_x.square() + grid_y.square()) / (2 * sigma * sigma))
    kernel = kernel / kernel.sum()
    return kernel.view(1, 1, kernel_size, kernel_size)


class NoiseprintExtractor(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.register_buffer("kernel", gaussian_kernel(kernel_size=5, sigma=1.2))

    def forward(self, rgb_raw: torch.Tensor) -> torch.Tensor:
        gray = rgb_to_gray(rgb_raw)
        blurred = F.conv2d(gray, self.kernel, padding=2)
        residual = gray - blurred
        local_mean = F.avg_pool2d(residual, kernel_size=7, stride=1, padding=3)
        local_var = F.avg_pool2d((residual - local_mean).square(), kernel_size=7, stride=1, padding=3)
        score = residual.abs() + local_var.sqrt()
        return minmax_norm_tensor(score)


class DinoViTExtractor(nn.Module):
    def __init__(self, model_name: str, device: str) -> None:
        super().__init__()
        self.model_name = model_name
        self.device_name = device
        self.model: nn.Module | None = None
        self.register_buffer("mean", torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))
        self._init_model()

    def _init_model(self) -> None:
        try:
            model = timm.create_model(self.model_name, pretrained=True, num_classes=0)
            model.eval()
            model.to(self.device_name)
            for param in model.parameters():
                param.requires_grad_(False)
            self.model = model
            print(f"DINO backbone ready: {self.model_name}")
        except Exception as exc:
            self.model = None
            print(f"DINO fallback enabled because pretrained load failed: {exc}")

    def _forward_timm(self, rgb_raw: torch.Tensor, target_h: int, target_w: int) -> torch.Tensor | None:
        if self.model is None:
            return None

        tensor = rgb_raw.float() / 255.0
        tensor = F.interpolate(tensor, size=(224, 224), mode="bilinear", align_corners=False)
        tensor = (tensor - self.mean.to(tensor.device)) / self.std.to(tensor.device)

        with torch.no_grad():
            features = self.model.forward_features(tensor)

        patch_tokens = None
        cls_token = None
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
        side = int(math.sqrt(distances.shape[1]))
        distances = distances.view(distances.shape[0], 1, side, side)
        distances = F.interpolate(distances, size=(target_h, target_w), mode="bilinear", align_corners=False)
        return minmax_norm_tensor(distances)

    def _forward_fallback(self, rgb_raw: torch.Tensor, target_h: int, target_w: int) -> torch.Tensor:
        rgb = rgb_raw.float() / 255.0
        rgb = F.interpolate(rgb, size=(224, 224), mode="bilinear", align_corners=False)
        patches = rgb.unfold(2, 16, 16).unfold(3, 16, 16)
        patch_mean = patches.mean(dim=(-1, -2))
        patch_std = patches.std(dim=(-1, -2))
        feat = torch.cat([patch_mean, patch_std], dim=1)
        flat = feat.flatten(2).transpose(1, 2)
        centroid = flat.mean(dim=1, keepdim=True)
        dist = torch.norm(flat - centroid, dim=-1)
        dist = dist.view(rgb.shape[0], 1, 14, 14)
        dist = F.interpolate(dist, size=(target_h, target_w), mode="bilinear", align_corners=False)
        return minmax_norm_tensor(dist)

    def forward(self, rgb_raw: torch.Tensor, target_h: int, target_w: int) -> torch.Tensor:
        result = self._forward_timm(rgb_raw, target_h, target_w)
        if result is not None:
            return result
        return self._forward_fallback(rgb_raw, target_h, target_w)


srm_extractor = SRMExtractor().to(GPU_FEATURE_DEVICE).eval()
noiseprint_extractor = NoiseprintExtractor().to(GPU_FEATURE_DEVICE).eval()
dino_extractor = DinoViTExtractor(cfg.dino_model_name, GPU_FEATURE_DEVICE).eval()


# =============================================================================
# CELL 08 - Dataset And Augmentations
# =============================================================================
def build_rgb_aug() -> A.Compose:
    return A.Compose(
        [
            A.OneOf(
                [
                    A.CLAHE(clip_limit=2.0, tile_grid_size=(8, 8), p=1.0),
                    A.Sharpen(alpha=(0.1, 0.25), lightness=(0.8, 1.2), p=1.0),
                    A.GaussianBlur(blur_limit=(3, 5), p=1.0),
                ],
                p=0.30,
            ),
            A.RandomBrightnessContrast(
                brightness_limit=0.12,
                contrast_limit=0.12,
                p=0.35,
            ),
            A.GaussNoise(p=0.15),
        ]
    )


def build_spatial_tf(img_size: int, is_train: bool) -> A.Compose:
    transforms: list[Any] = [A.Resize(img_size, img_size)]
    if is_train:
        transforms.extend(
            [
                A.HorizontalFlip(p=0.5),
                A.VerticalFlip(p=0.10),
                A.Affine(
                    scale=(0.97, 1.03),
                    translate_percent=(-0.02, 0.02),
                    rotate=(-8, 8),
                    shear=(-3, 3),
                    p=0.30,
                ),
                A.Perspective(scale=(0.02, 0.05), p=0.15),
                A.GridDistortion(num_steps=5, distort_limit=0.10, p=0.10),
            ]
        )
    transforms.append(ToTensorV2())
    return A.Compose(transforms)


class DocTamperDataset(Dataset):
    def __init__(
        self,
        info: LMDBInfo,
        indices: list[int],
        img_size: int,
        is_train: bool,
    ) -> None:
        self.info = info
        self.indices = list(indices)
        self.img_size = img_size
        self.is_train = is_train
        self.rgb_aug = build_rgb_aug() if is_train else None
        self.spatial_tf = build_spatial_tf(img_size=img_size, is_train=is_train)
        self.env: lmdb.Environment | None = None

    def __len__(self) -> int:
        return len(self.indices)

    def _open(self) -> None:
        if self.env is None:
            self.env = open_lmdb(self.info.path)

    def __getitem__(self, position: int) -> tuple[torch.Tensor, torch.Tensor]:
        self._open()
        assert self.env is not None
        index = self.indices[position]

        with self.env.begin(write=False) as txn:
            img_bytes = txn.get(image_key(index))
            mask_bytes = txn.get(label_key(index))

        if img_bytes is None or mask_bytes is None:
            raise KeyError(f"Missing sample index {index} in {self.info.path}")

        img_pil = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        mask_pil = Image.open(io.BytesIO(mask_bytes)).convert("L")

        img_np = np.array(img_pil, dtype=np.uint8)
        mask_np = (np.array(mask_pil, dtype=np.float32) > 127).astype(np.float32)

        if self.rgb_aug is not None:
            img_np = self.rgb_aug(image=img_np)["image"]

        ela = compute_ela(Image.fromarray(img_np))
        lap = compute_laplacian(img_np)
        ocr = compute_ocr_proxy(img_np)
        ocr3 = np.stack([ocr, ocr, ocr], axis=2)

        img_12 = np.concatenate([img_np, ela, lap, ocr3], axis=2)
        augmented = self.spatial_tf(image=img_12, mask=mask_np)

        img_12_tensor = augmented["image"].float()
        mask_tensor = augmented["mask"].unsqueeze(0).float()

        img_10_tensor = torch.cat([img_12_tensor[:9], img_12_tensor[9:10]], dim=0)
        return img_10_tensor, mask_tensor


def build_loader(dataset: Dataset, batch_size: int, shuffle: bool, drop_last: bool) -> DataLoader:
    loader_kwargs: dict[str, Any] = {
        "dataset": dataset,
        "batch_size": batch_size,
        "shuffle": shuffle,
        "drop_last": drop_last,
        "num_workers": cfg.num_workers,
        "pin_memory": cfg.pin_memory and DEVICE == "cuda",
        "persistent_workers": cfg.num_workers > 0,
    }
    if cfg.num_workers > 0:
        loader_kwargs["prefetch_factor"] = 2
    return DataLoader(**loader_kwargs)


# =============================================================================
# CELL 09 - 13 Channel Tensor Assembly
# =============================================================================
CHANNEL_MEAN = torch.tensor(
    [
        123.675, 116.28, 103.53,
        127.5, 127.5, 127.5,
        127.5, 127.5, 127.5,
        127.5,
        127.5,
        127.5,
        127.5,
    ],
    dtype=torch.float32,
).view(1, 13, 1, 1)

CHANNEL_STD = torch.tensor(
    [
        58.395, 57.12, 57.375,
        64.0, 64.0, 64.0,
        64.0, 64.0, 64.0,
        64.0,
        64.0,
        64.0,
        64.0,
    ],
    dtype=torch.float32,
).view(1, 13, 1, 1)


def stochastic_forensic_dropout(imgs_13: torch.Tensor, probability: float) -> torch.Tensor:
    if probability <= 0.0:
        return imgs_13

    groups = [slice(3, 6), slice(6, 9), slice(9, 10), slice(10, 11), slice(11, 12), slice(12, 13)]
    for batch_index in range(imgs_13.shape[0]):
        if random.random() < probability:
            group = random.choice(groups)
            imgs_13[batch_index : batch_index + 1, group] = 0.0
    return imgs_13


def assemble_gpu_channels(imgs_10: torch.Tensor, is_train: bool) -> torch.Tensor:
    rgb = imgs_10[:, 0:3]
    _, _, height, width = imgs_10.shape

    with torch.no_grad():
        srm = srm_extractor(rgb).float() * 255.0
        noiseprint = noiseprint_extractor(rgb).float() * 255.0
        dino = dino_extractor(rgb, target_h=height, target_w=width).float() * 255.0

    imgs_13 = torch.cat([imgs_10, srm, noiseprint, dino], dim=1)
    if is_train:
        imgs_13 = stochastic_forensic_dropout(imgs_13, cfg.forensic_channel_dropout_p)
    return imgs_13


def normalise(imgs_13: torch.Tensor) -> torch.Tensor:
    mean = CHANNEL_MEAN.to(imgs_13.device)
    std = CHANNEL_STD.to(imgs_13.device)
    return (imgs_13 - mean) / (std + 1e-6)


# =============================================================================
# CELL 10 - Model, EMA, Losses, Metrics
# =============================================================================
def build_model(config: CFG) -> nn.Module:
    model = smp.Unet(
        encoder_name=config.encoder_name,
        encoder_weights="imagenet",
        in_channels=13,
        classes=1,
        activation=None,
    )
    if GPU_COUNT > 1:
        model = nn.DataParallel(model)
    return model.to(DEVICE)


class ModelEMA:
    def __init__(self, model: nn.Module, decay: float) -> None:
        self.decay = decay
        self.ema = deepcopy(unwrap_model(model)).eval().to(DEVICE)
        for param in self.ema.parameters():
            param.requires_grad_(False)

    @torch.no_grad()
    def update(self, model: nn.Module) -> None:
        ema_state = self.ema.state_dict()
        model_state = unwrap_model(model).state_dict()
        for key, value in ema_state.items():
            model_value = model_state[key].detach()
            if value.dtype.is_floating_point:
                value.mul_(self.decay).add_(model_value, alpha=(1.0 - self.decay))
            else:
                value.copy_(model_value)


class BoundaryLoss(nn.Module):
    def __init__(self, kernel_size: int = 5) -> None:
        super().__init__()
        self.pool = nn.MaxPool2d(kernel_size, stride=1, padding=kernel_size // 2)

    def forward(self, logits: torch.Tensor, masks: torch.Tensor) -> torch.Tensor:
        dilated = self.pool(masks)
        eroded = 1.0 - self.pool(1.0 - masks)
        boundary = (dilated - eroded).clamp(0, 1)
        loss = F.binary_cross_entropy_with_logits(
            logits * boundary,
            masks * boundary,
            reduction="sum",
        )
        return loss / (boundary.sum() + 1e-6)


dice_loss = smp.losses.DiceLoss(mode="binary")
focal_loss = smp.losses.FocalLoss(mode="binary", gamma=2.0)
bce_loss = smp.losses.SoftBCEWithLogitsLoss(
    pos_weight=torch.tensor([cfg.mask_positive_weight], device=DEVICE)
)
boundary_loss = BoundaryLoss().to(DEVICE)


def loss_fn(logits: torch.Tensor, masks: torch.Tensor) -> torch.Tensor:
    return (
        0.40 * dice_loss(logits, masks)
        + 0.25 * focal_loss(logits, masks)
        + 0.20 * bce_loss(logits, masks)
        + 0.15 * boundary_loss(logits, masks)
    )


def compute_metrics(logits: torch.Tensor, masks: torch.Tensor) -> dict[str, float]:
    probs = torch.sigmoid(logits)
    preds = probs > 0.5
    masks_bool = masks > 0.5

    tp = (preds & masks_bool).float().sum((1, 2, 3))
    fp = (preds & ~masks_bool).float().sum((1, 2, 3))
    fn = (~preds & masks_bool).float().sum((1, 2, 3))

    iou = (tp / (tp + fp + fn + 1e-6)).mean().item()
    f1 = (2 * tp / (2 * tp + fp + fn + 1e-6)).mean().item()
    precision = (tp / (tp + fp + 1e-6)).mean().item()
    recall = (tp / (tp + fn + 1e-6)).mean().item()

    return {
        "iou": float(iou),
        "f1": float(f1),
        "precision": float(precision),
        "recall": float(recall),
    }


def tta_predict(model: nn.Module, imgs_13_norm: torch.Tensor) -> torch.Tensor:
    with torch.no_grad():
        p1 = torch.sigmoid(model(imgs_13_norm))
        p2 = torch.flip(torch.sigmoid(model(torch.flip(imgs_13_norm, dims=[-1]))), dims=[-1])
        p3 = torch.flip(torch.sigmoid(model(torch.flip(imgs_13_norm, dims=[-2]))), dims=[-2])
    return (p1 + p2 + p3) / 3.0


model = build_model(cfg)
ema = ModelEMA(model, decay=cfg.ema_decay)
scaler = torch.amp.GradScaler("cuda", enabled=(DEVICE == "cuda"))

print("Model encoder:", cfg.encoder_name)
print("Model parameters:", sum(p.numel() for p in unwrap_model(model).parameters()))


# =============================================================================
# CELL 11 - Training And Validation Utilities
# =============================================================================
def build_stage_scheduler(
    optimizer: torch.optim.Optimizer,
    stage: TrainStage,
    optimizer_steps_per_epoch: int,
) -> SequentialLR:
    total_steps = max(1, optimizer_steps_per_epoch * stage.epochs)
    warmup_steps = min(optimizer_steps_per_epoch, max(25, total_steps // 10))
    warmup = LinearLR(
        optimizer,
        start_factor=0.15,
        end_factor=1.0,
        total_iters=warmup_steps,
    )
    cosine = CosineAnnealingLR(
        optimizer,
        T_max=max(1, total_steps - warmup_steps),
        eta_min=stage.lr * 0.05,
    )
    return SequentialLR(
        optimizer,
        schedulers=[warmup, cosine],
        milestones=[warmup_steps],
    )


def train_one_epoch(
    model: nn.Module,
    ema: ModelEMA,
    loader: DataLoader,
    optimizer: torch.optim.Optimizer,
    scheduler: SequentialLR,
    epoch_label: str,
) -> dict[str, float]:
    model.train()
    optimizer.zero_grad(set_to_none=True)

    total_loss = 0.0
    total_metrics = defaultdict(float)
    total_batches = 0

    for batch_idx, (imgs_10, masks) in enumerate(loader, start=1):
        imgs_10 = imgs_10.to(GPU_FEATURE_DEVICE, non_blocking=(DEVICE == "cuda"))
        masks = masks.to(DEVICE, non_blocking=(DEVICE == "cuda"))

        imgs_13 = assemble_gpu_channels(imgs_10, is_train=True)
        imgs_13 = normalise(imgs_13)

        with autocast_context():
            logits = model(imgs_13)
            loss = loss_fn(logits, masks) / cfg.grad_accum_steps

        scaler.scale(loss).backward()

        should_step = batch_idx % cfg.grad_accum_steps == 0 or batch_idx == len(loader)
        if should_step:
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=cfg.grad_clip_norm)
            scaler.step(optimizer)
            scaler.update()
            optimizer.zero_grad(set_to_none=True)
            scheduler.step()
            ema.update(model)

        batch_metrics = compute_metrics(logits.detach(), masks)
        total_loss += float(loss.item() * cfg.grad_accum_steps)
        for key, value in batch_metrics.items():
            total_metrics[key] += value
        total_batches += 1

        if batch_idx % 100 == 0 or batch_idx == len(loader):
            current_lr = optimizer.param_groups[0]["lr"]
            print(
                f"[train {epoch_label}] batch {batch_idx:04d}/{len(loader):04d} "
                f"loss={total_loss / total_batches:.4f} lr={current_lr:.2e}"
            )

    output = {"loss": total_loss / max(1, total_batches)}
    output.update({key: value / max(1, total_batches) for key, value in total_metrics.items()})
    return output


def validate_one_epoch(
    eval_model: nn.Module,
    loader: DataLoader,
    epoch_label: str,
    use_tta: bool,
) -> dict[str, float]:
    eval_model.eval()
    total_loss = 0.0
    total_metrics = defaultdict(float)
    total_batches = 0

    with torch.no_grad():
        for batch_idx, (imgs_10, masks) in enumerate(loader, start=1):
            imgs_10 = imgs_10.to(GPU_FEATURE_DEVICE, non_blocking=(DEVICE == "cuda"))
            masks = masks.to(DEVICE, non_blocking=(DEVICE == "cuda"))

            imgs_13 = assemble_gpu_channels(imgs_10, is_train=False)
            imgs_13 = normalise(imgs_13)

            with autocast_context():
                logits = eval_model(imgs_13)
                loss = loss_fn(logits, masks)

            if use_tta:
                probs = tta_predict(eval_model, imgs_13)
                logits_for_metrics = torch.logit(probs.clamp(1e-4, 1.0 - 1e-4))
            else:
                logits_for_metrics = logits

            batch_metrics = compute_metrics(logits_for_metrics, masks)
            total_loss += float(loss.item())
            for key, value in batch_metrics.items():
                total_metrics[key] += value
            total_batches += 1

            if batch_idx % 100 == 0 or batch_idx == len(loader):
                print(
                    f"[valid {epoch_label}] batch {batch_idx:04d}/{len(loader):04d} "
                    f"loss={total_loss / total_batches:.4f}"
                )

    output = {"loss": total_loss / max(1, total_batches)}
    output.update({key: value / max(1, total_batches) for key, value in total_metrics.items()})
    return output


def save_best_checkpoint(
    model: nn.Module,
    ema: ModelEMA,
    best_state: dict[str, Any],
) -> None:
    export_model = ema.ema if ema is not None else unwrap_model(model)
    state_dict = {key: value.detach().cpu() for key, value in export_model.state_dict().items()}
    torch.save(state_dict, SAVE_DIR / "forgery_best.pth")

    metadata = {
        "architecture": "smp.Unet",
        "encoder_name": cfg.encoder_name,
        "in_channels": 13,
        "classes": 1,
        "recommended_inference_size": best_state["img_size"],
        "best_stage": best_state["stage_name"],
        "best_global_epoch": best_state["global_epoch"],
        "best_metrics": best_state["metrics"],
        "channel_layout": {
            "0-2": "rgb",
            "3-5": "ela",
            "6-8": "laplacian",
            "9": "ocr_proxy",
            "10": "srm",
            "11": "noiseprint",
            "12": "dino_anomaly",
        },
        "stages": [asdict(stage) for stage in cfg.stages],
    }
    (SAVE_DIR / "forgery_best_meta.json").write_text(
        json.dumps(metadata, indent=2),
        encoding="utf-8",
    )


def save_history(history: list[dict[str, Any]]) -> None:
    (SAVE_DIR / "history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")


# =============================================================================
# CELL 12 - Build Stage Loaders
# =============================================================================
def build_stage_loaders(stage: TrainStage) -> tuple[DataLoader, DataLoader]:
    train_dataset = DocTamperDataset(
        info=train_info,
        indices=train_indices,
        img_size=stage.img_size,
        is_train=True,
    )
    actual_val_info = val_info if val_info is not None else train_info
    val_dataset = DocTamperDataset(
        info=actual_val_info,
        indices=val_indices,
        img_size=stage.img_size,
        is_train=False,
    )

    train_loader = build_loader(
        dataset=train_dataset,
        batch_size=cfg.batch_size,
        shuffle=True,
        drop_last=True,
    )
    val_loader = build_loader(
        dataset=val_dataset,
        batch_size=cfg.batch_size,
        shuffle=False,
        drop_last=False,
    )
    return train_loader, val_loader


# =============================================================================
# CELL 13 - Main Training Loop
# =============================================================================
history: list[dict[str, Any]] = []
best_f1 = 0.0
global_epoch = 0
start_time = time.time()

best_state = {
    "stage_name": None,
    "img_size": None,
    "global_epoch": None,
    "metrics": None,
}

for stage_index, stage in enumerate(cfg.stages, start=1):
    elapsed_hours = (time.time() - start_time) / 3600.0
    if elapsed_hours >= cfg.max_hours:
        print(f"Stopping before {stage.name} because time budget reached.")
        break

    print("\n" + "=" * 80)
    print(f"Starting {stage.name} | img_size={stage.img_size} | epochs={stage.epochs} | lr={stage.lr:.2e}")
    print("=" * 80)

    train_loader, val_loader = build_stage_loaders(stage)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=stage.lr,
        weight_decay=cfg.weight_decay,
    )
    optimizer_steps_per_epoch = max(1, math.ceil(len(train_loader) / cfg.grad_accum_steps))
    scheduler = build_stage_scheduler(optimizer, stage, optimizer_steps_per_epoch)
    stage_epochs_no_improve = 0

    for local_epoch in range(1, stage.epochs + 1):
        elapsed_hours = (time.time() - start_time) / 3600.0
        if elapsed_hours >= cfg.max_hours:
            print(f"Stopping inside {stage.name} because time budget reached.")
            break

        global_epoch += 1
        epoch_label = f"{stage.name} | epoch {local_epoch}/{stage.epochs} | global {global_epoch}"
        train_stats = train_one_epoch(model, ema, train_loader, optimizer, scheduler, epoch_label)

        remaining_planned_epochs = sum(s.epochs for s in cfg.stages) - global_epoch
        use_tta = remaining_planned_epochs < cfg.use_tta_last_n_epochs
        eval_model = ema.ema
        val_stats = validate_one_epoch(eval_model, val_loader, epoch_label, use_tta=use_tta)

        elapsed_hours = (time.time() - start_time) / 3600.0
        record = {
            "stage": stage.name,
            "img_size": stage.img_size,
            "local_epoch": local_epoch,
            "global_epoch": global_epoch,
            "elapsed_hours": round(elapsed_hours, 3),
            "train": train_stats,
            "valid": val_stats,
            "use_tta": use_tta,
            "lr": float(optimizer.param_groups[0]["lr"]),
        }
        history.append(record)
        save_history(history)

        print(
            f"[{stage.name}] epoch {local_epoch}/{stage.epochs} | "
            f"train_loss={train_stats['loss']:.4f} val_loss={val_stats['loss']:.4f} | "
            f"val_iou={val_stats['iou']:.4f} val_f1={val_stats['f1']:.4f} "
            f"val_p={val_stats['precision']:.4f} val_r={val_stats['recall']:.4f} | "
            f"elapsed={elapsed_hours:.2f}h"
        )

        if val_stats["f1"] > best_f1:
            best_f1 = val_stats["f1"]
            stage_epochs_no_improve = 0
            best_state = {
                "stage_name": stage.name,
                "img_size": stage.img_size,
                "global_epoch": global_epoch,
                "metrics": val_stats,
            }
            save_best_checkpoint(model, ema, best_state)
            print(f"New best checkpoint saved. best_f1={best_f1:.4f}")
        else:
            stage_epochs_no_improve += 1
            print(f"No improvement for {stage_epochs_no_improve} epoch(s) in {stage.name}.")

        torch.cuda.empty_cache()

        if stage_epochs_no_improve >= cfg.patience:
            print(f"Early stopping {stage.name} after patience={cfg.patience}.")
            break

print("\nTraining complete.")
print("Best F1:", best_f1)
print("Best state:", json.dumps(best_state, indent=2))
print("Artifacts saved under:", SAVE_DIR)


# =============================================================================
# CELL 14 - Deployment Notes
# =============================================================================
#
# After training:
# - Download /kaggle/working/advanced_docforgery/forgery_best.pth
# - Download /kaggle/working/advanced_docforgery/forgery_best_meta.json
#
# Backend settings to update if you use the new checkpoint:
# - CHECKPOINT_PATH=./forgery_best.pth
# - INFERENCE_SIZE=<recommended_inference_size from meta json>
#
# Current backend loader already supports:
# - efficientnet-b3:13
# - efficientnet-b4:13
#
