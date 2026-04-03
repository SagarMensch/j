from __future__ import annotations

from pydantic import BaseModel, Field


class HistoryQueryParams(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=10, ge=1, le=100)
