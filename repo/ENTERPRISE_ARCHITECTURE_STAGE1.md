# Jubilant Ingrevia Industrial Knowledge and Readiness Platform
## Stage 1 Enterprise Architecture

## 1. Executive Intent

The Stage 1 program establishes the foundational architecture for an industrial knowledge, training, certification, and operational readiness platform serving plant operators, supervisors, and administrators across procedure-heavy environments.

The system is not defined as a chatbot. It is defined as a controlled, evidence-bound operational intelligence platform with the following primary objectives:

- reduce time-to-answer for equipment, procedure, and maintenance questions
- ensure every answer is traceable to approved source documentation
- enforce latest-revision correctness by default
- convert approved manuals and procedures into structured training and assessment assets
- provide management-grade visibility into training completion, certification status, and readiness posture
- preserve a future migration path toward multimodal, graph-memory, and event-aware industrial intelligence

Stage 1 is intentionally designed to be the strongest no-GPU architecture that remains operationally realistic on current infrastructure, while avoiding architectural decisions that would constrain future adoption of more advanced multimodal retrieval and reasoning systems.

---

## 2. Problem Statement

Operational knowledge in the target environment is fragmented across equipment manuals, standard operating procedures, maintenance instructions, and related documentation. These documents are heterogeneous in structure and quality:

- some are digitally generated and machine-readable
- some are scanned or image-heavy
- some contain mixed content across text, tables, warnings, signatures, and diagrams

Users currently face five structural problems:

1. documentation is difficult to search under time pressure
2. users cannot reliably determine whether they are reading the latest approved revision
3. training is separated from day-to-day operational knowledge access
4. compliance and readiness are difficult to monitor at scale
5. conventional generative AI systems are not sufficiently trustworthy in safety-sensitive contexts

The required system therefore must operate under a stricter discipline than consumer-grade question answering systems. It must privilege evidence, revision control, traceability, and operator trust over generative fluency.

---

## 3. Scope of Stage 1

Stage 1 covers the first operationally meaningful implementation over a 20-manual proof-of-concept corpus.

### In scope

- classification and structured extraction of 20 equipment manuals
- dual-path extraction for digital and scanned PDFs
- preservation of page images and bounding boxes for future evidence rendering
- normalized storage of document, revision, page, block, and chunk data
- graph construction over equipment, procedures, steps, alarms, tags, and safety entities
- hybrid retrieval using lexical, semantic, and graph expansion strategies
- evidence-bound answer generation with verification before response delivery
- mandatory training assignment, progress tracking, assessments, and readiness metrics
- multilingual response support in English, Hindi, and Hinglish

### Out of scope for Stage 1

- GPU-dependent multimodal VLM retrieval in production
- OCR-free retrieval over page images
- telemetry-integrated operational co-piloting
- autonomous actuation or machine control
- enterprise SSO and full security hardening beyond initial architecture alignment

---

## 4. Architectural Principles

The system shall be governed by the following principles.

### 4.1 Evidence over generation

The platform shall treat generation as a formatting and synthesis layer, not as a source of truth. Truth is established only through approved source documents and their traceable evidence spans.

### 4.2 Latest approved revision by default

Every retrieval and answering path shall operate against the latest approved revision unless an explicitly authorized historical query path is invoked.

### 4.3 Dual-path document intelligence

The platform shall support both native-text and OCR-based extraction paths so that scanned manuals do not become second-class knowledge sources.

### 4.4 Bounded reasoning

The platform shall use controlled workflows and verification loops rather than unconstrained agent behavior.

### 4.5 Model portability

The architecture shall not assume one permanent model provider. Embedding, generation, verification, and parsing components must be replaceable without redesigning the platform.

### 4.6 Future multimodal compatibility

Stage 1 artifacts must preserve page images, layout references, and evidence coordinates so that future visual retrieval and multimodal grounding can be layered onto the existing knowledge base.

### 4.7 Training and operations on a shared knowledge base

The same approved document corpus shall drive:

- question answering
- procedure walkthroughs
- training modules
- assessments
- readiness analytics

This eliminates divergence between knowledge access and learning systems.

---

## 5. Operating Model

The platform is organized into six functional planes.

### 5.1 Document Intelligence Plane

Responsible for:

- document intake
- PDF classification
- native extraction
- OCR fallback
- layout capture
- page image preservation
- structured normalization

### 5.2 Knowledge Plane

Responsible for:

- relational storage of documents, revisions, pages, chunks, and training data
- vector storage for semantic retrieval
- graph storage for entity relationships and multi-hop context expansion

### 5.3 Retrieval Plane

Responsible for:

- lexical retrieval
- semantic retrieval
- graph expansion
- evidence fusion and ranking
- revision-aware and role-aware filtering

### 5.4 Trust Plane

Responsible for:

- grounded answer generation
- answer verification
- citation enforcement
- confidence gating
- unsupported-answer suppression

### 5.5 Learning and Readiness Plane

Responsible for:

- mandatory assignment logic
- procedure-derived training modules
- assessments and certification
- completion tracking
- readiness scoring

### 5.6 Governance and Observability Plane

Responsible for:

- audit records
- quality metrics
- retrieval telemetry
- hallucination monitoring
- readiness reporting

---

## 6. Stage 1 Technology Baseline

Stage 1 is constrained to CPU-friendly operation while remaining architecturally aligned with future multimodal evolution.

### 6.1 Parsing and extraction

- `PyMuPDF`
  - native text extraction
  - page rendering
  - text-layer detection support
- `pypdf`
  - low-cost PDF inspection
- `Docling`
  - primary structured conversion engine
- OCR fallback layer
  - routed later to `PaddleOCR` or equivalent when available in the environment

### 6.2 Core application and persistence

- `Supabase Postgres`
  - primary relational persistence
- `pgvector`
  - semantic embedding storage
- `Neo4j`
  - graph persistence for entity and procedure relationships

### 6.3 Retrieval and orchestration

- `BM25`
  - exact lexical retrieval
- `MiniLM`-class sentence-transformer embeddings
  - CPU-efficient semantic retrieval
- `LangGraph`
  - orchestration of query and workflow state
- `DSPy`
  - prompt module optimization and compilation

### 6.4 Generation and voice

- `Groq`
  - primary generation and verification model endpoint
- `OpenRouter`
  - model fallback and experimentation
- `Sarvam`
  - STT/TTS for multilingual voice interactions

---

## 7. Document Intelligence Plane Design

### 7.1 Intake and classification

Each PDF shall first be classified as:

- `digital`
- `scanned`
- `mixed`
- `unknown`

The classification basis is the effective character yield from native extraction at page level. This routing is necessary to avoid over-reliance on OCR for high-quality digital PDFs while still fully supporting image-based documents.

### 7.2 Extraction strategy

#### Digital documents

Use native extraction and structured conversion to preserve high-fidelity text.

#### Scanned documents

Render pages to image assets and route through OCR-capable extraction.

#### Mixed documents

Support page-wise classification and mixed extraction behavior.

### 7.3 Extraction outputs

Each document conversion shall produce:

- Markdown export for human review
- JSON export for structured downstream processing
- page images for viewer support and future multimodal retrieval
- manifest summarizing extraction classification and success state

### 7.4 Normalized extraction objects

The canonical Stage 1 normalized schema must preserve:

- document
- revision
- page
- block
- chunk

At minimum, extracted records must carry:

- page number
- text
- block type
- section title where available
- image reference
- OCR confidence where applicable
- bounding boxes where available

### 7.5 Revision metadata

The extraction layer must also parse and normalize:

- revision label
- effective date
- approval status
- supersession indicators

This metadata is a control requirement, not an optional enrichment.

---

## 8. Knowledge Plane Design

### 8.1 Relational store

Supabase is the authoritative system of record for structured and transactional platform data:

- users
- roles
- departments
- documents
- revisions
- extracted pages
- extracted blocks
- chunks
- training modules
- training assignments
- assessments
- attempts
- certifications
- retrieval telemetry

### 8.2 Vector store

Embeddings are stored alongside document chunks in Postgres using `pgvector`. This preserves operational simplicity in Stage 1 and avoids premature proliferation of persistence layers.

### 8.3 Graph store

Neo4j maintains the entity relationship model required for graph-augmented retrieval and future graph-memory evolution.

Expected Stage 1 node categories:

- Document
- DocumentRevision
- Equipment
- Subsystem
- Procedure
- ProcedureStep
- MaintenanceTask
- Alarm
- Interlock
- InstrumentTag
- SafetyRule
- PPE
- Chemical
- TrainingModule
- Assessment

Expected relationship families:

- revision relationships
- equipment applicability relationships
- step-to-tag and step-to-safety relationships
- training derivation relationships
- assessment coverage relationships

---

## 9. Retrieval Plane Design

Stage 1 retrieval is deliberately hybrid.

### 9.1 Lexical retrieval

Lexical retrieval is mandatory for:

- equipment tags
- alarm identifiers
- interlock identifiers
- setpoints
- model numbers
- exact procedural phrasing

This is the function of BM25-style retrieval.

### 9.2 Semantic retrieval

Semantic retrieval is mandatory for:

- paraphrased questions
- natural-language operator phrasing
- multilingual or mixed-language query matching
- related concept recall across differently worded manuals

This is the function of MiniLM-class sentence embeddings in Stage 1.

### 9.3 Graph expansion

Graph expansion is mandatory for:

- equipment-to-procedure linkage
- procedure-to-step traversal
- alarm and interlock relatedness
- safety and PPE association

This is the function of Neo4j-backed context expansion.

### 9.4 Evidence fusion

The retrieval plane must merge lexical, semantic, and graph-derived evidence into a unified candidate set with the following retained for every candidate:

- source document
- revision
- page number
- citation label
- block or chunk reference
- lexical score
- semantic score
- graph relevance indicator

### 9.5 Retrieval policy controls

The retrieval plane must enforce:

- latest approved revision filtering
- role-aware filtering
- minimum confidence thresholds
- controlled top-k evidence bounds

---

## 10. Trust Plane Design

### 10.1 Answer generation role

The generation layer is permitted to:

- summarize
- translate
- simplify
- structure answers

It is not permitted to invent missing facts.

### 10.2 Verifier-first architecture

The answering path must include a verification stage after draft generation and before response delivery.

The verification stage evaluates:

- whether the answer is supported by retrieved evidence
- whether citations are valid
- whether the answer remains within revision-approved bounds
- whether the answer should be suppressed and replaced with a controlled fallback

### 10.3 Controlled fallback behavior

If the system cannot establish sufficient evidentiary support, the response shall be one of:

- `Not found in approved documents`
- `Low confidence, please verify manually`

### 10.4 Evidence contract

Every final answer must be able to return:

- answer text
- source document
- revision
- page number
- citation label
- bounding box reference where available
- confidence
- verification status

This is the operational basis for trust.

---

## 11. Learning and Readiness Plane Design

### 11.1 Shared knowledge source

Training assets must be derived from the same approved source documents used in question answering. This preserves doctrinal consistency.

### 11.2 Training model

Training modules are classified by:

- mandatory vs optional
- critical safety vs normal
- target role
- target department
- validity period
- revision linkage

### 11.3 Assignment logic

Assignments are created:

- by role and department policy
- by onboarding rules
- by critical revision change
- by certification expiry logic

### 11.4 Completion logic

Completion is not defined as page visitation. Completion requires:

- required steps finished
- acknowledgments captured where needed
- assessment completion where required

### 11.5 Assessment model

Assessments are document-grounded instruments used to validate:

- comprehension of procedures
- safety obligations
- identification of critical parameters
- readiness for operational use

Question provenance must be traceable back to source chunks.

### 11.6 Certification and readiness

Readiness is a derived metric built from:

- mandatory completion
- assessment outcomes
- certification status
- recency
- revision acknowledgment

This metric supports operator, supervisor, and department views.

---

## 12. Governance and Observability

The platform must measure both knowledge-system quality and workforce-readiness quality.

### 12.1 Knowledge-system quality

Track:

- retrieval recall
- citation correctness
- latest revision correctness
- unsupported-answer rate
- hallucination rate
- latency
- user feedback

### 12.2 Learning quality

Track:

- completion rate
- overdue mandatory assignments
- first-pass assessment rate
- concept-level failure frequency
- certification expiry exposure
- readiness distribution by department and role

### 12.3 Auditability

Every meaningful response should remain reconstructible through:

- query
- retrieved evidence set
- selected citations
- verifier output
- revision used

---

## 13. Data Contracts

Stage 1 requires stable contracts for:

- extraction outputs
- chunks and embeddings
- graph entities and relationships
- retrieval result payloads
- answer evidence payloads
- training assignment records
- assessment attempt records
- readiness aggregates

These contracts must be explicit because future multimodal retrieval, telemetry integration, and more advanced orchestration depend on them.

---

## 14. Control Objectives

The architecture is successful only if it satisfies the following controls.

### Control 1

The system shall never prefer an obsolete revision when a latest approved revision is available and relevant.

### Control 2

The system shall not deliver unsupported answers as if they were established facts.

### Control 3

The system shall expose sufficient citation and evidence information for operator trust and supervisory review.

### Control 4

The system shall support mandatory training and requalification driven by source-document change.

### Control 5

The system shall maintain a clean migration path to future multimodal document retrieval.

---

## 15. Stage 1 Future-Readiness Strategy

Even though Stage 1 is CPU-bound, the architecture is intentionally aligned to future extensions:

- page images are preserved for visual retrieval later
- bounding-box references are preserved for document-grounded rendering later
- graph entities are established early to support graph-memory evolution later
- retrieval remains hybrid so that visual or multimodal retrieval can be inserted as another retrieval source later
- orchestration is stateful so more advanced routing logic can be added without redesign

This is the key distinction between a prototype and a platform foundation.

---

## 16. Risks and Constraints

### 16.1 Document heterogeneity risk

Manuals may vary significantly in structure and extraction quality. Mitigation: dual extraction path and resumable conversion manifests.

### 16.2 OCR quality risk

Scanned pages may yield inconsistent OCR. Mitigation: preserve page images, confidence signals, and fallback review pathways.

### 16.3 Over-generation risk

Unsafe answers could emerge from under-constrained LLM calls. Mitigation: retrieval bounds, verifier stage, controlled fallback behavior.

### 16.4 Schema drift risk

Ad hoc ingestion formats create downstream instability. Mitigation: normalized contracts from Stage 1.

### 16.5 Operational sprawl risk

Too many tools can create fragile orchestration. Mitigation: use each tool for a clear architectural role rather than letting libraries define the architecture.

---

## 17. Stage 1 Execution Sequence

The implementation program should proceed in this order:

1. establish normalized extraction pipeline for all 20 manuals
2. generate manifests, page images, markdown, and JSON exports
3. parse and persist revision metadata
4. load normalized data into Supabase
5. derive chunks and embeddings
6. load graph entities and relationships into Neo4j
7. implement hybrid retrieval
8. implement verifier-first answering
9. implement training assignment and assessment logic
10. implement readiness analytics and quality telemetry

---

## 18. Immediate Architectural Position

Stage 1 is therefore best understood as:

an evidence-bound industrial document intelligence and readiness platform,
with a hybrid retrieval core,
a graph-augmented knowledge model,
a verifier-first trust layer,
and a shared knowledge base for both operations and learning.

That is the correct architectural posture for future-state evolution into multimodal industrial intelligence.
