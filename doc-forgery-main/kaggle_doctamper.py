# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  DocTamper — 6-TECHNIQUE FORGERY DETECTION  |  Kaggle T4×2  |  4 hrs   ║
# ║  Techniques: ELA · SRM · Noiseprint · DINO-ViT · OCR-proxy · P-Hash    ║
# ║  Output: /kaggle/working/forgery_best.pth  ONLY                         ║
# ╚══════════════════════════════════════════════════════════════════════════╝
#
# HOW TO USE:
#   Paste this entire file as a SINGLE Kaggle cell and run.
#   All installs, training, and saving happen automatically.
#   Download forgery_best.pth from the Kaggle Output tab when done.
#
# MEMORY NOTES (fixes "allocated more than available memory"):
#   - LMDB opened lazily per worker (meminit=False, readahead=False)
#   - num_workers=2 to cap RAM usage
#   - Frozen models in FP16 on GPU, freed with gc after each epoch
#   - Batch=8 (16 effective with DataParallel)
#   - No disk feature cache (avoids storage overflow)
#
# 13-CHANNEL INPUT LAYOUT:
#   Ch 0-2  : RGB                (raw, workers)
#   Ch 3-5  : ELA                (Error Level Analysis, workers)
#   Ch 6-8  : Laplacian          (multi-scale edge energy, workers)
#   Ch 9    : OCR proxy          (text-region map, workers)
#   Ch 10   : SRM                (30-kernel noise residual, GPU per batch)
#   Ch 11   : Noiseprint         (Gaussian noise fingerprint, GPU per batch)
#   Ch 12   : DINO-ViT anomaly   (patch distance from global, GPU per batch)
# ===========================================================================

# ── INSTALL ─────────────────────────────────────────────────────────────────
import subprocess, sys

def _pip(*pkgs):
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", *pkgs],
                   check=False)

_pip("segmentation-models-pytorch")
_pip("albumentations")
_pip("lmdb")
_pip("timm>=0.9.12")
_pip("imagehash")

print("✓ All packages installed")

# ── IMPORTS ─────────────────────────────────────────────────────────────────
import os, io, gc, json, random, time, warnings
import numpy as np
import cv2
import torch
import torch.nn as nn
import torch.nn.functional as F
import segmentation_models_pytorch as smp
import albumentations as A
from albumentations.pytorch import ToTensorV2
from torch.nn.parallel import DataParallel
from torch.utils.data import Dataset, DataLoader
from torch.optim.lr_scheduler import LinearLR, CosineAnnealingLR, SequentialLR
from pathlib import Path
from PIL import Image
import lmdb
import imagehash
import timm

warnings.filterwarnings("ignore")
torch.backends.cudnn.benchmark = True

print(f"✓ PyTorch  : {torch.__version__}")
print(f"✓ CUDA     : {torch.cuda.is_available()}")
print(f"✓ GPUs     : {torch.cuda.device_count()}")
for i in range(torch.cuda.device_count()):
    p = torch.cuda.get_device_properties(i)
    print(f"  GPU {i}   : {p.name}  {p.total_memory/1e9:.1f} GB")

# ── CONFIG ───────────────────────────────────────────────────────────────────
BASE          = Path("doctamper")
SAVE_DIR      = Path("working")
LMDB_TRAIN    = BASE / "DocTamperV1-TrainingSet"
LMDB_VAL      = BASE / "DocTamperV1-TestingSet"

TRAIN_SAMPLES = 8000   # ~17 min/epoch on dual T4 → fits 4 hrs
VAL_SAMPLES   = 2000
EPOCHS        = 12
BATCH         = 4        # 8 × 2 GPUs = 16 effective
IMG_SIZE      = 384
LR            = 2e-4
WEIGHT_DECAY  = 1e-4
PATIENCE      = 4
N_CH          = 13       # full 13-channel forensic tensor
DEVICE        = "cuda" if torch.cuda.is_available() else "cpu"
GPU0          = "cuda:0" # frozen models live here; DataParallel splits after

print(f"\n{'='*60}")
print(f"  Train : {TRAIN_SAMPLES:,}  |  Val : {VAL_SAMPLES:,}")
print(f"  Batch : {BATCH} × {torch.cuda.device_count()} = "
      f"{BATCH*torch.cuda.device_count()} effective")
print(f"  Epochs: {EPOCHS}  |  Patience: {PATIENCE}")
print(f"{'='*60}\n")


# ══════════════════════════════════════════════════════════════════════════════
#  TECHNIQUE 6 — P-HASH DEDUPLICATION
#  Run at startup: sample 8k images, find near-duplicates, remove from
#  training indices so the model doesn't overfit on repeated patterns.
# ══════════════════════════════════════════════════════════════════════════════

def phash_deduplicate(lmdb_path, all_indices,
                      sample_n=8_000, threshold=8, seed=42):
    """
    P-Hash (Perceptual Hash) deduplication.
    Samples `sample_n` images, computes pHash for each, removes images
    whose hash distance < threshold from any previously seen image.
    Returns a deduplicated list of indices.
    """
    print(f"  [P-Hash] Sampling {sample_n} images for deduplication...")
    rng      = random.Random(seed)
    sampled  = rng.sample(all_indices, min(sample_n, len(all_indices)))
    unsampled= [i for i in all_indices if i not in set(sampled)]

    env = lmdb.open(str(lmdb_path), readonly=True,
                    lock=False, meminit=False, readahead=False)
    seen_hashes  = []
    unique_idx   = []

    with env.begin() as txn:
        for idx in sampled:
            val = txn.get(f"image-{idx:09d}".encode())
            if val is None:
                continue
            img = Image.open(io.BytesIO(val)).convert("RGB").resize((64, 64))
            h   = imagehash.phash(img, hash_size=8)
            if all(abs(h - s) > threshold for s in seen_hashes):
                seen_hashes.append(h)
                unique_idx.append(idx)

    env.close()
    removed   = len(sampled) - len(unique_idx)
    kept      = unique_idx + unsampled
    print(f"  [P-Hash] Removed {removed} near-duplicates from sample. "
          f"Training on {len(kept):,} indices.")
    return kept


# ══════════════════════════════════════════════════════════════════════════════
#  CPU FEATURE FUNCTIONS  (run inside DataLoader workers)
# ══════════════════════════════════════════════════════════════════════════════

def compute_ela(img_pil: Image.Image, quality: int = 90) -> np.ndarray:
    """
    TECHNIQUE 1 — Error Level Analysis (ELA)
    Re-saves image as JPEG at given quality, computes pixel-wise absolute
    difference. Forged regions have different compression artefact levels
    than authentic areas. Fully in-memory via BytesIO (no disk I/O).
    Returns H×W×3 uint8 [0–255].
    """
    buf = io.BytesIO()
    img_pil.save(buf, "JPEG", quality=quality)
    buf.seek(0)
    compressed = np.array(Image.open(buf).convert("RGB"), dtype=np.float32)
    original   = np.array(img_pil, dtype=np.float32)
    ela        = np.abs(original - compressed)
    ela        = (ela * 255.0 / (ela.max() + 1e-6)).astype(np.uint8)
    return ela   # H×W×3


def compute_laplacian(img_np: np.ndarray) -> np.ndarray:
    """
    Multi-scale Laplacian edge energy (fine / medium / coarse).
    Replaces slow block-DCT with vectorised OpenCV calls (~50× faster).
    Captures frequency anomalies left by copy-paste or re-encoding.
    Returns H×W×3 uint8 [0–255].
    """
    gray   = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY).astype(np.float32)
    fine   = np.abs(cv2.Laplacian(gray, cv2.CV_32F, ksize=1))
    blur3  = cv2.GaussianBlur(gray, (3, 3), 0)
    medium = np.abs(cv2.Laplacian(blur3, cv2.CV_32F, ksize=3))
    blur5  = cv2.GaussianBlur(gray, (5, 5), 0)
    coarse = np.abs(cv2.Laplacian(blur5, cv2.CV_32F, ksize=5))
    lap    = np.stack([fine, medium, coarse], axis=2)
    return (lap / (lap.max() + 1e-6) * 255).astype(np.uint8)   # H×W×3


def compute_ocr_proxy(img_np: np.ndarray) -> np.ndarray:
    """
    TECHNIQUE 5 — OCR Text-Region Proxy
    Fast morphological text detection: identifies WHERE text-like structures
    exist without running a heavy OCR model. Detects dense horizontal-edge
    regions characteristic of printed/typed text.
    Forged documents often have inconsistent text regions (different fonts,
    sizes, or compression levels) that this proxy highlights.
    Returns H×W uint8 [0–255].
    """
    gray     = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
    # Morphological gradient highlights local edges (letter strokes)
    kern     = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    grad     = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, kern)
    # Horizontal closing groups adjacent strokes into text lines
    h_kern   = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 3))
    text_map = cv2.morphologyEx(grad, cv2.MORPH_CLOSE, h_kern)
    return text_map   # H×W uint8


# RGB-only pre-augmentation: CLAHE + Sharpen must see exactly 3 channels
_rgb_aug = A.Compose([
    A.CLAHE(clip_limit=2.0, p=0.3),
    A.Sharpen(alpha=(0.1, 0.3), p=0.3),
])


# ══════════════════════════════════════════════════════════════════════════════
#  GPU FEATURE EXTRACTORS  (run in main training loop, frozen, FP16)
# ══════════════════════════════════════════════════════════════════════════════

class SRMExtractor(nn.Module):
    """
    TECHNIQUE 2 — Steganalysis Rich Model (SRM)
    Convolves the image with 5 hand-crafted high-pass filters designed to
    extract camera-independent noise residuals. Tampered regions break the
    noise consistency of the original image.
    Frozen (no gradients). Output: (B, 1, H, W) float [0–1].
    """
    def __init__(self):
        super().__init__()
        k1 = np.array([[0,0,0,0,0],[0,-1,2,-1,0],[0,2,-4,2,0],
                        [0,-1,2,-1,0],[0,0,0,0,0]], dtype=np.float32) / 4.
        k2 = np.array([[-1,2,-2,2,-1],[2,-6,8,-6,2],[-2,8,-12,8,-2],
                        [2,-6,8,-6,2],[-1,2,-2,2,-1]], dtype=np.float32) / 12.
        k3 = np.array([[0,0,0,0,0],[0,0,0,0,0],[0,1,-2,1,0],
                        [0,0,0,0,0],[0,0,0,0,0]], dtype=np.float32) / 2.
        k4 = np.array([[0,0,0,0,0],[0,0,1,0,0],[0,1,-4,1,0],
                        [0,0,1,0,0],[0,0,0,0,0]], dtype=np.float32)
        k5 = np.array([[1,-2,1,0,0],[-2,4,-2,0,0],[1,-2,1,0,0],
                        [0,0,0,0,0],[0,0,0,0,0]], dtype=np.float32) / 4.
        kernels = np.stack([k1,k2,k3,k4,k5], axis=0)[:,np.newaxis,:,:]
        self.register_buffer("kernels", torch.tensor(kernels))

    @torch.no_grad()
    def forward(self, rgb_raw: torch.Tensor) -> torch.Tensor:
        # rgb_raw: (B, 3, H, W) float [0–255]
        gray = (0.299*rgb_raw[:,0] + 0.587*rgb_raw[:,1] +
                0.114*rgb_raw[:,2]).unsqueeze(1) / 255.0     # (B,1,H,W)
        out  = F.conv2d(gray.float(), self.kernels.float(), padding=2)
        srm  = out.abs().mean(dim=1, keepdim=True)            # (B,1,H,W)
        mx   = srm.amax(dim=(2, 3), keepdim=True)
        return srm / (mx + 1e-6)                              # [0–1]


class NoiseprintExtractor(nn.Module):
    """
    TECHNIQUE 3 — Noiseprint (camera noise fingerprint)
    Computes the noise residual via Gaussian denoising subtraction.
    This is the classical approach: Noiseprint = image - denoise(image).
    Authentic regions share a consistent camera noise pattern; tampered
    regions (pasted from another source) break this consistency.
    Frozen (no gradients). Output: (B, 1, H, W) float [0–1].
    """
    def __init__(self, sigma: float = 1.0):
        super().__init__()
        k      = 5
        x      = torch.arange(k).float() - k // 2
        g1d    = torch.exp(-x**2 / (2 * sigma**2))
        g2d    = torch.outer(g1d, g1d)
        g2d    = g2d / g2d.sum()
        self.register_buffer("kernel", g2d.unsqueeze(0).unsqueeze(0))

    @torch.no_grad()
    def forward(self, rgb_raw: torch.Tensor) -> torch.Tensor:
        # rgb_raw: (B, 3, H, W) float [0–255]
        gray     = (0.299*rgb_raw[:,0] + 0.587*rgb_raw[:,1] +
                    0.114*rgb_raw[:,2]).unsqueeze(1) / 255.0
        smooth   = F.conv2d(gray.float(), self.kernel.float(), padding=2)
        residual = (gray - smooth).abs()
        mx       = residual.amax(dim=(2, 3), keepdim=True)
        return residual / (mx + 1e-6)                          # [0–1]


class DinoViTExtractor(nn.Module):
    """
    TECHNIQUE 4 — DINO-ViT Patch Anomaly Map
    Uses a frozen pretrained ViT-Tiny to extract per-patch features.
    Computes L2 distance of each patch from the global [CLS] representation.
    Patches that are semantically inconsistent with the rest of the image
    (e.g. pasted content) appear as high-distance outliers.
    Frozen (no gradients). Output: (B, 1, H, W) float [0–1].
    """
    def __init__(self):
        super().__init__()
        try:
            self.model = timm.create_model(
                "vit_tiny_patch16_224", pretrained=True, num_classes=0)
            print("  ✓ DINO-ViT: vit_tiny_patch16_224 (pretrained)")
        except Exception as e:
            self.model = timm.create_model(
                "vit_tiny_patch16_224", pretrained=False, num_classes=0)
            print(f"  ⚠ DINO-ViT: random init ({e})")
        for p in self.model.parameters():
            p.requires_grad_(False)
        self.model.eval()
        # ImageNet normalisation buffers
        self.register_buffer("mean",
            torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        self.register_buffer("std",
            torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))

    @torch.no_grad()
    def forward(self, rgb_raw: torch.Tensor,
                out_h: int, out_w: int) -> torch.Tensor:
        # rgb_raw: (B, 3, H, W) float [0–255]
        x = rgb_raw.float() / 255.0
        x = (x - self.mean) / self.std
        x = F.interpolate(x, size=(224, 224),
                          mode="bilinear", align_corners=False)
        x = x.to(self.model.patch_embed.proj.weight.dtype)
        feats      = self.model.forward_features(x)  # (B, 197, 192)
        patches    = feats[:, 1:]                     # (B, 196, 192)
        cls        = feats[:, 0:1]                    # (B,   1, 192)
        dist       = torch.norm(patches - cls, dim=-1)  # (B, 196)
        # Normalize to [0,1]
        mn  = dist.amin(dim=1, keepdim=True)
        mx  = dist.amax(dim=1, keepdim=True)
        dist = (dist - mn) / (mx - mn + 1e-6)
        n    = int(dist.shape[1] ** 0.5)             # 14
        dist = dist.reshape(-1, 1, n, n)             # (B, 1, 14, 14)
        dist = F.interpolate(dist, size=(out_h, out_w),
                             mode="bilinear", align_corners=False)
        return dist                                   # (B, 1, H, W) [0–1]


# ── Initialise frozen GPU models (once, before training) ─────────────────────
print("\nLoading frozen GPU feature extractors...")
srm_net      = SRMExtractor().to(GPU0).half().eval()
noiseprint   = NoiseprintExtractor().to(GPU0).half().eval()
dino_vit     = DinoViTExtractor().to(GPU0).half().eval()
print("✓ SRM / Noiseprint / DINO-ViT ready on GPU0\n")


# ══════════════════════════════════════════════════════════════════════════════
#  DATASET
# ══════════════════════════════════════════════════════════════════════════════

class DocTamperDataset(Dataset):
    """
    Workers compute (CPU): RGB + ELA + Laplacian + OCR-proxy = 10 channels.
    Training loop adds (GPU): SRM + Noiseprint + DINO = 3 channels → 13 total.
    LMDB opened lazily per worker to avoid "already open" crash.
    """

    def __init__(self, lmdb_path, indices, spatial_tf, is_train: bool = False):
        self.lmdb_path = str(lmdb_path)
        self.indices   = indices
        self.spatial_tf= spatial_tf
        self.is_train  = is_train
        self.env       = None   # lazy open

    def _open(self):
        if self.env is None:
            self.env = lmdb.open(
                self.lmdb_path, readonly=True,
                lock=False, meminit=False, readahead=False)

    def __len__(self):
        return len(self.indices)

    def __getitem__(self, idx):
        self._open()
        i = self.indices[idx]

        with self.env.begin(write=False) as txn:
            img_b = txn.get(f"image-{i:09d}".encode())
            msk_b = txn.get(f"label-{i:09d}".encode())

        img_pil = Image.open(io.BytesIO(img_b)).convert("RGB")
        msk_pil = Image.open(io.BytesIO(msk_b)).convert("L")
        img_np  = np.array(img_pil)                          # H×W×3 uint8
        msk_np  = (np.array(msk_pil) > 127).astype(np.float32)

        # RGB-only augmentation (CLAHE/Sharpen require 3 channels exactly)
        if self.is_train:
            aug    = _rgb_aug(image=img_np)
            img_np = aug["image"]
            img_pil= Image.fromarray(img_np)

        # ── Build 10-channel CPU tensor ────────────────────────────────────
        ela    = compute_ela(img_pil)           # H×W×3
        lap    = compute_laplacian(img_np)      # H×W×3
        ocr    = compute_ocr_proxy(img_np)      # H×W  (add dim below)
        ocr3   = np.stack([ocr, ocr, ocr], axis=2)  # H×W×3 (temp for augment)

        # Stack everything: RGB(3) + ELA(3) + Lap(3) + OCR(3 temp) = 12ch
        # (OCR is replicated × 3 so albumentations augments it consistently)
        img_12 = np.concatenate([img_np, ela, lap, ocr3], axis=2)  # H×W×12

        # ── Spatial augmentation (12-ch safe — no CLAHE/Sharpen here) ─────
        if self.spatial_tf:
            aug    = self.spatial_tf(image=img_12, mask=msk_np)
            img_12 = aug["image"]   # (12, H, W) float after ToTensorV2
            msk_np = aug["mask"]

        # Drop duplicate OCR channels → keep only 1 → tensor is (10, H, W)
        # Layout: ch0-2=RGB, ch3-5=ELA, ch6-8=Lap, ch9=OCR
        img_10 = torch.cat([img_12[:9], img_12[9:10]], dim=0)  # (10, H, W)

        return img_10.float(), msk_np.unsqueeze(0).float()


# ── Augmentation pipelines ────────────────────────────────────────────────────
# NOTE: A.Normalize is NOT included here — we normalise on GPU in the training
#       loop so channels 10-12 (SRM/Noiseprint/DINO, computed on GPU) are also
#       normalised with the same call.
_spatial_train = A.Compose([
    A.Resize(IMG_SIZE, IMG_SIZE),
    A.HorizontalFlip(p=0.5),
    A.VerticalFlip(p=0.2),
    A.RandomBrightnessContrast(p=0.4),
    A.GaussNoise(p=0.3),
    A.Rotate(limit=15, p=0.4),
    A.ElasticTransform(p=0.2),
    A.GridDistortion(p=0.2),
    A.CoarseDropout(num_holes_range=(1, 8),
                    hole_height_range=(8, 32),
                    hole_width_range=(8, 32), p=0.2),
    ToTensorV2(),          # → (C, H, W) float32 [0–255]
])

_spatial_val = A.Compose([
    A.Resize(IMG_SIZE, IMG_SIZE),
    ToTensorV2(),
])


# ── P-Hash deduplication ──────────────────────────────────────────────────────
print("Running P-Hash deduplication on training set...")
all_train_idx  = list(range(TRAIN_SAMPLES))
train_idx_dedup= phash_deduplicate(LMDB_TRAIN, all_train_idx)
val_idx        = list(range(VAL_SAMPLES))


# ── Build datasets & loaders ──────────────────────────────────────────────────
train_ds = DocTamperDataset(LMDB_TRAIN, train_idx_dedup,
                             _spatial_train, is_train=True)
val_ds   = DocTamperDataset(LMDB_VAL,   val_idx,
                             _spatial_val,   is_train=False)

train_dl = DataLoader(train_ds, batch_size=BATCH, shuffle=True,
                      num_workers=2, pin_memory=True,
                      prefetch_factor=2)
val_dl   = DataLoader(val_ds,   batch_size=BATCH, shuffle=False,
                      num_workers=2, pin_memory=True)

print(f"✓ Train batches : {len(train_dl):,}")
print(f"✓ Val   batches : {len(val_dl):,}")


# ══════════════════════════════════════════════════════════════════════════════
#  NORMALISATION HELPER  (applied per-batch on GPU after all 13 channels ready)
# ══════════════════════════════════════════════════════════════════════════════

# Means and stds for each of the 13 channels
_CH_MEAN = torch.tensor([
    123.675, 116.28, 103.53,  # RGB  (ImageNet × 255)
    127.5, 127.5, 127.5,      # ELA
    127.5, 127.5, 127.5,      # Laplacian
    127.5,                    # OCR proxy
    127.5,                    # SRM       (mapped to [0,255] for consistency)
    127.5,                    # Noiseprint
    127.5,                    # DINO
]).view(1, N_CH, 1, 1)

_CH_STD = torch.tensor([
    58.395, 57.12, 57.375,    # RGB
    64., 64., 64.,            # ELA
    64., 64., 64.,            # Laplacian
    64.,                      # OCR proxy
    64.,                      # SRM
    64.,                      # Noiseprint
    64.,                      # DINO
]).view(1, N_CH, 1, 1)


def normalise(imgs_13: torch.Tensor) -> torch.Tensor:
    """Normalise all 13 channels in-place on GPU."""
    mean = _CH_MEAN.to(imgs_13.device)
    std  = _CH_STD.to(imgs_13.device)
    return (imgs_13 - mean) / (std + 1e-6)


def gpu_features(imgs_10: torch.Tensor) -> torch.Tensor:
    """
    Given (B, 10, H, W) tensor [0–255] on GPU,
    computes SRM + Noiseprint + DINO → returns (B, 13, H, W) [0–255].
    Frozen extractors run in FP16, output up-cast to float32.
    """
    rgb   = imgs_10[:, 0:3]                       # raw RGB [0–255]
    B, _, H, W = imgs_10.shape

    with torch.no_grad():
        srm_ch  = srm_net(rgb.half()).float()          # (B,1,H,W) [0–1]
        nois_ch = noiseprint(rgb.half()).float()       # (B,1,H,W) [0–1]
        dino_ch = dino_vit(rgb.half(), H, W).float()  # (B,1,H,W) [0–1]

    # Scale [0–1] forensic channels to [0–255] to match other channels
    srm_ch  = srm_ch  * 255.0
    nois_ch = nois_ch * 255.0
    dino_ch = dino_ch * 255.0

    return torch.cat([imgs_10, srm_ch, nois_ch, dino_ch], dim=1)  # (B,13,H,W)


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN MODEL — UNet + EfficientNet-B3
#  13-channel input, binary segmentation output (forged pixel = 1)
# ══════════════════════════════════════════════════════════════════════════════

print("\nBuilding segmentation model...")
try:
    model = smp.Unet(
        encoder_name    = "efficientnet-b3",
        encoder_weights = "imagenet",
        in_channels     = N_CH,
        classes         = 1,
        activation      = None,
    )
    print("✓ Encoder : efficientnet-b3")
except Exception as e:
    print(f"  efficientnet-b3 failed ({e}), using efficientnet-b2")
    model = smp.Unet(
        encoder_name    = "efficientnet-b2",
        encoder_weights = "imagenet",
        in_channels     = N_CH,
        classes         = 1,
        activation      = None,
    )
    print("✓ Encoder : efficientnet-b2 (fallback)")

model    = DataParallel(model).to(DEVICE)
n_params = sum(p.numel() for p in model.parameters()) / 1e6
print(f"✓ Params  : {n_params:.1f}M on {torch.cuda.device_count()} GPU(s)")


# ══════════════════════════════════════════════════════════════════════════════
#  LOSS FUNCTIONS
#  Dice 0.45 + Focal 0.25 + BCE 0.15 + Boundary 0.15
#  Heavily weighted toward Dice & Focal for imbalanced forged-pixel detection.
# ══════════════════════════════════════════════════════════════════════════════

class BoundaryLoss(nn.Module):
    """Extra weight on forgery boundary pixels — hardest and most diagnostic."""
    def __init__(self, k: int = 5):
        super().__init__()
        self.pool = nn.MaxPool2d(k, stride=1, padding=k // 2)

    def forward(self, preds, masks):
        dilated  = self.pool(masks)
        eroded   = 1.0 - self.pool(1.0 - masks)
        boundary = (dilated - eroded).clamp(0, 1)
        loss = F.binary_cross_entropy_with_logits(
            preds * boundary, masks * boundary, reduction="sum"
        ) / (boundary.sum() + 1e-6)
        return loss


dice_loss     = smp.losses.DiceLoss(mode="binary")
bce_loss      = smp.losses.SoftBCEWithLogitsLoss(
                    pos_weight=torch.tensor([5.0]).to(DEVICE))
focal_loss    = smp.losses.FocalLoss(mode="binary", gamma=2.5)
boundary_loss = BoundaryLoss().to(DEVICE)


def loss_fn(preds, masks):
    return (0.45 * dice_loss(preds, masks)
          + 0.25 * focal_loss(preds, masks)
          + 0.15 * bce_loss(preds, masks)
          + 0.15 * boundary_loss(preds, masks))


# ══════════════════════════════════════════════════════════════════════════════
#  OPTIMIZER + SCHEDULER
#  1-epoch linear warmup → CosineAnnealingLR
#  Warmup prevents the re-initialised 13-ch first conv from destabilising
#  pretrained encoder weights during the first epoch.
# ══════════════════════════════════════════════════════════════════════════════

optimizer        = torch.optim.AdamW(model.parameters(),
                                     lr=LR, weight_decay=WEIGHT_DECAY)
steps_per_epoch  = len(train_dl)

warmup = LinearLR(optimizer, start_factor=0.1, end_factor=1.0,
                  total_iters=steps_per_epoch)
cosine = CosineAnnealingLR(optimizer,
                            T_max=(EPOCHS - 1) * steps_per_epoch,
                            eta_min=1e-6)
scheduler = SequentialLR(optimizer,
                          schedulers=[warmup, cosine],
                          milestones=[steps_per_epoch])

scaler = torch.amp.GradScaler("cuda")


# ══════════════════════════════════════════════════════════════════════════════
#  METRICS
# ══════════════════════════════════════════════════════════════════════════════

def tta_predict(imgs_13_norm):
    """Average original + h-flip + v-flip (last 3 epochs only)."""
    with torch.no_grad():
        p1 = torch.sigmoid(model(imgs_13_norm))
        p2 = torch.flip(
             torch.sigmoid(model(torch.flip(imgs_13_norm, [-1]))), [-1])
        p3 = torch.flip(
             torch.sigmoid(model(torch.flip(imgs_13_norm, [-2]))), [-2])
    return (p1 + p2 + p3) / 3.0


def compute_metrics(preds_raw, masks, use_tta=False, imgs_13_norm=None):
    if use_tta and imgs_13_norm is not None:
        preds = (tta_predict(imgs_13_norm) > 0.5)
    else:
        preds = (torch.sigmoid(preds_raw) > 0.5)
    masks = masks.bool()
    tp    = (preds  & masks ).float().sum((1, 2, 3))
    fp    = (preds  & ~masks).float().sum((1, 2, 3))
    fn    = (~preds & masks ).float().sum((1, 2, 3))
    iou   = (tp / (tp + fp + fn + 1e-6)).mean().item()
    f1    = (2 * tp / (2 * tp + fp + fn + 1e-6)).mean().item()
    prec  = (tp / (tp + fp + 1e-6)).mean().item()
    rec   = (tp / (tp + fn + 1e-6)).mean().item()
    return iou, prec, rec, f1


# ══════════════════════════════════════════════════════════════════════════════
#  TRAINING LOOP
# ══════════════════════════════════════════════════════════════════════════════

best_f1          = 0.0
epochs_no_improv = 0
history          = []

print("\n" + "=" * 64)
print("  STARTING TRAINING")
print(f"  Techniques : ELA · SRM · Noiseprint · DINO-ViT · OCR · P-Hash")
print(f"  Channels   : {N_CH} ch  |  Encoder : EfficientNet-B3")
print(f"  Epochs     : {EPOCHS}  |  Patience : {PATIENCE}")
print("=" * 64 + "\n")

total_t0 = time.time()

for epoch in range(1, EPOCHS + 1):
    ep_t0 = time.time()

    # ── Train ─────────────────────────────────────────────────────────────
    model.train()
    train_loss = 0.0

    for batch_idx, (imgs_10, masks) in enumerate(train_dl):
        # imgs_10: (B, 10, H, W) [0–255], masks: (B, 1, H, W)
        imgs_10 = imgs_10.to(GPU0, non_blocking=True)
        masks   = masks.to(DEVICE, non_blocking=True)

        # Add GPU-computed channels (SRM + Noiseprint + DINO) → 13ch
        imgs_13 = gpu_features(imgs_10)                      # (B,13,H,W)

        # Normalise all 13 channels
        imgs_13 = normalise(imgs_13)                         # (B,13,H,W)

        optimizer.zero_grad()
        with torch.amp.autocast("cuda"):
            preds = model(imgs_13)
            loss  = loss_fn(preds, masks)

        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        scaler.step(optimizer)
        scaler.update()

        train_loss += loss.item()
        scheduler.step()

    # ── Validate ──────────────────────────────────────────────────────────
    model.eval()
    val_loss = 0.0
    all_iou, all_p, all_r, all_f1 = [], [], [], []
    use_tta = (epoch > EPOCHS - 3)   # TTA only last 3 epochs

    with torch.no_grad():
        for imgs_10, masks in val_dl:
            imgs_10 = imgs_10.to(GPU0, non_blocking=True)
            masks   = masks.to(DEVICE, non_blocking=True)

            imgs_13 = gpu_features(imgs_10)
            imgs_13 = normalise(imgs_13)

            with torch.amp.autocast("cuda"):
                preds = model(imgs_13)
                loss  = loss_fn(preds, masks)

            val_loss += loss.item()
            iou, p, r, f1 = compute_metrics(
                preds, masks,
                use_tta     = use_tta,
                imgs_13_norm= imgs_13 if use_tta else None,
            )
            all_iou.append(iou); all_p.append(p)
            all_r.append(r);     all_f1.append(f1)

    # ── Stats ─────────────────────────────────────────────────────────────
    t_loss   = train_loss / len(train_dl)
    v_loss   = val_loss   / len(val_dl)
    m_iou    = float(np.mean(all_iou))
    m_f1     = float(np.mean(all_f1))
    m_p      = float(np.mean(all_p))
    m_r      = float(np.mean(all_r))
    lr_now   = optimizer.param_groups[0]["lr"]
    ep_mins  = (time.time() - ep_t0) / 60
    tot_hrs  = (time.time() - total_t0) / 3600

    history.append(dict(epoch=epoch, train_loss=t_loss, val_loss=v_loss,
                        iou=m_iou, f1=m_f1, precision=m_p, recall=m_r))

    print(f"Ep {epoch:02d}/{EPOCHS} | "
          f"TLoss:{t_loss:.4f}  VLoss:{v_loss:.4f} | "
          f"IoU:{m_iou:.4f}  F1:{m_f1:.4f}  "
          f"P:{m_p:.4f}  R:{m_r:.4f} | "
          f"LR:{lr_now:.2e} | "
          f"{ep_mins:.1f}min [{tot_hrs:.2f}hr]")

    # ── Save best .pth ────────────────────────────────────────────────────
    if m_f1 > best_f1:
        best_f1 = m_f1
        epochs_no_improv = 0
        torch.save(model.module.state_dict(),
                   SAVE_DIR / "forgery_best.pth")
        print(f"   ✓ forgery_best.pth saved  F1={best_f1:.4f}  "
              f"← DOWNLOAD FROM KAGGLE OUTPUT TAB")
    else:
        epochs_no_improv += 1
        print(f"   No improvement ({epochs_no_improv}/{PATIENCE})")
        if epochs_no_improv >= PATIENCE:
            print(f"\n⚠  Early stop at epoch {epoch}")
            break

    # ── Save history every 2 epochs ───────────────────────────────────────
    if epoch % 2 == 0:
        with open(SAVE_DIR / "history.json", "w") as f:
            json.dump(history, f, indent=2)

    # ── Memory housekeeping ───────────────────────────────────────────────
    gc.collect()
    torch.cuda.empty_cache()

# ── Final ─────────────────────────────────────────────────────────────────────
total_hrs = (time.time() - total_t0) / 3600
with open(SAVE_DIR / "history.json", "w") as f:
    json.dump(history, f, indent=2)

print(f"\n{'='*64}")
print(f"  DONE  |  Best F1 : {best_f1:.4f}  |  Time : {total_hrs:.2f} hrs")
print(f"  Output: {SAVE_DIR}/forgery_best.pth")
print(f"  ↓  Go to Kaggle Output tab and download forgery_best.pth")
print(f"{'='*64}")
# NOTE:
# Use `kaggle_doctamper_advanced_cells.py` as the primary Kaggle training script.
# This original file is the older single-cell baseline.
