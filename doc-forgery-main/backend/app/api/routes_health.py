from __future__ import annotations

from fastapi import APIRouter, Request

from app.schemas.responses import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    model_loader = request.app.state.model_loader
    return HealthResponse(
        status="ok",
        model_loaded=model_loader.model_loaded,
        checkpoint_exists=settings.checkpoint_path.exists(),
        database_ready=settings.db_path.exists(),
    )
