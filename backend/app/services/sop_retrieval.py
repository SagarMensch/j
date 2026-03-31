import time
import uuid
from typing import Any

from sqlalchemy import text

from app.core.config import get_settings
from app.db.postgres import engine
from app.services.bm25_retriever import get_bm25_retriever, refresh_bm25_index
from app.services.embedding_service import embed_query


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

    def _semantic_search(self, query_text: str, k: int) -> list[dict[str, Any]]:
        try:
            query_vec = embed_query(query_text)
        except Exception as e:
            print(f"Embedding failed: {e}")
            return []

        with engine.connect() as conn:
            rows = conn.execute(
                SEMANTIC_SQL,
                {
                    "query_embedding": _to_vector_literal(query_vec),
                    "k": k,
                },
            ).mappings().all()

        return [dict(row) for row in rows]

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

    def query(self, *, query_text: str, language: str, role: str | None, user_id: str | None, top_k: int = 5) -> dict[str, Any]:
        started = time.perf_counter()

        k = max(1, min(top_k * 2, 20))

        try:
            self.bm25.load_chunks(query_text)
            lexical = self.bm25.search(query_text, k * 2)
        except Exception as e:
            print(f"BM25 search failed: {e}")
            import traceback
            traceback.print_exc()
            lexical = []

        try:
            semantic = self._semantic_search(query_text, k * 2)
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
                "scores": {
                    "lexical": round(l_norm, 6),
                    "semantic": round(s_norm, 6),
                    "final": round(final_score, 6),
                },
            })

        evidence.sort(key=lambda x: x["scores"]["final"], reverse=True)
        evidence = evidence[:top_k]

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
            }
        }


_retriever = None


def get_sop_retriever() -> SOPRetriever:
    global _retriever
    if _retriever is None:
        _retriever = SOPRetriever()
    return _retriever
