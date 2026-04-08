#!/usr/bin/env python3
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  DocTamper — LOCAL L4 GPU TRAINING  |  High-Accuracy Version               ║
# ║  Techniques: ELA · SRM · Noiseprint · DINO-ViT · OCR-proxy · P-Hash        ║
# ║  F1 Target: >80%  |  Output: ./output/forgery_best.pth                     ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

import os, io, gc, sys, json, random, time, warnings
import numpy as np
import cv2
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.nn.parallel import DataParallel
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from torch.optim.lr_scheduler import LinearLR, CosineAnnealingLR, SequentialLR
from pathlib import Path
from PIL import Image
import lmdb
import imagehash
import timm
import albumentations as A
from albumentations.pytorch import ToTensorV2
import segmentation_models_pytorch as smp


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

warnings.filterwarnings("ignore")


def _env_flag(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_path(name, default=None):
    raw = os.getenv(name, default if default is not None else "")
    raw = raw.strip() if raw is not None else ""
    if raw.lower() in {"", "none", "off", "0"}:
        return None
    return Path(raw)


FORCE_DETERMINISTIC = _env_flag("FORCE_DETERMINISTIC", False)
torch.backends.cudnn.benchmark = not FORCE_DETERMINISTIC
torch.backends.cudnn.deterministic = FORCE_DETERMINISTIC
if hasattr(torch, "set_float32_matmul_precision"):
    torch.set_float32_matmul_precision("high")

# ══════════════════════════════════════════════════════════════════════════════
#  PATHS
# ══════════════════════════════════════════════════════════════════════════════

DATA_ROOT  = Path(os.getenv("DATA_ROOT", "./dinmkeljiame/doctamper/versions/1"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "./output_new"))
CACHE_DIR  = _env_path("CACHE_DIR", "./feature_cache")
RESUME_CHECKPOINT = _env_path("RESUME_CHECKPOINT")

# ══════════════════════════════════════════════════════════════════════════════
#  CONFIG  — CRITICAL FIXES HERE
# ══════════════════════════════════════════════════════════════════════════════

# Set to 0 means "use all available" via auto-detection in main().
TRAIN_SAMPLES = int(os.getenv("TRAIN_SAMPLES", "0"))
VAL_SAMPLES   = int(os.getenv("VAL_SAMPLES", "6000"))
EPOCHS        = int(os.getenv("EPOCHS", "40"))
BATCH         = int(os.getenv("BATCH", "12"))
GRAD_ACC      = int(os.getenv("GRAD_ACC", "4"))
IMG_SIZE      = int(os.getenv("IMG_SIZE", "512"))
LR            = float(os.getenv("LR", "3e-4"))
WEIGHT_DECAY  = float(os.getenv("WEIGHT_DECAY", "1e-4"))
PATIENCE      = int(os.getenv("PATIENCE", "10"))
N_CH          = 13         # RGB + ELA + Lap + OCR + DCT + fused(SRM,DINO) + Noiseprint
ENCODER       = os.getenv("ENCODER", "mit_b5")
NUM_WORKERS   = int(os.getenv("NUM_WORKERS", str(max(2, min(8, os.cpu_count() or 4)))))
SAVE_EVERY    = int(os.getenv("SAVE_EVERY", "5"))
P_HASH_SAMPLE_N = int(os.getenv("PHASH_SAMPLE_N", "15000"))
P_HASH_THRESHOLD = int(os.getenv("PHASH_THRESHOLD", "8"))
SEED          = int(os.getenv("SEED", "1337"))

# Threshold tuning — will be optimized on validation set
BEST_THRESHOLD = 0.5       # Updated dynamically during training

# ══════════════════════════════════════════════════════════════════════════════
#  CPU FEATURE FUNCTIONS
# ══════════════════════════════════════════════════════════════════════════════

def compute_ela_multi(img_pil):
    """
    Enhanced ELA: use multiple JPEG quality levels and stack differences.
    This catches more compression artifacts at different quality levels.
    """
    results = []
    orig = np.array(img_pil.convert("RGB"), dtype=np.float32)

    # Multi-quality ELA (original used only q=90)
    for quality in [90, 75, 65]:
        buf = io.BytesIO()
        img_pil.save(buf, "JPEG", quality=quality)
        buf.seek(0)
        comp = np.array(Image.open(buf).convert("RGB"), dtype=np.float32)
        diff = np.abs(orig - comp)
        # Scale each channel independently for better dynamic range
        diff_norm = (diff * 255.0 / (diff.max() + 1e-6)).astype(np.uint8)
        results.append(diff_norm)

    # Average all quality levels so training matches backend inference.
    ela_avg = np.mean(np.stack(results, axis=0), axis=0).astype(np.uint8)
    return ela_avg


def compute_ela_amplified(img_pil, quality=90, amplify=15):
    """
    Amplified single-quality ELA for better visibility of subtle forgeries.
    """
    buf = io.BytesIO()
    img_pil.save(buf, "JPEG", quality=quality)
    buf.seek(0)
    comp = np.array(Image.open(buf).convert("RGB"), dtype=np.float32)
    orig = np.array(img_pil.convert("RGB"), dtype=np.float32)
    diff = np.abs(orig - comp)
    # Amplify differences more aggressively
    diff_amplified = np.clip(diff * amplify, 0, 255).astype(np.uint8)
    return diff_amplified


def compute_laplacian(img_np):
    """Multi-scale Laplacian for noise inconsistency detection."""
    gray   = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY).astype(np.float32)
    fine   = np.abs(cv2.Laplacian(gray, cv2.CV_32F, ksize=1))
    blur3  = cv2.GaussianBlur(gray, (3, 3), 0)
    medium = np.abs(cv2.Laplacian(blur3, cv2.CV_32F, ksize=3))
    blur5  = cv2.GaussianBlur(gray, (5, 5), 0)
    coarse = np.abs(cv2.Laplacian(blur5, cv2.CV_32F, ksize=5))
    lap    = np.stack([fine, medium, coarse], axis=2)
    return (lap / (lap.max() + 1e-6) * 255).astype(np.uint8)


def compute_ocr_proxy(img_np):
    """Text region detection proxy using morphological gradients."""
    gray     = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
    kern     = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    grad     = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, kern)
    h_kern   = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 3))
    text_map = cv2.morphologyEx(grad, cv2.MORPH_CLOSE, h_kern)
    return text_map


def compute_dct_residual(img_np):
    """
    NEW: DCT block residual — reveals JPEG block boundaries in tampered regions.
    Document forgeries often show DCT grid artifacts at splice boundaries.
    """
    gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY).astype(np.float32)
    h, w = gray.shape
    # Pad to multiple of 8 (DCT block size)
    ph = ((h + 7) // 8) * 8
    pw = ((w + 7) // 8) * 8
    padded = np.pad(gray, ((0, ph-h), (0, pw-w)), mode='reflect')

    # Compute local variance in 8x8 blocks
    block_var = np.zeros_like(gray)
    for i in range(0, h, 8):
        for j in range(0, w, 8):
            block = padded[i:i+8, j:j+8]
            var   = np.var(block)
            ei    = min(i+8, h)
            ej    = min(j+8, w)
            block_var[i:ei, j:ej] = var

    # High-pass filter to show block boundaries
    blur        = cv2.GaussianBlur(block_var, (9, 9), 0)
    residual    = np.abs(block_var - blur)
    residual    = (residual / (residual.max() + 1e-6) * 255).astype(np.uint8)
    return residual


# ── Augmentation pipelines ────────────────────────────────────────────────────

_rgb_aug = A.Compose([
    A.CLAHE(clip_limit=3.0, p=0.35),
    A.Sharpen(alpha=(0.15, 0.4), p=0.35),
    A.ColorJitter(brightness=0.1, contrast=0.1,
                  saturation=0.1, hue=0.05, p=0.3),
    # NEW: simulate JPEG re-compression artifacts (common in forgeries)
    A.ImageCompression(quality_lower=70, quality_upper=95, p=0.3),
])

_spatial_train = A.Compose([
    A.Resize(IMG_SIZE, IMG_SIZE),
    A.HorizontalFlip(p=0.5),
    A.VerticalFlip(p=0.25),
    A.RandomBrightnessContrast(brightness_limit=0.2,
                               contrast_limit=0.2, p=0.5),
    A.GaussNoise(p=0.35),
    A.Rotate(limit=20, p=0.4),
    A.ElasticTransform(alpha=1, sigma=50, p=0.25),
    A.GridDistortion(num_steps=5, distort_limit=0.3, p=0.25),
    A.CoarseDropout(
        num_holes_range=(1, 8),
        hole_height_range=(8, 48),
        hole_width_range=(8, 48),
        p=0.25,
    ),
    A.RandomScale(scale_limit=0.15, p=0.3),
    # NEW: simulate print/scan artifacts in document images
    A.Blur(blur_limit=(3, 5), p=0.2),
    A.MedianBlur(blur_limit=3, p=0.15),
    A.PadIfNeeded(IMG_SIZE, IMG_SIZE,
                  border_mode=cv2.BORDER_REFLECT),
    A.CenterCrop(IMG_SIZE, IMG_SIZE),
    ToTensorV2(),
])

_spatial_val = A.Compose([
    A.Resize(IMG_SIZE, IMG_SIZE),
    ToTensorV2(),
])


# ══════════════════════════════════════════════════════════════════════════════
#  DATASET
# ══════════════════════════════════════════════════════════════════════════════

class DocTamperDataset(Dataset):
    def __init__(self, lmdb_path, indices, spatial_tf,
                 is_train=False, cache_dir=None, split_name="train"):
        self.lmdb_path = str(lmdb_path)
        self.indices   = indices
        self.spatial_tf= spatial_tf
        self.is_train  = is_train
        self.split_name = split_name
        self.cache_dir = (Path(cache_dir) / split_name) if cache_dir else None
        if self.cache_dir is not None:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.env       = None  # lazy open per worker

    def _open(self):
        if self.env is None:
            self.env = lmdb.open(
                self.lmdb_path, readonly=True,
                lock=False, meminit=False, readahead=False)

    def __len__(self):
        return len(self.indices)

    def _compute_features(self, img_pil, img_np):
        """
        Compute all CPU-side forensic features.
        Output: 11 CPU channels. GPU appends 2 more channels later.

        Final channel layout after gpu_features():
          0-2  : RGB
          3-5  : ELA (multi-quality average)
          6-8  : Laplacian (3-scale)
          9    : OCR proxy
          10   : DCT residual
          11   : fused max(SRM, DINO)
          12   : Noiseprint
        """
        if self.is_train:
            aug    = _rgb_aug(image=img_np)
            img_np = aug["image"]
            img_pil= Image.fromarray(img_np)

        ela   = compute_ela_multi(img_pil)      # (H,W,3) uint8
        lap   = compute_laplacian(img_np)       # (H,W,3) uint8
        ocr   = compute_ocr_proxy(img_np)       # (H,W)   uint8
        dct   = compute_dct_residual(img_np)    # (H,W)   uint8  NEW

        # Stack into 11-channel array: RGB + ELA + Lap + OCR + DCT
        img_11_np = np.concatenate([
            img_np,                             # ch 0-2
            ela,                                # ch 3-5
            lap,                                # ch 6-8
            ocr[:, :, np.newaxis],              # ch 9
            dct[:, :, np.newaxis],              # ch 10  NEW
        ], axis=2)  # shape (H,W,11)

        return img_11_np

    def __getitem__(self, idx):
        self._open()
        i = self.indices[idx]

        with self.env.begin(write=False) as txn:
            img_b = txn.get(f"image-{i:09d}".encode())
            msk_b = txn.get(f"label-{i:09d}".encode())

        img_pil = Image.open(io.BytesIO(img_b)).convert("RGB")
        msk_pil = Image.open(io.BytesIO(msk_b)).convert("L")
        img_np  = np.array(img_pil)
        msk_np  = (np.array(msk_pil) > 127).astype(np.float32)

        # ── Feature caching (speeds up repeat epochs 2×-4×) ──────────────
        if self.cache_dir is not None:
            cache_file = self.cache_dir / f"{i:09d}.npy"
            if cache_file.exists():
                try:
                    img_11_np = np.load(str(cache_file))
                except Exception:
                    img_11_np = self._compute_features(img_pil, img_np)
                    np.save(str(cache_file), img_11_np)
            else:
                img_11_np = self._compute_features(img_pil, img_np)
                np.save(str(cache_file), img_11_np)
        else:
            img_11_np = self._compute_features(img_pil, img_np)

        # ── Spatial augmentation (applied to all channels + mask jointly) ─
        if self.spatial_tf:
            aug      = self.spatial_tf(image=img_11_np, mask=msk_np)
            img_11_np= aug["image"]   # ToTensorV2 → (C,H,W) tensor
            msk_np   = aug["mask"]
        
        # img_11_np is now a torch tensor of shape (11, H, W) after ToTensorV2
        # We return 11 CPU channels; GPU adds SRM(1)+NP(1)+DINO(1) = 13 total
        return img_11_np.float(), msk_np.unsqueeze(0).float()


# ══════════════════════════════════════════════════════════════════════════════
#  GPU EXTRACTORS
# ══════════════════════════════════════════════════════════════════════════════

class SRMExtractor(nn.Module):
    """
    Steganalysis Rich Model filters — detect noise residuals from tampering.
    """
    def __init__(self):
        super().__init__()
        k1 = np.array([[0,0,0,0,0],[0,-1,2,-1,0],[0,2,-4,2,0],
                        [0,-1,2,-1,0],[0,0,0,0,0]], np.float32) / 4.
        k2 = np.array([[-1,2,-2,2,-1],[2,-6,8,-6,2],[-2,8,-12,8,-2],
                        [2,-6,8,-6,2],[-1,2,-2,2,-1]], np.float32) / 12.
        k3 = np.array([[0,0,0,0,0],[0,0,0,0,0],[0,1,-2,1,0],
                        [0,0,0,0,0],[0,0,0,0,0]], np.float32) / 2.
        k4 = np.array([[0,0,0,0,0],[0,0,1,0,0],[0,1,-4,1,0],
                        [0,0,1,0,0],[0,0,0,0,0]], np.float32)
        k5 = np.array([[1,-2,1,0,0],[-2,4,-2,0,0],[1,-2,1,0,0],
                        [0,0,0,0,0],[0,0,0,0,0]], np.float32) / 4.
        kernels = np.stack([k1,k2,k3,k4,k5], axis=0)[:, np.newaxis]
        self.register_buffer("kernels", torch.tensor(kernels))

    @torch.no_grad()
    def forward(self, rgb):
        gray = (0.299*rgb[:,0]+0.587*rgb[:,1]+0.114*rgb[:,2]).unsqueeze(1)/255.
        out  = F.conv2d(gray.float(), self.kernels.float(), padding=2)
        srm  = out.abs().mean(dim=1, keepdim=True)
        return srm / (srm.amax(dim=(2,3), keepdim=True) + 1e-6)


class NoiseprintExtractor(nn.Module):
    """Camera fingerprint residual — inconsistencies reveal copy-paste."""
    def __init__(self, sigma=1.0):
        super().__init__()
        k   = 5
        x   = torch.arange(k).float() - k // 2
        g1d = torch.exp(-x**2 / (2*sigma**2))
        g2d = torch.outer(g1d, g1d)
        g2d = g2d / g2d.sum()
        self.register_buffer("kernel", g2d.unsqueeze(0).unsqueeze(0))

    @torch.no_grad()
    def forward(self, rgb):
        gray     = (0.299*rgb[:,0]+0.587*rgb[:,1]+0.114*rgb[:,2]).unsqueeze(1)/255.
        smooth   = F.conv2d(gray.float(), self.kernel.float(), padding=2)
        residual = (gray - smooth).abs()
        return residual / (residual.amax(dim=(2,3), keepdim=True) + 1e-6)


class DinoViTExtractor(nn.Module):
    """
    DINO-ViT self-attention maps highlight semantically inconsistent regions.
    Tampered text/logos/stamps often show attention anomalies.
    """
    def __init__(self):
        super().__init__()
        loaded = False
        for name in [
            "vit_small_patch14_dinov2.lvd142m",
            "vit_base_patch14_dinov2.lvd142m",
            "vit_small_patch16_224",
            "vit_tiny_patch16_224",
        ]:
            try:
                self.model = timm.create_model(
                    name, pretrained=True, num_classes=0)
                print(f"  ✓ DINO-ViT : {name}")
                loaded = True
                break
            except Exception as e:
                print(f"  ⚠ {name}: {e}")
        if not loaded:
            self.model = timm.create_model(
                "vit_tiny_patch16_224", pretrained=False, num_classes=0)
            print("  ⚠ DINO-ViT : random init")
        for p in self.model.parameters():
            p.requires_grad_(False)
        self.model.eval()
        self.register_buffer("mean",
            torch.tensor([0.485,0.456,0.406]).view(1,3,1,1))
        self.register_buffer("std",
            torch.tensor([0.229,0.224,0.225]).view(1,3,1,1))

    @torch.no_grad()
    def forward(self, rgb, out_h, out_w):
        x = rgb.float() / 255.0
        x = (x - self.mean) / (self.std + 1e-6)
        x = F.interpolate(x, (224,224), mode="bilinear", align_corners=False)
        x = x.to(next(self.model.parameters()).dtype)
        feats = self.model.forward_features(x)
        patches = None
        cls = None
        if isinstance(feats, dict):
            patches = feats.get("x_norm_patchtokens")
            cls = feats.get("x_norm_clstoken")
            if patches is None:
                x_value = feats.get("x")
                if isinstance(x_value, torch.Tensor) and x_value.ndim == 3 and x_value.shape[1] > 1:
                    patches = x_value[:, 1:]
                    cls = x_value[:, :1]
        elif isinstance(feats, torch.Tensor) and feats.ndim == 3 and feats.shape[1] > 1:
            patches = feats[:, 1:]
            cls = feats[:, 0:1]
        if patches is None or cls is None:
            raise RuntimeError("Unsupported DINO feature output from timm model.")
        dist    = torch.norm(patches - cls, dim=-1)
        mn, mx  = dist.amin(1, keepdim=True), dist.amax(1, keepdim=True)
        dist    = (dist - mn) / (mx - mn + 1e-6)
        n       = int(dist.shape[1] ** 0.5)
        dist    = dist.reshape(-1, 1, n, n)
        return F.interpolate(dist, (out_h, out_w),
                             mode="bilinear", align_corners=False)


# ══════════════════════════════════════════════════════════════════════════════
#  ATTENTION GATE  (NEW) — Squeeze-and-Excitation for channel weighting
# ══════════════════════════════════════════════════════════════════════════════

class ChannelAttentionGate(nn.Module):
    """
    Learns which of the 13 input channels are most discriminative.
    Applied before the UNet encoder for better feature selection.
    """
    def __init__(self, in_ch, reduction=4):
        super().__init__()
        self.gate = nn.Sequential(
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(in_ch, in_ch // reduction),
            nn.ReLU(inplace=True),
            nn.Linear(in_ch // reduction, in_ch),
            nn.Sigmoid(),
        )

    def forward(self, x):
        w = self.gate(x).unsqueeze(-1).unsqueeze(-1)
        return x * w


# ══════════════════════════════════════════════════════════════════════════════
#  MODEL WRAPPER  (NEW) — adds channel attention before backbone
# ══════════════════════════════════════════════════════════════════════════════

class ForgeryDetector(nn.Module):
    """
    Wraps SMP segmentation model with a channel-attention gate.
    The gate lets the network learn to upweight informative forensic channels.
    """
    def __init__(self, seg_model, n_ch=13):
        super().__init__()
        self.channel_gate = ChannelAttentionGate(n_ch, reduction=4)
        self.seg_model    = seg_model

    def forward(self, x):
        x = self.channel_gate(x)
        return self.seg_model(x)


# ══════════════════════════════════════════════════════════════════════════════
#  LOSS
# ══════════════════════════════════════════════════════════════════════════════

class BoundaryLoss(nn.Module):
    """
    Focuses loss on tampered region boundaries — critical for document forensics
    where forgeries often have sharp edges from cut-paste operations.
    """
    def __init__(self, k=5):
        super().__init__()
        self.pool = nn.MaxPool2d(k, stride=1, padding=k//2)

    def forward(self, preds, masks):
        dilated  = self.pool(masks)
        eroded   = 1.0 - self.pool(1.0 - masks)
        boundary = (dilated - eroded).clamp(0, 1)
        loss = F.binary_cross_entropy_with_logits(
            preds * boundary, masks * boundary, reduction="sum"
        ) / (boundary.sum() + 1e-6)
        return loss


class TverskyLoss(nn.Module):
    """
    Tversky loss with high beta penalizes false negatives heavily.
    Document forgeries are rare (small positive regions) — recall matters.
    """
    def __init__(self, alpha=0.3, beta=0.7, smooth=1.):
        super().__init__()
        self.alpha = alpha
        self.beta  = beta
        self.smooth= smooth

    def forward(self, preds, masks):
        p  = torch.sigmoid(preds)
        tp = (p * masks).sum()
        fp = (p * (1 - masks)).sum()
        fn = ((1 - p) * masks).sum()
        tv = (tp + self.smooth) / (
            tp + self.alpha*fp + self.beta*fn + self.smooth)
        return 1 - tv


class LovaszSoftmaxLoss(nn.Module):
    """
    Lovász-Softmax: directly optimizes IoU — complementary to Tversky+Dice.
    More robust than pure BCE for highly imbalanced segmentation maps.
    """
    def __init__(self):
        super().__init__()
        # Use SMP's built-in Lovász
        self.loss = smp.losses.LovaszLoss(mode="binary", per_image=True)

    def forward(self, preds, masks):
        return self.loss(preds, masks)


# ══════════════════════════════════════════════════════════════════════════════
#  HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def check_dataset(data_root):
    required = [
        data_root / "DocTamperV1-TrainingSet" / "data.mdb",
        data_root / "DocTamperV1-TestingSet"  / "data.mdb",
    ]
    missing = [p for p in required if not p.exists()]
    if missing:
        print("\n" + "="*60)
        print("  DATASET NOT FOUND")
        print("="*60)
        for p in missing:
            print(f"  Missing: {p}")
        print("\n  Download steps:")
        print("  1. pip install kaggle")
        print("  2. Place kaggle.json in ~/.kaggle/")
        print("  3. kaggle datasets download dinmkeljiame/doctamper")
        print("  4. Unzip into ./")
        sys.exit(1)
    print("✓ Dataset found")


def get_lmdb_size(lmdb_path):
    """
    Auto-detect number of samples in LMDB by binary searching on keys.
    Avoids loading the entire dataset into memory.
    """
    env = lmdb.open(str(lmdb_path), readonly=True,
                    lock=False, meminit=False, readahead=False)
    # Use LMDB stat to get entry count (divide by 2: image+label pairs)
    with env.begin() as txn:
        n_entries = txn.stat()["entries"]
    env.close()
    # Each sample has 2 entries: image + label
    n_samples = n_entries // 2
    print(f"  [LMDB] Auto-detected {n_samples:,} samples in {lmdb_path.name}")
    return n_samples


def phash_deduplicate(lmdb_path, all_indices,
                      sample_n=10_000, threshold=8, seed=42):
    """
    Remove near-duplicate images using perceptual hashing.
    Duplicates inflate validation metrics and cause overfitting.
    """
    print(f"  [P-Hash] Checking {min(sample_n,len(all_indices))} images...")
    rng       = random.Random(seed)
    sampled   = rng.sample(all_indices, min(sample_n, len(all_indices)))
    unsampled = list(set(all_indices) - set(sampled))
    env = lmdb.open(str(lmdb_path), readonly=True,
                    lock=False, meminit=False, readahead=False)
    seen_hashes, unique_idx = [], []
    with env.begin() as txn:
        for idx in sampled:
            val = txn.get(f"image-{idx:09d}".encode())
            if val is None:
                continue
            img = Image.open(io.BytesIO(val)).convert("RGB").resize((64,64))
            h   = imagehash.phash(img, hash_size=8)
            if all(abs(h - s) > threshold for s in seen_hashes):
                seen_hashes.append(h)
                unique_idx.append(idx)
    env.close()
    removed = len(sampled) - len(unique_idx)
    kept    = unique_idx + unsampled
    print(f"  [P-Hash] Removed {removed} duplicates. "
          f"Using {len(kept):,} indices.")
    return kept


# ── Channel normalization statistics ────────────────────────────────────────
# 11 CPU channels + 2 GPU channels (SRM, Noiseprint) + DINO = 13 total
# Updated to reflect new 11-channel CPU output (added DCT at ch10)
_CH_MEAN = torch.tensor([
    # RGB (0-2)
    123.675, 116.28, 103.53,
    # ELA (3-5)
    12.0, 12.0, 12.0,
    # Laplacian (6-8)
    8.0, 8.0, 8.0,
    # OCR proxy (9)
    32.0,
    # DCT residual (10)
    8.0,
    # SRM+DINO fused (11)
    127.5,
    # Noiseprint (12)
    127.5,
], dtype=torch.float32).view(1, N_CH, 1, 1)   # 13 values ✓

_CH_STD = torch.tensor([
    # RGB (0-2)
    58.395, 57.12, 57.375,
    # ELA (3-5)
    20.0, 20.0, 20.0,
    # Laplacian (6-8)
    15.0, 15.0, 15.0,
    # OCR proxy (9)
    48.0,
    # DCT residual (10)
    15.0,
    # SRM+DINO fused (11)
    64.0,
    # Noiseprint (12)
    64.0,
], dtype=torch.float32).view(1, N_CH, 1, 1)   # 13 values ✓


def normalise(t):
    mean = _CH_MEAN.to(t.device)
    std  = _CH_STD.to(t.device)
    return (t - mean) / (std + 1e-6)


def set_seed(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def _model_state_dict(model):
    raw = model.module if hasattr(model, "module") else model
    return raw.state_dict()


def save_training_checkpoint(path, model, optimizer, scheduler, scaler,
                             epoch, best_f1, threshold, history):
    path = Path(path)
    torch.save({
        "state_dict": _model_state_dict(model),
        "optimizer_state_dict": optimizer.state_dict(),
        "scheduler_state_dict": scheduler.state_dict(),
        "scaler_state_dict": scaler.state_dict(),
        "epoch": epoch,
        "f1": best_f1,
        "threshold": threshold,
        "history": history,
        "config": {
            "N_CH": N_CH,
            "IMG_SIZE": IMG_SIZE,
            "ENCODER": ENCODER,
            "DATA_ROOT": str(DATA_ROOT),
            "OUTPUT_DIR": str(OUTPUT_DIR),
            "CACHE_DIR": str(CACHE_DIR) if CACHE_DIR is not None else None,
        },
    }, path)


def load_training_checkpoint(path, model, optimizer=None, scheduler=None, scaler=None):
    ckpt = torch.load(str(path), map_location="cpu")
    if isinstance(ckpt, dict) and "state_dict" in ckpt:
        state_dict = ckpt["state_dict"]
    elif isinstance(ckpt, dict):
        state_dict = ckpt
    else:
        raise RuntimeError(f"Unsupported checkpoint type: {type(ckpt)!r}")

    cleaned = {}
    for key, value in state_dict.items():
        cleaned[key[7:] if key.startswith("module.") else key] = value

    target = model.module if hasattr(model, "module") else model
    target.load_state_dict(cleaned, strict=True)

    start_epoch = 1
    best_f1 = 0.0
    threshold = BEST_THRESHOLD
    history = []

    if isinstance(ckpt, dict):
        start_epoch = int(ckpt.get("epoch", 0)) + 1
        best_f1 = float(ckpt.get("f1", ckpt.get("best_f1", 0.0)))
        threshold = float(ckpt.get("threshold", BEST_THRESHOLD))
        history = ckpt.get("history", [])
        if optimizer is not None and ckpt.get("optimizer_state_dict") is not None:
            optimizer.load_state_dict(ckpt["optimizer_state_dict"])
        if scheduler is not None and ckpt.get("scheduler_state_dict") is not None:
            scheduler.load_state_dict(ckpt["scheduler_state_dict"])
        if scaler is not None and ckpt.get("scaler_state_dict") is not None:
            scaler.load_state_dict(ckpt["scaler_state_dict"])

    return start_epoch, best_f1, threshold, history


def gpu_features(imgs_cpu, device, srm_net, noiseprint, dino_vit):
    """
    Append GPU-computed features (SRM, Noiseprint, DINO) to CPU features.
    
    Input:  imgs_cpu  → (B, 11, H, W) from DataLoader  [CPU channels]
    Output: imgs_13   → (B, 13, H, W)                  [+SRM+NP+DINO]
    
    Channel layout (final 13):
      0-2  : RGB
      3-5  : ELA
      6-8  : Laplacian
      9    : OCR proxy
      10   : DCT residual
      11   : SRM
      12   : Noiseprint
      --- DINO dropped to 12ch? No: we append all 3 ---
    
    Wait: 11 + 3 = 14. We need exactly 13. Solution: drop DCT (redundant
    with SRM for block artifacts) OR merge NP+DINO.
    Decision: Keep DCT, drop standalone DINO channel, fuse DINO into SRM.
    
    REVISED layout (13 channels):
      0-2  : RGB
      3-5  : ELA
      6-8  : Laplacian
      9    : OCR
      10   : DCT
      11   : SRM (merged with DINO attention via element-wise max)
      12   : Noiseprint
    """
    rgb    = imgs_cpu[:, 0:3]
    _, _, H, W = imgs_cpu.shape

    with torch.no_grad():
        srm_ch  = srm_net(rgb.half()).float() * 255.
        nois_ch = noiseprint(rgb.half()).float() * 255.
        dino_ch = dino_vit(rgb.half(), H, W).float() * 255.

    # Fuse SRM and DINO via element-wise max (both detect local anomalies)
    # This keeps channel count at 13 while retaining DINO information
    srm_dino_fused = torch.max(srm_ch, dino_ch)

    return torch.cat([imgs_cpu, srm_dino_fused, nois_ch], dim=1)  # (B,13,H,W)


def get_param_groups(model, base_lr, enc_ratio=0.05):
    """
    Differential learning rates:
    - Encoder (pretrained ImageNet): very small LR to preserve features
    - Channel gate + decoder: full LR for learning forgery-specific patterns
    """
    raw     = model.module if hasattr(model, "module") else model
    
    # Handle ForgeryDetector wrapper
    if hasattr(raw, 'seg_model'):
        enc_params  = list(raw.seg_model.encoder.parameters())
        gate_params = list(raw.channel_gate.parameters())
        dec_params  = [p for p in raw.seg_model.parameters()
                       if id(p) not in {id(q) for q in enc_params}]
        enc_ids = {id(p) for p in enc_params}
        return [
            {"params": enc_params,  "lr": base_lr * enc_ratio,
             "name": "encoder"},
            {"params": gate_params, "lr": base_lr,
             "name": "channel_gate"},
            {"params": dec_params,  "lr": base_lr,
             "name": "decoder"},
        ]
    else:
        enc_ids = {id(p) for p in raw.encoder.parameters()}
        enc_p   = [p for p in raw.parameters() if id(p) in enc_ids]
        dec_p   = [p for p in raw.parameters() if id(p) not in enc_ids]
        return [
            {"params": enc_p, "lr": base_lr * enc_ratio},
            {"params": dec_p, "lr": base_lr},
        ]


def find_optimal_threshold(model, val_dl, device,
                           srm_net, noiseprint, dino_vit,
                           thresholds=None):
    """
    NEW: Sweep thresholds on validation set to maximize F1.
    Document forgery segmentation benefits greatly from threshold tuning
    because positive class (tampered pixels) is often <5% of image.
    """
    if thresholds is None:
        thresholds = np.arange(0.2, 0.85, 0.05)

    print("  [Threshold] Sweeping thresholds on val set...")
    model.eval()
    all_probs, all_masks = [], []

    with torch.no_grad():
        for imgs_cpu, masks in val_dl:
            imgs_cpu = imgs_cpu.to(device, non_blocking=True)
            masks    = masks.to(device, non_blocking=True)
            imgs_13  = gpu_features(imgs_cpu, device,
                                    srm_net, noiseprint, dino_vit)
            imgs_13  = normalise(imgs_13)
            with torch.amp.autocast("cuda"):
                preds = model(imgs_13)
            probs = torch.sigmoid(preds)
            all_probs.append(probs.cpu())
            all_masks.append(masks.cpu())

    all_probs = torch.cat(all_probs, dim=0)
    all_masks = torch.cat(all_masks, dim=0).bool()

    best_f1, best_thresh = 0.0, 0.5
    for t in thresholds:
        preds_t = (all_probs > t)
        tp = (preds_t  & all_masks ).float().sum()
        fp = (preds_t  & ~all_masks).float().sum()
        fn = (~preds_t & all_masks ).float().sum()
        f1 = (2*tp / (2*tp + fp + fn + 1e-6)).item()
        if f1 > best_f1:
            best_f1    = f1
            best_thresh= float(t)

    print(f"  [Threshold] Best threshold: {best_thresh:.2f}  F1={best_f1:.4f}")
    return best_thresh, best_f1


def compute_metrics(preds_raw, masks, threshold=0.5,
                    use_tta=False, model=None, imgs_norm=None):
    """
    Compute per-image IoU, Precision, Recall, F1 with configurable threshold.
    """
    if use_tta and imgs_norm is not None and model is not None:
        with torch.no_grad():
            p0 = torch.sigmoid(model(imgs_norm))
            p1 = torch.flip(torch.sigmoid(
                 model(torch.flip(imgs_norm, [-1]))), [-1])
            p2 = torch.flip(torch.sigmoid(
                 model(torch.flip(imgs_norm, [-2]))), [-2])
            p3 = torch.flip(torch.sigmoid(
                 model(torch.flip(imgs_norm, [-1,-2]))), [-1,-2])
            # NEW: also try 90° rotation TTA
            p4 = torch.rot90(torch.sigmoid(
                 model(torch.rot90(imgs_norm, 1, [-2,-1]))), 3, [-2,-1])
        preds = ((p0 + p1 + p2 + p3 + p4) / 5. > threshold)
    else:
        preds = (torch.sigmoid(preds_raw) > threshold)

    masks = masks.bool()
    tp    = (preds  & masks ).float().sum((1,2,3))
    fp    = (preds  & ~masks).float().sum((1,2,3))
    fn    = (~preds & masks ).float().sum((1,2,3))
    iou   = (tp / (tp+fp+fn+1e-6)).mean().item()
    f1    = (2*tp / (2*tp+fp+fn+1e-6)).mean().item()
    prec  = (tp / (tp+fp+1e-6)).mean().item()
    rec   = (tp / (tp+fn+1e-6)).mean().item()
    return iou, prec, rec, f1


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    global BEST_THRESHOLD

    set_seed(SEED)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if CACHE_DIR is not None:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

    check_dataset(DATA_ROOT)

    for i in range(torch.cuda.device_count()):
        p = torch.cuda.get_device_properties(i)
        print(f"✓ GPU {i}: {p.name}  {p.total_memory/1e9:.1f} GB VRAM")

    # ── Auto-detect dataset size ───────────────────────────────────────────
    LMDB_TRAIN = DATA_ROOT / "DocTamperV1-TrainingSet"
    LMDB_VAL   = DATA_ROOT / "DocTamperV1-TestingSet"

    n_train_total = get_lmdb_size(LMDB_TRAIN)
    n_val_total   = get_lmdb_size(LMDB_VAL)

    # Use all training data (BUG FIX: original TRAIN_SAMPLES=0 used nothing!)
    n_train = n_train_total if TRAIN_SAMPLES == 0 else min(TRAIN_SAMPLES, n_train_total)
    n_val   = n_val_total if VAL_SAMPLES == 0 else min(VAL_SAMPLES, n_val_total)

    print(f"\n{'='*66}")
    print(f"  Encoder       : {ENCODER}")
    print(f"  Channels      : {N_CH} (11 CPU + fused SRM/DINO + Noiseprint)")
    print(f"  Train samples : {n_train:,} / {n_train_total:,}")
    print(f"  Val samples   : {n_val:,} / {n_val_total:,}")
    print(f"  Batch         : {BATCH}  (×{GRAD_ACC} acc = {BATCH*GRAD_ACC} eff)")
    print(f"  Epochs        : {EPOCHS}  |  Patience : {PATIENCE}")
    print(f"  Image size    : {IMG_SIZE}")
    print(f"  Data root     : {DATA_ROOT.resolve()}")
    print(f"  Output dir    : {OUTPUT_DIR.resolve()}")
    print(f"  Cache dir     : {CACHE_DIR}")
    print(f"  Device        : {DEVICE}")
    print(f"  Seed          : {SEED}")
    print(f"  Resume ckpt   : {RESUME_CHECKPOINT}")
    print(f"{'='*66}\n")

    # ── Frozen GPU extractors ──────────────────────────────────────────────
    print("Loading frozen GPU extractors...")
    srm_net    = SRMExtractor().to(DEVICE).half().eval()
    noiseprint = NoiseprintExtractor().to(DEVICE).half().eval()
    dino_vit   = DinoViTExtractor().to(DEVICE).half().eval()
    print("✓ SRM / Noiseprint / DINO-ViT loaded\n")

    # ── Datasets ──────────────────────────────────────────────────────────
    print("Running P-Hash deduplication on training set...")
    train_all_idx = list(range(n_train))
    train_idx = phash_deduplicate(LMDB_TRAIN, train_all_idx,
                                  sample_n=min(P_HASH_SAMPLE_N, n_train),
                                  threshold=P_HASH_THRESHOLD,
                                  seed=SEED)
    val_idx   = list(range(n_val))

    train_ds = DocTamperDataset(
        LMDB_TRAIN, train_idx, _spatial_train,
        is_train=True, cache_dir=CACHE_DIR, split_name="train"
    )
    val_ds = DocTamperDataset(
        LMDB_VAL, val_idx, _spatial_val,
        is_train=False, cache_dir=CACHE_DIR, split_name="val"
    )

    train_dl = DataLoader(
    train_ds, batch_size=BATCH, shuffle=True,
    num_workers=NUM_WORKERS, pin_memory=True,
    prefetch_factor=3 if NUM_WORKERS > 0 else None,
    persistent_workers=(NUM_WORKERS > 0),
    drop_last=True,
)
    val_dl = DataLoader(
    val_ds, batch_size=BATCH, shuffle=False,
    num_workers=NUM_WORKERS, pin_memory=True,
    persistent_workers=(NUM_WORKERS > 0),
    )

    print(f"✓ Train batches : {len(train_dl):,}")
    print(f"✓ Val   batches : {len(val_dl):,}")

    # ── Model ─────────────────────────────────────────────────────────────
    print("\nBuilding model...")

    # Try UnetPlusPlus first (better skip connections than plain Unet)
    for enc_name in [ENCODER, "mit_b4", "efficientnet-b5"]:
        try:
            base_model = smp.UnetPlusPlus(
                encoder_name    = enc_name,
                encoder_weights = "imagenet",
                in_channels     = N_CH,
                classes         = 1,
                activation      = None,
                # Deeper decoder for better fine-grained segmentation
                decoder_channels= (256, 128, 64, 32, 16),
            )
            print(f"✓ UnetPlusPlus + {enc_name}")
            break
        except Exception as e:
            print(f"  {enc_name} failed: {e}")
            base_model = None

    if base_model is None:
        raise RuntimeError("All encoders failed. Check smp installation.")

    # Wrap with channel attention gate
    model = ForgeryDetector(base_model, n_ch=N_CH)

    if torch.cuda.device_count() > 1:
        model = DataParallel(model)
    model = model.to(DEVICE)

    n_params = sum(p.numel() for p in model.parameters()) / 1e6
    print(f"✓ Params  : {n_params:.1f}M\n")

    # ── Loss ──────────────────────────────────────────────────────────────
    # Dynamic pos_weight based on dataset imbalance
    # DocTamper: ~10-20% of pixels are tampered → pos_weight ≈ 4-9
        # ── Loss ──────────────────────────────────────────────────────────────
    POS_WEIGHT    = 5.0
    LABEL_SMOOTH  = 0.05   # smoothing factor — applied manually below

    dice_loss     = smp.losses.DiceLoss(mode="binary", smooth=1.0)
    _bce_raw      = smp.losses.SoftBCEWithLogitsLoss(
                        pos_weight=torch.tensor([POS_WEIGHT]).to(DEVICE))
        # 'normalized' arg only exists in smp>=0.3.3 — use try/except for safety
    try:
        focal_loss = smp.losses.FocalLoss(mode="binary", gamma=2.5,
                                          normalized=True)
    except TypeError:
        focal_loss = smp.losses.FocalLoss(mode="binary", gamma=2.5)
    tversky_loss  = TverskyLoss(alpha=0.3, beta=0.7).to(DEVICE)
    boundary_loss = BoundaryLoss().to(DEVICE)
    lovasz_loss   = LovaszSoftmaxLoss().to(DEVICE)

    def bce_loss(preds, masks):
        """
        SoftBCEWithLogitsLoss + manual label smoothing.
        Smoothing converts hard {0,1} targets to {eps/2, 1-eps/2},
        reducing overconfidence on ambiguous boundary pixels.
        """
        masks_smooth = masks * (1.0 - LABEL_SMOOTH) + 0.5 * LABEL_SMOOTH
        return _bce_raw(preds, masks_smooth)

    def loss_fn(preds, masks, epoch=1):
        """
        Progressive loss weighting: start with BCE-dominated loss for stability,
        gradually shift toward Lovász+Tversky for better IoU optimization.
        """
        progress = min(epoch / 10.0, 1.0)  # 0→1 over first 10 epochs

        # Base losses (always active)
        l_dice     = dice_loss(preds, masks)
        l_tversky  = tversky_loss(preds, masks)
        l_focal    = focal_loss(preds, masks)
        l_bce      = bce_loss(preds, masks)
        l_boundary = boundary_loss(preds, masks)

        # NEW: Lovász ramps in after epoch 5
        l_lovasz   = lovasz_loss(preds, masks) if epoch > 5 else 0.0

        # Progressive weighting
        w_lovasz = 0.15 * progress
        w_dice   = 0.30 * (1 - 0.2 * progress)   # slightly reduces
        w_tv     = 0.25
        w_focal  = 0.20 * (1 - 0.1 * progress)
        w_bce    = 0.10 * (1 - 0.5 * progress)   # reduces as training matures
        w_bnd    = 0.10

        # Renormalize weights to sum to 1.0
        total_w = w_lovasz + w_dice + w_tv + w_focal + w_bce + w_bnd
        return (
            (w_dice   * l_dice +
             w_tv     * l_tversky +    # ← fixed: matches variable name above
             w_focal  * l_focal +
             w_bce    * l_bce +
             w_bnd    * l_boundary +
             w_lovasz * l_lovasz) / total_w
        )

    # ── Optimizer + Scheduler ─────────────────────────────────────────────
    optimizer = torch.optim.AdamW(
        get_param_groups(model, LR),
        weight_decay=WEIGHT_DECAY,
        eps=1e-6,  # more numerically stable than default 1e-8
    )

    steps      = len(train_dl)
    warmup_ep  = 2  # 2 epoch warmup
    warmup     = LinearLR(optimizer, start_factor=0.05,
                          end_factor=1.0,
                          total_iters=warmup_ep * steps)
    cosine     = CosineAnnealingLR(optimizer,
                                   T_max=(EPOCHS - warmup_ep) * steps,
                                   eta_min=5e-7)
    scheduler  = SequentialLR(optimizer,
                               schedulers=[warmup, cosine],
                               milestones=[warmup_ep * steps])
    scaler     = torch.amp.GradScaler("cuda")

    # ── Training loop ─────────────────────────────────────────────────────
    best_f1, epochs_no_improv = 0.0, 0
    history = []
    BEST_THRESHOLD = 0.5
    start_epoch = 1

    if RESUME_CHECKPOINT is not None:
        if not RESUME_CHECKPOINT.exists():
            raise FileNotFoundError(f"Resume checkpoint not found: {RESUME_CHECKPOINT}")
        start_epoch, best_f1, BEST_THRESHOLD, history = load_training_checkpoint(
            RESUME_CHECKPOINT,
            model,
            optimizer=optimizer,
            scheduler=scheduler,
            scaler=scaler,
        )
        print(f"✓ Resumed from {RESUME_CHECKPOINT} at epoch {start_epoch} "
              f"(best_f1={best_f1:.4f}, threshold={BEST_THRESHOLD:.2f})")

    print("=" * 66)
    print("  STARTING TRAINING")
    print(f"  Techniques: ELA·SRM·NP·DINO·OCR·DCT·P-Hash·ChanAttn·Lovász")
    print("=" * 66 + "\n")

    total_t0 = time.time()

    for epoch in range(start_epoch, EPOCHS + 1):
        ep_t0 = time.time()

        # ── Train ─────────────────────────────────────────────────────────
        model.train()
        train_loss = 0.0
        optimizer.zero_grad()

        for step, (imgs_cpu, masks) in enumerate(train_dl):
            imgs_cpu = imgs_cpu.to(DEVICE, non_blocking=True)
            masks    = masks.to(DEVICE, non_blocking=True)

            # Append GPU forensic features → (B, 13, H, W)
            imgs_13  = gpu_features(imgs_cpu, DEVICE,
                                    srm_net, noiseprint, dino_vit)
            imgs_13  = normalise(imgs_13)

            with torch.amp.autocast("cuda"):
                preds = model(imgs_13)
                loss  = loss_fn(preds, masks, epoch=epoch) / GRAD_ACC

            scaler.scale(loss).backward()

            if (step + 1) % GRAD_ACC == 0 or (step + 1) == len(train_dl):
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(
                    model.parameters(), max_norm=1.0)
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad()
                scheduler.step()

            train_loss += loss.item() * GRAD_ACC

        # ── Validate ──────────────────────────────────────────────────────
        model.eval()
        val_loss = 0.0
        all_iou, all_p, all_r, all_f1 = [], [], [], []
        use_tta = (epoch > EPOCHS - 5)  # TTA in last 5 epochs

        # Tune threshold every 5 epochs starting from epoch 10
        if epoch >= 10 and epoch % 5 == 0:
            BEST_THRESHOLD, _ = find_optimal_threshold(
                model, val_dl, DEVICE, srm_net, noiseprint, dino_vit)

        with torch.no_grad():
            for imgs_cpu, masks in val_dl:
                imgs_cpu = imgs_cpu.to(DEVICE, non_blocking=True)
                masks    = masks.to(DEVICE, non_blocking=True)

                imgs_13 = gpu_features(imgs_cpu, DEVICE,
                                       srm_net, noiseprint, dino_vit)
                imgs_13 = normalise(imgs_13)

                with torch.amp.autocast("cuda"):
                    preds = model(imgs_13)
                    vloss = loss_fn(preds, masks, epoch=epoch)

                val_loss += vloss.item()
                iou, p, r, f1 = compute_metrics(
                    preds, masks,
                    threshold= BEST_THRESHOLD,
                    use_tta  = use_tta,
                    model    = model,
                    imgs_norm= imgs_13 if use_tta else None,
                )
                all_iou.append(iou); all_p.append(p)
                all_r.append(r);     all_f1.append(f1)

        t_loss = train_loss / len(train_dl)
        v_loss = val_loss   / len(val_dl)
        m_iou  = float(np.mean(all_iou))
        m_f1   = float(np.mean(all_f1))
        m_p    = float(np.mean(all_p))
        m_r    = float(np.mean(all_r))
        lr_now = optimizer.param_groups[-1]["lr"]
        ep_min = (time.time() - ep_t0) / 60
        tot_hr = (time.time() - total_t0) / 3600

        history.append(dict(
            epoch=epoch, train_loss=t_loss, val_loss=v_loss,
            iou=m_iou, f1=m_f1, precision=m_p, recall=m_r,
            threshold=BEST_THRESHOLD,
        ))

        star = " ★" if m_f1 > best_f1 else ""
        print(
            f"Ep {epoch:02d}/{EPOCHS} | "
            f"TLoss:{t_loss:.4f}  VLoss:{v_loss:.4f} | "
            f"IoU:{m_iou:.4f}  F1:{m_f1:.4f}  "
            f"P:{m_p:.4f}  R:{m_r:.4f} | "
            f"Thr:{BEST_THRESHOLD:.2f} | "
            f"LR:{lr_now:.2e} | "
            f"{ep_min:.1f}min [{tot_hr:.2f}hr]{star}"
        )

        if m_f1 > best_f1:
            best_f1 = m_f1
            epochs_no_improv = 0
            save_training_checkpoint(
                OUTPUT_DIR / "forgery_best.pth",
                model, optimizer, scheduler, scaler,
                epoch, best_f1, BEST_THRESHOLD, history,
            )
            print(f"   ✓ forgery_best.pth saved  "
                  f"(F1={best_f1:.4f}, thr={BEST_THRESHOLD:.2f})")
        else:
            epochs_no_improv += 1
            print(f"   No gain ({epochs_no_improv}/{PATIENCE})")
            if epochs_no_improv >= PATIENCE:
                print(f"\n⚠  Early stop at epoch {epoch}")
                break

        save_training_checkpoint(
            OUTPUT_DIR / "last_checkpoint.pth",
            model, optimizer, scheduler, scaler,
            epoch, best_f1, BEST_THRESHOLD, history,
        )

        if epoch % SAVE_EVERY == 0:
            save_training_checkpoint(
                OUTPUT_DIR / f"ckpt_ep{epoch:02d}_f1{m_f1:.3f}.pth",
                model, optimizer, scheduler, scaler,
                epoch, best_f1, BEST_THRESHOLD, history,
            )

        with open(OUTPUT_DIR / "history.json", "w") as f:
            json.dump(history, f, indent=2)

        gc.collect()
        torch.cuda.empty_cache()

    total_hrs = (time.time() - total_t0) / 3600
    print(f"\n{'='*66}")
    print(f"  DONE  |  Best F1 : {best_f1:.4f}  |  {total_hrs:.2f} hrs")
    print(f"  Best threshold  : {BEST_THRESHOLD:.2f}")
    print(f"  → ./output/forgery_best.pth")
    print(f"{'='*66}")


if __name__ == "__main__":
    main()
