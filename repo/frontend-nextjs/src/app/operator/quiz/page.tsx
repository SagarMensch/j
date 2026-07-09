"use client";

import React, { useState } from "react";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";
import { VoiceMicButton } from "@/components/ui/voice-mic-button";

type QuestionType = "multiple_choice" | "voice_answer" | "scenario" | "safety_critical";

type Question = {
  id: string;
  type: QuestionType;
  question: string;
  choices?: string[];
  expected_keywords?: string[];
  correct_index?: number;
  explanation?: string;
};

type GenerateResponse = {
  quiz_id: string;
  equipment: string;
  task: string;
  questions: Question[];
  source: "llm" | "template_fallback";
  evidence_count: number;
};

type SubmitResponse = {
  user_id: string;
  score: number;
  correct: number;
  total: number;
  mastery: "novice" | "learning" | "proficient";
  details: Array<{ question_id: string; type: QuestionType; is_correct: boolean; explanation?: string }>;
};

type Copy = {
  workspaceTag: string;
  title: string;
  subtitle: string;
  contextLabel: string;
  contextPlaceholder: string;
  generate: string;
  generating: string;
  sourceLLM: string;
  sourceFallback: string;
  start: string;
  next: string;
  submit: string;
  submitting: string;
  retake: string;
  result: string;
  score: string;
  correctLabel: (n: number, t: number) => string;
  mastery: { novice: string; learning: string; proficient: string };
  masteryCopy: { novice: string; learning: string; proficient: string };
  questionTypes: Record<QuestionType, string>;
  listen: string;
  typeOrSpeak: string;
  yourAnswer: string;
  skip: string;
  reviewAnswers: string;
  reviewCorrect: string;
  reviewIncorrect: string;
  noQuestions: string;
  error: string;
  back: string;
  evidenceCount: (n: number) => string;
};

const COPY: Record<AppLanguage, Copy> = {
  ENG: {
    workspaceTag: "Quiz",
    title: "Adaptive Quiz Engine",
    subtitle: "5-question adaptive quiz grounded in real procedure evidence. Mix of multiple choice, voice, scenario, and safety-critical questions.",
    contextLabel: "Quiz context (equipment + task)",
    contextPlaceholder: "e.g. Reactor 2 — startup procedure",
    generate: "Generate quiz",
    generating: "Generating quiz...",
    sourceLLM: "LLM-generated",
    sourceFallback: "Template",
    start: "Start",
    next: "Next",
    submit: "Submit",
    submitting: "Submitting...",
    retake: "Generate new quiz",
    result: "Result",
    score: "Score",
    correctLabel: (n, t) => `${n} of ${t} correct`,
    mastery: { novice: "Novice", learning: "Learning", proficient: "Proficient" },
    masteryCopy: {
      novice: "You need hands-on training. Pair with a senior operator on your next shift.",
      learning: "Solid foundation. Re-attempt to push to Proficient — focus on the safety-critical items.",
      proficient: "Excellent. You're cleared to operate independently on this procedure.",
    },
    questionTypes: {
      multiple_choice: "Multiple choice",
      voice_answer: "Voice answer",
      scenario: "Scenario",
      safety_critical: "Safety critical",
    },
    listen: "Speak your answer",
    typeOrSpeak: "Type or speak your answer",
    yourAnswer: "Your answer",
    skip: "Skip",
    reviewAnswers: "Review answers",
    reviewCorrect: "Correct",
    reviewIncorrect: "Incorrect",
    noQuestions: "No questions returned.",
    error: "Something went wrong.",
    back: "Back",
    evidenceCount: (n) => `${n} evidence passages`,
  },
  HIN: {
    workspaceTag: "क्विज़",
    title: "अनुकूली क्विज़ इंजन",
    subtitle: "वास्तविक प्रक्रिया प्रमाण पर आधारित 5-प्रश्न क्विज़।",
    contextLabel: "क्विज़ संदर्भ",
    contextPlaceholder: "जैसे: रिएक्टर 2 — स्टार्टअप प्रक्रिया",
    generate: "क्विज़ बनाएँ",
    generating: "क्विज़ बन रहा है...",
    sourceLLM: "LLM-जनित",
    sourceFallback: "टेम्पलेट",
    start: "शुरू",
    next: "अगला",
    submit: "जमा करें",
    submitting: "जमा हो रहा है...",
    retake: "नया क्विज़ बनाएँ",
    result: "परिणाम",
    score: "स्कोर",
    correctLabel: (n, t) => `${t} में से ${n} सही`,
    mastery: { novice: "नौसिखिया", learning: "सीख रहे", proficient: "निपुण" },
    masteryCopy: {
      novice: "आपको प्रशिक्षण चाहिए।",
      learning: "अच्छी नींव। प्रोफिशिएंट तक पहुँचने के लिए पुनः प्रयास करें।",
      proficient: "बढ़िया। आप स्वतंत्र रूप से संचालन के लिए तैयार हैं।",
    },
    questionTypes: {
      multiple_choice: "बहुविकल्पी",
      voice_answer: "उत्तर बोलें",
      scenario: "परिदृश्य",
      safety_critical: "सुरक्षा महत्वपूर्ण",
    },
    listen: "बोलकर उत्तर दें",
    typeOrSpeak: "टाइप करें या बोलें",
    yourAnswer: "आपका उत्तर",
    skip: "छोड़ें",
    reviewAnswers: "उत्तर समीक्षा",
    reviewCorrect: "सही",
    reviewIncorrect: "गलत",
    noQuestions: "कोई प्रश्न नहीं।",
    error: "कुछ गलत हुआ।",
    back: "वापस",
    evidenceCount: (n) => `${n} प्रमाण पंक्तियाँ`,
  },
  HING: {
    workspaceTag: "Quiz",
    title: "Adaptive Quiz Engine",
    subtitle: "Real procedure evidence pe grounded 5-question quiz. MC, voice, scenario, safety-critical sab mix.",
    contextLabel: "Quiz context (equipment + task)",
    contextPlaceholder: "e.g. Reactor 2 — startup procedure",
    generate: "Generate quiz",
    generating: "Generating quiz...",
    sourceLLM: "LLM-generated",
    sourceFallback: "Template",
    start: "Start",
    next: "Next",
    submit: "Submit",
    submitting: "Submitting...",
    retake: "Generate new quiz",
    result: "Result",
    score: "Score",
    correctLabel: (n, t) => `${n}/${t} sahi`,
    mastery: { novice: "Novice", learning: "Learning", proficient: "Proficient" },
    masteryCopy: {
      novice: "Hands-on training chahiye. Senior operator ke saath pair up kar next shift pe.",
      learning: "Solid foundation. Proficient tak push karne ke liye dobara try kar — safety-critical pe focus kar.",
      proficient: "Badhiya. Tu is procedure pe independently operate karne ke liye cleared hai.",
    },
    questionTypes: {
      multiple_choice: "Multiple choice",
      voice_answer: "Voice answer",
      scenario: "Scenario",
      safety_critical: "Safety critical",
    },
    listen: "Boleke jawab do",
    typeOrSpeak: "Type ya bolke do",
    yourAnswer: "Tera jawab",
    skip: "Skip",
    reviewAnswers: "Review answers",
    reviewCorrect: "Sahi",
    reviewIncorrect: "Galat",
    noQuestions: "Koi question nahi aaya.",
    error: "Kuch gadbad ho gaya.",
    back: "Back",
    evidenceCount: (n) => `${n} evidence passages`,
  },
};

function masteryColor(m: SubmitResponse["mastery"]): string {
  if (m === "proficient") return "bg-[#00782a] text-white";
  if (m === "learning") return "bg-[#ffd329] text-[#1a1a1a]";
  return "bg-danger text-white";
}

type Phase = "config" | "taking" | "submitting" | "result";

export default function QuizPage() {
  const { user, language } = useAuth();
  const copy = COPY[language];
  const [context, setContext] = useState("");
  const [phase, setPhase] = useState<Phase>("config");
  const [quiz, setQuiz] = useState<GenerateResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState("");

  async function generate() {
    if (!user?.id || !context.trim()) return;
    setPhase("taking");
    setAnswers({});
    setCurrentIdx(0);
    setResult(null);
    setError("");
    try {
      const payload = (await apiClient.post("/api/quiz/generate", {
        user_id: user.id,
        query: context.trim(),
        language: language === "ENG" ? "en" : language === "HIN" ? "hi" : "hing",
        conversation_id: null,
      })) as GenerateResponse;
      setQuiz(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.error);
      setPhase("config");
    }
  }

  async function submit() {
    if (!user?.id || !quiz) return;
    setPhase("submitting");
    try {
      const payload = (await apiClient.post("/api/quiz/submit", {
        user_id: user.id,
        questions: quiz.questions,
        answers,
      })) as SubmitResponse;
      setResult(payload);
      setPhase("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.error);
      setPhase("taking");
    }
  }

  const currentQ = quiz?.questions?.[currentIdx];
  const isLast = quiz ? currentIdx === quiz.questions.length - 1 : false;

  return (
    <OperatorLayout>
      <div className="mx-auto max-w-[1100px] px-4 py-6 space-y-6">
        <div className="hero-panel p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{copy.workspaceTag}</p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">{copy.title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">{copy.subtitle}</p>
        </div>

        {error ? (
          <Card>
            <p className="py-2 text-sm text-danger">{error}</p>
          </Card>
        ) : null}

        {phase === "config" && (
          <Card>
            <label className="block">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.contextLabel}</p>
              <input
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder={copy.contextPlaceholder}
                className="mt-2 w-full rounded-[12px] border border-border bg-white px-4 py-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <div className="mt-4 flex justify-end">
              <button
                onClick={generate}
                disabled={!context.trim()}
                className="rounded-[10px] bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {copy.generate}
              </button>
            </div>
          </Card>
        )}

        {phase === "taking" && !quiz && (
          <Card>
            <div className="flex items-center gap-3 py-4 text-sm text-muted">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              {copy.generating}
            </div>
          </Card>
        )}

        {phase === "taking" && quiz && currentQ && (
          <>
            <Card>
              <div className="mb-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                <span>{copy.questionTypes[currentQ.type]}</span>
                <span>Question {currentIdx + 1} / {quiz.questions.length}</span>
              </div>
              <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted-light">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((currentIdx + 1) / quiz.questions.length) * 100}%` }} />
              </div>
              <p className="text-base font-semibold text-foreground">{currentQ.question}</p>

              {currentQ.choices && currentQ.choices.length > 0 ? (
                <div className="mt-4 grid gap-2">
                  {currentQ.choices.map((choice, i) => {
                    const selected = answers[currentQ.id] === String(i);
                    return (
                      <button
                        key={i}
                        onClick={() => setAnswers((a) => ({ ...a, [currentQ.id]: String(i) }))}
                        className={`rounded-[12px] border px-4 py-3 text-left text-sm transition-colors ${
                          selected ? "border-primary bg-primary/5 text-primary font-semibold" : "border-border bg-white text-foreground hover:border-primary/30 hover:bg-primary/5"
                        }`}
                      >
                        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px] font-bold">
                          {String.fromCharCode(65 + i)}
                        </span>
                        {choice}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.yourAnswer}</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={answers[currentQ.id] || ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [currentQ.id]: e.target.value }))}
                      placeholder={copy.typeOrSpeak}
                      className="flex-1 rounded-[12px] border border-border bg-white px-4 py-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <VoiceMicButton
                      scope="general"
                      language="auto"
                      onSubmit={({ text }) => {
                        setAnswers((a) => ({ ...a, [currentQ.id]: text }));
                      }}
                      size="md"
                    />
                  </div>
                </div>
              )}

              <div className="mt-6 flex items-center justify-between">
                <button
                  onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                  disabled={currentIdx === 0}
                  className="rounded-[10px] border border-border bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted transition-colors hover:border-primary/30 hover:text-primary disabled:opacity-40"
                >
                  {copy.back}
                </button>
                {isLast ? (
                  <button
                    onClick={submit}
                    disabled={Object.keys(answers).length < quiz.questions.length}
                    className="rounded-[10px] bg-[#00782a] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#00782a]/90 disabled:opacity-50"
                  >
                    {copy.submit}
                  </button>
                ) : (
                  <button
                    onClick={() => setCurrentIdx((i) => i + 1)}
                    className="rounded-[10px] bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
                  >
                    {copy.next}
                  </button>
                )}
              </div>
            </Card>

            <div className="text-center text-[10px] uppercase tracking-[0.14em] text-muted">
              {quiz.source === "llm" ? copy.sourceLLM : copy.sourceFallback} • {copy.evidenceCount(quiz.evidence_count)}
            </div>
          </>
        )}

        {phase === "submitting" && (
          <Card>
            <div className="flex items-center gap-3 py-4 text-sm text-muted">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              {copy.submitting}
            </div>
          </Card>
        )}

        {phase === "result" && result && quiz && (
          <>
            <Card>
              <div className="text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.result}</p>
                <p className="mt-2 text-5xl font-bold text-foreground">{Math.round(result.score * 100)}%</p>
                <p className="mt-1 text-sm text-muted">{copy.correctLabel(result.correct, result.total)}</p>
                <span className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] ${masteryColor(result.mastery)}`}>
                  {copy.mastery[result.mastery]}
                </span>
                <p className="mx-auto mt-3 max-w-md text-sm text-foreground">{copy.masteryCopy[result.mastery]}</p>
              </div>
            </Card>

            <Card title={copy.reviewAnswers}>
              <ul className="divide-y divide-border/60">
                {quiz.questions.map((q, i) => {
                  const detail = result.details.find((d) => d.question_id === q.id);
                  const ok = detail?.is_correct;
                  return (
                    <li key={q.id} className="py-3">
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${ok ? "bg-[#00782a] text-white" : "bg-danger text-white"}`}>
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-foreground">{q.question}</p>
                          <p className="mt-1 text-xs text-muted">
                            <span className={ok ? "text-[#00782a] font-semibold" : "text-danger font-semibold"}>
                              {ok ? copy.reviewCorrect : copy.reviewIncorrect}
                            </span>
                            {q.choices && q.correct_index !== undefined ? (
                              <span className="ml-2">→ {String.fromCharCode(65 + q.correct_index)}. {q.choices[q.correct_index]}</span>
                            ) : null}
                          </p>
                          {detail?.explanation ? (
                            <p className="mt-1 text-xs text-muted">{detail.explanation}</p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <div className="flex justify-center">
              <button
                onClick={() => {
                  setQuiz(null);
                  setAnswers({});
                  setResult(null);
                  setCurrentIdx(0);
                  setPhase("config");
                }}
                className="rounded-[10px] bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
              >
                {copy.retake}
              </button>
            </div>
          </>
        )}
      </div>
    </OperatorLayout>
  );
}
