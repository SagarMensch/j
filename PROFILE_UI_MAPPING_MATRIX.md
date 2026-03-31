# Profile UI Mapping Matrix
## End-to-End Screen, Action, and API Binding

## 1. Operator Profile

Allowed screens:
1. Main Command Dashboard
2. Query Assistant + Document Viewer
3. Hands-Free Training Module
4. Knowledge Assessment

Blocked screen:
1. Admin Readiness Analytics

Screen-to-API mapping:

1. Main Command Dashboard
- `GET /api/dashboard/summary?user_id={operator_id}`
- Renders mandatory modules, recent SOPs, safety alerts

2. Query Assistant + Viewer
- `POST /api/query`
- `GET /api/query/{event_id}/evidence`
- `GET /api/documents/{revision_id}/page/{page_number}`

3. Hands-Free Training
- `GET /api/training/assignments?user_id={operator_id}`
- `GET /api/training/modules/{module_id}?user_id={operator_id}`
- `POST /api/training/assignments/{assignment_id}/progress`

4. Knowledge Assessment
- `GET /api/assessments/{assessment_id}?user_id={operator_id}`
- `POST /api/assessments/{assessment_id}/submit`

Critical constraints:
- Operator can only open assigned module/assessment.
- Progress is server-validated and persisted.

---

## 2. Supervisor Profile

Allowed screens:
1. Main Command Dashboard
2. Query Assistant + Document Viewer
3. Hands-Free Training Module
4. Knowledge Assessment
5. Admin Readiness Analytics (read scope)

Screen-to-API mapping:
- All operator APIs
- `GET /api/admin/readiness/overview?user_id={supervisor_id}`

Supervisor-specific behavior:
- Team compliance view visible.
- Assignment and completion posture visible across department.

---

## 3. Admin Profile

Allowed screens:
1. Main Command Dashboard
2. Query Assistant + Document Viewer
3. Hands-Free Training Module
4. Knowledge Assessment
5. Admin Readiness Analytics (full scope)

Screen-to-API mapping:
- All operator APIs
- Full analytics read:
  - `GET /api/admin/readiness/overview?user_id={admin_id}`

Admin-specific behavior:
- Department-wide readiness score
- Certification posture and risk hotspot view

---

## 4. UI State Machine by Journey

Journey A: Query -> Evidence -> Action
1. Submit query (`/api/query`)
2. Render answer + confidence + evidence list
3. Open evidence page (`/api/documents/...`)
4. Optional transition to training module

Journey B: Mandatory Training
1. Open assignment list
2. Select module
3. Step update writes after each transition
4. Final step marks completed

Journey C: Assessment -> Certification
1. Fetch assessment
2. Capture answers
3. Submit evaluation
4. Persist attempt + certification on pass

Journey D: Readiness Analytics
1. Load overview metrics
2. Render KPIs, department compliance, operator status
3. Supervisor/Admin-only visibility enforced server-side

---

## 5. Enforcement Matrix

Route guard requirements:
- Operator:
  - deny `/api/admin/readiness/*`
- Supervisor/Admin:
  - allow `/api/admin/readiness/*`
- All roles:
  - must provide `user_id` bound to active profile

Audit events:
- `ui.query_submitted`
- `ui.citation_opened`
- `ui.training_step_advanced`
- `ui.assessment_submitted`
- `ui.admin_readiness_opened`

