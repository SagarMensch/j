"""
Equipment Agent - Handles equipment info, maintenance, specifications, and history.
"""
from __future__ import annotations

from typing import Any

from app.agents.base import BaseAgent
from app.agents.orchestrator import AgentResult, AgentType, QueryClassification
from sqlalchemy import text
from app.db.postgres import engine


class EquipmentAgent(BaseAgent):
    agent_type = AgentType.EQUIPMENT

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
        sub_intent = classification.sub_intent or "general_equipment"
        equipment_codes = classification.entities.get("equipment_codes", [])

        evidence = self._retrieve_evidence(query, top_k=6, revision_id=revision_id)
        context = self._build_context(evidence)

        if sub_intent == "maintenance":
            system_prompt = (
                "You are a maintenance specialist for industrial plant equipment. "
                "Your task is to provide maintenance procedures, schedules, and troubleshooting guidance.\n\n"
                "RULES:\n"
                "1. Provide step-by-step maintenance procedures.\n"
                "2. Include required tools, parts, and materials.\n"
                "3. Mention safety precautions and isolation requirements.\n"
                "4. Include maintenance intervals and schedules.\n"
                "5. Reference approved documents with [1], [2] citations.\n"
                "6. For troubleshooting, use systematic diagnostic approach.\n"
                "7. Include torque values, clearances, and specifications.\n"
            )
        elif sub_intent == "specification":
            system_prompt = (
                "You are a technical specifications specialist for industrial plant equipment. "
                "Your task is to provide exact equipment specifications and technical data.\n\n"
                "RULES:\n"
                "1. Preserve EXACT values, units, and tolerances.\n"
                "2. Include model numbers, serial numbers, and ratings.\n"
                "3. List operating parameters, limits, and setpoints.\n"
                "4. Include design codes and standards compliance.\n"
                "5. Reference approved documents with [1], [2] citations.\n"
                "6. If specs differ between sources, note the differences.\n"
            )
        else:
            system_prompt = (
                "You are an equipment specialist for industrial plant operators. "
                "Your task is to provide information about plant equipment and machinery.\n\n"
                "RULES:\n"
                "1. Provide accurate equipment information from approved documents.\n"
                "2. Include operating procedures, limits, and safety requirements.\n"
                "3. Reference approved documents with [1], [2] citations.\n"
                "4. For specific equipment codes, provide detailed information.\n"
                "5. Include relevant maintenance and inspection requirements.\n"
            )

        user_prompt = (
            f"Equipment Question: {query}\n"
            f"Equipment Codes: {', '.join(equipment_codes) if equipment_codes else 'none specified'}\n"
            f"Language: {language}\n\n"
            f"Conversation history:\n{self._history_to_text(history)}\n\n"
            f"Approved equipment evidence:\n{context}\n\n"
            "Provide detailed equipment information."
        )

        answer = self._call_llm(system_prompt, user_prompt)
        if not answer:
            answer = self._extractive_answer(query, evidence)

        return AgentResult(
            agent_type=AgentType.EQUIPMENT,
            answer=answer,
            confidence=self._calculate_confidence(evidence),
            evidence=evidence,
            citations=[ev.get("citation_label", "") for ev in evidence[:5]],
            diagnostics={"sub_intent": sub_intent, "equipment_codes": equipment_codes},
        )

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

    def _extractive_answer(self, query: str, evidence: list[dict[str, Any]]) -> str:
        if not evidence:
            return "Not found in approved equipment documents."
        top = evidence[0]
        citation = top.get("citation_label") or f"{top.get('document_code', 'DOC')} p.{top.get('page_start', '?')}"
        content = (top.get("content") or "").strip()
        return f"{content}\n\nSource: {citation}"

    def _calculate_confidence(self, evidence: list[dict[str, Any]]) -> float:
        if not evidence:
            return 0.0
        scores = [ev.get("scores", {}).get("final", 0.0) for ev in evidence]
        return round(max(scores) if scores else 0.0, 3)
