from __future__ import annotations

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.services.hybrid_retrieval import HybridRetriever
from microservices.shared.runtime import engine, service_health, settings


GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
retriever = HybridRetriever()
app = FastAPI(title="knowledge-service", version="1.0.0")


class QueryRequest(BaseModel):
    query: str = Field(min_length=2)
    language: str = "en"
    role: str | None = "operator"
    user_id: str | None = None
    top_k: int = 5


@app.get("/health")
def health():
    return service_health("knowledge-service")


@app.get("/retrieval/status")
def retrieval_status():
    pg_counts = {}
    with engine.connect() as conn:
        for label, sql in {
            "documents": "select count(*) from documents",
            "revisions": "select count(*) from document_revisions",
            "pages": "select count(*) from extracted_pages",
            "blocks": "select count(*) from extracted_blocks",
            "chunks": "select count(*) from document_chunks",
            "embedded_chunks": "select count(*) from document_chunks where embedding is not null",
            "retrieval_events": "select count(*) from retrieval_events",
        }.items():
            pg_counts[label] = int(conn.execute(text(sql)).scalar_one())
    return {"status": "ok", "postgres": pg_counts, "embedding_model": settings.EMBEDDING_MODEL}


async def _generate_grounded_answer(query: str, language: str, evidence: list[dict]) -> str:
    if not evidence:
        return "Not found in approved documents."

    context_blocks = []
    for idx, ev in enumerate(evidence[:4], start=1):
        citation = ev.get("citation_label") or f"{ev.get('document_code', 'doc')} p.{ev.get('page_start', '?')}"
        content = (ev.get("content") or "")[:900]
        context_blocks.append(f"[{idx}] {citation}\n{content}")
    context = "\n\n".join(context_blocks)

    if not settings.GROQ_API_KEY:
        top = evidence[0]
        citation = top.get("citation_label") or f"{top.get('document_code', 'doc')} p.{top.get('page_start', '?')}"
        return f"{(top.get('content') or '').strip()}\n\nSource: {citation}"

    system_prompt = (
        "You are a strict SOP assistant. Use ONLY provided evidence. "
        "Do not infer missing facts. If insufficient evidence, reply exactly: Not found in approved documents. "
        "Always cite source labels like [1], [2]. Keep response concise for plant operators."
    )
    user_prompt = (
        f"Question: {query}\nLanguage: {language}\nEvidence:\n{context}\n\n"
        "Answer with direct operational guidance and cite source indices."
    )

    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.post(
            GROQ_CHAT_URL,
            headers={
                "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.GROQ_MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "max_tokens": 280,
                "temperature": 0.1,
            },
        )
        resp.raise_for_status()
        data = resp.json()
    return data["choices"][0]["message"]["content"].strip()


@app.post("/query")
async def grounded_query(req: QueryRequest):
    result = retriever.query(
        query_text=req.query,
        language=req.language,
        role=req.role,
        user_id=req.user_id,
        top_k=req.top_k,
    )
    evidence = result["evidence"]
    answer = await _generate_grounded_answer(req.query, req.language, evidence)
    return {
        "answer": answer,
        "confidence": float(result["confidence"]),
        "latency_ms": int(result["latency_ms"]),
        "retrieval_event_id": result["event_id"],
        "evidence": evidence,
        "diagnostics": result["diagnostics"],
    }


@app.get("/query/{event_id}/evidence")
def retrieval_evidence(event_id: str):
    with engine.connect() as conn:
        event = conn.execute(
            text(
                """
                SELECT
                    id::text AS id,
                    query_text,
                    language,
                    role,
                    confidence,
                    latency_ms,
                    created_at,
                    lexical_hits,
                    semantic_hits,
                    graph_hits
                FROM retrieval_events
                WHERE id = CAST(:event_id AS uuid)
                """
            ),
            {"event_id": event_id},
        ).mappings().first()
        if not event:
            raise HTTPException(status_code=404, detail="Retrieval event not found")

        hit_ids = []
        for family in ("lexical_hits", "semantic_hits", "graph_hits"):
            for hit in event[family] or []:
                cid = hit.get("chunk_id")
                if cid and cid not in hit_ids:
                    hit_ids.append(cid)
        hit_ids = hit_ids[:12]

        evidence = []
        if hit_ids:
            rows = conn.execute(
                text(
                    """
                    SELECT
                        dc.id::text AS chunk_id,
                        dc.revision_id::text AS revision_id,
                        d.code AS document_code,
                        d.title AS document_title,
                        dr.revision_label,
                        dc.page_start,
                        dc.page_end,
                        dc.citation_label,
                        dc.section_title,
                        dc.content
                    FROM document_chunks dc
                    JOIN document_revisions dr ON dr.id = dc.revision_id
                    JOIN documents d ON d.id = dr.document_id
                    WHERE dc.id = ANY(CAST(:chunk_ids AS uuid[]))
                    """
                ),
                {"chunk_ids": hit_ids},
            ).mappings()
            row_map = {row["chunk_id"]: dict(row) for row in rows}
            evidence = [row_map[cid] for cid in hit_ids if cid in row_map]

    payload = dict(event)
    payload["evidence"] = evidence
    return payload


@app.get("/documents/{revision_id}/page/{page_number}")
def document_page_view(revision_id: str, page_number: int):
    with engine.connect() as conn:
        page = conn.execute(
            text(
                """
                SELECT
                    ep.id::text AS page_id,
                    ep.revision_id::text AS revision_id,
                    ep.page_number,
                    ep.classification,
                    ep.raw_text,
                    ep.markdown_path,
                    ep.image_path,
                    ep.ocr_used,
                    ep.ocr_confidence
                FROM extracted_pages ep
                WHERE ep.revision_id = CAST(:revision_id AS uuid)
                  AND ep.page_number = :page_number
                """
            ),
            {"revision_id": revision_id, "page_number": page_number},
        ).mappings().first()
        if not page:
            raise HTTPException(status_code=404, detail="Page not found")

        blocks = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        eb.id::text AS block_id,
                        eb.block_type,
                        eb.section_title,
                        eb.text,
                        eb.bbox_left,
                        eb.bbox_top,
                        eb.bbox_right,
                        eb.bbox_bottom,
                        eb.confidence,
                        eb.reading_order
                    FROM extracted_blocks eb
                    WHERE eb.page_id = CAST(:page_id AS uuid)
                    ORDER BY eb.reading_order ASC, eb.id
                    """
                ),
                {"page_id": page["page_id"]},
            ).mappings()
        ]
    return {"page": dict(page), "blocks": blocks}
