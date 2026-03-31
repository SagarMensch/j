# Jubilant Ingrevia Industrial Knowledge and Readiness Platform
## Stage 1 Normalization and Chunking Design

## 1. Purpose

The extraction run is not the retrieval substrate.

It is only the raw acquisition layer. The platform still requires a deterministic normalization stage that converts extraction artifacts into canonical blocks, chunks, and provenance-bearing entity candidates that can be safely consumed by:

- semantic retrieval
- lexical retrieval
- graph construction
- evidence rendering
- training derivation
- assessment provenance

This document defines that Stage 1 control layer.

---

## 2. Design Objective

The design objective is not to produce a human-readable export. The objective is to create a stable, machine-governed corpus representation with the following properties:

- deterministic
- source-grounded
- revision-safe
- citation-safe
- re-embeddable
- graph-derivable
- future-compatible with multimodal retrieval

---

## 3. Why Normalization Is Required

The Kaggle extraction outputs are useful, but they remain operationally unsafe as direct retrieval inputs because they still contain:

- duplicated lines
- OCR noise
- page furniture
- uncontrolled line breaks
- mixed native and OCR evidence representations
- variable structural fidelity across manuals

If indexed directly, these artifacts would degrade:

- retrieval precision
- citation fidelity
- trust verification
- training quality
- entity extraction quality

Normalization is therefore a required control, not an optimization.

---

## 4. Stage 1 Operating Model

```text
Kaggle extraction artifacts
  -> manifest and OCR loading
  -> text cleaning
  -> duplicate suppression
  -> block typing
  -> structural normalization
  -> chunk derivation
  -> entity hint derivation
  -> canonical bundle persistence
  -> embedding / BM25 / graph downstream
```

---

## 5. Control Principles

### 5.1 Canonical block first

All downstream systems should be derived from canonical blocks, not directly from raw markdown or OCR JSON.

### 5.2 Chunking by structure, not by arbitrary window

The system should preserve high-value operational boundaries such as:

- headings
- warnings
- cautions
- notes
- procedure steps
- table-like regions

### 5.3 Provenance must survive every transformation

Each chunk must retain:

- page span
- source block identifiers
- bounding-box references where available
- citation label

### 5.4 Determinism over prompt-driven restructuring

Stage 1 normalization should remain deterministic and local. This avoids introducing LLM variance into the core evidence substrate.

---

## 6. Canonical Outputs

The normalization stage emits three artifacts per manual:

### 6.1 `canonical_bundle.json`

Contains:

- canonical blocks
- canonical chunks
- entity candidates
- quality summary

### 6.2 `canonical_chunks.jsonl`

A retrieval-oriented export where each line is one chunk record.

### 6.3 `entity_candidates.jsonl`

A graph-seeding export for deterministic Stage 1 entity hints.

---

## 7. Block Normalization Logic

The normalization pipeline applies the following logic:

1. clean glyph artifacts and repeated whitespace
2. suppress repeated lines on the same page
3. discard page furniture such as isolated page counters
4. infer block type from structural heuristics
5. preserve OCR confidence and bounding boxes where available
6. mark quality flags for later audit

Stage 1 block classes are:

- `heading`
- `paragraph`
- `warning`
- `caution`
- `note`
- `procedure_step`
- `list_item`
- `table_like`
- `unknown`

---

## 8. Chunk Derivation Logic

Chunks are created by accumulating structurally compatible blocks until one of the following control boundaries is reached:

- a new heading
- a warning/caution/note boundary
- a procedure-step transition
- a table-like boundary
- a page transition after material content has already accumulated
- a soft character limit

This creates retrieval units that are materially closer to operational meaning than fixed-window token slices.

---

## 9. Entity Candidate Derivation

Stage 1 does not attempt full graph reasoning.

Instead, it emits deterministic entity candidates based on:

- equipment-tag patterns
- model-number patterns
- alarm language
- interlock language
- PPE language

Every entity candidate carries provenance:

- page number
- source block
- source chunk
- evidence text

This makes Stage 1 graph ingestion auditable and reversible.

---

## 10. Quality Controls

The pipeline emits quality counters such as:

- `ocr_used_pages`
- `native_block_count`
- `ocr_block_count`
- `low_ocr_confidence_blocks`

It also preserves per-block and per-chunk quality flags such as:

- `low_ocr_confidence`
- `non_ascii`
- `long_line`

These controls are necessary for:

- targeted manual review
- selective reprocessing
- future deep-pass upgrades

---

## 11. Downstream Consumption

The outputs of this stage are intended to feed:

### 11.1 Supabase / pgvector

- `documents`
- `document_revisions`
- `extracted_pages`
- `extracted_blocks`
- `document_chunks`
- chunk embeddings

### 11.2 BM25

- lexical index over `canonical_chunks.jsonl`

### 11.3 Neo4j

- initial entity nodes
- source-grounded relation seeding

---

## 12. Future-Readiness

This design is future-ready because the canonical bundle remains compatible with:

- stronger embedding models
- cross-encoder reranking
- multimodal page retrieval
- graph-memory retrieval
- verifier-first answering
- training and assessment generation

The platform therefore avoids a common failure mode: rebuilding the corpus representation every time a stronger retrieval or generation model becomes available.

---

## 13. Implementation Artifact

The implementation of this design is:

- [normalize_and_chunk_stage1.py](/C:/Users/sagar/Downloads/jubilantingrevia/scripts/normalize_and_chunk_stage1.py)

The canonical output models are defined in:

- [canonical.py](/C:/Users/sagar/Downloads/jubilantingrevia/backend/app/models/canonical.py)

---

## 14. Immediate Next Step

After normalization completes, the next execution step is:

1. inspect the canonical summary
2. inspect 2-3 canonical bundles
3. generate MiniLM embeddings over canonical chunks
4. build BM25 over canonical chunks
5. derive graph relations into Neo4j

That is the correct continuation of Stage 1.
