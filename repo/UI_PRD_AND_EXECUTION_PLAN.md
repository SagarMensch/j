# Jubilant Ingrevia Industrial Knowledge Platform
## UI Product Requirements Document and Execution Plan

## 1. Document Intent

This document defines the full UI product specification and delivery plan for the five approved screens:

1. Main Command Dashboard
2. Query Assistant + Document Viewer
3. Hands-Free Training Module
4. Knowledge Assessment
5. Admin Readiness Analytics

Primary objective:

- Deliver a production-grade, role-aware UI that provides trusted SOP/manual guidance, multilingual assistance, mandatory training, certification, and readiness visibility.

---

## 2. Scope and Product Boundary

In scope:

- Web application UX for operator, supervisor, and admin personas
- Evidence-grounded query experience with page-level citations
- Training, assessment, and readiness reporting flows
- Role-based access and language-aware UX behavior

Out of scope for this UI PRD:

- OCR internals
- embedding/model selection internals
- backend extraction pipeline internals

Those are defined in platform architecture documents and consumed here as backend capabilities.

---

## 3. User Roles and Access Model

### Operator

- Ask SOP/manual questions
- Consume guidance with citations
- Run assigned mandatory training
- Complete assessments and view own progress

### Supervisor

- All operator capabilities
- Assign or monitor training for teams
- View team-level completion and certification status

### Admin / Plant Leadership

- Full analytics visibility
- Department-level readiness and compliance views
- Workforce and policy configuration controls

RBAC requirement:

- Every screen, widget, and API response must be role-filtered server-side.

---

## 4. UX Principles

1. Evidence before fluency: every critical answer must be source-backed.
2. One primary action per screen: each screen has a clear dominant workflow.
3. Voice-first where safety or mobility requires hands-free operation.
4. Minimal cognitive switching between query, document, training, and assessment states.
5. Status transparency: progress, confidence, due dates, and readiness are always visible.

---

## 5. Information Architecture

Top navigation:

- Home / Dashboard
- Training
- Knowledge Base
- Reports / Admin
- Profile + Language selector (`ENG | HIN | HING`)

Global components:

- Role-aware header
- Notification center (alerts, due training, expiring certifications)
- Global command/search entry
- Session resume affordance for training/assessment

---

## 6. End-to-End User Journeys

### Journey A: Operator Query to Verified Action

1. Operator enters text/voice query from Dashboard.
2. System opens Query Assistant + Document Viewer.
3. Answer appears with citation metadata.
4. Viewer opens exact document section and highlights evidence.
5. Operator follows linked SOP step or transitions into training module.

Success criteria:

- User gets answer within target latency.
- Citation is present and navigable.
- Retrieved section reflects latest approved revision.

### Journey B: Mandatory Training Completion

1. Operator opens assigned module from Dashboard.
2. Hands-free step player runs with voice prompts.
3. User advances via voice/button controls.
4. Module marks complete and unlocks assessment.

Success criteria:

- Progress persistence across session interruptions.
- Completion state synchronized to assignment record.

### Journey C: Assessment to Certification

1. User starts module assessment.
2. System shows question progress, timer, and answer controls.
3. Pass threshold evaluated at submit.
4. Certification status updated and visible in dashboard.

Success criteria:

- Attempt audit log is immutable.
- Certification validity dates are computed and stored.

### Journey D: Admin Readiness Monitoring

1. Admin opens readiness dashboard.
2. Reviews readiness score, compliance by department, trend lines, operator status.
3. Filters by site/department/role.
4. Drills into non-compliant cohorts and assignment gaps.

Success criteria:

- Metrics are derived from canonical records, not UI-only calculations.
- Filters are deterministic and exportable.

---

## 7. Screen Specifications

## 7.1 Main Command Dashboard

Reference:

- `_prd_unzip/stitch_the_corporate_biosphere_prd/main_command_dashboard/screen.png`

Purpose:

- Single operational entry point for query, training, SOP access, and alerts.

Core components:

- AI search/voice command bar
- My Mandatory Training card (progress + due items)
- Recent SOPs card
- Safety Alerts card

Key interactions:

- Voice icon starts STT capture
- Selecting training item deep-links to training module
- Selecting SOP deep-links to query/viewer context

Data dependencies:

- assignment summary
- latest SOP recency list
- active alert feed

States:

- loading, empty, stale, offline fallback, role-restricted

## 7.2 Query Assistant + Document Viewer

Reference:

- `_prd_unzip/stitch_the_corporate_biosphere_prd/query_assistant_document_viewer/screen.png`

Purpose:

- Trusted query resolution with traceable evidence.

Core components:

- chat panel with multilingual support
- citation chips and confidence indicator
- PDF viewer with highlighted passage
- revision metadata badge (document, revision, effective date)

Key interactions:

- clicking citation jumps to page + highlight
- follow-up query uses session context
- unsupported query returns controlled fallback ("Not found in approved documents")

Hard controls:

- no uncited critical answer
- no superseded revision unless explicitly requested

## 7.3 Hands-Free Training Module

Reference:

- `_prd_unzip/stitch_the_corporate_biosphere_prd/hands_free_training_module/screen.png`

Purpose:

- Guided SOP execution training for plant-floor operation.

Core components:

- step header (`Step N of M`)
- large instruction panel
- voice-listening indicator
- audio guidance toggle
- back/next controls
- step progress rail

Key interactions:

- voice commands: next, back, repeat, pause
- inactivity timeout prompts resume
- completion checkpoint at final step

## 7.4 Knowledge Assessment

Reference:

- `_prd_unzip/stitch_the_corporate_biosphere_prd/knowledge_assessment_screen/screen.png`

Purpose:

- Validate understanding and issue certification status.

Core components:

- key learnings summary
- question panel with progress + timer
- option selection controls
- submit / next controls

Key interactions:

- one active question at a time
- timer and autosave attempt state
- submit evaluates pass/fail and updates certification

## 7.5 Admin Readiness Analytics

Reference:

- `_prd_unzip/stitch_the_corporate_biosphere_prd/admin_readiness_analytics/screen.png`

Purpose:

- Monitor workforce readiness and compliance posture.

Core components:

- operational readiness score
- department SOP compliance chart
- training completion trend chart
- operator certification status grid (search/filter)

Key interactions:

- filter by department, role, status, date range
- drill-down from KPI card to operator-level list
- export CSV/PDF for compliance reporting

---

## 8. Cross-Cutting Functional Requirements

1. Multilingual UX and response rendering (`ENG`, `HIN`, `HING`)
2. Voice input/output with explicit listen/speak states
3. Citation rendering with page anchor and evidence highlight
4. Revision-aware source display and latest-approved enforcement
5. RBAC at route, component, and API data layers
6. Telemetry for every critical user action and model-assisted response

---

## 9. UI Telemetry and Audit Events

Required event families:

- `ui.query_submitted`
- `ui.citation_opened`
- `ui.viewer_highlight_opened`
- `ui.training_step_advanced`
- `ui.training_module_completed`
- `ui.assessment_started`
- `ui.assessment_submitted`
- `ui.readiness_filter_applied`

Each event payload must include:

- `user_id`, `role`, `language`, `session_id`, `timestamp`

---

## 10. API Surface Required by UI

Dashboard:

- `GET /api/dashboard/summary`
- `GET /api/training/assignments`
- `GET /api/alerts/active`

Assistant/Viewer:

- `POST /api/query`
- `GET /api/documents/{revision_id}/page/{page_number}`
- `GET /api/query/{id}/evidence`

Training:

- `GET /api/training/modules/{id}`
- `POST /api/training/sessions/{id}/event`
- `POST /api/training/sessions/{id}/complete`

Assessment:

- `GET /api/assessments/{id}`
- `POST /api/assessments/{id}/answer`
- `POST /api/assessments/{id}/submit`

Analytics:

- `GET /api/admin/readiness/overview`
- `GET /api/admin/readiness/operators`
- `GET /api/admin/readiness/export`

---

## 11. Non-Functional Requirements

Performance targets:

- Dashboard first render <= 2.5s on standard enterprise network
- Query response initial token <= 3.5s target (excluding long evidence retrieval)
- Viewer citation jump <= 1.0s after click

Reliability targets:

- 99.5% monthly UI availability
- no data loss on training/assessment progress events

Security:

- SSO integration ready
- strict RBAC
- PII minimization in client state

Accessibility:

- keyboard navigation support
- clear focus states
- minimum contrast compliance for critical controls

---

## 12. Delivery Plan

## Phase 1: UI Foundation and Shell (1 sprint)

- route structure and RBAC guards
- shared design system tokens/components
- header/nav/language/profile framework

Exit criteria:

- all routes accessible by role matrix with placeholders

## Phase 2: Dashboard + Assistant/Viewer (2 sprints)

- implement Main Command Dashboard
- implement assistant panel and document viewer split
- wire citation-to-highlight interaction

Exit criteria:

- operator can query and open cited source evidence

## Phase 3: Training + Assessment (2 sprints)

- hands-free training player
- assessment runner and submission flow
- certification status rendering

Exit criteria:

- assigned module can be completed and assessed end-to-end

## Phase 4: Admin Readiness Analytics (1 sprint)

- KPI cards, trend charts, operator status grid
- filters and export paths

Exit criteria:

- admin can monitor and filter readiness and certification data

## Phase 5: Hardening and UAT (1 sprint)

- performance tuning
- accessibility fixes
- telemetry validation
- regression/UAT signoff

Exit criteria:

- release readiness signoff

---

## 13. Acceptance Criteria

1. Every critical response path displays evidence citation.
2. Mandatory training and assessment flows persist and recover state.
3. Admin dashboards reflect backend truth with role-safe filtering.
4. Language switching updates UI and assistant behavior consistently.
5. Audit telemetry is present for all required event families.

---

## 14. Execution Notes for Current Program State

Current platform readiness already provides:

- canonical chunk corpus
- BM25 lexical substrate
- ongoing MiniLM embedding generation

Immediate next engineering action after embedding completion:

1. load chunks + vectors into Supabase/pgvector
2. seed Neo4j entities from canonical entity candidates
3. expose UI contract APIs listed in Section 10
4. start Phase 1 and Phase 2 UI implementation
