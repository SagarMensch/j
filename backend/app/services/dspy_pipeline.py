from dataclasses import dataclass
from typing import Any

try:
    import dspy
except ImportError:  # pragma: no cover - optional until dependencies are installed
    dspy = None


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
    """
    Contract for the retrieval layer.

    The implementation should combine:
    - lexical retrieval (BM25/rank-bm25 or a learned BM25 variant),
    - semantic retrieval (SBERT/MiniLM embeddings),
    - metadata filters (role, site, document type, revision status).
    """

    def search(self, query: str, top_k: int = 5, filters: dict[str, Any] | None = None) -> list[RetrievedPassage]:
        raise NotImplementedError


def build_signatures():
    dsp = ensure_dspy()

    class RewriteQuery(dsp.Signature):
        """Convert an operator question into a retrieval-focused search query."""

        question = dsp.InputField()
        language = dsp.InputField()
        role = dsp.InputField()
        rewritten_query = dsp.OutputField()
        retrieval_hints = dsp.OutputField()

    class GroundedAnswer(dsp.Signature):
        """Answer only from approved SOP/SMP/WID context and cite the evidence."""

        question = dsp.InputField()
        language = dsp.InputField()
        role = dsp.InputField()
        context = dsp.InputField()
        answer = dsp.OutputField()
        citations = dsp.OutputField()
        confidence = dsp.OutputField()

    class VerifyGrounding(dsp.Signature):
        """Check if the drafted answer is fully supported by the supplied passages."""

        question = dsp.InputField()
        draft_answer = dsp.InputField()
        citations = dsp.InputField()
        context = dsp.InputField()
        supported = dsp.OutputField()
        safety_note = dsp.OutputField()
        revision_needed = dsp.OutputField()

    class GenerateTrainingStep(dsp.Signature):
        """Extract one clear guided training step from approved procedure text."""

        procedure_title = dsp.InputField()
        step_context = dsp.InputField()
        language = dsp.InputField()
        step_title = dsp.OutputField()
        spoken_instruction = dsp.OutputField()
        operator_check = dsp.OutputField()

    class GenerateAssessmentQuestion(dsp.Signature):
        """Create one grounded assessment question from validated training content."""

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
    """
    DSPy program for the Query Assistant + Document Viewer screen.

    Design choices based on the markdown papers in the workspace:
    - DSPy paper: compile declarative modules instead of hand-written prompt strings.
    - Sentence-BERT paper: use sentence embeddings for scalable semantic retrieval.
    - MiniLM paper: prefer compact embedding/reranking models for latency-sensitive use.
    - LambdaBM25 report: retain lexical retrieval for exact terminology, IDs, and plant jargon.
    """

    def __init__(self, retriever: HybridRetriever):
        dsp = ensure_dspy()
        signatures = build_signatures()
        self.retriever = retriever
        self.rewrite = dsp.ChainOfThought(signatures["rewrite_query"])
        self.answer = dsp.ChainOfThought(signatures["grounded_answer"])
        self.verify = dsp.ChainOfThought(signatures["verify_grounding"])

    def forward(self, question: str, language: str = "en", role: str = "operator"):
        rewritten = self.rewrite(question=question, language=language, role=role)
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
    """
    DSPy program fragments for the training, assessment, and admin screens.
    """

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
