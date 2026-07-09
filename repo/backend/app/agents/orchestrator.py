"""
Multi-Agent Orchestrator with fallback chains, streaming, and tool use.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Generator

from app.core.config import get_settings


class AgentType(str, Enum):
    SOP = "sop"
    TRAINING = "training"
    QUIZ = "quiz"
    SAFETY = "safety"
    EQUIPMENT = "equipment"
    APPEAL = "appeal"
    ANALYTICS = "analytics"
    GENERAL = "general"


AGENT_FALLBACK_CHAIN: dict[AgentType, list[AgentType]] = {
    AgentType.SOP: [AgentType.SAFETY, AgentType.GENERAL],
    AgentType.TRAINING: [AgentType.QUIZ, AgentType.GENERAL],
    AgentType.QUIZ: [AgentType.TRAINING, AgentType.GENERAL],
    AgentType.SAFETY: [AgentType.SOP, AgentType.GENERAL],
    AgentType.EQUIPMENT: [AgentType.SOP, AgentType.GENERAL],
    AgentType.APPEAL: [AgentType.GENERAL],
    AgentType.ANALYTICS: [AgentType.GENERAL],
    AgentType.GENERAL: [],
}


@dataclass
class AgentResult:
    agent_type: AgentType
    answer: str
    confidence: float
    evidence: list[dict[str, Any]] = field(default_factory=list)
    citations: list[str] = field(default_factory=list)
    diagnostics: dict[str, Any] = field(default_factory=dict)
    suggestions: list[str] = field(default_factory=list)
    requires_human: bool = False
    escalation_level: str | None = None


@dataclass
class QueryClassification:
    agent_type: AgentType
    confidence: float
    sub_intent: str | None = None
    entities: dict[str, list[str]] = field(default_factory=dict)
    urgency: str = "normal"


_SOP_KEYWORDS = frozenset({
    "sop", "procedure", "protocol", "standard operating", "manual", "handbook",
    "guideline", "instruction", "how to", "how do i", "steps", "process",
    "operation", "operating", "startup", "shutdown", "maintenance", "calibration",
    "inspection", "checklist", "workflow", "method", "technique", "practice",
})

_TRAINING_KEYWORDS = frozenset({
    "training", "learn", "teach", "course", "module", "lesson", "tutorial",
    "education", "study", "understand", "explain", "concept", "theory",
    "orientation", "onboarding", "induction", "certification program",
})

_QUIZ_KEYWORDS = frozenset({
    "quiz", "test", "exam", "assessment", "question", "answer", "score",
    "grade", "result", "pass", "fail", "mark", "evaluate", "certification",
    "certified", "competency", "qualification", "assessment result",
})

_SAFETY_KEYWORDS = frozenset({
    "safety", "hazard", "danger", "warning", "caution", "risk", "ppe",
    "protective", "emergency", "incident", "accident", "injury", "harm",
    "toxic", "chemical", "exposure", "evacuation", "fire", "explosion",
    "lockout", "tagout", "permit", "confined space", "fall protection",
    "sds", "msds", "safety data sheet", "first aid", "spill",
})

_EQUIPMENT_KEYWORDS = frozenset({
    "equipment", "machine", "pump", "valve", "motor", "compressor",
    "turbine", "heat exchanger", "reactor", "vessel", "tank", "pipe",
    "instrument", "sensor", "transmitter", "controller", "plc", "dcs",
    "specification", "specs", "rating", "capacity", "model", "serial",
    "maintenance log", "work order", "spare part", "repair", "overhaul",
})

_APPEAL_KEYWORDS = frozenset({
    "complaint", "grievance", "appeal", "issue", "problem", "concern",
    "dissatisfied", "unfair", "wrong", "mistake", "error", "escalate",
    "supervisor", "manager", "hr", "human resources", "report", "incident report",
    "violation", "non-compliance", "misconduct", "discrimination", "harassment",
})

_ANALYTICS_KEYWORDS = frozenset({
    "report", "analytics", "dashboard", "statistics", "data", "metrics",
    "kpi", "readiness", "compliance", "score", "performance", "trend",
    "summary", "overview", "department", "team", "operator performance",
})

_URGENCY_KEYWORDS = frozenset({
    "emergency", "urgent", "immediately", "critical", "asap", "right now",
    "help", "stop", "halt", "shut down", "evacuate", "alarm",
})

_PPE_KEYWORDS = frozenset({
    "ppe", "helmet", "gloves", "goggles", "safety shoes", "harness",
    "respirator", "mask", "ear protection", "face shield", "apron",
})


def _extract_entities(query: str) -> dict[str, list[str]]:
    entities: dict[str, list[str]] = {
        "equipment_codes": [],
        "chemical_names": [],
        "sop_codes": [],
        "alarm_codes": [],
        "page_references": [],
    }
    for m in re.finditer(r"\b[A-Z]{2,5}[-_]?\d{2,6}\b", query):
        entities["equipment_codes"].append(m.group(0))
    for m in re.finditer(r"\b(?:SOP|SMP|WID|MAN)[-.]?\d{2,6}\b", query, re.IGNORECASE):
        entities["sop_codes"].append(m.group(0))
    for m in re.finditer(r"\b(?:ALM|ALARM|HR|LR|HH|LL)[-_]?\d{2,6}\b", query, re.IGNORECASE):
        entities["alarm_codes"].append(m.group(0))
    for m in re.finditer(r"\bpage\s+(\d+)\b", query, re.IGNORECASE):
        entities["page_references"].append(m.group(1))
    return entities


def classify_query(query: str, history: list[dict[str, str]] | None = None) -> QueryClassification:
    from app.agents.cache import get_fast_response, FAST_TRACK_QUERIES

    normalized = query.lower().strip().rstrip("!.?")

    if normalized in FAST_TRACK_QUERIES:
        return QueryClassification(
            agent_type=AgentType.GENERAL,
            confidence=1.0,
            sub_intent="fast_track",
            urgency="normal",
        )

    lowered = query.lower().strip()
    entities = _extract_entities(query)

    urgency = "normal"
    for kw in _URGENCY_KEYWORDS:
        if kw in lowered:
            urgency = "high"
            break

    scores: dict[AgentType, float] = {a: 0.0 for a in AgentType}
    scores[AgentType.GENERAL] = 0.1

    for kw in _SOP_KEYWORDS:
        if kw in lowered:
            scores[AgentType.SOP] += 1.0
    for kw in _TRAINING_KEYWORDS:
        if kw in lowered:
            scores[AgentType.TRAINING] += 1.0
    for kw in _QUIZ_KEYWORDS:
        if kw in lowered:
            scores[AgentType.QUIZ] += 1.0
    for kw in _SAFETY_KEYWORDS:
        if kw in lowered:
            scores[AgentType.SAFETY] += 1.0
    for kw in _EQUIPMENT_KEYWORDS:
        if kw in lowered:
            scores[AgentType.EQUIPMENT] += 1.0
    for kw in _APPEAL_KEYWORDS:
        if kw in lowered:
            scores[AgentType.APPEAL] += 1.0
    for kw in _ANALYTICS_KEYWORDS:
        if kw in lowered:
            scores[AgentType.ANALYTICS] += 1.0

    if entities["sop_codes"]:
        scores[AgentType.SOP] += 2.0
    if entities["equipment_codes"]:
        scores[AgentType.EQUIPMENT] += 1.5
    if entities["alarm_codes"]:
        scores[AgentType.SAFETY] += 2.0
    if any(kw in lowered for kw in _PPE_KEYWORDS):
        scores[AgentType.SAFETY] += 1.5

    if history:
        for item in reversed(history[-3:]):
            if item.get("role") == "assistant":
                meta = item.get("metadata") or {}
                last_agent = meta.get("agent_type")
                if last_agent:
                    try:
                        scores[AgentType(last_agent)] += 0.3
                    except ValueError:
                        pass
                break

    best_agent = max(scores, key=lambda a: scores[a])
    best_score = scores[best_agent]
    total = sum(scores.values()) or 1.0
    confidence = best_score / total if best_score > 0 else 0.1

    if best_score <= 0.1:
        best_agent = AgentType.GENERAL
        confidence = 0.3

    sub_intent = None
    if best_agent == AgentType.SOP:
        if any(kw in lowered for kw in ["how to", "steps", "procedure"]):
            sub_intent = "procedural"
        elif any(kw in lowered for kw in ["safety", "warning", "caution"]):
            sub_intent = "safety_in_sop"
        elif any(kw in lowered for kw in ["spec", "rating", "capacity"]):
            sub_intent = "specification"
        else:
            sub_intent = "general_sop"
    elif best_agent == AgentType.TRAINING:
        if any(kw in lowered for kw in ["explain", "concept", "understand"]):
            sub_intent = "conceptual"
        elif any(kw in lowered for kw in ["module", "lesson", "course"]):
            sub_intent = "module_info"
        else:
            sub_intent = "general_training"
    elif best_agent == AgentType.QUIZ:
        if any(kw in lowered for kw in ["score", "result", "pass", "fail"]):
            sub_intent = "results"
        elif any(kw in lowered for kw in ["practice", "sample", "mock"]):
            sub_intent = "practice"
        else:
            sub_intent = "general_quiz"
    elif best_agent == AgentType.SAFETY:
        if any(kw in lowered for kw in ["ppe", "protective", "wear"]):
            sub_intent = "ppe"
        elif any(kw in lowered for kw in ["emergency", "evacuate", "alarm"]):
            sub_intent = "emergency"
        elif any(kw in lowered for kw in ["chemical", "hazard", "toxic", "sds"]):
            sub_intent = "chemical_safety"
        else:
            sub_intent = "general_safety"
    elif best_agent == AgentType.EQUIPMENT:
        if any(kw in lowered for kw in ["maintenance", "repair", "overhaul"]):
            sub_intent = "maintenance"
        elif any(kw in lowered for kw in ["spec", "rating", "model"]):
            sub_intent = "specification"
        else:
            sub_intent = "general_equipment"

    return QueryClassification(
        agent_type=best_agent,
        confidence=round(confidence, 3),
        sub_intent=sub_intent,
        entities=entities,
        urgency=urgency,
    )


def get_fallback_chain(agent_type: AgentType) -> list[AgentType]:
    return AGENT_FALLBACK_CHAIN.get(agent_type, [])
