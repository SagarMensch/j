"""
Vision Verification Service — Uses NVIDIA Nemotron VL to verify equipment condition from operator photos.

Based on research:
- MonitorVLM (arXiv 2025) — VLMs for safety violation detection
- AQ-VLM — Industrial VLM with 99%+ accuracy
- AI-Assisted Visual Inspection (Devenin 2026) — structured VLM output

Flow:
1. Operator takes photo of equipment during a Run Guide checkpoint
2. VLM analyzes the image against the checkpoint requirements
3. Returns: observation, compliance status, risks, recommended actions
"""
from __future__ import annotations

import base64
import json
from typing import Any

import httpx

from app.core.config import get_settings


settings = get_settings()

NVIDIA_VL_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

VERIFICATION_PROMPT = """You are an industrial equipment inspection expert for Jubilant Ingrevia plant operations.

Analyze the provided image of industrial equipment and verify whether it meets the checkpoint requirements.

CHECKPOINT REQUIREMENTS:
{checkpoint_instruction}

SAFETY STOP CONDITIONS:
{stop_conditions}

Analyze the image and provide a structured assessment:

1. OBSERVATION: What do you see in the image? Describe the equipment condition, visible components, and any notable features.

2. COMPLIANCE: Does the equipment appear to meet the checkpoint requirements?
   - "pass" = equipment appears ready and compliant
   - "fail" = equipment does not appear ready or has visible issues
   - "uncertain" = image quality or angle makes it hard to determine

3. RISKS: Any visible hazards, defects, leaks, damage, or safety concerns?

4. RECOMMENDED ACTION: What should the operator do next?

Respond ONLY in JSON format:
{{
  "observation": "...",
  "compliance": "pass" | "fail" | "uncertain",
  "risks": ["..."],
  "recommended_action": "..."
}}"""


async def verify_equipment_with_image(
    image_base64: str,
    mime_type: str,
    checkpoint_instruction: str,
    stop_conditions: list[str] | None = None,
) -> dict[str, Any]:
    """
    Send an operator photo to NVIDIA Nemotron VL for equipment verification.

    Args:
        image_base64: Base64-encoded image data
        mime_type: Image MIME type (image/png, image/jpeg, etc.)
        checkpoint_instruction: The current checkpoint text
        stop_conditions: List of safety stop conditions

    Returns:
        dict with keys: observation, compliance, risks, recommended_action
    """
    if not settings.NVIDIA_VL_REASONING_API_KEY:
        return {
            "observation": "Vision verification is not configured.",
            "compliance": "uncertain",
            "risks": [],
            "recommended_action": "Proceed with manual verification.",
        }

    stop_conditions_text = "\n".join(
        f"- {sc}" for sc in (stop_conditions or [
            "Leak visible",
            "Unusual noise or vibration",
            "Damaged or missing components",
            "Operator is unsure about condition",
        ])
    )

    prompt = VERIFICATION_PROMPT.format(
        checkpoint_instruction=checkpoint_instruction,
        stop_conditions=stop_conditions_text,
    )

    content = [
        {"type": "text", "text": prompt},
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:{mime_type};base64,{image_base64}"
            }
        }
    ]

    headers = {
        "Authorization": f"Bearer {settings.NVIDIA_VL_REASONING_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": settings.NVIDIA_VL_REASONING_MODEL,
        "messages": [
            {"role": "system", "content": "/think"},
            {"role": "user", "content": content},
        ],
        "max_tokens": 1024,
        "temperature": 0.2,
        "stream": False,
    }

    try:
        async with httpx.AsyncClient(timeout=settings.NVIDIA_VL_REASONING_TIMEOUT_SECONDS) as client:
            response = await client.post(NVIDIA_VL_URL, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()

        raw = data.get("choices", [{}])[0].get("message", {}).get("content", "")

        # Try to extract JSON from the response
        # The model might wrap it in ```json...``` or just return raw JSON
        json_match = raw.strip()
        if "```json" in json_match:
            json_match = json_match.split("```json")[1].split("```")[0].strip()
        elif "```" in json_match:
            json_match = json_match.split("```")[1].split("```")[0].strip()

        # Try to find JSON object
        start = json_match.find("{")
        end = json_match.rfind("}") + 1
        if start >= 0 and end > start:
            json_match = json_match[start:end]

        result = json.loads(json_match)
        return {
            "observation": result.get("observation", "Analysis complete."),
            "compliance": result.get("compliance", "uncertain"),
            "risks": result.get("risks", []),
            "recommended_action": result.get("recommended_action", "Proceed with caution."),
        }

    except json.JSONDecodeError:
        # If JSON parsing fails, return the raw text as observation
        return {
            "observation": raw[:500] if raw else "Could not parse vision analysis.",
            "compliance": "uncertain",
            "risks": [],
            "recommended_action": "Proceed with manual verification.",
        }
    except Exception as e:
        return {
            "observation": f"Vision analysis failed: {str(e)[:200]}",
            "compliance": "uncertain",
            "risks": [],
            "recommended_action": "Proceed with manual verification.",
        }
