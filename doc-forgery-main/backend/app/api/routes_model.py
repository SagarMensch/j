from __future__ import annotations

from fastapi import APIRouter, Request

from app.schemas.responses import ModelInfoResponse

router = APIRouter(tags=["model"])


@router.get("/model/info", response_model=ModelInfoResponse)
def model_info(request: Request) -> ModelInfoResponse:
    return ModelInfoResponse.model_validate(request.app.state.model_loader.info())
