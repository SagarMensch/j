from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core.config import get_settings
from app.db.neo4j import check_neo4j_connection, get_driver
from app.db.postgres import check_postgres_connection, engine
from app.services.sop_retrieval import get_sop_retriever


settings = get_settings()
retriever = get_sop_retriever()

SARVAM_TTS_URL = settings.SARVAM_TTS_URL
SARVAM_STT_URL = settings.SARVAM_STT_URL
SARVAM_TRANSLATE_URL = settings.SARVAM_TRANSLATE_URL
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
AUTO_LANGUAGE = "unknown"
DEFAULT_TTS_LANGUAGE = "en-IN"
SUPPORTED_TTS_LANGUAGES = {
    "en-IN",
    "hi-IN",
    "bn-IN",
    "ta-IN",
    "te-IN",
    "gu-IN",
    "kn-IN",
    "ml-IN",
    "mr-IN",
    "pa-IN",
    "od-IN",
}


class ChatRequest(BaseModel):
    text: str
    language: str = "en-IN"
    speaker: str = "suhani"


class Citation(BaseModel):
    chunk_id: str
    document_code: str | None = None
    document_title: str | None = None
    revision_label: str | None = None
    page_start: int | None = None
    citation_label: str | None = None
    section_title: str | None = None
    content: str | None = None


class ChatResponse(BaseModel):
    user_text: str
    assistant_text: str
    audio_base64: str
    citations: list[Citation] = []


class QueryRequest(BaseModel):
    query: str = Field(min_length=2)
    language: str = "en"
    role: str | None = "operator"
    user_id: str | None = None
    top_k: int = 5


class QueryEvidence(BaseModel):
    chunk_id: str
    document_code: str | None = None
    document_title: str | None = None
    revision_id: str | None = None
    revision_label: str | None = None
    page_start: int | None = None
    page_end: int | None = None
    citation_label: str | None = None
    section_title: str | None = None
    content: str | None = None
    block_ids: list[str] = []
    bbox_x0: float | None = None
    bbox_y0: float | None = None
    bbox_x1: float | None = None
    bbox_y1: float | None = None
    scores: dict[str, float]


class QueryResponse(BaseModel):
    answer: str
    confidence: float
    latency_ms: int
    retrieval_event_id: str | None = None
    evidence: list[QueryEvidence]
    diagnostics: dict[str, Any]


class AssignmentProgressRequest(BaseModel):
    user_id: str
    progress_percent: float = Field(ge=0, le=100)
    current_step: int | None = Field(default=None, ge=1)
    status: str | None = None


class AssessmentSubmitRequest(BaseModel):
    user_id: str
    responses: dict[str, str] = Field(default_factory=dict)


app = FastAPI(title="Jubilant Ingrevia Platform API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


REPO_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = REPO_ROOT / "frontend"
CERT_NAMESPACE = uuid.UUID("f4fb73e3-7ca8-4c8e-98cd-ebad753d7b3c")

if FRONTEND_DIR.exists():
    app.mount("/ui", StaticFiles(directory=FRONTEND_DIR, html=True), name="ui")


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return str(value)


def _det_uuid(*parts: object) -> str:
    source = "|".join(str(part) for part in parts)
    return str(uuid.uuid5(CERT_NAMESPACE, source))


def _get_user(conn, user_id: str) -> dict[str, Any]:
    row = conn.execute(
        text(
            """
            SELECT
                u.id::text AS id,
                u.employee_code,
                u.full_name,
                u.email,
                u.role,
                u.preferred_language,
                d.name AS department
            FROM users u
            LEFT JOIN departments d ON d.id = u.department_id
            WHERE u.id = CAST(:user_id AS uuid)
            """
        ),
        {"user_id": user_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return dict(row)


def _require_admin_or_supervisor(user: dict[str, Any]):
    if user["role"] not in {"admin", "supervisor"}:
        raise HTTPException(status_code=403, detail="Insufficient role")


def _require_admin(user: dict[str, Any]):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")


def _require_secret(value: str, name: str):
    if not value:
        raise HTTPException(status_code=503, detail=f"{name} is not configured")


def _normalize_stt_language(language: str | None) -> str:
    if not language or language.lower() in {"auto", "unknown"}:
        return AUTO_LANGUAGE
    return language


def _get_detected_language(stt_data: dict[str, Any], requested_language: str) -> str:
    detected_language = stt_data.get("language_code")
    if isinstance(detected_language, str) and detected_language.strip():
        return detected_language
    if requested_language != AUTO_LANGUAGE:
        return requested_language
    return DEFAULT_TTS_LANGUAGE


def _get_tts_language(detected_language: str) -> str:
    if detected_language in SUPPORTED_TTS_LANGUAGES:
        return detected_language
    return DEFAULT_TTS_LANGUAGE


async def _translate_speech_to_english(client: httpx.AsyncClient, audio_bytes: bytes, language: str) -> tuple[str, str]:
    normalized_language = _normalize_stt_language(language)
    stt_resp = await client.post(
        SARVAM_STT_URL,
        headers={"api-subscription-key": settings.SARVAM_API_KEY},
        data={
            "language_code": normalized_language,
            "model": settings.SARVAM_STT_MODEL,
            "mode": "translate",
        },
        files={"file": ("audio.webm", audio_bytes, "audio/webm")},
    )
    stt_resp.raise_for_status()
    stt_data = stt_resp.json()
    transcript = (stt_data.get("transcript") or "").strip()
    detected_language = _get_detected_language(stt_data, normalized_language)
    return transcript, detected_language


async def _translate_assistant_text(client: httpx.AsyncClient, assistant_text: str, target_language: str) -> tuple[str, str]:
    tts_language = _get_tts_language(target_language)
    if tts_language == DEFAULT_TTS_LANGUAGE:
        return assistant_text, tts_language

    translate_resp = await client.post(
        SARVAM_TRANSLATE_URL,
        headers={
            "api-subscription-key": settings.SARVAM_API_KEY,
            "Content-Type": "application/json",
        },
        json={
            "input": assistant_text,
            "source_language_code": DEFAULT_TTS_LANGUAGE,
            "target_language_code": tts_language,
            "model": settings.SARVAM_TRANSLATE_MODEL,
            "mode": settings.SARVAM_TRANSLATE_MODE,
        },
    )
    translate_resp.raise_for_status()
    translated_text = (translate_resp.json().get("translated_text") or "").strip()
    return translated_text or assistant_text, tts_language


async def _synthesize_speech(client: httpx.AsyncClient, text: str, language: str, speaker: str) -> str:
    tts_resp = await client.post(
        SARVAM_TTS_URL,
        headers={
            "api-subscription-key": settings.SARVAM_API_KEY,
            "Content-Type": "application/json",
        },
        json={
            "inputs": [text],
            "target_language_code": language,
            "speaker": speaker,
            "model": settings.SARVAM_TTS_MODEL,
            "pace": 1.0,
            "enable_preprocessing": True,
        },
    )
    tts_resp.raise_for_status()
    return tts_resp.json()["audios"][0]


async def _generate_grounded_answer(query: str, language: str, evidence: list[dict[str, Any]]) -> str:
    if not evidence:
        return "Not found in approved documents."

    context_blocks = []
    for idx, ev in enumerate(evidence[:4], start=1):
        citation = ev.get("citation_label") or f"{ev.get('document_code', 'doc')} p.{ev.get('page_start', '?')}"
        content = (ev.get("content") or "")[:2000]
        context_blocks.append(f"[{idx}] {citation}\n{content}")
    context = "\n\n".join(context_blocks)

    if not settings.GROQ_API_KEY:
        top = evidence[0]
        citation = top.get("citation_label") or f"{top.get('document_code', 'doc')} p.{top.get('page_start', '?')}"
        return f"{(top.get('content') or '').strip()}\n\nSource: {citation}"

    system_prompt = (
        "You are a helpful SOP assistant for plant operators. "
        "Answer the question using ONLY the provided evidence. "
        "Extract and summarize the relevant information from the evidence to answer the question. "
        "If the evidence contains relevant information, provide the answer with proper citations like [1], [2]. "
        "If the evidence truly does not contain information to answer the question, then say: Not found in approved documents. "
        "Keep your response concise and actionable for plant operators."
    )

    user_prompt = (
        f"Question: {query}\n"
        f"Language: {language}\n\n"
        f"Here is the evidence from approved documents:\n{context}\n\n"
        "Based on the evidence above, answer the question directly. Extract the specific steps or information requested."
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


@app.get("/")
async def root():
    index_file = FRONTEND_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"status": "ok", "message": "API online. UI not yet generated in /frontend/index.html"}


@app.get("/api/users")
async def list_users():
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT
                    u.id::text AS id,
                    u.employee_code,
                    u.full_name,
                    u.email,
                    u.role,
                    u.preferred_language,
                    d.name AS department
                FROM users u
                LEFT JOIN departments d ON d.id = u.department_id
                ORDER BY
                    CASE u.role WHEN 'operator' THEN 1 WHEN 'supervisor' THEN 2 WHEN 'admin' THEN 3 ELSE 4 END,
                    u.full_name
                """
            )
        ).mappings()
        users = [dict(row) for row in rows]
    return {"users": users}


@app.get("/api/dashboard/summary")
async def dashboard_summary(user_id: str):
    with engine.connect() as conn:
        user = _get_user(conn, user_id)

        assignments = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        ta.id::text AS assignment_id,
                        ta.module_id::text AS module_id,
                        tm.title AS module_title,
                        tm.criticality,
                        tm.total_steps,
                        ta.is_mandatory,
                        ta.status,
                        ta.progress_percent,
                        ta.current_step,
                        ta.due_at,
                        ta.completed_at,
                        a.id::text AS assessment_id
                    FROM training_assignments ta
                    JOIN training_modules tm ON tm.id = ta.module_id
                    LEFT JOIN assessments a ON a.module_id = tm.id
                    WHERE ta.user_id = CAST(:user_id AS uuid)
                    ORDER BY ta.is_mandatory DESC, ta.due_at ASC NULLS LAST, tm.title
                    LIMIT 18
                    """
                ),
                {"user_id": user_id},
            ).mappings()
        ]

        recent_sops = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        d.code,
                        d.title,
                        d.document_type,
                        dr.id::text AS revision_id,
                        dr.revision_label,
                        dr.page_count,
                        dr.updated_at
                    FROM document_revisions dr
                    JOIN documents d ON d.id = dr.document_id
                    WHERE dr.is_latest_approved = true
                    ORDER BY dr.updated_at DESC, d.code
                    LIMIT 8
                    """
                )
            ).mappings()
        ]

        safety_alerts = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        d.code AS document_code,
                        d.title AS document_title,
                        dc.id::text AS chunk_id,
                        dc.page_start,
                        dc.citation_label,
                        left(dc.content, 260) AS alert_text,
                        CASE
                            WHEN array_length(ARRAY(
                                SELECT jsonb_array_elements_text(dc.safety_flags)
                            ), 1) > 0 THEN 'critical'
                            WHEN lower(dc.content) ~ '(warning|hazard|caution|interlock|ppe)' THEN 'high'
                            ELSE 'medium'
                        END AS severity
                    FROM document_chunks dc
                    JOIN document_revisions dr ON dr.id = dc.revision_id
                    JOIN documents d ON d.id = dr.document_id
                    WHERE dr.is_latest_approved = true
                      AND (
                        jsonb_array_length(dc.safety_flags) > 0
                        OR lower(dc.content) ~ '(warning|hazard|caution|interlock|ppe)'
                      )
                    ORDER BY dc.created_at DESC
                    LIMIT 8
                    """
                )
            ).mappings()
        ]

    mandatory_total = sum(1 for row in assignments if row["is_mandatory"])
    mandatory_completed = sum(1 for row in assignments if row["is_mandatory"] and row["status"] == "completed")
    in_progress = sum(1 for row in assignments if row["status"] == "in_progress")
    overdue = sum(
        1
        for row in assignments
        if row["status"] != "completed" and row["due_at"] is not None and row["due_at"] < datetime.now(timezone.utc)
    )

    for row in assignments:
        row["due_at"] = _iso(row["due_at"])
        row["completed_at"] = _iso(row["completed_at"])
    for row in recent_sops:
        row["updated_at"] = _iso(row["updated_at"])

    return {
        "user": user,
        "stats": {
            "mandatory_total": mandatory_total,
            "mandatory_completed": mandatory_completed,
            "mandatory_completion_rate": round((mandatory_completed / mandatory_total) * 100, 2) if mandatory_total else 0.0,
            "in_progress": in_progress,
            "overdue": overdue,
        },
        "mandatory_training": assignments,
        "recent_sops": recent_sops,
        "safety_alerts": safety_alerts,
    }


@app.get("/api/training/assignments")
async def training_assignments(user_id: str):
    with engine.connect() as conn:
        _get_user(conn, user_id)
        rows = conn.execute(
            text(
                """
                SELECT
                    ta.id::text AS assignment_id,
                    ta.user_id::text AS user_id,
                    ta.module_id::text AS module_id,
                    ta.is_mandatory,
                    ta.status,
                    ta.progress_percent,
                    ta.current_step,
                    ta.due_at,
                    ta.started_at,
                    ta.completed_at,
                    ta.last_activity_at,
                    tm.title AS module_title,
                    tm.criticality,
                    tm.total_steps,
                    a.id::text AS assessment_id
                FROM training_assignments ta
                JOIN training_modules tm ON tm.id = ta.module_id
                LEFT JOIN assessments a ON a.module_id = tm.id
                WHERE ta.user_id = CAST(:user_id AS uuid)
                ORDER BY ta.is_mandatory DESC, ta.due_at ASC NULLS LAST, tm.title
                """
            ),
            {"user_id": user_id},
        ).mappings()
        assignments = [dict(row) for row in rows]

    for row in assignments:
        row["due_at"] = _iso(row["due_at"])
        row["started_at"] = _iso(row["started_at"])
        row["completed_at"] = _iso(row["completed_at"])
        row["last_activity_at"] = _iso(row["last_activity_at"])
    return {"assignments": assignments}


@app.get("/api/training/modules/{module_id}")
async def training_module_details(module_id: str, user_id: str):
    with engine.connect() as conn:
        user = _get_user(conn, user_id)
        assignment = conn.execute(
            text(
                """
                SELECT
                    ta.id::text AS assignment_id,
                    ta.user_id::text AS user_id,
                    ta.status,
                    ta.progress_percent,
                    ta.current_step
                FROM training_assignments ta
                WHERE ta.user_id = CAST(:user_id AS uuid)
                  AND ta.module_id = CAST(:module_id AS uuid)
                """
            ),
            {"user_id": user_id, "module_id": module_id},
        ).mappings().first()
        if user["role"] not in {"admin", "supervisor"} and not assignment:
            raise HTTPException(status_code=403, detail="Module not assigned to this user")

        module = conn.execute(
            text(
                """
                SELECT
                    tm.id::text AS id,
                    tm.source_document_id::text AS source_document_id,
                    tm.source_revision_id::text AS source_revision_id,
                    tm.title,
                    tm.description,
                    tm.language,
                    tm.module_type,
                    tm.criticality,
                    tm.validity_days,
                    tm.total_steps,
                    tm.is_published,
                    d.code AS document_code,
                    d.title AS document_title,
                    dr.revision_label
                FROM training_modules tm
                LEFT JOIN documents d ON d.id = tm.source_document_id
                LEFT JOIN document_revisions dr ON dr.id = tm.source_revision_id
                WHERE tm.id = CAST(:module_id AS uuid)
                """
            ),
            {"module_id": module_id},
        ).mappings().first()
        if not module:
            raise HTTPException(status_code=404, detail="Training module not found")

        steps = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        ts.id::text AS id,
                        ts.step_number,
                        ts.title,
                        ts.instruction,
                        ts.voice_prompt,
                        ts.operator_check,
                        ts.source_chunk_id::text AS source_chunk_id,
                        dc.citation_label,
                        dc.page_start,
                        dc.page_end
                    FROM training_steps ts
                    LEFT JOIN document_chunks dc ON dc.id = ts.source_chunk_id
                    WHERE ts.module_id = CAST(:module_id AS uuid)
                    ORDER BY ts.step_number
                    """
                ),
                {"module_id": module_id},
            ).mappings()
        ]

    return {"module": dict(module), "steps": steps, "assignment": dict(assignment) if assignment else None}


@app.post("/api/training/assignments/{assignment_id}/progress")
async def update_assignment_progress(assignment_id: str, req: AssignmentProgressRequest):
    now = datetime.now(timezone.utc)
    with engine.begin() as conn:
        assignment = conn.execute(
            text(
                """
                SELECT
                    ta.id::text AS id,
                    ta.module_id::text AS module_id,
                    ta.user_id::text AS user_id
                FROM training_assignments ta
                WHERE ta.id = CAST(:assignment_id AS uuid)
                """
            ),
            {"assignment_id": assignment_id},
        ).mappings().first()
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")
        if assignment["user_id"] != req.user_id:
            raise HTTPException(status_code=403, detail="Assignment does not belong to this user")

        next_status = req.status
        if next_status is None:
            if req.progress_percent >= 100:
                next_status = "completed"
            elif req.progress_percent > 0:
                next_status = "in_progress"
            else:
                next_status = "assigned"
        if next_status not in {"assigned", "in_progress", "completed"}:
            raise HTTPException(status_code=400, detail="Invalid status")

        started_at = now if next_status in {"in_progress", "completed"} else None
        completed_at = now if next_status == "completed" else None
        conn.execute(
            text(
                """
                UPDATE training_assignments
                SET
                    progress_percent = :progress_percent,
                    current_step = :current_step,
                    status = :status,
                    started_at = COALESCE(started_at, :started_at),
                    completed_at = CASE WHEN :status = 'completed' THEN COALESCE(completed_at, :completed_at) ELSE NULL END,
                    last_activity_at = :last_activity_at,
                    updated_at = now()
                WHERE id = CAST(:assignment_id AS uuid)
                """
            ),
            {
                "assignment_id": assignment_id,
                "progress_percent": req.progress_percent,
                "current_step": req.current_step,
                "status": next_status,
                "started_at": started_at,
                "completed_at": completed_at,
                "last_activity_at": now,
            },
        )

        updated = conn.execute(
            text(
                """
                SELECT
                    id::text AS assignment_id,
                    status,
                    progress_percent,
                    current_step,
                    started_at,
                    completed_at,
                    last_activity_at
                FROM training_assignments
                WHERE id = CAST(:assignment_id AS uuid)
                """
            ),
            {"assignment_id": assignment_id},
        ).mappings().first()

    payload = dict(updated)
    payload["started_at"] = _iso(payload["started_at"])
    payload["completed_at"] = _iso(payload["completed_at"])
    payload["last_activity_at"] = _iso(payload["last_activity_at"])
    return payload

@app.post("/api/query", response_model=QueryResponse)
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
    retrieval_event_id = result.get("retrieval_event_id") or result.get("event_id")

    return QueryResponse(
        answer=answer,
        confidence=float(result["confidence"]),
        latency_ms=int(result["latency_ms"]),
        retrieval_event_id=retrieval_event_id,
        evidence=[QueryEvidence(**ev) for ev in evidence],
        diagnostics=result["diagnostics"],
    )


@app.get("/api/query/{event_id}/evidence")
async def retrieval_evidence(event_id: str):
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

        hit_ids: list[str] = []
        for family in ("lexical_hits", "semantic_hits", "graph_hits"):
            for hit in event[family] or []:
                chunk_id = hit.get("chunk_id")
                if chunk_id and chunk_id not in hit_ids:
                    hit_ids.append(chunk_id)
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
    payload["created_at"] = _iso(payload["created_at"])
    payload["evidence"] = evidence
    return payload


@app.get("/api/retrieval/status")
async def retrieval_status():
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

    graph = check_neo4j_connection()
    return {
        "status": "ok",
        "postgres": pg_counts,
        "neo4j": {
            "database": graph["database"],
            "server_time": graph["server_time"],
            "uri": graph["uri"],
        },
        "embedding_model": settings.EMBEDDING_MODEL,
    }


@app.get("/api/documents")
async def list_documents():
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT
                    d.id::text AS id,
                    d.code,
                    d.title,
                    d.document_type AS department,
                    dr.revision_label AS revision,
                    dr.page_count AS pages,
                    dr.updated_at AS lastUpdated,
                    CASE WHEN dr.is_latest_approved THEN 'Current' ELSE 'Archived' END AS status
                FROM documents d
                JOIN document_revisions dr ON dr.document_id = d.id
                WHERE dr.is_latest_approved = true
                ORDER BY d.code
                """
            )
        ).mappings()
        docs = [dict(row) for row in rows]
        for doc in docs:
            if doc.get("lastUpdated"):
                doc["lastUpdated"] = _iso(doc["lastUpdated"]).split("T")[0]
    return {"documents": docs}


@app.get("/api/documents/{revision_id}/page/{page_number}")
async def document_page_view(revision_id: str, page_number: int):
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
            chunk = conn.execute(
                text("""
                    SELECT content, page_start, citation_label
                    FROM document_chunks
                    WHERE revision_id = CAST(:revision_id AS uuid)
                    AND page_start = :page_number
                    LIMIT 1
                """),
                {"revision_id": revision_id, "page_number": page_number}
            ).mappings().first()

            if not chunk:
                chunk = conn.execute(
                    text("""
                        SELECT content, page_start, citation_label
                        FROM document_chunks
                        WHERE id = CAST(:revision_id AS uuid)
                        LIMIT 1
                    """),
                    {"revision_id": revision_id}
                ).mappings().first()

            if chunk:
                return {
                    "page": {
                        "page_id": f"chunk-{page_number}",
                        "revision_id": revision_id,
                        "page_number": page_number,
                        "classification": "from_chunk",
                        "raw_text": chunk["content"],
                    },
                    "blocks": [
                        {
                            "block_id": f"block-{page_number}",
                            "block_type": "text",
                            "text": chunk["content"],
                            "bbox_left": None,
                            "bbox_top": None,
                            "bbox_right": None,
                            "bbox_bottom": None,
                        }
                    ],
                    "is_chunk_fallback": True,
                }
            raise HTTPException(status_code=404, detail="Page not found for revision")

        page = dict(page)
        if page.get("image_path"):
            page["image_url"] = f"/api/documents/{revision_id}/page/{page_number}/image"


@app.get("/api/chunks/{chunk_id}/content")
async def chunk_content_view(chunk_id: str):
    with engine.connect() as conn:
        chunk = conn.execute(
            text("""
                SELECT dc.id::text, dc.content, dc.page_start, dc.section_title,
                       dc.citation_label, dc.bbox_x0, dc.bbox_y0, dc.bbox_x1, dc.bbox_y1,
                       d.code as document_code, d.title as document_title
                FROM document_chunks dc
                JOIN document_revisions dr ON dc.revision_id = dr.id
                JOIN documents d ON dr.document_id = d.id
                WHERE dc.id = CAST(:chunk_id AS uuid)
            """),
            {"chunk_id": chunk_id}
        ).mappings().first()

        if not chunk:
            raise HTTPException(status_code=404, detail="Chunk not found")

        return {
            "page": {
                "page_id": f"chunk-{chunk['id']}",
                "revision_id": "",
                "page_number": chunk["page_start"],
                "classification": "from_chunk",
                "raw_text": chunk["content"],
            },
            "blocks": [
                {
                    "block_id": f"block-{chunk['id']}",
                    "block_type": "text",
                    "section_title": chunk.get("section_title"),
                    "text": chunk["content"],
                    "bbox_left": chunk.get("bbox_x0"),
                    "bbox_top": chunk.get("bbox_y0"),
                    "bbox_right": chunk.get("bbox_x1"),
                    "bbox_bottom": chunk.get("bbox_y1"),
                }
            ],
            "is_chunk_fallback": True,
            "document_code": chunk.get("document_code"),
            "document_title": chunk.get("document_title"),
            "bbox_x0": chunk.get("bbox_x0"),
            "bbox_y0": chunk.get("bbox_y0"),
            "bbox_x1": chunk.get("bbox_x1"),
            "bbox_y1": chunk.get("bbox_y1"),
        }
        if page.get("image_path"):
            page["image_url"] = f"/api/documents/{revision_id}/page/{page_number}/image"

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

    return {"page": page, "blocks": blocks}


@app.get("/api/documents/{revision_id}/page/{page_number}/image")
async def document_page_image(revision_id: str, page_number: int):
    with engine.connect() as conn:
        page = conn.execute(
            text(
                """
                SELECT ep.image_path
                FROM extracted_pages ep
                WHERE ep.revision_id = CAST(:revision_id AS uuid)
                  AND ep.page_number = :page_number
                """
            ),
            {"revision_id": revision_id, "page_number": page_number},
        ).mappings().first()

    if not page or not page.get("image_path"):
        raise HTTPException(status_code=404, detail="Page image not found")

    image_path = Path(page["image_path"])
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Page image file missing")

    return FileResponse(image_path)


@app.get("/api/assessments/{assessment_id}")
async def assessment_details(assessment_id: str, user_id: str):
    with engine.connect() as conn:
        user = _get_user(conn, user_id)
        assessment = conn.execute(
            text(
                """
                SELECT
                    a.id::text AS id,
                    a.module_id::text AS module_id,
                    a.title,
                    a.passing_score,
                    a.time_limit_seconds,
                    a.certification_label,
                    tm.title AS module_title,
                    tm.total_steps
                FROM assessments a
                JOIN training_modules tm ON tm.id = a.module_id
                WHERE a.id = CAST(:assessment_id AS uuid)
                """
            ),
            {"assessment_id": assessment_id},
        ).mappings().first()
        if not assessment:
            raise HTTPException(status_code=404, detail="Assessment not found")

        assignment = conn.execute(
            text(
                """
                SELECT
                    ta.id::text AS assignment_id,
                    ta.status,
                    ta.progress_percent
                FROM training_assignments ta
                WHERE ta.user_id = CAST(:user_id AS uuid)
                  AND ta.module_id = CAST(:module_id AS uuid)
                """
            ),
            {"user_id": user_id, "module_id": assessment["module_id"]},
        ).mappings().first()
        if user["role"] not in {"admin", "supervisor"} and not assignment:
            raise HTTPException(status_code=403, detail="Assessment is not assigned to this user")

        questions = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        q.id::text AS question_id,
                        q.question_order,
                        q.concept_tag,
                        q.question_text,
                        q.options,
                        q.explanation,
                        q.source_chunk_id::text AS source_chunk_id,
                        dc.citation_label,
                        dc.page_start,
                        dc.page_end
                    FROM assessment_questions q
                    LEFT JOIN document_chunks dc ON dc.id = q.source_chunk_id
                    WHERE q.assessment_id = CAST(:assessment_id AS uuid)
                    ORDER BY q.question_order
                    """
                ),
                {"assessment_id": assessment_id},
            ).mappings()
        ]

    return {
        "assessment": dict(assessment),
        "assignment": dict(assignment) if assignment else None,
        "questions": questions,
    }


@app.post("/api/assessments/{assessment_id}/submit")
async def submit_assessment(assessment_id: str, req: AssessmentSubmitRequest):
    if not req.responses:
        raise HTTPException(status_code=400, detail="At least one response is required")

    now = datetime.now(timezone.utc)
    with engine.begin() as conn:
        user = _get_user(conn, req.user_id)
        assessment = conn.execute(
            text(
                """
                SELECT
                    a.id::text AS id,
                    a.module_id::text AS module_id,
                    a.passing_score
                FROM assessments a
                WHERE a.id = CAST(:assessment_id AS uuid)
                """
            ),
            {"assessment_id": assessment_id},
        ).mappings().first()
        if not assessment:
            raise HTTPException(status_code=404, detail="Assessment not found")

        assignment = conn.execute(
            text(
                """
                SELECT ta.id::text AS assignment_id
                FROM training_assignments ta
                WHERE ta.user_id = CAST(:user_id AS uuid)
                  AND ta.module_id = CAST(:module_id AS uuid)
                """
            ),
            {"user_id": req.user_id, "module_id": assessment["module_id"]},
        ).mappings().first()
        if user["role"] not in {"admin", "supervisor"} and not assignment:
            raise HTTPException(status_code=403, detail="Assessment not assigned to this user")

        questions = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT id::text AS question_id, correct_option
                    FROM assessment_questions
                    WHERE assessment_id = CAST(:assessment_id AS uuid)
                    """
                ),
                {"assessment_id": assessment_id},
            ).mappings()
        ]
        if not questions:
            raise HTTPException(status_code=400, detail="Assessment has no questions")

        question_map = {q["question_id"]: q["correct_option"] for q in questions}
        total = len(question_map)
        correct = 0
        evaluated = 0
        for qid, selected in req.responses.items():
            if qid not in question_map:
                continue
            evaluated += 1
            if selected == question_map[qid]:
                correct += 1
        score = round((correct / total) * 100, 2)
        passed = score >= float(assessment["passing_score"])

        attempt_number = int(
            conn.execute(
                text(
                    """
                    SELECT COALESCE(MAX(attempt_number), 0) + 1
                    FROM assessment_attempts
                    WHERE user_id = CAST(:user_id AS uuid)
                      AND assessment_id = CAST(:assessment_id AS uuid)
                    """
                ),
                {"user_id": req.user_id, "assessment_id": assessment_id},
            ).scalar_one()
        )
        attempt_id = str(uuid.uuid4())
        conn.execute(
            text(
                """
                INSERT INTO assessment_attempts (
                    id, user_id, assessment_id, attempt_number, score, status,
                    started_at, completed_at, responses
                ) VALUES (
                    CAST(:id AS uuid), CAST(:user_id AS uuid), CAST(:assessment_id AS uuid), :attempt_number,
                    :score, 'completed', :started_at, :completed_at, CAST(:responses AS jsonb)
                )
                """
            ),
            {
                "id": attempt_id,
                "user_id": req.user_id,
                "assessment_id": assessment_id,
                "attempt_number": attempt_number,
                "score": score,
                "started_at": now,
                "completed_at": now,
                "responses": json.dumps(req.responses),
            },
        )

        if assignment:
            conn.execute(
                text(
                    """
                    UPDATE training_assignments
                    SET
                        status = CASE WHEN :passed THEN 'completed' ELSE 'in_progress' END,
                        progress_percent = CASE WHEN :passed THEN 100 ELSE GREATEST(progress_percent, 80) END,
                        completed_at = CASE WHEN :passed THEN COALESCE(completed_at, :completed_at) ELSE NULL END,
                        last_activity_at = :completed_at,
                        updated_at = now()
                    WHERE id = CAST(:assignment_id AS uuid)
                    """
                ),
                {
                    "assignment_id": assignment["assignment_id"],
                    "passed": passed,
                    "completed_at": now,
                },
            )

        certification_status = "inactive"
        if passed:
            cert_id = _det_uuid("certification", req.user_id, assessment["module_id"])
            conn.execute(
                text(
                    """
                    INSERT INTO certifications (
                        id, user_id, module_id, status, issued_at, expires_at, last_attempt_id
                    ) VALUES (
                        CAST(:id AS uuid), CAST(:user_id AS uuid), CAST(:module_id AS uuid),
                        'active', :issued_at, :expires_at, CAST(:last_attempt_id AS uuid)
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        status = 'active',
                        issued_at = EXCLUDED.issued_at,
                        expires_at = EXCLUDED.expires_at,
                        last_attempt_id = EXCLUDED.last_attempt_id,
                        updated_at = now()
                    """
                ),
                {
                    "id": cert_id,
                    "user_id": req.user_id,
                    "module_id": assessment["module_id"],
                    "issued_at": now,
                    "expires_at": now + timedelta(days=365),
                    "last_attempt_id": attempt_id,
                },
            )
            certification_status = "active"

    return {
        "attempt_id": attempt_id,
        "attempt_number": attempt_number,
        "score": score,
        "total_questions": total,
        "evaluated_answers": evaluated,
        "correct_answers": correct,
        "passed": passed,
        "passing_score": float(assessment["passing_score"]),
        "certification_status": certification_status,
    }


@app.get("/api/admin/readiness/overview")
async def admin_readiness_overview(user_id: str):
    with engine.connect() as conn:
        user = _get_user(conn, user_id)
        _require_admin_or_supervisor(user)

        totals = conn.execute(
            text(
                """
                SELECT
                    count(*) FILTER (WHERE ta.is_mandatory) AS mandatory_total,
                    count(*) FILTER (WHERE ta.is_mandatory AND ta.status = 'completed') AS mandatory_completed,
                    count(*) FILTER (WHERE ta.status = 'in_progress') AS in_progress_count,
                    count(*) FILTER (WHERE ta.status = 'assigned') AS assigned_count
                FROM training_assignments ta
                """
            )
        ).mappings().one()

        cert_stats = conn.execute(
            text(
                """
                SELECT
                    count(*) FILTER (WHERE status = 'active') AS active_certifications,
                    count(*) AS total_certifications
                FROM certifications
                """
            )
        ).mappings().one()

        avg_score = conn.execute(
            text("SELECT COALESCE(avg(score), 0) AS avg_score FROM assessment_attempts WHERE status = 'completed'")
        ).scalar_one()

        dept_rows = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        COALESCE(d.name, 'unassigned') AS department,
                        count(*) FILTER (WHERE ta.is_mandatory) AS mandatory_total,
                        count(*) FILTER (WHERE ta.is_mandatory AND ta.status = 'completed') AS mandatory_completed
                    FROM training_assignments ta
                    JOIN users u ON u.id = ta.user_id
                    LEFT JOIN departments d ON d.id = u.department_id
                    GROUP BY COALESCE(d.name, 'unassigned')
                    ORDER BY department
                    """
                )
            ).mappings()
        ]

        trend_rows = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        date_trunc('day', completed_at) AS day,
                        count(*) AS completed_count
                    FROM training_assignments
                    WHERE completed_at IS NOT NULL
                      AND completed_at >= now() - interval '21 day'
                    GROUP BY date_trunc('day', completed_at)
                    ORDER BY day
                    """
                )
            ).mappings()
        ]

        operator_rows = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        u.id::text AS user_id,
                        u.full_name,
                        u.role,
                        COALESCE(d.name, 'unassigned') AS department,
                        count(*) FILTER (WHERE ta.is_mandatory) AS mandatory_total,
                        count(*) FILTER (WHERE ta.is_mandatory AND ta.status = 'completed') AS mandatory_completed,
                        count(*) FILTER (WHERE c.status = 'active') AS active_certifications,
                        max(c.expires_at) AS latest_cert_expiry
                    FROM users u
                    LEFT JOIN departments d ON d.id = u.department_id
                    LEFT JOIN training_assignments ta ON ta.user_id = u.id
                    LEFT JOIN certifications c ON c.user_id = u.id
                    GROUP BY u.id, u.full_name, u.role, COALESCE(d.name, 'unassigned')
                    ORDER BY u.role, u.full_name
                    """
                )
            ).mappings()
        ]

    mandatory_total = int(totals["mandatory_total"] or 0)
    mandatory_completed = int(totals["mandatory_completed"] or 0)
    mandatory_completion = (mandatory_completed / mandatory_total) * 100 if mandatory_total else 0.0
    certification_rate = (
        (int(cert_stats["active_certifications"] or 0) / mandatory_total) * 100 if mandatory_total else 0.0
    )
    readiness_score = round(0.6 * mandatory_completion + 0.25 * certification_rate + 0.15 * float(avg_score or 0.0), 2)

    for row in dept_rows:
        total = int(row["mandatory_total"] or 0)
        completed = int(row["mandatory_completed"] or 0)
        row["completion_rate"] = round((completed / total) * 100, 2) if total else 0.0

    for row in trend_rows:
        row["day"] = _iso(row["day"])
    for row in operator_rows:
        total = int(row["mandatory_total"] or 0)
        completed = int(row["mandatory_completed"] or 0)
        row["completion_rate"] = round((completed / total) * 100, 2) if total else 0.0
        row["latest_cert_expiry"] = _iso(row["latest_cert_expiry"])

    return {
        "requestor": user,
        "kpis": {
            "operational_readiness_score": readiness_score,
            "mandatory_completion_rate": round(mandatory_completion, 2),
            "certification_rate": round(certification_rate, 2),
            "average_assessment_score": round(float(avg_score or 0.0), 2),
            "in_progress_count": int(totals["in_progress_count"] or 0),
            "assigned_count": int(totals["assigned_count"] or 0),
        },
        "department_compliance": dept_rows,
        "training_completion_trend": trend_rows,
        "operator_status": operator_rows,
    }


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    _require_secret(settings.GROQ_API_KEY, "GROQ_API_KEY")
    _require_secret(settings.SARVAM_API_KEY, "SARVAM_API_KEY")

    retrieval_result = retriever.query(
        query_text=req.text,
        language=req.language,
        role="operator",
        user_id=None,
        top_k=5
    )

    evidence = retrieval_result.get("evidence", [])
    confidence = retrieval_result.get("confidence", 0.0)

    context_parts = []
    citations = []

    min_content_length = 50
    valid_chunks = []
    for chunk in evidence:
        content = chunk.get('content', '') or ''
        if len(content.strip()) >= min_content_length:
            valid_chunks.append(chunk)

    for i, chunk in enumerate(valid_chunks, 1):
        source_info = f"[{i}] {chunk.get('document_title', 'Unknown')} ({chunk.get('document_code', '')})"
        if chunk.get('citation_label'):
            source_info += f" - {chunk['citation_label']}"
        if chunk.get('page_start'):
            source_info += f", Page {chunk['page_start']}"
        context_parts.append(f"{source_info}\n{chunk.get('content', '')}")
        citations.append(Citation(
            chunk_id=chunk.get("chunk_id", ""),
            document_code=chunk.get("document_code"),
            document_title=chunk.get("document_title"),
            revision_label=chunk.get("revision_label"),
            page_start=chunk.get("page_start"),
            citation_label=chunk.get("citation_label"),
            section_title=chunk.get("section_title"),
            content=chunk.get("content")
        ))

    context = "\n\n".join(context_parts)

    if not valid_chunks or confidence < 0.1:
        assistant_text = "I couldn't find specific instructions for this in the available documents. The relevant procedures may not have been uploaded yet. Please contact your supervisor or check if the document containing this procedure is available in the system."
        audio_base64 = ""
    else:
        if len(valid_chunks) < 2 or confidence < 0.3:
            system_prompt = f"""You are a plant-floor assistant. You found LIMITED information in the documents.

The search found some related content but it's not detailed enough to provide complete instructions.
- Be honest that the information is limited
- Provide what's available but note the limitations
- Suggest checking the specific document page for complete procedures

Context (limited):
{context}"""
        else:
            system_prompt = f"""You are a plant-floor assistant helping operators with equipment procedures.

IMPORTANT:
- Provide CLEAR, SPECIFIC, STEP-BY-STEP instructions
- If the context contains vague information, acknowledge it and provide your best understanding
- When citing, include the document name and page number
- If you cannot find sufficient information, clearly state so

Context from documents:
{context}"""

        async with httpx.AsyncClient(timeout=45.0) as client:
            llm_resp = await client.post(
                GROQ_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.GROQ_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": req.text},
                    ],
                    "max_tokens": 512,
                    "temperature": 0.4,
                },
            )
            llm_resp.raise_for_status()
            assistant_text = llm_resp.json()["choices"][0]["message"]["content"]

    audio_base64 = ""
    if settings.SARVAM_API_KEY and assistant_text:
        async with httpx.AsyncClient(timeout=45.0) as client:
            assistant_tts_text, tts_language = await _translate_assistant_text(client, assistant_text, req.language)
            audio_base64 = await _synthesize_speech(client, assistant_tts_text, tts_language, req.speaker)

    return ChatResponse(
        user_text=req.text,
        assistant_text=assistant_text,
        audio_base64=audio_base64,
        citations=citations
    )


@app.post("/api/stt")
async def speech_to_text(audio: UploadFile = File(...), language: str = Form("auto")):
    _require_secret(settings.SARVAM_API_KEY, "SARVAM_API_KEY")
    audio_bytes = await audio.read()

    async with httpx.AsyncClient(timeout=45.0) as client:
        transcript, detected_language = await _translate_speech_to_english(client, audio_bytes, language)

    return {"text": transcript, "language": detected_language, "detected_language": detected_language}


@app.post("/api/voice")
async def voice_pipeline(audio: UploadFile = File(...), language: str = Form("auto"), speaker: str = Form("meera")):
    _require_secret(settings.GROQ_API_KEY, "GROQ_API_KEY")
    _require_secret(settings.SARVAM_API_KEY, "SARVAM_API_KEY")

    audio_bytes = await audio.read()

    async with httpx.AsyncClient(timeout=45.0) as client:
        user_text, detected_language = await _translate_speech_to_english(client, audio_bytes, language)

    if not user_text.strip():
        raise HTTPException(status_code=400, detail="Could not understand speech")

    async with httpx.AsyncClient(timeout=45.0) as client:
        llm_resp = await client.post(
            GROQ_CHAT_URL,
            headers={
                "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.GROQ_MODEL,
                "messages": [
                    {"role": "system", "content": "Respond briefly for voice. Prioritize safety."},
                    {"role": "user", "content": user_text},
                ],
                "max_tokens": 256,
                "temperature": 0.4,
            },
        )
        llm_resp.raise_for_status()
        assistant_text = llm_resp.json()["choices"][0]["message"]["content"]

    async with httpx.AsyncClient(timeout=45.0) as client:
        assistant_tts_text, tts_language = await _translate_assistant_text(client, assistant_text, detected_language)
        audio_base64 = await _synthesize_speech(client, assistant_tts_text, tts_language, speaker)

    return {
        "user_text": user_text,
        "assistant_text": assistant_text,
        "assistant_tts_text": assistant_tts_text,
        "audio_base64": audio_base64,
        "detected_language": detected_language,
        "tts_language": tts_language,
    }


@app.get("/api/health")
async def health():
    db_status = {"postgres": "unknown", "neo4j": "unknown"}
    try:
        db_status["postgres"] = check_postgres_connection()["status"]
    except Exception:
        db_status["postgres"] = "error"

    try:
        db_status["neo4j"] = check_neo4j_connection()["status"]
    except Exception:
        db_status["neo4j"] = "error"

    return {
        "status": "ok",
        "db": db_status,
        "models": {
            "embedding": settings.EMBEDDING_MODEL,
            "llm": settings.GROQ_MODEL,
            "stt": settings.SARVAM_STT_MODEL,
            "tts": settings.SARVAM_TTS_MODEL,
        },
    }


class SOPUploadRequest(BaseModel):
    title: str
    code: str
    document_type: str = "sop"
    department: str = "operations"


class PurgeDocumentsRequest(BaseModel):
    user_id: str
    document_type: str | None = None
    confirm: bool = False


@app.post("/api/admin/sop/upload")
async def upload_sop(
    file: UploadFile = File(...),
    title: str = Form(...),
    code: str = Form(...),
    admin_user_id: str = Form(...),
    document_type: str = Form("sop"),
    department: str = Form("operations"),
):
    settings = get_settings()
    upload_dir = Path(settings.RAW_DATA_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)

    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in [".pdf", ".txt", ".md"]:
        raise HTTPException(status_code=400, detail="Only PDF, TXT, MD files supported")

    with engine.connect() as conn:
        user = _get_user(conn, admin_user_id)
        _require_admin(user)

    doc_id = str(uuid.uuid4())
    revision_id = str(uuid.uuid4())
    safe_name = f"{code}_{revision_id}{file_ext}".replace(" ", "_")
    saved_path = upload_dir / safe_name

    content = await file.read()
    saved_path.write_bytes(content)

    from app.services.sop_pipeline import process_document

    try:
        extraction = process_document(str(saved_path), doc_id, revision_id)
    except ModuleNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Missing dependency: {exc.name}. "
                "Install backend requirements (PyMuPDF is required for PDF rendering)."
            ),
        ) from exc
    except Exception as exc:
        import traceback

        print(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Processing failed: {type(exc).__name__}: {exc}",
        ) from exc
    chunks = extraction.get("chunks", [])
    pages = extraction.get("pages", [])
    if not chunks:
        raise HTTPException(status_code=400, detail="Could not extract text from document")

    from app.services.embedding_service import embed_texts

    contents = [c["content"] for c in chunks]
    embeddings = embed_texts(contents)

    with engine.begin() as conn:
        has_source_filename = conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'documents' AND column_name = 'source_filename'
                """
            )
        ).scalar()

        if has_source_filename:
            conn.execute(
                text(
                    """
                    INSERT INTO documents (
                        id, code, title, document_type, department_name, source_filename,
                        is_active, created_at, updated_at
                    )
                    VALUES (:id, :code, :title, :doc_type, :dept, :source_filename, true, NOW(), NOW())
                    """
                ),
                {
                    "id": doc_id,
                    "code": code,
                    "title": title,
                    "doc_type": document_type,
                    "dept": department,
                    "source_filename": file.filename,
                },
            )
        else:
            conn.execute(
                text(
                    """
                    INSERT INTO documents (id, code, title, document_type, department_name, is_active, created_at, updated_at)
                    VALUES (:id, :code, :title, :doc_type, :dept, true, NOW(), NOW())
                    """
                ),
                {
                    "id": doc_id,
                    "code": code,
                    "title": title,
                    "doc_type": document_type,
                    "dept": department,
                },
            )

        conn.execute(
            text(
                """
                INSERT INTO document_revisions (
                    id, document_id, revision_label, version_number, is_latest_approved,
                    file_path, page_count, extraction_classification, extraction_status,
                    created_at, updated_at
                )
                VALUES (
                    :id, :doc_id, 'v1', 1, true,
                    :file_path, :page_count, :classification, 'completed',
                    NOW(), NOW()
                )
                """
            ),
            {
                "id": revision_id,
                "doc_id": doc_id,
                "file_path": str(saved_path),
                "page_count": extraction.get("page_count", 0),
                "classification": extraction.get("classification", "unknown"),
            },
        )

        page_id_map: dict[int, str] = {}
        for page in pages:
            page_id = str(uuid.uuid4())
            page_id_map[page["page_number"]] = page_id
            conn.execute(
                text(
                    """
                    INSERT INTO extracted_pages (
                        id, revision_id, page_number, classification, extracted_text_chars,
                        raw_text, markdown_path, image_path, ocr_used, ocr_confidence, created_at
                    )
                    VALUES (
                        CAST(:id AS uuid), CAST(:revision_id AS uuid), :page_number, :classification,
                        :extracted_text_chars, :raw_text, :markdown_path, :image_path, :ocr_used,
                        :ocr_confidence, NOW()
                    )
                    """
                ),
                {
                    "id": page_id,
                    "revision_id": revision_id,
                    "page_number": page["page_number"],
                    "classification": page.get("classification", "unknown"),
                    "extracted_text_chars": page.get("extracted_text_chars", 0),
                    "raw_text": page.get("raw_text"),
                    "markdown_path": page.get("markdown_path"),
                    "image_path": page.get("image_path"),
                    "ocr_used": page.get("ocr_used", False),
                    "ocr_confidence": page.get("ocr_confidence"),
                },
            )

        for page in pages:
            page_id = page_id_map.get(page["page_number"])
            for block in page.get("blocks", []):
                bbox = block.get("bbox") or {}
                conn.execute(
                    text(
                        """
                        INSERT INTO extracted_blocks (
                            id, page_id, block_type, section_title, text,
                            bbox_left, bbox_top, bbox_right, bbox_bottom,
                            confidence, reading_order, created_at
                        )
                        VALUES (
                            CAST(:id AS uuid), CAST(:page_id AS uuid), :block_type, :section_title, :text,
                            :bbox_left, :bbox_top, :bbox_right, :bbox_bottom,
                            :confidence, :reading_order, NOW()
                        )
                        """
                    ),
                    {
                        "id": block["block_id"],
                        "page_id": page_id,
                        "block_type": block.get("block_type", "unknown"),
                        "section_title": block.get("section_title"),
                        "text": block.get("text") or "",
                        "bbox_left": bbox.get("left"),
                        "bbox_top": bbox.get("top"),
                        "bbox_right": bbox.get("right"),
                        "bbox_bottom": bbox.get("bottom"),
                        "confidence": block.get("confidence"),
                        "reading_order": block.get("reading_order"),
                    },
                )

        for i, chunk in enumerate(chunks):
            citation_label = chunk.get("citation_label")
            if citation_label:
                citation_label = f"{code} {citation_label}"
            conn.execute(
                text(
                    """
                    INSERT INTO document_chunks (
                        id, revision_id, chunk_index, chunk_type, page_start, page_end,
                        section_title, citation_label, content, block_ids,
                        equipment_tags, safety_flags, embedding, created_at
                    ) VALUES (
                        CAST(:id AS uuid), CAST(:rev_id AS uuid), :idx, :chunk_type, :page_start, :page_end,
                        :section_title, :citation_label, :content, CAST(:block_ids AS jsonb),
                        CAST(:equipment_tags AS jsonb), CAST(:safety_flags AS jsonb), :embedding, NOW()
                    )
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "rev_id": revision_id,
                    "idx": chunk["chunk_index"],
                    "chunk_type": chunk.get("chunk_type", "section"),
                    "page_start": chunk.get("page_start"),
                    "page_end": chunk.get("page_end"),
                    "section_title": chunk.get("section_title"),
                    "citation_label": citation_label,
                    "content": chunk.get("content", ""),
                    "block_ids": json.dumps(chunk.get("block_ids", [])),
                    "equipment_tags": json.dumps([]),
                    "safety_flags": json.dumps([]),
                    "embedding": "[" + ",".join(str(x) for x in embeddings[i]) + "]",
                },
            )

    from app.services.bm25_retriever import refresh_bm25_index
    refresh_bm25_index()

    return {
        "status": "success",
        "document_id": doc_id,
        "revision_id": revision_id,
        "chunks_created": len(chunks),
        "page_count": extraction.get("page_count", 0),
        "message": f"SOP '{title}' uploaded and indexed successfully",
    }


@app.post("/api/admin/sop/text")
async def create_sop_text(
    title: str = Form(...),
    code: str = Form(...),
    admin_user_id: str = Form(...),
    content: str = Form(...),
    document_type: str = Form("sop"),
    department: str = Form("operations"),
):
    settings = get_settings()
    upload_dir = Path(settings.RAW_DATA_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)

    with engine.connect() as conn:
        user = _get_user(conn, admin_user_id)
        _require_admin(user)

    doc_id = str(uuid.uuid4())
    revision_id = str(uuid.uuid4())
    temp_path = upload_dir / f"{code}_{revision_id}.txt"
    temp_path.write_text(content, encoding="utf-8")

    from app.services.sop_pipeline import process_document
    from app.services.embedding_service import embed_texts

    extraction = process_document(str(temp_path), doc_id, revision_id)
    chunks = extraction.get("chunks", [])
    pages = extraction.get("pages", [])
    if not chunks:
        raise HTTPException(status_code=400, detail="Could not chunk content")

    contents = [c["content"] for c in chunks]
    embeddings = embed_texts(contents)

    with engine.begin() as conn:
        has_source_filename = conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'documents' AND column_name = 'source_filename'
                """
            )
        ).scalar()

        if has_source_filename:
            conn.execute(
                text(
                    """
                    INSERT INTO documents (
                        id, code, title, document_type, department_name, source_filename,
                        is_active, created_at, updated_at
                    )
                    VALUES (:id, :code, :title, :doc_type, :dept, :source_filename, true, NOW(), NOW())
                    """
                ),
                {
                    "id": doc_id,
                    "code": code,
                    "title": title,
                    "doc_type": document_type,
                    "dept": department,
                    "source_filename": temp_path.name,
                },
            )
        else:
            conn.execute(
                text(
                    """
                    INSERT INTO documents (id, code, title, document_type, department_name, is_active, created_at, updated_at)
                    VALUES (:id, :code, :title, :doc_type, :dept, true, NOW(), NOW())
                    """
                ),
                {
                    "id": doc_id,
                    "code": code,
                    "title": title,
                    "doc_type": document_type,
                    "dept": department,
                },
            )

        conn.execute(
            text(
                """
                INSERT INTO document_revisions (
                    id, document_id, revision_label, version_number, is_latest_approved,
                    file_path, page_count, extraction_classification, extraction_status,
                    created_at, updated_at
                )
                VALUES (
                    :id, :doc_id, 'v1', 1, true,
                    :file_path, :page_count, :classification, 'completed',
                    NOW(), NOW()
                )
                """
            ),
            {
                "id": revision_id,
                "doc_id": doc_id,
                "file_path": str(temp_path),
                "page_count": extraction.get("page_count", 1),
                "classification": extraction.get("classification", "digital"),
            },
        )

        page_id_map: dict[int, str] = {}
        for page in pages:
            page_id = str(uuid.uuid4())
            page_id_map[page["page_number"]] = page_id
            conn.execute(
                text(
                    """
                    INSERT INTO extracted_pages (
                        id, revision_id, page_number, classification, extracted_text_chars,
                        raw_text, markdown_path, image_path, ocr_used, ocr_confidence, created_at
                    )
                    VALUES (
                        CAST(:id AS uuid), CAST(:revision_id AS uuid), :page_number, :classification,
                        :extracted_text_chars, :raw_text, :markdown_path, :image_path, :ocr_used,
                        :ocr_confidence, NOW()
                    )
                    """
                ),
                {
                    "id": page_id,
                    "revision_id": revision_id,
                    "page_number": page["page_number"],
                    "classification": page.get("classification", "digital"),
                    "extracted_text_chars": page.get("extracted_text_chars", 0),
                    "raw_text": page.get("raw_text"),
                    "markdown_path": page.get("markdown_path"),
                    "image_path": page.get("image_path"),
                    "ocr_used": page.get("ocr_used", False),
                    "ocr_confidence": page.get("ocr_confidence"),
                },
            )

        for page in pages:
            page_id = page_id_map.get(page["page_number"])
            for block in page.get("blocks", []):
                conn.execute(
                    text(
                        """
                        INSERT INTO extracted_blocks (
                            id, page_id, block_type, section_title, text,
                            bbox_left, bbox_top, bbox_right, bbox_bottom,
                            confidence, reading_order, created_at
                        )
                        VALUES (
                            CAST(:id AS uuid), CAST(:page_id AS uuid), :block_type, :section_title, :text,
                            :bbox_left, :bbox_top, :bbox_right, :bbox_bottom,
                            :confidence, :reading_order, NOW()
                        )
                        """
                    ),
                    {
                        "id": block["block_id"],
                        "page_id": page_id,
                        "block_type": block.get("block_type", "unknown"),
                        "section_title": block.get("section_title"),
                        "text": block.get("text") or "",
                        "bbox_left": None,
                        "bbox_top": None,
                        "bbox_right": None,
                        "bbox_bottom": None,
                        "confidence": block.get("confidence"),
                        "reading_order": block.get("reading_order"),
                    },
                )

        for i, chunk in enumerate(chunks):
            citation_label = chunk.get("citation_label")
            if citation_label:
                citation_label = f"{code} {citation_label}"
            conn.execute(
                text(
                    """
                    INSERT INTO document_chunks (
                        id, revision_id, chunk_index, chunk_type, page_start, page_end,
                        section_title, citation_label, content, block_ids,
                        equipment_tags, safety_flags, embedding, created_at
                    ) VALUES (
                        CAST(:id AS uuid), CAST(:rev_id AS uuid), :idx, :chunk_type, :page_start, :page_end,
                        :section_title, :citation_label, :content, CAST(:block_ids AS jsonb),
                        CAST(:equipment_tags AS jsonb), CAST(:safety_flags AS jsonb), :embedding, NOW()
                    )
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "rev_id": revision_id,
                    "idx": chunk["chunk_index"],
                    "chunk_type": chunk.get("chunk_type", "section"),
                    "page_start": chunk.get("page_start"),
                    "page_end": chunk.get("page_end"),
                    "section_title": chunk.get("section_title"),
                    "citation_label": citation_label,
                    "content": chunk.get("content", ""),
                    "block_ids": json.dumps(chunk.get("block_ids", [])),
                    "equipment_tags": json.dumps([]),
                    "safety_flags": json.dumps([]),
                    "embedding": "[" + ",".join(str(x) for x in embeddings[i]) + "]",
                },
            )

    from app.services.bm25_retriever import refresh_bm25_index
    refresh_bm25_index()

    return {
        "status": "success",
        "document_id": doc_id,
        "revision_id": revision_id,
        "chunks_created": len(chunks),
        "message": f"SOP '{title}' created and indexed successfully",
    }


@app.post("/api/admin/documents/purge")
async def purge_documents(req: PurgeDocumentsRequest):
    with engine.connect() as conn:
        user = _get_user(conn, req.user_id)
        _require_admin(user)

    if not req.confirm:
        raise HTTPException(status_code=400, detail="Confirmation required to purge documents")

    doc_count = 0
    with engine.begin() as conn:
        if not req.document_type:
            doc_count = int(conn.execute(text("SELECT count(*) FROM documents")).scalar() or 0)
            conn.execute(
                text(
                    """
                    TRUNCATE TABLE
                        assessment_questions,
                        assessment_attempts,
                        assessments,
                        certifications,
                        training_steps,
                        training_modules,
                        training_assignments,
                        document_chunks,
                        extracted_blocks,
                        extracted_pages,
                        document_revisions,
                        documents
                    RESTART IDENTITY CASCADE
                    """
                )
            )
            doc_ids = []
        else:
            rows = conn.execute(
                text("SELECT id::text AS id FROM documents WHERE document_type = :doc_type"),
                {"doc_type": req.document_type},
            ).mappings()

            doc_ids = [row["id"] for row in rows]
            if not doc_ids:
                return {"status": "ok", "documents_deleted": 0, "message": "No documents matched purge filter"}

            revision_rows = conn.execute(
                text(
                    """
                    SELECT id::text AS id
                    FROM document_revisions
                    WHERE document_id = ANY(CAST(:doc_ids AS uuid[]))
                    """
                ),
                {"doc_ids": doc_ids},
            ).mappings()
            revision_ids = [row["id"] for row in revision_rows]

            module_rows = conn.execute(
                text(
                    """
                    SELECT id::text AS id
                    FROM training_modules
                    WHERE source_document_id = ANY(CAST(:doc_ids AS uuid[]))
                       OR source_revision_id = ANY(CAST(:rev_ids AS uuid[]))
                    """
                ),
                {"doc_ids": doc_ids, "rev_ids": revision_ids or ["00000000-0000-0000-0000-000000000000"]},
            ).mappings()
            module_ids = [row["id"] for row in module_rows]

            if module_ids:
                conn.execute(
                    text("DELETE FROM certifications WHERE module_id = ANY(CAST(:module_ids AS uuid[]))"),
                    {"module_ids": module_ids},
                )
                conn.execute(
                    text(
                        """
                        DELETE FROM assessment_attempts
                        WHERE assessment_id IN (
                            SELECT id FROM assessments WHERE module_id = ANY(CAST(:module_ids AS uuid[]))
                        )
                        """
                    ),
                    {"module_ids": module_ids},
                )
                conn.execute(
                    text(
                        """
                        DELETE FROM assessment_questions
                        WHERE assessment_id IN (
                            SELECT id FROM assessments WHERE module_id = ANY(CAST(:module_ids AS uuid[]))
                        )
                        """
                    ),
                    {"module_ids": module_ids},
                )
                conn.execute(
                    text("DELETE FROM assessments WHERE module_id = ANY(CAST(:module_ids AS uuid[]))"),
                    {"module_ids": module_ids},
                )
                conn.execute(
                    text("DELETE FROM training_steps WHERE module_id = ANY(CAST(:module_ids AS uuid[]))"),
                    {"module_ids": module_ids},
                )
                conn.execute(
                    text("DELETE FROM training_modules WHERE id = ANY(CAST(:module_ids AS uuid[]))"),
                    {"module_ids": module_ids},
                )

            conn.execute(
                text("DELETE FROM documents WHERE id = ANY(CAST(:doc_ids AS uuid[]))"),
                {"doc_ids": doc_ids},
            )

    processed_dir = Path(settings.PROCESSED_DATA_DIR)
    import shutil

    if not req.document_type:
        if processed_dir.exists():
            shutil.rmtree(processed_dir, ignore_errors=True)
            processed_dir.mkdir(parents=True, exist_ok=True)
    else:
        for doc_id in doc_ids:
            doc_dir = processed_dir / doc_id
            if doc_dir.exists():
                shutil.rmtree(doc_dir, ignore_errors=True)

    neo4j_status = "skipped"
    if settings.has_graph_credentials:
        try:
            driver = get_driver()
            with driver.session(database=settings.NEO4J_DATABASE) as session:
                session.run(
                    """
                    MATCH (n)
                    WHERE any(label IN labels(n) WHERE label IN [
                        'Document','DocumentRevision','DocumentChunk',
                        'ExtractedPage','ExtractedBlock',
                        'TrainingModule','TrainingStep',
                        'Assessment','AssessmentQuestion'
                    ])
                    DETACH DELETE n
                    """
                ).consume()
            neo4j_status = "purged"
        except Exception:
            neo4j_status = "error"

    try:
        from app.services.bm25_retriever import refresh_bm25_index

        refresh_bm25_index()
    except Exception:
        pass

    return {
        "status": "ok",
        "documents_deleted": doc_count if not req.document_type else len(doc_ids),
        "neo4j": neo4j_status,
    }


@app.post("/api/admin/refresh-index")
async def refresh_index():
    from app.services.bm25_retriever import refresh_bm25_index
    refresh_bm25_index()
    return {"status": "success", "message": "BM25 index refreshed"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
