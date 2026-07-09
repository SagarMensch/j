"""
Appeal Agent - Handles complaints, grievances, issues, and escalation.
"""
from __future__ import annotations

import uuid
from typing import Any

from app.agents.base import BaseAgent
from app.agents.orchestrator import AgentResult, AgentType, QueryClassification
from sqlalchemy import text
from app.db.postgres import engine


class AppealAgent(BaseAgent):
    agent_type = AgentType.APPEAL

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
        system_prompt = (
            "You are a grievance and appeal coordinator for industrial plant operators. "
            "Your task is to help operators report issues, file complaints, and understand the appeal process.\n\n"
            "RULES:\n"
            "1. Listen empathetically and acknowledge the operator's concern.\n"
            "2. Help categorize the issue (safety, procedural, interpersonal, equipment, etc.).\n"
            "3. Explain the grievance/appeal process clearly.\n"
            "4. Document the issue with specific details.\n"
            "5. Provide escalation paths and contact information.\n"
            "6. Reference company policies with [1], [2] citations if available.\n"
            "7. Ensure the operator knows their rights and protections.\n"
            "8. Never dismiss or minimize the operator's concern.\n"
            "9. For safety-related concerns, emphasize immediate reporting.\n"
            "10. Maintain confidentiality and professionalism.\n"
        )

        issue_category = self._categorize_issue(query)
        urgency = classification.urgency

        if urgency == "high":
            system_prompt += (
                "\n\nURGENT: This appears to be a high-priority issue. "
                "Emphasize immediate reporting and escalation. "
                "Provide direct contact information for supervisors and safety teams."
            )

        user_prompt = (
            f"Operator Concern: {query}\n"
            f"Language: {language}\n"
            f"Operator ID: {user_id or 'anonymous'}\n"
            f"Issue Category: {issue_category}\n"
            f"Urgency: {urgency}\n\n"
            f"Conversation history:\n{self._history_to_text(history)}\n\n"
            "Respond empathetically and provide clear next steps for the operator."
        )

        answer = self._call_llm(system_prompt, user_prompt)
        if not answer:
            answer = self._default_response(issue_category, urgency)

        self._log_grievance(query, user_id, issue_category, urgency)

        return AgentResult(
            agent_type=AgentType.APPEAL,
            answer=answer,
            confidence=0.8,
            evidence=[],
            diagnostics={"issue_category": issue_category, "urgency": urgency},
            requires_human=True,
            escalation_level="supervisor" if urgency == "high" else "team_lead",
        )

    def _categorize_issue(self, query: str) -> str:
        lowered = query.lower()
        categories = {
            "safety": ["safety", "hazard", "danger", "unsafe", "risk", "ppe"],
            "procedural": ["procedure", "process", "protocol", "sop", "rule"],
            "interpersonal": ["harassment", "discrimination", "bullying", "colleague", "supervisor"],
            "equipment": ["equipment", "broken", "malfunction", "defect", "maintenance"],
            "working_conditions": ["hours", "overtime", "break", "conditions", "environment"],
            "training": ["training", "unqualified", "not trained", "certification"],
            "compensation": ["pay", "overtime pay", "bonus", "allowance"],
        }
        for category, keywords in categories.items():
            if any(kw in lowered for kw in keywords):
                return category
        return "general"

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

    def _default_response(self, category: str, urgency: str) -> str:
        if urgency == "high":
            return (
                "I understand this is urgent. Please take the following immediate steps:\n\n"
                "1. **Ensure your safety first** - if there is immediate danger, move to a safe location.\n"
                "2. **Notify your supervisor** immediately about this issue.\n"
                "3. **Contact the safety team** if this is a safety-related concern.\n"
                "4. **Document the issue** with specific details (time, location, people involved).\n\n"
                "Your concern has been logged and will be addressed promptly."
            )
        return (
            "I understand your concern and appreciate you bringing this to our attention.\n\n"
            "To help you effectively, I've logged your issue and here are the next steps:\n\n"
            "1. **Documentation**: Your concern has been recorded.\n"
            "2. **Review**: A supervisor will review your case within 24 hours.\n"
            "3. **Follow-up**: You will be contacted for further discussion if needed.\n\n"
            "If this is a safety concern, please report it immediately to your supervisor."
        )

    def _log_grievance(self, query: str, user_id: str | None, category: str, urgency: str) -> None:
        try:
            with engine.begin() as conn:
                conn.execute(
                    text("""
                        INSERT INTO admin_audit_logs (id, action_type, actor_id, details)
                        VALUES (gen_random_uuid(), 'grievance_reported', :actor_id, :details)
                    """),
                    {
                        "actor_id": user_id,
                        "details": f"Category: {category}, Urgency: {urgency}, Query: {query[:500]}",
                    },
                )
        except Exception:
            pass
