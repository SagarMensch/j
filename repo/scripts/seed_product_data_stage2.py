from __future__ import annotations

import argparse
import json
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import text


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.db.postgres import engine


UUID_NAMESPACE = uuid.UUID("3e93bcd8-2ea2-4f5a-b2e7-5c0ef05cbbfd")


@dataclass
class SeedUser:
    key: str
    employee_code: str
    full_name: str
    email: str
    role: str
    preferred_language: str
    department: str


SEED_USERS: list[SeedUser] = [
    SeedUser(
        key="operator_1",
        employee_code="OPR-1001",
        full_name="Ravi Kumar",
        email="ravi.kumar@jubilantingrevia.com",
        role="operator",
        preferred_language="hing",
        department="operations",
    ),
    SeedUser(
        key="supervisor_1",
        employee_code="SUP-2001",
        full_name="Anita Sharma",
        email="anita.sharma@jubilantingrevia.com",
        role="supervisor",
        preferred_language="en",
        department="operations",
    ),
    SeedUser(
        key="admin_1",
        employee_code="ADM-3001",
        full_name="Sanjay Mehta",
        email="sanjay.mehta@jubilantingrevia.com",
        role="admin",
        preferred_language="en",
        department="safety",
    ),
]


def deterministic_uuid(*parts: object) -> str:
    raw = "|".join(str(part) for part in parts)
    return str(uuid.uuid5(UUID_NAMESPACE, raw))


def clean_text(value: str, max_len: int) -> str:
    compact = " ".join((value or "").replace("\x00", "").split())
    return compact[:max_len].strip()


def first_sentence(value: str, max_len: int = 180) -> str:
    text_value = clean_text(value, 2000)
    if not text_value:
        return ""
    for sep in (". ", "; ", ": ", " - "):
        if sep in text_value:
            text_value = text_value.split(sep, 1)[0]
            break
    return text_value[:max_len].strip()


def parse_args():
    parser = argparse.ArgumentParser(
        description="Seed production UI entities from real Stage-1 chunks (users/modules/training/assessments).",
    )
    parser.add_argument("--max-modules", type=int, default=12)
    parser.add_argument("--steps-per-module", type=int, default=6)
    parser.add_argument("--questions-per-assessment", type=int, default=5)
    return parser.parse_args()


def upsert_departments(conn) -> dict[str, str]:
    departments = ["operations", "safety", "maintenance", "training"]
    ids: dict[str, str] = {}
    for name in departments:
        dep_id = deterministic_uuid("department", name)
        conn.execute(
            text(
                """
                INSERT INTO departments (id, name)
                VALUES (CAST(:id AS uuid), :name)
                ON CONFLICT (name) DO UPDATE SET updated_at = now()
                """
            ),
            {"id": dep_id, "name": name},
        )
        ids[name] = dep_id
    return ids


def upsert_users(conn, department_ids: dict[str, str]) -> dict[str, str]:
    user_ids: dict[str, str] = {}
    for user in SEED_USERS:
        user_id = deterministic_uuid("user", user.key)
        user_ids[user.key] = user_id
        conn.execute(
            text(
                """
                INSERT INTO users (
                    id, employee_code, full_name, email, role, preferred_language, department_id
                ) VALUES (
                    CAST(:id AS uuid), :employee_code, :full_name, :email, :role, :preferred_language, CAST(:department_id AS uuid)
                )
                ON CONFLICT (email) DO UPDATE SET
                    employee_code = EXCLUDED.employee_code,
                    full_name = EXCLUDED.full_name,
                    role = EXCLUDED.role,
                    preferred_language = EXCLUDED.preferred_language,
                    department_id = EXCLUDED.department_id,
                    updated_at = now()
                """
            ),
            {
                "id": user_id,
                "employee_code": user.employee_code,
                "full_name": user.full_name,
                "email": user.email,
                "role": user.role,
                "preferred_language": user.preferred_language,
                "department_id": department_ids[user.department],
            },
        )
    return user_ids


def fetch_revision_candidates(conn, max_modules: int) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT
                d.id::text AS document_id,
                d.code,
                d.title,
                dr.id::text AS revision_id,
                dr.revision_label,
                dr.page_count
            FROM document_revisions dr
            JOIN documents d ON d.id = dr.document_id
            WHERE dr.is_latest_approved = true
            ORDER BY dr.page_count DESC NULLS LAST, d.code
            LIMIT :limit
            """
        ),
        {"limit": max_modules},
    ).mappings()
    return [dict(row) for row in rows]


def fetch_revision_chunks(conn, revision_id: str, limit: int) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT
                id::text AS chunk_id,
                chunk_index,
                page_start,
                page_end,
                section_title,
                citation_label,
                content,
                safety_flags
            FROM document_chunks
            WHERE revision_id = CAST(:revision_id AS uuid)
              AND length(content) >= 120
            ORDER BY
                CASE WHEN jsonb_array_length(safety_flags) > 0 THEN 0 ELSE 1 END,
                chunk_index
            LIMIT :limit
            """
        ),
        {"revision_id": revision_id, "limit": limit},
    ).mappings()
    return [dict(row) for row in rows]


def upsert_module(conn, revision: dict, chunks: list[dict]) -> str:
    module_id = deterministic_uuid("module", revision["revision_id"])
    lead = chunks[0]
    lead_section = clean_text(lead.get("section_title") or "", 120)
    module_title = clean_text(f"{revision['code'].upper()} Operational Readiness", 180)
    module_description = clean_text(
        f"Built from {revision['title']} ({revision['revision_label'] or 'latest'}) for plant-floor execution. Focus area: {lead_section or 'core operating sequence'}.",
        400,
    )
    criticality = "critical" if lead.get("safety_flags") else "normal"

    conn.execute(
        text(
            """
            INSERT INTO training_modules (
                id, source_document_id, source_revision_id, title, description,
                language, module_type, criticality, validity_days, total_steps, is_published
            ) VALUES (
                CAST(:id AS uuid), CAST(:source_document_id AS uuid), CAST(:source_revision_id AS uuid),
                :title, :description, 'en', 'mandatory', :criticality, 365, :total_steps, true
            )
            ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                criticality = EXCLUDED.criticality,
                total_steps = EXCLUDED.total_steps,
                is_published = true,
                updated_at = now()
            """
        ),
        {
            "id": module_id,
            "source_document_id": revision["document_id"],
            "source_revision_id": revision["revision_id"],
            "title": module_title,
            "description": module_description,
            "criticality": criticality,
            "total_steps": len(chunks),
        },
    )
    return module_id


def upsert_steps(conn, module_id: str, chunks: list[dict]):
    conn.execute(
        text("DELETE FROM training_steps WHERE module_id = CAST(:module_id AS uuid)"),
        {"module_id": module_id},
    )
    for idx, chunk in enumerate(chunks, start=1):
        instruction = clean_text(chunk["content"], 900)
        section = clean_text(chunk.get("section_title") or f"Step {idx}", 140)
        voice_prompt = first_sentence(instruction, 220) or f"Proceed with step {idx}."
        operator_check = clean_text(
            f"Confirm completion of '{section}' as per {chunk.get('citation_label') or 'document evidence'}.",
            240,
        )
        conn.execute(
            text(
                """
                INSERT INTO training_steps (
                    id, module_id, step_number, title, instruction,
                    voice_prompt, operator_check, source_chunk_id
                ) VALUES (
                    CAST(:id AS uuid), CAST(:module_id AS uuid), :step_number, :title, :instruction,
                    :voice_prompt, :operator_check, CAST(:source_chunk_id AS uuid)
                )
                """
            ),
            {
                "id": deterministic_uuid("step", module_id, idx),
                "module_id": module_id,
                "step_number": idx,
                "title": section,
                "instruction": instruction,
                "voice_prompt": voice_prompt,
                "operator_check": operator_check,
                "source_chunk_id": chunk["chunk_id"],
            },
        )


def build_question_options(correct: str, distractors: list[str], seed: int) -> tuple[list[dict], str]:
    letters = ["A", "B", "C", "D"]
    while len(distractors) < 3:
        distractors.append("Escalate to supervisor and verify approved SOP revision before action.")
    ordered = distractors[:3]
    correct_pos = seed % 4
    option_values: list[str] = []
    for idx in range(4):
        if idx == correct_pos:
            option_values.append(correct)
        else:
            option_values.append(ordered.pop(0))
    options = [{"id": letters[idx], "text": clean_text(value, 240)} for idx, value in enumerate(option_values)]
    return options, letters[correct_pos]


def upsert_assessment(conn, module_id: str, chunks: list[dict], limit: int):
    assessment_id = deterministic_uuid("assessment", module_id)
    conn.execute(
        text(
            """
            INSERT INTO assessments (
                id, module_id, title, passing_score, time_limit_seconds, certification_label
            ) VALUES (
                CAST(:id AS uuid), CAST(:module_id AS uuid), :title, 80, 900, :certification_label
            )
            ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                passing_score = EXCLUDED.passing_score,
                time_limit_seconds = EXCLUDED.time_limit_seconds,
                certification_label = EXCLUDED.certification_label
            """
        ),
        {
            "id": assessment_id,
            "module_id": module_id,
            "title": "Mandatory Readiness Assessment",
            "certification_label": "Operator Readiness Certified",
        },
    )

    conn.execute(
        text("DELETE FROM assessment_questions WHERE assessment_id = CAST(:assessment_id AS uuid)"),
        {"assessment_id": assessment_id},
    )

    short_snippets = [first_sentence(chunk["content"], 170) for chunk in chunks]
    short_snippets = [snippet for snippet in short_snippets if snippet]
    used = min(limit, len(chunks))
    for idx in range(used):
        chunk = chunks[idx]
        correct = first_sentence(chunk["content"], 210)
        if not correct:
            continue

        distractors_pool = [snippet for snippet in short_snippets if snippet != correct]
        distractors = distractors_pool[:3]
        options, correct_option = build_question_options(correct, distractors, idx)
        concept_tag = clean_text(chunk.get("section_title") or "operations", 100)
        citation = clean_text(chunk.get("citation_label") or "approved SOP", 80)
        question_text = clean_text(
            f"From {citation}, which statement best matches the required action?",
            260,
        )
        explanation = clean_text(
            f"Correct answer is extracted directly from source evidence ({citation}) to prevent inference drift.",
            240,
        )
        conn.execute(
            text(
                """
                INSERT INTO assessment_questions (
                    id, assessment_id, question_order, concept_tag, question_text,
                    options, correct_option, explanation, source_chunk_id
                ) VALUES (
                    CAST(:id AS uuid), CAST(:assessment_id AS uuid), :question_order, :concept_tag, :question_text,
                    CAST(:options AS jsonb), :correct_option, :explanation, CAST(:source_chunk_id AS uuid)
                )
                """
            ),
            {
                "id": deterministic_uuid("question", assessment_id, idx + 1),
                "assessment_id": assessment_id,
                "question_order": idx + 1,
                "concept_tag": concept_tag,
                "question_text": question_text,
                "options": json.dumps(options),
                "correct_option": correct_option,
                "explanation": explanation,
                "source_chunk_id": chunk["chunk_id"],
            },
        )
    return assessment_id


def status_for(role: str, module_index: int) -> tuple[str, float]:
    if role == "operator":
        if module_index < 3:
            return "completed", 100.0
        if module_index < 7:
            return "in_progress", 45.0 + module_index
        return "assigned", 0.0
    if role == "supervisor":
        if module_index < 2:
            return "completed", 100.0
        if module_index < 5:
            return "in_progress", 35.0 + module_index * 2
        return "assigned", 0.0
    if module_index < 1:
        return "completed", 100.0
    return "assigned", 0.0


def upsert_assignments_and_attempts(conn, user_ids: dict[str, str], module_ids: list[str], assessment_ids: dict[str, str]):
    now = datetime.now(timezone.utc)
    for user in SEED_USERS:
        user_id = user_ids[user.key]
        for idx, module_id in enumerate(module_ids):
            status, progress = status_for(user.role, idx)
            assignment_id = deterministic_uuid("assignment", user_id, module_id)
            started_at = now - timedelta(days=7 - min(idx, 6)) if status in {"completed", "in_progress"} else None
            completed_at = now - timedelta(days=max(1, idx)) if status == "completed" else None
            due_at = now + timedelta(days=14 - min(idx, 10))
            current_step = None
            if status == "in_progress":
                current_step = max(1, min(5, int(progress // 20)))
            elif status == "completed":
                current_step = 6

            conn.execute(
                text(
                    """
                    INSERT INTO training_assignments (
                        id, user_id, module_id, is_mandatory, due_at, status,
                        progress_percent, current_step, started_at, completed_at, last_activity_at
                    ) VALUES (
                        CAST(:id AS uuid), CAST(:user_id AS uuid), CAST(:module_id AS uuid), :is_mandatory,
                        :due_at, :status, :progress_percent, :current_step, :started_at, :completed_at, :last_activity_at
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        is_mandatory = EXCLUDED.is_mandatory,
                        due_at = EXCLUDED.due_at,
                        status = EXCLUDED.status,
                        progress_percent = EXCLUDED.progress_percent,
                        current_step = EXCLUDED.current_step,
                        started_at = EXCLUDED.started_at,
                        completed_at = EXCLUDED.completed_at,
                        last_activity_at = EXCLUDED.last_activity_at,
                        updated_at = now()
                    """
                ),
                {
                    "id": assignment_id,
                    "user_id": user_id,
                    "module_id": module_id,
                    "is_mandatory": True if user.role == "operator" else idx < 6,
                    "due_at": due_at,
                    "status": status,
                    "progress_percent": progress,
                    "current_step": current_step,
                    "started_at": started_at,
                    "completed_at": completed_at,
                    "last_activity_at": completed_at or started_at or now,
                },
            )

            if status != "completed":
                continue

            assessment_id = assessment_ids[module_id]
            attempt_id = deterministic_uuid("attempt", user_id, assessment_id)
            score = 86.0 + (idx % 3) * 4
            conn.execute(
                text(
                    """
                    INSERT INTO assessment_attempts (
                        id, user_id, assessment_id, attempt_number, score, status,
                        started_at, completed_at, responses
                    ) VALUES (
                        CAST(:id AS uuid), CAST(:user_id AS uuid), CAST(:assessment_id AS uuid), 1, :score, 'completed',
                        :started_at, :completed_at, CAST(:responses AS jsonb)
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        score = EXCLUDED.score,
                        status = EXCLUDED.status,
                        completed_at = EXCLUDED.completed_at,
                        responses = EXCLUDED.responses
                    """
                ),
                {
                    "id": attempt_id,
                    "user_id": user_id,
                    "assessment_id": assessment_id,
                    "score": score,
                    "started_at": started_at or (now - timedelta(days=2)),
                    "completed_at": completed_at or (now - timedelta(days=1)),
                    "responses": json.dumps({"result": "auto-scored from deterministic seed"}),
                },
            )

            certification_id = deterministic_uuid("certification", user_id, module_id)
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
                        status = EXCLUDED.status,
                        issued_at = EXCLUDED.issued_at,
                        expires_at = EXCLUDED.expires_at,
                        last_attempt_id = EXCLUDED.last_attempt_id,
                        updated_at = now()
                    """
                ),
                {
                    "id": certification_id,
                    "user_id": user_id,
                    "module_id": module_id,
                    "issued_at": completed_at or now,
                    "expires_at": (completed_at or now) + timedelta(days=365),
                    "last_attempt_id": attempt_id,
                },
            )


def run_seed(args):
    with engine.begin() as conn:
        department_ids = upsert_departments(conn)
        user_ids = upsert_users(conn, department_ids)

        revisions = fetch_revision_candidates(conn, args.max_modules)
        module_ids: list[str] = []
        assessment_ids: dict[str, str] = {}

        for revision in revisions:
            chunks = fetch_revision_chunks(
                conn,
                revision["revision_id"],
                limit=max(args.steps_per_module + 2, args.questions_per_assessment + 2),
            )
            if len(chunks) < 4:
                continue

            selected_steps = chunks[: args.steps_per_module]
            module_id = upsert_module(conn, revision, selected_steps)
            upsert_steps(conn, module_id, selected_steps)
            assessment_id = upsert_assessment(conn, module_id, selected_steps, args.questions_per_assessment)

            module_ids.append(module_id)
            assessment_ids[module_id] = assessment_id

        upsert_assignments_and_attempts(conn, user_ids, module_ids, assessment_ids)

    with engine.connect() as conn:
        summary = {
            "users": int(conn.execute(text("SELECT count(*) FROM users")).scalar_one()),
            "training_modules": int(conn.execute(text("SELECT count(*) FROM training_modules")).scalar_one()),
            "training_steps": int(conn.execute(text("SELECT count(*) FROM training_steps")).scalar_one()),
            "training_assignments": int(conn.execute(text("SELECT count(*) FROM training_assignments")).scalar_one()),
            "assessments": int(conn.execute(text("SELECT count(*) FROM assessments")).scalar_one()),
            "assessment_questions": int(conn.execute(text("SELECT count(*) FROM assessment_questions")).scalar_one()),
            "assessment_attempts": int(conn.execute(text("SELECT count(*) FROM assessment_attempts")).scalar_one()),
            "certifications": int(conn.execute(text("SELECT count(*) FROM certifications")).scalar_one()),
        }
    print(json.dumps(summary, indent=2))


def main():
    args = parse_args()
    run_seed(args)


if __name__ == "__main__":
    main()
