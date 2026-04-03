from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.schemas.responses import DashboardSummaryResponse

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard/summary", response_model=DashboardSummaryResponse)
def dashboard_summary(
    request: Request,
    recent_limit: int = Query(default=8, ge=1, le=50),
    flagged_limit: int = Query(default=8, ge=1, le=50),
) -> DashboardSummaryResponse:
    payload = request.app.state.storage_service.get_dashboard_summary(
        recent_limit=recent_limit,
        flagged_limit=flagged_limit,
    )
    return DashboardSummaryResponse.model_validate(payload)
