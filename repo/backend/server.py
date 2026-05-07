from __future__ import annotations

import asyncio
import json
import mimetypes
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from time import perf_counter
from typing import Any

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core.config import get_settings
from app.db.neo4j import check_neo4j_connection, get_driver
from app.db.postgres import check_postgres_connection, engine
from app.services.db_compat import ensure_database_compatibility
from app.services.dspy_pipeline import (
    generate_grounded_answer_with_dspy,
    rewrite_query_with_dspy,
    verify_grounded_answer_with_dspy,
)
from app.services.guardrails import GuardrailDecision, evaluate_guardrail
from app.services.sop_retrieval import get_sop_retriever
from app.services.training_builder import generate_learning_assets, persist_learning_assets


settings = get_settings()
retriever = get_sop_retriever()

SARVAM_TTS_URL = settings.SARVAM_TTS_URL
SARVAM_STT_URL = settings.SARVAM_STT_URL
SARVAM_TRANSLATE_URL = settings.SARVAM_TRANSLATE_URL
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
AUTO_LANGUAGE = "unknown"
DEFAULT_TTS_LANGUAGE = "en-IN"
DEFAULT_TTS_SPEAKER = "suhani"
MAX_TTS_CHARACTERS = 500
DEFAULT_TRANSLATE_MAX_CHARACTERS = 1800
DSPY_REWRITE_TIMEOUT_SECONDS = 3.0
DSPY_ANSWER_TIMEOUT_SECONDS = 5.0
DSPY_VERIFY_TIMEOUT_SECONDS = 2.5
GROQ_ANSWER_TIMEOUT_SECONDS = 10.0
SUPPORTED_TTS_SPEAKERS = {
    "aditya",
    "ritu",
    "ashutosh",
    "priya",
    "neha",
    "rahul",
    "pooja",
    "rohan",
    "simran",
    "kavya",
    "amit",
    "dev",
    "ishita",
    "shreya",
    "ratan",
    "varun",
    "manan",
    "sumit",
    "roopa",
    "kabir",
    "aayan",
    "shubh",
    "advait",
    "amelia",
    "sophia",
    "anand",
    "tanya",
    "tarun",
    "sunny",
    "mani",
    "gokul",
    "vijay",
    "shruti",
    "suhani",
    "mohit",
    "kavitha",
    "rehan",
    "soham",
    "rupali",
    "niharika",
}
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
    speaker: str = DEFAULT_TTS_SPEAKER


class Citation(BaseModel):
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
    line_start: int | None = None
    line_end: int | None = None


class ChatResponse(BaseModel):
    user_text: str
    assistant_text: str
    assistant_tts_text: str | None = None
    audio_base64: str
    audio_mime_type: str = "audio/wav"
    citations: list[Citation] = []


class QueryRequest(BaseModel):
    query: str = Field(min_length=2)
    language: str = "en"
    role: str | None = "operator"
    user_id: str | None = None
    conversation_id: str | None = None
    revision_id: str | None = None
    chat_scope: str = "general"
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
    line_start: int | None = None
    line_end: int | None = None
    scores: dict[str, float]


class QueryResponse(BaseModel):
    answer: str
    confidence: float
    latency_ms: int
    retrieval_event_id: str | None = None
    conversation_id: str | None = None
    evidence: list[QueryEvidence]
    diagnostics: dict[str, Any]


class OperationGuideRequest(BaseModel):
    query: str = Field(min_length=2)
    language: str = "en"
    role: str | None = "operator"
    user_id: str | None = None
    conversation_id: str | None = None
    intent: str | None = None
    top_k: int = 6


class OperationGuideResponse(BaseModel):
    answer: str
    mode: str
    next_actions: list[str] = []
    state: dict[str, Any] = {}
    state_label: str | None = None
    step_index: int | None = None
    requires_supervisor: bool = False
    completion_record_id: str | None = None
    confidence: float
    latency_ms: int
    retrieval_event_id: str | None = None
    conversation_id: str | None = None
    evidence: list[QueryEvidence]
    diagnostics: dict[str, Any]


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1)
    source_language: str = DEFAULT_TTS_LANGUAGE
    target_language: str = "hi-IN"


class TranslateResponse(BaseModel):
    text: str
    translated_text: str
    source_language: str
    target_language: str


class SpeechSynthesisRequest(BaseModel):
    text: str = Field(min_length=1)
    language: str = DEFAULT_TTS_LANGUAGE
    speaker: str = DEFAULT_TTS_SPEAKER


class SpeechSynthesisResponse(BaseModel):
    text: str
    language: str
    audio_base64: str
    audio_mime_type: str = "audio/wav"


class ChatConversationCreateRequest(BaseModel):
    user_id: str
    language: str = "en"
    title: str | None = None
    chat_scope: str = "general"


class ChatConversationSummary(BaseModel):
    id: str
    user_id: str
    title: str
    language: str
    status: str
    chat_scope: str = "general"
    revision_id: str | None = None
    message_count: int = 0
    preview: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    last_message_at: str | None = None


class ChatConversationMessage(BaseModel):
    id: str
    role: str
    content: str
    language: str | None = None
    citations: list[dict[str, Any]] = []
    query_text: str | None = None
    retrieval_event_id: str | None = None
    response_mode: str = "text"
    created_at: str | None = None


class ChatConversationDetail(BaseModel):
    conversation: ChatConversationSummary
    messages: list[ChatConversationMessage]


class AssignmentProgressRequest(BaseModel):
    user_id: str
    progress_percent: float = Field(ge=0, le=100)
    current_step: int | None = Field(default=None, ge=1)
    status: str | None = None


class AssessmentSubmitRequest(BaseModel):
    user_id: str
    responses: dict[str, str] = Field(default_factory=dict)


class AdminSettingsUpdateRequest(BaseModel):
    user_id: str
    settings: dict[str, Any]


class NotificationReadRequest(BaseModel):
    user_id: str


class GuardrailAppealCreateRequest(BaseModel):
    user_id: str
    appeal_text: str = Field(min_length=10, max_length=2000)


class GuardrailAppealReviewRequest(BaseModel):
    user_id: str
    status: str
    resolution_notes: str | None = None


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


@app.on_event("startup")
async def startup_event():
    ensure_database_compatibility()
    asyncio.create_task(_warm_retrieval_stack())


async def _warm_retrieval_stack():
    def _warm():
        try:
            from app.services.bm25_retriever import get_bm25_retriever
            from app.services.embedding_service import get_embedding_model

            bm25 = get_bm25_retriever()
            if bm25.bm25 is None or not bm25.chunks:
                bm25.load_chunks()
            get_embedding_model()
        except Exception as exc:
            print(f"Retrieval warm-up skipped: {exc}")

    await asyncio.to_thread(_warm)


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


def _prepare_document_identity(conn, *, code: str) -> dict[str, Any]:
    existing = conn.execute(
        text(
            """
            SELECT id::text AS id, title, document_type, department_name
            FROM documents
            WHERE code = :code
            """
        ),
        {"code": code},
    ).mappings().first()
    if existing:
        next_version = int(
            conn.execute(
                text(
                    """
                    SELECT COALESCE(MAX(version_number), 0) + 1
                    FROM document_revisions
                    WHERE document_id = CAST(:document_id AS uuid)
                    """
                ),
                {"document_id": existing["id"]},
            ).scalar_one()
        )
        return {
            "document_id": existing["id"],
            "exists": True,
            "version_number": next_version,
            "revision_label": f"R{next_version}",
        }
    return {
        "document_id": str(uuid.uuid4()),
        "exists": False,
        "version_number": 1,
        "revision_label": "R1",
    }


def _persist_document_revision(
    conn,
    *,
    document_id: str,
    revision_id: str,
    code: str,
    title: str,
    document_type: str,
    department: str,
    source_filename: str,
    file_path: str,
    page_count: int,
    classification: str,
    version_number: int,
    revision_label: str,
):
    conn.execute(
        text(
            """
            UPDATE document_revisions
            SET
                is_latest_approved = false,
                effective_to = COALESCE(effective_to, NOW()),
                updated_at = NOW()
            WHERE document_id = CAST(:document_id AS uuid)
              AND is_latest_approved = true
            """
        ),
        {"document_id": document_id},
    )

    existing_document = conn.execute(
        text("SELECT 1 FROM documents WHERE id = CAST(:document_id AS uuid)"),
        {"document_id": document_id},
    ).scalar()

    if existing_document:
        conn.execute(
            text(
                """
                UPDATE documents
                SET
                    code = :code,
                    title = :title,
                    document_type = :document_type,
                    department_name = :department_name,
                    source_filename = :source_filename,
                    is_active = true,
                    updated_at = NOW()
                WHERE id = CAST(:document_id AS uuid)
                """
            ),
            {
                "document_id": document_id,
                "code": code,
                "title": title,
                "document_type": document_type,
                "department_name": department,
                "source_filename": source_filename,
            },
        )
    else:
        conn.execute(
            text(
                """
                INSERT INTO documents (
                    id, code, title, document_type, department_name, source_filename,
                    is_active, created_at, updated_at
                )
                VALUES (
                    CAST(:id AS uuid), :code, :title, :document_type, :department_name,
                    :source_filename, true, NOW(), NOW()
                )
                """
            ),
            {
                "id": document_id,
                "code": code,
                "title": title,
                "document_type": document_type,
                "department_name": department,
                "source_filename": source_filename,
            },
        )

    conn.execute(
        text(
            """
            INSERT INTO document_revisions (
                id, document_id, revision_label, version_number,
                effective_from, approval_status, is_latest_approved,
                file_path, page_count, extraction_classification, extraction_status,
                created_at, updated_at
            )
            VALUES (
                CAST(:id AS uuid), CAST(:document_id AS uuid), :revision_label, :version_number,
                NOW(), 'approved', true, :file_path, :page_count, :classification, 'completed',
                NOW(), NOW()
            )
            """
        ),
        {
            "id": revision_id,
            "document_id": document_id,
            "revision_label": revision_label,
            "version_number": version_number,
            "file_path": file_path,
            "page_count": page_count,
            "classification": classification,
        },
    )


def _load_page_blocks(conn, page_id: str) -> list[dict[str, Any]]:
    return [
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
            {"page_id": page_id},
        ).mappings()
    ]


def _get_app_settings(conn) -> dict[str, Any]:
    defaults = {
        "organization_name": "Jubilant Ingrevia",
        "primary_email": "admin@jubilantingrevia.com",
        "default_language": "en",
        "assessment_passing_score": 70,
        "certification_validity_days": 365,
        "reminder_frequency": "weekly",
        "notifications": {
            "emailAlerts": True,
            "trainingReminders": True,
            "certExpiry": True,
            "systemUpdates": False,
        },
    }
    rows = conn.execute(
        text("SELECT setting_key, setting_value FROM app_settings")
    ).mappings()
    settings_payload = dict(defaults)
    for row in rows:
        settings_payload[row["setting_key"]] = row["setting_value"]
    return settings_payload


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


def _normalize_chat_language(language: str | None) -> str:
    normalized = (language or "en").strip().lower()
    if normalized.startswith("hing"):
        return "hing"
    if normalized.startswith("hi"):
        return "hi"
    return "en"


def _normalize_chat_scope(scope: str | None) -> str:
    normalized = (scope or "general").strip().lower()
    if normalized in {"reader", "doc_reader", "reading"}:
        return "reader"
    if normalized in {"guided", "guide", "operation", "operations", "run_guide"}:
        return "guided"
    return "general"


def _conversation_title_from_query(query: str) -> str:
    cleaned = " ".join((query or "").strip().split())
    if not cleaned:
        return "New conversation"
    if len(cleaned) <= 72:
        return cleaned
    return f"{cleaned[:69].rstrip()}..."


def _chat_storage_tables(chat_scope: str) -> tuple[str, str]:
    normalized_scope = _normalize_chat_scope(chat_scope)
    if normalized_scope == "reader":
        return "chat_reader_conversations", "chat_reader_messages"
    if normalized_scope == "guided":
        return "chat_guided_conversations", "chat_guided_messages"
    return "chat_conversations", "chat_messages"


def _legacy_general_scope_filter(chat_scope: str) -> str:
    if _normalize_chat_scope(chat_scope) == "general":
        # Prevent legacy scoped rows from showing up in general chat lists/lookups.
        return "AND COALESCE(c.metadata->>'scope', 'general') NOT IN ('reader', 'guided')"
    return ""


def _serialize_chat_conversation(
    row: dict[str, Any],
    *,
    chat_scope: str = "general",
) -> dict[str, Any]:
    payload = dict(row)
    payload["chat_scope"] = _normalize_chat_scope(payload.get("chat_scope") or chat_scope)
    if payload.get("revision_id") == "":
        payload["revision_id"] = None
    payload["created_at"] = _iso(payload.get("created_at"))
    payload["updated_at"] = _iso(payload.get("updated_at"))
    payload["last_message_at"] = _iso(payload.get("last_message_at"))
    payload["message_count"] = int(payload.get("message_count") or 0)
    return payload


def _list_chat_conversations(
    conn,
    user_id: str,
    limit: int = 12,
    scope: str | None = None,
) -> list[dict[str, Any]]:
    normalized_scope = _normalize_chat_scope(scope)
    conversation_table, message_table = _chat_storage_tables(normalized_scope)
    legacy_filter = _legacy_general_scope_filter(normalized_scope)
    rows = conn.execute(
        text(
            f"""
            SELECT
                c.id::text AS id,
                c.user_id::text AS user_id,
                c.title,
                c.language,
                c.status,
                :chat_scope AS chat_scope,
                c.metadata->>'revision_id' AS revision_id,
                c.created_at,
                c.updated_at,
                c.last_message_at,
                COALESCE(msg_count.message_count, 0) AS message_count,
                preview.content AS preview
            FROM {conversation_table} c
            LEFT JOIN LATERAL (
                SELECT count(*)::int AS message_count
                FROM {message_table} m
                WHERE m.conversation_id = c.id
            ) msg_count ON true
            LEFT JOIN LATERAL (
                SELECT m.content
                FROM {message_table} m
                WHERE m.conversation_id = c.id
                ORDER BY m.message_order DESC
                LIMIT 1
            ) preview ON true
            WHERE c.user_id = CAST(:user_id AS uuid)
              AND c.status <> 'archived'
              {legacy_filter}
            ORDER BY c.last_message_at DESC, c.created_at DESC
            LIMIT :limit
            """
        ),
        {"user_id": user_id, "limit": limit, "chat_scope": normalized_scope},
    ).mappings()
    return [
        _serialize_chat_conversation(dict(row), chat_scope=normalized_scope)
        for row in rows
    ]


def _get_chat_conversation(
    conn,
    conversation_id: str,
    user_id: str,
    *,
    chat_scope: str = "general",
) -> dict[str, Any]:
    normalized_scope = _normalize_chat_scope(chat_scope)
    conversation_table, message_table = _chat_storage_tables(normalized_scope)
    legacy_filter = _legacy_general_scope_filter(normalized_scope)
    row = conn.execute(
        text(
            f"""
            SELECT
                c.id::text AS id,
                c.user_id::text AS user_id,
                c.title,
                c.language,
                c.status,
                :chat_scope AS chat_scope,
                c.metadata->>'revision_id' AS revision_id,
                c.created_at,
                c.updated_at,
                c.last_message_at,
                COALESCE(msg_count.message_count, 0) AS message_count,
                preview.content AS preview
            FROM {conversation_table} c
            LEFT JOIN LATERAL (
                SELECT count(*)::int AS message_count
                FROM {message_table} m
                WHERE m.conversation_id = c.id
            ) msg_count ON true
            LEFT JOIN LATERAL (
                SELECT m.content
                FROM {message_table} m
                WHERE m.conversation_id = c.id
                ORDER BY m.message_order DESC
                LIMIT 1
            ) preview ON true
            WHERE c.id = CAST(:conversation_id AS uuid)
              AND c.user_id = CAST(:user_id AS uuid)
              {legacy_filter}
            """
        ),
        {
            "conversation_id": conversation_id,
            "user_id": user_id,
            "chat_scope": normalized_scope,
        },
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return _serialize_chat_conversation(dict(row), chat_scope=normalized_scope)


def _detect_chat_scope_for_conversation(
    conn,
    conversation_id: str,
    user_id: str,
) -> str | None:
    guided_row = conn.execute(
        text(
            """
            SELECT 1
            FROM chat_guided_conversations c
            WHERE c.id = CAST(:conversation_id AS uuid)
              AND c.user_id = CAST(:user_id AS uuid)
            """
        ),
        {"conversation_id": conversation_id, "user_id": user_id},
    ).first()
    if guided_row:
        return "guided"

    reader_row = conn.execute(
        text(
            """
            SELECT 1
            FROM chat_reader_conversations c
            WHERE c.id = CAST(:conversation_id AS uuid)
              AND c.user_id = CAST(:user_id AS uuid)
            """
        ),
        {"conversation_id": conversation_id, "user_id": user_id},
    ).first()
    if reader_row:
        return "reader"

    general_row = conn.execute(
        text(
            """
            SELECT 1
            FROM chat_conversations c
            WHERE c.id = CAST(:conversation_id AS uuid)
              AND c.user_id = CAST(:user_id AS uuid)
              AND COALESCE(c.metadata->>'scope', 'general') NOT IN ('reader', 'guided')
            """
        ),
        {"conversation_id": conversation_id, "user_id": user_id},
    ).first()
    if general_row:
        return "general"

    legacy_reader_row = conn.execute(
        text(
            """
            SELECT 1
            FROM chat_conversations c
            WHERE c.id = CAST(:conversation_id AS uuid)
              AND c.user_id = CAST(:user_id AS uuid)
              AND COALESCE(c.metadata->>'scope', 'general') = 'reader'
            """
        ),
        {"conversation_id": conversation_id, "user_id": user_id},
    ).first()
    if legacy_reader_row:
        return "reader"

    legacy_guided_row = conn.execute(
        text(
            """
            SELECT 1
            FROM chat_conversations c
            WHERE c.id = CAST(:conversation_id AS uuid)
              AND c.user_id = CAST(:user_id AS uuid)
              AND COALESCE(c.metadata->>'scope', 'general') = 'guided'
            """
        ),
        {"conversation_id": conversation_id, "user_id": user_id},
    ).first()
    if legacy_guided_row:
        return "guided"
    return None


def _get_chat_messages(
    conn,
    conversation_id: str,
    *,
    chat_scope: str = "general",
) -> list[dict[str, Any]]:
    normalized_scope = _normalize_chat_scope(chat_scope)
    _, message_table = _chat_storage_tables(normalized_scope)
    rows = conn.execute(
        text(
            f"""
            SELECT
                id::text AS id,
                role,
                content,
                language,
                citations,
                query_text,
                retrieval_event_id::text AS retrieval_event_id,
                response_mode,
                created_at
            FROM {message_table}
            WHERE conversation_id = CAST(:conversation_id AS uuid)
            ORDER BY message_order ASC, created_at ASC
            """
        ),
        {"conversation_id": conversation_id},
    ).mappings()
    messages: list[dict[str, Any]] = []
    for row in rows:
        payload = dict(row)
        payload["created_at"] = _iso(payload.get("created_at"))
        payload["citations"] = payload.get("citations") or []
        messages.append(payload)
    return messages


def _create_chat_conversation(
    conn,
    *,
    user_id: str,
    language: str,
    title: str | None = None,
    chat_scope: str = "general",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_scope = _normalize_chat_scope(chat_scope)
    normalized_language = _normalize_chat_language(language)
    conversation_table, _ = _chat_storage_tables(normalized_scope)
    metadata_payload = dict(metadata or {})
    metadata_payload["scope"] = normalized_scope
    safe_title = (title or "").strip() or "New conversation"
    row = conn.execute(
        text(
            f"""
            INSERT INTO {conversation_table} (
                user_id,
                title,
                language,
                metadata
            )
            VALUES (
                CAST(:user_id AS uuid),
                :title,
                :language,
                CAST(:metadata AS jsonb)
            )
            RETURNING
                id::text AS id,
                user_id::text AS user_id,
                title,
                language,
                status,
                metadata->>'revision_id' AS revision_id,
                created_at,
                updated_at,
                last_message_at
            """
        ),
        {
            "user_id": user_id,
            "title": safe_title,
            "language": normalized_language,
            "metadata": json.dumps(metadata_payload),
        },
    ).mappings().one()
    payload = _serialize_chat_conversation(dict(row), chat_scope=normalized_scope)
    payload["message_count"] = 0
    payload["preview"] = None
    return payload


def _append_chat_message(
    conn,
    *,
    conversation_id: str,
    role: str,
    content: str,
    language: str | None = None,
    citations: list[dict[str, Any]] | None = None,
    query_text: str | None = None,
    retrieval_event_id: str | None = None,
    response_mode: str = "text",
    chat_scope: str = "general",
) -> dict[str, Any]:
    normalized_scope = _normalize_chat_scope(chat_scope)
    conversation_table, message_table = _chat_storage_tables(normalized_scope)
    next_order = int(
        conn.execute(
            text(
                f"""
                SELECT COALESCE(MAX(message_order), 0) + 1
                FROM {message_table}
                WHERE conversation_id = CAST(:conversation_id AS uuid)
                """
            ),
            {"conversation_id": conversation_id},
        ).scalar_one()
    )
    row = conn.execute(
        text(
            f"""
            INSERT INTO {message_table} (
                conversation_id,
                message_order,
                role,
                content,
                language,
                citations,
                query_text,
                retrieval_event_id,
                response_mode
            )
            VALUES (
                CAST(:conversation_id AS uuid),
                :message_order,
                :role,
                :content,
                :language,
                CAST(:citations AS jsonb),
                :query_text,
                CAST(:retrieval_event_id AS uuid),
                :response_mode
            )
            RETURNING
                id::text AS id,
                role,
                content,
                language,
                citations,
                query_text,
                retrieval_event_id::text AS retrieval_event_id,
                response_mode,
                created_at
            """
        ),
        {
            "conversation_id": conversation_id,
            "message_order": next_order,
            "role": role,
            "content": content,
            "language": _normalize_chat_language(language),
            "citations": json.dumps(citations or []),
            "query_text": query_text,
            "retrieval_event_id": retrieval_event_id,
            "response_mode": response_mode,
        },
    ).mappings().one()
    conn.execute(
        text(
            f"""
            UPDATE {conversation_table}
            SET
                updated_at = now(),
                last_message_at = now()
            WHERE id = CAST(:conversation_id AS uuid)
            """
        ),
        {"conversation_id": conversation_id},
    )
    payload = dict(row)
    payload["created_at"] = _iso(payload.get("created_at"))
    payload["citations"] = payload.get("citations") or []
    return payload


def _get_conversation_metadata(
    conn,
    conversation_id: str,
    user_id: str,
    *,
    chat_scope: str,
) -> dict[str, Any]:
    normalized_scope = _normalize_chat_scope(chat_scope)
    conversation_table, _ = _chat_storage_tables(normalized_scope)
    row = conn.execute(
        text(
            f"""
            SELECT metadata
            FROM {conversation_table}
            WHERE id = CAST(:conversation_id AS uuid)
              AND user_id = CAST(:user_id AS uuid)
            """
        ),
        {"conversation_id": conversation_id, "user_id": user_id},
    ).mappings().first()
    if not row:
        return {}
    metadata = row.get("metadata") or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except Exception:
            metadata = {}
    return metadata if isinstance(metadata, dict) else {}


def _merge_conversation_metadata(
    conn,
    conversation_id: str,
    metadata_patch: dict[str, Any],
    *,
    chat_scope: str,
) -> None:
    normalized_scope = _normalize_chat_scope(chat_scope)
    conversation_table, _ = _chat_storage_tables(normalized_scope)
    conn.execute(
        text(
            f"""
            UPDATE {conversation_table}
            SET
                metadata = COALESCE(metadata, '{{}}'::jsonb) || CAST(:metadata_patch AS jsonb),
                updated_at = now()
            WHERE id = CAST(:conversation_id AS uuid)
            """
        ),
        {
            "conversation_id": conversation_id,
            "metadata_patch": json.dumps(metadata_patch),
        },
    )


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _compact_text(value: Any, *, max_chars: int = 96) -> str:
    text_value = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text_value) <= max_chars:
        return text_value
    return text_value[: max_chars - 3].rstrip() + "..."


def _unique_list(values: list[Any], *, max_items: int = 12) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        item = _compact_text(value, max_chars=80)
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(item)
        if len(output) >= max_items:
            break
    return output


def _record_worker_activity(
    conn,
    *,
    user_id: str | None,
    event_type: str,
    title: str,
    details: dict[str, Any] | None = None,
    severity: str = "info",
    event_source: str = "system",
) -> str | None:
    if not user_id:
        return None
    return conn.execute(
        text(
            """
            INSERT INTO worker_activity_events (
                user_id,
                event_type,
                event_source,
                severity,
                title,
                details
            )
            VALUES (
                CAST(:user_id AS uuid),
                :event_type,
                :event_source,
                :severity,
                :title,
                CAST(:details AS jsonb)
            )
            RETURNING id::text
            """
        ),
        {
            "user_id": user_id,
            "event_type": event_type,
            "event_source": event_source,
            "severity": severity,
            "title": _compact_text(title, max_chars=140) or "Worker activity",
            "details": _json_dumps(details or {}),
        },
    ).scalar()


def _upsert_worker_memory(
    conn,
    *,
    user_id: str | None,
    language: str | None = None,
    equipment: str | None = None,
    sop_code: str | None = None,
    skill_tags: list[Any] | None = None,
    risk_flags: list[Any] | None = None,
) -> None:
    if not user_id:
        return
    tags = _unique_list(skill_tags or [])
    risks = _unique_list(risk_flags or [])
    conn.execute(
        text(
            """
            INSERT INTO worker_memory_profiles (
                user_id,
                preferred_language,
                skill_tags,
                risk_flags,
                last_equipment,
                last_sop_code,
                interaction_count,
                last_interaction_at,
                updated_at
            )
            VALUES (
                CAST(:user_id AS uuid),
                :preferred_language,
                CAST(:skill_tags AS jsonb),
                CAST(:risk_flags AS jsonb),
                :last_equipment,
                :last_sop_code,
                1,
                now(),
                now()
            )
            ON CONFLICT (user_id) DO UPDATE
            SET
                preferred_language = COALESCE(EXCLUDED.preferred_language, worker_memory_profiles.preferred_language),
                skill_tags = (
                    SELECT COALESCE(jsonb_agg(DISTINCT tag), '[]'::jsonb)
                    FROM jsonb_array_elements_text(worker_memory_profiles.skill_tags || EXCLUDED.skill_tags) AS tag
                ),
                risk_flags = (
                    SELECT COALESCE(jsonb_agg(DISTINCT flag), '[]'::jsonb)
                    FROM jsonb_array_elements_text(worker_memory_profiles.risk_flags || EXCLUDED.risk_flags) AS flag
                ),
                last_equipment = COALESCE(EXCLUDED.last_equipment, worker_memory_profiles.last_equipment),
                last_sop_code = COALESCE(EXCLUDED.last_sop_code, worker_memory_profiles.last_sop_code),
                interaction_count = worker_memory_profiles.interaction_count + 1,
                last_interaction_at = now(),
                updated_at = now()
            """
        ),
        {
            "user_id": user_id,
            "preferred_language": language,
            "skill_tags": _json_dumps(tags),
            "risk_flags": _json_dumps(risks),
            "last_equipment": _compact_text(equipment, max_chars=120) or None,
            "last_sop_code": _compact_text(sop_code, max_chars=80) or None,
        },
    )


def _extract_run_source(evidence: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    for item in evidence:
        sop_code = _compact_text(item.get("document_code"), max_chars=80) or None
        revision_id = _compact_text(item.get("revision_id"), max_chars=80) or None
        if sop_code or revision_id:
            return sop_code, revision_id
    return None, None


def _upsert_operation_run_record(
    conn,
    *,
    user_id: str | None,
    conversation_id: str | None,
    state: dict[str, Any],
    evidence: list[dict[str, Any]],
) -> str | None:
    if not user_id or not conversation_id:
        return None
    phase = str(state.get("phase") or "task_selection")
    sop_code, revision_id = _extract_run_source(evidence)
    status = "active"
    completed_at = None
    if phase == "completed":
        status = "completed"
        completed_at = datetime.now(timezone.utc)
    elif phase == "supervisor_handoff":
        status = "handoff"
    elif phase == "blocked":
        status = "blocked"

    existing_id = conn.execute(
        text(
            """
            SELECT id::text
            FROM operation_run_records
            WHERE user_id = CAST(:user_id AS uuid)
              AND conversation_id = CAST(:conversation_id AS uuid)
            ORDER BY started_at DESC
            LIMIT 1
            """
        ),
        {"user_id": user_id, "conversation_id": conversation_id},
    ).scalar()

    payload = {
        "user_id": user_id,
        "conversation_id": conversation_id,
        "equipment": _compact_text(state.get("equipment"), max_chars=120) or None,
        "task": _compact_text(state.get("task"), max_chars=160) or None,
        "sop_code": sop_code,
        "sop_revision_id": revision_id,
        "current_phase": phase,
        "current_step": int(state.get("step_index") or 0),
        "prerequisites": _json_dumps(state.get("prerequisites") or {}),
        "stop_conditions": _json_dumps(state.get("stop_conditions") or []),
        "status": status,
        "completed_at": completed_at,
        "completion_record_id": state.get("completion_record_id"),
        "metadata": _json_dumps({"state": state, "evidence_count": len(evidence)}),
    }

    if existing_id:
        conn.execute(
            text(
                """
                UPDATE operation_run_records
                SET
                    equipment = COALESCE(:equipment, equipment),
                    task = COALESCE(:task, task),
                    sop_code = COALESCE(:sop_code, sop_code),
                    sop_revision_id = COALESCE(CAST(:sop_revision_id AS uuid), sop_revision_id),
                    current_phase = :current_phase,
                    current_step = :current_step,
                    prerequisites = CAST(:prerequisites AS jsonb),
                    stop_conditions = CAST(:stop_conditions AS jsonb),
                    status = :status,
                    completed_at = COALESCE(:completed_at, completed_at),
                    completion_record_id = COALESCE(:completion_record_id, completion_record_id),
                    metadata = CAST(:metadata AS jsonb)
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {**payload, "id": existing_id},
        )
        return existing_id

    return conn.execute(
        text(
            """
            INSERT INTO operation_run_records (
                user_id,
                conversation_id,
                equipment,
                task,
                sop_code,
                sop_revision_id,
                current_phase,
                current_step,
                prerequisites,
                stop_conditions,
                status,
                completed_at,
                completion_record_id,
                metadata
            )
            VALUES (
                CAST(:user_id AS uuid),
                CAST(:conversation_id AS uuid),
                :equipment,
                :task,
                :sop_code,
                CAST(:sop_revision_id AS uuid),
                :current_phase,
                :current_step,
                CAST(:prerequisites AS jsonb),
                CAST(:stop_conditions AS jsonb),
                :status,
                :completed_at,
                :completion_record_id,
                CAST(:metadata AS jsonb)
            )
            RETURNING id::text
            """
        ),
        payload,
    ).scalar()


def _create_supervisor_handoff(
    conn,
    *,
    user_id: str | None,
    conversation_id: str | None,
    run_record_id: str | None,
    state: dict[str, Any],
    reason: str,
) -> str | None:
    if not user_id:
        return None
    if conversation_id:
        existing_id = conn.execute(
            text(
                """
                SELECT id::text
                FROM supervisor_handoffs
                WHERE user_id = CAST(:user_id AS uuid)
                  AND conversation_id = CAST(:conversation_id AS uuid)
                  AND status = 'open'
                ORDER BY created_at DESC
                LIMIT 1
                """
            ),
            {"user_id": user_id, "conversation_id": conversation_id},
        ).scalar()
        if existing_id:
            return existing_id

    handoff_id = conn.execute(
        text(
            """
            INSERT INTO supervisor_handoffs (
                user_id,
                conversation_id,
                run_record_id,
                equipment,
                task,
                reason,
                severity,
                status,
                metadata
            )
            VALUES (
                CAST(:user_id AS uuid),
                CAST(:conversation_id AS uuid),
                CAST(:run_record_id AS uuid),
                :equipment,
                :task,
                :reason,
                :severity,
                'open',
                CAST(:metadata AS jsonb)
            )
            RETURNING id::text
            """
        ),
        {
            "user_id": user_id,
            "conversation_id": conversation_id,
            "run_record_id": run_record_id,
            "equipment": _compact_text(state.get("equipment"), max_chars=120) or None,
            "task": _compact_text(state.get("task"), max_chars=160) or None,
            "reason": _compact_text(reason, max_chars=260) or "Supervisor help requested",
            "severity": "high" if state.get("phase") == "blocked" else "medium",
            "metadata": _json_dumps({"state": state}),
        },
    ).scalar()

    targets = [
        row["id"]
        for row in conn.execute(
            text(
                """
                SELECT id::text AS id
                FROM users
                WHERE role IN ('admin', 'supervisor')
                ORDER BY role, full_name
                LIMIT 20
                """
            )
        ).mappings()
    ]
    equipment = state.get("equipment") or "equipment"
    task = state.get("task") or "run guide"
    for target_user_id in targets:
        _queue_notification(
            conn,
            user_id=target_user_id,
            event_type="supervisor_handoff",
            severity="medium",
            title="Supervisor help requested",
            message=f"Operator needs help for {_compact_text(equipment)} / {_compact_text(task)}.",
            cta_url=f"/admin/analytics?focus=handoffs&handoff_id={handoff_id}",
            event_key=f"supervisor_handoff:{handoff_id}:{target_user_id}",
        )
    return handoff_id


def _history_from_messages(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    history: list[dict[str, str]] = []
    for item in messages[-8:]:
        content = (item.get("content") or "").strip()
        role = (item.get("role") or "").strip()
        if content and role in {"user", "assistant"}:
            history.append({"role": role, "content": content})
    return history


def _is_summary_style_query(query: str) -> bool:
    lowered = (query or "").strip().lower()
    if not lowered:
        return False
    summary_markers = (
        "summarize",
        "summarise",
        "summary",
        "summariz",
        "sumariz",
        "overview",
        "gist",
        "key points",
        "points",
        "whole",
        "entire",
    )
    return any(marker in lowered for marker in summary_markers)


def _requested_summary_points(query: str, default: int = 10) -> int:
    lowered = (query or "").strip().lower()
    match = re.search(r"\b(\d{1,2})\s*points?\b", lowered)
    if not match:
        return default
    try:
        value = int(match.group(1))
    except Exception:
        return default
    return max(3, min(value, 15))


def _is_non_document_workspace_query(query: str) -> bool:
    lowered = (query or "").strip().lower()
    return bool(
        re.search(
            r"\b(training|module|quiz|assessment|score|rating|rank|badge|xp|level|certificate|certification|streak|progress|performance)\b",
            lowered,
        )
    )


def _is_document_lookup_query(query: str) -> bool:
    lowered = (query or "").strip().lower()
    return bool(
        re.search(
            r"\b(sop|manual|document|doc|page|revision|rev|section|procedure|instruction|source|pdf|safety|chemical|ppe|permit|machine)\b",
            lowered,
        )
        or re.search(r"\b\d+(st|nd|rd|th)?\s+(page|sop|manual|document|doc)\b", lowered)
    )


def _document_options_from_evidence(evidence: list[dict[str, Any]]) -> list[dict[str, str]]:
    options: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in evidence:
        code = str(item.get("document_code") or "").strip()
        title = str(item.get("document_title") or "").strip()
        revision_id = str(item.get("revision_id") or "").strip()
        key = code or title or revision_id
        if not key or key in seen:
            continue
        seen.add(key)
        options.append(
            {
                "code": code or "Document",
                "title": title or code or "Untitled document",
                "page": str(item.get("page_start") or ""),
            }
        )
        if len(options) >= 5:
            break
    return options


def _build_document_clarification_answer(
    query: str,
    evidence: list[dict[str, Any]],
    language: str,
    chat_scope: str,
) -> str | None:
    if chat_scope != "general":
        return None
    if _is_non_document_workspace_query(query) or not _is_document_lookup_query(query):
        return None

    options = _document_options_from_evidence(evidence)
    if len(options) <= 1:
        return None

    lowered = query.lower()
    if any(option["code"].lower() and option["code"].lower() in lowered for option in options):
        return None

    if (language or "").lower().startswith("hi"):
        lines = [
            "मुझे यह स्पष्ट नहीं है कि आप कौन सा SOP खोलना चाहते हैं। कृपया इनमें से एक चुनें:",
        ]
        lines.extend(
            f"{index}. {option['code']} - {option['title']}"
            for index, option in enumerate(options, start=1)
        )
        return "\n".join(lines)

    lines = [
        "I found more than one matching SOP. Which one do you mean?",
    ]
    lines.extend(
        f"{index}. {option['code']} - {option['title']}"
        for index, option in enumerate(options, start=1)
    )
    return "\n".join(lines)


def _is_low_signal_segment(segment: str) -> bool:
    lowered = (segment or "").lower()
    if not lowered:
        return True
    noise_markers = (
        "effective date",
        "approved by",
        "procedure #",
        "issue :",
        "revision :",
        "page ",
        "table of contents",
        "property of",
        "managing director",
    )
    if any(marker in lowered for marker in noise_markers):
        meaningful_markers = (
            "shall",
            "must",
            "required",
            "responsible",
            "important",
            "prohibited",
            "ensure",
            "before",
            "after",
        )
        return not any(marker in lowered for marker in meaningful_markers)
    return False


def _extractive_summary_from_evidence(
    evidence: list[dict[str, Any]],
    *,
    points: int = 10,
) -> str:
    if not evidence:
        return "Not found in approved documents."

    collected: list[str] = []
    seen: set[str] = set()

    for item in evidence[:12]:
        citation = item.get("citation_label") or (
            f"{item.get('document_code', 'doc')} p.{item.get('page_start', '?')}"
        )
        content = (item.get("content") or "").strip()
        if not content:
            continue
        segments = re.split(r"[\n\r]+|(?<=[.!?])\s+", content)
        for segment in segments:
            cleaned = re.sub(r"\s+", " ", segment).strip(" -\t")
            if len(cleaned) < 35:
                continue
            if _is_low_signal_segment(cleaned):
                continue
            key = cleaned.lower()
            if key in seen:
                continue
            seen.add(key)
            collected.append(f"{cleaned} [{citation}]")
            if len(collected) >= points:
                break
        if len(collected) >= points:
            break

    if not collected:
        top = evidence[0]
        citation = top.get("citation_label") or (
            f"{top.get('document_code', 'doc')} p.{top.get('page_start', '?')}"
        )
        snippet = re.sub(r"\s+", " ", (top.get("content") or "").strip())
        if not snippet:
            return "Not found in approved documents."
        return f"1. {snippet[:280]} [{citation}]"

    return "\n".join(f"{idx}. {line}" for idx, line in enumerate(collected, start=1))


def _extractive_answer_from_evidence(
    query: str,
    evidence: list[dict[str, Any]],
    *,
    max_sentences: int = 3,
) -> str:
    if not evidence:
        return "Not found in approved documents."

    if _is_summary_style_query(query):
        return _extractive_summary_from_evidence(
            evidence,
            points=min(_requested_summary_points(query, default=6), 8),
        )

    collected: list[str] = []
    seen: set[str] = set()

    for item in evidence[:4]:
        citation = item.get("citation_label") or (
            f"{item.get('document_code', 'doc')} p.{item.get('page_start', '?')}"
        )
        content = (item.get("content") or "").strip()
        if not content:
            continue
        segments = re.split(r"[\n\r]+|(?<=[.!?])\s+", content)
        for segment in segments:
            cleaned = re.sub(r"\s+", " ", segment).strip(" -\t")
            if len(cleaned) < 28:
                continue
            if cleaned.lower().startswith("page "):
                continue
            if _is_low_signal_segment(cleaned):
                continue
            key = cleaned.lower()
            if key in seen:
                continue
            seen.add(key)
            collected.append(f"{cleaned} [{citation}]")
            if len(collected) >= max_sentences:
                break
        if len(collected) >= max_sentences:
            break

    if not collected:
        top = evidence[0]
        citation = top.get("citation_label") or (
            f"{top.get('document_code', 'doc')} p.{top.get('page_start', '?')}"
        )
        snippet = re.sub(r"\s+", " ", (top.get("content") or "").strip())
        if not snippet:
            return "Not found in approved documents."
        return f"{snippet[:280].rstrip()} [{citation}]"

    return " ".join(collected)


def _should_prefer_extractive_answer(query: str, evidence: list[dict[str, Any]]) -> bool:
    if not evidence:
        return True
    lowered = (query or "").strip().lower()
    if _is_summary_style_query(lowered):
        return True
    if re.search(r"\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|\d+)\s+page\b", lowered):
        return True
    extractive_markers = (
        "most important point",
        "main point",
        "key point",
        "what is the point",
        "tell me the point",
    )
    return any(marker in lowered for marker in extractive_markers)


TRAINING_NOISE_MARKERS = (
    "effective date",
    "procedure #",
    "approved by",
    "table of contents",
    "issue :",
    "revision :",
    "property of",
    "page 1 of",
    "page 2 of",
)

TRAINING_ACTION_MARKERS = (
    "shall",
    "must",
    "ensure",
    "before",
    "after",
    "wear",
    "check",
    "use",
    "keep",
    "confirm",
    "do not",
    "never",
)


def _training_text_quality_score(text: str | None) -> int:
    normalized = re.sub(r"\s+", " ", (text or "")).strip()
    if len(normalized) < 40:
        return -10
    lowered = normalized.lower()
    score = 0
    score += sum(3 for marker in TRAINING_ACTION_MARKERS if marker in lowered)
    score -= sum(5 for marker in TRAINING_NOISE_MARKERS if marker in lowered)
    if re.search(r"[.!?;]", normalized):
        score += 2
    if len(normalized.split()) > 12:
        score += 1
    return score


def _training_step_is_low_quality(step: dict[str, Any]) -> bool:
    instruction = re.sub(r"\s+", " ", (step.get("instruction") or "")).strip()
    roman_enumerations = len(
        re.findall(r"\b(?:I|II|III|IV|V|VI|VII|VIII|IX|X)\.", instruction)
    )
    if re.match(r"^page\s+\d+\s+of\s+\d+", instruction.lower()) and roman_enumerations >= 3:
        return True
    if "table of contents" in instruction.lower():
        return True
    instruction_score = _training_text_quality_score(step.get("instruction"))
    check_score = _training_text_quality_score(step.get("operator_check"))
    return max(instruction_score, check_score) <= 0


def _load_revision_training_chunks(conn, revision_id: str) -> list[dict[str, Any]]:
    return [
        dict(row)
        for row in conn.execute(
            text(
                """
                SELECT
                    dc.id::text AS id,
                    dc.id::text AS source_chunk_id,
                    dc.chunk_index,
                    dc.chunk_type,
                    dc.page_start,
                    dc.page_end,
                    dc.section_title,
                    dc.citation_label,
                    dc.content
                FROM document_chunks dc
                WHERE dc.revision_id = CAST(:revision_id AS uuid)
                ORDER BY dc.page_start ASC NULLS LAST, dc.chunk_index ASC
                """
            ),
            {"revision_id": revision_id},
        ).mappings()
    ]


def _regenerate_training_preview(
    conn,
    module_payload: dict[str, Any],
    steps: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    if not steps:
        return None
    low_quality_count = sum(1 for step in steps if _training_step_is_low_quality(step))
    first_visible_steps = steps[:3]
    first_visible_low_quality = sum(
        1 for step in first_visible_steps if _training_step_is_low_quality(step)
    )
    if low_quality_count < 2 and first_visible_low_quality < 1:
        return None

    revision_id = module_payload.get("source_revision_id")
    if not revision_id:
        return None

    chunks = _load_revision_training_chunks(conn, revision_id)
    if not chunks:
        return None

    regenerated_assets = generate_learning_assets(
        document_code=module_payload.get("document_code") or "Document",
        document_title=module_payload.get("document_title") or module_payload.get("title") or "Training Module",
        document_type=module_payload.get("module_type") or "sop_document",
        chunks=chunks,
    )
    regenerated_steps = regenerated_assets.get("steps") or []
    if not regenerated_steps:
        return None

    next_module = dict(module_payload)
    regenerated_module = regenerated_assets.get("module") or {}
    if regenerated_module.get("description"):
        next_module["description"] = regenerated_module["description"]
    if regenerated_module.get("criticality"):
        next_module["criticality"] = regenerated_module["criticality"]
    next_module["total_steps"] = len(regenerated_steps)
    return next_module, regenerated_steps


def _is_contextual_follow_up(query: str) -> bool:
    lowered = (query or "").strip().lower()
    if not lowered:
        return False

    markers = (
        "what about",
        "how about",
        "for this",
        "for that",
        "same thing",
        "next step",
        "that step",
        "this step",
        "continue",
        "again",
    )
    if any(marker in lowered for marker in markers):
        return True

    words = lowered.split()
    if len(words) <= 4:
        short_followup_tokens = {"it", "this", "that", "same", "then", "next"}
        if any(token in words for token in short_followup_tokens):
            return True

    pronoun_pattern = r"\b(it|this|that|those|these|same|above|earlier)\b"
    return bool(re.search(pronoun_pattern, lowered))


def _build_contextual_query(query: str, history: list[dict[str, str]] | None) -> str:
    normalized_query = re.sub(r"\s+", " ", (query or "")).strip()
    if not normalized_query or not history or not _is_contextual_follow_up(normalized_query):
        return normalized_query

    last_user_question = next(
        (
            (item.get("content") or "").strip()
            for item in reversed(history)
            if item.get("role") == "user" and (item.get("content") or "").strip()
        ),
        "",
    )
    if not last_user_question:
        return normalized_query

    return (
        f"Previous question: {last_user_question}\n"
        f"Follow-up question: {normalized_query}"
    )


def _should_use_query_rewrite(
    query: str,
    history: list[dict[str, str]] | None,
    *,
    chat_scope: str,
) -> bool:
    if not history:
        return False
    normalized_query = re.sub(r"\s+", " ", (query or "")).strip()
    if not normalized_query:
        return False
    return _is_contextual_follow_up(normalized_query)


def _should_use_dspy_answer(
    query: str,
    *,
    chat_scope: str,
    history: list[dict[str, str]] | None = None,
) -> bool:
    lowered = (query or "").strip().lower()
    if history and _is_contextual_follow_up(lowered):
        return True
    complex_markers = (
        "compare",
        "difference",
        "why",
        "root cause",
        "step by step",
        "all steps",
        "all details",
        "explain in detail",
        "procedure for",
    )
    return any(marker in lowered for marker in complex_markers)


def _primary_chat_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _primary_chat_url() -> str:
    return settings.PRIMARY_LLM_API_BASE.rstrip("/") + "/chat/completions"


def _primary_chat_payload(
    *,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    stream: bool = False,
) -> dict[str, Any]:
    request_payload: dict[str, Any] = {
        "model": settings.PRIMARY_LLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.1,
        "top_p": 1,
        "stream": stream,
    }
    if settings.PRIMARY_LLM_ENABLE_THINKING:
        request_payload["chat_template_kwargs"] = {
            "enable_thinking": True,
            "clear_thinking": True,
        }
    return request_payload


async def _call_primary_chat_model(
    *,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=settings.PRIMARY_LLM_TIMEOUT_SECONDS) as client:
            response = await client.post(
                _primary_chat_url(),
                headers=_primary_chat_headers(settings.PRIMARY_LLM_API_KEY),
                json=_primary_chat_payload(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    max_tokens=max_tokens,
                ),
            )
            response.raise_for_status()
            data = response.json()
        return (data["choices"][0]["message"]["content"] or "").strip() or None
    except Exception:
        return None


async def _stream_primary_chat_model(
    *,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
):
    if not settings.has_primary_llm_credentials:
        return
    payload = _primary_chat_payload(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=max_tokens,
        stream=True,
    )
    async with httpx.AsyncClient(timeout=settings.PRIMARY_LLM_TIMEOUT_SECONDS) as client:
        async with client.stream(
            "POST",
            _primary_chat_url(),
            headers=_primary_chat_headers(settings.PRIMARY_LLM_API_KEY),
            json=payload,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data_text = line[5:].strip()
                if not data_text or data_text == "[DONE]":
                    continue
                try:
                    data = json.loads(data_text)
                    delta = data["choices"][0].get("delta") or {}
                except Exception:
                    continue
                content = delta.get("content")
                if content:
                    yield content


async def _call_groq_chat_fallback(
    *,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
) -> str | None:
    if not settings.GROQ_API_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=GROQ_ANSWER_TIMEOUT_SECONDS) as client:
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
                    "max_tokens": max_tokens,
                    "temperature": 0.1,
                },
            )
            resp.raise_for_status()
            data = resp.json()
        return (data["choices"][0]["message"]["content"] or "").strip() or None
    except Exception:
        return None


def _require_chat_llm_config() -> None:
    if settings.has_primary_llm_credentials or settings.GROQ_API_KEY:
        return
    raise HTTPException(
        status_code=500,
        detail="No primary LLM or Groq fallback is configured.",
    )


def _notify_guardrail_violation(
    conn,
    *,
    user_id: str | None,
    query_text: str,
    decision: GuardrailDecision,
    channel: str,
    conversation_id: str | None = None,
) -> None:
    if not decision.blocked:
        return

    normalized_query = re.sub(r"\s+", " ", (query_text or "")).strip()
    snippet = normalized_query[:240]
    actor_profile = {
        "id": user_id,
        "full_name": None,
        "role": None,
        "department": None,
    }
    if user_id:
        try:
            user = _get_user(conn, user_id)
            actor_profile = {
                "id": user.get("id"),
                "full_name": user.get("full_name"),
                "role": user.get("role"),
                "department": user.get("department"),
            }
        except HTTPException:
            actor_profile["id"] = user_id

    count_clause = "actor_user_id = CAST(:actor_user_id AS uuid)"
    count_params: dict[str, Any] = {"cutoff_24h": datetime.now(timezone.utc) - timedelta(hours=24)}
    if user_id:
        count_params["actor_user_id"] = user_id
    else:
        count_clause = "actor_user_id IS NULL"

    prior_incident_count = int(
        conn.execute(
            text(
                f"""
                SELECT count(*)
                FROM admin_audit_logs
                WHERE action = 'guardrail_blocked_query'
                  AND {count_clause}
                """
            ),
            count_params,
        ).scalar_one()
        or 0
    )
    recent_incident_count_24h = int(
        conn.execute(
            text(
                f"""
                SELECT count(*)
                FROM admin_audit_logs
                WHERE action = 'guardrail_blocked_query'
                  AND {count_clause}
                  AND created_at >= :cutoff_24h
                """
            ),
            count_params,
        ).scalar_one()
        or 0
    )
    incident_count_for_actor = prior_incident_count + 1
    incident_count_last_24h_for_actor = recent_incident_count_24h + 1
    is_first_incident_for_actor = prior_incident_count == 0
    details = {
        "channel": channel,
        "category": decision.category,
        "reason": decision.reason,
        "severity": decision.severity,
        "matched_terms": list(decision.matched_terms),
        "conversation_id": conversation_id,
        "query_excerpt": snippet,
        "actor_name": actor_profile.get("full_name"),
        "actor_role": actor_profile.get("role"),
        "actor_department": actor_profile.get("department"),
        "incident_count_for_actor": incident_count_for_actor,
        "prior_incident_count_for_actor": prior_incident_count,
        "incident_count_last_24h_for_actor": incident_count_last_24h_for_actor,
        "is_first_incident_for_actor": is_first_incident_for_actor,
    }

    incident_row = conn.execute(
        text(
            """
            INSERT INTO admin_audit_logs (
                actor_user_id,
                action,
                target_type,
                target_id,
                details
            )
            VALUES (
                CAST(:actor_user_id AS uuid),
                :action,
                :target_type,
                :target_id,
                CAST(:details AS jsonb)
            )
            RETURNING id::text AS incident_id, created_at
            """
        ),
        {
            "actor_user_id": user_id,
            "action": "guardrail_blocked_query",
            "target_type": "query",
            "target_id": conversation_id or "ad-hoc",
            "details": json.dumps(details),
        },
    ).mappings().one()
    incident_id = str(incident_row["incident_id"])

    targets = [
        row["id"]
        for row in conn.execute(
            text(
                """
                SELECT id::text AS id
                FROM users
                WHERE role IN ('admin', 'supervisor')
                ORDER BY role, full_name
                """
            )
        ).mappings()
    ]
    if not targets:
        return

    severity = "high" if decision.severity == "high" else "medium"
    category = (decision.category or "policy").replace("_", " ").title()
    reporter = actor_profile.get("full_name") or user_id or "Anonymous user"
    severity_label = "High severity" if severity == "high" else "Medium severity"
    incident_label = (
        "First incident"
        if is_first_incident_for_actor
        else f"Repeat incident #{incident_count_for_actor}"
    )
    reason_label = (decision.reason or "policy_violation").replace("_", " ")
    role_label = actor_profile.get("role") or "unknown role"
    excerpt_label = snippet[:96] + ("..." if len(snippet) > 96 else "")

    for target_user_id in targets:
        _queue_notification(
            conn,
            user_id=target_user_id,
            event_type="guardrail_blocked",
            severity=severity,
            title=f"{severity_label}: {reporter}",
            message=(
                f"{incident_label} from {reporter} ({role_label}) via {channel}. "
                f"Reason: {reason_label}. Excerpt: {excerpt_label}"
            ),
            cta_url=f"/admin/analytics?focus=guardrails&incident_id={incident_id}",
            event_key=f"guardrail:{incident_id}:{target_user_id}",
        )


def _guardrail_diagnostics(decision: GuardrailDecision) -> dict[str, Any]:
    return {
        "blocked": bool(decision.blocked),
        "category": decision.category,
        "reason": decision.reason,
        "severity": decision.severity,
        "matched_terms": list(decision.matched_terms),
    }


def _queue_notification(
    conn,
    *,
    user_id: str,
    event_type: str,
    severity: str,
    title: str,
    message: str,
    cta_url: str | None = None,
    event_key: str | None = None,
) -> None:
    inserted_id = conn.execute(
        text(
            """
            INSERT INTO notifications (
                user_id,
                event_type,
                severity,
                title,
                message,
                cta_url,
                channel,
                event_key,
                status
            )
            VALUES (
                CAST(:user_id AS uuid),
                :event_type,
                :severity,
                :title,
                :message,
                :cta_url,
                'in_app',
                :event_key,
                'unread'
            )
            ON CONFLICT(event_key) DO NOTHING
            RETURNING id::text
            """
        ),
        {
            "user_id": user_id,
            "event_type": event_type,
            "severity": severity,
            "title": title,
            "message": message,
            "cta_url": cta_url,
            "event_key": event_key,
        },
    ).scalar()

    if inserted_id:
        conn.execute(
            text(
                """
                INSERT INTO notification_delivery_logs (
                    notification_id,
                    channel,
                    delivery_status
                )
                VALUES (
                    CAST(:notification_id AS uuid),
                    'in_app',
                    'delivered'
                )
                """
            ),
            {"notification_id": inserted_id},
        )


def _materialize_user_notifications(conn, user_id: str) -> None:
    now = datetime.now(timezone.utc)

    assignment_rows = conn.execute(
        text(
            """
            SELECT
                ta.id::text AS assignment_id,
                tm.title AS module_title,
                ta.due_at
            FROM training_assignments ta
            JOIN training_modules tm ON tm.id = ta.module_id
            WHERE ta.user_id = CAST(:user_id AS uuid)
              AND ta.is_mandatory = true
              AND ta.status IN ('assigned', 'in_progress')
              AND ta.due_at IS NOT NULL
              AND ta.due_at <= now() + interval '3 day'
            ORDER BY ta.due_at ASC
            """
        ),
        {"user_id": user_id},
    ).mappings()

    for row in assignment_rows:
        due_at = row["due_at"]
        if due_at is None:
            continue
        if due_at.tzinfo is None:
            due_at = due_at.replace(tzinfo=timezone.utc)

        assignment_id = row["assignment_id"]
        module_title = row["module_title"]
        if due_at <= now:
            _queue_notification(
                conn,
                user_id=user_id,
                event_type="assignment_overdue",
                severity="high",
                title="Training overdue",
                message=f"{module_title} is overdue. Complete it now.",
                cta_url="/operator/training",
                event_key=f"assignment_overdue:{assignment_id}",
            )
            continue

        days_left = max(0, int((due_at - now).total_seconds() // 86400))
        due_bucket = 1 if days_left <= 1 else 3
        _queue_notification(
            conn,
            user_id=user_id,
            event_type="assignment_due",
            severity="medium",
            title="Training due soon",
            message=f"{module_title} is due in {due_bucket} day(s).",
            cta_url="/operator/training",
            event_key=f"assignment_due:{assignment_id}:{due_bucket}",
        )

    cert_rows = conn.execute(
        text(
            """
            SELECT
                c.id::text AS certification_id,
                tm.title AS module_title,
                c.status,
                c.expires_at
            FROM certifications c
            JOIN training_modules tm ON tm.id = c.module_id
            WHERE c.user_id = CAST(:user_id AS uuid)
              AND c.expires_at IS NOT NULL
              AND c.expires_at <= now() + interval '30 day'
            ORDER BY c.expires_at ASC
            """
        ),
        {"user_id": user_id},
    ).mappings()

    for row in cert_rows:
        certification_id = row["certification_id"]
        module_title = row["module_title"]
        expires_at = row["expires_at"]
        status = (row["status"] or "").lower()
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        if status == "expired" or (expires_at and expires_at <= now):
            _queue_notification(
                conn,
                user_id=user_id,
                event_type="certification_expired",
                severity="high",
                title="Certification expired",
                message=f"{module_title} certificate has expired.",
                cta_url="/operator/assessments",
                event_key=f"cert_expired:{certification_id}",
            )
            continue

        days_left = max(0, int((expires_at - now).total_seconds() // 86400))
        _queue_notification(
            conn,
            user_id=user_id,
            event_type="certification_expiring",
            severity="medium",
            title="Certificate expiring",
            message=f"{module_title} certificate expires in {days_left} day(s).",
            cta_url="/operator/reports",
            event_key=f"cert_expiring:{certification_id}",
        )


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


def _normalize_translation_language(language_code: str | None, *, fallback: str = DEFAULT_TTS_LANGUAGE) -> str:
    normalized = (language_code or "").strip()
    if not normalized:
        return fallback

    lowered = normalized.lower()
    if lowered in {"eng", "en", "english", "en-in", "en_us", "en-us"}:
        return "en-IN"
    if lowered in {"hin", "hing", "hi", "hindi", "hinglish", "hi-in"}:
        return "hi-IN"
    return normalized


def _is_hinglish_language(language_code: str | None) -> bool:
    lowered = (language_code or "").strip().lower()
    return lowered in {"hing", "hinglish", "roman-hindi", "roman_hindi", "hi-latn", "hi-latin"}


def _translate_character_limit() -> int:
    model_name = (settings.SARVAM_TRANSLATE_MODEL or "").strip().lower()
    if "mayura" in model_name:
        return 900
    return DEFAULT_TRANSLATE_MAX_CHARACTERS


def _split_text_for_translation(text: str, *, max_chars: int) -> list[str]:
    normalized = (text or "").strip()
    if not normalized:
        return []
    if len(normalized) <= max_chars:
        return [normalized]

    paragraphs = [
        part.strip()
        for part in re.split(r"\n{2,}", normalized)
        if part and part.strip()
    ]
    if not paragraphs:
        paragraphs = [normalized]

    chunks: list[str] = []
    current = ""

    def flush_current():
        nonlocal current
        if current.strip():
            chunks.append(current.strip())
        current = ""

    def append_piece(piece: str):
        nonlocal current
        candidate = piece.strip()
        if not candidate:
            return
        if not current:
            current = candidate
            return
        separator = "\n\n" if "\n" in candidate else " "
        merged = f"{current}{separator}{candidate}".strip()
        if len(merged) <= max_chars:
            current = merged
            return
        flush_current()
        current = candidate

    for paragraph in paragraphs:
        candidate = paragraph.strip()
        if not candidate:
            continue
        if len(candidate) <= max_chars:
            append_piece(candidate)
            continue

        sentences = [
            part.strip()
            for part in re.split(r"(?<=[.!?])\s+", candidate)
            if part and part.strip()
        ]
        if not sentences:
            sentences = [candidate]

        for sentence in sentences:
            remaining = sentence.strip()
            while len(remaining) > max_chars:
                split_at = remaining[:max_chars].rsplit(" ", 1)[0].strip()
                if not split_at:
                    split_at = remaining[:max_chars].strip()
                append_piece(split_at)
                remaining = remaining[len(split_at):].strip()
            append_piece(remaining)

    flush_current()
    return chunks or [normalized[:max_chars].strip()]


def _voice_not_understood_message(language_code: str | None) -> str:
    normalized = (language_code or "").strip().lower()
    if normalized.startswith("hi"):
        return "Awaaz clear nahi mili. Kripya dobara thoda dheere aur mic ke paas bolkar koshish karein."
    return "I could not hear you clearly. Please try again slowly and closer to the microphone."


def _is_english_language(language_code: str | None) -> bool:
    return bool(language_code and language_code.lower().startswith("en"))


def _normalize_tts_speaker(speaker: str | None) -> str:
    normalized_speaker = (speaker or "").strip().lower()
    if normalized_speaker in SUPPORTED_TTS_SPEAKERS:
        return normalized_speaker
    return DEFAULT_TTS_SPEAKER


def _resolve_audio_upload(file_name: str | None, content_type: str | None) -> tuple[str, str]:
    normalized_content_type = (content_type or "").strip().lower() or "audio/webm"
    safe_file_name = (file_name or "").strip()

    if safe_file_name:
        guessed_content_type, _ = mimetypes.guess_type(safe_file_name)
        if guessed_content_type:
            normalized_content_type = guessed_content_type.lower()
    else:
        extension = mimetypes.guess_extension(normalized_content_type) or ".webm"
        safe_file_name = f"voice-query{extension}"

    return safe_file_name, normalized_content_type


async def _transcribe_speech(
    client: httpx.AsyncClient,
    audio_bytes: bytes,
    language: str,
    file_name: str | None = None,
    content_type: str | None = None,
) -> tuple[str, str]:
    normalized_language = _normalize_stt_language(language)
    upload_name, upload_content_type = _resolve_audio_upload(file_name, content_type)
    stt_resp = await client.post(
        SARVAM_STT_URL,
        headers={"api-subscription-key": settings.SARVAM_API_KEY},
        data={
            "language_code": normalized_language,
            "model": settings.SARVAM_STT_MODEL,
            "mode": "transcribe",
        },
        files={"file": (upload_name, audio_bytes, upload_content_type)},
    )
    if stt_resp.status_code != 200:
        print(
            f"Sarvam STT error {stt_resp.status_code}: {stt_resp.text[:500]} "
            f"(lang={normalized_language}, model={settings.SARVAM_STT_MODEL}, "
            f"content_type={upload_content_type}, audio_size={len(audio_bytes)})"
        )
        stt_resp.raise_for_status()
    stt_data = stt_resp.json()
    transcript = (stt_data.get("transcript") or "").strip()
    detected_language = _get_detected_language(stt_data, normalized_language)
    return transcript, detected_language


async def _translate_text(
    client: httpx.AsyncClient,
    text: str,
    source_language: str,
    target_language: str,
) -> str:
    if not text.strip() or source_language == target_language:
        return text

    async def _translate_chunk(chunk_text: str, source_code: str) -> str:
        translate_resp = await client.post(
            SARVAM_TRANSLATE_URL,
            headers={
                "api-subscription-key": settings.SARVAM_API_KEY,
                "Content-Type": "application/json",
            },
            json={
                "input": chunk_text,
                "source_language_code": source_code,
                "target_language_code": target_language,
                "model": settings.SARVAM_TRANSLATE_MODEL,
                "mode": settings.SARVAM_TRANSLATE_MODE,
            },
        )
        translate_resp.raise_for_status()
        translated_text = (translate_resp.json().get("translated_text") or "").strip()
        return translated_text or chunk_text

    translated_parts: list[str] = []
    max_chars = _translate_character_limit()
    chunks = _split_text_for_translation(text, max_chars=max_chars)

    for chunk in chunks:
        try:
            translated_parts.append(await _translate_chunk(chunk, source_language))
            continue
        except httpx.HTTPStatusError as exc:
            should_retry_auto = (
                exc.response is not None
                and exc.response.status_code == 400
                and source_language != "auto"
            )
            if should_retry_auto:
                try:
                    translated_parts.append(await _translate_chunk(chunk, "auto"))
                    continue
                except httpx.HTTPStatusError as retry_exc:
                    if retry_exc.response is not None and retry_exc.response.status_code == 400:
                        print("Translate fallback returning original chunk after Sarvam 400.")
                        translated_parts.append(chunk)
                        continue
                    raise
            if exc.response is not None and exc.response.status_code == 400:
                print("Translate fallback returning original chunk after Sarvam 400.")
                translated_parts.append(chunk)
                continue
            raise

    if not translated_parts:
        return text
    return "\n\n".join(part.strip() for part in translated_parts if part.strip()).strip() or text


async def _transliterate_to_hinglish(client: httpx.AsyncClient, text: str) -> str:
    normalized_text = (text or "").strip()
    if not normalized_text:
        return text
    if not settings.has_primary_llm_credentials and not settings.GROQ_API_KEY:
        return text

    max_chars = max(600, _translate_character_limit())
    chunks = _split_text_for_translation(normalized_text, max_chars=max_chars)
    transliterated_parts: list[str] = []

    for chunk in chunks:
        system_prompt = (
            "Convert Hindi text into simple Roman Hindi (Hinglish) for Indian plant workers. "
            "Keep the meaning exact. Do not translate into English. "
            "Return only the converted text."
        )
        content = None
        if settings.has_primary_llm_credentials:
            content = await _call_primary_chat_model(
                system_prompt=system_prompt,
                user_prompt=chunk,
                max_tokens=900,
            )
        if not content:
            content = await _call_groq_chat_fallback(
                system_prompt=system_prompt,
                user_prompt=chunk,
                max_tokens=900,
            )
        content = (
            (content or "")
            .strip()
        )
        if content.startswith("```"):
            content = re.sub(r"^```[a-zA-Z]*\s*", "", content)
            content = re.sub(r"\s*```$", "", content).strip()
        transliterated_parts.append(content or chunk)

    if not transliterated_parts:
        return text
    return "\n\n".join(part.strip() for part in transliterated_parts if part.strip()).strip() or text


async def _run_blocking_with_timeout(timeout_seconds: float, func, *args, **kwargs):
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(func, *args, **kwargs),
            timeout=timeout_seconds,
        )
    except Exception:
        return None


async def _prepare_voice_query(
    client: httpx.AsyncClient,
    audio_bytes: bytes,
    language: str,
    file_name: str | None = None,
    content_type: str | None = None,
) -> tuple[str, str, str]:
    spoken_text, detected_language = await _transcribe_speech(
        client, audio_bytes, language, file_name, content_type
    )
    if not spoken_text.strip():
        return "", "", detected_language

    if _is_english_language(detected_language):
        return spoken_text, spoken_text, detected_language

    try:
        normalized_query = await _translate_text(
            client,
            spoken_text,
            detected_language,
            DEFAULT_TTS_LANGUAGE,
        )
    except Exception:
        normalized_query = spoken_text

    return spoken_text, normalized_query, detected_language


async def _translate_assistant_text(client: httpx.AsyncClient, assistant_text: str, target_language: str) -> tuple[str, str]:
    prepared_text = _prepare_tts_text(assistant_text)
    tts_language = _get_tts_language(target_language)
    if tts_language == DEFAULT_TTS_LANGUAGE:
        return prepared_text, tts_language

    translated_text = await _translate_text(
        client,
        prepared_text,
        DEFAULT_TTS_LANGUAGE,
        tts_language,
    )
    return _prepare_tts_text(translated_text), tts_language


def _prepare_tts_text(text: str) -> str:
    if not text:
        return ""

    cleaned = text.replace("\r", "\n")
    cleaned = re.sub(r"\n+", ". ", cleaned)
    cleaned = re.sub(r"\[[0-9,\s]+\]", "", cleaned)
    cleaned = re.sub(r"[*_`#>-]", " ", cleaned)
    cleaned = re.sub(r"\s+([,.:;!?])", r"\1", cleaned)
    cleaned = re.sub(r"([,.:;!?])(?:\s*[,.:;])+", r"\1", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) <= MAX_TTS_CHARACTERS:
        return cleaned

    sentence_chunks = re.split(r"(?<=[.!?])\s+", cleaned)
    selected: list[str] = []
    total_length = 0

    for chunk in sentence_chunks:
        candidate = chunk.strip()
        if not candidate:
            continue
        projected_length = total_length + len(candidate) + (1 if selected else 0)
        if projected_length > MAX_TTS_CHARACTERS - 28:
            break
        selected.append(candidate)
        total_length = projected_length

    shortened = " ".join(selected).strip() or cleaned[: MAX_TTS_CHARACTERS - 28].rsplit(" ", 1)[0].strip()
    if not shortened:
        shortened = cleaned[: MAX_TTS_CHARACTERS - 28].strip()
    return f"{shortened}. See screen for full details."[:MAX_TTS_CHARACTERS]


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
            "speaker": _normalize_tts_speaker(speaker),
            "model": settings.SARVAM_TTS_MODEL,
            "pace": 1.0,
            "enable_preprocessing": True,
        },
    )
    tts_resp.raise_for_status()
    return tts_resp.json()["audios"][0]


async def _generate_grounded_answer(
    query: str,
    language: str,
    evidence: list[dict[str, Any]],
    history: list[dict[str, str]] | None = None,
    chat_scope: str = "general",
) -> str:
    safe_fallback = "Not found in approved documents."
    is_summary_query = _is_summary_style_query(query)
    normalized_scope = _normalize_chat_scope(chat_scope)
    summary_points = _requested_summary_points(query)
    use_dspy_answer = _should_use_dspy_answer(
        query,
        chat_scope=normalized_scope,
        history=history,
    )

    if not evidence:
        return safe_fallback

    if is_summary_query and not settings.has_primary_llm_credentials and not settings.GROQ_API_KEY:
        return _extractive_summary_from_evidence(
            evidence,
            points=summary_points,
        )

    if normalized_scope == "reader" and _should_prefer_extractive_answer(query, evidence) and not is_summary_query:
        return _extractive_answer_from_evidence(query, evidence, max_sentences=4)

    if _should_prefer_extractive_answer(query, evidence):
        return _extractive_answer_from_evidence(query, evidence)

    evidence_limit = 10 if (is_summary_query and normalized_scope == "reader") else 5
    context_blocks = []
    for idx, ev in enumerate(evidence[:evidence_limit], start=1):
        line_start = ev.get("line_start")
        line_end = ev.get("line_end")
        line_label = ""
        if line_start is not None:
            line_label = (
                f" l.{line_start}-{line_end}"
                if line_end is not None and line_end != line_start
                else f" l.{line_start}"
            )
        citation = ev.get("citation_label") or (
            f"{ev.get('document_code', 'doc')} p.{ev.get('page_start', '?')}{line_label}"
        )
        content = (ev.get("content") or "")[:1600]
        context_blocks.append(f"[{idx}] {citation}\n{content}")
    context = "\n\n".join(context_blocks)

    if not settings.has_primary_llm_credentials and not settings.GROQ_API_KEY:
        top = evidence[0]
        citation = top.get("citation_label") or f"{top.get('document_code', 'doc')} p.{top.get('page_start', '?')}"
        return f"{(top.get('content') or '').strip()}\n\nSource: {citation}"

    draft_answer: str | None = None
    draft_citations: str | None = None
    dspy_role = (
        "reader_copilot"
        if normalized_scope == "reader"
        else "operation_coach"
        if normalized_scope == "guided"
        else "operator"
    )

    if use_dspy_answer:
        dspy_response = await _run_blocking_with_timeout(
            DSPY_ANSWER_TIMEOUT_SECONDS,
            generate_grounded_answer_with_dspy,
            query,
            language=language,
            role=dspy_role,
            history=history,
            evidence=evidence,
        )
        if dspy_response and dspy_response.get("answer"):
            draft_answer = dspy_response["answer"].strip()
            draft_citations = dspy_response.get("citations")

    if not draft_answer:
        history_text = "\n".join(
            f"{item['role'].title()}: {item['content']}"
            for item in (history or [])[-8:]
            if item.get("content")
        )

        if normalized_scope == "reader":
            style_instruction = (
                "You are a document-reading copilot. "
                "Prioritize exact procedural detail from the selected document revision. "
                "Keep answers concise and grounded, with explicit citation markers [1], [2]. "
                "Do not answer beyond the provided document evidence. "
            )
            if is_summary_query:
                style_instruction += (
                    f"For summary requests, return exactly {summary_points} clean numbered points from the evidence only. "
                )
        elif normalized_scope == "guided":
            style_instruction = (
                "You are a guided industrial operation coach for authorized operators. "
                "Do not assume the operator should perform the task. First separate learning from live operation when intent is unclear. "
                "For live operation, give one small checkpoint at a time, mention stop conditions, PPE, isolation/permit checks, and supervisor escalation when required. "
                "Use simple shop-floor language with citation markers [1], [2]. "
                "Never invent steps beyond approved evidence. "
            )
        else:
            style_instruction = (
                "You are a plant assistant for general SOP/manual help across approved documents. "
                "Answer naturally but keep instructions practical and brief. "
            )

        system_prompt = (
            style_instruction
            + "Answer the question using ONLY the provided evidence. "
            + "Extract and summarize the relevant information from the evidence to answer the question. "
            + "If the evidence contains relevant information, provide the answer with citations like [1], [2]. "
            + "If the evidence truly does not contain information to answer the question, then say: Not found in approved documents. "
            + "Use conversation history only to resolve follow-up references, never to invent new facts."
        )

        user_prompt = (
            f"Question: {query}\n"
            f"Language: {language}\n\n"
            f"Conversation history:\n{history_text or 'No prior conversation.'}\n\n"
            f"Here is the evidence from approved documents:\n{context}\n\n"
            "Based on the evidence above, answer the question directly. Extract the specific steps or information requested."
        )

        max_tokens = 480 if (normalized_scope == "reader" and is_summary_query) else 320
        if settings.has_primary_llm_credentials:
            draft_answer = await _call_primary_chat_model(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                max_tokens=max_tokens,
            )
        if not draft_answer:
            draft_answer = await _call_groq_chat_fallback(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                max_tokens=max_tokens,
            )
        if not draft_answer:
            draft_answer = _extractive_answer_from_evidence(query, evidence)

    if use_dspy_answer:
        verification = await _run_blocking_with_timeout(
            DSPY_VERIFY_TIMEOUT_SECONDS,
            verify_grounded_answer_with_dspy,
            query,
            draft_answer=draft_answer or "",
            drafted_citations=draft_citations,
            evidence=evidence,
        )
        if verification is not None and verification.get("supported") is False:
            return safe_fallback

    return draft_answer or _extractive_answer_from_evidence(query, evidence)


def _build_grounded_chat_prompt(
    query: str,
    language: str,
    evidence: list[dict[str, Any]],
    history: list[dict[str, str]] | None = None,
    chat_scope: str = "general",
) -> tuple[str, str, int]:
    normalized_scope = _normalize_chat_scope(chat_scope)
    evidence_limit = 10 if normalized_scope == "reader" else 5
    context_blocks = []
    for idx, ev in enumerate(evidence[:evidence_limit], start=1):
        line_start = ev.get("line_start")
        line_end = ev.get("line_end")
        line_label = ""
        if line_start is not None:
            line_label = (
                f" l.{line_start}-{line_end}"
                if line_end is not None and line_end != line_start
                else f" l.{line_start}"
            )
        citation = ev.get("citation_label") or (
            f"{ev.get('document_code', 'doc')} p.{ev.get('page_start', '?')}{line_label}"
        )
        content = (ev.get("content") or "")[:1600]
        context_blocks.append(f"[{idx}] {citation}\n{content}")
    context = "\n\n".join(context_blocks)
    history_text = "\n".join(
        f"{item['role'].title()}: {item['content']}"
        for item in (history or [])[-8:]
        if item.get("content")
    )
    if normalized_scope == "reader":
        style_instruction = (
            "You are a document-reading copilot. Keep answers concise, grounded, and easy to act on. "
            "Use citation markers [1], [2]. Do not answer beyond provided evidence. "
        )
    elif normalized_scope == "guided":
        style_instruction = (
            "You are a guided industrial operation coach for authorized operators. "
            "Give one checkpoint at a time, include stop conditions, PPE, isolation/permit checks, and supervisor escalation when required. "
            "Never invent steps beyond approved evidence. "
        )
    else:
        style_instruction = (
            "You are a plant assistant for general SOP, training, quiz, and operations help. "
            "Answer in simple shop-floor language. Be brief, practical, and grounded. "
        )
    system_prompt = (
        style_instruction
        + "Answer using ONLY the approved evidence. If the evidence does not answer the question, say: Not found in approved documents. "
        + "Use conversation history only to resolve follow-up references, never to invent facts."
    )
    user_prompt = (
        f"Question: {query}\n"
        f"Language: {language}\n\n"
        f"Conversation history:\n{history_text or 'No prior conversation.'}\n\n"
        f"Approved evidence:\n{context}\n\n"
        "Answer directly with citations."
    )
    max_tokens = 480 if normalized_scope == "reader" else 360
    return system_prompt, user_prompt, max_tokens


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
                    d.name AS department,
                    count(DISTINCT c.id) FILTER (WHERE c.status = 'active') AS active_certifications,
                    count(DISTINCT ta.id) FILTER (WHERE ta.is_mandatory) AS mandatory_assignments,
                    count(DISTINCT ta.id) FILTER (WHERE ta.is_mandatory AND ta.status = 'completed') AS completed_assignments,
                    max(c.expires_at) AS latest_cert_expiry
                FROM users u
                LEFT JOIN departments d ON d.id = u.department_id
                LEFT JOIN training_assignments ta ON ta.user_id = u.id
                LEFT JOIN certifications c ON c.user_id = u.id
                GROUP BY u.id, u.employee_code, u.full_name, u.email, u.role, u.preferred_language, d.name
                ORDER BY
                    CASE u.role WHEN 'operator' THEN 1 WHEN 'supervisor' THEN 2 WHEN 'admin' THEN 3 ELSE 4 END,
                    u.full_name
                """
            )
        ).mappings()
        users = [dict(row) for row in rows]
    for user in users:
        total = int(user.get("mandatory_assignments") or 0)
        completed = int(user.get("completed_assignments") or 0)
        user["mandatory_completion_rate"] = round((completed / total) * 100, 2) if total else 0.0
        user["latest_cert_expiry"] = _iso(user.get("latest_cert_expiry"))
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


@app.get("/api/worker/brief")
async def worker_brief(user_id: str):
    with engine.begin() as conn:
        user = _get_user(conn, user_id)
        _materialize_user_notifications(conn, user_id)

        memory = conn.execute(
            text(
                """
                SELECT
                    preferred_language,
                    skill_tags,
                    risk_flags,
                    last_equipment,
                    last_sop_code,
                    interaction_count,
                    last_interaction_at,
                    updated_at
                FROM worker_memory_profiles
                WHERE user_id = CAST(:user_id AS uuid)
                """
            ),
            {"user_id": user_id},
        ).mappings().first()

        assignment_rows = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        ta.id::text AS assignment_id,
                        tm.title AS module_title,
                        tm.criticality,
                        ta.status,
                        ta.progress_percent,
                        ta.due_at
                    FROM training_assignments ta
                    JOIN training_modules tm ON tm.id = ta.module_id
                    WHERE ta.user_id = CAST(:user_id AS uuid)
                      AND ta.status IN ('assigned', 'in_progress')
                    ORDER BY
                        ta.is_mandatory DESC,
                        ta.due_at ASC NULLS LAST,
                        tm.criticality DESC,
                        tm.title
                    LIMIT 4
                    """
                ),
                {"user_id": user_id},
            ).mappings()
        ]

        latest_revisions = [
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
                        dr.updated_at
                    FROM document_revisions dr
                    JOIN documents d ON d.id = dr.document_id
                    WHERE dr.is_latest_approved = true
                    ORDER BY dr.updated_at DESC, d.code
                    LIMIT 4
                    """
                )
            ).mappings()
        ]

        handoff_rows = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        id::text AS handoff_id,
                        equipment,
                        task,
                        reason,
                        severity,
                        status,
                        created_at
                    FROM supervisor_handoffs
                    WHERE user_id = CAST(:user_id AS uuid)
                      AND status = 'open'
                    ORDER BY created_at DESC
                    LIMIT 4
                    """
                ),
                {"user_id": user_id},
            ).mappings()
        ]

        activity_rows = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        id::text AS activity_id,
                        event_type,
                        event_source,
                        severity,
                        title,
                        details,
                        created_at
                    FROM worker_activity_events
                    WHERE user_id = CAST(:user_id AS uuid)
                    ORDER BY created_at DESC
                    LIMIT 8
                    """
                ),
                {"user_id": user_id},
            ).mappings()
        ]

    now = datetime.now(timezone.utc)
    today: list[dict[str, Any]] = []

    for row in handoff_rows[:2]:
        today.append(
            {
                "type": "supervisor_handoff",
                "priority": "high" if row.get("severity") == "high" else "medium",
                "title": "Supervisor help is open",
                "detail": _compact_text(
                    f"{row.get('equipment') or 'Equipment'} - {row.get('task') or row.get('reason') or 'Help requested'}",
                    max_chars=120,
                ),
                "cta_url": "/operator/command-hub",
                "created_at": _iso(row.get("created_at")),
            }
        )

    for row in assignment_rows[:3]:
        due_at = row.get("due_at")
        if due_at and due_at.tzinfo is None:
            due_at = due_at.replace(tzinfo=timezone.utc)
        priority = "medium"
        detail = f"{int(row.get('progress_percent') or 0)}% complete"
        if due_at and due_at <= now:
            priority = "high"
            detail = "Overdue. Complete before next shift handover."
        elif due_at:
            days_left = max(0, int((due_at - now).total_seconds() // 86400))
            detail = f"{detail}. Due in {days_left} day(s)."
        today.append(
            {
                "type": "training",
                "priority": priority,
                "title": _compact_text(row.get("module_title"), max_chars=100) or "Training assigned",
                "detail": detail,
                "cta_url": "/operator/training",
                "due_at": _iso(row.get("due_at")),
            }
        )

    for row in latest_revisions[:3]:
        today.append(
            {
                "type": "document_revision",
                "priority": "medium",
                "title": _compact_text(f"{row.get('code')} updated", max_chars=100),
                "detail": _compact_text(row.get("title"), max_chars=130),
                "cta_url": f"/operator/reader/{row.get('revision_id')}?page=1" if row.get("revision_id") else "/operator",
                "updated_at": _iso(row.get("updated_at")),
                "document_code": row.get("code"),
                "revision_label": row.get("revision_label"),
            }
        )

    memory_payload = dict(memory) if memory else {}
    for key in ("last_interaction_at", "updated_at"):
        if key in memory_payload:
            memory_payload[key] = _iso(memory_payload[key])

    for row in activity_rows:
        row["created_at"] = _iso(row.get("created_at"))

    for row in handoff_rows:
        row["created_at"] = _iso(row.get("created_at"))

    return {
        "user": user,
        "memory": memory_payload,
        "today": today[:6],
        "open_handoffs": handoff_rows,
        "recent_activity": activity_rows,
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
        module_payload = dict(module)

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

        regenerated_preview = _regenerate_training_preview(conn, module_payload, steps)
        if regenerated_preview:
            module_payload, regenerated_steps = regenerated_preview
            normalized_steps: list[dict[str, Any]] = []
            for step in regenerated_steps:
                normalized_steps.append(
                    {
                        "id": str(step.get("source_chunk_id") or uuid.uuid4()),
                        "step_number": step.get("step_number"),
                        "title": step.get("title"),
                        "instruction": step.get("instruction"),
                        "voice_prompt": step.get("voice_prompt"),
                        "operator_check": step.get("operator_check"),
                        "source_chunk_id": step.get("source_chunk_id"),
                        "citation_label": step.get("citation_label"),
                        "page_start": step.get("page_start"),
                        "page_end": step.get("page_end"),
                    }
                )
            steps = normalized_steps

        assessment = conn.execute(
            text(
                """
                SELECT
                    a.id::text AS assessment_id,
                    a.title AS assessment_title,
                    a.passing_score,
                    a.time_limit_seconds,
                    a.certification_label
                FROM assessments a
                WHERE a.module_id = CAST(:module_id AS uuid)
                LIMIT 1
                """
            ),
            {"module_id": module_id},
        ).mappings().first()

    return {
        "module": module_payload,
        "steps": steps,
        "assignment": dict(assignment) if assignment else None,
        "assessment": dict(assessment) if assessment else None,
    }


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


@app.get("/api/conversations", response_model=list[ChatConversationSummary])
async def list_chat_conversations(
    user_id: str,
    limit: int = 12,
    scope: str | None = None,
):
    normalized_scope = _normalize_chat_scope(scope)
    with engine.connect() as conn:
        _get_user(conn, user_id)
        conversations = _list_chat_conversations(
            conn,
            user_id,
            max(1, min(limit, 24)),
            scope=normalized_scope,
        )
    return [ChatConversationSummary(**item) for item in conversations]


@app.post("/api/conversations", response_model=ChatConversationSummary)
async def create_chat_conversation(req: ChatConversationCreateRequest):
    normalized_scope = _normalize_chat_scope(req.chat_scope)
    with engine.begin() as conn:
        _get_user(conn, req.user_id)
        conversation = _create_chat_conversation(
            conn,
            user_id=req.user_id,
            language=req.language,
            title=req.title,
            chat_scope=normalized_scope,
        )
    return ChatConversationSummary(**conversation)


@app.get("/api/conversations/{conversation_id}", response_model=ChatConversationDetail)
async def get_chat_conversation(
    conversation_id: str,
    user_id: str,
    scope: str | None = None,
):
    normalized_scope = _normalize_chat_scope(scope)
    with engine.connect() as conn:
        _get_user(conn, user_id)
        detected_scope = _detect_chat_scope_for_conversation(conn, conversation_id, user_id)
        if not detected_scope:
            raise HTTPException(status_code=404, detail="Conversation not found")
        if detected_scope != normalized_scope:
            raise HTTPException(status_code=404, detail="Conversation not found")
        conversation = _get_chat_conversation(
            conn,
            conversation_id,
            user_id,
            chat_scope=normalized_scope,
        )
        messages = _get_chat_messages(conn, conversation_id, chat_scope=normalized_scope)
    return ChatConversationDetail(
        conversation=ChatConversationSummary(**conversation),
        messages=[ChatConversationMessage(**item) for item in messages],
    )


def _operation_guide_mode(query: str, requested_intent: str | None = None) -> str:
    requested = (requested_intent or "").strip().lower()
    if requested in {"run", "live", "execute", "operate"}:
        return "run"
    if requested in {"learn", "knowledge", "explain", "study"}:
        return "learn"

    lowered = (query or "").lower()
    if re.search(r"\b(run|start|operate)\b.{0,80}\b(now|live|with checks)\b", lowered):
        return "run"
    run_markers = (
        "run now",
        "start now",
        "operate now",
        "execute",
        "i am at",
        "i reached",
        "ready to start",
        "start step",
        "karna hai",
        "chalu karna",
        "chalana",
        "abhi start",
    )
    learn_markers = (
        "learn",
        "knowledge",
        "explain",
        "understand",
        "training",
        "sirf jankari",
        "samjhao",
        "padhna",
    )
    if any(marker in lowered for marker in run_markers):
        return "run"
    if any(marker in lowered for marker in learn_markers):
        return "learn"
    return "clarify"


def _is_guided_advance_query(query: str) -> bool:
    lowered = (query or "").lower()
    advance_markers = (
        "i am at",
        "i reached",
        "done",
        "clear",
        "yes",
        "next",
        "show next",
        "checkpoint clear",
        "at the pump",
        "main pump",
        "paas",
        "hoon",
        "ho gaya",
        "agla",
    )
    return any(marker in lowered for marker in advance_markers)


def _guided_history_is_live_run(history: list[dict[str, str]] | None) -> bool:
    if not history:
        return False
    for item in reversed(history[-8:]):
        if item.get("role") != "assistant":
            continue
        content = (item.get("content") or "").lower()
        if "live run guide" in content or "checkpoint" in content:
            return True
        if "learn the procedure first" in content:
            return False
    return False


def _guided_next_step_index(
    history: list[dict[str, str]] | None,
    query: str,
    guide_mode: str,
) -> int:
    if guide_mode != "run":
        return 1
    max_seen = 0
    for item in history or []:
        if item.get("role") != "assistant":
            continue
        content = item.get("content") or ""
        for match in re.finditer(r"\b(?:checkpoint|step)\s+(\d+)\b", content, flags=re.IGNORECASE):
            try:
                max_seen = max(max_seen, int(match.group(1)))
            except Exception:
                continue
    if max_seen <= 0:
        return 1
    return max_seen + 1 if _is_guided_advance_query(query) else max_seen


def _operation_step_keywords(step_index: int) -> str:
    step_keywords = {
        1: "prime pump fill pump casing water before starting engine do not attempt to start",
        2: "suction strainer under water suction hose securely attached no air leakage clamps couplings",
        3: "engine fuel valve lever ON position",
        4: "throttle lever away from slow one third toward fast start position",
        5: "choke lever CLOSED cold engine OPEN warm engine",
        6: "engine ON OFF switch ON position",
        7: "starter grip pull briskly smoothly compression point",
        8: "engine warms choke OPEN run several minutes check fuel leaks noises loose component",
        9: "shutdown throttle IDLE engine OFF fuel shut off lever OFF emergency shutdown",
    }
    return step_keywords.get(step_index, step_keywords[8])


def _operation_step_instruction(step_index: int) -> str:
    step_text = {
        1: "Before starting, confirm the pump casing is filled with water. Do not start the engine if the pump has not been primed.",
        2: "Check that the suction strainer is clean, fully under water, and securely attached to the suction hose.",
        3: "Check that the suction and discharge hoses are securely connected, with no air leakage on the suction side.",
        4: "Place the engine fuel valve lever in the ON position.",
        5: "Move the throttle lever about one-third of the way from slow toward fast.",
        6: "Set the choke correctly: CLOSED for a cold engine, OPEN for a warm engine or warm weather.",
        7: "Place the engine ON/OFF switch in the ON position.",
        8: "Pull the starter grip briskly and smoothly at the compression point to start the engine.",
        9: "After the engine starts, open the choke as it warms up, run for several minutes, and check for fuel leaks or unusual noises.",
    }
    return step_text.get(
        step_index,
        "Continue only with the approved site SOP and supervisor direction. Stop if the condition is not exactly as expected.",
    )


def _operation_step_evidence_lookup(
    *,
    query_text: str,
    step_index: int,
    limit: int = 5,
) -> list[dict[str, Any]]:
    tokens = [
        token
        for token in re.findall(
            r"[a-z0-9]+",
            (_operation_step_keywords(step_index) + " " + _operation_step_instruction(step_index)).lower(),
        )
        if len(token) > 3
    ]
    priority_tokens = tokens[:10] or ["pump", "start"]
    token_clauses = []
    score_clauses = []
    params: dict[str, Any] = {"limit": max(1, min(limit, 8))}
    for index, token in enumerate(priority_tokens):
        key = f"term_{index}"
        token_clauses.append(f"lower(dc.content) LIKE :{key}")
        score_clauses.append(f"CASE WHEN lower(dc.content) LIKE :{key} THEN 1 ELSE 0 END")
        params[key] = f"%{token}%"

    lowered_query = (query_text or "").lower()
    equipment_clause = ""
    if "pump" in lowered_query or "centrifugal" in lowered_query:
        equipment_clause = "AND (lower(d.title) LIKE '%pump%' OR lower(d.code) LIKE '%pump%')"

    sql = text(
        f"""
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
            dc.bbox_y1
        FROM document_chunks dc
        JOIN document_revisions dr ON dc.revision_id = dr.id
        JOIN documents d ON dr.document_id = d.id
        WHERE dr.is_latest_approved = true
          {equipment_clause}
          AND ({' OR '.join(token_clauses)})
        ORDER BY
            ({' + '.join(score_clauses)}) DESC,
            CASE WHEN lower(d.title) LIKE '%pump%' THEN 0 ELSE 1 END,
            dc.page_start NULLS LAST,
            dc.chunk_index
        LIMIT :limit
        """
    )

    try:
        with engine.connect() as conn:
            rows = conn.execute(sql, params).mappings().all()
    except Exception:
        return []

    evidence: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        item = dict(row)
        block_ids = item.get("block_ids") or []
        if isinstance(block_ids, str):
            try:
                block_ids = json.loads(block_ids)
            except Exception:
                block_ids = []
        item["block_ids"] = block_ids
        item["line_start"] = None
        item["line_end"] = None
        item["scores"] = {
            "lexical": round(1.0 - (index * 0.08), 6),
            "semantic": 0.0,
            "page_match": 0.0,
            "multimodal": 0.0,
            "final": round(1.0 - (index * 0.08), 6),
        }
        evidence.append(item)
    return evidence


def _operation_next_actions(mode: str, language: str) -> list[str]:
    normalized_language = _normalize_chat_language(language)
    if normalized_language == "hi":
        if mode == "run":
            return ["मैं मशीन के पास हूँ", "अगला स्टेप बताओ", "सुपरवाइजर मदद चाहिए"]
        if mode == "learn":
            return ["मुझे स्टार्टअप समझाओ", "मुझे शटडाउन समझाओ", "क्विज शुरू करो"]
        return ["अभी चलाना है", "सिर्फ समझना है", "सुपरवाइजर मदद चाहिए"]
    if normalized_language == "hing":
        if mode == "run":
            return ["Main pump ke paas hoon", "Next step batao", "Supervisor help chahiye"]
        if mode == "learn":
            return ["Startup samjhao", "Shutdown samjhao", "Quiz start karo"]
        return ["Abhi run karna hai", "Sirf learn karna hai", "Supervisor help chahiye"]
    if mode == "run":
        return ["I am at the pump", "Show next step", "Need supervisor help"]
    if mode == "learn":
        return ["Explain startup", "Explain shutdown", "Start quiz"]
    return ["Run now with checks", "Learn first", "Need supervisor help"]


GUIDED_PREREQUISITES = (
    ("authorization", "authorization to perform this task"),
    ("ppe", "required PPE is worn"),
    ("permit_isolation", "permit/isolation checks are complete"),
    ("area_safe", "area is clear and safe"),
)


def _new_guided_operation_state(query: str, language: str) -> dict[str, Any]:
    lowered = (query or "").lower()
    equipment = "centrifugal pump" if "pump" in lowered or "centrifugal" in lowered else None
    task = "startup" if re.search(r"\b(start|run|operate|chalu|chalana)\b", lowered) else None
    return {
        "version": "operation_guide_v1",
        "phase": "task_selection" if not equipment else "task_selected",
        "mode": "clarify",
        "equipment": equipment,
        "task": task,
        "step_index": 0,
        "prerequisites": {key: False for key, _ in GUIDED_PREREQUISITES},
        "stop_conditions": [
            "condition differs from the approved SOP",
            "leak, abnormal noise, vibration, smell, or heat is observed",
            "pump is not primed or suction is not confirmed",
            "operator is unsure or not authorized",
        ],
        "started_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": None,
        "completion_record_id": None,
    }


def _coerce_guided_state(metadata: dict[str, Any], query: str, language: str) -> dict[str, Any]:
    state = metadata.get("operation_state")
    if not isinstance(state, dict) or state.get("version") != "operation_guide_v1":
        return _new_guided_operation_state(query, language)
    if not state.get("equipment"):
        inferred = _new_guided_operation_state(query, language)
        state["equipment"] = inferred.get("equipment")
        state["task"] = state.get("task") or inferred.get("task")
    state.setdefault("prerequisites", {key: False for key, _ in GUIDED_PREREQUISITES})
    state.setdefault("stop_conditions", _new_guided_operation_state(query, language)["stop_conditions"])
    state.setdefault("step_index", 0)
    state.setdefault("phase", "task_selected" if state.get("equipment") else "task_selection")
    return state


def _guided_state_label(state: dict[str, Any]) -> str:
    labels = {
        "task_selection": "Task selection",
        "task_selected": "Task selected",
        "learning": "Learning mode",
        "prerequisite_checks": "Pre-checks",
        "running": "Live step-by-step",
        "supervisor_handoff": "Supervisor handoff",
        "completed": "Completed",
        "blocked": "Blocked",
    }
    return labels.get(str(state.get("phase") or ""), "Run guide")


def _guided_completion_record_id(conversation_id: str | None) -> str:
    suffix = (conversation_id or str(uuid.uuid4())).split("-")[0].upper()
    return f"RUN-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{suffix}"


def _guided_confirmed_prerequisites(query: str) -> set[str]:
    lowered = (query or "").lower()
    if any(marker in lowered for marker in ("all checks", "all clear", "everything clear", "sab clear", "all ok")):
        return {key for key, _ in GUIDED_PREREQUISITES}
    confirmed: set[str] = set()
    if any(marker in lowered for marker in ("authorization", "authorised", "authorized", "permission")):
        confirmed.add("authorization")
    if "ppe" in lowered or "helmet" in lowered or "gloves" in lowered or "goggles" in lowered:
        confirmed.add("ppe")
    if "permit" in lowered or "isolation" in lowered or "loto" in lowered:
        confirmed.add("permit_isolation")
    if "area" in lowered or "clear" in lowered or "safe" in lowered:
        confirmed.add("area_safe")
    return confirmed


def _guided_missing_prerequisites(state: dict[str, Any]) -> list[tuple[str, str]]:
    prereqs = state.get("prerequisites") or {}
    return [(key, label) for key, label in GUIDED_PREREQUISITES if not prereqs.get(key)]


def _build_guided_prerequisite_prompt(state: dict[str, Any], language: str) -> str:
    equipment = state.get("equipment") or "equipment"
    task = state.get("task") or "task"
    missing = _guided_missing_prerequisites(state)
    confirmed = len(GUIDED_PREREQUISITES) - len(missing)
    missing_lines = "\n".join(f"- Confirm {label}." for _, label in missing)
    if not missing_lines:
        missing_lines = "- All pre-checks are confirmed."
    return (
        f"Run guide state: {equipment} / {task}.\n\n"
        f"Before live steps, complete pre-checks ({confirmed}/{len(GUIDED_PREREQUISITES)} confirmed):\n"
        f"{missing_lines}\n\n"
        "Reply with the specific check completed, or say 'all checks clear'. "
        "If any check is not clear, stop and choose supervisor help."
    )


def _guided_next_actions_for_state(state: dict[str, Any], language: str) -> list[str]:
    phase = state.get("phase")
    if phase == "task_selection":
        return ["How to start centrifugal pump", "Learn centrifugal pump startup", "Need supervisor help"]
    if phase == "task_selected":
        return ["Run now with checks", "Learn first", "Need supervisor help"]
    if phase == "prerequisite_checks":
        missing = _guided_missing_prerequisites(state)
        actions = [f"{label.title()} OK" for _, label in missing[:2]]
        actions.append("All checks clear")
        actions.append("Need supervisor help")
        return actions
    if phase == "running":
        return ["Checkpoint clear", "Show next step", "Need supervisor help"]
    if phase == "learning":
        return ["Run now with checks", "Ask a doubt", "Need supervisor help"]
    if phase == "supervisor_handoff":
        return ["Call supervisor", "Describe current condition", "Close guide"]
    if phase == "completed":
        return ["Start another guide", "Open report", "Ask a follow-up"]
    return ["Run now with checks", "Learn first", "Need supervisor help"]


def _sse_event(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _stream_text_chunks(text_value: str, *, max_chars: int = 24) -> list[str]:
    words = re.findall(r"\S+\s*", text_value)
    chunks: list[str] = []
    current = ""
    for word in words:
        if current and len(current) + len(word) > max_chars:
            chunks.append(current)
            current = word
        else:
            current += word
    if current:
        chunks.append(current)
    return chunks or [text_value]


def _source_status_from_evidence(evidence: list[dict[str, Any]], *, fallback: str) -> str:
    labels: list[str] = []
    for ev in evidence[:3]:
        code = ev.get("document_code") or "document"
        page = ev.get("page_start")
        label = f"{code} p.{page}" if page else str(code)
        if label not in labels:
            labels.append(label)
    if not labels:
        return fallback
    return "Reviewing evidence from " + ", ".join(labels)


def _build_operation_clarifier(
    *,
    query: str,
    language: str,
    evidence: list[dict[str, Any]],
) -> str:
    source_hint = ""
    if evidence:
        top = evidence[0]
        source_hint = f" I found a matching approved source: {top.get('document_code') or 'document'} p.{top.get('page_start') or '?'}."
    normalized_language = _normalize_chat_language(language)
    if normalized_language == "hi":
        return (
            "पहले स्पष्ट करें: आप इसे अभी मशीन पर चलाना चाहते हैं या सिर्फ सीखना चाहते हैं?"
            f"{source_hint} अगर अभी चलाना है, तो मैं छोटे-छोटे safety checkpoints में आगे बढ़ाऊँगा।"
        )
    if normalized_language == "hing":
        return (
            "Pehle clear karo: aap isko abhi machine par run karna chahte ho ya sirf learn karna chahte ho?"
            f"{source_hint} Agar abhi run karna hai, main small safety checkpoints me guide karunga."
        )
    return (
        "First choose the mode: do you want to run this now on the equipment, or learn the procedure first?"
        f"{source_hint} If this is a live operation, I will guide one checkpoint at a time and stop when a permit, PPE, condition, or supervisor check is required."
    )


def _build_operation_run_checkpoint(
    *,
    evidence: list[dict[str, Any]],
    language: str,
    step_index: int = 1,
) -> str:
    if not evidence:
        return "Not found in approved documents."

    def score_operation_source(item: dict[str, Any]) -> int:
        text_value = (item.get("content") or "").lower()
        step_terms = [
            token
            for token in re.findall(r"[a-z0-9]+", _operation_step_keywords(step_index).lower())
            if len(token) > 2
        ]
        score = 0
        score += sum(1 for token in step_terms if token in text_value)
        if "do not attempt to start" in text_value or "primed" in text_value:
            score += 8
        if "starting the engine" in text_value:
            score += 6
        if "fuel valve" in text_value or "on position" in text_value:
            score += 3
        if "fill pump casing with water" in text_value or "pump casing" in text_value:
            score += 4
        if "shutdown" in text_value or "off position" in text_value:
            score -= 5
        if "idle position" in text_value and "three minutes" in text_value:
            score -= 4
        return score

    top = max(evidence[:6], key=score_operation_source)
    citation = top.get("citation_label") or f"{top.get('document_code', 'doc')} p.{top.get('page_start', '?')}"
    checkpoint = _operation_step_instruction(step_index)
    checkpoint = (
        checkpoint.replace("Â", "")
        .replace("Â", "")
        .replace("â", "-")
        .replace("â¢", "-")
        .replace("fi ll", "fill")
        .replace("fi lled", "filled")
        .replace("lose component", "loose component")
    )
    checkpoint = checkpoint.encode("ascii", "ignore").decode("ascii")
    checkpoint = re.sub(r"\s+", " ", checkpoint).strip(" -")

    normalized_language = _normalize_chat_language(language)
    if normalized_language == "hi":
        return (
            f"Live run guide. पहले authorization, PPE, permit/isolation और area safe confirm करें।\n\n"
            f"Checkpoint {step_index}: {checkpoint} [{citation}]\n\n"
            "अगर condition अलग है, leak/noise है, pump primed नहीं है, या doubt है तो stop करें और supervisor को बुलाएँ। "
            "Confirm करें: क्या आप pump के पास हैं और यह checkpoint clear है?"
        )
    if normalized_language == "hing":
        return (
            f"Live run guide. Pehle authorization, PPE, permit/isolation aur area safe confirm karo.\n\n"
            f"Checkpoint {step_index}: {checkpoint} [{citation}]\n\n"
            "Agar condition alag hai, leak/noise hai, pump primed nahi hai, ya doubt hai to stop karo aur supervisor ko bulao. "
            "Confirm karo: kya aap pump ke paas ho aur checkpoint clear hai?"
        )
    return (
        "Live run guide. First confirm authorization, PPE, permit/isolation, and safe area conditions.\n\n"
        f"Checkpoint {step_index}: {checkpoint} [{citation}]\n\n"
        "Stop if the condition differs from the approved source, if there is a leak/noise, if the pump is not primed, "
        "or if you are unsure. Confirm: is this checkpoint clear?"
    )


@app.post("/api/operation-guide", response_model=OperationGuideResponse)
async def operation_guide(req: OperationGuideRequest):
    request_started_at = perf_counter()
    normalized_scope = "guided"
    conversation_id = req.conversation_id
    history: list[dict[str, str]] = []
    conversation_metadata: dict[str, Any] = {}

    if req.user_id:
        with engine.connect() as conn:
            _get_user(conn, req.user_id)
            if conversation_id:
                conversation_scope = _detect_chat_scope_for_conversation(
                    conn, conversation_id, req.user_id
                )
                if not conversation_scope:
                    raise HTTPException(status_code=404, detail="Conversation not found")
                if conversation_scope != normalized_scope:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "Conversation scope mismatch. "
                            f"Expected '{normalized_scope}', found '{conversation_scope}'."
                        ),
                    )
                history = _history_from_messages(
                    _get_chat_messages(conn, conversation_id, chat_scope=normalized_scope)
                )
                conversation_metadata = _get_conversation_metadata(
                    conn,
                    conversation_id,
                    req.user_id,
                    chat_scope=normalized_scope,
                )

    guardrail_decision = evaluate_guardrail(req.query)
    if guardrail_decision.blocked:
        answer = guardrail_decision.user_message
        if req.user_id:
            with engine.begin() as conn:
                _get_user(conn, req.user_id)
                if not conversation_id:
                    conversation = _create_chat_conversation(
                        conn,
                        user_id=req.user_id,
                        language=req.language,
                        title=_conversation_title_from_query(req.query),
                        chat_scope=normalized_scope,
                        metadata={"scope": normalized_scope, "pipeline": "operation_guide"},
                    )
                    conversation_id = conversation["id"]
                _append_chat_message(
                    conn,
                    conversation_id=conversation_id,
                    role="user",
                    content=req.query,
                    language=req.language,
                    response_mode="operation",
                    chat_scope=normalized_scope,
                )
                _append_chat_message(
                    conn,
                    conversation_id=conversation_id,
                    role="assistant",
                    content=answer,
                    language=req.language,
                    response_mode="operation",
                    chat_scope=normalized_scope,
                )
                _upsert_worker_memory(
                    conn,
                    user_id=req.user_id,
                    language=req.language,
                    skill_tags=["operation guide", "guardrail"],
                    risk_flags=[guardrail_decision.category or "blocked"],
                )
                _record_worker_activity(
                    conn,
                    user_id=req.user_id,
                    event_type="operation_guardrail_block",
                    severity=guardrail_decision.severity or "high",
                    title="Run Guide stopped unsafe request",
                    details={
                        "conversation_id": conversation_id,
                        "query": req.query,
                        "guardrail": _guardrail_diagnostics(guardrail_decision),
                    },
                )
                _notify_guardrail_violation(
                    conn,
                    user_id=req.user_id,
                    query_text=req.query,
                    decision=guardrail_decision,
                    channel="operation_guide",
                    conversation_id=conversation_id,
                )
        return OperationGuideResponse(
            answer=answer,
            mode="blocked",
            next_actions=[],
            state={"phase": "blocked"},
            state_label="Blocked",
            requires_supervisor=True,
            confidence=0.0,
            latency_ms=int((perf_counter() - request_started_at) * 1000),
            retrieval_event_id=None,
            conversation_id=conversation_id,
            evidence=[],
            diagnostics={"guardrail": _guardrail_diagnostics(guardrail_decision)},
        )

    state = _coerce_guided_state(conversation_metadata, req.query, req.language)
    guide_mode = _operation_guide_mode(req.query, req.intent)
    lowered_query = (req.query or "").lower()
    if guide_mode == "clarify" and _guided_history_is_live_run(history):
        guide_mode = "run"
    if state.get("phase") == "prerequisite_checks" and guide_mode == "clarify":
        guide_mode = "run"
    if state.get("phase") == "running" and guide_mode == "clarify":
        guide_mode = "run"
    if "supervisor" in lowered_query or "help" in lowered_query and "supervisor" in lowered_query:
        guide_mode = "blocked"
        state["phase"] = "supervisor_handoff"
        state["requires_supervisor"] = True
    elif guide_mode == "learn":
        state["mode"] = "learn"
        state["phase"] = "learning"
    elif guide_mode == "run":
        state["mode"] = "run"
        if not state.get("equipment"):
            state["phase"] = "task_selection"
        else:
            prereqs = state.setdefault("prerequisites", {key: False for key, _ in GUIDED_PREREQUISITES})
            for key in _guided_confirmed_prerequisites(req.query):
                prereqs[key] = True
            if _guided_missing_prerequisites(state):
                state["phase"] = "prerequisite_checks"
            else:
                state["phase"] = "running"

    if state.get("phase") == "running":
        current_step = int(state.get("step_index") or 0)
        if current_step <= 0:
            step_index = 1
        elif _is_guided_advance_query(req.query):
            step_index = current_step + 1
        else:
            step_index = current_step
        if step_index > 9:
            state["phase"] = "completed"
            state["completed_at"] = datetime.now(timezone.utc).isoformat()
            state["completion_record_id"] = state.get("completion_record_id") or _guided_completion_record_id(conversation_id)
            step_index = 9
        state["step_index"] = step_index
    else:
        step_index = int(state.get("step_index") or 0) or 1

    contextual_query = _build_contextual_query(req.query, history)
    retrieval_query = contextual_query
    direct_answer: str | None = None
    direct_evidence: list[dict[str, Any]] = []
    result: dict[str, Any] | None = None

    if state.get("phase") == "task_selection":
        direct_answer = (
            "Tell me the equipment and the task first. Example: 'start centrifugal pump'. "
            "After that I will ask whether this is live operation or learning."
        )
    elif state.get("phase") == "supervisor_handoff":
        direct_answer = (
            "Stop the live guide. Supervisor handoff is required before continuing. "
            "Share the equipment, task, current condition, and why help is needed."
        )
    elif state.get("phase") == "prerequisite_checks":
        direct_answer = _build_guided_prerequisite_prompt(state, req.language)
    elif state.get("phase") == "completed":
        direct_answer = (
            f"Run guide completed. Completion record: {state.get('completion_record_id')}. "
            "If any abnormal condition occurred, report it before closing the job."
        )

    if direct_answer is not None:
        evidence = direct_evidence
        result = {
            "confidence": 1.0 if state.get("phase") in {"prerequisite_checks", "completed"} else 0.0,
            "latency_ms": int((perf_counter() - request_started_at) * 1000),
            "retrieval_event_id": None,
            "evidence": evidence,
            "diagnostics": {
                "pipeline": "operation_state_machine",
                "state_phase": state.get("phase"),
                "step_index": state.get("step_index"),
            },
        }
    elif state.get("phase") == "running":
        retrieval_query = (
            contextual_query
            + " "
            + _operation_step_keywords(step_index)
        )
        evidence = _operation_step_evidence_lookup(
            query_text=retrieval_query,
            step_index=step_index,
            limit=max(4, min(req.top_k, 6)),
        )
        result = {
            "confidence": evidence[0]["scores"]["final"] if evidence else 0.0,
            "latency_ms": int((perf_counter() - request_started_at) * 1000),
            "retrieval_event_id": None,
            "evidence": evidence,
            "diagnostics": {
                "pipeline": "operation_step_lookup",
                "step_index": step_index,
                "candidates": len(evidence),
            },
        }
    else:
        result = retriever.query(
            query_text=retrieval_query,
            language=req.language,
            role=req.role,
            user_id=req.user_id,
            top_k=max(4, req.top_k),
            revision_id=None,
        )
        evidence = result["evidence"]

    if direct_answer is not None:
        answer = direct_answer
        response_evidence = direct_evidence
    elif guide_mode == "clarify":
        answer = _build_operation_clarifier(
            query=req.query,
            language=req.language,
            evidence=evidence,
        )
        response_evidence = evidence[:3]
    elif state.get("phase") == "running":
        answer = _build_operation_run_checkpoint(
            evidence=evidence,
            language=req.language,
            step_index=step_index,
        )
        response_evidence = evidence[:5]
    else:
        answer = await _generate_grounded_answer(
            "Learning mode: explain the relevant procedure simply and clearly. " + req.query,
            req.language,
            evidence,
            history=history,
            chat_scope=normalized_scope,
        )
        response_evidence = evidence

    retrieval_event_id = result.get("retrieval_event_id") or result.get("event_id")
    if req.user_id:
        serialized_citations = [QueryEvidence(**ev).model_dump() for ev in response_evidence]
        with engine.begin() as conn:
            _get_user(conn, req.user_id)
            if conversation_id:
                _get_chat_conversation(
                    conn,
                    conversation_id,
                    req.user_id,
                    chat_scope=normalized_scope,
                )
                _merge_conversation_metadata(
                    conn,
                    conversation_id,
                    {"operation_state": state},
                    chat_scope=normalized_scope,
                )
            else:
                conversation = _create_chat_conversation(
                    conn,
                    user_id=req.user_id,
                    language=req.language,
                    title=_conversation_title_from_query(req.query),
                    chat_scope=normalized_scope,
                    metadata={
                        "scope": normalized_scope,
                        "pipeline": "operation_guide",
                        "operation_state": state,
                    },
                )
                conversation_id = conversation["id"]

            _append_chat_message(
                conn,
                conversation_id=conversation_id,
                role="user",
                content=req.query,
                language=req.language,
                query_text=retrieval_query,
                response_mode="operation",
                chat_scope=normalized_scope,
            )
            _append_chat_message(
                conn,
                conversation_id=conversation_id,
                role="assistant",
                content=answer,
                language=req.language,
                citations=serialized_citations,
                query_text=retrieval_query,
                retrieval_event_id=retrieval_event_id,
                response_mode="operation",
                chat_scope=normalized_scope,
            )
            sop_code, _ = _extract_run_source(response_evidence)
            run_record_id = _upsert_operation_run_record(
                conn,
                user_id=req.user_id,
                conversation_id=conversation_id,
                state=state,
                evidence=response_evidence,
            )
            if state.get("phase") == "supervisor_handoff":
                handoff_id = _create_supervisor_handoff(
                    conn,
                    user_id=req.user_id,
                    conversation_id=conversation_id,
                    run_record_id=run_record_id,
                    state=state,
                    reason=req.query,
                )
                if handoff_id:
                    state["handoff_id"] = handoff_id
                    _merge_conversation_metadata(
                        conn,
                        conversation_id,
                        {"operation_state": state},
                        chat_scope=normalized_scope,
                    )
            _upsert_worker_memory(
                conn,
                user_id=req.user_id,
                language=req.language,
                equipment=state.get("equipment"),
                sop_code=sop_code,
                skill_tags=[
                    "operation guide",
                    state.get("equipment"),
                    state.get("task"),
                    state.get("phase"),
                    sop_code,
                ],
                risk_flags=["supervisor handoff"] if state.get("phase") == "supervisor_handoff" else [],
            )
            _record_worker_activity(
                conn,
                user_id=req.user_id,
                event_type="operation_guide_step",
                severity="medium" if state.get("phase") == "supervisor_handoff" else "info",
                title=f"{_guided_state_label(state)} - {state.get('equipment') or 'equipment'}",
                details={
                    "conversation_id": conversation_id,
                    "run_record_id": run_record_id,
                    "phase": state.get("phase"),
                    "step_index": state.get("step_index"),
                    "equipment": state.get("equipment"),
                    "task": state.get("task"),
                    "sop_code": sop_code,
                    "evidence": [
                        {
                            "document_code": item.get("document_code"),
                            "page_start": item.get("page_start"),
                            "citation_label": item.get("citation_label"),
                        }
                        for item in response_evidence[:5]
                    ],
                },
                event_source="operation_guide",
            )

    total_latency_ms = int((perf_counter() - request_started_at) * 1000)
    diagnostics = dict(result["diagnostics"])
    diagnostics["pipeline"] = "operation_guide"
    diagnostics["guide_mode"] = guide_mode
    diagnostics["state_phase"] = state.get("phase")
    diagnostics["guided_step_index"] = step_index
    diagnostics["total_latency_ms"] = total_latency_ms

    return OperationGuideResponse(
        answer=answer,
        mode=guide_mode,
        next_actions=_guided_next_actions_for_state(state, req.language),
        state=state,
        state_label=_guided_state_label(state),
        step_index=int(state.get("step_index") or step_index) if state else step_index,
        requires_supervisor=bool(state.get("requires_supervisor") or state.get("phase") == "supervisor_handoff"),
        completion_record_id=state.get("completion_record_id"),
        confidence=float(result["confidence"]),
        latency_ms=total_latency_ms,
        retrieval_event_id=retrieval_event_id,
        conversation_id=conversation_id,
        evidence=[QueryEvidence(**ev) for ev in response_evidence],
        diagnostics=diagnostics,
    )


@app.post("/api/query", response_model=QueryResponse)
async def grounded_query(req: QueryRequest):
    request_started_at = perf_counter()
    if req.conversation_id and not req.user_id:
        raise HTTPException(status_code=400, detail="user_id is required with conversation_id")

    normalized_scope = _normalize_chat_scope(req.chat_scope)
    conversation_metadata: dict[str, Any] = {}
    if normalized_scope == "reader" and req.revision_id:
        conversation_metadata["revision_id"] = req.revision_id
    history: list[dict[str, str]] = []
    conversation_id = req.conversation_id

    if req.user_id:
        with engine.connect() as conn:
            _get_user(conn, req.user_id)
            if conversation_id:
                conversation_scope = _detect_chat_scope_for_conversation(
                    conn, conversation_id, req.user_id
                )
                if not conversation_scope:
                    raise HTTPException(status_code=404, detail="Conversation not found")
                if conversation_scope != normalized_scope:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "Conversation scope mismatch. "
                            f"Expected '{normalized_scope}', found '{conversation_scope}'."
                        ),
                    )
                conversation = _get_chat_conversation(
                    conn,
                    conversation_id,
                    req.user_id,
                    chat_scope=normalized_scope,
                )
                if (
                    normalized_scope == "reader"
                    and req.revision_id
                    and conversation.get("revision_id")
                    and conversation.get("revision_id") != req.revision_id
                ):
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "Reader conversation revision mismatch. "
                            "Start a new reader conversation for this document."
                        ),
                    )
                history = _history_from_messages(
                    _get_chat_messages(conn, conversation_id, chat_scope=normalized_scope)
                )

    guardrail_decision = evaluate_guardrail(req.query)
    if guardrail_decision.blocked:
        answer = guardrail_decision.user_message
        if req.user_id:
            with engine.begin() as conn:
                _get_user(conn, req.user_id)
                if conversation_id:
                    _get_chat_conversation(
                        conn,
                        conversation_id,
                        req.user_id,
                        chat_scope=normalized_scope,
                    )
                else:
                    conversation = _create_chat_conversation(
                        conn,
                        user_id=req.user_id,
                        language=req.language,
                        title=_conversation_title_from_query(req.query),
                        chat_scope=normalized_scope,
                        metadata=conversation_metadata,
                    )
                    conversation_id = conversation["id"]

                _append_chat_message(
                    conn,
                    conversation_id=conversation_id,
                    role="user",
                    content=req.query,
                    language=req.language,
                    response_mode="text",
                    chat_scope=normalized_scope,
                )
                _append_chat_message(
                    conn,
                    conversation_id=conversation_id,
                    role="assistant",
                    content=answer,
                    language=req.language,
                    response_mode="text",
                    chat_scope=normalized_scope,
                )
                _notify_guardrail_violation(
                    conn,
                    user_id=req.user_id,
                    query_text=req.query,
                    decision=guardrail_decision,
                    channel="text",
                    conversation_id=conversation_id,
                )
        else:
            with engine.begin() as conn:
                _notify_guardrail_violation(
                    conn,
                    user_id=None,
                    query_text=req.query,
                    decision=guardrail_decision,
                    channel="text",
                    conversation_id=None,
                )

        return QueryResponse(
            answer=answer,
            confidence=0.0,
            latency_ms=0,
            retrieval_event_id=None,
            conversation_id=conversation_id,
            evidence=[],
            diagnostics={"guardrail": _guardrail_diagnostics(guardrail_decision)},
        )

    contextual_query = _build_contextual_query(req.query, history)
    rewritten_query = contextual_query
    rewrite_result = None
    if _should_use_query_rewrite(
        req.query,
        history,
        chat_scope=normalized_scope,
    ):
        rewrite_result = await _run_blocking_with_timeout(
            DSPY_REWRITE_TIMEOUT_SECONDS,
            rewrite_query_with_dspy,
            contextual_query,
            language=req.language,
            role=req.role or "operator",
            history=history,
        )
    if rewrite_result and rewrite_result.get("rewritten_query"):
        rewritten_query = rewrite_result["rewritten_query"]

    effective_top_k = max(3, req.top_k)
    if normalized_scope == "reader" and _is_summary_style_query(req.query):
        effective_top_k = max(effective_top_k, 12)
    elif normalized_scope == "reader":
        effective_top_k = min(effective_top_k, 5)

    result = retriever.query(
        query_text=rewritten_query,
        language=req.language,
        role=req.role,
        user_id=req.user_id,
        top_k=effective_top_k,
        revision_id=req.revision_id,
    )
    evidence = result["evidence"]
    clarification_answer = _build_document_clarification_answer(
        req.query,
        evidence,
        req.language,
        normalized_scope,
    )
    if clarification_answer:
        answer = clarification_answer
        response_evidence: list[dict[str, Any]] = []
    else:
        answer = await _generate_grounded_answer(
            req.query,
            req.language,
            evidence,
            history=history,
            chat_scope=normalized_scope,
        )
        response_evidence = evidence
    retrieval_event_id = result.get("retrieval_event_id") or result.get("event_id")

    if req.user_id:
        serialized_citations = [QueryEvidence(**ev).model_dump() for ev in response_evidence]
        with engine.begin() as conn:
            _get_user(conn, req.user_id)
            if conversation_id:
                _get_chat_conversation(
                    conn,
                    conversation_id,
                    req.user_id,
                    chat_scope=normalized_scope,
                )
            else:
                conversation = _create_chat_conversation(
                    conn,
                    user_id=req.user_id,
                    language=req.language,
                    title=_conversation_title_from_query(req.query),
                    chat_scope=normalized_scope,
                    metadata=conversation_metadata,
                )
                conversation_id = conversation["id"]

            _append_chat_message(
                conn,
                conversation_id=conversation_id,
                role="user",
                content=req.query,
                language=req.language,
                query_text=rewritten_query,
                response_mode="text",
                chat_scope=normalized_scope,
            )
            _append_chat_message(
                conn,
                conversation_id=conversation_id,
                role="assistant",
                content=answer,
                language=req.language,
                citations=serialized_citations,
                query_text=rewritten_query,
                retrieval_event_id=retrieval_event_id,
                response_mode="text",
                chat_scope=normalized_scope,
            )

    total_latency_ms = int((perf_counter() - request_started_at) * 1000)
    diagnostics = dict(result["diagnostics"])
    diagnostics["retrieval_latency_ms"] = int(result["latency_ms"])
    diagnostics["total_latency_ms"] = total_latency_ms
    diagnostics["source_panel_policy"] = (
        "clarification_required" if clarification_answer else "answer_grounded"
    )

    return QueryResponse(
        answer=answer,
        confidence=float(result["confidence"]),
        latency_ms=total_latency_ms,
        retrieval_event_id=retrieval_event_id,
        conversation_id=conversation_id,
        evidence=[QueryEvidence(**ev) for ev in response_evidence],
        diagnostics=diagnostics,
    )


@app.post("/api/query/stream")
async def grounded_query_stream(req: QueryRequest):
    async def event_stream():
        try:
            request_started_at = perf_counter()
            normalized_scope = _normalize_chat_scope(req.chat_scope)
            if req.conversation_id and not req.user_id:
                yield _sse_event("error", {"message": "user_id is required with conversation_id", "status": 400})
                return

            initial_status = (
                "Analyzing your document"
                if normalized_scope == "reader"
                else "Verifying your request"
            )
            yield _sse_event("status", {"message": initial_status})
            await asyncio.sleep(0.18 if normalized_scope == "reader" else 0)

            conversation_metadata: dict[str, Any] = {}
            if normalized_scope == "reader" and req.revision_id:
                conversation_metadata["revision_id"] = req.revision_id
            history: list[dict[str, str]] = []
            conversation_id = req.conversation_id

            if req.user_id:
                with engine.connect() as conn:
                    _get_user(conn, req.user_id)
                    if conversation_id:
                        conversation_scope = _detect_chat_scope_for_conversation(
                            conn, conversation_id, req.user_id
                        )
                        if not conversation_scope:
                            yield _sse_event("error", {"message": "Conversation not found", "status": 404})
                            return
                        if conversation_scope != normalized_scope:
                            yield _sse_event(
                                "error",
                                {
                                    "message": (
                                        "Conversation scope mismatch. "
                                        f"Expected '{normalized_scope}', found '{conversation_scope}'."
                                    ),
                                    "status": 409,
                                },
                            )
                            return
                        conversation = _get_chat_conversation(
                            conn,
                            conversation_id,
                            req.user_id,
                            chat_scope=normalized_scope,
                        )
                        if (
                            normalized_scope == "reader"
                            and req.revision_id
                            and conversation.get("revision_id")
                            and conversation.get("revision_id") != req.revision_id
                        ):
                            yield _sse_event(
                                "error",
                                {
                                    "message": "Reader conversation revision mismatch. Start a new reader conversation for this document.",
                                    "status": 409,
                                },
                            )
                            return
                        history = _history_from_messages(
                            _get_chat_messages(conn, conversation_id, chat_scope=normalized_scope)
                        )

            guardrail_decision = evaluate_guardrail(req.query)
            if guardrail_decision.blocked:
                response = await grounded_query(req)
                for chunk in _stream_text_chunks(response.answer):
                    yield _sse_event("answer_delta", {"text": chunk})
                    await asyncio.sleep(0.012)
                yield _sse_event("final", response.model_dump())
                return

            yield _sse_event(
                "status",
                {
                    "message": (
                        "Scanning relevant sections"
                        if normalized_scope == "reader"
                        else "Searching approved sources"
                    )
                },
            )
            await asyncio.sleep(0.18 if normalized_scope == "reader" else 0)

            contextual_query = _build_contextual_query(req.query, history)
            rewritten_query = contextual_query
            rewrite_result = None
            if _should_use_query_rewrite(
                req.query,
                history,
                chat_scope=normalized_scope,
            ):
                rewrite_result = await _run_blocking_with_timeout(
                    DSPY_REWRITE_TIMEOUT_SECONDS,
                    rewrite_query_with_dspy,
                    contextual_query,
                    language=req.language,
                    role=req.role or "operator",
                    history=history,
                )
            if rewrite_result and rewrite_result.get("rewritten_query"):
                rewritten_query = rewrite_result["rewritten_query"]

            effective_top_k = max(3, req.top_k)
            if normalized_scope == "reader" and _is_summary_style_query(req.query):
                effective_top_k = max(effective_top_k, 12)
            elif normalized_scope == "reader":
                effective_top_k = min(effective_top_k, 5)

            yield _sse_event(
                "status",
                {
                    "message": (
                        "Cross-referencing with document evidence"
                        if normalized_scope == "reader"
                        else "Selecting the most relevant evidence"
                    )
                },
            )
            await asyncio.sleep(0.18 if normalized_scope == "reader" else 0)
            result = retriever.query(
                query_text=rewritten_query,
                language=req.language,
                role=req.role,
                user_id=req.user_id,
                top_k=effective_top_k,
                revision_id=req.revision_id,
            )
            evidence = result["evidence"]
            if normalized_scope == "reader":
                yield _sse_event(
                    "status",
                    {
                        "message": _source_status_from_evidence(
                            evidence,
                            fallback="Reviewing evidence from this document",
                        )
                    },
                )
                await asyncio.sleep(0.18)
            clarification_answer = _build_document_clarification_answer(
                req.query,
                evidence,
                req.language,
                normalized_scope,
            )

            answer = ""
            response_evidence: list[dict[str, Any]]
            can_stream_primary = (
                normalized_scope in ("general", "reader", "guided")
                and not clarification_answer
                and bool(evidence)
                and settings.has_primary_llm_credentials
                and not _should_prefer_extractive_answer(req.query, evidence)
            )

            if clarification_answer:
                answer = clarification_answer
                response_evidence = []
                yield _sse_event(
                    "status",
                    {
                        "message": (
                            "One quick clarification needed"
                            if normalized_scope == "reader"
                            else "One quick clarification needed"
                        )
                    },
                )
                await asyncio.sleep(0.12 if normalized_scope == "reader" else 0)
                clarification_chunk_size = 14 if normalized_scope == "reader" else 24
                clarification_delay = 0.045 if normalized_scope == "reader" else 0.012
                for chunk in _stream_text_chunks(answer, max_chars=clarification_chunk_size):
                    yield _sse_event("answer_delta", {"text": chunk})
                    await asyncio.sleep(clarification_delay)
            elif can_stream_primary:
                yield _sse_event("status", {"message": "Generating your answer"})
                system_prompt, user_prompt, max_tokens = _build_grounded_chat_prompt(
                    req.query,
                    req.language,
                    evidence,
                    history=history,
                    chat_scope=normalized_scope,
                )
                answer_parts: list[str] = []
                try:
                    async for token in _stream_primary_chat_model(
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        max_tokens=max_tokens,
                    ):
                        answer_parts.append(token)
                        yield _sse_event("answer_delta", {"text": token})
                    answer = "".join(answer_parts).strip()
                except Exception:
                    answer = ""
                if not answer:
                    answer = await _generate_grounded_answer(
                        req.query,
                        req.language,
                        evidence,
                        history=history,
                        chat_scope=normalized_scope,
                    )
                    for chunk in _stream_text_chunks(answer):
                        yield _sse_event("answer_delta", {"text": chunk})
                        await asyncio.sleep(0.012)
                response_evidence = evidence
            else:
                yield _sse_event(
                    "status",
                    {
                        "message": (
                            "Composing your answer from the evidence"
                            if normalized_scope == "reader"
                            else "Building a grounded response"
                        )
                    },
                )
                await asyncio.sleep(0.15 if normalized_scope == "reader" else 0)
                answer = await _generate_grounded_answer(
                    req.query,
                    req.language,
                    evidence,
                    history=history,
                    chat_scope=normalized_scope,
                )
                response_evidence = evidence
                stream_chunk_size = 12 if normalized_scope == "reader" else 24
                stream_delay = 0.045 if normalized_scope == "reader" else 0.012
                for chunk in _stream_text_chunks(answer, max_chars=stream_chunk_size):
                    yield _sse_event("answer_delta", {"text": chunk})
                    await asyncio.sleep(stream_delay)

            retrieval_event_id = result.get("retrieval_event_id") or result.get("event_id")
            if req.user_id:
                serialized_citations = [QueryEvidence(**ev).model_dump() for ev in response_evidence]
                with engine.begin() as conn:
                    _get_user(conn, req.user_id)
                    if conversation_id:
                        _get_chat_conversation(
                            conn,
                            conversation_id,
                            req.user_id,
                            chat_scope=normalized_scope,
                        )
                    else:
                        conversation = _create_chat_conversation(
                            conn,
                            user_id=req.user_id,
                            language=req.language,
                            title=_conversation_title_from_query(req.query),
                            chat_scope=normalized_scope,
                            metadata=conversation_metadata,
                        )
                        conversation_id = conversation["id"]

                    _append_chat_message(
                        conn,
                        conversation_id=conversation_id,
                        role="user",
                        content=req.query,
                        language=req.language,
                        query_text=rewritten_query,
                        response_mode="text",
                        chat_scope=normalized_scope,
                    )
                    _append_chat_message(
                        conn,
                        conversation_id=conversation_id,
                        role="assistant",
                        content=answer,
                        language=req.language,
                        citations=serialized_citations,
                        query_text=rewritten_query,
                        retrieval_event_id=retrieval_event_id,
                        response_mode="text",
                        chat_scope=normalized_scope,
                    )

            total_latency_ms = int((perf_counter() - request_started_at) * 1000)
            diagnostics = dict(result["diagnostics"])
            diagnostics["retrieval_latency_ms"] = int(result["latency_ms"])
            diagnostics["total_latency_ms"] = total_latency_ms
            diagnostics["streaming"] = "primary_llm_tokens" if can_stream_primary else "server_chunks"
            diagnostics["source_panel_policy"] = (
                "clarification_required" if clarification_answer else "answer_grounded"
            )
            response = QueryResponse(
                answer=answer,
                confidence=float(result["confidence"]),
                latency_ms=total_latency_ms,
                retrieval_event_id=retrieval_event_id,
                conversation_id=conversation_id,
                evidence=[QueryEvidence(**ev) for ev in response_evidence],
                diagnostics=diagnostics,
            )
            yield _sse_event(
                "status",
                {
                    "message": (
                        f"Answer ready in {max(1, int(response.latency_ms / 1000))}s"
                        if response.latency_ms
                        else "Answer ready"
                    )
                },
            )
            yield _sse_event("final", response.model_dump())
        except HTTPException as exc:
            yield _sse_event("error", {"message": exc.detail, "status": exc.status_code})
        except Exception:
            yield _sse_event("error", {"message": "Could not complete the query."})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
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


GRAPH_NODE_PRIORITY = (
    "Platform",
    "Document",
    "DocumentRevision",
    "DocumentChunk",
    "TrainingModule",
    "TrainingStep",
    "Assessment",
    "User",
    "Department",
)

GRAPH_LABEL_ALLOWLIST = set(GRAPH_NODE_PRIORITY)


def _graph_node_type(labels: list[str] | tuple[str, ...] | None) -> str:
    candidates = list(labels or [])
    for label in GRAPH_NODE_PRIORITY:
        if label in candidates:
            return label
    return candidates[0] if candidates else "Node"


def _graph_node_label(node_type: str, properties: dict[str, Any], fallback_id: str) -> str:
    for key in ("title", "name", "code", "full_name", "revision_label", "id"):
        value = properties.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:72]
    return f"{node_type} {fallback_id[:8]}"


def _graph_node_payload(*, node_id: str, labels: list[str], properties: dict[str, Any]) -> dict[str, Any]:
    node_type = _graph_node_type(labels)
    safe_props = {
        key: value
        for key, value in properties.items()
        if isinstance(value, (str, int, float, bool)) or value is None
    }
    return {
        "id": node_id,
        "type": node_type,
        "label": _graph_node_label(node_type, safe_props, node_id),
        "properties": safe_props,
    }


def _graph_summary(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    node_types: dict[str, int] = {}
    edge_types: dict[str, int] = {}
    degree: dict[str, int] = {}

    for node in nodes:
        node_type = str(node.get("type") or "Node")
        node_types[node_type] = node_types.get(node_type, 0) + 1
        degree[str(node.get("id"))] = 0

    for edge in edges:
        edge_type = str(edge.get("type") or "RELATED_TO")
        edge_types[edge_type] = edge_types.get(edge_type, 0) + 1
        source = str(edge.get("source"))
        target = str(edge.get("target"))
        degree[source] = degree.get(source, 0) + 1
        degree[target] = degree.get(target, 0) + 1

    focus_node_id = next(
        (str(node.get("id")) for node in nodes if str(node.get("type")) == "Platform"),
        None,
    )
    if not focus_node_id and nodes:
        focus_node_id = str(
            max(
                nodes,
                key=lambda node: degree.get(str(node.get("id")), 0),
            ).get("id")
        )

    return {
        "node_count": len(nodes),
        "edge_count": len(edges),
        "node_types": dict(sorted(node_types.items(), key=lambda item: (-item[1], item[0]))),
        "edge_types": dict(sorted(edge_types.items(), key=lambda item: (-item[1], item[0]))),
        "focus_node_id": focus_node_id,
    }


def _load_knowledge_graph_from_neo4j(*, max_nodes: int, max_edges: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    driver = get_driver()
    label_allowlist = list(GRAPH_LABEL_ALLOWLIST)
    node_map: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []
    edge_ids: set[str] = set()

    def upsert_node(*, element_id: str, labels: list[str] | tuple[str, ...], properties: dict[str, Any]) -> str:
        props = dict(properties or {})
        node_id = str(props.get("id") or element_id)
        if node_id not in node_map and len(node_map) < max_nodes:
            node_map[node_id] = _graph_node_payload(
                node_id=node_id,
                labels=list(labels or []),
                properties=props,
            )
        return node_id

    with driver.session(database=settings.NEO4J_DATABASE) as session:
        edge_rows = session.run(
            """
            MATCH (a)-[r]->(b)
            WHERE any(lbl IN labels(a) WHERE lbl IN $labels)
              AND any(lbl IN labels(b) WHERE lbl IN $labels)
            RETURN
              elementId(a) AS source_element_id,
              labels(a) AS source_labels,
              properties(a) AS source_props,
              elementId(b) AS target_element_id,
              labels(b) AS target_labels,
              properties(b) AS target_props,
              elementId(r) AS rel_element_id,
              type(r) AS rel_type,
              properties(r) AS rel_props
            LIMIT $max_edges
            """,
            labels=label_allowlist,
            max_edges=max_edges,
        ).data()

        for row in edge_rows:
            source = upsert_node(
                element_id=str(row.get("source_element_id") or ""),
                labels=row.get("source_labels") or [],
                properties=row.get("source_props") or {},
            )
            target = upsert_node(
                element_id=str(row.get("target_element_id") or ""),
                labels=row.get("target_labels") or [],
                properties=row.get("target_props") or {},
            )
            rel_type = str(row.get("rel_type") or "RELATED_TO")
            rel_id = str(row.get("rel_element_id") or f"{source}:{rel_type}:{target}")
            if rel_id in edge_ids:
                continue
            edge_ids.add(rel_id)
            if source in node_map and target in node_map and len(edges) < max_edges:
                rel_props = dict(row.get("rel_props") or {})
                edges.append(
                    {
                        "id": rel_id,
                        "source": source,
                        "target": target,
                        "type": rel_type,
                        "properties": {
                            key: value
                            for key, value in rel_props.items()
                            if isinstance(value, (str, int, float, bool)) or value is None
                        },
                    }
                )

        if len(node_map) < max_nodes:
            node_rows = session.run(
                """
                MATCH (n)
                WHERE any(lbl IN labels(n) WHERE lbl IN $labels)
                RETURN elementId(n) AS element_id, labels(n) AS labels, properties(n) AS props
                LIMIT $max_nodes
                """,
                labels=label_allowlist,
                max_nodes=max_nodes,
            ).data()
            for row in node_rows:
                upsert_node(
                    element_id=str(row.get("element_id") or ""),
                    labels=row.get("labels") or [],
                    properties=row.get("props") or {},
                )

    nodes = list(node_map.values())[:max_nodes]
    node_ids = {str(node.get("id")) for node in nodes}
    filtered_edges = [
        edge
        for edge in edges
        if str(edge.get("source")) in node_ids and str(edge.get("target")) in node_ids
    ][:max_edges]
    return nodes, filtered_edges


def _load_knowledge_graph_from_postgres(
    conn,
    *,
    max_nodes: int,
    max_edges: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    node_map: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []
    edge_ids: set[str] = set()

    def add_node(*, node_id: str, node_type: str, label: str, properties: dict[str, Any] | None = None) -> str:
        if node_id in node_map:
            return node_id
        if len(node_map) >= max_nodes:
            return node_id
        node_map[node_id] = {
            "id": node_id,
            "type": node_type,
            "label": label[:72],
            "properties": properties or {},
        }
        return node_id

    def add_edge(*, source: str, target: str, edge_type: str, properties: dict[str, Any] | None = None):
        if len(edges) >= max_edges:
            return
        if source not in node_map or target not in node_map:
            return
        edge_id = f"{source}:{edge_type}:{target}"
        if edge_id in edge_ids:
            return
        edge_ids.add(edge_id)
        edges.append(
            {
                "id": edge_id,
                "source": source,
                "target": target,
                "type": edge_type,
                "properties": properties or {},
            }
        )

    platform_id = "platform:jubilant-ingrevia"
    add_node(
        node_id=platform_id,
        node_type="Platform",
        label="Jubilant Ingrevia Knowledge Fabric",
        properties={"name": "Jubilant Ingrevia Knowledge Fabric"},
    )

    doc_rows = conn.execute(
        text(
            """
            SELECT
                d.id::text AS document_id,
                d.code AS document_code,
                d.title AS document_title,
                dr.id::text AS revision_id,
                dr.revision_label
            FROM documents d
            JOIN document_revisions dr ON dr.document_id = d.id
            WHERE dr.is_latest_approved = true
            ORDER BY d.updated_at DESC NULLS LAST, d.code
            LIMIT :limit
            """
        ),
        {"limit": max_nodes},
    ).mappings()

    for row in doc_rows:
        document_id = str(row["document_id"])
        revision_id = str(row["revision_id"])
        document_code = str(row.get("document_code") or "")
        document_title = str(row.get("document_title") or document_code or "Document")
        revision_label = str(row.get("revision_label") or "Revision")

        add_node(
            node_id=document_id,
            node_type="Document",
            label=f"{document_code} {document_title}".strip(),
            properties={
                "id": document_id,
                "code": document_code,
                "title": document_title,
            },
        )
        add_node(
            node_id=revision_id,
            node_type="DocumentRevision",
            label=f"{document_code} {revision_label}".strip(),
            properties={
                "id": revision_id,
                "revision_label": revision_label,
                "document_id": document_id,
                "document_code": document_code,
            },
        )
        add_edge(source=platform_id, target=document_id, edge_type="HAS_DOCUMENT")
        add_edge(source=document_id, target=revision_id, edge_type="HAS_REVISION")

    module_rows = conn.execute(
        text(
            """
            SELECT
                tm.id::text AS module_id,
                tm.title,
                tm.source_document_id::text AS source_document_id,
                tm.source_revision_id::text AS source_revision_id
            FROM training_modules tm
            ORDER BY tm.updated_at DESC NULLS LAST, tm.created_at DESC
            LIMIT :limit
            """
        ),
        {"limit": max_nodes},
    ).mappings()

    for row in module_rows:
        module_id = str(row["module_id"])
        source_document_id = row.get("source_document_id")
        source_revision_id = row.get("source_revision_id")
        module_title = str(row.get("title") or "Training Module")
        add_node(
            node_id=module_id,
            node_type="TrainingModule",
            label=module_title,
            properties={
                "id": module_id,
                "title": module_title,
                "source_document_id": source_document_id,
                "source_revision_id": source_revision_id,
            },
        )
        if source_revision_id and str(source_revision_id) in node_map:
            add_edge(
                source=str(source_revision_id),
                target=module_id,
                edge_type="DERIVES_TO_TRAINING",
            )
        elif source_document_id and str(source_document_id) in node_map:
            add_edge(
                source=str(source_document_id),
                target=module_id,
                edge_type="DERIVES_TO_TRAINING",
            )
        else:
            add_edge(source=platform_id, target=module_id, edge_type="HAS_MODULE")

    assessment_rows = conn.execute(
        text(
            """
            SELECT
                a.id::text AS assessment_id,
                a.title AS assessment_title,
                a.module_id::text AS module_id
            FROM assessments a
            ORDER BY a.created_at DESC
            LIMIT :limit
            """
        ),
        {"limit": max_nodes},
    ).mappings()

    for row in assessment_rows:
        assessment_id = str(row["assessment_id"])
        module_id = str(row["module_id"])
        assessment_title = str(row.get("assessment_title") or "Assessment")
        add_node(
            node_id=assessment_id,
            node_type="Assessment",
            label=assessment_title,
            properties={
                "id": assessment_id,
                "title": assessment_title,
                "module_id": module_id,
            },
        )
        if module_id in node_map:
            add_edge(source=assessment_id, target=module_id, edge_type="TESTS_MODULE")

    assignment_rows = conn.execute(
        text(
            """
            SELECT
                ta.user_id::text AS user_id,
                u.full_name,
                u.role,
                d.name AS department_name,
                ta.module_id::text AS module_id,
                ta.status
            FROM training_assignments ta
            JOIN users u ON u.id = ta.user_id
            LEFT JOIN departments d ON d.id = u.department_id
            ORDER BY ta.updated_at DESC NULLS LAST, ta.created_at DESC
            LIMIT :limit
            """
        ),
        {"limit": max_edges},
    ).mappings()

    for row in assignment_rows:
        user_id = str(row["user_id"])
        module_id = str(row["module_id"])
        full_name = str(row.get("full_name") or "User")
        role = str(row.get("role") or "operator")
        department_name = row.get("department_name")
        add_node(
            node_id=user_id,
            node_type="User",
            label=full_name,
            properties={
                "id": user_id,
                "full_name": full_name,
                "role": role,
                "department": department_name,
            },
        )
        if module_id in node_map:
            add_edge(
                source=module_id,
                target=user_id,
                edge_type="ASSIGNED_TO",
                properties={"status": row.get("status")},
            )

    return list(node_map.values())[:max_nodes], edges[:max_edges]


@app.get("/api/retrieval/status")
async def retrieval_status():
    pg_counts = {}
    with engine.connect() as conn:
        for label, sql in {
            "documents": "select count(*) from documents",
            "revisions": "select count(*) from document_revisions",
            "pages": "select count(*) from extracted_pages",
            "page_vl_embeddings": "select count(*) from extracted_pages where vl_embedding is not null",
            "blocks": "select count(*) from extracted_blocks",
            "chunks": "select count(*) from document_chunks",
            "embedded_chunks": "select count(*) from document_chunks where embedding is not null",
            "retrieval_events": "select count(*) from retrieval_events",
        }.items():
            try:
                pg_counts[label] = int(conn.execute(text(sql)).scalar_one())
            except Exception:
                pg_counts[label] = 0

    graph_status: dict[str, Any]
    overall_status = "ok"
    try:
        graph = check_neo4j_connection()
        graph_status = {
            "status": graph.get("status", "ok"),
            "database": graph.get("database"),
            "server_time": graph.get("server_time"),
            "uri": graph.get("uri"),
            "error": None,
        }
    except Exception as exc:
        overall_status = "degraded"
        graph_status = {
            "status": "unavailable",
            "database": settings.NEO4J_DATABASE,
            "server_time": None,
            "uri": settings.NEO4J_URI,
            "error": str(exc),
        }

    return {
        "status": overall_status,
        "postgres": pg_counts,
        "neo4j": graph_status,
        "primary_llm_provider": settings.PRIMARY_LLM_PROVIDER,
        "primary_llm_model": settings.PRIMARY_LLM_MODEL,
        "primary_llm_ready": settings.has_primary_llm_credentials,
        "groq_fallback_ready": bool(settings.GROQ_API_KEY),
        "embedding_provider": settings.EMBEDDING_PROVIDER,
        "embedding_model": settings.EMBEDDING_MODEL,
        "nvidia_embedding_model": settings.NVIDIA_EMBED_MODEL,
        "nvidia_embedding_vl_model": settings.NVIDIA_EMBED_VL_MODEL,
        "rerank_provider": settings.RETRIEVAL_RERANKER_PROVIDER,
        "nvidia_rerank_model": settings.NVIDIA_RERANK_MODEL,
        "nvidia_rerank_vl_model": settings.NVIDIA_RERANK_VL_MODEL,
        "content_safety_provider": settings.CONTENT_SAFETY_PROVIDER,
        "nvidia_content_safety_model": settings.NVIDIA_CONTENT_SAFETY_MODEL,
        "ocr_provider": settings.SOP_OCR_PROVIDER,
        "nvidia_ocr_model": settings.NVIDIA_OCR_MODEL,
    }


@app.get("/api/admin/graph/overview")
async def admin_graph_overview(
    user_id: str,
    max_nodes: int = 180,
    max_edges: int = 360,
):
    bounded_nodes = max(40, min(max_nodes, 240))
    bounded_edges = max(80, min(max_edges, 640))

    with engine.connect() as conn:
        user = _get_user(conn, user_id)
        _require_admin(user)
        fallback_nodes, fallback_edges = _load_knowledge_graph_from_postgres(
            conn,
            max_nodes=bounded_nodes,
            max_edges=bounded_edges,
        )

    diagnostics: dict[str, Any] = {}
    response_status = "degraded"
    graph_source = "postgres_fallback"
    nodes = fallback_nodes
    edges = fallback_edges

    if settings.has_graph_credentials:
        try:
            neo_nodes, neo_edges = _load_knowledge_graph_from_neo4j(
                max_nodes=bounded_nodes,
                max_edges=bounded_edges,
            )
            if neo_nodes:
                nodes = neo_nodes
                edges = neo_edges
                response_status = "ok"
                graph_source = "neo4j"
            else:
                diagnostics["neo4j"] = "empty_graph"
        except Exception as exc:
            diagnostics["neo4j_error"] = str(exc)
    else:
        diagnostics["neo4j"] = "credentials_missing"

    summary = _graph_summary(nodes, edges)
    if not nodes:
        response_status = "empty"
    elif graph_source == "postgres_fallback" and not diagnostics:
        diagnostics["neo4j"] = "fallback_used"

    return {
        "status": response_status,
        "source": graph_source,
        "summary": summary,
        "graph": {
            "nodes": nodes,
            "edges": edges,
            "focus_node_id": summary.get("focus_node_id"),
        },
        "diagnostics": diagnostics,
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
                    d.document_type,
                    d.department_name AS department,
                    dr.id::text AS revision_id,
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
        page_row = conn.execute(
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

        if not page_row:
            chunk = conn.execute(
                text(
                    """
                    SELECT content, page_start, citation_label
                    FROM document_chunks
                    WHERE revision_id = CAST(:revision_id AS uuid)
                      AND :page_number BETWEEN COALESCE(page_start, :page_number) AND COALESCE(page_end, :page_number)
                    LIMIT 1
                    """
                ),
                {"revision_id": revision_id, "page_number": page_number},
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

        page = dict(page_row)
        if page.get("image_path"):
            page["image_url"] = f"/api/documents/{revision_id}/page/{page_number}/image"

        blocks = _load_page_blocks(conn, page["page_id"])
    return {"page": page, "blocks": blocks}


@app.get("/api/chunks/{chunk_id}/content")
async def chunk_content_view(chunk_id: str):
    with engine.connect() as conn:
        chunk = conn.execute(
            text(
                """
                SELECT dc.id::text, dc.content, dc.page_start, dc.section_title,
                       dc.citation_label, dc.bbox_x0, dc.bbox_y0, dc.bbox_x1, dc.bbox_y1,
                       dc.revision_id::text AS revision_id,
                       d.code as document_code, d.title as document_title
                FROM document_chunks dc
                JOIN document_revisions dr ON dc.revision_id = dr.id
                JOIN documents d ON dr.document_id = d.id
                WHERE dc.id = CAST(:chunk_id AS uuid)
                """
            ),
            {"chunk_id": chunk_id}
        ).mappings().first()

        if not chunk:
            raise HTTPException(status_code=404, detail="Chunk not found")

        return {
            "page": {
                "page_id": f"chunk-{chunk['id']}",
                "revision_id": chunk["revision_id"],
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


@app.get("/api/documents/{revision_id}/pdf")
async def document_pdf(revision_id: str):
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT dr.file_path, d.source_filename
                FROM document_revisions dr
                JOIN documents d ON d.id = dr.document_id
                WHERE dr.id = CAST(:revision_id AS uuid)
                """
            ),
            {"revision_id": revision_id},
        ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail=f"No revision found with id: {revision_id}")

    file_path = row.get("file_path")
    source_filename = row.get("source_filename") or "document.pdf"

    if not file_path:
        raise HTTPException(
            status_code=404,
            detail=f"Original PDF file path not recorded for revision. Document may have been ingested without preserving the original file."
        )

    pdf_path = Path(file_path)
    if not pdf_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Original PDF file not found on disk at: {file_path}"
        )

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=source_filename,
    )


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
        app_settings = _get_app_settings(conn)
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
                    "expires_at": now + timedelta(days=int(app_settings.get("certification_validity_days", 365))),
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


@app.get("/api/assessments")
async def list_assessments(user_id: str):
    with engine.connect() as conn:
        _get_user(conn, user_id)
        rows = conn.execute(
            text(
                """
                SELECT
                    a.id::text AS assessment_id,
                    a.title,
                    a.passing_score,
                    a.time_limit_seconds,
                    a.certification_label,
                    tm.id::text AS module_id,
                    tm.title AS module_title,
                    ta.status AS assignment_status,
                    ta.progress_percent,
                    latest.score AS latest_score,
                    latest.completed_at AS latest_completed_at,
                    count(q.id) AS question_count
                FROM assessments a
                JOIN training_modules tm ON tm.id = a.module_id
                JOIN training_assignments ta
                  ON ta.module_id = tm.id
                 AND ta.user_id = CAST(:user_id AS uuid)
                LEFT JOIN assessment_questions q ON q.assessment_id = a.id
                LEFT JOIN LATERAL (
                    SELECT aa.score, aa.completed_at
                    FROM assessment_attempts aa
                    WHERE aa.user_id = CAST(:user_id AS uuid)
                      AND aa.assessment_id = a.id
                    ORDER BY aa.attempt_number DESC, aa.completed_at DESC NULLS LAST
                    LIMIT 1
                ) latest ON true
                GROUP BY
                    a.id, a.title, a.passing_score, a.time_limit_seconds, a.certification_label,
                    tm.id, tm.title, ta.status, ta.progress_percent, latest.score, latest.completed_at
                ORDER BY tm.title
                """
            ),
            {"user_id": user_id},
        ).mappings()
        assessments = [dict(row) for row in rows]

    for assessment in assessments:
        assessment["latest_completed_at"] = _iso(assessment.get("latest_completed_at"))
        score = assessment.get("latest_score")
        if score is None:
            assessment["status"] = "available"
        elif float(score) >= float(assessment["passing_score"]):
            assessment["status"] = "passed"
        else:
            assessment["status"] = "failed"
    return {"assessments": assessments}


@app.get("/api/notifications")
async def list_notifications(user_id: str, status: str | None = None, limit: int = 20):
    status_filter = (status or "").strip().lower()
    if status_filter and status_filter not in {"read", "unread"}:
        raise HTTPException(status_code=400, detail="Invalid status filter")

    safe_limit = max(1, min(int(limit or 20), 100))

    with engine.begin() as conn:
        _get_user(conn, user_id)
        _materialize_user_notifications(conn, user_id)

        params: dict[str, Any] = {"user_id": user_id, "limit": safe_limit}
        status_clause = ""
        if status_filter:
            status_clause = "AND n.status = :status"
            params["status"] = status_filter

        rows = [
            dict(row)
            for row in conn.execute(
                text(
                    f"""
                    SELECT
                        n.id::text AS id,
                        n.event_type,
                        n.severity,
                        n.title,
                        n.message,
                        n.cta_url,
                        n.channel,
                        n.status,
                        n.created_at,
                        n.read_at
                    FROM notifications n
                    WHERE n.user_id = CAST(:user_id AS uuid)
                    {status_clause}
                    ORDER BY n.created_at DESC
                    LIMIT :limit
                    """
                ),
                params,
            ).mappings()
        ]

        unread_count = int(
            conn.execute(
                text(
                    """
                    SELECT count(*)
                    FROM notifications
                    WHERE user_id = CAST(:user_id AS uuid)
                      AND status = 'unread'
                    """
                ),
                {"user_id": user_id},
            ).scalar_one()
            or 0
        )

    notifications = [
        {
            "id": row["id"],
            "event_type": row["event_type"],
            "severity": row["severity"],
            "title": row["title"],
            "message": row["message"],
            "cta_url": row["cta_url"],
            "channel": row["channel"],
            "status": row["status"],
            "is_read": row["status"] == "read",
            "created_at": _iso(row["created_at"]),
            "read_at": _iso(row["read_at"]),
        }
        for row in rows
    ]

    return {"notifications": notifications, "unread_count": unread_count}


@app.post("/api/notifications/read-all")
async def mark_all_notifications_read(req: NotificationReadRequest):
    with engine.begin() as conn:
        _get_user(conn, req.user_id)
        updated_count = conn.execute(
            text(
                """
                UPDATE notifications
                SET status = 'read', read_at = now()
                WHERE user_id = CAST(:user_id AS uuid)
                  AND status = 'unread'
                """
            ),
            {"user_id": req.user_id},
        ).rowcount
    return {"updated_count": int(updated_count or 0)}


@app.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, req: NotificationReadRequest):
    with engine.begin() as conn:
        _get_user(conn, req.user_id)
        updated_count = conn.execute(
            text(
                """
                UPDATE notifications
                SET status = 'read', read_at = now()
                WHERE id = CAST(:notification_id AS uuid)
                  AND user_id = CAST(:user_id AS uuid)
                  AND status = 'unread'
                """
            ),
            {"notification_id": notification_id, "user_id": req.user_id},
        ).rowcount
    return {"updated": bool(updated_count)}


@app.get("/api/users/{user_id}/reports")
async def user_reports(user_id: str):
    with engine.connect() as conn:
        user = _get_user(conn, user_id)

        certifications = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        c.id::text AS certification_id,
                        tm.title AS module_title,
                        c.status,
                        c.issued_at,
                        c.expires_at,
                        aa.score AS latest_score
                    FROM certifications c
                    JOIN training_modules tm ON tm.id = c.module_id
                    LEFT JOIN assessment_attempts aa ON aa.id = c.last_attempt_id
                    WHERE c.user_id = CAST(:user_id AS uuid)
                    ORDER BY c.expires_at NULLS LAST, tm.title
                    """
                ),
                {"user_id": user_id},
            ).mappings()
        ]

        assessment_attempts = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        aa.id::text AS attempt_id,
                        aa.attempt_number,
                        aa.score,
                        aa.status,
                        aa.started_at,
                        aa.completed_at,
                        a.title AS assessment_title,
                        tm.title AS module_title
                    FROM assessment_attempts aa
                    JOIN assessments a ON a.id = aa.assessment_id
                    JOIN training_modules tm ON tm.id = a.module_id
                    WHERE aa.user_id = CAST(:user_id AS uuid)
                    ORDER BY aa.completed_at DESC NULLS LAST, aa.started_at DESC NULLS LAST
                    """
                ),
                {"user_id": user_id},
            ).mappings()
        ]

    for cert in certifications:
        cert["issued_at"] = _iso(cert.get("issued_at"))
        cert["expires_at"] = _iso(cert.get("expires_at"))
    for attempt in assessment_attempts:
        attempt["started_at"] = _iso(attempt.get("started_at"))
        attempt["completed_at"] = _iso(attempt.get("completed_at"))

    active_certs = sum(1 for cert in certifications if cert.get("status") == "active")
    average_score = round(
        sum(float(attempt["score"]) for attempt in assessment_attempts if attempt.get("score") is not None)
        / max(1, sum(1 for attempt in assessment_attempts if attempt.get("score") is not None)),
        2,
    ) if assessment_attempts else 0.0

    return {
        "user": user,
        "stats": {
            "active_certifications": active_certs,
            "assessment_attempts": len(assessment_attempts),
            "average_score": average_score,
            "expiring_soon": sum(
                1
                for cert in certifications
                if cert.get("expires_at")
                and datetime.fromisoformat(cert["expires_at"].replace("Z", "+00:00")) <= datetime.now(timezone.utc) + timedelta(days=30)
            ),
        },
        "certifications": certifications,
        "assessment_attempts": assessment_attempts,
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
                        count(DISTINCT ta.id) FILTER (WHERE ta.is_mandatory) AS mandatory_total,
                        count(DISTINCT ta.id) FILTER (WHERE ta.is_mandatory AND ta.status = 'completed') AS mandatory_completed,
                        count(DISTINCT c.id) FILTER (WHERE c.status = 'active') AS active_certifications,
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


@app.get("/api/admin/reporting/overview")
async def admin_reporting_overview(user_id: str):
    with engine.connect() as conn:
        user = _get_user(conn, user_id)
        _require_admin_or_supervisor(user)

        active_today = int(
            conn.execute(
                text(
                    """
                    SELECT count(DISTINCT user_id)
                    FROM retrieval_events
                    WHERE created_at >= date_trunc('day', now())
                      AND user_id IS NOT NULL
                    """
                )
            ).scalar_one()
            or 0
        )
        active_week = int(
            conn.execute(
                text(
                    """
                    SELECT count(DISTINCT user_id)
                    FROM retrieval_events
                    WHERE created_at >= now() - interval '7 day'
                      AND user_id IS NOT NULL
                    """
                )
            ).scalar_one()
            or 0
        )
        queries_today = int(
            conn.execute(
                text(
                    """
                    SELECT count(*)
                    FROM retrieval_events
                    WHERE created_at >= date_trunc('day', now())
                    """
                )
            ).scalar_one()
            or 0
        )
        avg_latency_ms = float(
            conn.execute(
                text("SELECT COALESCE(avg(latency_ms), 0) FROM retrieval_events")
            ).scalar_one()
            or 0.0
        )

        top_queries = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT query_text AS query, count(*) AS count
                    FROM retrieval_events
                    GROUP BY query_text
                    ORDER BY count DESC, query_text
                    LIMIT 8
                    """
                )
            ).mappings()
        ]

        department_usage = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        COALESCE(d.name, 'unassigned') AS name,
                        count(re.id) AS usage
                    FROM retrieval_events re
                    LEFT JOIN users u ON u.id = re.user_id
                    LEFT JOIN departments d ON d.id = u.department_id
                    GROUP BY COALESCE(d.name, 'unassigned')
                    ORDER BY usage DESC, name
                    """
                )
            ).mappings()
        ]

        query_trend = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        to_char(date_trunc('day', created_at), 'Mon DD') AS month,
                        count(*) AS value
                    FROM retrieval_events
                    WHERE created_at >= now() - interval '7 day'
                    GROUP BY date_trunc('day', created_at)
                    ORDER BY date_trunc('day', created_at)
                    """
                )
            ).mappings()
        ]

    max_usage = max([int(item["usage"]) for item in department_usage], default=0) or 1
    return {
        "requestor": user,
        "platform_usage": {
            "daily_active": active_today,
            "weekly_active": active_week,
            "queries_today": queries_today,
            "avg_latency_ms": round(avg_latency_ms, 2),
        },
        "department_usage": [
            {
                "name": item["name"],
                "usage": int(item["usage"]),
                "percentage": round((int(item["usage"]) / max_usage) * 100, 2),
            }
            for item in department_usage
        ],
        "top_queries": top_queries,
        "query_trend": query_trend,
    }


@app.get("/api/admin/guardrail/incidents")
async def admin_guardrail_incidents(user_id: str, limit: int = 20):
    safe_limit = max(1, min(int(limit or 20), 200))
    with engine.connect() as conn:
        user = _get_user(conn, user_id)
        _require_admin_or_supervisor(user)
        rows = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    WITH incident_rows AS (
                        SELECT
                            aal.id::text AS incident_id,
                            aal.actor_user_id::text AS actor_user_id,
                            COALESCE(u.full_name, aal.details->>'actor_name') AS actor_name,
                            COALESCE(u.role, aal.details->>'actor_role') AS actor_role,
                            aal.target_type,
                            aal.target_id,
                            aal.details,
                            aal.created_at,
                            COALESCE(aal.actor_user_id::text, 'anonymous') AS actor_key
                        FROM admin_audit_logs aal
                        LEFT JOIN users u ON u.id = aal.actor_user_id
                        WHERE aal.action = 'guardrail_blocked_query'
                    )
                    SELECT
                        incident_id,
                        actor_user_id,
                        actor_name,
                        actor_role,
                        target_type,
                        target_id,
                        details,
                        created_at,
                        count(*) OVER (PARTITION BY actor_key) AS actor_incident_count,
                        row_number() OVER (PARTITION BY actor_key ORDER BY created_at ASC, incident_id ASC) AS actor_incident_sequence,
                        min(created_at) OVER (PARTITION BY actor_key) AS actor_first_seen_at,
                        max(created_at) OVER (PARTITION BY actor_key) AS actor_last_seen_at,
                        sum(CASE WHEN created_at >= now() - interval '24 hours' THEN 1 ELSE 0 END)
                            OVER (PARTITION BY actor_key) AS actor_incidents_last_24h
                    FROM incident_rows
                    ORDER BY created_at DESC
                    LIMIT :limit
                    """
                ),
                {"limit": safe_limit},
            ).mappings()
        ]

    incidents = []
    counts_by_category: dict[str, int] = {}
    counts_by_severity: dict[str, int] = {}
    unique_actors: set[str] = set()
    first_time_actors = 0
    repeat_actors = 0
    for row in rows:
        details = row.get("details") or {}
        if not isinstance(details, dict):
            details = {}
        category = str(details.get("category") or "unknown")
        severity = str(details.get("severity") or "medium")
        actor_key = str(row.get("actor_user_id") or row.get("actor_name") or "anonymous")
        actor_incident_count = int(row.get("actor_incident_count") or details.get("incident_count_for_actor") or 1)
        actor_incident_sequence = int(row.get("actor_incident_sequence") or actor_incident_count or 1)
        actor_incidents_last_24h = int(
            row.get("actor_incidents_last_24h")
            or details.get("incident_count_last_24h_for_actor")
            or 0
        )
        is_first_incident_for_actor = actor_incident_sequence == 1

        counts_by_category[category] = counts_by_category.get(category, 0) + 1
        counts_by_severity[severity] = counts_by_severity.get(severity, 0) + 1
        unique_actors.add(actor_key)
        if is_first_incident_for_actor:
            first_time_actors += 1
        if actor_incident_count > 1:
            repeat_actors += 1
        incidents.append(
            {
                "incident_id": row["incident_id"],
                "actor_user_id": row.get("actor_user_id"),
                "actor_name": row.get("actor_name"),
                "actor_role": row.get("actor_role"),
                "target_type": row.get("target_type"),
                "target_id": row.get("target_id"),
                "category": category,
                "reason": details.get("reason"),
                "severity": severity,
                "channel": details.get("channel"),
                "query_excerpt": details.get("query_excerpt"),
                "matched_terms": details.get("matched_terms") or [],
                "conversation_id": details.get("conversation_id"),
                "actor_department": details.get("actor_department"),
                "actor_incident_count": actor_incident_count,
                "actor_incident_sequence": actor_incident_sequence,
                "actor_incidents_last_24h": actor_incidents_last_24h,
                "is_first_incident_for_actor": is_first_incident_for_actor,
                "is_repeat_actor": actor_incident_count > 1,
                "actor_first_seen_at": _iso(row.get("actor_first_seen_at")),
                "actor_last_seen_at": _iso(row.get("actor_last_seen_at")),
                "created_at": _iso(row.get("created_at")),
            }
        )

    return {
        "incidents": incidents,
        "summary": {
            "total": len(incidents),
            "counts_by_category": counts_by_category,
            "counts_by_severity": counts_by_severity,
            "unique_actor_count": len(unique_actors),
            "first_time_actor_count": first_time_actors,
            "repeat_actor_count": repeat_actors,
            "latest_incident_at": incidents[0]["created_at"] if incidents else None,
        },
    }


@app.get("/api/guardrail/incidents")
async def user_guardrail_incidents(user_id: str, limit: int = 20):
    safe_limit = max(1, min(int(limit or 20), 100))
    with engine.connect() as conn:
        user = _get_user(conn, user_id)
        rows = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        aal.id::text AS incident_id,
                        aal.details,
                        aal.created_at,
                        ga.id::text AS appeal_id,
                        ga.appeal_text,
                        ga.status AS appeal_status,
                        ga.resolution_notes,
                        ga.created_at AS appeal_created_at,
                        ga.reviewed_at AS appeal_reviewed_at,
                        reviewer.full_name AS reviewed_by_name
                    FROM admin_audit_logs aal
                    LEFT JOIN guardrail_appeals ga
                      ON ga.incident_id = aal.id
                     AND ga.user_id = CAST(:user_id AS uuid)
                    LEFT JOIN users reviewer
                      ON reviewer.id = ga.reviewed_by_user_id
                    WHERE aal.action = 'guardrail_blocked_query'
                      AND aal.actor_user_id = CAST(:user_id AS uuid)
                    ORDER BY aal.created_at DESC
                    LIMIT :limit
                    """
                ),
                {"user_id": user_id, "limit": safe_limit},
            ).mappings()
        ]

    incidents = []
    for row in rows:
        details = row.get("details") or {}
        if not isinstance(details, dict):
            details = {}
        incidents.append(
            {
                "incident_id": row["incident_id"],
                "category": details.get("category"),
                "reason": details.get("reason"),
                "severity": details.get("severity") or "medium",
                "channel": details.get("channel"),
                "query_excerpt": details.get("query_excerpt"),
                "matched_terms": details.get("matched_terms") or [],
                "conversation_id": details.get("conversation_id"),
                "created_at": _iso(row.get("created_at")),
                "appeal": {
                    "appeal_id": row.get("appeal_id"),
                    "appeal_text": row.get("appeal_text"),
                    "status": row.get("appeal_status"),
                    "resolution_notes": row.get("resolution_notes"),
                    "created_at": _iso(row.get("appeal_created_at")),
                    "reviewed_at": _iso(row.get("appeal_reviewed_at")),
                    "reviewed_by_name": row.get("reviewed_by_name"),
                }
                if row.get("appeal_id")
                else None,
            }
        )

    return {
        "user": user,
        "incidents": incidents,
        "summary": {
            "total": len(incidents),
            "pending_appeals": sum(
                1 for item in incidents if (item.get("appeal") or {}).get("status") == "pending"
            ),
        },
    }


@app.post("/api/guardrail/incidents/{incident_id}/appeal")
async def create_guardrail_appeal(incident_id: str, req: GuardrailAppealCreateRequest):
    appeal_text = re.sub(r"\s+", " ", (req.appeal_text or "")).strip()
    if len(appeal_text) < 10:
        raise HTTPException(status_code=400, detail="Appeal text is too short")

    with engine.begin() as conn:
        user = _get_user(conn, req.user_id)
        incident = conn.execute(
            text(
                """
                SELECT
                    aal.id::text AS incident_id,
                    aal.actor_user_id::text AS actor_user_id,
                    aal.details
                FROM admin_audit_logs aal
                WHERE aal.id = CAST(:incident_id AS uuid)
                  AND aal.action = 'guardrail_blocked_query'
                """
            ),
            {"incident_id": incident_id},
        ).mappings().first()
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
        if incident.get("actor_user_id") != req.user_id:
            raise HTTPException(status_code=403, detail="Incident does not belong to this user")

        appeal_row = conn.execute(
            text(
                """
                INSERT INTO guardrail_appeals (
                    incident_id,
                    user_id,
                    appeal_text,
                    status
                )
                VALUES (
                    CAST(:incident_id AS uuid),
                    CAST(:user_id AS uuid),
                    :appeal_text,
                    'pending'
                )
                ON CONFLICT (incident_id, user_id)
                DO UPDATE SET
                    appeal_text = EXCLUDED.appeal_text,
                    status = 'pending',
                    resolution_notes = NULL,
                    reviewed_by_user_id = NULL,
                    reviewed_at = NULL
                RETURNING id::text AS appeal_id, created_at
                """
            ),
            {
                "incident_id": incident_id,
                "user_id": req.user_id,
                "appeal_text": appeal_text,
            },
        ).mappings().one()

        details = incident.get("details") or {}
        if not isinstance(details, dict):
            details = {}
        admins = [
            row["id"]
            for row in conn.execute(
                text(
                    """
                    SELECT id::text AS id
                    FROM users
                    WHERE role IN ('admin', 'supervisor')
                    ORDER BY role, full_name
                    """
                )
            ).mappings()
        ]
        for admin_id in admins:
            _queue_notification(
                conn,
                user_id=admin_id,
                event_type="guardrail_appeal_submitted",
                severity="medium",
                title=f"Guardrail appeal: {user.get('full_name') or 'Operator'}",
                message=(
                    f"Review requested for a {details.get('severity') or 'medium'} "
                    f"{details.get('category') or 'guardrail'} incident."
                ),
                cta_url="/admin/analytics?focus=guardrails",
                event_key=f"guardrail-appeal:{appeal_row['appeal_id']}:{admin_id}",
            )

    return {
        "appeal_id": appeal_row["appeal_id"],
        "status": "pending",
        "created_at": _iso(appeal_row.get("created_at")),
    }


@app.get("/api/admin/guardrail/appeals")
async def admin_guardrail_appeals(user_id: str, limit: int = 20):
    safe_limit = max(1, min(int(limit or 20), 200))
    with engine.connect() as conn:
        user = _get_user(conn, user_id)
        _require_admin_or_supervisor(user)
        rows = [
            dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        ga.id::text AS appeal_id,
                        ga.appeal_text,
                        ga.status,
                        ga.resolution_notes,
                        ga.created_at,
                        ga.reviewed_at,
                        requester.id::text AS requester_user_id,
                        requester.full_name AS requester_name,
                        requester.role AS requester_role,
                        reviewer.full_name AS reviewed_by_name,
                        aal.id::text AS incident_id,
                        aal.details
                    FROM guardrail_appeals ga
                    JOIN users requester ON requester.id = ga.user_id
                    JOIN admin_audit_logs aal ON aal.id = ga.incident_id
                    LEFT JOIN users reviewer ON reviewer.id = ga.reviewed_by_user_id
                    ORDER BY
                        CASE ga.status WHEN 'pending' THEN 0 ELSE 1 END,
                        ga.created_at DESC
                    LIMIT :limit
                    """
                ),
                {"limit": safe_limit},
            ).mappings()
        ]

    appeals = []
    counts_by_status: dict[str, int] = {}
    for row in rows:
        details = row.get("details") or {}
        if not isinstance(details, dict):
            details = {}
        status = str(row.get("status") or "pending")
        counts_by_status[status] = counts_by_status.get(status, 0) + 1
        appeals.append(
            {
                "appeal_id": row["appeal_id"],
                "incident_id": row["incident_id"],
                "requester_user_id": row.get("requester_user_id"),
                "requester_name": row.get("requester_name"),
                "requester_role": row.get("requester_role"),
                "appeal_text": row.get("appeal_text"),
                "status": status,
                "resolution_notes": row.get("resolution_notes"),
                "reviewed_by_name": row.get("reviewed_by_name"),
                "created_at": _iso(row.get("created_at")),
                "reviewed_at": _iso(row.get("reviewed_at")),
                "incident_category": details.get("category"),
                "incident_reason": details.get("reason"),
                "incident_severity": details.get("severity") or "medium",
                "query_excerpt": details.get("query_excerpt"),
            }
        )

    return {
        "appeals": appeals,
        "summary": {
            "total": len(appeals),
            "counts_by_status": counts_by_status,
        },
    }


@app.post("/api/admin/guardrail/appeals/{appeal_id}/review")
async def review_guardrail_appeal(appeal_id: str, req: GuardrailAppealReviewRequest):
    normalized_status = (req.status or "").strip().lower()
    if normalized_status not in {"approved", "rejected"}:
        raise HTTPException(status_code=400, detail="Invalid appeal status")

    resolution_notes = re.sub(r"\s+", " ", (req.resolution_notes or "")).strip() or None

    with engine.begin() as conn:
        reviewer = _get_user(conn, req.user_id)
        _require_admin_or_supervisor(reviewer)

        appeal = conn.execute(
            text(
                """
                SELECT
                    ga.id::text AS appeal_id,
                    ga.user_id::text AS requester_user_id,
                    ga.incident_id::text AS incident_id,
                    ga.status AS current_status,
                    requester.full_name AS requester_name,
                    aal.details
                FROM guardrail_appeals ga
                JOIN users requester ON requester.id = ga.user_id
                JOIN admin_audit_logs aal ON aal.id = ga.incident_id
                WHERE ga.id = CAST(:appeal_id AS uuid)
                """
            ),
            {"appeal_id": appeal_id},
        ).mappings().first()
        if not appeal:
            raise HTTPException(status_code=404, detail="Appeal not found")

        if appeal.get("current_status") == normalized_status and resolution_notes is None:
            return {
                "appeal_id": appeal_id,
                "status": normalized_status,
                "reviewed": False,
            }

        updated = conn.execute(
            text(
                """
                UPDATE guardrail_appeals
                SET
                    status = :status,
                    resolution_notes = :resolution_notes,
                    reviewed_by_user_id = CAST(:reviewed_by_user_id AS uuid),
                    reviewed_at = NOW()
                WHERE id = CAST(:appeal_id AS uuid)
                RETURNING
                    id::text AS appeal_id,
                    status,
                    resolution_notes,
                    reviewed_at
                """
            ),
            {
                "appeal_id": appeal_id,
                "status": normalized_status,
                "resolution_notes": resolution_notes,
                "reviewed_by_user_id": req.user_id,
            },
        ).mappings().one()

        details = appeal.get("details") or {}
        if not isinstance(details, dict):
            details = {}

        resolution_label = "approved" if normalized_status == "approved" else "rejected"
        _queue_notification(
            conn,
            user_id=appeal["requester_user_id"],
            event_type="guardrail_appeal_reviewed",
            severity="info" if normalized_status == "approved" else "medium",
            title="Guardrail appeal reviewed",
            message=(
                f"Your guardrail appeal was {resolution_label}."
                + (
                    f" Notes: {resolution_notes}"
                    if resolution_notes
                    else ""
                )
            ),
            cta_url="/operator/reports?tab=guardrails",
            event_key=f"guardrail-appeal-reviewed:{appeal_id}:{normalized_status}",
        )
        conn.execute(
            text(
                """
                INSERT INTO admin_audit_logs (
                    actor_user_id,
                    action,
                    target_type,
                    target_id,
                    details,
                    created_at
                )
                VALUES (
                    CAST(:actor_user_id AS uuid),
                    'guardrail_appeal_reviewed',
                    'guardrail_appeal',
                    :target_id,
                    CAST(:details AS jsonb),
                    NOW()
                )
                """
            ),
            {
                "actor_user_id": req.user_id,
                "target_id": appeal_id,
                "details": json.dumps(
                    {
                        "incident_id": appeal.get("incident_id"),
                        "requester_user_id": appeal.get("requester_user_id"),
                        "requester_name": appeal.get("requester_name"),
                        "status": normalized_status,
                        "resolution_notes": resolution_notes,
                        "incident_category": details.get("category"),
                        "incident_reason": details.get("reason"),
                    }
                ),
            },
        )

    return {
        "appeal_id": updated["appeal_id"],
        "status": updated["status"],
        "resolution_notes": updated["resolution_notes"],
        "reviewed_at": _iso(updated["reviewed_at"]),
        "reviewed": True,
    }


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    _require_chat_llm_config()
    _require_secret(settings.SARVAM_API_KEY, "SARVAM_API_KEY")

    guardrail_decision = evaluate_guardrail(req.text)
    if guardrail_decision.blocked:
        with engine.begin() as conn:
            _notify_guardrail_violation(
                conn,
                user_id=None,
                query_text=req.text,
                decision=guardrail_decision,
                channel="chat",
                conversation_id=None,
            )
        return ChatResponse(
            user_text=req.text,
            assistant_text=guardrail_decision.user_message,
            assistant_tts_text=guardrail_decision.user_message,
            audio_base64="",
            audio_mime_type="audio/wav",
            citations=[],
        )

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
            revision_id=chunk.get("revision_id"),
            revision_label=chunk.get("revision_label"),
            page_start=chunk.get("page_start"),
            page_end=chunk.get("page_end"),
            citation_label=chunk.get("citation_label"),
            section_title=chunk.get("section_title"),
            content=chunk.get("content"),
            block_ids=chunk.get("block_ids") or [],
            bbox_x0=chunk.get("bbox_x0"),
            bbox_y0=chunk.get("bbox_y0"),
            bbox_x1=chunk.get("bbox_x1"),
            bbox_y1=chunk.get("bbox_y1"),
            line_start=chunk.get("line_start"),
            line_end=chunk.get("line_end"),
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

        assistant_text = None
        if settings.has_primary_llm_credentials:
            assistant_text = await _call_primary_chat_model(
                system_prompt=system_prompt,
                user_prompt=req.text,
                max_tokens=512,
            )
        if not assistant_text:
            assistant_text = await _call_groq_chat_fallback(
                system_prompt=system_prompt,
                user_prompt=req.text,
                max_tokens=512,
            )
        if not assistant_text:
            assistant_text = _extractive_answer_from_evidence(req.text, valid_chunks)

    audio_base64 = ""
    assistant_tts_text = assistant_text
    if settings.SARVAM_API_KEY and assistant_text:
        async with httpx.AsyncClient(timeout=45.0) as client:
            try:
                assistant_tts_text, tts_language = await _translate_assistant_text(
                    client, assistant_text, req.language
                )
                audio_base64 = await _synthesize_speech(
                    client, assistant_tts_text, tts_language, req.speaker
                )
            except Exception as exc:
                print(f"TTS synthesis failed in /api/chat: {exc}")
                assistant_tts_text = _prepare_tts_text(assistant_text)
                audio_base64 = ""

    return ChatResponse(
        user_text=req.text,
        assistant_text=assistant_text,
        assistant_tts_text=assistant_tts_text,
        audio_base64=audio_base64,
        audio_mime_type="audio/wav",
        citations=citations
    )


@app.post("/api/stt")
async def speech_to_text(audio: UploadFile = File(...), language: str = Form("auto")):
    _require_secret(settings.SARVAM_API_KEY, "SARVAM_API_KEY")
    audio_bytes = await audio.read()

    async with httpx.AsyncClient(timeout=45.0) as client:
        spoken_text, normalized_text, detected_language = await _prepare_voice_query(
            client,
            audio_bytes,
            language,
            audio.filename,
            audio.content_type,
        )

    return {
        "text": spoken_text,
        "normalized_text": normalized_text,
        "language": detected_language,
        "detected_language": detected_language,
    }


@app.post("/api/translate", response_model=TranslateResponse)
async def translate_text(req: TranslateRequest):
    _require_secret(settings.SARVAM_API_KEY, "SARVAM_API_KEY")

    wants_hinglish = _is_hinglish_language(req.target_language)
    source_language = _normalize_translation_language(req.source_language)
    target_language = (
        "hi-IN"
        if wants_hinglish
        else _normalize_translation_language(req.target_language, fallback="hi-IN")
    )

    async with httpx.AsyncClient(timeout=15.0) as client:
        translated_text = await _translate_text(
            client,
            req.text,
            source_language,
            target_language,
        )
        if wants_hinglish:
            try:
                translated_text = await _transliterate_to_hinglish(client, translated_text)
            except Exception:
                pass

    return TranslateResponse(
        text=req.text,
        translated_text=translated_text,
        source_language=source_language,
        target_language="hinglish" if wants_hinglish else target_language,
    )


@app.post("/api/tts", response_model=SpeechSynthesisResponse)
async def synthesize_text(req: SpeechSynthesisRequest):
    _require_secret(settings.SARVAM_API_KEY, "SARVAM_API_KEY")

    prepared_text = _prepare_tts_text(req.text)
    tts_language = _get_tts_language(_normalize_translation_language(req.language))

    async with httpx.AsyncClient(timeout=20.0) as client:
        audio_base64 = await _synthesize_speech(
            client,
            prepared_text,
            tts_language,
            req.speaker,
        )

    return SpeechSynthesisResponse(
        text=prepared_text,
        language=tts_language,
        audio_base64=audio_base64,
    )


@app.post("/api/voice")
async def voice_pipeline(
    audio: UploadFile = File(...),
    language: str = Form("auto"),
    speaker: str = Form(DEFAULT_TTS_SPEAKER),
    user_id: str | None = Form(None),
    conversation_id: str | None = Form(None),
    chat_scope: str = Form("general"),
    revision_id: str | None = Form(None),
):
    _require_chat_llm_config()
    _require_secret(settings.SARVAM_API_KEY, "SARVAM_API_KEY")

    if conversation_id and not user_id:
        raise HTTPException(status_code=400, detail="user_id is required with conversation_id")

    normalized_scope = _normalize_chat_scope(chat_scope)
    audio_bytes = await audio.read()
    conversation_metadata: dict[str, Any] = {}
    if normalized_scope == "reader" and revision_id:
        conversation_metadata["revision_id"] = revision_id

    history: list[dict[str, str]] = []
    if user_id:
        with engine.connect() as conn:
            _get_user(conn, user_id)
            if conversation_id:
                conversation_scope = _detect_chat_scope_for_conversation(
                    conn, conversation_id, user_id
                )
                if not conversation_scope:
                    raise HTTPException(status_code=404, detail="Conversation not found")
                if conversation_scope != normalized_scope:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "Conversation scope mismatch. "
                            f"Expected '{normalized_scope}', found '{conversation_scope}'."
                        ),
                    )
                conversation = _get_chat_conversation(
                    conn,
                    conversation_id,
                    user_id,
                    chat_scope=normalized_scope,
                )
                if (
                    normalized_scope == "reader"
                    and revision_id
                    and conversation.get("revision_id")
                    and conversation.get("revision_id") != revision_id
                ):
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "Reader conversation revision mismatch. "
                            "Start a new reader conversation for this document."
                        ),
                    )
                history = _history_from_messages(
                    _get_chat_messages(conn, conversation_id, chat_scope=normalized_scope)
                )

    async with httpx.AsyncClient(timeout=45.0) as client:
        try:
            spoken_text, normalized_query, detected_language = await _prepare_voice_query(
                client,
                audio_bytes,
                language,
                audio.filename,
                audio.content_type,
            )
        except httpx.HTTPStatusError as exc:
            print(f"Voice STT request failed: {exc}")
            assistant_text = _voice_not_understood_message(language)
            tts_language = _get_tts_language(language if language not in {"auto", "unknown"} else DEFAULT_TTS_LANGUAGE)
            return {
                "user_text": "",
                "normalized_query": "",
                "assistant_text": assistant_text,
                "assistant_tts_text": assistant_text,
                "audio_base64": "",
                "audio_mime_type": "audio/wav",
                "detected_language": language,
                "tts_language": tts_language,
                "citations": [],
                "conversation_id": conversation_id,
                "stt_status": "stt_error",
            }

    if not spoken_text.strip():
        assistant_text = _voice_not_understood_message(detected_language or language)
        tts_language = _get_tts_language(detected_language or DEFAULT_TTS_LANGUAGE)
        return {
            "user_text": "",
            "normalized_query": "",
            "assistant_text": assistant_text,
            "assistant_tts_text": assistant_text,
            "audio_base64": "",
            "audio_mime_type": "audio/wav",
            "detected_language": detected_language,
            "tts_language": tts_language,
            "citations": [],
            "conversation_id": conversation_id,
            "stt_status": "empty_transcript",
        }

    guardrail_decision = evaluate_guardrail(spoken_text)
    if guardrail_decision.blocked:
        assistant_text = guardrail_decision.user_message
        if user_id:
            with engine.begin() as conn:
                _get_user(conn, user_id)
                if conversation_id:
                    _get_chat_conversation(
                        conn,
                        conversation_id,
                        user_id,
                        chat_scope=normalized_scope,
                    )
                else:
                    conversation = _create_chat_conversation(
                        conn,
                        user_id=user_id,
                        language=detected_language,
                        title=_conversation_title_from_query(spoken_text),
                        chat_scope=normalized_scope,
                        metadata=conversation_metadata,
                    )
                    conversation_id = conversation["id"]

                _append_chat_message(
                    conn,
                    conversation_id=conversation_id,
                    role="user",
                    content=spoken_text,
                    language=detected_language,
                    response_mode="voice",
                    chat_scope=normalized_scope,
                )
                _append_chat_message(
                    conn,
                    conversation_id=conversation_id,
                    role="assistant",
                    content=assistant_text,
                    language=detected_language,
                    response_mode="voice",
                    chat_scope=normalized_scope,
                )
                _notify_guardrail_violation(
                    conn,
                    user_id=user_id,
                    query_text=spoken_text,
                    decision=guardrail_decision,
                    channel="voice",
                    conversation_id=conversation_id,
                )
        else:
            with engine.begin() as conn:
                _notify_guardrail_violation(
                    conn,
                    user_id=None,
                    query_text=spoken_text,
                    decision=guardrail_decision,
                    channel="voice",
                    conversation_id=None,
                )

        return {
            "user_text": spoken_text,
            "normalized_query": spoken_text,
            "assistant_text": assistant_text,
            "assistant_tts_text": assistant_text,
            "audio_base64": "",
            "audio_mime_type": "audio/wav",
            "detected_language": detected_language,
            "tts_language": _get_tts_language(detected_language),
            "citations": [],
            "conversation_id": conversation_id,
            "guardrail": _guardrail_diagnostics(guardrail_decision),
        }

    contextual_query = _build_contextual_query(normalized_query or spoken_text, history)
    rewritten_query = contextual_query
    rewrite_result = None
    if _should_use_query_rewrite(
        spoken_text,
        history,
        chat_scope=normalized_scope,
    ):
        rewrite_result = await _run_blocking_with_timeout(
            DSPY_REWRITE_TIMEOUT_SECONDS,
            rewrite_query_with_dspy,
            contextual_query,
            language=detected_language,
            role="operator",
            history=history,
        )
    if rewrite_result and rewrite_result.get("rewritten_query"):
        rewritten_query = rewrite_result["rewritten_query"]

    effective_top_k = 5
    if normalized_scope == "reader" and _is_summary_style_query(spoken_text):
        effective_top_k = 12

    retrieval_result = retriever.query(
        query_text=rewritten_query,
        language=detected_language,
        role="operator",
        user_id=user_id,
        top_k=effective_top_k,
        revision_id=revision_id if normalized_scope == "reader" else None,
    )
    evidence = retrieval_result.get("evidence", [])
    assistant_text = await _generate_grounded_answer(
        spoken_text,
        detected_language,
        evidence,
        history=history,
        chat_scope=normalized_scope,
    )
    citations = [
        Citation(
            chunk_id=chunk.get("chunk_id", ""),
            document_code=chunk.get("document_code"),
            document_title=chunk.get("document_title"),
            revision_id=chunk.get("revision_id"),
            revision_label=chunk.get("revision_label"),
            page_start=chunk.get("page_start"),
            page_end=chunk.get("page_end"),
            citation_label=chunk.get("citation_label"),
            section_title=chunk.get("section_title"),
            content=chunk.get("content"),
            block_ids=chunk.get("block_ids") or [],
            bbox_x0=chunk.get("bbox_x0"),
            bbox_y0=chunk.get("bbox_y0"),
            bbox_x1=chunk.get("bbox_x1"),
            bbox_y1=chunk.get("bbox_y1"),
            line_start=chunk.get("line_start"),
            line_end=chunk.get("line_end"),
        ).model_dump()
        for chunk in evidence[:4]
    ]
    retrieval_event_id = retrieval_result.get("retrieval_event_id") or retrieval_result.get("event_id")

    audio_base64 = ""
    assistant_tts_text = _prepare_tts_text(assistant_text)
    tts_language = _get_tts_language(detected_language)
    async with httpx.AsyncClient(timeout=45.0) as client:
        try:
            assistant_tts_text, tts_language = await _translate_assistant_text(
                client, assistant_text, detected_language
            )
            audio_base64 = await _synthesize_speech(
                client, assistant_tts_text, tts_language, speaker
            )
        except Exception as exc:
            print(f"TTS synthesis failed in /api/voice: {exc}")

    if user_id:
        with engine.begin() as conn:
            _get_user(conn, user_id)
            if conversation_id:
                _get_chat_conversation(
                    conn,
                    conversation_id,
                    user_id,
                    chat_scope=normalized_scope,
                )
            else:
                conversation = _create_chat_conversation(
                    conn,
                    user_id=user_id,
                    language=detected_language,
                    title=_conversation_title_from_query(spoken_text),
                    chat_scope=normalized_scope,
                    metadata=conversation_metadata,
                )
                conversation_id = conversation["id"]

            _append_chat_message(
                conn,
                conversation_id=conversation_id,
                role="user",
                content=spoken_text,
                language=detected_language,
                query_text=rewritten_query,
                response_mode="voice",
                chat_scope=normalized_scope,
            )
            _append_chat_message(
                conn,
                conversation_id=conversation_id,
                role="assistant",
                content=assistant_text,
                language=detected_language,
                citations=citations,
                query_text=rewritten_query,
                retrieval_event_id=retrieval_event_id,
                response_mode="voice",
                chat_scope=normalized_scope,
            )

    return {
        "user_text": spoken_text,
        "normalized_query": rewritten_query,
        "assistant_text": assistant_text,
        "assistant_tts_text": assistant_tts_text,
        "audio_base64": audio_base64,
        "audio_mime_type": "audio/wav",
        "detected_language": detected_language,
        "tts_language": tts_language,
        "citations": citations,
        "conversation_id": conversation_id,
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


@app.get("/api/admin/settings")
async def admin_settings(user_id: str):
    with engine.connect() as conn:
        user = _get_user(conn, user_id)
        _require_admin(user)
        settings_payload = _get_app_settings(conn)
    return {"settings": settings_payload}


@app.post("/api/admin/settings")
async def update_admin_settings(req: AdminSettingsUpdateRequest):
    with engine.begin() as conn:
        user = _get_user(conn, req.user_id)
        _require_admin(user)
        for key, value in req.settings.items():
            conn.execute(
                text(
                    """
                    INSERT INTO app_settings (setting_key, setting_value, updated_at)
                    VALUES (:setting_key, CAST(:setting_value AS jsonb), NOW())
                    ON CONFLICT (setting_key) DO UPDATE SET
                        setting_value = EXCLUDED.setting_value,
                        updated_at = NOW()
                    """
                ),
                {
                    "setting_key": key,
                    "setting_value": json.dumps(value),
                },
            )
        payload = _get_app_settings(conn)
    return {"status": "success", "settings": payload}


class SOPUploadRequest(BaseModel):
    title: str
    code: str
    document_type: str = "sop"
    department: str = "operations"


class PurgeDocumentsRequest(BaseModel):
    user_id: str
    document_type: str | None = None
    confirm: bool = False


def _build_page_vl_embedding_map(pages: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    image_pages = [
        {
            "page_number": page.get("page_number"),
            "image_path": page.get("image_path"),
            "text": page.get("raw_text") or "",
        }
        for page in pages
        if page.get("image_path")
    ]
    if not image_pages:
        return {}

    try:
        from app.services.nvidia_nim import embed_visual_pages_vl_nvidia
    except Exception:
        return {}

    embeddings = embed_visual_pages_vl_nvidia(image_pages)
    if not embeddings:
        return {}

    page_map: dict[int, dict[str, Any]] = {}
    for page, embedding in zip(image_pages, embeddings):
        page_number = page.get("page_number")
        if page_number is None:
            continue
        page_map[int(page_number)] = {
            "embedding": embedding,
            "model": settings.NVIDIA_EMBED_VL_MODEL,
        }
    return page_map


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
        identity = _prepare_document_identity(conn, code=code)
        app_settings = _get_app_settings(conn)

    doc_id = identity["document_id"]
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
    raw_chunks = extraction.get("chunks", [])
    pages = extraction.get("pages", [])
    if not raw_chunks:
        raise HTTPException(status_code=400, detail="Could not extract text from document")

    from app.services.embedding_service import embed_texts

    chunk_rows = []
    for chunk in raw_chunks:
        chunk_id = str(uuid.uuid4())
        chunk_rows.append({**chunk, "id": chunk_id, "source_chunk_id": chunk_id})

    contents = [c["content"] for c in chunk_rows]
    embeddings = embed_texts(contents)
    page_vl_embeddings = _build_page_vl_embedding_map(pages)
    learning_assets = generate_learning_assets(
        document_code=code,
        document_title=title,
        document_type=document_type,
        chunks=chunk_rows,
    )
    if learning_assets.get("module"):
        learning_assets["module"]["validity_days"] = int(app_settings.get("certification_validity_days", 365))
    if learning_assets.get("assessment"):
        learning_assets["assessment"]["passing_score"] = float(app_settings.get("assessment_passing_score", 70))

    with engine.begin() as conn:
        _persist_document_revision(
            conn,
            document_id=doc_id,
            revision_id=revision_id,
            code=code,
            title=title,
            document_type=document_type,
            department=department,
            source_filename=file.filename,
            file_path=str(saved_path),
            page_count=extraction.get("page_count", 0),
            classification=extraction.get("classification", "unknown"),
            version_number=identity["version_number"],
            revision_label=identity["revision_label"],
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
                        raw_text, markdown_path, image_path, ocr_used, ocr_confidence,
                        vl_embedding, vl_embedding_model, created_at
                    )
                    VALUES (
                        CAST(:id AS uuid), CAST(:revision_id AS uuid), :page_number, :classification,
                        :extracted_text_chars, :raw_text, :markdown_path, :image_path, :ocr_used,
                        :ocr_confidence, :vl_embedding, :vl_embedding_model, NOW()
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
                    "vl_embedding": (
                        "[" + ",".join(str(x) for x in page_vl_embeddings[page["page_number"]]["embedding"]) + "]"
                        if page.get("page_number") in page_vl_embeddings
                        else None
                    ),
                    "vl_embedding_model": (
                        page_vl_embeddings[page["page_number"]]["model"]
                        if page.get("page_number") in page_vl_embeddings
                        else None
                    ),
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

        for i, chunk in enumerate(chunk_rows):
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
                    "id": chunk["id"],
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

        persisted_assets = persist_learning_assets(
            conn,
            document_id=doc_id,
            revision_id=revision_id,
            assets=learning_assets,
        )

    from app.services.bm25_retriever import refresh_bm25_index
    refresh_bm25_index()

    return {
        "status": "success",
        "document_id": doc_id,
        "revision_id": revision_id,
        "chunks_created": len(chunk_rows),
        "page_count": extraction.get("page_count", 0),
        "page_vl_embeddings_created": len(page_vl_embeddings),
        "training_module_id": persisted_assets.get("module_id"),
        "assessment_id": persisted_assets.get("assessment_id"),
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
        identity = _prepare_document_identity(conn, code=code)
        app_settings = _get_app_settings(conn)

    doc_id = identity["document_id"]
    revision_id = str(uuid.uuid4())
    temp_path = upload_dir / f"{code}_{revision_id}.txt"
    temp_path.write_text(content, encoding="utf-8")

    from app.services.sop_pipeline import process_document
    from app.services.embedding_service import embed_texts

    extraction = process_document(str(temp_path), doc_id, revision_id)
    raw_chunks = extraction.get("chunks", [])
    pages = extraction.get("pages", [])
    if not raw_chunks:
        raise HTTPException(status_code=400, detail="Could not chunk content")

    chunk_rows = []
    for chunk in raw_chunks:
        chunk_id = str(uuid.uuid4())
        chunk_rows.append({**chunk, "id": chunk_id, "source_chunk_id": chunk_id})

    contents = [c["content"] for c in chunk_rows]
    embeddings = embed_texts(contents)
    page_vl_embeddings = _build_page_vl_embedding_map(pages)
    learning_assets = generate_learning_assets(
        document_code=code,
        document_title=title,
        document_type=document_type,
        chunks=chunk_rows,
    )
    if learning_assets.get("module"):
        learning_assets["module"]["validity_days"] = int(app_settings.get("certification_validity_days", 365))
    if learning_assets.get("assessment"):
        learning_assets["assessment"]["passing_score"] = float(app_settings.get("assessment_passing_score", 70))

    with engine.begin() as conn:
        _persist_document_revision(
            conn,
            document_id=doc_id,
            revision_id=revision_id,
            code=code,
            title=title,
            document_type=document_type,
            department=department,
            source_filename=temp_path.name,
            file_path=str(temp_path),
            page_count=extraction.get("page_count", 1),
            classification=extraction.get("classification", "digital"),
            version_number=identity["version_number"],
            revision_label=identity["revision_label"],
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
                        raw_text, markdown_path, image_path, ocr_used, ocr_confidence,
                        vl_embedding, vl_embedding_model, created_at
                    )
                    VALUES (
                        CAST(:id AS uuid), CAST(:revision_id AS uuid), :page_number, :classification,
                        :extracted_text_chars, :raw_text, :markdown_path, :image_path, :ocr_used,
                        :ocr_confidence, :vl_embedding, :vl_embedding_model, NOW()
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
                    "vl_embedding": (
                        "[" + ",".join(str(x) for x in page_vl_embeddings[page["page_number"]]["embedding"]) + "]"
                        if page.get("page_number") in page_vl_embeddings
                        else None
                    ),
                    "vl_embedding_model": (
                        page_vl_embeddings[page["page_number"]]["model"]
                        if page.get("page_number") in page_vl_embeddings
                        else None
                    ),
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

        for i, chunk in enumerate(chunk_rows):
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
                    "id": chunk["id"],
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

        persisted_assets = persist_learning_assets(
            conn,
            document_id=doc_id,
            revision_id=revision_id,
            assets=learning_assets,
        )

    from app.services.bm25_retriever import refresh_bm25_index
    refresh_bm25_index()

    return {
        "status": "success",
        "document_id": doc_id,
        "revision_id": revision_id,
        "chunks_created": len(chunk_rows),
        "page_vl_embeddings_created": len(page_vl_embeddings),
        "training_module_id": persisted_assets.get("module_id"),
        "assessment_id": persisted_assets.get("assessment_id"),
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
