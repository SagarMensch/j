from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.extraction import BoundingBox, DocumentClass


NormalizedBlockType = Literal[
    "heading",
    "paragraph",
    "warning",
    "caution",
    "note",
    "procedure_step",
    "list_item",
    "table_like",
    "unknown",
]

ChunkType = Literal[
    "section",
    "procedure",
    "warning",
    "table_like",
    "notes",
    "mixed",
]

EntityType = Literal[
    "equipment",
    "instrument_tag",
    "alarm",
    "interlock",
    "safety_rule",
    "chemical",
    "ppe",
    "model_number",
]


class CanonicalBlock(BaseModel):
    block_id: str
    page_number: int
    block_type: NormalizedBlockType
    section_title: str | None = None
    text: str
    bbox: BoundingBox | None = None
    confidence: float | None = None
    reading_order: int
    source: Literal["native", "ocr", "hybrid"] = "native"
    source_classification: DocumentClass = "unknown"
    quality_flags: list[str] = Field(default_factory=list)


class CanonicalChunk(BaseModel):
    chunk_id: str
    chunk_index: int
    chunk_type: ChunkType
    content: str
    citation_label: str
    page_start: int
    page_end: int
    section_title: str | None = None
    block_ids: list[str] = Field(default_factory=list)
    equipment_tags: list[str] = Field(default_factory=list)
    safety_flags: list[str] = Field(default_factory=list)
    bbox_references: list[BoundingBox] = Field(default_factory=list)
    token_estimate: int = 0
    quality_flags: list[str] = Field(default_factory=list)


class EntityCandidate(BaseModel):
    entity_id: str
    entity_type: EntityType
    name: str
    normalized_name: str
    page_number: int
    block_id: str | None = None
    chunk_id: str | None = None
    confidence: float
    evidence_text: str


class CanonicalDocumentBundle(BaseModel):
    document_name: str
    source_pdf: str
    classification: DocumentClass = "unknown"
    page_count: int
    total_text_chars: int
    block_count: int
    chunk_count: int
    generated_at: datetime
    blocks: list[CanonicalBlock] = Field(default_factory=list)
    chunks: list[CanonicalChunk] = Field(default_factory=list)
    entity_candidates: list[EntityCandidate] = Field(default_factory=list)
    quality_summary: dict[str, int | float | str] = Field(default_factory=dict)


class CanonicalCorpusSummary(BaseModel):
    generated_at: datetime
    source_directory: str
    output_directory: str
    document_count: int = 0
    page_count: int = 0
    block_count: int = 0
    chunk_count: int = 0
    entity_candidate_count: int = 0
    classification_counts: dict[str, int] = Field(default_factory=dict)
    quality_counters: dict[str, int] = Field(default_factory=dict)
