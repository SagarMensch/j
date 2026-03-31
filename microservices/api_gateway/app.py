from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


SERVICE_URLS = {
    "identity": os.getenv("IDENTITY_SERVICE_URL", "http://127.0.0.1:8101"),
    "knowledge": os.getenv("KNOWLEDGE_SERVICE_URL", "http://127.0.0.1:8102"),
    "training": os.getenv("TRAINING_SERVICE_URL", "http://127.0.0.1:8103"),
    "assessment": os.getenv("ASSESSMENT_SERVICE_URL", "http://127.0.0.1:8104"),
    "analytics": os.getenv("ANALYTICS_SERVICE_URL", "http://127.0.0.1:8105"),
    "voice": os.getenv("VOICE_SERVICE_URL", "http://127.0.0.1:8106"),
}

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = REPO_ROOT / "frontend"

app = FastAPI(title="api-gateway", version="1.0.0")

if FRONTEND_DIR.exists():
    app.mount("/ui", StaticFiles(directory=FRONTEND_DIR, html=True), name="ui")


async def _forward_json(method: str, service: str, path: str, *, params: dict[str, Any] | None = None, json_body: dict[str, Any] | None = None):
    base = SERVICE_URLS[service]
    url = f"{base}{path}"
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.request(method=method, url=url, params=params, json=json_body)
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response.json()


@app.get("/")
async def root():
    index_file = FRONTEND_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"status": "ok", "message": "Gateway is running. Frontend not found."}


@app.get("/api/health")
async def health():
    report = {"gateway": "ok", "services": {}}
    async with httpx.AsyncClient(timeout=20.0) as client:
        for name, base in SERVICE_URLS.items():
            try:
                resp = await client.get(f"{base}/health")
                report["services"][name] = {"status_code": resp.status_code, "body": resp.json() if resp.status_code == 200 else resp.text}
            except Exception as exc:  # noqa: BLE001
                report["services"][name] = {"status": "error", "error": str(exc)}
    return report


@app.get("/api/users")
async def users():
    return await _forward_json("GET", "identity", "/users")


@app.get("/api/dashboard/summary")
async def dashboard_summary(user_id: str):
    return await _forward_json("GET", "training", "/dashboard/summary", params={"user_id": user_id})


@app.post("/api/query")
async def query(payload: dict[str, Any]):
    return await _forward_json("POST", "knowledge", "/query", json_body=payload)


@app.get("/api/retrieval/status")
async def retrieval_status():
    return await _forward_json("GET", "knowledge", "/retrieval/status")


@app.get("/api/query/{event_id}/evidence")
async def query_evidence(event_id: str):
    return await _forward_json("GET", "knowledge", f"/query/{event_id}/evidence")


@app.get("/api/documents/{revision_id}/page/{page_number}")
async def document_page(revision_id: str, page_number: int):
    return await _forward_json("GET", "knowledge", f"/documents/{revision_id}/page/{page_number}")


@app.get("/api/training/assignments")
async def training_assignments(user_id: str):
    return await _forward_json("GET", "training", "/training/assignments", params={"user_id": user_id})


@app.get("/api/training/modules/{module_id}")
async def training_module(module_id: str, user_id: str):
    return await _forward_json("GET", "training", f"/training/modules/{module_id}", params={"user_id": user_id})


@app.post("/api/training/assignments/{assignment_id}/progress")
async def training_progress(assignment_id: str, payload: dict[str, Any]):
    return await _forward_json("POST", "training", f"/training/assignments/{assignment_id}/progress", json_body=payload)


@app.get("/api/assessments/{assessment_id}")
async def assessment(assessment_id: str, user_id: str):
    return await _forward_json("GET", "assessment", f"/assessments/{assessment_id}", params={"user_id": user_id})


@app.post("/api/assessments/{assessment_id}/submit")
async def assessment_submit(assessment_id: str, payload: dict[str, Any]):
    return await _forward_json("POST", "assessment", f"/assessments/{assessment_id}/submit", json_body=payload)


@app.get("/api/admin/readiness/overview")
async def readiness_overview(user_id: str):
    return await _forward_json("GET", "analytics", "/admin/readiness/overview", params={"user_id": user_id})


@app.post("/api/chat")
async def chat(payload: dict[str, Any]):
    return await _forward_json("POST", "voice", "/chat", json_body=payload)


@app.post("/api/stt")
async def stt(audio: UploadFile = File(...), language: str = Form("auto")):
    base = SERVICE_URLS["voice"]
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{base}/stt",
            data={"language": language},
            files={"audio": (audio.filename or "audio.webm", await audio.read(), audio.content_type or "audio/webm")},
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response.json()


@app.post("/api/voice")
async def voice(audio: UploadFile = File(...), language: str = Form("auto"), speaker: str = Form("meera")):
    base = SERVICE_URLS["voice"]
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{base}/voice",
            data={"language": language, "speaker": speaker},
            files={"audio": (audio.filename or "audio.webm", await audio.read(), audio.content_type or "audio/webm")},
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response.json()
