from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from microservices.shared.runtime import det_uuid, engine, get_user, service_health


class AssessmentSubmitRequest(BaseModel):
    user_id: str
    responses: dict[str, str] = Field(default_factory=dict)


app = FastAPI(title="assessment-service", version="1.0.0")


@app.get("/health")
def health():
    return service_health("assessment-service")


@app.get("/assessments/{assessment_id}")
def assessment_details(assessment_id: str, user_id: str):
    with engine.connect() as conn:
        user = get_user(conn, user_id)
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


@app.post("/assessments/{assessment_id}/submit")
def submit_assessment(assessment_id: str, req: AssessmentSubmitRequest):
    if not req.responses:
        raise HTTPException(status_code=400, detail="At least one response is required")

    now = datetime.now(timezone.utc)
    with engine.begin() as conn:
        user = get_user(conn, req.user_id)
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
            cert_id = det_uuid("certification", req.user_id, assessment["module_id"])
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
