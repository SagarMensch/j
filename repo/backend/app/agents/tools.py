"""
Tool system for agents - gives agents the ability to query DB, calculate, and perform actions.
"""
from __future__ import annotations

import json
import re
from typing import Any, Callable
from sqlalchemy import text
from app.db.postgres import engine


class Tool:
    def __init__(self, name: str, description: str, func: Callable):
        self.name = name
        self.description = description
        self.func = func

    def run(self, **kwargs) -> str:
        try:
            result = self.func(**kwargs)
            return json.dumps(result, default=str)
        except Exception as e:
            return json.dumps({"error": str(e)})

    def to_schema(self) -> dict:
        return {"name": self.name, "description": self.description}


def query_training_modules(user_id: str = None, status: str = None) -> list[dict]:
    conditions = ["tm.is_active = true"]
    params = {}
    if status:
        conditions.append("ta.status = :status")
        params["status"] = status
    where = " AND ".join(conditions)
    sql = f"""
        SELECT tm.id::text, tm.title, tm.description, tm.module_type, tm.criticality,
               ta.status as assignment_status, ta.progress_percent, ta.due_at
        FROM training_modules tm
        LEFT JOIN training_assignments ta ON ta.module_id = tm.id
        {'AND ta.user_id = CAST(:user_id AS uuid)' if user_id else ''}
        WHERE {where}
        ORDER BY tm.created_at DESC
        LIMIT 10
    """
    if user_id:
        params["user_id"] = user_id
    with engine.connect() as conn:
        rows = conn.execute(text(sql), params).mappings().all()
        return [dict(r) for r in rows]


def query_assessment_scores(user_id: str) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT aa.id::text, aa.score, aa.passed, aa.completed_at,
                       a.title as assessment_title, tm.title as module_title
                FROM assessment_attempts aa
                JOIN assessments a ON a.id = aa.assessment_id
                LEFT JOIN training_modules tm ON tm.id = a.module_id
                WHERE aa.user_id = CAST(:user_id AS uuid)
                ORDER BY aa.completed_at DESC
                LIMIT 10
            """),
            {"user_id": user_id},
        ).mappings().all()
        return [dict(r) for r in rows]


def query_certifications(user_id: str) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT c.id::text, c.title, c.issued_at, c.expires_at, c.status
                FROM certifications c
                WHERE c.user_id = CAST(:user_id AS uuid)
                ORDER BY c.expires_at ASC
                LIMIT 10
            """),
            {"user_id": user_id},
        ).mappings().all()
        return [dict(r) for r in rows]


def query_department_stats() -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT d.name as department,
                       count(u.id) as operator_count,
                       round(100.0 * count(c.id) FILTER (WHERE c.status = 'active' AND c.expires_at > now())
                             / nullif(count(u.id), 0), 1) as compliance_rate
                FROM departments d
                LEFT JOIN users u ON u.department_id = d.id AND u.role = 'operator'
                LEFT JOIN certifications c ON c.user_id = u.id
                GROUP BY d.name
                ORDER BY d.name
            """),
        ).mappings().all()
        return [dict(r) for r in rows]


def query_document_chunks(query: str, top_k: int = 5, revision_id: str = None) -> list[dict]:
    from app.services.sop_retrieval import get_sop_retriever
    retriever = get_sop_retriever()
    result = retriever.query(
        query_text=query,
        language="en",
        role="operator",
        user_id=None,
        top_k=top_k,
        revision_id=revision_id,
    )
    return result.get("evidence", [])


def query_equipment_info(equipment_code: str) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT dc.content, dc.section_title, dc.citation_label,
                       d.code as document_code, d.title as document_title
                FROM document_chunks dc
                JOIN document_revisions dr ON dc.revision_id = dr.id
                JOIN documents d ON dr.document_id = d.id
                WHERE dr.is_latest_approved = true
                  AND dc.content ILIKE :pattern
                LIMIT 5
            """),
            {"pattern": f"%{equipment_code}%"},
        ).mappings().all()
        return [dict(r) for r in rows]


def log_grievance(user_id: str, category: str, description: str, urgency: str) -> dict:
    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO admin_audit_logs (id, action_type, actor_id, details)
                VALUES (gen_random_uuid(), 'grievance_reported', :actor_id, :details)
            """),
            {
                "actor_id": user_id,
                "details": json.dumps({"category": category, "urgency": urgency, "description": description[:500]}),
            },
        )
    return {"status": "logged", "category": category, "urgency": urgency}


TOOL_REGISTRY: list[Tool] = [
    Tool("query_training_modules", "Query training modules and assignments for a user", query_training_modules),
    Tool("query_assessment_scores", "Get assessment scores and results for a user", query_assessment_scores),
    Tool("query_certifications", "Get certifications and their expiry status for a user", query_certifications),
    Tool("query_department_stats", "Get department compliance and readiness statistics", query_department_stats),
    Tool("query_document_chunks", "Search approved documents for relevant content", query_document_chunks),
    Tool("query_equipment_info", "Get equipment information by equipment code", query_equipment_info),
    Tool("log_grievance", "Log a grievance or complaint for follow-up", log_grievance),
]


def get_tools() -> list[Tool]:
    return TOOL_REGISTRY


def get_tool_schemas() -> list[dict]:
    return [t.to_schema() for t in TOOL_REGISTRY]


def execute_tool(name: str, **kwargs) -> str:
    for tool in TOOL_REGISTRY:
        if tool.name == name:
            return tool.run(**kwargs)
    return json.dumps({"error": f"Tool '{name}' not found"})
