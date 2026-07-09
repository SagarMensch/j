"""
Quiz Agent - Handles assessments, quizzes, scores, and certifications.
"""
from __future__ import annotations

from typing import Any

from app.agents.base import BaseAgent
from app.agents.orchestrator import AgentResult, AgentType, QueryClassification
from sqlalchemy import text
from app.db.postgres import engine


class QuizAgent(BaseAgent):
    agent_type = AgentType.QUIZ

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
        sub_intent = classification.sub_intent or "general_quiz"

        quiz_context = self._load_quiz_context(query, user_id)

        if sub_intent == "results":
            system_prompt = (
                "You are an assessment results assistant for industrial plant operators. "
                "Your task is to help operators understand their quiz and certification results.\n\n"
                "RULES:\n"
                "1. Present scores clearly with pass/fail status.\n"
                "2. Explain which areas need improvement.\n"
                "3. Provide specific feedback on wrong answers.\n"
                "4. Suggest relevant training modules for weak areas.\n"
                "5. Include certification expiry dates and renewal requirements.\n"
                "6. Be encouraging but honest about performance.\n"
            )
        elif sub_intent == "practice":
            system_prompt = (
                "You are a quiz practice assistant for industrial plant operators. "
                "Your task is to help operators prepare for assessments.\n\n"
                "RULES:\n"
                "1. Explain concepts that may appear in quizzes.\n"
                "2. Provide example questions with explanations.\n"
                "3. Focus on safety-critical and high-priority topics.\n"
                "4. Reference approved documents with [1], [2] citations.\n"
                "5. Explain why correct answers are correct.\n"
                "6. Highlight common mistakes to avoid.\n"
            )
        else:
            system_prompt = (
                "You are an assessment assistant for industrial plant operators. "
                "Your task is to help operators understand and prepare for their assessments.\n\n"
                "RULES:\n"
                "1. Provide clear information about available assessments.\n"
                "2. Explain assessment requirements and format.\n"
                "3. Help operators understand what they need to study.\n"
                "4. Reference approved documents with [1], [2] citations.\n"
                "5. Be supportive and encouraging.\n"
            )

        context_parts = []
        if quiz_context.get("assessments"):
            context_parts.append("Available assessments:")
            for a in quiz_context["assessments"][:5]:
                context_parts.append(f"- {a.get('title', 'Assessment')}: {a.get('status', 'unknown')}")
        if quiz_context.get("certifications"):
            context_parts.append("\nCertifications:")
            for c in quiz_context["certifications"][:5]:
                context_parts.append(f"- {c.get('title', 'Cert')}: expires {c.get('expires_at', 'unknown')}")
        if quiz_context.get("recent_scores"):
            context_parts.append("\nRecent scores:")
            for s in quiz_context["recent_scores"][:5]:
                context_parts.append(f"- {s.get('module_title', 'Module')}: {s.get('score', 0)}% ({'PASS' if s.get('passed') else 'FAIL'})")

        quiz_info = "\n".join(context_parts) if context_parts else "No assessment data found."

        user_prompt = (
            f"Question: {query}\n"
            f"Language: {language}\n"
            f"Operator: {user_id or 'unknown'}\n\n"
            f"Assessment context:\n{quiz_info}\n\n"
            f"Conversation history:\n{self._history_to_text(history)}\n\n"
            "Provide a helpful response about assessments and quizzes."
        )

        answer = self._call_llm(system_prompt, user_prompt)
        if not answer:
            answer = self._fallback_answer(query, quiz_context)

        return AgentResult(
            agent_type=AgentType.QUIZ,
            answer=answer,
            confidence=0.7 if quiz_context.get("assessments") else 0.3,
            evidence=[],
            diagnostics={"sub_intent": sub_intent, "quiz_context": bool(quiz_context)},
        )

    def _load_quiz_context(self, query: str, user_id: str | None) -> dict[str, Any]:
        context = {"assessments": [], "certifications": [], "recent_scores": []}
        if not user_id:
            return context

        try:
            with engine.connect() as conn:
                assessments = conn.execute(
                    text("""
                        SELECT a.id::text, a.title, a.assessment_type, a.passing_score,
                               tm.title as module_title
                        FROM assessments a
                        LEFT JOIN training_modules tm ON tm.id = a.module_id
                        WHERE a.is_active = true
                        ORDER BY a.created_at DESC
                        LIMIT 10
                    """),
                ).mappings().all()
                for a in assessments:
                    context["assessments"].append(dict(a))

                certifications = conn.execute(
                    text("""
                        SELECT c.id::text, c.title, c.issued_at, c.expires_at, c.status
                        FROM certifications c
                        WHERE c.user_id = CAST(:user_id AS uuid)
                        ORDER BY c.expires_at ASC
                        LIMIT 10
                    """),
                    {"user_id": user_id},
                ).mappings().all()
                for c in certifications:
                    context["certifications"].append(dict(c))

                scores = conn.execute(
                    text("""
                        SELECT aa.id::text, aa.score, aa.passed, aa.completed_at,
                               tm.title as module_title
                        FROM assessment_attempts aa
                        JOIN assessments a ON a.id = aa.assessment_id
                        LEFT JOIN training_modules tm ON tm.id = a.module_id
                        WHERE aa.user_id = CAST(:user_id AS uuid)
                        ORDER BY aa.completed_at DESC
                        LIMIT 10
                    """),
                    {"user_id": user_id},
                ).mappings().all()
                for s in scores:
                    context["recent_scores"].append(dict(s))

        except Exception:
            pass

        return context

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

    def _fallback_answer(self, query: str, quiz_context: dict) -> str:
        if quiz_context.get("recent_scores"):
            lines = ["Your recent assessment results:\n"]
            for s in quiz_context["recent_scores"][:5]:
                status = "PASS" if s.get("passed") else "FAIL"
                lines.append(f"- {s.get('module_title', 'Module')}: {s.get('score', 0)}% [{status}]")
            return "\n".join(lines)
        if quiz_context.get("assessments"):
            lines = ["Available assessments:\n"]
            for a in quiz_context["assessments"][:5]:
                lines.append(f"- {a.get('title', 'Assessment')} (passing: {a.get('passing_score', 70)}%)")
            return "\n".join(lines)
        return "I can help you with quizzes and assessments. Ask about your scores, available assessments, or certification status."
