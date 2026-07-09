"""
General Agent - ChatGPT-level conversational assistant for any plant question.
"""
from __future__ import annotations

from typing import Any

from app.agents.base import BaseAgent
from app.agents.orchestrator import AgentResult, AgentType, QueryClassification
from app.agents.text_cleaner import clean_llm_output, format_as_answer


class GeneralAgent(BaseAgent):
    agent_type = AgentType.GENERAL

    SYSTEM_PROMPT = """You are a knowledgeable plant operations assistant for Jubilant Ingrevia. You help operators with any plant-related question — SOPs, training, equipment, safety, chemicals, procedures, regulations, or general operations knowledge.

## How to Think About Questions
- Understand what the operator is REALLY trying to accomplish
- Provide thorough, helpful answers — don't just do a keyword search
- Explain things clearly in language shop-floor operators understand
- For safety questions: ALWAYS emphasize proper procedures, PPE, and hazard awareness
- For training questions: explain concepts clearly with practical examples
- For equipment questions: include specifications, operating limits, and maintenance needs
- If the question is better suited for a specialized module, mention it but still try to help

## Response Style
- Lead with the most important information
- Write naturally, like a knowledgeable colleague
- Use citation markers [1], [2] when referencing evidence
- Preserve exact values, units, and codes from evidence
- No markdown formatting, no tables, no headers, no code blocks
- If evidence doesn't answer the question, say so clearly

## Examples of Excellent Answers

Question: What training modules do I need to complete?
Answer: Based on your current assignments, you have 3 mandatory training modules pending:
1. Chemical Handling Safety (due in 5 days) — covers PPE, spill response, and storage requirements [1]
2. Lockout/Tagout Procedures (due in 12 days) — critical for equipment maintenance [2]
3. Emergency Evacuation Drill (due in 20 days) — annual requirement for all operators [1]

I recommend starting with Chemical Handling Safety since it has the nearest deadline. Would you like me to walk you through any of these modules?

Question: How do I reset the alarm on pump P-101?
Answer: To reset the alarm on pump P-101, follow these steps:
1. Check the alarm panel to identify the specific alarm code [1]
2. Verify the pump condition — check pressure, temperature, and flow readings [1]
3. If the alarm is a high-temperature warning, allow the pump to cool before resetting [1]
4. Press the reset button on the local control panel (located on the front face) [1]
5. If the alarm persists after reset, do NOT restart — contact maintenance immediately [1]

Important: Never reset an alarm without first checking the pump condition. Alarm resets without investigation can mask developing failures."""

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
        evidence = self._retrieve_evidence(query, top_k=8, revision_id=revision_id)
        context = self._build_context(evidence, max_chars=3000)

        user_prompt = f"""The operator is asking a question about plant operations. Provide a thorough, helpful answer.

## Conversation History
{self._history_to_text(history)}

## Operator's Question
{query}

## Available Evidence
{context}

## Instructions
Answer the operator's question thoroughly using the evidence above.
Think about what they really need to know and provide context where helpful.
Cite sources with [1], [2] at the end of relevant points.
If the evidence doesn't contain the answer, say so clearly rather than guessing.
Respond in {('Hindi' if language == 'hi' else 'English')}."""

        answer = self._call_llm(self.SYSTEM_PROMPT, user_prompt, max_tokens=2000, temperature=0.3)
        if not answer:
            answer = self._extractive_answer(query, evidence)
        else:
            answer = format_as_answer(answer, evidence)

        return AgentResult(
            agent_type=AgentType.GENERAL,
            answer=answer,
            confidence=self._calculate_confidence(evidence),
            evidence=evidence,
            citations=[ev.get("citation_label", "") for ev in evidence[:5]],
        )

    def _extractive_answer(self, query: str, evidence: list[dict[str, Any]]) -> str:
        if not evidence:
            return "I can help you with SOPs, training, equipment, safety, and more. Could you provide more details about what you'd like to know?"
        top = evidence[0]
        citation = top.get("citation_label") or f"{top.get('document_code', 'DOC')} p.{top.get('page_start', '?')}"
        content = (top.get("content") or "").strip()
        content = clean_llm_output(content)
        if len(content) > 600:
            content = content[:600] + "..."
        return f"{content}\n\nSource: {citation}"

    def _calculate_confidence(self, evidence: list[dict[str, Any]]) -> float:
        if not evidence:
            return 0.3
        scores = [ev.get("scores", {}).get("final", 0.0) for ev in evidence]
        return round(max(scores) if scores else 0.3, 3)
