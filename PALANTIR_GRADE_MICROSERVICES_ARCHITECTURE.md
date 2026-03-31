# Jubilant Ingrevia Platform
## Palantir-Grade Microservices Architecture (Real Data, No Mock Path)

## 1. Target Operating Model

Architecture style:
- Domain-driven microservices
- Event-first integration
- Data products with strict contracts
- Policy-enforced access at gateway + service layer
- Online (query/training/assessment) + offline (ingestion/indexing) separation

Design principle:
- No UI path may compute compliance/readiness from browser state.
- Every KPI, progress value, and certificate state must be read from source-of-truth stores.

---

## 2. Service Topology

1. `api-gateway`
- Entry point for web/mobile clients.
- AuthN/AuthZ, request shaping, tenant+role context propagation, audit envelope.

2. `identity-service`
- Users, roles, departments, profile preferences, RBAC policy checks.
- Source tables: `users`, `departments`.

3. `knowledge-service`
- Hybrid retrieval + grounded answer + evidence resolution.
- Source tables: `documents`, `document_revisions`, `document_chunks`, `retrieval_events`.
- Graph source: Neo4j `DocumentChunk` + ontology nodes.

4. `training-service`
- Assignments, modules, steps, progress state machine.
- Source tables: `training_modules`, `training_steps`, `training_assignments`.

5. `assessment-service`
- Assessment delivery, answer evaluation, attempts, certification writes.
- Source tables: `assessments`, `assessment_questions`, `assessment_attempts`, `certifications`.

6. `analytics-service`
- Readiness KPIs, department compliance, operator certification posture.
- Uses pre-aggregated materialized views (phase 2) or live SQL (phase 1).

7. `voice-service`
- STT/TTS/voice pipeline orchestration with bounded prompts and safety policies.
- Integrates Sarvam + LLM provider.

8. `pipeline-orchestrator` (Prefect)
- Offline orchestration: extraction -> canonical -> chunking -> embeddings -> datastore load -> seed validation.

---

## 3. Data Plane

Primary transactional store:
- Supabase Postgres (OLTP + pgvector)

Graph reasoning store:
- Neo4j Aura (knowledge graph + provenance edges)

Object artifact store (phase 2):
- Blob store for page render artifacts and long-form source files

Observability store (phase 2):
- Time-series + tracing backend (Prometheus/Tempo/OpenTelemetry)

---

## 4. Contract-First APIs

Gateway public contracts:
- `GET /api/users`
- `GET /api/dashboard/summary?user_id=...`
- `POST /api/query`
- `GET /api/query/{event_id}/evidence`
- `GET /api/documents/{revision_id}/page/{page_number}`
- `GET /api/training/assignments?user_id=...`
- `GET /api/training/modules/{module_id}?user_id=...`
- `POST /api/training/assignments/{assignment_id}/progress`
- `GET /api/assessments/{assessment_id}?user_id=...`
- `POST /api/assessments/{assessment_id}/submit`
- `GET /api/admin/readiness/overview?user_id=...`
- `POST /api/voice`
- `POST /api/chat`
- `POST /api/stt`

Contract enforcement:
- Pydantic schemas per service
- Version headers (`X-API-Version`) in phase 2
- Backward compatibility for one minor version window

---

## 5. Event Backbone (Domain Events)

Mandatory events:
- `training.assignment.updated`
- `training.module.completed`
- `assessment.attempt.completed`
- `certification.issued`
- `retrieval.query.executed`
- `retrieval.evidence.opened`
- `admin.readiness.viewed`

Required envelope:
- `event_id`, `event_type`, `occurred_at`, `user_id`, `role`, `trace_id`, `payload`

Broker:
- Phase 1: Postgres outbox table + poller
- Phase 2: Kafka/NATS for low-latency streaming

---

## 6. Security and Policy

Policy layers:
1. Gateway: JWT/session validation + coarse route RBAC
2. Service: record-level authorization (user->assignment, role->analytics)
3. Data: row-level constraints where needed (phase 2 with RLS)

Non-negotiable rules:
- Operator cannot access admin readiness endpoints
- Query answers for critical operations must carry evidence
- Assessment submissions are immutable attempts (append-only)

---

## 7. Prefect Orchestration Blueprint

Flow graph:
1. `extract_manuals`
2. `normalize_and_chunk`
3. `build_retrieval_assets`
4. `load_datastores`
5. `seed_product_data`
6. `run_data_quality_gates`

Quality gates:
- Min docs ingested
- Min chunk count
- Embedding coverage threshold
- Retrieval sanity check
- Assignment and assessment cardinality checks

Failure behavior:
- Fail fast
- Persist run manifest with stage-level error payloads
- No partial promotion to production-ready tag

---

## 8. Profile-Centric UI Runtime Model

Operator runtime:
- Dashboard, Query, Training, Assessment
- No admin analytics

Supervisor runtime:
- Operator scope + analytics visibility
- Team-compliance drilldown

Admin runtime:
- Full analytics and governance panels
- Cross-department readiness and certification posture

---

## 9. SLO Baselines

Availability:
- Gateway + critical services: 99.5%

Latency targets (p95):
- `POST /api/query`: <= 4.0s
- `GET /api/dashboard/summary`: <= 1.5s
- `POST /api/assessments/{id}/submit`: <= 1.0s

Data freshness:
- Readiness and progress views: <= 60s lag

---

## 10. Migration Strategy from Current State

Phase A (current sprint):
- Keep existing backend as compatibility gateway.
- Stand up microservice apps on separate ports.
- Route-by-route cutover via gateway config.

Phase B:
- Outbox event bus + materialized readiness views.
- Rate limiting, circuit breakers, distributed tracing.

Phase C:
- Full service isolation with independent deployment pipelines and autoscaling.

