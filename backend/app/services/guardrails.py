from __future__ import annotations

import re
from dataclasses import dataclass


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
}

_OFFENSIVE_PATTERNS: dict[str, tuple[str, ...]] = {
    "abusive_language": (
        r"\b(fuck\s+you|idiot|bastard|bitch|moron)\b",
    ),
    "hate_or_harassment": (
        r"\b(i\s+hate\s+you|harass|racial slur)\b",
    ),
}


def _find_matches(text: str, pattern_group: dict[str, tuple[str, ...]]) -> tuple[str, tuple[str, ...]] | None:
    for reason, patterns in pattern_group.items():
        matches: list[str] = []
        for pattern in patterns:
            found = re.findall(pattern, text, flags=re.IGNORECASE)
            for item in found:
                if isinstance(item, tuple):
                    matches.append(" ".join(part for part in item if part))
                else:
                    matches.append(str(item))
        if matches:
            normalized = tuple(sorted({m.strip().lower() for m in matches if str(m).strip()}))
            return reason, normalized
    return None


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

    return GuardrailDecision(blocked=False)
