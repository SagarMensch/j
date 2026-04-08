from __future__ import annotations

import math
import re
import time
from functools import lru_cache
from typing import Any

from app.core.config import get_settings


_STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "what",
    "when",
    "where",
    "which",
    "about",
    "into",
    "your",
    "have",
    "has",
    "had",
    "are",
    "was",
    "were",
    "will",
    "would",
    "could",
    "should",
    "can",
    "may",
    "not",
    "all",
    "any",
    "how",
    "why",
    "who",
    "does",
    "did",
    "been",
    "being",
    "than",
    "then",
    "there",
    "their",
    "them",
    "they",
    "you",
    "our",
    "out",
    "use",
}


def _tokenize(text: str) -> list[str]:
    tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9/_-]{1,}", (text or "").lower())
    return [token for token in tokens if token not in _STOPWORDS]


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

    content_length = len(evidence.get("content") or "")
    short_penalty = 0.10 if content_length < 120 else 0.0

    return {
        "token_coverage": _normalize_score(token_coverage),
        "phrase_overlap": _normalize_score(phrase_overlap),
        "header_coverage": _normalize_score(header_coverage),
        "short_penalty": short_penalty,
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
    items = [dict(item) for item in evidence]
    if not items:
        return [], {"mode": selected_mode, "latency_ms": 0, "fallback": None}

    applied_mode = selected_mode
    fallback: str | None = None

    cross_scores: list[float] | None = None
    if selected_mode == "cross_encoder":
        cross_scores = _cross_encoder_scores(query_text, items)
        if cross_scores is None:
            applied_mode = "light"
            fallback = "cross_encoder_unavailable"
    elif selected_mode in {"none", "off", "disabled"}:
        applied_mode = "off"

    for idx, item in enumerate(items):
        scores = dict(item.get("scores") or {})
        base_score = float(scores.get("final", 0.0))
        feature = _light_features(query_text, item)

        if applied_mode == "off":
            rerank_score = base_score
            cross_score = None
        elif applied_mode == "cross_encoder" and cross_scores is not None:
            cross_score = float(cross_scores[idx])
            rerank_score = (
                0.38 * base_score
                + 0.47 * cross_score
                + 0.10 * feature["token_coverage"]
                + 0.05 * feature["header_coverage"]
                - feature["short_penalty"]
            )
        else:
            cross_score = None
            rerank_score = (
                0.55 * base_score
                + 0.25 * feature["token_coverage"]
                + 0.12 * feature["phrase_overlap"]
                + 0.08 * feature["header_coverage"]
                - feature["short_penalty"]
            )

        rerank_score = _normalize_score(float(rerank_score))
        scores["base_final"] = round(base_score, 6)
        scores["token_coverage"] = round(feature["token_coverage"], 6)
        scores["phrase_overlap"] = round(feature["phrase_overlap"], 6)
        scores["header_coverage"] = round(feature["header_coverage"], 6)
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
        "requested_mode": selected_mode,
        "fallback": fallback,
        "latency_ms": latency_ms,
        "candidates": len(items),
    }
    return reranked, diagnostics
