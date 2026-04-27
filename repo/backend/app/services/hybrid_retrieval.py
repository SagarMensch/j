import re
import time
import uuid
from functools import lru_cache
from typing import Any

from sqlalchemy import text

from app.core.config import get_settings
from app.db.neo4j import get_driver
from app.db.postgres import engine


LEXICAL_SQL = text(
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
        dc.content,
        ts_rank_cd(
            to_tsvector('simple', coalesce(dc.content,'') || ' ' || coalesce(dc.section_title,'') || ' ' || coalesce(dc.citation_label,'')),
            plainto_tsquery('simple', :query)
        ) AS lexical_score
    FROM document_chunks dc
    JOIN document_revisions dr ON dc.revision_id = dr.id
    JOIN documents d ON dr.document_id = d.id
    WHERE dr.is_latest_approved = true
      AND to_tsvector('simple', coalesce(dc.content,'') || ' ' || coalesce(dc.section_title,'') || ' ' || coalesce(dc.citation_label,'')) @@ plainto_tsquery('simple', :query)
    ORDER BY lexical_score DESC
    LIMIT :k
    """
)


SEMANTIC_SQL = text(
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
        (1 - (dc.embedding <=> CAST(:query_embedding AS vector))) AS semantic_score
    FROM document_chunks dc
    JOIN document_revisions dr ON dc.revision_id = dr.id
    JOIN documents d ON dr.document_id = d.id
    WHERE dc.embedding IS NOT NULL
      AND dr.is_latest_approved = true
    ORDER BY dc.embedding <=> CAST(:query_embedding AS vector)
    LIMIT :k
    """
)


INSERT_EVENT_SQL = text(
    """
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


@lru_cache(maxsize=1)
def _get_embedder(model_name: str):
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(model_name, device="cpu")


class HybridRetriever:
    def __init__(self):
        self.settings = get_settings()
        self.driver = get_driver()

    def _lexical_search(self, query_text: str, k: int) -> list[dict[str, Any]]:
        with engine.connect() as conn:
            rows = conn.execute(LEXICAL_SQL, {"query": query_text, "k": k}).mappings().all()
        return [dict(row) for row in rows]

    def _semantic_search(self, query_text: str, k: int) -> list[dict[str, Any]]:
        try:
            embedder = _get_embedder(self.settings.EMBEDDING_MODEL)
        except Exception:
            return []
        query_vec = embedder.encode([query_text], normalize_embeddings=True)[0].tolist()
        with engine.connect() as conn:
            rows = conn.execute(
                SEMANTIC_SQL,
                {
                    "query_embedding": _to_vector_literal(query_vec),
                    "k": k,
                },
            ).mappings().all()
        return [dict(row) for row in rows]

    def _graph_search(self, query_text: str, k: int) -> list[dict[str, Any]]:
        terms = sorted({t.lower() for t in re.findall(r"[A-Za-z0-9][A-Za-z0-9/_-]{2,}", query_text)})
        if not terms:
            return []
        cypher = """
        UNWIND $terms AS term
        MATCH (e)
        WHERE any(label IN labels(e) WHERE label IN ['Equipment','InstrumentTag','Alarm','Interlock','SafetyRule','PPE','Chemical','ModelNumber'])
          AND (
            toLower(coalesce(e.normalized_name, '')) CONTAINS term
            OR toLower(coalesce(e.name, '')) CONTAINS term
          )
        MATCH (c:DocumentChunk)-[r:REFERENCES]->(e)
        RETURN c.id AS chunk_id, max(coalesce(r.confidence, 0.5)) AS graph_score
        ORDER BY graph_score DESC
        LIMIT $k
        """
        with self.driver.session(database=self.settings.NEO4J_DATABASE) as session:
            rows = session.run(cypher, {"terms": terms, "k": k}).data()
        return [{"chunk_id": row["chunk_id"], "graph_score": float(row["graph_score"])} for row in rows]

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
                        "lexical_hits": str(
                            [
                                {"chunk_id": h["chunk_id"], "score": round(float(h.get("lexical_score", 0.0)), 6)}
                                for h in lexical_hits[:20]
                            ]
                        ).replace("'", '"'),
                        "semantic_hits": str(
                            [
                                {"chunk_id": h["chunk_id"], "score": round(float(h.get("semantic_score", 0.0)), 6)}
                                for h in semantic_hits[:20]
                            ]
                        ).replace("'", '"'),
                        "graph_hits": str(
                            [{"chunk_id": h["chunk_id"], "score": round(float(h.get("graph_score", 0.0)), 6)} for h in graph_hits[:20]]
                        ).replace("'", '"'),
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
        k = max(1, min(top_k, 12))
        lexical = self._lexical_search(query_text, k * 3)
        semantic = self._semantic_search(query_text, k * 3)
        graph = self._graph_search(query_text, k * 3)

        candidates: dict[str, dict[str, Any]] = {}
        for row in lexical:
            item = candidates.setdefault(row["chunk_id"], {})
            item.update(row)
            item["lexical_score_raw"] = float(row.get("lexical_score") or 0.0)
        for row in semantic:
            item = candidates.setdefault(row["chunk_id"], {})
            for key in (
                "chunk_id",
                "document_code",
                "document_title",
                "revision_id",
                "revision_label",
                "page_start",
                "page_end",
                "citation_label",
                "section_title",
                "block_ids",
                "content",
            ):
                if key in row and key not in item:
                    item[key] = row[key]
            item["semantic_score_raw"] = float(row.get("semantic_score") or 0.0)
        for row in graph:
            item = candidates.setdefault(row["chunk_id"], {"chunk_id": row["chunk_id"]})
            item["graph_score_raw"] = float(row.get("graph_score") or 0.0)

        lexical_norm = _normalize_scores({cid: c.get("lexical_score_raw", 0.0) for cid, c in candidates.items()})
        semantic_norm = _normalize_scores({cid: c.get("semantic_score_raw", 0.0) for cid, c in candidates.items()})
        graph_norm = _normalize_scores({cid: c.get("graph_score_raw", 0.0) for cid, c in candidates.items()})

        evidence = []
        for cid, c in candidates.items():
            l = lexical_norm.get(cid, 0.0)
            s = semantic_norm.get(cid, 0.0)
            g = graph_norm.get(cid, 0.0)
            final_score = 0.45 * s + 0.35 * l + 0.20 * g
            evidence.append(
                {
                    "chunk_id": cid,
                    "document_code": c.get("document_code"),
                    "document_title": c.get("document_title"),
                    "revision_id": c.get("revision_id"),
                    "revision_label": c.get("revision_label"),
                    "page_start": c.get("page_start"),
                    "page_end": c.get("page_end"),
                    "citation_label": c.get("citation_label"),
                    "section_title": c.get("section_title"),
                    "content": c.get("content"),
                    "scores": {
                        "lexical": round(l, 6),
                        "semantic": round(s, 6),
                        "graph": round(g, 6),
                        "final": round(final_score, 6),
                    },
                }
            )
        evidence.sort(key=lambda x: x["scores"]["final"], reverse=True)
        evidence = evidence[:k]
        confidence = evidence[0]["scores"]["final"] if evidence else 0.0
        latency_ms = int((time.perf_counter() - started) * 1000)

        event_id = self._write_event(
            query_text=query_text,
            language=language,
            role=role,
            user_id=user_id,
            lexical_hits=lexical,
            semantic_hits=semantic,
            graph_hits=graph,
            confidence=confidence,
            latency_ms=latency_ms,
        )

        return {
            "event_id": event_id,
            "confidence": confidence,
            "latency_ms": latency_ms,
            "evidence": evidence,
            "diagnostics": {
                "lexical_candidates": len(lexical),
                "semantic_candidates": len(semantic),
                "graph_candidates": len(graph),
                "combined_candidates": len(candidates),
            },
        }
