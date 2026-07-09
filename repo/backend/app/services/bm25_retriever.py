import re
from typing import Any

from rank_bm25 import BM25Okapi
from sqlalchemy import text

from app.db.postgres import engine


# Industrial stemmer (lightweight, no external deps)
_STEM_SUFFIXES = [
    ("ational", "ate"), ("tional", "tion"), ("enci", "ence"),
    ("anci", "ance"), ("izer", "ize"), ("bli", "ble"),
    ("alli", "al"), ("entli", "ent"), ("eli", "e"),
    ("ousli", "ous"), ("ization", "ize"), ("ation", "ate"),
    ("ator", "ate"), ("alism", "al"), ("iveness", "ive"),
    ("fulness", "ful"), ("ousness", "ous"), ("aliti", "al"),
    ("iviti", "ive"), ("biliti", "ble"), ("ling", "l"),
    ("ies", "y"), ("ied", "y"), ("sses", "ss"),
    ("ss", "ss"), ("s", ""),
    ("ement", ""), ("ment", ""),
    ("ing", ""), ("tion", "t"), ("sion", "s"),
    ("able", ""), ("ible", ""),
    ("ly", ""), ("er", ""), ("ed", ""),
]

_STOPWORDS = frozenset({
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
    "be", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "shall", "can", "this", "that",
    "these", "those", "i", "me", "my", "we", "our", "you", "your", "he",
    "him", "his", "she", "her", "it", "its", "they", "them", "their",
    "what", "which", "who", "whom", "when", "where", "why", "how",
    "not", "no", "nor", "so", "than", "too", "very", "just", "about",
    "above", "after", "again", "all", "also", "any", "because", "before",
    "below", "between", "both", "each", "few", "more", "most", "other",
    "some", "such", "into", "only", "own", "same", "then", "there",
    "through", "under", "until", "up", "while",
})

_UNIT_PATTERNS = re.compile(
    r"\b(\d+\.?\d*)\s*(mg|g|kg|ml|l|°c|°f|°c|psi|bar|kpa|mpa|rpm|nm|μm|mm|cm|m|km|hr|min|s)\b",
    re.IGNORECASE,
)

_CHEMICAL_PATTERN = re.compile(
    r"\b([A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*){0,5}(?:\s*[\(\[][a-z\s\.\-]+[\)\]]+)?)\b"
)

_ALARM_PATTERN = re.compile(r"\b[A-Z]{2,5}[-_]?\d{2,6}\b")

_INTERLOCK_PATTERN = re.compile(r"\b(?:IL|I LS?|SIS|ESD|BPS|HPA|LPA)[-_]?\d{2,6}\b", re.IGNORECASE)


def _light_stem(token: str) -> str:
    if len(token) <= 3:
        return token
    for suffix, replacement in _STEM_SUFFIXES:
        if token.endswith(suffix) and len(token) - len(suffix) >= 2:
            return token[: -len(suffix)] + replacement
    return token


def _tokenize(text: str) -> list[str]:
    if not text:
        return []
    text = text.lower()
    tokens = re.findall(r"[a-z0-9][a-z0-9/_\.\-]{0,}", text)
    result = []
    for t in tokens:
        if t in _STOPWORDS or len(t) < 2:
            continue
        stemmed = _light_stem(t)
        result.append(stemmed)
    return result


def _extract_entities(text: str) -> dict[str, list[str]]:
    entities: dict[str, list[str]] = {
        "equipment": [],
        "chemical": [],
        "alarm": [],
        "interlock": [],
        "units": [],
    }
    for m in _UNIT_PATTERNS.finditer(text):
        entities["units"].append(m.group(0).lower())
    for m in _ALARM_PATTERN.finditer(text):
        entities["alarm"].append(m.group(0).upper())
    for m in _INTERLOCK_PATTERN.finditer(text):
        entities["interlock"].append(m.group(0).upper())
    for m in _CHEMICAL_PATTERN.finditer(text):
        val = m.group(1)
        if len(val) >= 3:
            entities["chemical"].append(val)
    return entities


def _expand_query(query: str) -> list[str]:
    queries = [query]
    lowered = query.lower()

    if "?" in query:
        wh_words = re.findall(r"\b(what|how|when|where|which|who|why)\b", lowered)
        if wh_words:
            content_words = re.findall(r"\b[a-z]{3,}\b", lowered)
            content_words = [w for w in content_words if w not in _STOPWORDS and w not in wh_words]
            if content_words:
                queries.append(" ".join(content_words))

    if any(op in lowered for op in ["and", "or", "not"]):
        stripped = re.sub(r"\b(and|or|not)\b", " ", lowered).strip()
        if stripped and stripped != lowered:
            queries.append(stripped)

    entities = _extract_entities(query)
    entity_terms = []
    for ent_type, ent_list in entities.items():
        entity_terms.extend(ent_list)
    if entity_terms:
        queries.append(" ".join(entity_terms))

    if len(query.split()) > 6:
        words = query.split()
        mid = len(words) // 2
        queries.append(" ".join(words[:mid]))
        queries.append(" ".join(words[mid:]))

    return queries


class BM25Retriever:
    def __init__(self, max_chunks: int = 50000):
        self.max_chunks = max_chunks
        self.chunks: list[list[str]] = []
        self.bm25: BM25Okapi | None = None
        self.chunk_metadata: list[dict[str, Any]] = []
        self.corpus_size: int = 0

    def load_chunks(self):
        where_clause = """
            WHERE dc.content IS NOT NULL AND length(dc.content) > 30
              AND dr.is_latest_approved = true
        """
        query_sql = f"""
            SELECT
                dc.id::text as chunk_id,
                dc.content,
                dc.section_title,
                dc.citation_label,
                dc.chunk_type,
                dc.equipment_tags,
                dc.safety_flags,
                d.code as document_code,
                d.title as document_title,
                dr.id::text as revision_id,
                dr.revision_label,
                dc.page_start,
                dc.page_end,
                dc.block_ids,
                dc.bbox_x0,
                dc.bbox_y0,
                dc.bbox_x1,
                dc.bbox_y1
            FROM document_chunks dc
            JOIN document_revisions dr ON dc.revision_id = dr.id
            JOIN documents d ON dr.document_id = d.id
            {where_clause}
            LIMIT {self.max_chunks}
        """

        with engine.connect() as conn:
            result = conn.execute(text(query_sql))
            rows = result.mappings().all()

            self.chunks = []
            self.chunk_metadata = []

            for row in rows:
                content = row["content"]
                section = row.get("section_title") or ""
                citation = row.get("citation_label") or ""
                combined = f"{section} {citation} {content}"
                self.chunks.append(self._tokenize(combined))
                self.chunk_metadata.append(dict(row))

        self.corpus_size = len(self.chunks)
        if self.chunks:
            self.bm25 = BM25Okapi(self.chunks, k1=1.5, b=0.75)

    def _tokenize(self, text: str) -> list[str]:
        return _tokenize(text)

    def _bm25f_score(
        self,
        query_tokens: list[str],
        doc_idx: int,
        field_weights: dict[str, float] | None = None,
    ) -> float:
        if self.bm25 is None or doc_idx >= self.corpus_size:
            return 0.0

        base_score = self.bm25.get_scores(query_tokens)[doc_idx]

        if field_weights:
            meta = self.chunk_metadata[doc_idx]
            section_tokens = self._tokenize(meta.get("section_title") or "")
            citation_tokens = self._tokenize(meta.get("citation_label") or "")

            section_boost = sum(1.0 for t in query_tokens if t in section_tokens)
            citation_boost = sum(1.0 for t in query_tokens if t in citation_tokens)

            weighted_boost = (
                field_weights.get("section", 0.0) * section_boost
                + field_weights.get("citation", 0.0) * citation_boost
            )
            return base_score + weighted_boost

        return base_score

    def _rrf_fusion(self, ranked_lists: list[list[str]], k: int = 60) -> list[tuple[str, float]]:
        chunk_scores: dict[str, float] = {}
        for ranked in ranked_lists:
            for rank, chunk_id in enumerate(ranked):
                rrf_score = 1.0 / (k + rank + 1)
                chunk_scores[chunk_id] = chunk_scores.get(chunk_id, 0.0) + rrf_score
        sorted_chunks = sorted(chunk_scores.items(), key=lambda x: x[1], reverse=True)
        return sorted_chunks

    def search(
        self,
        query: str,
        top_k: int = 5,
        revision_id: str | None = None,
    ) -> list[dict[str, Any]]:
        if self.bm25 is None or not self.chunks:
            self.load_chunks()

        if not self.bm25 or not self.chunks:
            return []

        expanded_queries = _expand_query(query)

        all_ranked_lists: list[list[str]] = []
        chunk_score_accumulator: dict[str, float] = {}

        for eq in expanded_queries:
            eq_tokens = self._tokenize(eq)
            if not eq_tokens:
                continue

            scores = self.bm25.get_scores(eq_tokens)

            field_weights = {"section": 0.15, "citation": 0.10}
            adjusted_scores = []
            for i in range(len(scores)):
                adjusted = self._bm25f_score(eq_tokens, i, field_weights)
                adjusted_scores.append(adjusted)

            ranked_indices = sorted(range(len(adjusted_scores)), key=lambda i: adjusted_scores[i], reverse=True)

            ranked_ids = []
            for idx in ranked_indices:
                meta = self.chunk_metadata[idx]
                if revision_id and meta.get("revision_id") != revision_id:
                    continue
                if adjusted_scores[idx] > 0:
                    ranked_ids.append(meta["chunk_id"])
                    chunk_score_accumulator[meta["chunk_id"]] = (
                        chunk_score_accumulator.get(meta["chunk_id"], 0.0)
                        + adjusted_scores[idx]
                    )
            all_ranked_lists.append(ranked_ids)

        if len(all_ranked_lists) > 1:
            fused = self._rrf_fusion(all_ranked_lists)
            result_order = [chunk_id for chunk_id, _ in fused]
        else:
            sorted_chunks = sorted(
                chunk_score_accumulator.items(), key=lambda x: x[1], reverse=True
            )
            result_order = [chunk_id for chunk_id, _ in sorted_chunks]

        results = []
        seen = set()
        for chunk_id in result_order:
            if chunk_id in seen:
                continue
            seen.add(chunk_id)

            meta = None
            for m in self.chunk_metadata:
                if m["chunk_id"] == chunk_id:
                    meta = m
                    break

            if meta is None:
                continue

            if revision_id and meta.get("revision_id") != revision_id:
                continue

            score = chunk_score_accumulator.get(chunk_id, 0.0)

            results.append({
                "chunk_id": meta["chunk_id"],
                "document_code": meta["document_code"],
                "document_title": meta["document_title"],
                "revision_id": meta["revision_id"],
                "revision_label": meta["revision_label"],
                "page_start": meta["page_start"],
                "page_end": meta["page_end"],
                "citation_label": meta["citation_label"],
                "section_title": meta["section_title"],
                "chunk_type": meta.get("chunk_type"),
                "block_ids": meta.get("block_ids") or [],
                "content": meta["content"],
                "bbox_x0": meta.get("bbox_x0"),
                "bbox_y0": meta.get("bbox_y0"),
                "bbox_x1": meta.get("bbox_x1"),
                "bbox_y1": meta.get("bbox_y1"),
                "bm25_score": round(score, 4),
            })

            if len(results) >= top_k:
                break

        return results


_bm25_retriever = None


def get_bm25_retriever() -> BM25Retriever:
    global _bm25_retriever
    if _bm25_retriever is None:
        _bm25_retriever = BM25Retriever()
    return _bm25_retriever


def refresh_bm25_index():
    global _bm25_retriever
    _bm25_retriever = BM25Retriever()
