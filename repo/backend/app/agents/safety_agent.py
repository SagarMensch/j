"""
Safety Agent - ChatGPT-level safety guidance for plant operators.
"""
from __future__ import annotations

import re
from typing import Any

from app.agents.base import BaseAgent
from app.agents.orchestrator import AgentResult, AgentType, QueryClassification
from app.agents.text_cleaner import clean_llm_output, format_as_answer


class SafetyAgent(BaseAgent):
    agent_type = AgentType.SAFETY

    SAFETY_SYSTEM_PROMPT = """You are a safety expert for industrial plant operators at Jubilant Ingrevia. Safety is your HIGHEST priority. When in doubt, be MORE cautious, never less.

## How to Approach Safety Questions
- ALWAYS prioritize life safety above all else
- Lead with the most critical safety information
- Be thorough — list ALL PPE, ALL warnings, ALL hazards. Never omit anything.
- Include specific PPE types, ratings, and standards (e.g., ANSI Z87.1)
- Include emergency procedures, stop conditions, and escalation paths
- For chemical safety: include exact names, CAS numbers, hazard classifications, TLV/PEL values
- For emergency situations: provide IMMEDIATE actions FIRST, then secondary steps
- If the situation is life-threatening, emphasize calling for help FIRST
- Never approve or endorse unsafe practices
- If PPE requirements are unclear, err on the side of MORE protection
- NEVER say "regular PPE" — always specify exact items

## Response Style
- Write naturally, like an experienced safety officer explaining to an operator
- Lead with the most critical information
- Use citation markers [1], [2] when referencing evidence
- Preserve exact values, units, and chemical names from evidence
- No markdown formatting, no tables, no headers
- Be direct, clear, and actionable — no ambiguity

## Examples of Excellent Safety Answers

Question: What should I do if I get chemical splashed in my eyes?
Answer: This is a medical emergency. Take these actions IMMEDIATELY:
1. Go to the nearest emergency eyewash station RIGHT NOW — you have 15 seconds [1]
2. Flush your eyes with water for at least 15 minutes — hold eyelids open [1]
3. Remove contact lenses while flushing if you are wearing them [1]
4. Call emergency response (ext. 5555) while flushing — do not wait [1]
5. After flushing, report to the medical center even if you feel fine [1]

Do NOT: rub your eyes, use eye drops, or try to neutralize the chemical. Time is critical — every second of flushing reduces damage.

Question: What are the fire hazards in the chemical storage area?
Answer: The chemical storage area has several fire hazards you must be aware of:
1. Flammable liquids (acetone, toluene) — keep away from ignition sources, static discharge [1]
2. Oxidizers (hydrogen peroxide, nitric acid) — can accelerate fires, never store near flammables [1]
3. Reactive chemicals — some combinations produce heat or toxic gases on contact [1]
4. Electrical equipment — must be rated for Class I Division 1 hazardous location [1]

Required precautions:
- No open flames, smoking, or spark-producing tools within 15 meters [1]
- Fire extinguisher (ABC type) must be within 10 meters of any storage cabinet [1]
- Static grounding straps must be worn when handling flammable containers [1]
- Know the location of the nearest fire alarm pull station and assembly point [1]"""

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
        sub_intent = classification.sub_intent or "general_safety"
        urgency = classification.urgency

        evidence = self._retrieve_evidence(query, top_k=10, revision_id=revision_id)
        context = self._build_context(evidence, max_chars=3000)

        system_prompt = self.SAFETY_SYSTEM_PROMPT
        if sub_intent == "ppe":
            system_prompt += "\n\nYou are specifically a PPE specialist. List ALL required PPE items with exact types, ratings, and standards. Include inspection, donning/doffing, limitations, and replacement criteria."
        elif sub_intent == "emergency":
            system_prompt += "\n\nYou are an emergency response coordinator. Provide IMMEDIATE actions first. Include evacuation, first aid, emergency contacts, and escalation paths."
        elif sub_intent == "chemical_safety":
            system_prompt += "\n\nYou are a chemical safety specialist. Include exact chemical names, CAS numbers, hazard classifications, TLV/PEL values, required PPE, spill response, first aid, and storage requirements."

        if urgency == "high":
            system_prompt += "\n\nURGENT: Provide IMMEDIATE, actionable safety guidance. Lead with the most critical information. Be direct and clear."

        user_prompt = f"""The operator is asking a safety question. Provide thorough, comprehensive safety guidance.

## Conversation History
{self._history_to_text(history)}

## Operator's Safety Question
{query}

## Available Evidence from Safety Documents
{context}

## Instructions
Provide comprehensive safety guidance based on the evidence.
Always err on the side of MORE caution. List ALL hazards, ALL PPE, ALL warnings.
If the evidence doesn't fully answer the question, say so and recommend consulting the full document or a supervisor.
Respond in {('Hindi' if language == 'hi' else 'English')}."""

        answer = self._call_llm(system_prompt, user_prompt, max_tokens=2000, temperature=0.3)
        if not answer:
            answer = self._extractive_answer(query, evidence)
        else:
            answer = format_as_answer(answer, evidence)

        requires_human = urgency == "high" or any(
            kw in query.lower()
            for kw in ["emergency", "injury", "exposure", "fire", "explosion", "evacuate"]
        )

        return AgentResult(
            agent_type=AgentType.SAFETY,
            answer=answer,
            confidence=self._calculate_confidence(evidence),
            evidence=evidence,
            citations=[ev.get("citation_label", "") for ev in evidence[:5]],
            diagnostics={"sub_intent": sub_intent, "urgency": urgency, "requires_human": requires_human},
            requires_human=requires_human,
            escalation_level="supervisor" if requires_human else None,
        )

    def _extractive_answer(self, query: str, evidence: list[dict[str, Any]]) -> str:
        if not evidence:
            return "I could not find specific information in the approved safety documents for this question. Please contact your supervisor or safety officer immediately for guidance."
        top = evidence[0]
        citation = top.get("citation_label") or f"{top.get('document_code', 'DOC')} p.{top.get('page_start', '?')}"
        content = (top.get("content") or "").strip()
        content = clean_llm_output(content)
        if len(content) > 600:
            content = content[:600] + "..."
        return f"SAFETY NOTICE:\n\n{content}\n\nSource: {citation}"

    def _calculate_confidence(self, evidence: list[dict[str, Any]]) -> float:
        if not evidence:
            return 0.0
        scores = [ev.get("scores", {}).get("final", 0.0) for ev in evidence]
        return round(max(scores) if scores else 0.0, 3)
