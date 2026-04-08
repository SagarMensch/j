import time
import uuid
from typing import Any

from sqlalchemy import text

from app.core.config import get_settings
from app.db.postgres import engine
from app.services.bm25_retriever import get_bm25_retriever
from app.services.embedding_service import embed_query
from app.services.reranker import rerank_evidence


INSERT_EVENT_SQL = text("""
    INSERT INTO retrieval_events (
        id, user_id, query_text, language, role,
        lexical_hits, semantic_hits, graph_hits,
        verifier_status, confidence, latest_revision_enforced, latency_ms
    ) VALUES (
        CAST(:id AS uuid),
        CAST(:user_id AS uuid),
        :query_text,
        :language,
        :role,
        CAST(:lexical_hits AS jsonb),
        CAST(:semantic_hits AS jsonb),
        CAST(:graph_hits AS jsonb),
        :verifier_status,
        :confidence,
        true,
        :latency_ms
    )
""")


SEMANTIC_SQL = text("""
    SELECT
        dc.id::text AS chunk_id,
        d.code AS document_code,
        d.title AS document_title,
        dr.id::text AS revision_id,
        dr.revision_label AS revision_label,
        dc.page_start,
        dc.page_end,
        dc.citation_label,
        dc.section_title,
        dc.block_ids,
        dc.content,
        dc.bbox_x0,
        dc.bbox_y0,
        dc.bbox_x1,
        dc.bbox_y1,
        (1 - (dc.embedding <=> CAST(:query_embedding AS vector))) AS semantic_score
    FROM document_chunks dc
    JOIN document_revisions dr ON dc.revision_id = dr.id
    JOIN documents d ON dr.document_id = d.id
    WHERE dc.embedding IS NOT NULL
      AND dr.is_latest_approved = true
    ORDER BY dc.embedding <=> CAST(:query_embedding AS vector)
    LIMIT :k
""")


SEMANTIC_SQL_FOR_REVISION = text(
    """
    SELECT
        dc.id::text AS chunk_id,
        d.code AS document_code,
        d.title AS document_title,
        dr.id::text AS revision_id,
        dr.revision_label AS revision_label,
        dc.page_start,
        dc.page_end,
        dc.citation_label,
        dc.section_title,
        dc.block_ids,
        dc.content,
        dc.bbox_x0,
        dc.bbox_y0,
        dc.bbox_x1,
        dc.bbox_y1,
        (1 - (dc.embedding <=> CAST(:query_embedding AS vector))) AS semantic_score
    FROM document_chunks dc
    JOIN document_revisions dr ON dc.revision_id = dr.id
    JOIN documents d ON dr.document_id = d.id
    WHERE dc.embedding IS NOT NULL
      AND dr.is_latest_approved = true
      AND dr.id = CAST(:revision_id AS uuid)
    ORDER BY dc.embedding <=> CAST(:query_embedding AS vector)
    LIMIT :k
    """
)


LINE_RANGE_SQL = text(
    """
    SELECT
        dc.id::text AS chunk_id,
        MIN(eb.reading_order) AS line_start,
        MAX(eb.reading_order) AS line_end
    FROM document_chunks dc
    LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(dc.block_ids, '[]'::jsonb)) AS bid(block_id) ON true
    LEFT JOIN extracted_blocks eb ON eb.id::text = bid.block_id
    WHERE dc.id = ANY(CAST(:chunk_ids AS uuid[]))
    GROUP BY dc.id
    """
)


def _normalize_scores(raw_scores: dict[str, float]) -> dict[str, float]:
    if not raw_scores:
        return {}
    values = list(raw_scores.values())
    v_min = min(values)
    v_max = max(values)
    if v_max - v_min < 1e-9:
        return {k: (1.0 if v_max > 0 else 0.0) for k in raw_scores}
    return {k: (v - v_min) / (v_max - v_min) for k, v in raw_scores.items()}


def _to_vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{float(v):.8f}" for v in vector) + "]"


class SOPRetriever:
    def __init__(self):
        self.settings = get_settings()
        self.bm25 = get_bm25_retriever()

    def _semantic_search(
        self,
        query_text: str,
        k: int,
        revision_id: str | None = None,
    ) -> list[dict[str, Any]]:
        try:
            query_vec = embed_query(query_text)
        except Exception as e:
            print(f"Embedding failed: {e}")
            return []

        with engine.connect() as conn:
            sql = SEMANTIC_SQL_FOR_REVISION if revision_id else SEMANTIC_SQL
            rows = conn.execute(
                sql,
                {"query_embedding": _to_vector_literal(query_vec), "k": k, "revision_id": revision_id},
            ).mappings().all()

        return [dict(row) for row in rows]

    def _attach_line_ranges(self, evidence: list[dict[str, Any]]) -> None:
        if not evidence:
            return

        chunk_ids = [item.get("chunk_id") for item in evidence if item.get("chunk_id")]
        if not chunk_ids:
            return

        with engine.connect() as conn:
            rows = conn.execute(
                LINE_RANGE_SQL,
                {"chunk_ids": chunk_ids},
            ).mappings().all()

        range_map: dict[str, tuple[int | None, int | None]] = {}
        for row in rows:
            chunk_id = row.get("chunk_id")
            if not chunk_id:
                continue
            line_start = row.get("line_start")
            line_end = row.get("line_end")
            start_value = int(line_start) if line_start is not None else None
            end_value = int(line_end) if line_end is not None else None
            if start_value is not None and end_value is None:
                end_value = start_value
            range_map[chunk_id] = (start_value, end_value)

        for item in evidence:
            start_value, end_value = range_map.get(item.get("chunk_id"), (None, None))
            item["line_start"] = start_value
            item["line_end"] = end_value

    def _write_event(
        self,
        *,
        query_text: str,
        language: str,
        role: str | None,
        user_id: str | None,
        lexical_hits: list[dict[str, Any]],
        semantic_hits: list[dict[str, Any]],
        graph_hits: list[dict[str, Any]],
        confidence: float,
        latency_ms: int,
    ) -> str | None:
        event_id = str(uuid.uuid4())
        try:
            with engine.begin() as conn:
                conn.execute(
                    INSERT_EVENT_SQL,
                    {
                        "id": event_id,
                        "user_id": user_id,
                        "query_text": query_text,
                        "language": language,
                        "role": role,
                        "lexical_hits": str([{"chunk_id": h["chunk_id"], "score": round(float(h.get("bm25_score", 0.0)), 6)} for h in lexical_hits[:20]]).replace("'", '"'),
                        "semantic_hits": str([{"chunk_id": h["chunk_id"], "score": round(float(h.get("semantic_score", 0.0)), 6)} for h in semantic_hits[:20]]).replace("'", '"'),
                        "graph_hits": str([{"chunk_id": h["chunk_id"], "score": round(float(h.get("graph_score", 0.0)), 6)} for h in graph_hits[:20]]).replace("'", '"'),
                        "verifier_status": "grounded",
                        "confidence": float(confidence),
                        "latency_ms": int(latency_ms),
                    },
                )
        except Exception:
            return None
        return event_id

    def query(
        self,
        *,
        query_text: str,
        language: str,
        role: str | None,
        user_id: str | None,
        top_k: int = 5,
        revision_id: str | None = None,
    ) -> dict[str, Any]:
        started = time.perf_counter()

        k = max(1, min(top_k * 2, 20))

        try:
            lexical = self.bm25.search(
                query_text,
                k * 2,
                revision_id=revision_id,
            )
        except Exception as e:
            print(f"BM25 search failed: {e}")
            import traceback
            traceback.print_exc()
            lexical = []

        try:
            semantic = self._semantic_search(
                query_text,
                k * 2,
                revision_id=revision_id,
            )
        except Exception as e:
            print(f"Semantic search failed: {e}")
            semantic = []

        candidates: dict[str, dict[str, Any]] = {}

        for row in lexical:
            item = candidates.setdefault(row["chunk_id"], {})
            item.update(row)
            item["lexical_score_raw"] = float(row.get("bm25_score", 0.0))

        for row in semantic:
            item = candidates.setdefault(row["chunk_id"], {})
            for key in (
                "chunk_id", "document_code", "document_title",
                "revision_id", "revision_label", "page_start", "page_end",
                "citation_label", "section_title", "block_ids", "content",
                "bbox_x0", "bbox_y0", "bbox_x1", "bbox_y1"
            ):
                if key in row and key not in item:
                    item[key] = row[key]
            item["semantic_score_raw"] = float(row.get("semantic_score", 0.0))
        max_lexical = max([c.get("lexical_score_raw", 0) for c in candidates.values()], default=0)
        max_semantic = max([c.get("semantic_score_raw", 0) for c in candidates.values()], default=0)

        evidence = []
        for cid, c in candidates.items():
            l = c.get("lexical_score_raw", 0.0)
            s = c.get("semantic_score_raw", 0.0)

            if max_lexical > 0:
                l_norm = l / max_lexical
            else:
                l_norm = 0.0

            if max_semantic > 0:
                s_norm = s / max_semantic
            else:
                s_norm = 0.0

            block_ids = c.get("block_ids") or []
            if isinstance(block_ids, str):
                try:
                    import json

                    block_ids = json.loads(block_ids)
                except Exception:
                    block_ids = []

            final_score = 0.7 * l_norm + 0.3 * s_norm

            evidence.append({
                "chunk_id": cid,
                "document_code": c.get("document_code"),
                "document_title": c.get("document_title"),
                "revision_id": c.get("revision_id"),
                "revision_label": c.get("revision_label"),
                "page_start": c.get("page_start"),
                "page_end": c.get("page_end"),
                "citation_label": c.get("citation_label"),
                "section_title": c.get("section_title"),
                "block_ids": block_ids,
                "content": c.get("content"),
                "bbox_x0": c.get("bbox_x0"),
                "bbox_y0": c.get("bbox_y0"),
                "bbox_x1": c.get("bbox_x1"),
                "bbox_y1": c.get("bbox_y1"),
                "line_start": None,
                "line_end": None,
                "scores": {
                    "lexical": round(l_norm, 6),
                    "semantic": round(s_norm, 6),
                    "final": round(final_score, 6),
                },
            })

        evidence, reranker_diagnostics = rerank_evidence(
            query_text=query_text,
            evidence=evidence,
            top_k=top_k,
            mode=self.settings.RETRIEVAL_RERANKER_MODE,
        )
        self._attach_line_ranges(evidence)

        confidence = evidence[0]["scores"]["final"] if evidence else 0.0
        latency_ms = int((time.perf_counter() - started) * 1000)

        event_id = self._write_event(
            query_text=query_text,
            language=language,
            role=role,
            user_id=user_id,
            lexical_hits=lexical,
            semantic_hits=semantic,
            graph_hits=[],
            confidence=confidence,
            latency_ms=latency_ms,
        )

        return {
            "answer": None,
            "confidence": confidence,
            "latency_ms": latency_ms,
            "retrieval_event_id": event_id,
            "evidence": evidence,
            "diagnostics": {
                "lexical_hits": len(lexical),
                "semantic_hits": len(semantic),
                "candidates": len(candidates),
                "revision_filter": revision_id,
                "reranker": reranker_diagnostics,
            }
        }


_retriever = None


def get_sop_retriever() -> SOPRetriever:
    global _retriever
    if _retriever is None:
        _retriever = SOPRetriever()
    return _retriever
