"""
Analytics Agent - Handles reports, dashboards, readiness scores, and compliance data.
"""
from __future__ import annotations

from typing import Any

from app.agents.base import BaseAgent
from app.agents.orchestrator import AgentResult, AgentType, QueryClassification
from sqlalchemy import text
from app.db.postgres import engine


class AnalyticsAgent(BaseAgent):
    agent_type = AgentType.ANALYTICS

    def handle(
        self,
        query: str,
        classification: QueryClassification,
        *,
        language: str = "en",
        role: str = "operator",
        user_id: str | None = None,
        history: list[dict[str, str]] | None = None,
        revision_id: str | None = None,
    ) -> AgentResult:
        analytics_data = self._load_analytics(query, user_id, role)

        system_prompt = (
            "You are an analytics and reporting assistant for industrial plant operations. "
            "Your task is to present operational data, readiness scores, and compliance metrics clearly.\n\n"
            "RULES:\n"
            "1. Present data in clear, easy-to-understand format.\n"
            "2. Highlight key metrics and trends.\n"
            "3. Identify areas of concern or improvement.\n"
            "4. Compare against targets or benchmarks where available.\n"
            "5. Provide actionable recommendations based on data.\n"
            "6. Use bullet points and structured formatting.\n"
            "7. Be specific with numbers and percentages.\n"
            "8. For compliance data, highlight any gaps or overdue items.\n"
        )

        context_parts = []
        if analytics_data.get("department_stats"):
            context_parts.append("Department Statistics:")
            for stat in analytics_data["department_stats"][:5]:
                context_parts.append(f"- {stat.get('department', 'Unknown')}: {stat.get('operator_count', 0)} operators, {stat.get('compliance_rate', 0)}% compliance")
        if analytics_data.get("training_stats"):
            context_parts.append("\nTraining Statistics:")
            for stat in analytics_data["training_stats"][:5]:
                context_parts.append(f"- {stat.get('module_title', 'Module')}: {stat.get('completion_rate', 0)}% completion, {stat.get('avg_score', 0)}% avg score")
        if analytics_data.get("readiness_score"):
            context_parts.append(f"\nOverall Readiness Score: {analytics_data['readiness_score']}%")
        if analytics_data.get("recent_incidents"):
            context_parts.append("\nRecent Incidents:")
            for incident in analytics_data["recent_incidents"][:3]:
                context_parts.append(f"- {incident.get('description', 'Incident')[:100]} ({incident.get('status', 'unknown')})")

        data_context = "\n".join(context_parts) if context_parts else "No analytics data available."

        user_prompt = (
            f"Analytics Question: {query}\n"
            f"Language: {language}\n"
            f"Role: {role}\n"
            f"User: {user_id or 'unknown'}\n\n"
            f"Available Data:\n{data_context}\n\n"
            f"Conversation history:\n{self._history_to_text(history)}\n\n"
            "Provide a clear, data-driven response with insights and recommendations."
        )

        answer = self._call_llm(system_prompt, user_prompt)
        if not answer:
            answer = self._format_data_response(analytics_data)

        return AgentResult(
            agent_type=AgentType.ANALYTICS,
            answer=answer,
            confidence=0.8 if analytics_data else 0.3,
            evidence=[],
            diagnostics={"data_available": bool(analytics_data)},
        )

    def _load_analytics(self, query: str, user_id: str | None, role: str) -> dict[str, Any]:
        data = {
            "department_stats": [],
            "training_stats": [],
            "readiness_score": None,
            "recent_incidents": [],
        }

        try:
            with engine.connect() as conn:
                depts = conn.execute(
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
                data["department_stats"] = [dict(d) for d in depts]

                training = conn.execute(
                    text("""
                        SELECT tm.title as module_title,
                               round(100.0 * count(ta.id) FILTER (WHERE ta.status = 'completed')
                                     / nullif(count(ta.id), 0), 1) as completion_rate,
                               round(avg(aa.score), 1) as avg_score
                        FROM training_modules tm
                        LEFT JOIN training_assignments ta ON ta.module_id = tm.id
                        LEFT JOIN assessment_attempts aa ON aa.module_id = tm.id
                        WHERE tm.is_active = true
                        GROUP BY tm.id, tm.title
                        ORDER BY tm.created_at DESC
                        LIMIT 10
                    """),
                ).mappings().all()
                data["training_stats"] = [dict(t) for t in training]

                total_operators = conn.execute(text("SELECT count(*) FROM users WHERE role = 'operator'")).scalar() or 0
                certified_operators = conn.execute(
                    text("SELECT count(DISTINCT user_id) FROM certifications WHERE status = 'active' AND expires_at > now()")
                ).scalar() or 0
                if total_operators > 0:
                    data["readiness_score"] = round(100.0 * certified_operators / total_operators, 1)

                incidents = conn.execute(
                    text("""
                        SELECT description, status, created_at
                        FROM admin_audit_logs
                        WHERE action_type = 'incident_reported'
                        ORDER BY created_at DESC
                        LIMIT 5
                    """),
                ).mappings().all()
                data["recent_incidents"] = [dict(i) for i in incidents]

        except Exception:
            pass

        return data

    def _call_llm(self, system_prompt: str, user_prompt: str) -> str:
        import httpx
        try:
            with httpx.Client(timeout=15.0) as client:
                payload = {
                    "model": self.settings.PRIMARY_LLM_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "max_tokens": 2000,
                    "temperature": 0.3,
                }
                response = client.post(
                    self.settings.PRIMARY_LLM_API_BASE.rstrip("/") + "/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.settings.PRIMARY_LLM_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                response.raise_for_status()
                return response.json()["choices"][0]["message"]["content"].strip()
        except Exception:
            return ""

    def _format_data_response(self, data: dict) -> str:
        parts = []
        if data.get("readiness_score") is not None:
            parts.append(f"**Overall Readiness Score: {data['readiness_score']}%**\n")
        if data.get("department_stats"):
            parts.append("Department Compliance:")
            for d in data["department_stats"][:5]:
                parts.append(f"- {d.get('department', 'Unknown')}: {d.get('compliance_rate', 0)}% ({d.get('operator_count', 0)} operators)")
        if data.get("training_stats"):
            parts.append("\nTraining Module Performance:")
            for t in data["training_stats"][:5]:
                parts.append(f"- {t.get('module_title', 'Module')}: {t.get('completion_rate', 0)}% completion")
        return "\n".join(parts) if parts else "No analytics data available at this time."
