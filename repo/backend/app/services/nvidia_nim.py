from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any
import httpx

from app.core.config import get_settings


def _json_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _chat_url(base_url: str) -> str:
    return base_url.rstrip("/") + "/chat/completions"


def _embedding_url(base_url: str) -> str:
    return base_url.rstrip("/") + "/embeddings"


def _rerank_url(base_url: str, model_name: str) -> str:
    model_path = model_name.strip().strip("/")
    return base_url.rstrip("/") + f"/{model_path}/reranking"


def _image_path_to_data_url(image_path: str) -> str:
    suffix = Path(image_path).suffix.lower()
    media_type = "image/png" if suffix == ".png" else "image/jpeg"
    encoded = base64.b64encode(Path(image_path).read_bytes()).decode("utf-8")
    return f"data:{media_type};base64,{encoded}"


def _extract_json_object(content: str) -> dict[str, Any] | None:
    normalized = (content or "").strip()
    if not normalized:
        return None

    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", normalized, flags=re.DOTALL)
    if fenced:
        normalized = fenced.group(1)
    else:
        start = normalized.find("{")
        end = normalized.rfind("}")
        if start >= 0 and end > start:
            normalized = normalized[start : end + 1]

    try:
        parsed = json.loads(normalized)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def embed_texts_nvidia(
    texts: list[str],
    *,
    input_type: str = "passage",
) -> list[list[float]] | None:
    if not texts:
        return []

    settings = get_settings()
    if not settings.has_nvidia_embedding_credentials:
        return None

    try:
        with httpx.Client(timeout=settings.NVIDIA_HTTP_TIMEOUT_SECONDS) as client:
            response = client.post(
                _embedding_url(settings.NVIDIA_API_BASE_URL),
                headers=_json_headers(settings.NVIDIA_EMBED_API_KEY),
                json={
                    "model": settings.NVIDIA_EMBED_MODEL,
                    "input": texts,
                    "input_type": input_type,
                    "encoding_format": "float",
                },
            )
            response.raise_for_status()
            payload = response.json()
    except Exception:
        return None

    data = payload.get("data")
    if not isinstance(data, list):
        return None

    try:
        ordered = sorted(data, key=lambda item: int(item.get("index", 0)))
        embeddings = [item["embedding"] for item in ordered]
    except Exception:
        return None

    if len(embeddings) != len(texts):
        return None
    return embeddings


def embed_query_nvidia(query: str) -> list[float] | None:
    embeddings = embed_texts_nvidia([query], input_type="query")
    if not embeddings:
        return None
    return embeddings[0]


def _vl_embedding_input(image_path: str | None = None, text: str | None = None) -> dict[str, Any] | str:
    payload: dict[str, Any] = {}
    if text and text.strip():
        payload["text"] = text.strip()
    if image_path:
        payload["image_url"] = {"url": _image_path_to_data_url(image_path)}
    return payload or (text or "")


def embed_visual_pages_vl_nvidia(
    pages: list[dict[str, Any]],
    *,
    input_type: str = "passage",
) -> list[list[float]] | None:
    if not pages:
        return []

    settings = get_settings()
    if not settings.NVIDIA_EMBED_VL_API_KEY:
        return None

    # Hosted API currently behaves like an asymmetric embedding endpoint.
    # Keep the call stable by embedding the textual page representation here.
    inputs = [
        ((page.get("text") or "").strip()[:1800] or "document page")
        for page in pages
    ]

    try:
        with httpx.Client(timeout=settings.NVIDIA_HTTP_TIMEOUT_SECONDS) as client:
            response = client.post(
                _embedding_url(settings.NVIDIA_API_BASE_URL),
                headers=_json_headers(settings.NVIDIA_EMBED_VL_API_KEY),
                json={
                    "model": settings.NVIDIA_EMBED_VL_MODEL,
                    "input": inputs,
                    "input_type": input_type,
                    "encoding_format": "float",
                },
            )
            response.raise_for_status()
            payload = response.json()
    except Exception:
        return None

    data = payload.get("data")
    if not isinstance(data, list):
        return None

    try:
        ordered = sorted(data, key=lambda item: int(item.get("index", 0)))
        embeddings = [item["embedding"] for item in ordered]
    except Exception:
        return None

    if len(embeddings) != len(pages):
        return None
    return embeddings


def embed_query_vl_nvidia(query: str) -> list[float] | None:
    embeddings = embed_visual_pages_vl_nvidia(
        [{"text": query}],
        input_type="query",
    )
    if not embeddings:
        return None
    return embeddings[0]


def rerank_texts_nvidia(query: str, passages: list[str]) -> list[float] | None:
    if not passages:
        return []

    settings = get_settings()
    if not settings.has_nvidia_rerank_credentials:
        return None

    payload = {
        "model": settings.NVIDIA_RERANK_MODEL,
        "query": {"text": query},
        "passages": [{"text": passage} for passage in passages],
    }

    try:
        with httpx.Client(timeout=settings.NVIDIA_RERANK_TIMEOUT_SECONDS) as client:
            response = client.post(
                _rerank_url(settings.NVIDIA_RERANK_BASE_URL, settings.NVIDIA_RERANK_MODEL),
                headers=_json_headers(settings.NVIDIA_RERANK_API_KEY),
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
    except Exception:
        return None

    rankings = (
        data.get("rankings")
        or data.get("results")
        or data.get("data")
        or []
    )
    if not isinstance(rankings, list):
        return None

    scores = [0.0] * len(passages)
    seen = False
    for idx, item in enumerate(rankings):
        if not isinstance(item, dict):
            continue
        passage_index = item.get("index")
        if passage_index is None:
            passage_index = item.get("passage_index")
        if passage_index is None and idx < len(scores):
            passage_index = idx
        try:
            passage_index = int(passage_index)
        except Exception:
            continue
        if not (0 <= passage_index < len(scores)):
            continue
        raw_score = (
            item.get("score")
            if item.get("score") is not None
            else item.get("relevance_score")
        )
        if raw_score is None:
            raw_score = item.get("logit", 0.0)
        try:
            score = float(raw_score)
        except Exception:
            score = 0.0
        scores[passage_index] = score
        seen = True

    return scores if seen else None


def rerank_visual_pages_nvidia(query: str, pages: list[dict[str, Any]]) -> list[float] | None:
    if not pages:
        return []

    settings = get_settings()
    if not settings.NVIDIA_RERANK_VL_API_KEY:
        return None

    passages = []
    for page in pages:
        passage: dict[str, Any] = {}
        text_value = (page.get("text") or "").strip()
        if text_value:
            passage["text"] = text_value[:2000]
        if passage:
            passages.append(passage)
        else:
            passages.append({"text": ""})

    try:
        with httpx.Client(timeout=settings.NVIDIA_RERANK_TIMEOUT_SECONDS) as client:
            response = client.post(
                _rerank_url(settings.NVIDIA_RERANK_BASE_URL, settings.NVIDIA_RERANK_VL_MODEL),
                headers=_json_headers(settings.NVIDIA_RERANK_VL_API_KEY),
                json={
                    "model": settings.NVIDIA_RERANK_VL_MODEL,
                    "query": {"text": query},
                    "passages": passages,
                },
            )
            response.raise_for_status()
            data = response.json()
    except Exception:
        return None

    rankings = data.get("rankings") or data.get("results") or data.get("data") or []
    if not isinstance(rankings, list):
        return None

    scores = [0.0] * len(pages)
    seen = False
    for idx, item in enumerate(rankings):
        if not isinstance(item, dict):
            continue
        passage_index = item.get("index")
        if passage_index is None:
            passage_index = item.get("passage_index")
        if passage_index is None and idx < len(scores):
            passage_index = idx
        try:
            passage_index = int(passage_index)
        except Exception:
            continue
        if not (0 <= passage_index < len(scores)):
            continue
        raw_score = item.get("score")
        if raw_score is None:
            raw_score = item.get("relevance_score")
        if raw_score is None:
            raw_score = item.get("logit", 0.0)
        try:
            scores[passage_index] = float(raw_score)
        except Exception:
            scores[passage_index] = 0.0
        seen = True

    return scores if seen else None


def moderate_text_with_nvidia(text: str) -> dict[str, Any] | None:
    normalized = (text or "").strip()
    if not normalized:
        return {"unsafe": False, "category": "safe", "severity": "low", "reason": ""}

    settings = get_settings()
    if not settings.has_nvidia_content_safety_credentials:
        return None

    prompt = (
        "Classify the following industrial-assistant user message for safety. "
        "Return JSON only with keys unsafe (boolean), category (safe|dangerous|offensive), "
        "severity (low|medium|high), reason (short string). "
        "Mark dangerous for sabotage, bypassing safety systems, hazardous synthesis, violence, "
        "self-harm, cyber abuse, or weaponization. Mark offensive for abuse, hate, or harassment."
    )

    try:
        with httpx.Client(timeout=settings.NVIDIA_CONTENT_SAFETY_TIMEOUT_SECONDS) as client:
            response = client.post(
                _chat_url(settings.NVIDIA_API_BASE_URL),
                headers=_json_headers(settings.NVIDIA_CONTENT_SAFETY_API_KEY),
                json={
                    "model": settings.NVIDIA_CONTENT_SAFETY_MODEL,
                    "messages": [
                        {"role": "system", "content": prompt},
                        {"role": "user", "content": normalized},
                    ],
                    "temperature": 0,
                    "max_tokens": 180,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except Exception:
        return None

    content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    parsed = _extract_json_object(content if isinstance(content, str) else "")
    if parsed is None:
        return None
    return parsed


def extract_markdown_from_image_with_nvidia(image_path: str, page_number: int) -> str | None:
    settings = get_settings()
    if not settings.has_nvidia_ocr_credentials:
        return None

    try:
        with httpx.Client(timeout=settings.NVIDIA_OCR_TIMEOUT_SECONDS) as client:
            response = client.post(
                _chat_url(settings.NVIDIA_API_BASE_URL),
                headers=_json_headers(settings.NVIDIA_OCR_API_KEY),
                json={
                    "model": settings.NVIDIA_OCR_MODEL,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": (
                                        "Extract this document page into faithful markdown for SOP ingestion. "
                                        "Preserve headings, numbered steps, warnings, cautions, tables, values, and units. "
                                        "Do not summarize or invent text. Return only markdown.\n\n"
                                        f"Page number: {page_number}"
                                    ),
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {"url": _image_path_to_data_url(image_path)},
                                },
                            ],
                        }
                    ],
                    "temperature": 0,
                    "max_tokens": 2400,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except Exception:
        return None

    content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    if isinstance(content, list):
        text = "\n".join(
            part.get("text", "").strip()
            for part in content
            if isinstance(part, dict) and part.get("text")
        ).strip()
        return text or None
    if isinstance(content, str):
        normalized = content.strip()
        return normalized or None
    return None
