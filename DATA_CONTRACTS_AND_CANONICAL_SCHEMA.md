# Jubilant Ingrevia Industrial Knowledge and Readiness Platform
## Data Contracts and Canonical Schema

## 1. Purpose

This document defines the canonical data model for Stage 1 of the platform.

Its purpose is to ensure that the following subsystems operate over one consistent representation of the 20-manual corpus:

- document extraction
- OCR fallback
- markdown and JSON exports
- chunk derivation
- semantic embeddings
- lexical indexing
- graph construction
- evidence rendering
- training generation
- assessments
- readiness analytics

This document should be treated as the contract boundary between the Document Intelligence Plane and all downstream planes.

---

## 2. Direct Answer on Stage 1 Direction

Yes. Your current Stage 1 direction is correct.

Stage 1 should be centered on:

1. extracting the PDF corpus correctly
2. classifying documents and pages as digital / scanned / mixed
3. preserving source fidelity through page images and structured metadata
4. storing normalized document, revision, page, block, and chunk records
5. loading entity relationships into Neo4j
6. generating semantic embeddings over canonical chunks
7. building lexical retrieval over the same canonical chunks
8. exposing a unified evidence model to the answering, training, and assessment systems

In other words:

- `extraction` is the entry point
- `canonical schema` is the control plane
- `graph + chunks + embeddings + BM25` is the retrieval substrate

That is the right Stage 1.

---

## 3. Stage 1 Data Flow

```text
PDF corpus
  -> document inspection
  -> page classification
  -> extraction
       -> native text path
       -> OCR path
  -> normalized page/block records
  -> markdown/json/page-image artifacts
  -> chunk derivation
  -> lexical index
  -> embedding generation
  -> graph entity extraction
  -> Supabase + Neo4j persistence
  -> retrieval and trust services
```

---

## 4. Canonical Object Hierarchy

The canonical hierarchy is:

1. `Document`
2. `DocumentRevision`
3. `ExtractedPage`
4. `ExtractedBlock`
5. `DocumentChunk`
6. `GraphEntity / GraphRelation`

This hierarchy is required because:

- retrieval operates primarily on chunks
- evidence rendering operates on pages and blocks
- revision control operates on revisions
- graph augmentation operates on extracted entities and relationships

---

## 5. Canonical Document Contract

### 5.1 Document

Represents the logical manual or controlled source document.

Required fields:

- `document_id`
- `document_code` if available
- `title`
- `document_type`
- `source_filename`
- `source_system`
- `department_name`
- `is_active`

Optional fields:

- `sharepoint_url`
- `equipment_family`
- `language`

Purpose:

- identifies the logical source independent of revision
- supports grouping of revisions
- provides a stable reference for training and compliance mapping

### 5.2 DocumentRevision

Represents one concrete revision of a controlled document.

Required fields:

- `revision_id`
- `document_id`
- `revision_label`
- `version_number`
- `effective_from`
- `effective_to`
- `approval_status`
- `is_latest_approved`
- `file_path`
- `page_count`
- `extraction_classification`
- `extraction_status`

Optional fields:

- `supersedes_revision_id`
- `approved_by`
- `reviewed_by`
- `revision_notes`

Purpose:

- enables latest-approved filtering
- enables historical retrieval when explicitly allowed
- supports revision-triggered training reassignment

---

## 6. Canonical Extraction Contract

### 6.1 ExtractedPage

Represents one normalized page record.

Required fields:

- `page_id`
- `revision_id`
- `page_number`
- `classification`
- `extracted_text_chars`
- `image_path`

Optional fields:

- `raw_text`
- `markdown_path`
- `ocr_used`
- `ocr_confidence`

Purpose:

- anchors page-level traceability
- supports evidence rendering and future visual retrieval
- supports scanned/digital quality diagnostics

### 6.2 ExtractedBlock

Represents the smallest structured evidence unit before chunking.

Required fields:

- `block_id`
- `page_id`
- `block_type`
- `text`

Optional fields:

- `section_title`
- `bbox`
- `confidence`
- `reading_order`

Valid Stage 1 block types:

- `paragraph`
- `heading`
- `list`
- `table`
- `warning`
- `procedure_step`
- `unknown`

Purpose:

- preserves source granularity
- allows chunking by semantic structure rather than fixed windows
- provides block-to-viewer and block-to-chunk traceability

---

## 7. Canonical Chunk Contract

Chunks are the primary retrieval unit.

### 7.1 Chunking principle

Chunks must be derived from structure, not merely token count.

Preferred chunk boundaries:

- procedure step
- troubleshooting instruction
- warning or caution block
- maintenance task block
- section paragraph group
- parameter table region

### 7.2 Required fields

- `chunk_id`
- `revision_id`
- `chunk_index`
- `chunk_type`
- `content`
- `citation_label`
- `page_start`
- `page_end`

### 7.3 Optional fields

- `section_title`
- `equipment_tags`
- `safety_flags`
- `block_ids`
- `bbox_references`
- `embedding_vector`
- `embedding_model`

### 7.4 Retrieval function

Every chunk must be simultaneously usable by:

- BM25 lexical retrieval
- semantic vector retrieval
- graph augmentation
- citation rendering
- training generation
- assessment provenance

This is why chunk records must remain canonical and stable.

---

## 8. Lexical Retrieval Contract

BM25 or equivalent lexical indexing should operate over canonical chunk records.

### 8.1 Lexical index input

Index fields:

- `content`
- `section_title`
- `citation_label`
- `equipment_tags`
- `document title`
- `revision metadata`

### 8.2 Lexical retrieval is critical for

- equipment identifiers
- alarm tags
- interlocks
- controller tags
- setpoints
- model numbers
- exact safety language

### 8.3 Control requirement

Lexical retrieval must reference `chunk_id` as its base unit, not an alternate text store.

That ensures:

- a single retrieval substrate
- stable citations
- no divergence between semantic and lexical evidence representations

---

## 9. Semantic Retrieval Contract

### 9.1 Embedding basis

Semantic embeddings are generated over canonical chunks, not arbitrary strings.

### 9.2 Stage 1 embedding record

Required fields:

- `chunk_id`
- `embedding_vector`
- `embedding_model`
- `embedding_dimension`
- `embedded_at`

### 9.3 Stage 1 model choice

For the current no-GPU environment, MiniLM-class sentence embeddings are the correct baseline because they are:

- CPU-feasible
- operationally simple
- strong enough for semantic recall in a 20-manual corpus

### 9.4 Control requirement

Embedding records must remain regenerable.

That means the platform must always retain:

- the canonical chunk text
- the chunk identifier
- the model name used

This is required for future migration to stronger embedding models without reauthoring the corpus.

---

## 10. Graph Contract

Neo4j should not be treated as a separate ad hoc store. It must be built from canonical document and chunk evidence.

### 10.1 Stage 1 graph node classes

- `Document`
- `DocumentRevision`
- `Equipment`
- `Subsystem`
- `Procedure`
- `ProcedureStep`
- `MaintenanceTask`
- `Alarm`
- `Interlock`
- `InstrumentTag`
- `SafetyRule`
- `PPE`
- `Chemical`
- `TrainingModule`
- `Assessment`

### 10.2 Stage 1 graph relation classes

- `HAS_REVISION`
- `SUPERSEDES`
- `DESCRIBES`
- `APPLIES_TO`
- `HAS_STEP`
- `USES`
- `REFERENCES`
- `REQUIRES`
- `ENFORCES`
- `DERIVES_FROM`
- `TESTS`

### 10.3 Graph provenance rule

Every graph node and relationship derived from source manuals should carry provenance references:

- `source_revision_id`
- `source_chunk_id` where applicable
- `source_page_number` where applicable

This is mandatory.

Graph facts without source provenance become untrustworthy operationally.

---

## 11. Evidence Contract

The retrieval and answering systems must consume and return a unified evidence object.

### Required fields

- `chunk_id`
- `document_id`
- `revision_id`
- `document_title`
- `revision_label`
- `page_number`
- `citation_label`
- `content`
- `bbox_references`

### Optional scoring fields

- `lexical_score`
- `semantic_score`
- `graph_score`
- `rerank_score`

Purpose:

- lets the Trust Plane verify claims
- lets the UI highlight exact evidence
- lets audit systems reconstruct why an answer was produced

---

## 12. Learning Contract

Stage 1 learning assets must remain source-grounded.

### 12.1 TrainingModule

Required fields:

- `module_id`
- `source_document_id`
- `source_revision_id`
- `title`
- `module_type`
- `criticality`
- `language`
- `validity_days`
- `total_steps`

### 12.2 TrainingStep

Required fields:

- `step_id`
- `module_id`
- `step_number`
- `title`
- `instruction`
- `source_chunk_id`

### 12.3 AssessmentQuestion

Required fields:

- `question_id`
- `assessment_id`
- `question_order`
- `question_text`
- `options`
- `correct_option`
- `source_chunk_id`

This means all learning artifacts remain traceable back to the manual corpus.

---

## 13. Readiness Contract

The readiness system should not compute vague analytics over opaque states.

It should compute readiness from canonical records:

- assignments
- completions
- assessment attempts
- certification status
- revision acknowledgment

### Required readiness inputs

- `user_id`
- `role`
- `department_id`
- `module assignment state`
- `assessment result state`
- `certification validity state`
- `revision-driven retraining requirement`

### Readiness output examples

- `operator readiness score`
- `department readiness score`
- `mandatory completion rate`
- `overdue critical modules`
- `certification expiry exposure`

---

## 14. Canonical Persistence Mapping

### Supabase / Postgres

Canonical authority for:

- documents
- revisions
- pages
- blocks
- chunks
- users
- assignments
- assessments
- attempts
- certifications
- retrieval telemetry

### pgvector

Canonical authority for:

- chunk embeddings

### Neo4j

Canonical authority for:

- graph entity topology
- graph relations

But Neo4j is not the provenance authority.
Source provenance still comes from document and chunk identifiers originating in the relational layer.

---

## 15. Why This Schema Is Future-Ready

This schema is future-ready because it already supports:

- stronger embedding models later
- visual retrieval later
- OCR refinement later
- multimodal evidence later
- graph-memory systems later
- telemetry-linked workflows later

The crucial point is that future systems can be added without redefining the core source units of truth.

Those source units are:

- revision
- page
- block
- chunk
- evidence provenance

That is the correct architectural foundation.

---

## 16. Immediate Implementation Implication

The next implementation step after this document is:

1. run the Stage 1 extraction pipeline across the 20 manuals
2. generate markdown, JSON, page images, and manifests
3. validate the extracted records against this schema
4. persist the canonical data into Supabase
5. derive graph entities and chunk embeddings from that persisted corpus

That is the correct execution path.
