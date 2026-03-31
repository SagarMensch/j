from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import get_settings  # noqa: E402
from app.db.neo4j import check_neo4j_connection  # noqa: E402
from app.db.postgres import check_postgres_connection, engine  # noqa: E402


settings = get_settings()
CERT_NAMESPACE = uuid.UUID("f4fb73e3-7ca8-4c8e-98cd-ebad753d7b3c")


def iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return str(value)


def det_uuid(*parts: object) -> str:
    raw = "|".join(str(part) for part in parts)
    return str(uuid.uuid5(CERT_NAMESPACE, raw))


def get_user(conn, user_id: str) -> dict[str, Any]:
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


def require_admin_or_supervisor(user: dict[str, Any]):
    if user["role"] not in {"admin", "supervisor"}:
        raise HTTPException(status_code=403, detail="Insufficient role")


def service_health(service_name: str) -> dict[str, Any]:
    pg = check_postgres_connection()
    graph = check_neo4j_connection()
    return {
        "service": service_name,
        "status": "ok",
        "postgres": {"host": pg["host"], "database": pg["database"], "server_time": pg["server_time"]},
        "neo4j": {"uri": graph["uri"], "database": graph["database"], "server_time": graph["server_time"]},
    }
