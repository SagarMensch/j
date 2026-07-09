from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from app.core.config import get_settings

try:
    import dspy
except ImportError:
    dspy = None


settings = get_settings()


def ensure_dspy():
    if dspy is None:
        raise RuntimeError(
            "DSPy is not installed. Add the backend requirements and install dependencies before using the DSPy pipeline."
        )
    return dspy


@dataclass
class RetrievedPassage:
    text: str
    source_id: str
    citation: str
    score: float


class HybridRetriever:
    def search(self, query: str, top_k: int = 5, filters: dict[str, Any] | None = None) -> list[RetrievedPassage]:
        raise NotImplementedError


def build_signatures():
    dsp = ensure_dspy()

    class RewriteQuery(dsp.Signature):
        """You are a search query optimizer for an industrial plant assistant. 
Given an operator's question and conversation history, produce a search query that will 
maximize retrieval of relevant SOP, manual, and safety document passages. 
Focus on: equipment names, chemical names, procedure codes, alarm IDs, safety keywords.
If the question uses pronouns (it, this, that), resolve them using the conversation history."""

        question = dsp.InputField()
        history = dsp.InputField()
        language = dsp.InputField()
        role = dsp.InputField()
        rewritten_query = dsp.OutputField(desc="A standalone, retrieval-optimized search query with resolved references")
        retrieval_hints = dsp.OutputField(desc="Key entities and keywords to prioritize in retrieval")

    class GroundedAnswer(dsp.Signature):
        """You are an expert plant operations assistant for Jubilant Ingrevia. You help operators find, understand, and apply information from approved plant documents. You think deeply about what the operator really needs.

## How to Think About Questions
- What is the operator trying to accomplish? What is their real goal?
- What evidence directly answers this?
- Are there safety implications they should know?
- What follow-up questions might they have?

## Response Guidelines
- Lead with the answer. Don't bury it in preamble.
- For procedural questions: list steps in exact order with safety notes
- For safety questions: ALWAYS include ALL warnings, PPE requirements, and hazards
- For summary requests: organize into clear numbered points, most critical first
- For 'why' questions: explain the reasoning behind procedures
- Preserve EXACT values, units, tolerances, chemical names, equipment codes
- Use citation markers [1], [2] at end of relevant points
- If evidence doesn't answer the question, say so clearly. Never guess.
- Adapt response depth to question complexity

## Formatting
- No markdown (no bold, no headers, no tables)
- No raw document metadata
- Plain text with natural paragraph breaks
- Numbered lists for steps or multiple items

## Examples of Excellent Answers

Question: What PPE is required for handling chromic acid?
Evidence: [1] WID-CHEM-003 p.2 — Chromic acid handling requires: chemical-resistant suit (Tyvek), double nitrile gloves, face shield with ANSI Z87.1 goggles, respirator with OV/P100 cartridges. TLV: 0.0002 mg/m3.
Answer: Working with chromic acid requires strict PPE due to its highly corrosive and carcinogenic nature:
1. Chemical-resistant suit — Tyvek or equivalent full-body coverage [1]
2. Double nitrile gloves — wear two layers for added protection [1]
3. Face shield with ANSI Z87.1-rated safety goggles [1]
4. Respirator with OV/P100 cartridges — required due to the extremely low ceiling limit of 0.0002 mg/m3 [1]
Never attempt to handle chromic acid without complete PPE."""

        question = dsp.InputField()
        history = dsp.InputField()
        language = dsp.InputField()
        role = dsp.InputField()
        context = dsp.InputField()
        answer = dsp.OutputField()
        citations = dsp.OutputField(desc="Comma-separated citation references like [1], [2]")
        confidence = dsp.OutputField(desc="high/medium/low based on evidence quality and coverage")

    class VerifyGrounding(dsp.Signature):
        """You are a fact-checker verifying that an answer is grounded in the provided evidence.

Check the answer against the evidence. Flag ONLY clear hallucinations — information that is completely fabricated and contradicts the evidence.

Do NOT flag:
- Reasonable inferences from the evidence
- Paraphrased information that is semantically equivalent to the evidence
- General safety advice consistent with the evidence
- Minor rewording of evidence content

Return supported=true unless there is a clear factual error or fabrication."""

        question = dsp.InputField()
        draft_answer = dsp.InputField()
        citations = dsp.InputField()
        context = dsp.InputField()
        supported = dsp.OutputField(desc="true if fully supported, false if hallucinated or incorrect")
        safety_note = dsp.OutputField(desc="Any safety concerns about the answer")
        revision_needed = dsp.OutputField(desc="Specific corrections needed if answer is unsupported")

    class GenerateTrainingStep(dsp.Signature):
        """Extract one clear, actionable training step from approved procedure text.
The step should be: specific, measurable, achievable, relevant, and time-bound (SMART).
Include safety requirements, PPE, and verification checks where applicable."""

        procedure_title = dsp.InputField()
        step_context = dsp.InputField()
        language = dsp.InputField()
        step_title = dsp.OutputField()
        spoken_instruction = dsp.OutputField()
        operator_check = dsp.OutputField()

    class GenerateAssessmentQuestion(dsp.Signature):
        """Create one grounded assessment question from validated training content.
Question should test practical understanding, not just memorization.
Include realistic distractors that reflect common operator mistakes."""

        module_title = dsp.InputField()
        learning_summary = dsp.InputField()
        language = dsp.InputField()
        question = dsp.OutputField()
        options = dsp.OutputField()
        correct_answer = dsp.OutputField()
        explanation = dsp.OutputField()

    return {
        "rewrite_query": RewriteQuery,
        "grounded_answer": GroundedAnswer,
        "verify_grounding": VerifyGrounding,
        "generate_training_step": GenerateTrainingStep,
        "generate_assessment_question": GenerateAssessmentQuestion,
    }


class GroundedPlantAssistant:
    def __init__(self, retriever: HybridRetriever):
        dsp = ensure_dspy()
        signatures = build_signatures()
        self.retriever = retriever
        self.rewrite = dsp.ChainOfThought(signatures["rewrite_query"])
        self.answer = dsp.ChainOfThought(signatures["grounded_answer"])
        self.verify = dsp.ChainOfThought(signatures["verify_grounding"])

    def forward(self, question: str, language: str = "en", role: str = "operator"):
        rewritten = self.rewrite(
            question=question,
            history="",
            language=language,
            role=role,
        )
        passages = self.retriever.search(
            query=rewritten.rewritten_query,
            top_k=5,
            filters={"role": role},
        )

        context = "\n\n".join(
            f"[{p.citation}] {p.text}"
            for p in passages
        )
        drafted = self.answer(
            question=question,
            history="",
            language=language,
            role=role,
            context=context,
        )
        checked = self.verify(
            question=question,
            draft_answer=drafted.answer,
            citations=drafted.citations,
            context=context,
        )

        return {
            "question": question,
            "rewritten_query": rewritten.rewritten_query,
            "retrieval_hints": rewritten.retrieval_hints,
            "answer": drafted.answer,
            "citations": drafted.citations,
            "confidence": drafted.confidence,
            "supported": checked.supported,
            "safety_note": checked.safety_note,
            "revision_needed": checked.revision_needed,
            "passages": passages,
        }


def compile_grounded_assistant(
    retriever: HybridRetriever,
    trainset,
    metric,
    teacher=None,
):
    dsp = ensure_dspy()
    program = GroundedPlantAssistant(retriever=retriever)
    teleprompter = dsp.BootstrapFewShotWithRandomSearch(metric=metric)
    return teleprompter.compile(program, trainset=trainset, teacher=teacher)


class TrainingAndAssessmentFactory:
    def __init__(self):
        dsp = ensure_dspy()
        signatures = build_signatures()
        self.training_step = dsp.ChainOfThought(signatures["generate_training_step"])
        self.assessment_question = dsp.ChainOfThought(signatures["generate_assessment_question"])

    def build_training_step(self, procedure_title: str, step_context: str, language: str = "en"):
        return self.training_step(
            procedure_title=procedure_title,
            step_context=step_context,
            language=language,
        )

    def build_assessment_question(self, module_title: str, learning_summary: str, language: str = "en"):
        return self.assessment_question(
            module_title=module_title,
            learning_summary=learning_summary,
            language=language,
        )


@lru_cache()
def _get_dspy_lm():
    dsp = ensure_dspy()
    if settings.has_primary_llm_credentials:
        lm = dsp.LM(
            f"openai/{settings.PRIMARY_LLM_MODEL}",
            api_key=settings.PRIMARY_LLM_API_KEY,
            api_base=settings.PRIMARY_LLM_API_BASE,
            cache=False,
        )
        dsp.configure(lm=lm)
        return lm
    if not settings.GROQ_API_KEY:
        raise RuntimeError("No primary LLM or Groq credentials configured for DSPy reasoning.")
    lm = dsp.LM(
        f"openai/{settings.GROQ_MODEL}",
        api_key=settings.GROQ_API_KEY,
        api_base="https://api.groq.com/openai/v1",
        cache=False,
    )
    dsp.configure(lm=lm)
    return lm


def _history_to_text(history: list[dict[str, str]] | None) -> str:
    if not history:
        return "No prior conversation."
    lines: list[str] = []
    for item in history[-12:]:
        role = (item.get("role") or "user").strip().title()
        content = (item.get("content") or "").strip()
        if content:
            lines.append(f"{role}: {content}")
    return "\n".join(lines) if lines else "No prior conversation."


def _evidence_to_context(evidence: list[dict[str, Any]]) -> str:
    if not evidence:
        return "No approved evidence found."
    blocks: list[str] = []
    for index, item in enumerate(evidence[:8], start=1):
        line_start = item.get("line_start")
        line_end = item.get("line_end")
        line_label = ""
        if line_start is not None:
            line_label = (
                f" l.{line_start}-{line_end}"
                if line_end is not None and line_end != line_start
                else f" l.{line_start}"
            )
        citation = item.get("citation_label") or (
            f"{item.get('document_code', 'DOC')} p.{item.get('page_start', '?')}{line_label}"
        )
        content = (item.get("content") or "").strip()
        if content:
            blocks.append(f"[{index}] {citation}\n{content[:2400]}")
    return "\n\n".join(blocks) if blocks else "No approved evidence found."


def _parse_supported_flag(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    normalized = str(value or "").strip().lower()
    if not normalized:
        return None
    if normalized in {"true", "yes", "y", "supported", "fully_supported"}:
        return True
    if normalized in {"false", "no", "n", "unsupported", "not_supported"}:
        return False
    if "partial" in normalized and "support" in normalized:
        return True
    if "support" in normalized and all(
        token not in normalized for token in ("not", "unsupport", "false", "no")
    ):
        return True
    if any(token in normalized for token in ("unsupport", "not support", "not_supported")):
        return False
    return None


def rewrite_query_with_dspy(
    question: str,
    *,
    language: str = "en",
    role: str = "operator",
    history: list[dict[str, str]] | None = None,
) -> dict[str, str] | None:
    if dspy is None or (not settings.has_primary_llm_credentials and not settings.GROQ_API_KEY):
        return None

    try:
        dsp = ensure_dspy()
        _get_dspy_lm()
        signatures = build_signatures()
        rewrite = dsp.ChainOfThought(signatures["rewrite_query"])
        response = rewrite(
            question=question,
            history=_history_to_text(history),
            language=language,
            role=role,
        )
        rewritten_query = (getattr(response, "rewritten_query", "") or "").strip() or question
        retrieval_hints = (getattr(response, "retrieval_hints", "") or "").strip()
        return {
            "rewritten_query": rewritten_query,
            "retrieval_hints": retrieval_hints,
        }
    except Exception:
        return None


def verify_grounded_answer_with_dspy(
    question: str,
    *,
    draft_answer: str,
    drafted_citations: str | None = None,
    evidence: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    if dspy is None or (not settings.has_primary_llm_credentials and not settings.GROQ_API_KEY) or not evidence:
        return None
    if not (draft_answer or "").strip():
        return None

    try:
        dsp = ensure_dspy()
        _get_dspy_lm()
        signatures = build_signatures()
        verifier = dsp.ChainOfThought(signatures["verify_grounding"])
        result = verifier(
            question=question,
            draft_answer=draft_answer,
            citations=(drafted_citations or "").strip(),
            context=_evidence_to_context(evidence),
        )
        supported_value = _parse_supported_flag(getattr(result, "supported", None))
        safety_note = (getattr(result, "safety_note", "") or "").strip()
        revision_needed = (getattr(result, "revision_needed", "") or "").strip()
        return {
            "supported": supported_value,
            "safety_note": safety_note,
            "revision_needed": revision_needed,
        }
    except Exception:
        return None


def generate_grounded_answer_with_dspy(
    question: str,
    *,
    language: str = "en",
    role: str = "operator",
    history: list[dict[str, str]] | None = None,
    evidence: list[dict[str, Any]] | None = None,
) -> dict[str, str] | None:
    if dspy is None or (not settings.has_primary_llm_credentials and not settings.GROQ_API_KEY) or not evidence:
        return None

    try:
        dsp = ensure_dspy()
        _get_dspy_lm()
        signatures = build_signatures()
        answer = dsp.ChainOfThought(signatures["grounded_answer"])
        result = answer(
            question=question,
            history=_history_to_text(history),
            language=language,
            role=role,
            context=_evidence_to_context(evidence),
        )
        drafted_answer = (getattr(result, "answer", "") or "").strip()
        drafted_citations = (getattr(result, "citations", "") or "").strip()
        drafted_confidence = (getattr(result, "confidence", "") or "").strip()
        if not drafted_answer:
            return None
        return {
            "answer": drafted_answer,
            "citations": drafted_citations,
            "confidence": drafted_confidence,
        }
    except Exception:
        return None
