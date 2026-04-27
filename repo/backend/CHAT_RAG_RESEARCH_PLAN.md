# Chat RAG Research Baseline (10 Papers)

This note anchors implementation choices for a grounded, fast, conversational plant assistant.

## Core Retrieval + Grounding

1. Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks (Lewis et al., 2020)  
   https://arxiv.org/abs/2005.11401
2. Dense Passage Retrieval for Open-Domain QA (Karpukhin et al., 2020)  
   https://arxiv.org/abs/2004.04906
3. Fusion-in-Decoder / Leveraging Passage Retrieval with Generative Models (Izacard and Grave, 2020)  
   https://arxiv.org/abs/2007.01282
4. ColBERTv2: Efficient Late Interaction Retrieval (Santhanam et al., 2021)  
   https://arxiv.org/abs/2112.01488
5. Unsupervised Dense Retrieval with Contrastive Learning / Contriever (Izacard et al., 2021)  
   https://arxiv.org/abs/2112.09118
6. HyDE: Precise Zero-Shot Dense Retrieval without Labels (Gao et al., 2022)  
   https://arxiv.org/abs/2212.10496

## Self-Correction + Pipeline Optimization

7. DSPy: Compiling Declarative LM Calls into Self-Improving Pipelines (Khattab et al., 2023)  
   https://arxiv.org/abs/2310.03714
8. Self-RAG: Retrieve, Generate, Critique through Self-Reflection (Asai et al., 2023)  
   https://arxiv.org/abs/2310.11511
9. Corrective RAG (CRAG) (Yan et al., 2024)  
   https://arxiv.org/abs/2401.15884

## Safety / Guardrails

10. Constitutional AI: Harmlessness from AI Feedback (Bai et al., 2022)  
    https://arxiv.org/abs/2212.08073
11. Llama Guard: LLM-based Input-Output Safeguard (Inan et al., 2023)  
    https://arxiv.org/abs/2312.06674

## Mapped To Current Implementation

- Hybrid retrieval with lexical + semantic evidence.
- DSPy query rewrite + answer generation + verifier gate with hard fail fallback.
- Guardrail pre-check with admin incident logging and notification fanout.
- Citation payload now includes page + line range for lightweight provenance.
- Reader flow supports document-scoped queries (revision filter) for speed and precision.

## Next Iterations

- Add a reranker stage (cross-encoder or ColBERT-style late interaction).
- Add retrieval confidence calibration and abstention thresholds by query class.
- Add evaluation harness (faithfulness, answer utility, latency percentiles, guardrail precision/recall).

## Evaluation Command

Run from repository root:

```powershell
python backend/scripts/eval_chat_rag.py --sample-size 24 --top-k 5 --document-scoped --with-generation
```

Fast smoke run:

```powershell
$env:RETRIEVAL_RERANKER_MODE='light'; python backend/scripts/eval_chat_rag.py --sample-size 1 --top-k 3 --document-scoped
```
