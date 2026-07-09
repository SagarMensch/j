from __future__ import annotations

import math
import re
import time
from functools import lru_cache
from typing import Any

from app.core.config import get_settings
from app.services.nvidia_nim import rerank_texts_nvidia, rerank_visual_pages_nvidia


_STOPWORDS = frozenset({
    "the", "and", "for", "with", "from", "that", "this", "what", "when",
    "where", "which", "about", "into", "your", "have", "has", "had",
    "are", "was", "were", "will", "would", "could", "should", "can",
    "may", "not", "all", "any", "how", "why", "who", "does", "did",
    "been", "being", "than", "then", "there", "their", "them", "they",
    "you", "our", "out", "use", "is", "it", "its", "in", "on", "at",
    "to", "of", "a", "an", "by", "as", "or", "but", "be", "do", "no",
    "so", "if", "up", "my", "he", "she", "we", "me", "him", "her",
    "us", "them", "am", "one", "two", "also", "much", "many", "some",
    "very", "just", "than", "too", "here", "only",
})


def _tokenize(text: str) -> list[str]:
    tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9/_\.\-]{1,}", (text or "").lower())
    return [token for token in tokens if token not in _STOPWORDS and len(token) > 1]


def _ngram_set(tokens: list[str], n: int) -> set[str]:
    if len(tokens) < n:
        return set()
    return {" ".join(tokens[i : i + n]) for i in range(len(tokens) - n + 1)}


def _normalize_score(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


def _normalize_scores(raw_scores: dict[int, float]) -> dict[int, float]:
    if not raw_scores:
        return {}
    values = list(raw_scores.values())
    v_min = min(values)
    v_max = max(values)
    if v_max - v_min < 1e-9:
        baseline = 1.0 if v_max > 0 else 0.0
        return {key: baseline for key in raw_scores}
    return {
        key: _normalize_score((value - v_min) / (v_max - v_min))
        for key, value in raw_scores.items()
    }


def _extract_entities_from_text(text: str) -> dict[str, list[str]]:
    entities: dict[str, list[str]] = {
        "equipment": [],
        "chemical": [],
        "procedure": [],
        "safety": [],
    }
    equipment_pattern = re.compile(r"\b[A-Z]{2,5}[-_]?\d{2,6}\b")
    for m in equipment_pattern.finditer(text):
        entities["equipment"].append(m.group(0))

    safety_keywords = ["warning", "caution", "danger", "hazard", "risk", "safety", "ppe", "protective"]
    for kw in safety_keywords:
        if kw in text.lower():
            entities["safety"].append(kw)

    procedure_keywords = ["step", "procedure", "protocol", "process", "method", "instruction"]
    for kw in procedure_keywords:
        if kw in text.lower():
            entities["procedure"].append(kw)

    return entities


def _light_features(query_text: str, evidence: dict[str, Any]) -> dict[str, float]:
    query_tokens = _tokenize(query_text)
    query_set = set(query_tokens)

    content_tokens = _tokenize(evidence.get("content") or "")
    content_set = set(content_tokens)
    section_tokens = _tokenize(evidence.get("section_title") or "")
    citation_tokens = _tokenize(evidence.get("citation_label") or "")
    title_tokens = _tokenize(evidence.get("document_title") or "")

    if query_set:
        token_coverage = len(query_set.intersection(content_set)) / len(query_set)
        header_hits = len(query_set.intersection(section_tokens + citation_tokens + title_tokens))
        header_coverage = header_hits / len(query_set)
    else:
        token_coverage = 0.0
        header_coverage = 0.0

    query_bigrams = _ngram_set(query_tokens, 2)
    content_bigrams = _ngram_set(content_tokens, 2)
    if query_bigrams:
        phrase_overlap = len(query_bigrams.intersection(content_bigrams)) / len(query_bigrams)
    else:
        phrase_overlap = 0.0

    query_trigrams = _ngram_set(query_tokens, 3)
    content_trigrams = _ngram_set(content_tokens, 3)
    if query_trigrams:
        long_phrase_overlap = len(query_trigrams.intersection(content_trigrams)) / len(query_trigrams)
    else:
        long_phrase_overlap = 0.0

    content_length = len(evidence.get("content") or "")
    if content_length < 80:
        short_penalty = 0.15
    elif content_length < 120:
        short_penalty = 0.08
    elif content_length > 2000:
        short_penalty = 0.03
    else:
        short_penalty = 0.0

    query_entities = _extract_entities_from_text(query_text)
    content_entities = _extract_entities_from_text(evidence.get("content") or "")
    entity_overlap = 0.0
    for ent_type in query_entities:
        q_ents = set(query_entities[ent_type])
        c_ents = set(content_entities[ent_type])
        if q_ents:
            entity_overlap += len(q_ents.intersection(c_ents)) / len(q_ents)
    entity_overlap = min(entity_overlap / max(len(query_entities), 1), 1.0)

    exact_match_bonus = 0.0
    if query_text.lower().strip() in (evidence.get("content") or "").lower():
        exact_match_bonus = 0.15

    section_type_bonus = 0.0
    chunk_type = evidence.get("chunk_type", "")
    if chunk_type in ("warning", "safety"):
        if any(kw in query_text.lower() for kw in ["warning", "caution", "danger", "safety", "hazard"]):
            section_type_bonus = 0.12
    elif chunk_type == "procedure":
        if any(kw in query_text.lower() for kw in ["step", "procedure", "how", "process"]):
            section_type_bonus = 0.10
    elif chunk_type == "table_like":
        if any(kw in query_text.lower() for kw in ["table", "data", "value", "specification"]):
            section_type_bonus = 0.08

    return {
        "token_coverage": _normalize_score(token_coverage),
        "phrase_overlap": _normalize_score(phrase_overlap),
        "long_phrase_overlap": _normalize_score(long_phrase_overlap),
        "header_coverage": _normalize_score(header_coverage),
        "short_penalty": short_penalty,
        "entity_overlap": _normalize_score(entity_overlap),
        "exact_match_bonus": _normalize_score(exact_match_bonus),
        "section_type_bonus": _normalize_score(section_type_bonus),
    }


@lru_cache(maxsize=1)
def _load_cross_encoder(model_name: str):
    from sentence_transformers import CrossEncoder
    settings = get_settings()
    kwargs = {"device": "cpu"}
    if settings.HF_TOKEN:
        kwargs["token"] = settings.HF_TOKEN
    try:
        return CrossEncoder(model_name, **kwargs)
    except TypeError:
        kwargs.pop("token", None)
        if settings.HF_TOKEN:
            kwargs["use_auth_token"] = settings.HF_TOKEN
        return CrossEncoder(model_name, **kwargs)


def _cross_encoder_scores(query_text: str, evidence: list[dict[str, Any]]) -> list[float] | None:
    settings = get_settings()
    try:
        model = _load_cross_encoder(settings.RETRIEVAL_RERANKER_MODEL)
        pairs = [
            (
                query_text,
                " ".join(
                    part
                    for part in [
                        evidence_item.get("document_title") or "",
                        evidence_item.get("section_title") or "",
                        evidence_item.get("citation_label") or "",
                        (evidence_item.get("content") or "")[:1200],
                    ]
                    if part
                ),
            )
            for evidence_item in evidence
        ]
        if not pairs:
            return []
        raw_scores = model.predict(
            pairs,
            batch_size=max(1, settings.RETRIEVAL_RERANKER_BATCH_SIZE),
            show_progress_bar=False,
        )
        return [1.0 / (1.0 + math.exp(-float(score))) for score in raw_scores]
    except Exception:
        return None


def rerank_evidence(
    *,
    query_text: str,
    evidence: list[dict[str, Any]],
    top_k: int,
    mode: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    started = time.perf_counter()
    settings = get_settings()

    selected_mode = (mode or settings.RETRIEVAL_RERANKER_MODE or "light").strip().lower()
    selected_provider = (settings.RETRIEVAL_RERANKER_PROVIDER or "local").strip().lower()
    items = [dict(item) for item in evidence]
    if not items:
        return [], {"mode": selected_mode, "provider": selected_provider, "latency_ms": 0, "fallback": None}

    applied_mode = selected_mode
    applied_provider = selected_provider
    fallback: str | None = None

    cross_scores: list[float] | None = None
    nvidia_scores: list[float] | None = None
    nvidia_scores_norm: dict[int, float] = {}
    nvidia_vl_scores_norm: dict[int, float] = {}
    visual_indices: list[int] = []

    if selected_provider == "nvidia":
        passages = [
            " ".join(
                part
                for part in [
                    item.get("document_title") or "",
                    item.get("section_title") or "",
                    item.get("citation_label") or "",
                    (item.get("content") or "")[:1800],
                ]
                if part
            )
            for item in items
        ]
        nvidia_scores = rerank_texts_nvidia(query_text, passages)
        if nvidia_scores is None:
            applied_provider = "local"
            fallback = "nvidia_reranker_unavailable"
        else:
            nvidia_scores_norm = _normalize_scores(
                {idx: float(score) for idx, score in enumerate(nvidia_scores)}
            )

        visual_items = []
        for idx, item in enumerate(items):
            if item.get("image_path"):
                visual_indices.append(idx)
                visual_items.append(
                    {
                        "text": " ".join(
                            part
                            for part in [
                                item.get("document_title") or "",
                                item.get("section_title") or "",
                                item.get("citation_label") or "",
                                (item.get("content") or "")[:2000],
                            ]
                            if part
                        ),
                        "image_path": item.get("image_path"),
                    }
                )
        if visual_items:
            vl_scores = rerank_visual_pages_nvidia(query_text, visual_items)
            if vl_scores is not None:
                nvidia_vl_scores_norm = _normalize_scores(
                    {visual_indices[idx]: float(score) for idx, score in enumerate(vl_scores)}
                )

    if applied_provider == "local" and selected_mode == "cross_encoder":
        cross_scores = _cross_encoder_scores(query_text, items)
        if cross_scores is None:
            applied_mode = "light"
            fallback = "cross_encoder_unavailable" if fallback is None else fallback
    elif applied_provider == "local" and selected_mode in {"none", "off", "disabled"}:
        applied_mode = "off"

    for idx, item in enumerate(items):
        scores = dict(item.get("scores") or {})
        base_score = float(scores.get("final", 0.0))
        page_match = float(scores.get("page_match", 0.0))
        rrf_position = float(scores.get("rrf_position", 0.0))
        feature = _light_features(query_text, item)

        if applied_provider == "nvidia" and nvidia_scores is not None:
            try:
                nvidia_score = float(nvidia_scores[idx])
            except Exception:
                nvidia_score = 0.0
            normalized_nvidia_score = nvidia_scores_norm.get(idx, 0.0)
            normalized_nvidia_vl_score = nvidia_vl_scores_norm.get(idx, 0.0)

            rerank_score = (
                0.18 * base_score
                + 0.30 * normalized_nvidia_score
                + 0.22 * normalized_nvidia_vl_score
                + 0.08 * page_match
                + 0.05 * rrf_position
                + 0.07 * feature["token_coverage"]
                + 0.04 * feature["phrase_overlap"]
                + 0.03 * feature["header_coverage"]
                + 0.02 * feature["entity_overlap"]
                + 0.03 * feature["exact_match_bonus"]
                + 0.02 * feature["section_type_bonus"]
                - feature["short_penalty"]
            )
            cross_score = None
            scores["nvidia_rerank_raw"] = round(nvidia_score, 6)
            scores["nvidia_rerank"] = round(normalized_nvidia_score, 6)
            if idx in nvidia_vl_scores_norm:
                scores["nvidia_vl_rerank"] = round(normalized_nvidia_vl_score, 6)
        elif applied_mode == "off":
            rerank_score = base_score
            cross_score = None
        elif applied_mode == "cross_encoder" and cross_scores is not None:
            cross_score = float(cross_scores[idx])
            rerank_score = (
                0.25 * base_score
                + 0.45 * cross_score
                + 0.08 * page_match
                + 0.05 * rrf_position
                + 0.07 * feature["token_coverage"]
                + 0.04 * feature["phrase_overlap"]
                + 0.03 * feature["header_coverage"]
                + 0.02 * feature["entity_overlap"]
                + 0.03 * feature["exact_match_bonus"]
                - feature["short_penalty"]
            )
        else:
            cross_score = None
            rerank_score = (
                0.35 * base_score
                + 0.10 * page_match
                + 0.08 * rrf_position
                + 0.18 * feature["token_coverage"]
                + 0.12 * feature["phrase_overlap"]
                + 0.05 * feature["long_phrase_overlap"]
                + 0.05 * feature["header_coverage"]
                + 0.03 * feature["entity_overlap"]
                + 0.03 * feature["exact_match_bonus"]
                + 0.02 * feature["section_type_bonus"]
                - feature["short_penalty"]
            )

        rerank_score = _normalize_score(float(rerank_score))
        scores["base_final"] = round(base_score, 6)
        scores["token_coverage"] = round(feature["token_coverage"], 6)
        scores["phrase_overlap"] = round(feature["phrase_overlap"], 6)
        scores["long_phrase_overlap"] = round(feature["long_phrase_overlap"], 6)
        scores["header_coverage"] = round(feature["header_coverage"], 6)
        scores["entity_overlap"] = round(feature["entity_overlap"], 6)
        scores["exact_match_bonus"] = round(feature["exact_match_bonus"], 6)
        scores["section_type_bonus"] = round(feature["section_type_bonus"], 6)
        scores["page_match"] = round(page_match, 6)
        scores["rrf_position"] = round(rrf_position, 6)
        scores["rerank"] = round(rerank_score, 6)
        if cross_score is not None:
            scores["cross_encoder"] = round(cross_score, 6)
        scores["final"] = round(rerank_score, 6)

        item["scores"] = scores

    items.sort(key=lambda x: float((x.get("scores") or {}).get("final", 0.0)), reverse=True)
    reranked = items[: max(1, top_k)]
    latency_ms = int((time.perf_counter() - started) * 1000)

    diagnostics = {
        "mode": applied_mode,
        "provider": applied_provider,
        "requested_provider": selected_provider,
        "requested_mode": selected_mode,
        "fallback": fallback,
        "latency_ms": latency_ms,
        "candidates": len(items),
        "features_used": [
            "token_coverage", "phrase_overlap", "long_phrase_overlap",
            "header_coverage", "entity_overlap", "exact_match_bonus",
            "section_type_bonus", "short_penalty", "rrf_position",
        ],
    }
    return reranked, diagnostics
