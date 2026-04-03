from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

router = APIRouter(tags=["artifacts"])


@router.get("/artifacts/{analysis_id}/{filename}")
def get_artifact(request: Request, analysis_id: str, filename: str) -> FileResponse:
    if Path(filename).name != filename:
        raise HTTPException(status_code=400, detail="Invalid artifact filename.")

    base_dir = request.app.state.settings.artifacts_dir.resolve()
    artifact_path = (base_dir / analysis_id / filename).resolve()
    if base_dir not in artifact_path.parents:
        raise HTTPException(status_code=400, detail="Invalid artifact path.")
    if not artifact_path.exists():
        raise HTTPException(status_code=404, detail="Artifact not found.")
    return FileResponse(artifact_path)
