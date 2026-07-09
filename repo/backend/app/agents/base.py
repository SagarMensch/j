"""
Base Agent class with tool use, streaming, and chain-of-thought support.
"""
from __future__ import annotations

import json
import re
import time
from abc import ABC, abstractmethod
from typing import Any, Generator

import httpx
from app.agents.orchestrator import AgentResult, AgentType, QueryClassification
from app.agents.tools import get_tools, execute_tool
from app.core.config import get_settings
from app.services.sop_retrieval import get_sop_retriever


class BaseAgent(ABC):
    agent_type: AgentType

    def __init__(self):
        self.settings = get_settings()
        self.retriever = get_sop_retriever()
        self.tools = get_tools()

    @abstractmethod
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
        raise NotImplementedError

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
        result = self.handle(
            query, classification,
            language=language, role=role,
            user_id=user_id, history=history,
            revision_id=revision_id,
        )
        for chunk in self._stream_text(result.answer):
            yield {"type": "answer_delta", "data": {"text": chunk}}
        yield {"type": "final", "data": {
            "answer": result.answer,
            "confidence": result.confidence,
            "agent_type": result.agent_type.value,
            "citations": result.citations,
            "diagnostics": result.diagnostics,
            "suggestions": result.suggestions,
        }}

    def _stream_text(self, text: str, chunk_size: int = 12) -> Generator[str, None, None]:
        for i in range(0, len(text), chunk_size):
            yield text[i:i + chunk_size]

    def _retrieve_evidence(
        self,
        query: str,
        *,
        top_k: int = 5,
        revision_id: str | None = None,
    ) -> list[dict[str, Any]]:
        try:
            result = self.retriever.query(
                query_text=query,
                language="en",
                role="operator",
                user_id=None,
                top_k=top_k,
                revision_id=revision_id,
            )
            return result.get("evidence", [])
        except Exception as e:
            print(f"[{self.agent_type.value}] Retrieval failed: {e}")
            return []

    def _use_tool(self, tool_name: str, **kwargs) -> str:
        return execute_tool(tool_name, **kwargs)

    def _build_context(self, evidence: list[dict[str, Any]], max_chars: int = 3000) -> str:
        if not evidence:
            return "No approved evidence found."
        blocks: list[str] = []
        for idx, ev in enumerate(evidence[:10], start=1):
            citation = ev.get("citation_label") or (
                f"{ev.get('document_code', 'DOC')} p.{ev.get('page_start', '?')}"
            )
            doc_title = ev.get("document_title", "")
            section = ev.get("section_title", "")
            content = (ev.get("content") or "").strip()[:max_chars]
            if content:
                header = f"[{idx}] {citation}"
                if doc_title:
                    header += f" — {doc_title}"
                if section:
                    header += f" | Section: {section}"
                blocks.append(f"{header}\n{content}")
        return "\n\n".join(blocks) if blocks else "No approved evidence found."

    def _history_to_text(self, history: list[dict[str, str]] | None) -> str:
        if not history:
            return "No prior conversation."
        lines: list[str] = []
        for item in history[-12:]:
            role = (item.get("role") or "user").strip().title()
            content = (item.get("content") or "").strip()
            if content:
                lines.append(f"{role}: {content}")
        return "\n".join(lines) if lines else "No prior conversation."

    def _extract_entities_from_history(self, history: list[dict[str, str]] | None) -> dict[str, list[str]]:
        if not history:
            return {}
        entities: dict[str, list[str]] = {}
        for item in history[-6:]:
            content = item.get("content") or ""
            equipment = re.findall(r"\b[A-Z]{2,5}[-_]?\d{2,6}\b", content)
            if equipment:
                entities.setdefault("equipment", []).extend(equipment)
            sop_codes = re.findall(r"\b(?:SOP|SMP|WID)[-.]?\d{2,6}\b", content, re.IGNORECASE)
            if sop_codes:
                entities.setdefault("sop_codes", []).extend(sop_codes)
        return entities

    def _call_llm_streaming(self, system_prompt: str, user_prompt: str, max_tokens: int = 2000, temperature: float = 0.3) -> Generator[str, None, None]:
        try:
            with httpx.Client(timeout=30.0) as client:
                payload = {
                    "model": self.settings.PRIMARY_LLM_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "stream": True,
                }
                with client.stream(
                    "POST",
                    self.settings.PRIMARY_LLM_API_BASE.rstrip("/") + "/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.settings.PRIMARY_LLM_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                ) as response:
                    response.raise_for_status()
                    for line in response.iter_lines():
                        if line.startswith("data: "):
                            data = line[6:]
                            if data.strip() == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data)
                                delta = chunk.get("choices", [{}])[0].get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    yield content
                            except json.JSONDecodeError:
                                continue
        except Exception:
            return

    def _call_llm(self, system_prompt: str, user_prompt: str, max_tokens: int = 2000, temperature: float = 0.3) -> str:
        try:
            with httpx.Client(timeout=15.0) as client:
                payload = {
                    "model": self.settings.PRIMARY_LLM_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "max_tokens": max_tokens,
                    "temperature": temperature,
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

    def _call_llm_with_tools(self, system_prompt: str, user_prompt: str, max_tokens: int = 512, max_tool_rounds: int = 3) -> str:
        tools_schema = [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": {"type": "object", "properties": {}},
                }
            }
            for t in self.tools[:10]
        ]

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        for round_num in range(max_tool_rounds):
            try:
                with httpx.Client(timeout=20.0) as client:
                    payload = {
                        "model": self.settings.PRIMARY_LLM_MODEL,
                        "messages": messages,
                        "tools": tools_schema if tools_schema else None,
                        "max_tokens": max_tokens,
                        "temperature": 0.1,
                    }
                    if not tools_schema:
                        del payload["tools"]
                    response = client.post(
                        self.settings.PRIMARY_LLM_API_BASE.rstrip("/") + "/chat/completions",
                        headers={
                            "Authorization": f"Bearer {self.settings.PRIMARY_LLM_API_KEY}",
                            "Content-Type": "application/json",
                        },
                        json=payload,
                    )
                    response.raise_for_status()
                    choice = response.json()["choices"][0]
                    message = choice["message"]

                    if message.get("tool_calls"):
                        messages.append(message)
                        for tool_call in message["tool_calls"]:
                            fn_name = tool_call["function"]["name"]
                            try:
                                fn_args = json.loads(tool_call["function"]["arguments"])
                            except json.JSONDecodeError:
                                fn_args = {}
                            tool_result = self._use_tool(fn_name, **fn_args)
                            messages.append({
                                "role": "tool",
                                "tool_call_id": tool_call["id"],
                                "content": tool_result,
                            })
                        continue

                    return (message.get("content") or "").strip()
            except Exception:
                break

        return ""

    def _calculate_confidence(self, evidence: list[dict[str, Any]], base: float = 0.0) -> float:
        if not evidence:
            return base
        scores = [ev.get("scores", {}).get("final", 0.0) for ev in evidence]
        return round(min(base + max(scores) * 0.7, 1.0), 3) if scores else base

    def _is_complex_query(self, query: str) -> bool:
        """Detect if a query needs decomposition (multi-part, comparison, deep analysis)."""
        indicators = [
            len(query.split()) > 25,
            query.count("?") > 1,
            any(kw in query.lower() for kw in [
                "compare", "difference", "versus", "vs",
                "list all", "every", "all the",
                "explain in detail", "tell me everything",
                "step by step", "pros and cons",
                "what are the", "what are all",
                "how does", "why does",
            ]),
        ]
        return sum(indicators) >= 2

    def _decompose_query(self, query: str, language: str) -> list[str]:
        """Break a complex question into sub-questions for better retrieval."""
        system_prompt = (
            "You are a query decomposition engine for a plant operations assistant. "
            "Break the operator's question into 2-4 independent sub-questions that can each be answered from documents. "
            "Output ONLY the sub-questions, one per line. No numbering, no explanations. "
            "Keep each sub-question specific and focused."
        )
        result = self._call_llm(
            system_prompt,
            f"Question: {query}\nLanguage: {language}\n\nDecompose this into sub-questions:",
            max_tokens=300,
            temperature=0.1,
        )
        if not result:
            return [query]
        sub_qs = [
            line.strip().lstrip("0123456789.)- ")
            for line in result.strip().split("\n")
            if line.strip() and len(line.strip()) > 10
        ]
        return sub_qs[:4] if sub_qs else [query]

    def _retrieve_evidence_iterative(
        self,
        query: str,
        *,
        top_k: int = 5,
        revision_id: str | None = None,
        max_rounds: int = 2,
    ) -> list[dict[str, Any]]:
        """Multi-round retrieval: initial pass + targeted follow-up if evidence is thin."""
        evidence = self._retrieve_evidence(query, top_k=top_k, revision_id=revision_id)

        if not evidence or len(evidence) < 3:
            return evidence

        avg_score = sum(
            ev.get("scores", {}).get("final", 0.0) for ev in evidence
        ) / len(evidence)

        if avg_score > 0.5 or max_rounds <= 0:
            return evidence

        reformulated = self._reformulate_query(query, evidence)
        if reformulated and reformulated.lower() != query.lower():
            extra = self._retrieve_evidence(reformulated, top_k=3, revision_id=revision_id)
            seen_ids = {ev.get("chunk_id") for ev in evidence}
            for ev in extra:
                if ev.get("chunk_id") not in seen_ids:
                    evidence.append(ev)

        evidence.sort(
            key=lambda e: e.get("scores", {}).get("final", 0.0),
            reverse=True,
        )
        return evidence[:top_k + 4]

    def _reformulate_query(self, query: str, evidence: list[dict[str, Any]]) -> str:
        """Generate a follow-up search query based on evidence gaps."""
        snippets = [
            (ev.get("content") or "")[:200]
            for ev in evidence[:3]
        ]
        system_prompt = (
            "You are a search query reformulator. Given an original query and retrieved evidence snippets, "
            "generate ONE alternative search query that would find information the original query missed. "
            "Output ONLY the reformulated query, nothing else."
        )
        return self._call_llm(
            system_prompt,
            f"Original query: {query}\n\nRetrieved snippets:\n" + "\n".join(snippets) + "\n\nAlternative query:",
            max_tokens=100,
            temperature=0.2,
        )
