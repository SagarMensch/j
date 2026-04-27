from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


DocumentClass = Literal["digital", "scanned", "mixed", "unknown"]
BlockType = Literal["paragraph", "heading", "list", "table", "warning", "procedure_step", "unknown"]


class BoundingBox(BaseModel):
    left: float
    top: float
    right: float
    bottom: float


class ExtractedBlock(BaseModel):
    block_id: str
    block_type: BlockType = "unknown"
    page_number: int
    section_title: str | None = None
    text: str
    bbox: BoundingBox | None = None
    confidence: float | None = None
    reading_order: int | None = None


class ExtractedPage(BaseModel):
    page_number: int
    classification: DocumentClass = "unknown"
    extracted_text_chars: int = 0
    raw_text: str | None = None
    image_path: str | None = None
    markdown_path: str | None = None
    ocr_used: bool = False
    ocr_confidence: float | None = None
    blocks: list[ExtractedBlock] = Field(default_factory=list)


class ExtractionArtifact(BaseModel):
    kind: Literal["markdown", "json", "page_images", "log", "manifest"]
    path: str


class ExtractedDocument(BaseModel):
    source_pdf: str
    document_name: str
    title: str | None = None
    document_type: str | None = None
    classification: DocumentClass = "unknown"
    page_count: int = 0
    total_text_chars: int = 0
    revision_label: str | None = None
    effective_date: str | None = None
    approval_status: str | None = None
    docling_status: Literal["success", "failed", "skipped"] = "skipped"
    docling_error: str | None = None
    pages: list[ExtractedPage] = Field(default_factory=list)
    artifacts: list[ExtractionArtifact] = Field(default_factory=list)


class ExtractionRunSummary(BaseModel):
    started_at: datetime
    completed_at: datetime | None = None
    source_directory: str
    output_directory: str
    document_count: int = 0
    successful_docling_runs: int = 0
    failed_docling_runs: int = 0
    documents: list[ExtractedDocument] = Field(default_factory=list)
