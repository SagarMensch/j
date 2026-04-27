# Chat System Hardening Roadmap

## Current Runtime Shape

- Main chat endpoints:
  - `POST /api/query` in `backend/server.py`
  - `POST /api/voice` in `backend/server.py`
  - `POST /api/chat` in `backend/server.py`
- Retrieval stack:
  - Hybrid evidence fetch in `backend/app/services/sop_retrieval.py`
  - BM25 index in `backend/app/services/bm25_retriever.py`
  - Embeddings in `backend/app/services/embedding_service.py`
- DSPy hooks:
  - Query rewrite and answer synthesis in `backend/app/services/dspy_pipeline.py`
  - Runtime calls in `backend/server.py`

## What Was Implemented Now

- Guardrail screening for dangerous/offensive queries:
  - `backend/app/services/guardrails.py`
  - Enforcement in `POST /api/query`, `POST /api/voice`, and `POST /api/chat`
- Admin/supervisor escalation on blocked queries:
  - Notification + audit log write in `_notify_guardrail_violation()` in `backend/server.py`
- Conversational retrieval upgrade:
  - Follow-up query contextualization in `_build_contextual_query()` in `backend/server.py`
- Latency improvement:
  - BM25 index reuse (no full DB reload per request) in `backend/app/services/bm25_retriever.py`

## High-Impact Next DSPy Upgrades

1. Add a DSPy guardrail classifier signature
   - File: `backend/app/services/dspy_pipeline.py`
   - Use as second-pass only when heuristic guardrail confidence is low.

2. Add DSPy answer verifier on every grounded response
   - Reuse existing `VerifyGrounding` signature.
   - If unsupported: force safe fallback `Not found in approved documents.`

3. Add DSPy citation consistency checker
   - Validate claim-to-citation mapping before final response.
   - Reject answers where cited chunk content does not support the sentence.

4. Add DSPy conversation state summarizer
   - Persist a short rolling summary in `chat_conversations.metadata`.
   - Use summary in rewrite/retrieval prompt for long conversations.

## Speed Optimizations (Next)

1. Database indexing
   - Add `GIN` index for lexical search vector expression.
   - Add ANN index (`ivfflat` or `hnsw`) on `document_chunks.embedding`.

2. Retrieval cache
   - Cache top evidence for `(rewritten_query, language, role, top_k)` with short TTL.

3. Async model call budget
   - Add timeout budget and fallback tiers:
     - DSPy rewrite -> retrieval -> DSPy answer
     - If timeout: retrieval-only deterministic fallback.

## Accuracy Upgrades (Next)

1. Query decomposition
   - For compound asks, split into sub-queries and merge citations.

2. Re-ranking
   - Add cross-encoder reranker over top-20 evidence.

3. Domain ontology fusion
   - Re-enable graph score from `hybrid_retrieval.py` patterns into active retriever.

## Guardrail Maturity Plan

1. Add policy categories
   - Self-harm, harassment, illegal acts, safety sabotage, prompt-injection.

2. Add incident review endpoint
   - Read `admin_audit_logs` filtered by action `guardrail_blocked_query`.

3. Escalation policy controls
   - Store escalation thresholds and recipient roles in `app_settings`.

