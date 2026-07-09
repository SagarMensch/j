"""
SOP Agent - ChatGPT/Claude-level answers grounded in plant documents.

Based on research papers:
- Chain-of-Thought (Wei et al. 2022)
- Self-RAG (Asai et al. 2023)  
- CRAG (Yan et al. 2024)
- RAG Prompt Engineering best practices (OpenAI, 2024)
- Iterative RAG (Lin et al. 2025)
"""
from __future__ import annotations

import re
from typing import Any, Generator

from app.agents.base import BaseAgent
from app.agents.orchestrator import AgentResult, AgentType, QueryClassification
from app.agents.text_cleaner import clean_llm_output, format_as_answer


class SOPAgent(BaseAgent):
    agent_type = AgentType.SOP

    SYSTEM_PROMPT = """You are an expert plant operations assistant for Jubilant Ingrevia. You help operators find, understand, and apply information from approved plant documents. You think deeply about what the operator really needs and provide thorough, helpful answers.

## Your Personality
- Knowledgeable and confident, like a senior engineer helping a colleague
- Clear and direct — you don't waste words
- Safety-conscious — you always mention critical safety information
- Practical — you focus on what the operator needs to DO

## How to Think About Questions
When you receive a question, think through:
1. What is the operator trying to accomplish? What's their real goal?
2. What information from the evidence answers this?
3. Are there safety implications they should know about?
4. What follow-up questions might they have?

## Response Guidelines
- Lead with the answer. Don't bury it in preamble.
- For procedural questions: list steps in exact order with safety notes inline
- For safety questions: ALWAYS include ALL warnings, PPE requirements, and hazards
- For summary requests: organize into clear numbered points, most critical first
- For "why" questions: explain the reasoning, not just the steps
- For comparisons: structure to highlight differences clearly
- Preserve EXACT values, units, tolerances, chemical names, equipment codes
- Use citation markers [1], [2] at end of relevant points
- If evidence doesn't answer the question, say so clearly. Never guess.
- Adapt depth to complexity. Simple questions get concise answers.

## Formatting
- No markdown (no **bold**, no # headers, no tables, no ```code```)
- No raw document metadata (no SOP codes, issue numbers)
- Plain text with natural paragraph breaks
- Numbered lists for steps or multiple items

## Examples of Excellent Answers

EXAMPLE 1 — Procedural question:
Question: "What are the steps for handling chemical spills?"
Evidence: "[1] WID-CHEM-001 p.3: Spill Response Procedure: 1. Alert nearby personnel and evacuate spill area. 2. Don chemical-resistant suit, gloves, goggles. 3. Contain spill with absorbent material. 4. Collect contaminated material in marked drums. 5. Report to EHS supervisor."

Answer: "Here's the chemical spill response procedure from the approved documents:

1. Alert nearby personnel and evacuate the spill area immediately [1]
2. Put on chemical-resistant suit, gloves, and safety goggles before approaching the spill [1]
3. Contain the spill using absorbent material — do not wash it down drains [1]
4. Collect all contaminated material and place it in marked hazardous waste drums [1]
5. Report the incident to your EHS supervisor for documentation and disposal [1]

Important: Never attempt to clean a chemical spill without proper PPE. If the spill involves an unknown chemical, evacuate immediately and call emergency response."

EXAMPLE 2 — Safety question:
Question: "What PPE do I need for working with chromic acid?"
Evidence: "[1] WID-CHEM-003 p.2: Chromic acid handling requires: chemical-resistant suit (Tyvek or equivalent), double nitrile gloves, face shield with ANSI Z87.1 goggles, respirator with OV/P100 cartridges. TLV: 0.0002 mg/m3 ceiling."

Answer: "Working with chromic acid requires strict PPE compliance due to its highly corrosive and carcinogenic nature:

1. Chemical-resistant suit — Tyvek or equivalent full-body coverage [1]
2. Double nitrile gloves — wear two layers for added protection [1]
3. Face shield with ANSI Z87.1-rated safety goggles [1]
4. Respirator with OV/P100 cartridges — required due to the extremely low ceiling limit of 0.0002 mg/m3 [1]

This is one of the most hazardous chemicals in the plant. Ensure your respirator fit test is current before entering the area. If any PPE is damaged, do not proceed — get a replacement from the PPE store."

EXAMPLE 3 — Summary question:
Question: "Summarize the safety requirements for the grinding area"
Evidence: "[1] WID-SAF-005 p.1-3: Grinding area safety: mandatory face shield, hearing protection (NRR 25+), steel-toed boots, no loose clothing. Machine guards must be in place. Fire extinguisher within 10m. Maximum 2 operators per grinder."

Answer: "Here are the key safety requirements for the grinding area:

1. Mandatory PPE: face shield, hearing protection (NRR 25+), steel-toed boots, fitted clothing — no loose items [1]
2. Machine guards must be in place and functioning before starting any grinder [1]
3. Fire extinguisher must be located within 10 meters of each grinding station [1]
4. Maximum two operators permitted per grinding machine at any time [1]
5. Never wear gloves near rotating grinding wheels — they can catch and pull your hand in [1]

The grinding area is a high-noise, high-debris zone. Always do a visual inspection of the machine and guards before your shift starts."""

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
        sub_intent = classification.sub_intent or "general_sop"
        top_k = 8 if sub_intent == "procedural" else 5
        if "summary" in query.lower() or "summarize" in query.lower():
            top_k = 12
        if "compare" in query.lower() or "difference" in query.lower():
            top_k = 10

        is_complex = self._is_complex_query(query)
        if is_complex:
            evidence = self._retrieve_evidence_iterative(query, top_k=top_k, revision_id=revision_id)
        else:
            evidence = self._retrieve_evidence(query, top_k=top_k, revision_id=revision_id)

        context = self._build_context(evidence, max_chars=3000)

        if is_complex:
            sub_queries = self._decompose_query(query, language)
            sub_contexts = []
            for sq in sub_queries:
                sub_ev = self._retrieve_evidence(sq, top_k=3, revision_id=revision_id)
                for idx, ev in enumerate(sub_ev[:3], start=len(sub_contexts) + 1):
                    citation = ev.get("citation_label") or f"{ev.get('document_code', 'DOC')} p.{ev.get('page_start', '?')}"
                    doc_title = ev.get("document_title", "")
                    content = (ev.get("content") or "").strip()[:2000]
                    if content:
                        header = f"[Q{idx}] {citation}"
                        if doc_title:
                            header += f" — {doc_title}"
                        sub_contexts.append(f"{header}\n{content}")
            if sub_contexts:
                context = context + "\n\n## Additional context from sub-question analysis:\n" + "\n\n".join(sub_contexts[:6])

        user_prompt = self._build_user_prompt(query, language, history, context, is_complex)

        answer = self._call_llm(self.SYSTEM_PROMPT, user_prompt, max_tokens=2000, temperature=0.3)
        if not answer:
            answer = self._extractive_answer(query, evidence)
        else:
            answer = format_as_answer(answer, evidence)

        return AgentResult(
            agent_type=AgentType.SOP,
            answer=answer,
            confidence=self._calculate_confidence(evidence),
            evidence=evidence,
            citations=[ev.get("citation_label", "") for ev in evidence[:5]],
            diagnostics={"sub_intent": sub_intent, "evidence_count": len(evidence), "complex": is_complex},
        )

    def handle_streaming(
        self,
        query: str,
        classification: QueryClassification,
        *,
        language: str = "en",
        role: str = "operator",
        user_id: str | None = None,
        history: list[dict[str, str]] | None = None,
        revision_id: str | None = None,
    ) -> Generator[dict, None, None]:
        sub_intent = classification.sub_intent or "general_sop"
        top_k = 8 if sub_intent == "procedural" else 5
        if "summary" in query.lower() or "summarize" in query.lower():
            top_k = 12

        is_complex = self._is_complex_query(query)
        if is_complex:
            yield {"type": "status", "data": {"message": "Analyzing your question"}}
            evidence = self._retrieve_evidence_iterative(query, top_k=top_k, revision_id=revision_id)
        else:
            evidence = self._retrieve_evidence(query, top_k=top_k, revision_id=revision_id)

        context = self._build_context(evidence, max_chars=3000)

        if is_complex:
            yield {"type": "status", "data": {"message": "Searching across documents"}}
            sub_queries = self._decompose_query(query, language)
            sub_contexts = []
            for sq in sub_queries:
                sub_ev = self._retrieve_evidence(sq, top_k=3, revision_id=revision_id)
                for idx, ev in enumerate(sub_ev[:3], start=len(sub_contexts) + 1):
                    citation = ev.get("citation_label") or f"{ev.get('document_code', 'DOC')} p.{ev.get('page_start', '?')}"
                    doc_title = ev.get("document_title", "")
                    content = (ev.get("content") or "").strip()[:2000]
                    if content:
                        header = f"[Q{idx}] {citation}"
                        if doc_title:
                            header += f" — {doc_title}"
                        sub_contexts.append(f"{header}\n{content}")
            if sub_contexts:
                context = context + "\n\n## Additional context from sub-question analysis:\n" + "\n\n".join(sub_contexts[:6])

        user_prompt = self._build_user_prompt(query, language, history, context, is_complex)

        if is_complex:
            yield {"type": "status", "data": {"message": "Generating comprehensive answer"}}

        answer_parts = []
        for token in self._call_llm_streaming(self.SYSTEM_PROMPT, user_prompt, max_tokens=2000, temperature=0.3):
            cleaned = clean_llm_output(token)
            if cleaned:
                answer_parts.append(cleaned)
                yield {"type": "answer_delta", "data": {"text": cleaned}}

        answer = "".join(answer_parts).strip()
        if not answer:
            answer = self._extractive_answer(query, evidence)
            for chunk in self._stream_text(answer):
                yield {"type": "answer_delta", "data": {"text": chunk}}

        yield {"type": "final", "data": {
            "answer": answer,
            "confidence": self._calculate_confidence(evidence),
            "agent_type": "sop",
            "citations": [ev.get("citation_label", "") for ev in evidence[:5]],
            "diagnostics": {"sub_intent": sub_intent, "evidence_count": len(evidence), "complex": is_complex},
        }}

    def _build_user_prompt(self, query: str, language: str, history: list[dict] | None, context: str, is_complex: bool = False) -> str:
        history_text = self._history_to_text(history)

        complexity_note = ""
        if is_complex:
            complexity_note = (
                "\nThis is a complex question that may require synthesizing information from multiple sources. "
                "Think through each aspect carefully and provide a comprehensive answer."
            )

        return f"""The operator is asking a question about plant operations. Think deeply about what they need to know, then provide a thorough, helpful answer.

## Conversation History
{history_text}

## Operator's Question
{query}

## Available Evidence from Approved Documents
{context}
{complexity_note}

## Instructions
Answer the operator's question thoroughly. Use the evidence above to provide accurate, grounded information.
Think about what the operator is really trying to accomplish and provide context where helpful.
For safety questions, always include ALL warnings and PPE requirements.
Cite sources with [1], [2] at the end of relevant points.
If the evidence doesn't contain the answer, say so clearly rather than guessing.
Respond in {'Hindi' if language == 'hi' else 'English'}."""

    def _extractive_answer(self, query: str, evidence: list[dict[str, Any]]) -> str:
        if not evidence:
            return "I couldn't find relevant information in the approved documents for this question. Could you provide more details or try rephrasing?"

        top = evidence[0]
        citation = top.get("citation_label") or f"{top.get('document_code', 'DOC')} p.{top.get('page_start', '?')}"
        content = (top.get("content") or "").strip()
        content = clean_llm_output(content)

        if len(content) > 600:
            content = content[:600] + "..."

        return f"{content}\n\nSource: {citation}"
