# Jubilant Ingrevia Industrial Knowledge and Readiness Platform
## Retrieval and Trust Stage 1

## 1. Intent

Stage 1 retrieval must be built over canonical chunks, not over raw extraction artifacts.

The objective of this stage is to produce a retrieval substrate that is:

- stable
- inspectable
- re-embeddable
- graph-compatible
- citation-safe

---

## 2. Retrieval Substrate

The retrieval plane in Stage 1 should operate over one canonical unit: the normalized chunk.

Each chunk must already carry:

- chunk identifier
- page span
- citation label
- section title where available
- equipment tags
- safety flags
- block provenance

This allows lexical retrieval, semantic retrieval, graph expansion, and evidence rendering to remain aligned.

---

## 3. Lexical Layer

BM25 should be built over canonical chunks with token streams derived from:

- content
- section title
- citation label
- equipment tags
- safety flags

This is essential for:

- model numbers
- relay names
- tag identifiers
- exact safety phrasing
- alarm and interlock terms

---

## 4. Semantic Layer

The Stage 1 semantic baseline is MiniLM-class sentence embeddings.

This is not the long-term frontier architecture, but it is the correct current substrate because it is:

- operationally simple
- CPU-feasible
- strong enough for a 20-manual corpus
- easy to replace later

The system should therefore retain:

- canonical chunk text
- chunk identifiers
- model metadata

so that stronger embedding models can be introduced later without redefining the corpus.

---

## 5. Trust Requirements

Retrieval quality alone is not sufficient.

Every answering flow that uses the Stage 1 retrieval substrate must preserve:

- exact cited chunk identifiers
- page references
- bounding-box references where available
- latest-revision enforcement
- verifier status

This is what makes the retrieval plane operationally trustworthy rather than merely useful.

---

## 6. Implementation Artifact

The retrieval asset build for Stage 1 is implemented in:

- [build_retrieval_assets_stage1.py](/C:/Users/sagar/Downloads/jubilantingrevia/scripts/build_retrieval_assets_stage1.py)

This script emits:

- `bm25_corpus.json`
- `embedding_records.jsonl`
- `retrieval_manifest.json`

---

## 7. Immediate Next Step

After canonical normalization:

1. build lexical and embedding assets
2. load chunk records into Supabase
3. load vector records into pgvector
4. seed entity candidates into Neo4j
5. stand up hybrid retrieval and verifier-first answer generation

That is the correct Stage 1 progression.
