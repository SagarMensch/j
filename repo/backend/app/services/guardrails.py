from __future__ import annotations

import re
from dataclasses import dataclass

from app.core.config import get_settings
from app.services.nvidia_nim import moderate_text_with_nvidia


@dataclass(frozen=True)
class GuardrailDecision:
    blocked: bool
    category: str | None = None
    reason: str | None = None
    severity: str = "medium"
    user_message: str = ""
    matched_terms: tuple[str, ...] = ()


_DANGEROUS_PATTERNS: dict[str, tuple[str, ...]] = {
    "sabotage_instructions": (
        r"\b(bypass|disable|override)\s+(interlock|alarm|trip|safety|protection|emergency stop|e-?stop)\b",
        r"\bhow\s+to\s+(disable|bypass|override)\b",
    ),
    "harm_or_violence": (
        r"\b(kill|hurt|injure|attack|assault|poison|explode)\b",
        r"\bmake\s+((a|an)\s+)?(bomb|explosive)\b",
    ),
    "cyber_abuse": (
        r"\b(hack|breach|ransomware|malware|ddos)\b",
        r"\bsteal\s+(credentials|passwords|data)\b",
    ),
    "self_harm": (
        r"\b(kill myself|harm myself|self[- ]?harm|suicide|end my life)\b",
    ),
    "weapon_construction": (
        r"\b(how\s+to|steps?\s+to|instructions?\s+to)\b.{0,48}\b(make|build|assemble|create)\b.{0,48}\b(gun|firearm|weapon|silencer|ghost gun)\b",
    ),
}

_OFFENSIVE_PATTERNS: dict[str, tuple[str, ...]] = {
    "abusive_language": (
        r"\b(fuck\s+you|idiot|bastard|bitch|moron)\b",
    ),
    "hate_or_harassment": (
        r"\b(i\s+hate\s+you|harass|racial slur)\b",
    ),
}

_INSTRUCTIONAL_INTENT_PATTERNS: tuple[str, ...] = (
    r"\bhow\s+to\b",
    r"\bshow\s+me\s+how\s+to\b",
    r"\bteach\s+me\s+to\b",
    r"\bsteps?\s+to\b",
    r"\binstructions?\s+(for|to)\b",
    r"\bguide\s+me\s+to\b",
)

_CHEMISTRY_ACTION_PATTERNS: tuple[str, ...] = (
    r"\b(make|create|mix|synthesize|prepare|manufacture|formulate|cook)\b",
)

_DANGEROUS_CHEMISTRY_PATTERNS: tuple[str, ...] = (
    r"\bdangerous\s+chemical(s)?\b",
    r"\btoxic\s+(chemical|gas|compound|substance)s?\b",
    r"\bpoison(ous)?\b",
    r"\btoxin(s)?\b",
    r"\bcyanide\b",
    r"\bchloroform\b",
    r"\bmustard\s+gas\b",
    r"\bchlorine\s+gas\b",
    r"\bnerve\s+agent\b",
    r"\bchemical\s+weapon(s)?\b",
)

_NVIDIA_REVIEW_HINTS: tuple[str, ...] = (
    r"\bunsafe\b",
    r"\bdanger(ous)?\b",
    r"\bharm\b",
    r"\bweapon\b",
    r"\bexplosive\b",
    r"\bchemical\b",
    r"\bsabotage\b",
    r"\bviolence\b",
    r"\bkill\b",
    r"\bhate\b",
    r"\babuse\b",
)


def _collect_matches(text: str, patterns: tuple[str, ...]) -> tuple[str, ...]:
    matches: list[str] = []
    for pattern in patterns:
        found = re.finditer(pattern, text, flags=re.IGNORECASE)
        for item in found:
            matches.append(item.group(0))
    return tuple(sorted({m.strip().lower() for m in matches if str(m).strip()}))


def _detect_dangerous_chemistry(text: str) -> tuple[str, tuple[str, ...]] | None:
    intent_matches = _collect_matches(text, _INSTRUCTIONAL_INTENT_PATTERNS)
    if not intent_matches:
        return None

    action_matches = _collect_matches(text, _CHEMISTRY_ACTION_PATTERNS)
    chemistry_matches = _collect_matches(text, _DANGEROUS_CHEMISTRY_PATTERNS)
    if action_matches and chemistry_matches:
        combined = tuple(sorted(set(intent_matches + action_matches + chemistry_matches)))
        return "dangerous_chemistry_instructions", combined

    return None


def _find_matches(text: str, pattern_group: dict[str, tuple[str, ...]]) -> tuple[str, tuple[str, ...]] | None:
    for reason, patterns in pattern_group.items():
        matches: list[str] = []
        for pattern in patterns:
            found = re.finditer(pattern, text, flags=re.IGNORECASE)
            for item in found:
                matches.append(item.group(0))
        if matches:
            normalized = tuple(sorted({m.strip().lower() for m in matches if str(m).strip()}))
            return reason, normalized
    return None


def _should_run_nvidia_guardrail(normalized: str) -> bool:
    if len(normalized) >= 240:
        return True
    return bool(_collect_matches(normalized, _NVIDIA_REVIEW_HINTS))


def _nvidia_guardrail(normalized: str) -> GuardrailDecision | None:
    settings = get_settings()
    provider = (settings.CONTENT_SAFETY_PROVIDER or "off").strip().lower()
    if provider != "nvidia":
        return None
    if not _should_run_nvidia_guardrail(normalized):
        return None

    verdict = moderate_text_with_nvidia(normalized)
    if not verdict:
        return None

    unsafe = bool(verdict.get("unsafe"))
    if not unsafe:
        return None

    category = str(verdict.get("category") or "dangerous").strip().lower()
    severity = str(verdict.get("severity") or "medium").strip().lower()
    reason = str(verdict.get("reason") or "nvidia_content_safety").strip() or "nvidia_content_safety"

    if category == "offensive":
        return GuardrailDecision(
            blocked=True,
            category="offensive",
            reason=reason,
            severity="medium" if severity not in {"medium", "high"} else severity,
            user_message=(
                "I cannot continue with abusive or offensive requests. "
                "This request has been escalated to supervisors."
            ),
            matched_terms=(reason.lower(),),
        )

    return GuardrailDecision(
        blocked=True,
        category="dangerous",
        reason=reason,
        severity="high" if severity not in {"low", "medium"} else severity,
        user_message=(
            "I cannot assist with harmful, unsafe, or sabotage-related requests. "
            "This request has been escalated to supervisors."
        ),
        matched_terms=(reason.lower(),),
    )


def evaluate_guardrail(text: str) -> GuardrailDecision:
    normalized = re.sub(r"\s+", " ", (text or "")).strip()
    if not normalized:
        return GuardrailDecision(blocked=False)

    dangerous = _find_matches(normalized, _DANGEROUS_PATTERNS)
    if dangerous:
        reason, matched = dangerous
        return GuardrailDecision(
            blocked=True,
            category="dangerous",
            reason=reason,
            severity="high",
            user_message=(
                "I cannot assist with harmful, unsafe, or sabotage-related requests. "
                "This request has been escalated to supervisors."
            ),
            matched_terms=matched,
        )

    dangerous_chemistry = _detect_dangerous_chemistry(normalized)
    if dangerous_chemistry:
        reason, matched = dangerous_chemistry
        return GuardrailDecision(
            blocked=True,
            category="dangerous",
            reason=reason,
            severity="high",
            user_message=(
                "I cannot assist with dangerous chemistry, harmful synthesis, or unsafe "
                "instructional requests. This request has been escalated to supervisors."
            ),
            matched_terms=matched,
        )

    offensive = _find_matches(normalized, _OFFENSIVE_PATTERNS)
    if offensive:
        reason, matched = offensive
        return GuardrailDecision(
            blocked=True,
            category="offensive",
            reason=reason,
            severity="medium",
            user_message=(
                "I cannot continue with abusive or offensive requests. "
                "This request has been escalated to supervisors."
            ),
            matched_terms=matched,
        )

    nvidia_decision = _nvidia_guardrail(normalized)
    if nvidia_decision:
        return nvidia_decision

    return GuardrailDecision(blocked=False)
