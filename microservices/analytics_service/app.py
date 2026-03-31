from __future__ import annotations

from fastapi import FastAPI
from sqlalchemy import text

from microservices.shared.runtime import engine, get_user, iso, require_admin_or_supervisor, service_health


app = FastAPI(title="analytics-service", version="1.0.0")


@app.get("/health")
def health():
    return service_health("analytics-service")


@app.get("/admin/readiness/overview")
def admin_readiness_overview(user_id: str):
    with engine.connect() as conn:
        user = get_user(conn, user_id)
        require_admin_or_supervisor(user)

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
        row["day"] = iso(row["day"])

    for row in operator_rows:
        total = int(row["mandatory_total"] or 0)
        completed = int(row["mandatory_completed"] or 0)
        row["completion_rate"] = round((completed / total) * 100, 2) if total else 0.0
        row["latest_cert_expiry"] = iso(row["latest_cert_expiry"])

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
