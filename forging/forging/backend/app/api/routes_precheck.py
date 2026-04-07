from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status

from app.schemas.responses import PrecheckResponse

router = APIRouter(tags=["precheck"])


@router.post("/precheck", response_model=PrecheckResponse)
async def precheck_document(
    request: Request,
    file: UploadFile = File(...),
) -> PrecheckResponse:
    payload = await file.read()
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    try:
        return request.app.state.precheck_service.inspect_upload(
            filename=file.filename or "upload.bin",
            payload=payload,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
