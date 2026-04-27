from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from microservices.shared.runtime import engine, get_user, iso, service_health


class AssignmentProgressRequest(BaseModel):
    user_id: str
    progress_percent: float = Field(ge=0, le=100)
    current_step: int | None = Field(default=None, ge=1)
    status: str | None = None


app = FastAPI(title="training-service", version="1.0.0")


@app.get("/health")
def health():
    return service_health("training-service")


@app.get("/dashboard/summary")
def dashboard_summary(user_id: str):
    with engine.connect() as conn:
        user = get_user(conn, user_id)

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
        row["due_at"] = iso(row["due_at"])
        row["completed_at"] = iso(row["completed_at"])
    for row in recent_sops:
        row["updated_at"] = iso(row["updated_at"])

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


@app.get("/training/assignments")
def training_assignments(user_id: str):
    with engine.connect() as conn:
        get_user(conn, user_id)
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
        row["due_at"] = iso(row["due_at"])
        row["started_at"] = iso(row["started_at"])
        row["completed_at"] = iso(row["completed_at"])
        row["last_activity_at"] = iso(row["last_activity_at"])
    return {"assignments": assignments}


@app.get("/training/modules/{module_id}")
def training_module_details(module_id: str, user_id: str):
    with engine.connect() as conn:
        user = get_user(conn, user_id)
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


@app.post("/training/assignments/{assignment_id}/progress")
def update_assignment_progress(assignment_id: str, req: AssignmentProgressRequest):
    now = datetime.now(timezone.utc)
    with engine.begin() as conn:
        assignment: dict[str, Any] | None = conn.execute(
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
    payload["started_at"] = iso(payload["started_at"])
    payload["completed_at"] = iso(payload["completed_at"])
    payload["last_activity_at"] = iso(payload["last_activity_at"])
    return payload
