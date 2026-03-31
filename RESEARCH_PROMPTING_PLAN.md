# Research-Driven Prompting Plan

This note maps the research markdowns in the workspace to a practical prompting and retrieval strategy for the Jubilant Ingrevia platform.

## Papers Read

- `2310.03714v1.md`
  DSPy: declarative LM modules, teleprompters, compile-time prompt optimization, multi-stage pipeline bootstrapping.
- `1908.10084v1.md`
  Sentence-BERT: efficient semantic search using sentence embeddings instead of pairwise cross-encoders.
- `2002.10957v2.md`
  MiniLM: smaller Transformer models with strong quality/latency tradeoff through deep self-attention distillation.
- `LearningBM25MSRTechReport.md`
  BM25 remains strong for lexical matching, and learned BM25-style retrieval improves field-aware ranking.

## What These Papers Mean For This Product

The product should not rely on one giant prompt string.

Instead, the backend should use:

1. `DSPy` for prompt/program orchestration
   - Define signatures for query rewrite, grounded answer generation, grounding verification, training-step generation, and assessment generation.
   - Compile these modules using `BootstrapFewShot` or `BootstrapFewShotWithRandomSearch`.
   - Optimize against business metrics like exact answer match, citation correctness, and answer grounding.

2. `SBERT or MiniLM embeddings` for semantic retrieval
   - Use sentence-transformers for chunk embeddings.
   - Favor MiniLM-family embeddings for low-latency industrial search.
   - Use semantic search to catch paraphrases, multilingual variation, and plain-language operator questions.

3. `BM25-style lexical retrieval` for exact technical grounding
   - SOPs include IDs, equipment tags, flow values, alarm names, and procedural wording.
   - Lexical retrieval is still necessary for exact-match recall and citation precision.
   - Best practice is hybrid retrieval: lexical + embedding retrieval together.

## Recommended Prompt Architecture

### Query Assistant + Document Viewer

- Module 1: `RewriteQuery`
  Convert spoken or typed operator input into a retrieval-friendly search query.
- Module 2: `Retrieve`
  Run hybrid retrieval:
  - BM25 over chunk text and metadata
  - SBERT/MiniLM over chunk embeddings
  - optional role/site/revision filters
- Module 3: `GroundedAnswer`
  Generate answer only from retrieved evidence.
- Module 4: `VerifyGrounding`
  Confirm the answer is fully supported by the passages and flag unsupported claims.

### Hands-Free Training

- Module 1: `GenerateTrainingStep`
  Convert approved procedure text into one clear training step.
- Module 2: `VoiceSimplify`
  Rewrite the instruction into plant-floor spoken language.
- Module 3: `SafetyCheck`
  Ensure the step retains warnings, thresholds, and interlocks.

### Assessment

- Module 1: `GenerateAssessmentQuestion`
  Create MCQs from validated training content only.
- Module 2: `VerifyAssessmentGrounding`
  Check that the correct option is directly supported by the SOP text.

## Recommended Metrics For DSPy Compilation

- `answer_exact_match`
  Use when a gold answer exists.
- `citation_match`
  Reward answers that cite the correct SOP section/page.
- `grounded_answer_metric`
  Reward only answers fully supported by retrieved passages.
- `answer_and_context_match`
  DSPy-style metric that checks the answer is present or implied by the supplied context.
- `safety_preservation_metric`
  For training steps, reject generations that drop critical safety constraints.

## Why This Is Better Than Manual Prompt Strings

- It keeps the system modular.
- It lets prompts adapt to different models.
- It supports compilation against real business metrics.
- It is easier to tune for the five product screens than one monolithic prompt.

## Immediate Recommendation

Use DSPy as the orchestration layer, not as the retrieval layer.

The stack should be:

- `DSPy` for prompt compilation and reasoning modules
- `BM25` for exact lexical recall
- `SBERT/MiniLM` for semantic retrieval
- `RAG` answer generation with grounding verification

## Files Added

- `backend/app/services/dspy_pipeline.py`
  Starter DSPy program structure for grounded answering, training-step generation, and assessment generation.
