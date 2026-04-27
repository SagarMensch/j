# Stage 1 SOTA Blueprint

This document defines the most advanced realistic Stage 1 architecture for the Jubilant Ingrevia 20-manual POC under the current constraint of **no GPU**.

The objective is not "simple RAG". The objective is:

- trustworthy answers
- latest-revision correctness
- exact citations with page and bounding box traceability
- equipment-aware retrieval
- mandatory training and quiz tracking
- admin readiness analytics
- future compatibility with multimodal and graph-memory systems

---

## 1. Stage 1 Definition

Stage 1 is the strongest no-GPU system that can still be built and evaluated quickly on the 20 sample manuals.

It includes:

- document classification: digital vs scanned vs mixed PDFs
- structured extraction with OCR fallback
- page image preservation for future visual retrieval
- section-aware and procedure-aware chunking
- hybrid retrieval:
  - lexical
  - semantic
  - graph expansion
- verifier-first grounded answering
- exact citation and bounding-box traceability
- multilingual output support
- mandatory training
- assessments
- readiness analytics

It does **not** yet require:

- full VLM parsing
- ColPali/ColQwen2 deployment
- OCR-free retrieval
- GPU-only models
- full production infrastructure

---

## 2. System Goal

For any question over the 20 manuals, the system should:

1. identify the correct latest approved source
2. retrieve the correct procedural or technical evidence
3. answer only from that evidence
4. cite exact source locations
5. highlight the page region in the document viewer
6. support training, certification, and readiness workflows built from the same document base

---

## 3. No-GPU SOTA Stack

### Parsing and extraction

- `PyMuPDF`
  - detect text-layer quality
  - render page images
  - basic text extraction for digital PDFs
- `Docling`
  - primary structured document parser where it succeeds
- `PaddleOCR`
  - OCR fallback for scanned or mixed PDFs
- `pdfplumber`
  - table and page structure helper for difficult layouts

### Text and retrieval

- `BM25`
  - exact lexical retrieval for equipment tags, alarms, setpoints, IDs, chemical names
- `sentence-transformers/all-MiniLM-L6-v2`
  - CPU-friendly semantic retrieval baseline
- multilingual upgrade path:
  - `jina-embeddings-v3` class models later if stronger Hindi/Hinglish retrieval is needed

### Graph

- `Neo4j`
  - document entity graph
  - equipment-procedure-step-safety relationships

### Application and state

- `Supabase Postgres`
  - users
  - roles
  - documents
  - revisions
  - extracted pages
  - chunks
  - training
  - assessments
  - analytics
- `pgvector` in Supabase
  - embeddings for semantic retrieval

### Orchestration and prompting

- `LangGraph`
  - stateful query and workflow orchestration
- `DSPy`
  - compile and optimize prompt modules

### Generation and voice

- `Groq`
  - primary LLM for answer generation and verification
- `OpenRouter`
  - fallback / experimentation layer
- `Sarvam`
  - STT/TTS for voice mode

---

## 4. Core Architecture

```text
PDF manuals
  -> classification (digital/scanned/mixed)
  -> extraction pipeline
       -> native text extraction
       -> OCR fallback
       -> section detection
       -> table capture
       -> bbox capture
       -> page image preservation
  -> normalized document schema
  -> storage
       -> Supabase relational
       -> pgvector embeddings
       -> Neo4j graph

User query
  -> LangGraph workflow
       -> query classification
       -> query rewrite
       -> hybrid retrieval
            -> BM25
            -> semantic retrieval
            -> graph expansion
       -> rerank / merge evidence
       -> grounded answer generation
       -> answer verification
       -> response with citations and bbox

Training flow
  -> approved procedure chunks
  -> step generation
  -> mandatory assignment
  -> progress tracking
  -> quiz generation
  -> readiness analytics
```

---

## 5. Extraction Pipeline

### 5.1 PDF classification

Every PDF must be classified before extraction:

- `digital`
  - strong text layer available
- `scanned`
  - little or no native text
- `mixed`
  - some pages digital, some scanned, or image-heavy

### 5.2 Extraction routing

- digital PDFs:
  - PyMuPDF text + Docling structure
- scanned PDFs:
  - page render + PaddleOCR + layout grouping
- mixed PDFs:
  - page-wise routing

### 5.3 What must be extracted

For every page and block:

- document filename
- source page image reference
- page number
- raw text
- section title
- block type
  - paragraph
  - heading
  - list
  - table
  - warning
  - procedure step
- bounding box
- OCR confidence if applicable
- reading order

For every document:

- title
- document type
- equipment/manual name
- revision label
- effective date
- approval metadata
- language if detectable

### 5.4 Output artifacts

For each PDF create:

- `*.md`
  - readable markdown export
- `*.json`
  - normalized structured output
- page images
  - for viewer and future multimodal retrieval

---

## 6. Chunking Strategy

Do not chunk by fixed token windows only.

Primary chunk units:

- procedure step
- troubleshooting block
- warning/safety instruction
- maintenance step
- parameter/specification table group
- section paragraph group

Each chunk should store:

- chunk ID
- document ID
- revision ID
- page start
- page end
- section title
- chunk text
- bbox references
- chunk type
- equipment tags detected
- safety flags detected
- embedding

---

## 7. Retrieval Architecture

### 7.1 Retrieval modes

Stage 1 retrieval should combine:

1. `lexical retrieval`
   - BM25
2. `semantic retrieval`
   - MiniLM embeddings
3. `graph expansion`
   - Neo4j neighborhood retrieval using detected entities

### 7.2 Why all three are needed

- BM25 catches exact IDs like:
  - `PRV-101`
  - `E5707A`
  - `FIC 5101`
- MiniLM catches paraphrases
- Neo4j connects related procedures, alarms, equipment, and safety rules

### 7.3 Retrieval output

The merged retrieval set should carry:

- chunk text
- source document
- source revision
- page number
- citation label
- bbox
- lexical score
- semantic score
- graph relevance score

### 7.4 Hard retrieval rules

- latest approved revision only by default
- role-based filters before answer generation
- if evidence quality is weak, do not answer confidently

---

## 8. Graph Schema

### 8.1 Core nodes

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
- `Assessment`
- `TrainingModule`

### 8.2 Core relationships

- `Document HAS_REVISION DocumentRevision`
- `DocumentRevision DESCRIBES Equipment`
- `Procedure APPLIES_TO Equipment`
- `Procedure HAS_STEP ProcedureStep`
- `ProcedureStep USES InstrumentTag`
- `ProcedureStep REFERENCES Alarm`
- `ProcedureStep REFERENCES Interlock`
- `ProcedureStep REQUIRES PPE`
- `ProcedureStep ENFORCES SafetyRule`
- `MaintenanceTask APPLIES_TO Equipment`
- `DocumentRevision SUPERSEDES DocumentRevision`
- `TrainingModule DERIVES_FROM Procedure`
- `Assessment TESTS TrainingModule`

### 8.3 Stage 1 graph use

The graph should be used for:

- entity expansion during retrieval
- procedure-to-equipment linking
- revision tracking
- safety reasoning support
- training-to-procedure traceability

---

## 9. Answering Pipeline

### 9.1 LangGraph flow

Recommended Stage 1 query graph:

1. classify query
2. rewrite query
3. retrieve lexical evidence
4. retrieve semantic evidence
5. detect graph entities and expand context
6. merge and rerank evidence
7. grounded answer generation
8. answer verification
9. return response with citations and bbox references

### 9.2 DSPy modules

Use DSPy to optimize:

- `RewriteQuery`
- `GroundedAnswer`
- `VerifyGrounding`
- `GenerateTrainingStep`
- `GenerateAssessmentQuestion`

### 9.3 Verifier-first policy

If answer is unsupported:

- return `Not found in approved documents`
- or `Low confidence, please verify manually`

Never silently fill gaps.

### 9.4 Response contract

Every answer should return:

- answer text
- citations
- page numbers
- bbox references
- source revision
- confidence
- verification result

---

## 10. Mandatory Training System

### 10.1 Training model

Each training module should support:

- title
- type
  - mandatory
  - optional
  - critical safety
- linked procedure/manual
- target roles
- target departments
- validity period
- due date policy
- revision-triggered reassignment

### 10.2 Training progress tracking

Track:

- assignment created
- started
- current step
- progress percent
- paused/resumed
- completed
- overdue
- voice usage

### 10.3 Revision-triggered reassignment

When a critical revision changes:

- identify impacted modules
- identify impacted roles/departments
- auto-create new mandatory assignments
- notify supervisors/admins

---

## 11. Assessments and Certification

### 11.1 Assessment generation

Assessments must be built only from validated procedure content.

Question types:

- MCQ
- step ordering
- safety identification
- parameter recognition

### 11.2 Track for every attempt

- attempt number
- start and end time
- score
- pass/fail
- question-level responses
- concepts missed
- certification outcome
- expiry date

### 11.3 Certification logic

Certification should depend on:

- module completion
- pass threshold
- critical safety acknowledgment where required

---

## 12. Readiness Analytics

### 12.1 Admin metrics

Track:

- mandatory completion rate
- overdue assignments
- active certifications
- expired certifications
- assessment pass rates
- weak-topic clusters
- revision adoption rate
- department readiness score

### 12.2 Readiness score example

Suggested weighting:

- 40% mandatory training completion
- 30% assessment/certification status
- 20% completion recency
- 10% latest revision acknowledgment

### 12.3 Dashboard views

- operator view
- supervisor view
- admin readiness view
- department/role filters

---

## 13. Evaluation Plan for the 20 Manuals

Create a gold evaluation set of at least 100 questions:

- procedure questions
- troubleshooting questions
- safety questions
- exact parameter/tag questions
- maintenance questions
- revision-sensitive questions

Measure:

- answer correctness
- citation correctness
- latest-revision correctness
- top-k retrieval recall
- hallucination rate
- no-answer precision
- latency
- multilingual usability

For training:

- completion rate
- first-attempt pass rate
- concept error frequency
- overdue mandatory compliance

---

## 14. Stage 1 Deliverables

The Stage 1 build is complete when these are working:

1. all 20 manuals converted to normalized markdown/json
2. every page has page-level traceability and image reference
3. hybrid retrieval returns cited evidence
4. answer flow returns bbox-backed citations
5. latest approved revision logic is enforced
6. graph entities and relations are loaded into Neo4j
7. mandatory training assignments exist
8. assessments can be taken and scored
9. readiness dashboard has real data

---

## 15. Immediate Build Order

1. extraction pipeline for 20 manuals
2. normalized schema and storage
3. revision metadata parser
4. chunking and embedding
5. BM25 + semantic retrieval
6. graph builder and Neo4j load
7. LangGraph query pipeline
8. verifier-first answering
9. training assignment engine
10. assessments and readiness analytics

---

## 16. What Makes This Stage 1 "SOTA"

Within no-GPU limits, this Stage 1 is advanced because it is:

- multimodal-ready
- verifier-first
- revision-aware
- graph-augmented
- hybrid retrieval based
- bbox-traceable
- workflow-native

It is not a toy chatbot.
It is the foundation of a future multimodal industrial knowledge operating system.
