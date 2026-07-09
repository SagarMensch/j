"""
Training Agent - Handles training modules, learning content, and educational queries.
"""
from __future__ import annotations

from typing import Any

from app.agents.base import BaseAgent
from app.agents.orchestrator import AgentResult, AgentType, QueryClassification
from sqlalchemy import text
from app.db.postgres import engine


class TrainingAgent(BaseAgent):
    agent_type = AgentType.TRAINING

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
        sub_intent = classification.sub_intent or "general_training"

        training_context = self._load_training_context(query, user_id)
        evidence = self._retrieve_evidence(query, top_k=5, revision_id=revision_id)
        doc_context = self._build_context(evidence)

        if sub_intent == "conceptual":
            system_prompt = (
                "You are an expert training instructor for industrial plant operators. "
                "Your task is to explain concepts clearly and thoroughly.\n\n"
                "RULES:\n"
                "1. Explain concepts in simple, easy-to-understand language.\n"
                "2. Use real-world examples from the plant environment.\n"
                "3. Connect theory to practical application.\n"
                "4. Include safety implications of each concept.\n"
                "5. Reference approved documents with [1], [2] citations.\n"
                "6. Build from basic to advanced understanding.\n"
                "7. Use analogies that operators can relate to.\n"
            )
        elif sub_intent == "module_info":
            system_prompt = (
                "You are a training module guide for industrial plant operators. "
                "Your task is to help operators navigate and understand their training modules.\n\n"
                "RULES:\n"
                "1. Provide clear summaries of module content.\n"
                "2. Highlight key learning objectives.\n"
                "3. Indicate which steps are critical for safety.\n"
                "4. Suggest which modules to complete first.\n"
                "5. Reference approved documents with [1], [2] citations.\n"
                "6. Include estimated completion time if available.\n"
            )
        else:
            system_prompt = (
                "You are an expert training assistant for industrial plant operators. "
                "Your task is to help operators learn and understand plant procedures, safety, and operations.\n\n"
                "RULES:\n"
                "1. Explain concepts clearly using shop-floor language.\n"
                "2. Connect training content to real plant operations.\n"
                "3. Emphasize safety-critical information.\n"
                "4. Use step-by-step explanations for procedures.\n"
                "5. Reference approved documents with [1], [2] citations.\n"
                "6. Encourage operators to complete their training modules.\n"
                "7. If asked about specific modules, provide relevant training data.\n"
            )

        user_prompt = (
            f"Question: {query}\n"
            f"Language: {language}\n"
            f"Operator: {user_id or 'unknown'}\n\n"
            f"Training context:\n{training_context}\n\n"
            f"Approved evidence:\n{doc_context}\n\n"
            f"Conversation history:\n{self._history_to_text(history)}\n\n"
            "Provide a helpful, educational response."
        )

        answer = self._call_llm(system_prompt, user_prompt)
        if not answer:
            answer = self._fallback_answer(query, training_context, evidence)

        suggestions = self._generate_suggestions(training_context, user_id)

        return AgentResult(
            agent_type=AgentType.TRAINING,
            answer=answer,
            confidence=self._calculate_confidence(evidence, training_context),
            evidence=evidence,
            citations=[ev.get("citation_label", "") for ev in evidence[:5]],
            diagnostics={"sub_intent": sub_intent, "training_modules_found": len(training_context.get("modules", []))},
            suggestions=suggestions,
        )

    def _load_training_context(self, query: str, user_id: str | None) -> dict[str, Any]:
        context = {"modules": [], "assignments": [], "progress": {}}
        if not user_id:
            return context

        try:
            with engine.connect() as conn:
                modules = conn.execute(
                    text("""
                        SELECT tm.id::text, tm.title, tm.description, tm.module_type, tm.criticality,
                               ta.status as assignment_status, ta.progress_percent, ta.current_step
                        FROM training_modules tm
                        LEFT JOIN training_assignments ta ON ta.module_id = tm.id AND ta.user_id = CAST(:user_id AS uuid)
                        WHERE tm.is_active = true
                        ORDER BY tm.created_at DESC
                        LIMIT 20
                    """),
                    {"user_id": user_id},
                ).mappings().all()

                for m in modules:
                    context["modules"].append(dict(m))

                assignments = conn.execute(
                    text("""
                        SELECT ta.id::text, ta.module_id::text, ta.status, ta.progress_percent,
                               ta.due_at, tm.title as module_title
                        FROM training_assignments ta
                        JOIN training_modules tm ON tm.id = ta.module_id
                        WHERE ta.user_id = CAST(:user_id AS uuid)
                        ORDER BY ta.due_at ASC
                        LIMIT 10
                    """),
                    {"user_id": user_id},
                ).mappings().all()

                for a in assignments:
                    context["assignments"].append(dict(a))

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

    def _fallback_answer(self, query: str, training_context: dict, evidence: list[dict]) -> str:
        if training_context.get("modules"):
            lines = ["Here are your available training modules:\n"]
            for m in training_context["modules"][:5]:
                status = m.get("assignment_status") or "not assigned"
                progress = m.get("progress_percent") or 0
                lines.append(f"- **{m['title']}** ({m.get('module_type', 'general')}): {status} - {progress}% complete")
            return "\n".join(lines)
        if evidence:
            return self._extractive_answer(query, evidence)
        return "I can help you with training. Please ask about specific training modules, concepts, or procedures."

    def _extractive_answer(self, query: str, evidence: list[dict[str, Any]]) -> str:
        if not evidence:
            return "Not found in approved documents."
        top = evidence[0]
        citation = top.get("citation_label") or f"{top.get('document_code', 'DOC')} p.{top.get('page_start', '?')}"
        content = (top.get("content") or "").strip()
        return f"{content}\n\nSource: {citation}"

    def _calculate_confidence(self, evidence: list[dict], training_context: dict) -> float:
        base = 0.3 if training_context.get("modules") else 0.0
        if evidence:
            scores = [ev.get("scores", {}).get("final", 0.0) for ev in evidence]
            base += max(scores) * 0.7
        return round(min(base, 1.0), 3)

    def _generate_suggestions(self, training_context: dict, user_id: str | None) -> list[str]:
        suggestions = []
        incomplete = [a for a in training_context.get("assignments", []) if a.get("status") != "completed"]
        if incomplete:
            suggestions.append(f"You have {len(incomplete)} incomplete training assignments.")
            overdue = [a for a in incomplete if a.get("due_at")]
            if overdue:
                suggestions.append("Some assignments may be overdue - check your training dashboard.")
        return suggestions
