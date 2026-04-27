# Implementation Backlog: Blue-Collar Learning and Readiness (v1)

Linked PRD: `PRD_BlueCollar_Learning_Readiness_v1.md`  
Version: 1.0  
Date: 2026-04-01  
Delivery mode: 6-week execution program

---

## 1. Delivery objective

Ship a production-ready workflow for:
- training assignment and step completion,
- quiz attempts and scoring,
- notification and escalation,
- certificate issuance and renewal,
- operator readiness dashboard,
- admin control tower with auditability.

---

## 2. Execution model

## 2.1 Team lanes
- `BE`: Backend/API/Data lifecycle
- `FE-OP`: Operator frontend
- `FE-AD`: Admin frontend
- `DATA`: Aggregations/metrics/reporting
- `QA`: Test automation/UAT
- `DEVOPS`: Runtime, jobs, monitoring

## 2.2 Priority rules
- `P0`: Required for go-live readiness
- `P1`: Required for quality and scale confidence
- `P2`: Enhancement after stable release

## 2.3 Estimation scale
- `S` = 0.5-1 day
- `M` = 2-3 days
- `L` = 4-6 days
- `XL` = 1-2 weeks

---

## 3. Milestones and sprint map

### Sprint 0 (Week 1): Policy + data foundation
- lock policy rules
- add missing schema
- baseline APIs and audit events

### Sprint 1 (Week 2): Operator training + quiz hardening
- simplify operator flows
- deterministic scoring and attempts

### Sprint 2 (Week 3): Notification + escalation engine
- queue, scheduler, reminder center

### Sprint 3 (Week 4): Certificate lifecycle + readiness index
- issue/expire/revoke automation
- readiness scoring APIs

### Sprint 4 (Week 5): Admin control tower
- role-scoped governance + actionable analytics

### Sprint 5 (Week 6): UAT, reliability, release
- full UAT, data reconciliation, launch checklist

---

## 4. Backlog by epic

## Epic A: Policy, Schema, and Governance

### [P0][BE-001][L] Add notification and audit schema
Owner: `BE`  
Dependencies: none  
Scope:
- add tables: `notifications`, `notification_delivery_logs`, `admin_audit_logs`
- add indexes on `user_id`, `status`, `event_type`, `created_at`
Acceptance:
- migration runs on clean DB and existing DB
- CRUD works for all three tables
- no regression on current training/assessment tables

### [P0][BE-002][M] Add assignment and quiz blueprint schema
Owner: `BE`  
Dependencies: `BE-001`  
Scope:
- add tables: `assignment_rules`, `assessment_blueprints`
- define policy fields: pass_score, max_attempts, cooldown_hours, validity_days
Acceptance:
- admin can create/update policy records via API
- module assignment can resolve effective rule

### [P0][BE-003][M] Policy resolver service
Owner: `BE`  
Dependencies: `BE-002`  
Scope:
- compute effective policy by priority: module override > role template > system default
Acceptance:
- deterministic resolved policy response
- unit tests for precedence and fallback

### [P1][BE-004][M] Admin audit middleware
Owner: `BE`  
Dependencies: `BE-001`  
Scope:
- log admin actions (publish, revoke, assign, settings change)
Acceptance:
- each protected admin endpoint writes audit row with actor, action, payload hash, timestamp

---

## Epic B: Training Assignment and Progress

### [P0][BE-010][M] Assignment engine v1
Owner: `BE`  
Dependencies: `BE-003`  
Scope:
- assign modules by user role/department/line
- support due date and criticality tagging
Acceptance:
- bulk assignment endpoint works with idempotency key
- duplicate assignment prevention

### [P0][BE-011][M] Step progress API hardening
Owner: `BE`  
Dependencies: none  
Scope:
- patch progress APIs to enforce required step completion logic
- auto-update assignment percent and last_activity_at
Acceptance:
- progress percent accurate to required steps only
- completion status set only after required steps complete

### [P1][FE-OP-010][L] Operator training flow simplification
Owner: `FE-OP`  
Dependencies: `BE-011`  
Scope:
- single-column, low-cognitive step cards
- clear CTA: Continue, Mark complete, Start quiz
Acceptance:
- no dead-end states
- ENG/HIN/HING labels verified

### [P1][FE-OP-011][M] Resume training widget
Owner: `FE-OP`  
Dependencies: `BE-011`  
Scope:
- add persistent "resume where you stopped" entry
Acceptance:
- resume opens exact current step

---

## Epic C: Quiz and Scoring Engine

### [P0][BE-020][L] Deterministic quiz attempt lifecycle
Owner: `BE`  
Dependencies: `BE-003`  
Scope:
- start attempt, submit response, finalize attempt
- enforce max attempts and cooldown
Acceptance:
- status transitions: `in_progress -> submitted -> passed/failed`
- blocked attempt returns explicit cooldown message

### [P0][BE-021][M] Scoring service v1
Owner: `BE`  
Dependencies: `BE-020`  
Scope:
- compute base score and pass/fail
- attach concept-level breakdown for analytics
Acceptance:
- score matches deterministic formula
- pass/fail uses resolved policy threshold

### [P1][BE-022][M] Weighted readiness score API
Owner: `BE`  
Dependencies: `BE-021`, `BE-040`  
Scope:
- compute readiness index from completion, assessment, certificate health
Acceptance:
- endpoint returns score + status color + component values

### [P1][FE-OP-020][L] Operator quiz UX v2
Owner: `FE-OP`  
Dependencies: `BE-020`, `BE-021`  
Scope:
- clean question view, timer, progress indicator
- pass/fail summary with remediation CTA
Acceptance:
- no ambiguous state between submit and result
- accessibility checks pass for contrast and tap targets

### [P1][FE-OP-021][M] Post-quiz explanation panel
Owner: `FE-OP`  
Dependencies: `BE-021`  
Scope:
- show explanation + source link for incorrect answers
Acceptance:
- each question explanation has linked source metadata

---

## Epic D: Certificate Lifecycle

### [P0][BE-030][L] Certificate issue and expiry job
Owner: `BE`  
Dependencies: `BE-021`  
Scope:
- issue certificate on pass
- compute `expires_at` using validity policy
Acceptance:
- certificate created once per valid pass event
- expiry date deterministic from policy

### [P0][BE-031][M] Renewal assignment trigger
Owner: `BE`  
Dependencies: `BE-030`, `BE-010`  
Scope:
- create renewal assignment X days before expiry
Acceptance:
- renewal assignment generated on schedule for eligible users

### [P1][BE-032][M] Revocation and re-certification rule
Owner: `BE`  
Dependencies: `BE-030`, `BE-004`  
Scope:
- revoke on superseded revision when required
- create retraining assignment automatically
Acceptance:
- revocation action fully audited
- dependent assignment created with correct due window

### [P1][FE-OP-030][M] Operator certificate wallet
Owner: `FE-OP`  
Dependencies: `BE-030`  
Scope:
- show Active/Expiring/Expired states with clear date
Acceptance:
- certificate cards match backend status exactly

---

## Epic E: Notification and Escalation

### [P0][BE-040][XL] Notification orchestration service
Owner: `BE`  
Dependencies: `BE-001`, `BE-010`, `BE-030`  
Scope:
- queue creation for all required event types
- dedupe key strategy for repeated triggers
Acceptance:
- event-to-notification success >= 99%
- no duplicate notifications for same event key

### [P0][BE-041][L] Escalation scheduler
Owner: `BE`  
Dependencies: `BE-040`  
Scope:
- overdue day-0/day-2/day-5 fan-out logic
Acceptance:
- escalation reaches correct recipients based on policy

### [P1][BE-042][M] Multilingual notification template engine
Owner: `BE`  
Dependencies: `BE-040`  
Scope:
- template registry per event and language
- payload variables for CTA and due date
Acceptance:
- ENG/HIN/HING template fallback works

### [P0][FE-OP-040][M] Operator notification center
Owner: `FE-OP`  
Dependencies: `BE-040`  
Scope:
- list, mark read, action CTA, severity grouping
Acceptance:
- unread count in header matches backend

### [P1][FE-AD-040][M] Supervisor escalation inbox
Owner: `FE-AD`  
Dependencies: `BE-041`  
Scope:
- show team overdue escalations with bulk reminder action
Acceptance:
- supervisor can trigger nudge and see action history

---

## Epic F: Operator Dashboard

### [P0][BE-050][M] Operator dashboard aggregate API
Owner: `BE`  
Dependencies: `BE-010`, `BE-021`, `BE-030`  
Scope:
- return due_today, overdue_count, last_score, cert_health, next_action
Acceptance:
- API response under 2 seconds (P95)

### [P0][FE-OP-050][L] Dashboard redesign for low cognitive load
Owner: `FE-OP`  
Dependencies: `BE-050`  
Scope:
- one-screen action dashboard
- dominant CTA and status chips
Acceptance:
- no vertical overflow on common tablet resolutions
- one-tap to start next required task

### [P1][FE-OP-051][M] Voice shortcuts in dashboard
Owner: `FE-OP`  
Dependencies: existing voice endpoints  
Scope:
- voice action: "start due training", "open quiz", "show certificate status"
Acceptance:
- fallback to click path if voice fails

---

## Epic G: Admin Control Tower

### [P0][BE-060][L] Admin readiness aggregation APIs
Owner: `BE`  
Dependencies: `BE-022`, `BE-030`, `BE-040`  
Scope:
- readiness by department/line/shift
- assignment funnel and critical overdue metrics
Acceptance:
- data reconciles against source tables with <1% variance

### [P0][FE-AD-060][L] Admin overview board
Owner: `FE-AD`  
Dependencies: `BE-060`  
Scope:
- readiness heatmap + risk cards + funnel
Acceptance:
- all cards clickable to filtered drill-down pages

### [P1][FE-AD-061][L] Assessment quality analytics
Owner: `FE-AD`  
Dependencies: `BE-060`, `DATA-070`  
Scope:
- concept weakness, attempts distribution, pass trend
Acceptance:
- filters by date, department, module, criticality

### [P1][BE-062][M] Role-scoped admin permissions
Owner: `BE`  
Dependencies: `BE-004`  
Scope:
- enforce SuperAdmin/TrainingAdmin/Supervisor/Auditor scope
Acceptance:
- blocked actions return role-scope reason

### [P1][FE-AD-062][M] Admin profile and approval center
Owner: `FE-AD`  
Dependencies: `BE-062`  
Scope:
- show open approvals, pending escalations, policy alerts
Acceptance:
- approval/reject action writes audit log and reflects immediately

---

## Epic H: Data and Reporting

### [P0][DATA-070][L] Readiness mart and daily snapshot job
Owner: `DATA`  
Dependencies: `BE-022`, `BE-060`  
Scope:
- build snapshot table for trend analytics
Acceptance:
- daily snapshot runs reliably and is queryable by admin filters

### [P1][DATA-071][M] Notification effectiveness report
Owner: `DATA`  
Dependencies: `BE-040`  
Scope:
- delivered/opened/actioned trend and drop-off funnel
Acceptance:
- dashboard aligns with notification logs

### [P1][DATA-072][M] Certificate risk forecast
Owner: `DATA`  
Dependencies: `BE-030`  
Scope:
- 30/60/90 day expiry risk projections
Acceptance:
- forecast includes department and criticality breakdown

---

## Epic I: QA, UAT, and Reliability

### [P0][QA-080][L] End-to-end test suite for core lifecycle
Owner: `QA`  
Dependencies: `BE-020`, `BE-030`, `BE-040`, `FE-OP-020`  
Scope:
- e2e: assign -> learn -> quiz -> cert -> notification
Acceptance:
- happy path and fail path coverage for all critical modules

### [P0][QA-081][M] Data reconciliation tests
Owner: `QA`  
Dependencies: `BE-060`  
Scope:
- compare dashboard aggregates with raw table queries
Acceptance:
- daily automated reconciliation report

### [P1][QA-082][M] Multilingual UAT pack
Owner: `QA`  
Dependencies: `FE-OP-050`, `FE-AD-060`  
Scope:
- ENG/HIN/HING UAT scripts for operator and admin
Acceptance:
- zero flow break in language switch scenarios

### [P1][DEVOPS-090][M] Job monitoring and alerting
Owner: `DEVOPS`  
Dependencies: `BE-040`, `BE-031`  
Scope:
- monitoring for scheduler jobs and failure alerts
Acceptance:
- alert fired if job misses SLA window

### [P2][DEVOPS-091][S] Runtime feature flags
Owner: `DEVOPS`  
Dependencies: none  
Scope:
- flags for staged rollout of notifications and scoring variants
Acceptance:
- flags toggle behavior without redeploy

---

## 5. API contract tickets (explicit)

### [P0][BE-API-101][M] `GET /api/operator/dashboard`
Response:
- due_today
- overdue_count
- last_quiz_score
- certificate_health
- next_action
Acceptance:
- returns localized labels key map

### [P0][BE-API-102][L] `POST /api/assessments/{id}/attempts` and submit endpoints
Acceptance:
- enforces attempts/cooldown policy
- response includes pass/fail and explanation references

### [P0][BE-API-103][L] `GET /api/notifications` + read/update endpoints
Acceptance:
- pagination + unread filter + severity filter

### [P0][BE-API-104][M] `GET /api/admin/readiness/overview`
Acceptance:
- department/line/shift filtering

### [P1][BE-API-105][M] `GET /api/admin/readiness/trends`
Acceptance:
- timeseries for completion, pass rate, readiness index

---

## 6. Frontend ticket packs

## 6.1 Operator pack
- `FE-OP-050`, `FE-OP-010`, `FE-OP-020`, `FE-OP-040`, `FE-OP-030`
- Done criteria:
  - can complete full learning lifecycle without confusion
  - no unnecessary scrolling on key screens
  - button labels under 3 words where possible

## 6.2 Admin pack
- `FE-AD-060`, `FE-AD-061`, `FE-AD-062`, `FE-AD-040`
- Done criteria:
  - all key metrics actionable with drill-down
  - every critical admin action logged

---

## 7. Release gates

### Gate 1: Functional completeness
- all P0 tickets closed
- no Sev-1/Sev-2 defects in core lifecycle

### Gate 2: Data trust
- dashboard reconciliation pass for 5 consecutive days
- certificate and notification event audit pass

### Gate 3: User readiness
- operator UAT pass >= 90%
- supervisor/admin UAT pass >= 90%

---

## 8. Launch checklist

- production migration executed and verified
- rollback scripts tested
- scheduler jobs active and monitored
- admin permission scopes validated
- multilingual smoke tests complete
- launch dashboard and on-call runbook published

---

## 9. Immediate first 10 tickets (start tomorrow)

1. `BE-001` notification and audit schema  
2. `BE-002` assignment and blueprint schema  
3. `BE-003` policy resolver  
4. `BE-020` attempt lifecycle  
5. `BE-021` scoring service  
6. `BE-030` certificate issue and expiry  
7. `BE-040` notification orchestration  
8. `BE-050` operator dashboard aggregate API  
9. `FE-OP-050` operator dashboard redesign  
10. `FE-AD-060` admin overview board

