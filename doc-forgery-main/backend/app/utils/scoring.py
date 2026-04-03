from __future__ import annotations

import numpy as np

from app.core.config import Settings
from app.schemas.responses import EngineScores, Verdict


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def map_score(map_array: np.ndarray, top_fraction: float = 0.05) -> float:
    values = map_array.astype(np.float32).flatten()
    if values.size == 0:
        return 0.0
    k = max(1, int(values.size * top_fraction))
    top_values = np.partition(values, -k)[-k:]
    return clamp01(float(top_values.mean()))


def segmentation_score(probability_map: np.ndarray, binary_mask: np.ndarray) -> float:
    area_fraction = float(binary_mask.mean() / 255.0)
    confidence = map_score(probability_map, top_fraction=0.02)
    return clamp01((0.75 * confidence) + (0.25 * min(1.0, area_fraction * 4.0)))


def forensic_risk_score(settings: Settings, engine_scores: EngineScores) -> float:
    weights = settings.score_weights
    components = [
        (engine_scores.ela_score, weights.ela),
        (engine_scores.srm_score, weights.srm),
        (engine_scores.noiseprint_score, weights.noiseprint),
        (engine_scores.dino_vit_score, weights.dino_vit),
        (engine_scores.ocr_anomaly_score, weights.ocr_anomaly),
        (engine_scores.phash_score, weights.phash),
    ]

    if settings.enable_segmentation_in_final_score and weights.segmentation > 0.0:
        components.append((engine_scores.segmentation_score, weights.segmentation))

    total_weight = sum(weight for _, weight in components)
    if total_weight <= 0:
        return 0.0
    score = sum(value * weight for value, weight in components) / total_weight
    return clamp01(score)


def verdict_for_score(settings: Settings, score: float) -> Verdict:
    if score < settings.verdict_thresholds.clean_upper:
        return Verdict.CLEAN
    if score < settings.verdict_thresholds.suspicious_upper:
        return Verdict.SUSPICIOUS
    return Verdict.CONFIRMED_FORGERY
