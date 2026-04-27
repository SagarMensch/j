# PRD: Blue-Collar Learning, Quiz, Notification, and Readiness Platform

Version: 1.0  
Date: 2026-04-01  
Owner: Product + Operations + Engineering  
Primary users: Plant operators, shift supervisors, training admins, QA/EHS auditors

---

## 1. Product goal

Build a worker-first learning and readiness system (Coursera-style structure, plant-floor execution) where:
- operators learn SOP/SMP/WID workflows in simple language and voice,
- quizzes measure real readiness,
- notifications drive completion and renewal on time,
- certificates are issued only on valid policy,
- admin gets one reliable readiness control tower.

Success outcome: safer execution, faster onboarding, lower compliance risk.

---

## 2. Problem statement

Current issues in plant training systems:
- completion is tracked but readiness is not measured consistently,
- quiz quality and SOP revision linkage are weak,
- certificate renewals are missed,
- supervisors do not have a single deployable/non-deployable view,
- language and UI complexity reduce operator adoption.

---

## 3. Target personas

### 3.1 Operator (primary)
- short attention window, mobile-first behavior,
- often prefers Hindi/Hinglish,
- needs direct instructions, minimal text, clear next action.

### 3.2 Shift supervisor
- needs team readiness per shift/line,
- needs overdue alerts and escalation visibility,
- needs deployability decision in less than 30 seconds.

### 3.3 Training admin
- curates modules, assignment policies, pass criteria, renewals,
- owns question quality and program outcomes.

### 3.4 QA/EHS/Auditor
- needs revision traceability and exportable evidence,
- needs immutable audit trail.

---

## 4. Design principles (blue-collar first)

- one screen, one purpose
- short labels, simple status words
- voice option in every critical flow
- high-contrast status chips (Green/Amber/Red)
- no decorative complexity in operator journey
- every answer and certificate must be source-linked

---

## 5. Scope

### 5.1 In scope (v1)
- module assignment and step progression,
- quiz engine with attempts and pass rules,
- certificate issue/expiry/renewal/revoke,
- in-app notification and escalation,
- operator and admin readiness dashboards,
- revision-level traceability to source chunks.

### 5.2 Out of scope (v1)
- biometric proctoring,
- adaptive psychometric testing,
- full HRMS payroll workflows.

---

## 6. End-to-end journeys

### 6.1 Operator
1. login -> sees "Due today" + "Next action"
2. starts assigned module
3. completes mandatory steps
4. takes quiz
5. gets immediate pass/fail and guidance
6. if pass, certificate updates
7. dashboard status refreshes in real time

### 6.2 Supervisor
1. opens team readiness view
2. checks deployable/non-deployable by line/shift
3. receives overdue critical alerts
4. triggers reminder/escalation

### 6.3 Admin
1. publishes module from approved SOP revision
2. sets assignment and pass policy
3. monitors completion, attempts, pass rate, expiry risk
4. exports audit evidence

---

## 7. Functional requirements

## 7.1 Training module lifecycle

### Module model
- module types: mandatory, role-based, refresher, incident-driven
- criticality: normal, high, safety-critical
- module must reference `source_document_id` and `source_revision_id`
- fields: title, language, validity_days, publish_status, total_steps

### Step model
- each step has instruction, optional voice prompt, operator check, source link
- completion is auto-saved after each step
- optional media support for diagrams/video (future-proof)

### Completion rule
- completion = all required steps done
- optional steps cannot block quiz unless marked required by admin

---

## 7.2 Quiz engine (Coursera-like, plant-safe)

### Question types (v1)
- single choice MCQ
- scenario MCQ
- safest-action MCQ for safety-critical modules

### Assessment policy
- pass score configurable per module (default 80)
- max attempts configurable (default 3)
- cooldown after final fail (default 24h)
- optional timer per assessment
- random question and option order

### Integrity and fairness
- every question maps to one `source_chunk_id`
- explanation shown after submit
- question pool by difficulty and concept
- no duplicate questions in same attempt

---

## 7.3 Scoring model

### Base score
- `base_score = (correct / total) * 100`

### Readiness index (operator-level)
- `readiness_index = 0.35 * training_completion + 0.45 * assessment_score_weighted + 0.20 * certificate_health`

Definitions:
- `training_completion`: percent mandatory assignments completed on time
- `assessment_score_weighted`: latest score with safety-critical weight multiplier
- `certificate_health`: percent required certificates currently valid

Status thresholds:
- Green: >= 85
- Amber: 70 to 84
- Red: < 70

Department-level threshold override is allowed.

---

## 7.4 Certificate lifecycle

### Issue conditions
- module complete
- quiz passed
- supervisor sign-off if configured

### Status states
- Active
- ExpiringSoon
- Expired
- Revoked

### Renewal
- auto-assignment `X` days before expiry (default 30)
- notify operator + supervisor

### Revocation
- required on superseded revision if policy says re-certification required
- allowed on compliance incident by authorized admin

---

## 7.5 Notification system

### Channels
- v1 mandatory: in-app
- v1 optional: email
- v2: SMS/WhatsApp

### Event triggers
- assignment created
- due in 7/3/1 days
- overdue
- quiz scheduled
- quiz pass/fail
- certificate issued
- certificate expiring
- certificate expired
- revision updated and retraining required

### Escalation matrix
- Day 0 overdue: operator
- Day 2 overdue: operator + supervisor
- Day 5 critical overdue: operator + supervisor + training admin

### UX rules
- notification text respects selected language
- one primary CTA only
- snooze allowed only for non-critical alerts

---

## 7.6 Operator dashboard requirements

Must show:
- Due today
- Overdue items
- Last quiz score
- Certificate health
- Next best action
- Critical safety updates

UX constraints:
- no clutter
- card-first layout
- readable on low-end phones
- one-tap continue/start actions

---

## 7.7 Admin dashboard requirements

Must show:
- readiness by plant/department/line/shift
- assignment funnel (assigned -> started -> completed -> certified)
- pass rate and attempts distribution
- weak-concept heatmap
- certificate expiry risk
- notification effectiveness
- revision compliance gap

Actions:
- bulk assign/unassign
- configure pass rules and validity rules
- trigger reminders/escalations
- publish/unpublish module
- export audit evidence

---

## 8. Admin profile perfection model

## 8.1 Role hierarchy
- SuperAdmin: global policies, revocation, role management
- TrainingAdmin: module and quiz governance
- Supervisor: team assignment tracking and nudges
- Auditor: read-only evidence and exports

## 8.2 Profile capabilities
- scoped access by plant/department/line
- delegated approvals (with expiry window)
- admin action audit trail (who, what, when, reason)
- mandatory 2-step confirmation for revocation and critical overrides

## 8.3 Profile dashboard (personal)
- my open approvals
- my pending escalations
- my teams at risk
- policy drift warnings

---

## 9. Data model and API alignment

Existing schema already supports:
- `training_modules`, `training_steps`, `training_assignments`
- `assessments`, `assessment_questions`, `assessment_attempts`
- `certifications`

Recommended additions:
- `notifications` (id, user_id, event_type, severity, channel, status, cta_url, created_at, read_at)
- `notification_delivery_logs`
- `admin_audit_logs`
- `assignment_rules` (templates)
- `assessment_blueprints` (pool strategy)

---

## 10. Non-functional requirements

- P95 dashboard load < 2.0s
- P95 quiz submit < 1.5s
- zero data loss on step progress updates
- full auditability for compliance events
- language switch updates visible labels without route break
- mobile-first behavior for low memory devices

---

## 11. KPIs

Primary:
- mandatory completion rate (on time)
- first-attempt pass rate
- average attempts to pass
- active certificate coverage
- critical overdue count
- readiness index distribution

Quality:
- concept-level fail concentration
- notification action rate
- false-pass incident rate (post-training operational errors)

---

## 12. Execution plan (greatest-plan mode)

## Phase 0 (Week 1): Policy and reliability foundation
- finalize scoring, attempt, cooldown, validity, revocation policies
- finalize source revision enforcement rules
- lock event taxonomy for notifications and audit logs
- output: signed policy document + backend config model

## Phase 1 (Week 2-3): Operator flow hardening
- simplify operator training and quiz UX
- implement due/overdue cards and next-action logic
- enforce source-linked quiz explanations
- output: operator v1 UAT pass

## Phase 2 (Week 3-4): Notification and escalation engine
- implement notification queue and dispatcher
- implement escalation scheduler and supervisor/admin fan-out
- implement notification center and action tracking
- output: event-to-notification reliability > 99%

## Phase 3 (Week 4-5): Certificate and readiness control
- automate issue/renewal/revoke pipelines
- implement certificate risk view and renewal campaigns
- implement readiness index APIs and widgets
- output: compliance-ready certificate lifecycle

## Phase 4 (Week 5-6): Admin control tower perfection
- launch full admin panels, filters, exports
- role-based scoped admin profile with audit log
- add concept heatmaps and trend analytics
- output: audit-ready admin cockpit

---

## 13. Workstreams and ownership

- Product: policy, taxonomy, acceptance
- Backend: scoring, notification engine, certificate lifecycle APIs
- Frontend Operator: low-cognitive UX and multilingual labels
- Frontend Admin: control tower, filters, exports
- Data/Analytics: KPIs and trend integrity
- QA/UAT: scenario coverage, regression, multilingual tests

---

## 14. Acceptance criteria (must pass)

- all mandatory assignments show correct due state
- quiz scoring is deterministic and traceable
- certificate status transitions are policy-correct
- overdue escalation follows configured matrix
- admin dashboard numbers match source-of-truth tables
- all quiz questions have source linkage
- ENG/HIN/HING flows work end-to-end

---

## 15. Risks and mitigations

- Risk: poor question quality -> weak readiness signal  
  Mitigation: blueprint governance + monthly question review board

- Risk: notification fatigue  
  Mitigation: severity tiers + digest for non-critical items

- Risk: stale revision training  
  Mitigation: auto re-certification trigger on approved revision updates

- Risk: high language complexity  
  Mitigation: short labels, voice prompts, visual progression

---

## 16. Immediate next actions in this repo

1. Add notification tables and APIs (`notifications`, logs, escalation job)
2. Implement readiness index API and admin aggregation endpoints
3. Add admin profile role scopes and action audit trail
4. Normalize operator quiz/training pages to one low-cognitive design pattern
5. Add UAT checklist for operator + supervisor + admin flows

