"""
Caching layer for fast responses - caches common queries, embeddings, and retrieval results.
"""
from __future__ import annotations

import hashlib
import json
import time
from functools import lru_cache
from typing import Any


class ResponseCache:
    def __init__(self, max_size: int = 1000, ttl_seconds: int = 3600):
        self._cache: dict[str, dict[str, Any]] = {}
        self._max_size = max_size
        self._ttl = ttl_seconds

    def _key(self, query: str, scope: str, revision_id: str | None = None) -> str:
        raw = f"{query.lower().strip()}|{scope}|{revision_id or ''}"
        return hashlib.md5(raw.encode()).hexdigest()

    def get(self, query: str, scope: str, revision_id: str | None = None) -> dict[str, Any] | None:
        key = self._key(query, scope, revision_id)
        entry = self._cache.get(key)
        if entry and time.time() - entry["timestamp"] < self._ttl:
            return entry["value"]
        if entry:
            del self._cache[key]
        return None

    def set(self, query: str, scope: str, value: dict[str, Any], revision_id: str | None = None) -> None:
        if len(self._cache) >= self._max_size:
            oldest = min(self._cache, key=lambda k: self._cache[k]["timestamp"])
            del self._cache[oldest]
        key = self._key(query, scope, revision_id)
        self._cache[key] = {"value": value, "timestamp": time.time()}

    def clear(self) -> None:
        self._cache.clear()


class PromptCache:
    def __init__(self):
        self._system_prompts: dict[str, str] = {}

    def get_system_prompt(self, agent_type: str, sub_intent: str | None = None) -> str | None:
        key = f"{agent_type}|{sub_intent or ''}"
        return self._system_prompts.get(key)

    def set_system_prompt(self, agent_type: str, prompt: str, sub_intent: str | None = None) -> None:
        key = f"{agent_type}|{sub_intent or ''}"
        self._system_prompts[key] = prompt


class EmbeddingCache:
    def __init__(self, max_size: int = 5000):
        self._cache: dict[str, list[float]] = {}
        self._max_size = max_size

    def get(self, text: str) -> list[float] | None:
        key = hashlib.md5(text.lower().strip().encode()).hexdigest()
        return self._cache.get(key)

    def set(self, text: str, embedding: list[float]) -> None:
        if len(self._cache) >= self._max_size:
            self._cache.pop(next(iter(self._cache)))
        key = hashlib.md5(text.lower().strip().encode()).hexdigest()
        self._cache[key] = embedding


_response_cache = ResponseCache(max_size=500, ttl_seconds=1800)
_prompt_cache = PromptCache()
_embedding_cache = EmbeddingCache()


def get_response_cache() -> ResponseCache:
    return _response_cache


def get_prompt_cache() -> PromptCache:
    return _prompt_cache


def get_embedding_cache() -> EmbeddingCache:
    return _embedding_cache


FAST_TRACK_QUERIES = frozenset({
    "hi", "hello", "hey", "thanks", "thank you", "ok", "yes", "no",
    "help", "what can you do", "who are you",
})

GREETING_RESPONSES = {
    "hi": "Hello! I'm your plant assistant. I can help with SOPs, training, equipment, safety, and more. What do you need?",
    "hello": "Hello! I'm your plant assistant. Ask me about any SOP, training module, equipment, or safety procedure.",
    "hey": "Hey! How can I help you today? I can assist with documents, training, quizzes, and safety information.",
    "thanks": "You're welcome! Let me know if you need anything else.",
    "thank you": "You're welcome! Happy to help with any plant-related questions.",
    "ok": "Got it! Let me know if you have any questions.",
    "help": "I can help with:\n- SOPs and procedures\n- Training modules\n- Quizzes and assessments\n- Equipment information\n- Safety procedures\n- Reports and analytics\n\nJust ask!",
    "what can you do": "I'm your industrial plant assistant. I can help with:\n- Finding and explaining SOPs\n- Training and learning modules\n- Quiz scores and certifications\n- Equipment specs and maintenance\n- Safety procedures and PPE\n- Reports and compliance data",
    "who are you": "I'm your AI plant assistant for Jubilant Ingrevia. I help operators with SOPs, training, equipment, safety, and more.",
}


def get_fast_response(query: str) -> str | None:
    normalized = query.lower().strip().rstrip("!.?")
    return GREETING_RESPONSES.get(normalized)
