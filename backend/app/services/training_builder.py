from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import text

from app.core.config import get_settings


CERT_NAMESPACE = uuid.UUID("f4fb73e3-7ca8-4c8e-98cd-ebad753d7b3c")
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"


def _det_uuid(*parts: object) -> str:
    source = "|".join(str(part) for part in parts)
    return str(uuid.uuid5(CERT_NAMESPACE, source))


def _split_sentences(text: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", (text or "")).strip()
    if not normalized:
        return []
    raw_parts = re.split(r"(?<=[.!?])\s+", normalized)
    parts = [part.strip(" -:;") for part in raw_parts if len(part.strip()) > 20]
    return parts


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


METADATA_PATTERNS = [
    r"\bEffective\s+Date\s*[:#]?\s*[\d/\-.]+",
    r"\bProcedure\s*#?\s*[:#]?\s*[A-Z0-9.\-_/]+",
    r"\bIssue\s*[:#]?\s*\d+\b",
    r"\bRevision\s*[:#]?\s*\d+\b",
    r"\bPage\s+\d+\s+of\s+\d+\b",
    r"\bApproved\s+by\s*[:#]?\s*[^.]+",
    r"\bThis\s+Document\s+is\s+the\s+property\s+of\b[^.]+",
    r"\bManaging\s+Director\b",
    r"\bTABLE\s+OF\s+CONTENTS\b",
]

NOISE_MARKERS = (
    "effective date",
    "procedure #",
    "table of contents",
    "approved by",
    "revision",
    "issue :",
    "page 1 of",
    "page 2 of",
    "property of",
)

ACTION_MARKERS = (
    "shall",
    "must",
    "ensure",
    "before",
    "after",
    "wear",
    "check",
    "use",
    "keep",
    "inspect",
    "confirm",
    "do not",
    "never",
    "always",
    "only",
    "required",
)


def _normalize_content(text: str) -> str:
    value = re.sub(r"[|]+", " ", text or "")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def _strip_metadata_noise(text: str) -> str:
    cleaned = _normalize_content(text)
    for pattern in METADATA_PATTERNS:
        cleaned = re.sub(pattern, " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"\b(?:INTENT|PRINCIPLES|DEFINITION|DEFINITIONS|TABLE OF CONTENTS|RESPONSIBILITIES|PROCEDURE|REFERENCES|RECORDS)\b",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -:;,.")
    return cleaned


def _sentence_score(sentence: str) -> int:
    lowered = sentence.lower()
    score = 0
    score += sum(3 for marker in ACTION_MARKERS if marker in lowered)
    score -= sum(5 for marker in NOISE_MARKERS if marker in lowered)
    score += min(len(sentence) // 60, 3)
    if re.search(r"\b\d+\.\d+\b", sentence):
        score += 1
    if re.search(r"[a-z]{3,}", sentence):
        score += 1
    if len(re.findall(r"\b(?:I|II|III|IV|V|VI|VII|VIII|IX|X)\.", sentence)) >= 3:
        score -= 12
    return score


def _extract_operator_sentences(text: str, limit: int = 4) -> list[str]:
    cleaned = _strip_metadata_noise(text)
    if not cleaned:
        return []
    raw_parts = re.split(r"(?<=[.!?;])\s+|\s+(?=\(\w\)\s)|\s+(?=\d+\.\d+\s)", cleaned)
    sentences: list[str] = []
    seen: set[str] = set()
    for part in raw_parts:
        sentence = re.sub(r"\s+", " ", part).strip(" -:;,")
        if len(sentence) < 35:
            continue
        key = sentence.lower()
        if key in seen:
            continue
        seen.add(key)
        sentences.append(sentence)
    ranked = sorted(sentences, key=_sentence_score, reverse=True)
    return ranked[:limit]


def _prepare_step_instruction(text: str) -> str:
    sentences = _extract_operator_sentences(text, limit=4)
    if sentences:
        return _truncate(" ".join(sentences), 900)
    return _truncate(_strip_metadata_noise(text), 900)


def _chunk_quality_score(chunk: dict[str, Any]) -> int:
    content = _normalize_content(chunk.get("content", ""))
    if len(content) < 80:
        return -999
    score = 0
    lowered = content.lower()
    score += sum(3 for marker in ACTION_MARKERS if marker in lowered)
    score -= sum(6 for marker in NOISE_MARKERS if marker in lowered)
    score += min(len(_extract_operator_sentences(content, limit=4)), 4) * 4
    if chunk.get("section_title"):
        score += 2
    if (chunk.get("page_start") or 0) >= 3:
        score += 2
    else:
        score -= 8
    if re.match(r"^page\s+\d+\s+of\s+\d+", lowered):
        score -= 10
    if len(re.findall(r"\b(?:I|II|III|IV|V|VI|VII|VIII|IX|X)\.", content)) >= 4:
        score -= 14
    if "sop" in lowered and "page" in lowered and "revision" in lowered:
        score -= 10
    return score


def _make_step_title(chunk: dict[str, Any], step_number: int) -> str:
    section_title = (chunk.get("section_title") or "").strip()
    if section_title:
        return _truncate(section_title, 90)

    sentences = _extract_operator_sentences(chunk.get("content", ""), limit=2)
    if sentences:
        first = re.sub(r"^[\d.\- )(:]+", "", sentences[0]).strip()
        if first:
            return _truncate(first, 90)

    citation = (chunk.get("citation_label") or "").strip()
    if citation:
        return f"Step {step_number}: {citation}"
    return f"Step {step_number}"


def _step_summary(content: str) -> str:
    sentences = _extract_operator_sentences(content, limit=2)
    if sentences:
        return _truncate(sentences[0], 240)
    return _truncate(_strip_metadata_noise(content), 240)


def _voice_prompt_from_content(content: str) -> str:
    summary = _step_summary(content)
    summary = re.sub(r"\s+", " ", summary).strip()
    return _truncate(summary, 220)


def _heuristic_distractors(summary: str) -> list[str]:
    generic = [
        "Skip this check unless a supervisor explicitly requests it.",
        "Complete the next operation first and return to this task later.",
        "Treat this step as optional when production demand is high.",
        "Rely on memory instead of the documented procedure for this activity.",
    ]
    distractors: list[str] = []
    lowered = summary.lower()
    for item in generic:
        if item.lower() not in lowered:
            distractors.append(item)
        if len(distractors) == 3:
            break
    while len(distractors) < 3:
        distractors.append("Use an alternate undocumented method if the step seems repetitive.")
    return distractors


def _fallback_questions(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    questions = []
    for index, step in enumerate(steps[:5], start=1):
        summary = _step_summary(step["instruction"])
        distractors = _heuristic_distractors(summary)
        questions.append(
            {
                "question_order": index,
                "concept_tag": step["title"][:64],
                "question_text": f"What is the correct instruction for '{step['title']}'?",
                "options": [
                    {"id": "A", "text": summary},
                    {"id": "B", "text": distractors[0]},
                    {"id": "C", "text": distractors[1]},
                    {"id": "D", "text": distractors[2]},
                ],
                "correct_option": "A",
                "explanation": summary,
                "source_chunk_id": step["source_chunk_id"],
            }
        )
    return questions


def _extract_json_array(content: str) -> list[dict[str, Any]] | None:
    content = content.strip()
    if not content:
        return None

    fenced = re.search(r"```(?:json)?\s*(\[.*\])\s*```", content, flags=re.DOTALL)
    if fenced:
        content = fenced.group(1)
    else:
        start = content.find("[")
        end = content.rfind("]")
        if start >= 0 and end > start:
            content = content[start : end + 1]

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, list):
        return [item for item in parsed if isinstance(item, dict)]
    return None


def _llm_questions(document_title: str, steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    settings = get_settings()
    if not settings.GROQ_API_KEY or not steps:
        return []

    source_blocks = []
    for step in steps[:5]:
        source_blocks.append(
            {
                "title": step["title"],
                "instruction": step["instruction"],
                "source_chunk_id": step["source_chunk_id"],
            }
        )

    prompt = {
        "document_title": document_title,
        "instructions": source_blocks,
        "task": (
            "Create 4 multiple-choice questions for plant operators using ONLY the provided source text. "
            "Return strict JSON array. Each item must contain: "
            "concept_tag, question_text, options (array of exactly 4 strings), correct_option "
            "(one of A/B/C/D), explanation, source_chunk_id. "
            "Make the questions operational, factual, and grounded in the text."
        ),
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                GROQ_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.GROQ_MODEL,
                    "messages": [
                        {
                            "role": "system",
                            "content": "You generate strict JSON for grounded plant-operator assessments.",
                        },
                        {"role": "user", "content": json.dumps(prompt)},
                    ],
                    "temperature": 0.2,
                    "max_tokens": 1200,
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
    except Exception:
        return []

    parsed = _extract_json_array(content)
    if not parsed:
        return []

    questions = []
    for index, item in enumerate(parsed[:5], start=1):
        options = item.get("options")
        correct_option = str(item.get("correct_option", "")).strip().upper()
        source_chunk_id = item.get("source_chunk_id")
        if not isinstance(options, list) or len(options) != 4 or correct_option not in {"A", "B", "C", "D"}:
            continue
        if not isinstance(source_chunk_id, str) or not source_chunk_id.strip():
            continue

        normalized_options = []
        for label, text_value in zip(("A", "B", "C", "D"), options):
            normalized_options.append({"id": label, "text": _truncate(str(text_value).strip(), 220)})

        questions.append(
            {
                "question_order": index,
                "concept_tag": _truncate(str(item.get("concept_tag") or f"Concept {index}").strip(), 64),
                "question_text": _truncate(str(item.get("question_text") or "").strip(), 300),
                "options": normalized_options,
                "correct_option": correct_option,
                "explanation": _truncate(str(item.get("explanation") or "").strip(), 500),
                "source_chunk_id": source_chunk_id.strip(),
            }
        )

    return questions


def generate_learning_assets(
    *,
    document_code: str,
    document_title: str,
    document_type: str,
    chunks: list[dict[str, Any]],
) -> dict[str, Any]:
    scored_chunks = [
        (chunk, _chunk_quality_score(chunk))
        for chunk in chunks
        if len((chunk.get("content") or "").strip()) >= 80
    ]
    viable_chunks = [item for item in scored_chunks if item[1] > 0]
    if viable_chunks:
        selected_chunks = [
            chunk
            for chunk, _score in sorted(
                viable_chunks,
                key=lambda item: (
                    -item[1],
                    item[0].get("page_start") or 0,
                    item[0].get("chunk_index") or 0,
                ),
            )[:6]
        ]
        selected_chunks = sorted(
            selected_chunks,
            key=lambda item: (item.get("page_start") or 0, item.get("chunk_index") or 0),
        )
    else:
        selected_chunks = [
            chunk
            for chunk, _score in sorted(
                scored_chunks,
                key=lambda item: (
                    -item[1],
                    item[0].get("page_start") or 0,
                    item[0].get("chunk_index") or 0,
                ),
            )[:3]
        ]

    steps = []
    for index, chunk in enumerate(selected_chunks, start=1):
        content = _prepare_step_instruction(chunk.get("content") or "")
        if len(content) < 35:
            continue
        steps.append(
            {
                "step_number": index,
                "title": _make_step_title(chunk, index),
                "instruction": content,
                "voice_prompt": _voice_prompt_from_content(content),
                "operator_check": _step_summary(content),
                "source_chunk_id": chunk.get("source_chunk_id") or chunk.get("id"),
                "citation_label": chunk.get("citation_label"),
                "page_start": chunk.get("page_start"),
            }
        )

    if not steps:
        return {"module": None, "steps": [], "assessment": None, "questions": []}

    questions = _llm_questions(document_title, steps)
    if not questions:
        questions = _fallback_questions(steps)

    hazard_tokens = ("warning", "hazard", "ppe", "shutdown", "critical", "caution")
    joined_text = " ".join(step["instruction"].lower() for step in steps)
    criticality = "high" if any(token in joined_text for token in hazard_tokens) else "normal"

    module = {
        "title": f"{document_code} - {document_title}",
        "description": (
            f"Auto-generated guided training for {document_type.upper()} document {document_code}. "
            "This module is grounded in the latest approved revision."
        ),
        "language": "en",
        "module_type": "mandatory",
        "criticality": criticality,
        "validity_days": 365,
        "total_steps": len(steps),
        "is_published": True,
    }
    assessment = {
        "title": f"{document_title} Readiness Assessment",
        "passing_score": 70.0,
        "time_limit_seconds": max(180, len(questions) * 75),
        "certification_label": f"{document_code} Operator Readiness",
    }
    return {
        "module": module,
        "steps": steps,
        "assessment": assessment,
        "questions": questions,
    }


def persist_learning_assets(
    conn,
    *,
    document_id: str,
    revision_id: str,
    assets: dict[str, Any],
) -> dict[str, Any]:
    module = assets.get("module")
    steps = assets.get("steps") or []
    assessment = assets.get("assessment")
    questions = assets.get("questions") or []
    if not module or not steps or not assessment:
        return {"module_id": None, "assessment_id": None}

    module_id = _det_uuid("training_module", document_id)
    assessment_id = _det_uuid("assessment", module_id)

    conn.execute(
        text("DELETE FROM certifications WHERE module_id = CAST(:module_id AS uuid)"),
        {"module_id": module_id},
    )
    conn.execute(
        text(
            """
            DELETE FROM assessment_attempts
            WHERE assessment_id IN (
                SELECT id FROM assessments WHERE module_id = CAST(:module_id AS uuid)
            )
            """
        ),
        {"module_id": module_id},
    )
    conn.execute(
        text(
            """
            DELETE FROM assessment_questions
            WHERE assessment_id IN (
                SELECT id FROM assessments WHERE module_id = CAST(:module_id AS uuid)
            )
            """
        ),
        {"module_id": module_id},
    )
    conn.execute(
        text("DELETE FROM assessments WHERE module_id = CAST(:module_id AS uuid)"),
        {"module_id": module_id},
    )
    conn.execute(
        text("DELETE FROM training_steps WHERE module_id = CAST(:module_id AS uuid)"),
        {"module_id": module_id},
    )
    conn.execute(
        text("DELETE FROM training_assignments WHERE module_id = CAST(:module_id AS uuid)"),
        {"module_id": module_id},
    )

    conn.execute(
        text(
            """
            INSERT INTO training_modules (
                id, source_document_id, source_revision_id, title, description, language,
                module_type, criticality, validity_days, total_steps, is_published, created_at, updated_at
            )
            VALUES (
                CAST(:id AS uuid), CAST(:source_document_id AS uuid), CAST(:source_revision_id AS uuid),
                :title, :description, :language, :module_type, :criticality,
                :validity_days, :total_steps, :is_published, NOW(), NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
                source_document_id = EXCLUDED.source_document_id,
                source_revision_id = EXCLUDED.source_revision_id,
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                language = EXCLUDED.language,
                module_type = EXCLUDED.module_type,
                criticality = EXCLUDED.criticality,
                validity_days = EXCLUDED.validity_days,
                total_steps = EXCLUDED.total_steps,
                is_published = EXCLUDED.is_published,
                updated_at = NOW()
            """
        ),
        {
            "id": module_id,
            "source_document_id": document_id,
            "source_revision_id": revision_id,
            **module,
        },
    )

    for step in steps:
        step_id = _det_uuid("training_step", module_id, step["step_number"])
        conn.execute(
            text(
                """
                INSERT INTO training_steps (
                    id, module_id, step_number, title, instruction, voice_prompt,
                    operator_check, source_chunk_id, created_at
                )
                VALUES (
                    CAST(:id AS uuid), CAST(:module_id AS uuid), :step_number, :title, :instruction,
                    :voice_prompt, :operator_check, CAST(:source_chunk_id AS uuid), NOW()
                )
                """
            ),
            {
                "id": step_id,
                "module_id": module_id,
                **step,
            },
        )

    conn.execute(
        text(
            """
            INSERT INTO assessments (
                id, module_id, title, passing_score, time_limit_seconds, certification_label, created_at
            )
            VALUES (
                CAST(:id AS uuid), CAST(:module_id AS uuid), :title, :passing_score,
                :time_limit_seconds, :certification_label, NOW()
            )
            """
        ),
        {
            "id": assessment_id,
            "module_id": module_id,
            **assessment,
        },
    )

    for question in questions:
        question_id = _det_uuid("assessment_question", assessment_id, question["question_order"])
        conn.execute(
            text(
                """
                INSERT INTO assessment_questions (
                    id, assessment_id, question_order, concept_tag, question_text,
                    options, correct_option, explanation, source_chunk_id, created_at
                )
                VALUES (
                    CAST(:id AS uuid), CAST(:assessment_id AS uuid), :question_order, :concept_tag,
                    :question_text, CAST(:options AS jsonb), :correct_option, :explanation,
                    CAST(:source_chunk_id AS uuid), NOW()
                )
                """
            ),
            {
                "id": question_id,
                "assessment_id": assessment_id,
                "question_order": question["question_order"],
                "concept_tag": question["concept_tag"],
                "question_text": question["question_text"],
                "options": json.dumps(question["options"]),
                "correct_option": question["correct_option"],
                "explanation": question["explanation"],
                "source_chunk_id": question["source_chunk_id"],
            },
        )

    operator_ids = [
        row["id"]
        for row in conn.execute(
            text("SELECT id::text AS id FROM users WHERE role = 'operator' ORDER BY full_name")
        ).mappings()
    ]
    notifications_enabled = bool(
        conn.execute(
            text("SELECT to_regclass('public.notifications') IS NOT NULL")
        ).scalar()
    )
    due_at = datetime.now(timezone.utc) + timedelta(days=21)
    for user_id in operator_ids:
        assignment_id = _det_uuid("training_assignment", module_id, user_id)
        conn.execute(
            text(
                """
                INSERT INTO training_assignments (
                    id, user_id, module_id, is_mandatory, due_at, status,
                    progress_percent, current_step, started_at, completed_at,
                    last_activity_at, created_at, updated_at
                )
                VALUES (
                    CAST(:id AS uuid), CAST(:user_id AS uuid), CAST(:module_id AS uuid),
                    true, :due_at, 'assigned', 0, 1, NULL, NULL, NULL, NOW(), NOW()
                )
                ON CONFLICT (id) DO UPDATE SET
                    due_at = EXCLUDED.due_at,
                    status = 'assigned',
                    progress_percent = 0,
                    current_step = 1,
                    started_at = NULL,
                    completed_at = NULL,
                    last_activity_at = NULL,
                    updated_at = NOW()
                """
            ),
            {
                "id": assignment_id,
                "user_id": user_id,
                "module_id": module_id,
                "due_at": due_at,
            },
        )
        if notifications_enabled:
            conn.execute(
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
                        'training_assigned',
                        'medium',
                        :title,
                        :message,
                        :cta_url,
                        'in_app',
                        :event_key,
                        'unread'
                    )
                    ON CONFLICT (event_key) DO UPDATE SET
                        title = EXCLUDED.title,
                        message = EXCLUDED.message,
                        cta_url = EXCLUDED.cta_url,
                        status = 'unread',
                        read_at = NULL,
                        created_at = now()
                    """
                ),
                {
                    "user_id": user_id,
                    "title": "New training assigned",
                    "message": f"{module['title']} is ready. Open training to start the guided steps and quiz.",
                    "cta_url": f"/operator/training/{module_id}",
                    "event_key": f"training_assigned:{module_id}:{user_id}:{revision_id}",
                },
            )

    return {"module_id": module_id, "assessment_id": assessment_id}
