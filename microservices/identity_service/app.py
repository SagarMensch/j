from __future__ import annotations

from fastapi import FastAPI
from sqlalchemy import text

from microservices.shared.runtime import engine, service_health


app = FastAPI(title="identity-service", version="1.0.0")


@app.get("/health")
def health():
    return service_health("identity-service")


@app.get("/users")
def list_users():
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
