from __future__ import annotations

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from microservices.shared.runtime import service_health, settings


SARVAM_TTS_URL = settings.SARVAM_TTS_URL
SARVAM_STT_URL = settings.SARVAM_STT_URL
SARVAM_TRANSLATE_URL = settings.SARVAM_TRANSLATE_URL
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
AUTO_LANGUAGE = "unknown"
DEFAULT_TTS_LANGUAGE = "en-IN"
SUPPORTED_TTS_LANGUAGES = {
    "en-IN",
    "hi-IN",
    "bn-IN",
    "ta-IN",
    "te-IN",
    "gu-IN",
    "kn-IN",
    "ml-IN",
    "mr-IN",
    "pa-IN",
    "od-IN",
}


class ChatRequest(BaseModel):
    text: str
    language: str = "en-IN"
    speaker: str = "suhani"


app = FastAPI(title="voice-service", version="1.0.0")


def _require_secret(value: str, name: str):
    if not value:
        raise HTTPException(status_code=503, detail=f"{name} is not configured")


def _normalize_stt_language(language: str | None) -> str:
    if not language or language.lower() in {"auto", "unknown"}:
        return AUTO_LANGUAGE
    return language


def _get_detected_language(stt_data: dict, requested_language: str) -> str:
    detected_language = stt_data.get("language_code")
    if isinstance(detected_language, str) and detected_language.strip():
        return detected_language
    if requested_language != AUTO_LANGUAGE:
        return requested_language
    return DEFAULT_TTS_LANGUAGE


def _get_tts_language(detected_language: str) -> str:
    if detected_language in SUPPORTED_TTS_LANGUAGES:
        return detected_language
    return DEFAULT_TTS_LANGUAGE


async def _translate_speech_to_english(client: httpx.AsyncClient, audio_bytes: bytes, language: str) -> tuple[str, str]:
    stt_resp = await client.post(
        SARVAM_STT_URL,
        headers={"api-subscription-key": settings.SARVAM_API_KEY},
        data={
            "language_code": _normalize_stt_language(language),
            "model": settings.SARVAM_STT_MODEL,
            "mode": "translate",
        },
        files={"file": ("audio.webm", audio_bytes, "audio/webm")},
    )
    stt_resp.raise_for_status()
    stt_data = stt_resp.json()
    transcript = (stt_data.get("transcript") or "").strip()
    detected_language = _get_detected_language(stt_data, _normalize_stt_language(language))
    return transcript, detected_language


async def _translate_assistant_text(client: httpx.AsyncClient, assistant_text: str, target_language: str) -> tuple[str, str]:
    tts_language = _get_tts_language(target_language)
    if tts_language == DEFAULT_TTS_LANGUAGE:
        return assistant_text, tts_language

    translate_resp = await client.post(
        SARVAM_TRANSLATE_URL,
        headers={
            "api-subscription-key": settings.SARVAM_API_KEY,
            "Content-Type": "application/json",
        },
        json={
            "input": assistant_text,
            "source_language_code": DEFAULT_TTS_LANGUAGE,
            "target_language_code": tts_language,
            "model": settings.SARVAM_TRANSLATE_MODEL,
            "mode": settings.SARVAM_TRANSLATE_MODE,
        },
    )
    translate_resp.raise_for_status()
    translated_text = (translate_resp.json().get("translated_text") or "").strip()
    return translated_text or assistant_text, tts_language


async def _synthesize_speech(client: httpx.AsyncClient, text: str, language: str, speaker: str) -> str:
    tts_resp = await client.post(
        SARVAM_TTS_URL,
        headers={
            "api-subscription-key": settings.SARVAM_API_KEY,
            "Content-Type": "application/json",
        },
        json={
            "inputs": [text],
            "target_language_code": language,
            "speaker": speaker,
            "model": settings.SARVAM_TTS_MODEL,
            "pace": 1.0,
            "enable_preprocessing": True,
        },
    )
    tts_resp.raise_for_status()
    return tts_resp.json()["audios"][0]


@app.get("/health")
def health():
    return service_health("voice-service")


@app.post("/chat")
async def chat(req: ChatRequest):
    _require_secret(settings.GROQ_API_KEY, "GROQ_API_KEY")
    _require_secret(settings.SARVAM_API_KEY, "SARVAM_API_KEY")

    async with httpx.AsyncClient(timeout=45.0) as client:
        llm_resp = await client.post(
            GROQ_CHAT_URL,
            headers={
                "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.GROQ_MODEL,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are a plant-floor assistant. Keep responses concise, safety-first, and practical. "
                            "If uncertain, say you need verified SOP evidence."
                        ),
                    },
                    {"role": "user", "content": req.text},
                ],
                "max_tokens": 256,
                "temperature": 0.4,
            },
        )
        llm_resp.raise_for_status()
        assistant_text = llm_resp.json()["choices"][0]["message"]["content"]

    async with httpx.AsyncClient(timeout=45.0) as client:
        assistant_tts_text, tts_language = await _translate_assistant_text(client, assistant_text, req.language)
        audio_base64 = await _synthesize_speech(client, assistant_tts_text, tts_language, req.speaker)

    return {"user_text": req.text, "assistant_text": assistant_text, "audio_base64": audio_base64}


@app.post("/stt")
async def speech_to_text(audio: UploadFile = File(...), language: str = Form("auto")):
    _require_secret(settings.SARVAM_API_KEY, "SARVAM_API_KEY")
    audio_bytes = await audio.read()

    async with httpx.AsyncClient(timeout=45.0) as client:
        transcript, detected_language = await _translate_speech_to_english(client, audio_bytes, language)
    return {"text": transcript, "language": detected_language, "detected_language": detected_language}


@app.post("/voice")
async def voice_pipeline(audio: UploadFile = File(...), language: str = Form("auto"), speaker: str = Form("meera")):
    _require_secret(settings.GROQ_API_KEY, "GROQ_API_KEY")
    _require_secret(settings.SARVAM_API_KEY, "SARVAM_API_KEY")
    audio_bytes = await audio.read()

    async with httpx.AsyncClient(timeout=45.0) as client:
        user_text, detected_language = await _translate_speech_to_english(client, audio_bytes, language)

    if not user_text.strip():
        raise HTTPException(status_code=400, detail="Could not understand speech")

    async with httpx.AsyncClient(timeout=45.0) as client:
        llm_resp = await client.post(
            GROQ_CHAT_URL,
            headers={
                "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.GROQ_MODEL,
                "messages": [
                    {"role": "system", "content": "Respond briefly for voice. Prioritize safety."},
                    {"role": "user", "content": user_text},
                ],
                "max_tokens": 256,
                "temperature": 0.4,
            },
        )
        llm_resp.raise_for_status()
        assistant_text = llm_resp.json()["choices"][0]["message"]["content"]

    async with httpx.AsyncClient(timeout=45.0) as client:
        assistant_tts_text, tts_language = await _translate_assistant_text(client, assistant_text, detected_language)
        audio_base64 = await _synthesize_speech(client, assistant_tts_text, tts_language, speaker)

    return {
        "user_text": user_text,
        "assistant_text": assistant_text,
        "assistant_tts_text": assistant_tts_text,
        "audio_base64": audio_base64,
        "detected_language": detected_language,
        "tts_language": tts_language,
    }
