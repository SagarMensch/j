from __future__ import annotations

import hashlib

import cv2
import numpy as np
from PIL import Image


def md5_bytes(payload: bytes) -> str:
    return hashlib.md5(payload).hexdigest()


def md5_file(path: str) -> str:
    digest = hashlib.md5()
    with open(path, "rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(8192), b""):
            digest.update(chunk)
    return digest.hexdigest()


def phash_from_image(
    image: Image.Image,
    hash_size: int = 8,
    highfreq_factor: int = 4,
) -> str:
    size = hash_size * highfreq_factor
    grayscale = image.convert("L").resize((size, size), Image.Resampling.LANCZOS)
    pixels = np.asarray(grayscale, dtype=np.float32)
    dct = cv2.dct(pixels)
    low_frequency = dct[:hash_size, :hash_size]
    median = float(np.median(low_frequency[1:, 1:]))
    bits = low_frequency > median
    bit_string = "".join("1" if bit else "0" for bit in bits.flatten())
    width = len(bit_string) // 4
    return f"{int(bit_string, 2):0{width}x}"


def hamming_distance(hash_a: str, hash_b: str) -> int:
    bits_a = bin(int(hash_a, 16))[2:].zfill(len(hash_a) * 4)
    bits_b = bin(int(hash_b, 16))[2:].zfill(len(hash_b) * 4)
    return sum(bit_a != bit_b for bit_a, bit_b in zip(bits_a, bits_b, strict=True))
