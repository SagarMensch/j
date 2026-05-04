# Jubilant Ingrevia Industrial Knowledge and Readiness Platform

**Project Documentation Report**

---

**Version:** 1.0
**Date:** April 2026
**Classification:** Internal / Stakeholder Distribution
**Owner:** Product, Operations & Engineering

---

## Table of Contents

1. Title Page
2. Executive Summary
3. Problem Statement
4. About the Product
5. Objectives
6. System Architecture
7. Features
8. Technology Stack
9. Workflow / Methodology
10. Data Used
11. Model / Logic Explanation
12. Results / Output
13. Use Cases
14. Limitations
15. Future Improvements
16. Conclusion

---

## 1. Title Page

**Jubilant Ingrevia Industrial Knowledge and Readiness Platform**

*AI-Powered Information Assistant & Training Engine*

---

**Prepared for:** Senior Leadership & Stakeholders

**Document Type:** Technical Product Documentation Report

**Scope:** Plant-floor knowledge access, operator training, assessment & certification, and workforce readiness monitoring across 50 manufacturing plants.

---

## 2. Executive Summary

Jubilant Ingrevia's Industrial Knowledge and Readiness Platform is an AI-powered enterprise system designed to transform how plant operators access, learn, and apply procedural knowledge from Standard Operating Procedures (SOPs), Standard Maintenance Processes (SMPs), and Work Instruction Documents (WIDs).

The platform delivers an intelligent question-and-answer capability where operators can ask questions in plain language — including Hindi and Hinglish — and receive accurate, source-grounded answers directly from approved documents. The system uses a hybrid retrieval architecture combining lexical search (BM25), semantic embeddings (MiniLM), and graph-based entity expansion (Neo4j) to ensure high-precision, trustworthy responses.

Beyond Q&A, the platform converts approved procedural documents into structured training modules, enforces mandatory learning paths, administers assessments, issues certifications, and provides management-grade dashboards for workforce readiness monitoring.

The system is built on a microservices architecture on AWS with enterprise-grade security, multi-tenant isolation per plant, and RBAC enforcement at the vector-database level. It is designed to operate without GPU dependency in Stage 1, making it deployable at scale across multiple facilities.

---

## 3. Problem Statement

Plant operators rely on SOPs, SMPs, and WIDs to perform daily activities safely and accurately. These documents are stored in SharePoint repositories across multiple libraries and are written in dense technical language. The current model presents five fundamental problems:

1. **Slow information retrieval** — Operators must manually navigate folders and search across multiple document libraries, often under time pressure in critical situations.
2. **High cognitive load** — Technical language in procedures creates comprehension barriers, especially for operators whose first language is not English.
3. **No guided training** — Onboarding relies heavily on classroom-based learning that is disconnected from day-to-day operational knowledge access.
4. **No voice support** — Operators in safety-critical environments cannot access procedural guidance hands-free while operating equipment.
5. **Compliance opacity** — Supervisors and administrators lack a unified view of workforce readiness, certification status, and overdue training across plants.

Collectively, these issues reduce productivity, increase training overhead, and elevate operational risk in environments where procedural errors can have safety and regulatory consequences.

---

## 4. About the Product

The Jubilant Ingrevia platform is an **evidence-bound industrial document intelligence and readiness system** that serves as a centralized knowledge and learning hub for plant operations.

At its core, the platform transforms existing SharePoint-based SOP, SMP, and WID documents into an interactive knowledge and learning ecosystem. It uses Retrieval-Augmented Generation (RAG) combined with a verifier-first answering architecture to ensure that every answer is traceable to a specific approved document, page, and revision.

The platform has four primary operational modes:

- **Query Mode:** Natural language Q&A with exact citations and evidence traceability
- **Training Mode:** Guided, step-by-step procedure walkthroughs with progress tracking
- **Assessment Mode:** Document-grounded quizzes with attempts, scoring, and pass rules
- **Voice Mode:** Hands-free, voice-to-voice interactions for plant-floor safety scenarios

The product serves four distinct user roles: plant operators, shift supervisors, training administrators, and QA/EHS auditors. Each role has a tailored interface with scoped access to the features and data relevant to their function.

---

## 5. Objectives

The platform aims to achieve the following objectives:

- Reduce the time and effort required for operators to locate, understand, and apply information from SOPs, SMPs, and WIDs during daily operations
- Enable faster and more effective onboarding of new operators through guided, self-paced training modules
- Ensure operators always reference the most current and approved procedures, reducing the risk of using superseded documentation
- Support ongoing skill development and knowledge reinforcement without disrupting operations or requiring operators to leave the plant floor
- Improve operator confidence and preparedness by providing real-time, hands-free access to procedural guidance and training support
- Provide supervisors with a deployable/non-deployable readiness view for their teams within 30 seconds
- Deliver an immutable audit trail for compliance and regulatory review
- Enable automated certificate renewal and re-certification when critical document revisions are approved

---

## 6. System Architecture

The platform follows a **domain-driven microservices architecture** with six functional planes:

### 6.1 Document Intelligence Plane

Handles document intake, classification, and extraction:

- Classifies each PDF as `digital`, `scanned`, or `mixed` based on native text layer availability
- Routes extraction accordingly: native text extraction for digital documents; OCR (PaddleOCR) for scanned pages; page-wise mixed routing for hybrid documents
- Preserves page images and bounding-box coordinates for future visual retrieval
- Extracts revision metadata (revision label, effective date, approval status, supersession indicators)

### 6.2 Knowledge Plane

Stores all platform data across three stores:

- **Supabase Postgres (OLTP):** Primary relational store for users, roles, departments, documents, revisions, chunks, training assignments, assessments, certifications, and retrieval telemetry
- **pgvector (vector store):** Stores chunk embeddings (1,536 dimensions via MiniLM) for semantic retrieval
- **Neo4j Aura (graph store):** Maintains entity relationships — equipment, procedures, steps, alarms, interlocks, safety rules, PPE, and training derivation links

### 6.3 Retrieval Plane

Executes hybrid retrieval across three layers simultaneously:

- **Lexical (BM25):** Handles exact matches for equipment tags (e.g., `PRV-101`, `FIC 5101`), model numbers, alarm identifiers, and precise procedural phrasing
- **Semantic (MiniLM embeddings):** Handles paraphrased questions, natural-language operator phrasing, multilingual queries, and cross-manual concept recall
- **Graph Expansion (Neo4j):** Expands context using entity relationships — equipment-to-procedure linkages, procedure-to-step traversal, alarm associations, and safety rule lookups

All three retrieval paths produce a unified candidate set with scores from each layer.

### 6.4 Trust Plane

Implements the **verifier-first architecture**:

- Grounded answer generation using retrieved evidence only
- Answer verification evaluates whether the generated answer is supported by retrieved chunks, whether citations are valid, and whether the answer falls within revision-approved bounds
- If evidence is insufficient, the system returns controlled responses: `Not found in approved documents` or `Low confidence, please verify manually`
- Every final answer carries a full evidence contract: source document, revision, page number, citation label, bounding-box reference, confidence score, and verification status

### 6.5 Learning and Readiness Plane

Manages the training and certification lifecycle:

- Assignments are created by role, department, onboarding rules, critical revision change, or certification expiry
- Completion requires all mandatory steps finished and acknowledged — not merely page visitation
- Assessments are document-grounded instruments derived from validated procedure content, with question-level traceability to source chunks
- Readiness index is a composite score: 35% training completion + 45% assessment score weighted + 20% certificate health

### 6.6 Governance and Observability Plane

Tracks both knowledge-system quality and workforce-readiness quality:

- Knowledge metrics: retrieval recall, citation correctness, latest-revision correctness, unsupported-answer rate, hallucination rate, latency
- Readiness metrics: completion rate, overdue mandatory assignments, first-pass assessment rate, concept-level failure frequency, certification expiry exposure

### 6.7 API Gateway

Single entry point for web and mobile clients. Handles authentication/authorization (JWT/OAuth), request shaping, tenant and role context propagation, and audit envelope creation.

---

## 7. Features

### 7.1 Intelligent Q&A

- Ask questions in natural language (English, Hindi, Hinglish)
- Receive answers grounded exclusively in approved SOP/SMP/WID documents
- Every answer includes exact citations: document name, revision, page number, and bounding-box reference
- Answers can be highlighted and traced back to source sections
- Unanswerable questions return controlled fallback responses — no silent hallucination

### 7.2 Voice Interaction (Hands-Free Mode)

- Voice-to-voice AI assistant using Sarvam STT/TTS
- Operators can ask questions and receive spoken responses without using a keyboard
- Supports interactive learning sessions with follow-up questions
- Designed for safety-critical environments where screen access is limited

### 7.3 Guided Training Modules

- Structured, step-by-step training experiences derived directly from approved operational procedures
- Modules classified by type: mandatory, role-based, refresher, incident-driven
- Criticality levels: normal, high, safety-critical
- Each step carries a source link to the originating document and revision
- Voice prompts available at each step for hands-free progression

### 7.4 Assessment Engine

- Document-grounded quizzes with configurable pass criteria (default 80%)
- Maximum attempts configurable (default 3), with cooldown after final fail (default 24 hours)
- Random question and option ordering to prevent answer sharing
- Every question maps to one source chunk for full traceability
- Post-submit explanations shown to reinforce learning
- Question types: single-choice MCQ, scenario MCQ, safest-action MCQ for safety-critical modules

### 7.5 Certificate Lifecycle Management

- Certificates issued automatically when module is complete and quiz is passed
- Status states: Active, ExpiringSoon, Expired, Revoked
- Auto-assignment of renewal training X days before expiry (default 30 days)
- Notification to operator and supervisor on expiry risk
- Revocation supported for superseded revisions or compliance incidents

### 7.6 Readiness Dashboard

**Operator View:** Due today items, overdue items, last quiz score, certificate health, next best action, critical safety updates

**Supervisor View:** Team readiness by shift/line, deployable/non-deployable status, overdue alerts and escalation visibility

**Admin View:** Plant/department/line/shift readiness, assignment funnel (assigned → started → completed → certified), pass rate distribution, weak-concept heatmap, certificate expiry risk, notification effectiveness, revision compliance gap

### 7.7 Notification and Escalation Engine

- Event triggers: assignment created, due in 7/3/1 days, overdue, quiz scheduled, quiz pass/fail, certificate issued/expiring/expired, revision updated
- Escalation matrix: Day 0 overdue → operator; Day 2 → operator + supervisor; Day 5 critical → operator + supervisor + training admin
- In-app notifications (mandatory v1); email (optional v1); SMS/WhatsApp (v2)

### 7.8 Multi-Tenant Isolation

- Each of 50 plants operates in a logically isolated workspace
- Data isolation enforced at database schema level, API endpoint level, and vector-database level
- Zero cross-plant data leakage guaranteed by RBAC at the retrieval layer

### 7.9 Admin Analytics and Audit Trail

- Full read-only evidence and exports for auditors
- Admin action audit trail: who did what, when, and why
- Mandatory 2-step confirmation for revocation and critical overrides

---

## 8. Technology Stack

### 8.1 Frontend

| Technology | Purpose |
|---|---|
| **Next.js 15** | React-based web framework with server-side rendering |
| **React 19** | UI component library |
| **Tailwind CSS 4** | Styling and responsive layout |
| **Zustand** | Lightweight state management |
| **Three.js / React Three Fiber** | 3D visualization capabilities |

### 8.2 Backend & Application

| Technology | Purpose |
|---|---|
| **FastAPI** | Python REST API framework |
| **Pydantic v2** | Data validation and settings management |
| **SQLAlchemy 2.0** | ORM for relational data |
| **LangGraph** | Stateful query and workflow orchestration |
| **DSPy** | Prompt module optimization and compilation |

### 8.3 Data Stores

| Technology | Purpose |
|---|---|
| **Supabase Postgres** | Primary OLTP store — users, documents, training, assessments |
| **pgvector** | Vector embedding storage for semantic retrieval |
| **Neo4j Aura** | Graph store for entity relationships and provenance |

### 8.4 Document Processing

| Technology | Purpose |
|---|---|
| **PyMuPDF** | Native text extraction and page rendering |
| **pypdf** | Low-cost PDF inspection |
| **Docling** | Primary structured document conversion engine |
| **PaddleOCR** | OCR fallback for scanned or mixed PDFs |
| **pdfplumber** | Table and page structure helper for difficult layouts |

### 8.5 Retrieval and Embeddings

| Technology | Purpose |
|---|---|
| **BM25** | Lexical retrieval for exact equipment tags, IDs, alarm terms |
| **sentence-transformers (MiniLM-L6-v2)** | CPU-efficient semantic embeddings (384 dimensions, upgradeable to 1,536) |

### 8.6 AI/ML Models

| Technology | Purpose |
|---|---|
| **Groq (LLM)** | Primary generation and verification model endpoint |
| **OpenRouter** | Model fallback and experimentation |
| **Sarvam AI** | STT/TTS for multilingual voice interactions |

### 8.7 Infrastructure & Deployment

| Technology | Purpose |
|---|---|
| **AWS (ap-south-1, Mumbai)** | Cloud hosting platform |
| **Docker / Kubernetes** | Containerization and orchestration |
| **AWS VPC (Private Subnets)** | Zero-trust network isolation |
| **AWS WAF + ALB** | Application firewall and load balancing |
| **AWS IAM + MFA** | Identity and access management |
| **AWS RDS (PostgreSQL, Multi-AZ)** | Managed relational database with automatic failover |
| **AWS ElastiCache (Redis)** | In-memory session and response caching |
| **AWS S3 + CloudFront** | Document storage and CDN for static assets |
| **AWS CloudWatch** | Monitoring, logging, and alerting |
| **Terraform / CloudFormation** | Infrastructure as Code |

---

## 9. Workflow / Methodology

### 9.1 Document Ingestion Pipeline

The document processing pipeline follows a six-stage execution model:

**Stage 1 — Intake & Classification:**
- PDFs are uploaded and classified as `digital`, `scanned`, or `mixed` based on native text layer detectability at the page level

**Stage 2 — Extraction:**
- Digital PDFs: PyMuPDF text extraction + Docling structured conversion
- Scanned PDFs: Page rendering to image + PaddleOCR + layout grouping
- Mixed PDFs: Page-wise routing based on classification

**Stage 3 — Normalization (Canonical Block Generation):**
- Clean glyph artifacts and repeated whitespace
- Suppress duplicate lines on the same page
- Discard page furniture (isolated page counters)
- Infer block type from structural heuristics: heading, paragraph, warning, caution, note, procedure_step, list_item, table_like
- Mark quality flags for later audit (low_ocr_confidence, non_ascii, long_line)

**Stage 4 — Chunking:**
- Accumulate structurally compatible blocks until a control boundary is reached: new heading, warning/caution boundary, procedure-step transition, table boundary, page transition after content accumulation, or soft character limit
- Each chunk retains: chunk ID, document ID, revision ID, page span, section title, chunk text, bbox references, chunk type, equipment tags, safety flags

**Stage 5 — Embedding & Indexing:**
- Generate MiniLM embeddings for each canonical chunk
- Build BM25 index over canonical chunks with token streams from content, section titles, citation labels, equipment tags, and safety flags
- Load chunk records into Supabase; vector records into pgvector; entity candidates into Neo4j

**Stage 6 — Quality Gates:**
- Minimum document count check
- Minimum chunk count check
- Embedding coverage threshold validation
- Retrieval sanity check
- Assignment and assessment cardinality checks

### 9.2 Query Execution Pipeline

When an operator submits a question:

1. **Query Classification:** Determine intent (procedure question, safety question, equipment question, training-related)
2. **Query Rewrite:** Reformulate for optimal retrieval (handled by DSPy-compiled rewrite module)
3. **Lexical Retrieval:** BM25 retrieves exact-match candidates for IDs, tags, and precise terms
4. **Semantic Retrieval:** MiniLM embeddings retrieve conceptually related chunks
5. **Graph Expansion:** Neo4j expands context using detected entities and their relationships
6. **Evidence Merge & Re-rank:** Unified candidate set with scores from all three retrieval paths
7. **Grounded Answer Generation:** LLM generates answer using retrieved evidence only
8. **Answer Verification:** Verifier evaluates whether answer is supported by evidence, citations are valid, and answer is within revision-approved bounds
9. **Response Delivery:** Answer with citations, page numbers, bbox references, confidence score, and verification status

### 9.3 Training and Certification Pipeline

1. Approved procedural documents feed into training derivation
2. Training modules are generated per procedure with steps, source links, and voice prompts
3. Assignments are created based on role, department, onboarding rules, or renewal policy
4. Operators complete mandatory steps in sequence (auto-saved after each step)
5. Quiz is administered with random question ordering and configurable pass rules
6. Certificate issued on successful completion; status tracked as Active/ExpiringSoon/Expired/Revoked
7. Renewal assignments auto-triggered N days before expiry

---

## 10. Data Used

### 10.1 Data Types

| Data Type | Description |
|---|---|
| **SOPs (Standard Operating Procedures)** | Approved step-by-step instructions for routine operations |
| **SMPs (Standard Maintenance Processes)** | Scheduled and corrective maintenance activities for equipment reliability |
| **WIDs (Work Instruction Documents)** | Task-level instructions for specific equipment or activity |
| **Equipment Manuals** | Manufacturer documentation for equipment operation and maintenance |
| **Training Records** | Assignment, progress, completion, and assessment data |
| **Certification Data** | Certificate issuance, expiry, renewal, and revocation records |
| **User & Role Data** | User profiles, department assignments, role permissions |

### 10.2 Source

Primary source documents are stored in SharePoint repositories. Documents are:

- Heterogeneous in structure and quality
- A mix of digitally generated and scanned/image-heavy PDFs
- Containing text, tables, warnings, signatures, and diagrams
- Subject to periodic revision with approval workflows

### 10.3 Document Schema (Normalized)

Each ingested document produces the following normalized records:

- `document` — title, type, equipment name, revision label, effective date, approval metadata
- `revision` — revision ID, supersession indicators, approval status
- `page` — page number, image reference, reading order
- `block` — block type, raw text, bounding box, OCR confidence where applicable
- `chunk` — chunk ID, page span, section title, cleaned text, equipment tags, safety flags

### 10.4 Preprocessing

- OCR applied to scanned pages with confidence scoring
- Text normalization: whitespace cleaning, duplicate suppression, structural typing
- Revision metadata parsed from document headers and approval sections
- Equipment tags, alarm language, interlock language, PPE language extracted via pattern matching for entity candidate derivation
- Quality flags assigned per block and chunk for targeted manual review

---

## 11. Model / Logic Explanation

### 11.1 Retrieval-Augmented Generation (RAG)

The platform uses a **verifier-first RAG** architecture rather than a naive RAG approach. The key distinction is that a generated answer passes through a verification stage before being returned to the user. If the verifier determines the answer is unsupported or exceeds revision-approved bounds, the system returns a controlled fallback rather than a potentially incorrect confident answer.

### 11.2 Hybrid Retrieval

The retrieval system combines three complementary approaches:

**BM25 (Lexical Retrieval):**
BM25 is a probabilistic ranking function used for exact-match text retrieval. It is particularly effective for retrieving content matching specific identifiers such as equipment tags (`PRV-101`), instrument tags (`FIC 5101`), model numbers, alarm terms, and exact procedural phrasing where semantic similarity would fail.

**MiniLM Semantic Embeddings:**
MiniLM (all-MiniLM-L6-v2) is a compact sentence-transformer model that maps text chunks into dense vector representations. It captures semantic meaning and handles paraphrased queries, natural-language phrasing, multilingual queries, and cross-manual concept matching that keyword search cannot handle.

**Neo4j Graph Expansion:**
Graph-based retrieval traverses entity relationships to expand context. For example, an operator query about a specific alarm triggers expansion to related equipment, applicable procedures, required PPE, associated safety rules, and maintenance tasks — creating a richer evidence set than text similarity alone.

### 11.3 DSPy Prompt Compilation

DSPy ( Declarative Self-Improving Python) is used to compile and optimize prompt modules for:
- Query rewriting for optimal retrieval
- Grounded answer generation
- Answer verification
- Training step generation
- Assessment question generation

DSPy replaces hand-tuned prompts with learned weightings across signature components, improving answer quality without manual prompt engineering.

### 11.4 Readiness Index Formula

The operator readiness score is computed as a weighted composite:

```
readiness_index = 0.35 × training_completion 
                + 0.45 × assessment_score_weighted 
                + 0.20 × certificate_health
```

Where:
- `training_completion`: percent of mandatory assignments completed on time
- `assessment_score_weighted`: latest score with safety-critical module multiplier
- `certificate_health`: percent of required certificates currently valid

Status thresholds:
- **Green (>= 85):** Fully deployable
- **Amber (70–84):** Conditionally deployable, needs attention
- **Red (< 70):** Non-deployable pending completion

### 11.5 Certificate Lifecycle State Machine

```
[Issued] → Active → ExpiringSoon → Expired
                  ↘ Revoked
```

- **Active:** Module complete, quiz passed, within validity period
- **ExpiringSoon:** Within N days of expiry, renewal assignment triggered
- **Expired:** Validity period elapsed, new assignment required
- **Revoked:** Superseded by revised document or compliance incident

### 11.6 Escalation Matrix

| Overdue Day | Notification To |
|---|---|
| Day 0 | Operator only |
| Day 2 | Operator + Supervisor |
| Day 5 (Critical) | Operator + Supervisor + Training Admin |

---

## 12. Results / Output

### 12.1 Q&A Output

For every user query, the system returns:

- **Answer text:** Plain-language response generated from retrieved evidence
- **Citations:** Source document name, revision ID, page number, citation label
- **Bounding-box reference:** Precise page region for evidence rendering and document viewer highlighting
- **Confidence score:** Numeric score indicating retrieval and verification quality
- **Verification status:** `VERIFIED`, `LOW_CONFIDENCE`, or `UNSUPPORTED`

### 12.2 Training Outputs

- **Training module:** Step-by-step walkthrough derived from an approved procedure, with source links per step
- **Progress record:** Tracks started, paused/resumed, current step, completion percent, completion timestamp
- **Completion record:** Required steps finished, acknowledgments captured, timestamp

### 12.3 Assessment Outputs

- **Attempt record:** Attempt number, start/end time, score, pass/fail, question-level responses, concepts missed
- **Certification record:** Certification ID, issued date, expiry date, status, linked module and revision

### 12.4 Analytics Outputs

- **Readiness dashboard data:** Operator-level scores, supervisor team view, department-level aggregates
- **Admin control tower data:** Completion funnel, pass rate distribution, weak-concept heatmap, certificate expiry risk, revision adoption rate
- **Audit logs:** All admin actions logged with user, action, timestamp, and reason

---

## 13. Use Cases

### 13.1 Plant Operator — Day-to-Day Query

An operator working on a reactor vessel needs to verify the correct pressure relief valve setting before startup. Instead of searching through SharePoint folders, they open the platform and type: *"what is the set pressure for PRV-101?"* The system retrieves the exact specification from the approved equipment manual, highlights the page region, and displays the current revision date — confirming it is the latest approved version. The answer is cited and traceable.

### 13.2 New Operator Onboarding

A new operator is assigned a mandatory training module on chemical handling procedures. The module walks them through each step with plain-language instructions and optional voice prompts. After completing all steps, they take a short assessment. On passing, their certification is updated automatically. Their supervisor sees the updated readiness score on the team dashboard.

### 13.3 Supervisor Readiness Check

A shift supervisor opens the team readiness view at the start of a shift. They see a color-coded list (Green/Amber/Red) showing each operator's deployability status. They notice one operator is Amber due to an expiring certificate. They trigger a renewal reminder directly from the dashboard.

### 13.4 Critical Revision Update

A safety-critical SOP is revised and approved. The system identifies all training modules linked to that document, automatically creates re-assignment tasks for all affected operators, and notifies supervisors of the compliance gap. Completed certifications for the old revision are marked for revocation.

### 13.5 Voice-Assisted Procedure Walkthrough

During a maintenance activity, an operator's hands are occupied but they need to verify the next step in a procedure. They use the voice assistant: *"What is step 3 of the pump alignment procedure?"* The system speaks back the step instructions from the approved WID, with full source traceability.

### 13.6 Auditor Compliance Review

A QA auditor needs to export evidence of training compliance for a specific plant and time period. They access the admin panel, apply date and department filters, and export a complete audit package covering operator completion records, assessment scores, certification statuses, and admin action logs — all immutably traceable to source documents.

---

## 14. Limitations

The following limitations are acknowledged honestly and practically:

1. **No GPU in Stage 1:** The platform operates within CPU-only constraints in Stage 1. This limits embedding model strength (MiniLM rather than larger models) and precludes use of VLM-based multimodal retrieval. OCR quality for heavily degraded scanned documents may be inconsistent.

2. **OCR quality dependency:** Scanned or photographically degraded documents produce variable OCR quality. Bounding-box accuracy and block typing can be unreliable for poor-quality source materials. Page images are preserved as a fallback for manual review.

3. **No enterprise SSO in Stage 1:** Full integration with Azure AD, Okta, or Microsoft 365 login is deferred. Initial deployment uses JWT-based authentication. Existing company login integration is planned for a future phase.

4. **Knowledge cut-off:** The system only knows what has been ingested. It cannot answer questions about undocumented procedures, informal knowledge not captured in SOPs, or events after the most recent document ingestion.

5. **Scope limited to SharePoint documents:** Stage 1 is designed to ingest from SharePoint repositories. Additional data sources beyond SharePoint are out of scope for the current phase.

6. **No biometric proctoring:** Assessment integrity relies on supervised environments. Biometric or advanced proctoring mechanisms are explicitly out of scope.

7. **Fixed language pairs:** Voice and text support is limited to English, Hindi, and Hinglish. Additional regional or international languages are planned for future phases.

8. **No real-time operational telemetry integration:** The system does not yet connect to live sensor data, SCADA systems, or operational data historians. Future integration is planned.

---

## 15. Future Improvements

The following realistic enhancements are planned for subsequent development phases:

1. **Multimodal retrieval (VLM-based):** Introduction of ColPali/ColQwen2 or equivalent VLM models for OCR-free retrieval over page images, enabling visual evidence grounding and diagram-aware answering.

2. **Graph-memory evolution:** Expanded use of the Neo4j knowledge graph for multi-hop reasoning, causal tracing of alarm-procedure-equipment relationships, and proactive anomaly contextualization.

3. **Adaptive psychometric testing:** Integration of adaptive testing methodologies that adjust question difficulty based on operator performance, providing more precise readiness measurement.

4. **Expanded language support:** Addition of more regional languages for both text and voice interactions to further reduce language barriers.

5. **Real-time operational integration:** Connecting the knowledge base to live operational data — sensor readings, SCADA signals, maintenance historians — to enable context-aware procedural guidance during active operations.

6. **Enhanced analytics and predictive alerting:** Use of historical completion and assessment data to predict which operators are at risk of certification lapses before they occur, and to recommend targeted interventions.

7. **Advanced proctoring:** Introduction of browser-based behavior analytics and optional biometric verification for assessments in sensitive safety-critical modules.

8. **Full SSO integration:** Complete integration with enterprise identity providers (Azure AD, Okta) for seamless, secure single sign-on across all plant systems.

---

## 16. Conclusion

The Jubilant Ingrevia Industrial Knowledge and Readiness Platform represents a significant step forward in how manufacturing organizations manage and distribute procedural knowledge to their workforce.

By combining hybrid retrieval (lexical, semantic, and graph-based), a verifier-first answering architecture, and a structured training and certification engine on a shared knowledge base, the platform ensures that every answer an operator receives is accurate, current, and traceable to an approved source document.

The system is designed to be enterprise-grade from the ground up: deployed on a Zero-Trust AWS architecture, with data isolation across 50 plant workspaces, RBAC enforced at the vector-database level, and full audit traceability for compliance. The microservices architecture enables independent scaling and evolution of each functional plane.

Stage 1 establishes the strongest no-GPU foundation that remains operationally realistic and strategically future-ready. All architectural decisions — page image preservation, bounding-box capture, graph entity seeding, canonical chunk normalization — are made with explicit compatibility for future multimodal, graph-memory, and event-aware capabilities.

The platform is not a chatbot. It is a controlled, evidence-bound operational intelligence platform purpose-built for environments where accuracy, traceability, and operator safety are non-negotiable.

---

*Document prepared by Engineering & Product — Jubilant Ingrevia*