"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";
import { VoiceMicButton } from "@/components/ui/voice-mic-button";
import { VisemeFrame } from "@/lib/avatar/viseme-map";
import { LessonPlayer } from "@/components/avatar/LessonPlayer";
import { useAudioEnergy } from "@/lib/avatar/use-audio-energy";
import type { AvatarExpression } from "@/components/avatar/HyperrealAvatar";

const AvatarWithDrop = dynamic(
  () => import("@/components/avatar/HyperrealAvatar").then((m) => m.AvatarWithDrop),
  { ssr: false, loading: () => <div className="h-[480px] animate-pulse rounded-[14px] bg-[#0a0f1f]" /> },
);

type LessonApiResponse = {
  module_id: string;
  user_id: string;
  language: string;
  script: string;
  audio_url: string;
  viseme_timeline: VisemeFrame[];
  duration_ms: number;
  model_url: string;
  source: "cache" | "fresh";
};

type QuizApiResponse = {
  module_id: string;
  quiz_id: string;
  language: string;
  spoken_lines: Array<{
    type: "intro" | "question";
    question_id: string | null;
    text: string;
    question?: {
      id: string;
      type: string;
      question: string;
      choices?: string[];
      expected_keywords?: string[];
    };
  }>;
  questions: Array<{
    id: string;
    type: "multiple_choice" | "voice_answer" | "scenario" | "safety_critical";
    question: string;
    choices?: string[];
    expected_keywords?: string[];
  }>;
  source: string;
};

type Copy = {
  workspaceTag: string;
  title: string;
  subtitle: string;
  loadingLesson: string;
  noLesson: string;
  regenerate: string;
  startQuiz: string;
  quizIntro: string;
  quizLoading: string;
  quizQuestion: (n: number, t: number) => string;
  typeOrSpeak: string;
  next: string;
  finish: string;
  finished: string;
  score: (correct: number, total: number) => string;
  back: string;
  error: string;
  modelLabel: string;
  selectAnswer: string;
};

const COPY: Record<AppLanguage, Copy> = {
  ENG: {
    workspaceTag: "Avatar Training",
    title: "AI Trainer",
    subtitle: "Your AI trainer walks you through this procedure step by step, with real lip sync and natural voice.",
    loadingLesson: "Preparing your trainer and pre-baking the lesson audio...",
    noLesson: "Could not load the lesson.",
    regenerate: "Regenerate audio",
    startQuiz: "Start the quiz",
    quizIntro: "Now I'll ask you a few questions. Speak or tap your answer.",
    quizLoading: "Loading quiz...",
    quizQuestion: (n, t) => `Question ${n} of ${t}`,
    typeOrSpeak: "Type or speak your answer",
    next: "Next question",
    finish: "Finish",
    finished: "Great work.",
    score: (c, t) => `You got ${c} of ${t} correct.`,
    back: "Back to module",
    error: "Something went wrong.",
    modelLabel: "Hyperreal VRM",
    selectAnswer: "Select an option",
  },
  HIN: {
    workspaceTag: "अवतार प्रशिक्षण",
    title: "एआई प्रशिक्षक",
    subtitle: "आपका एआई प्रशिक्षक इस प्रक्रिया को चरण-दर-चरण समझाता है।",
    loadingLesson: "प्रशिक्षक तैयार हो रहा है...",
    noLesson: "पाठ लोड नहीं हो सका।",
    regenerate: "ऑडियो पुनः बनाएँ",
    startQuiz: "क्विज़ शुरू करें",
    quizIntro: "अब मैं आपसे कुछ प्रश्न पूछूँगा।",
    quizLoading: "क्विज़ लोड हो रही है...",
    quizQuestion: (n, t) => `प्रश्न ${n} / ${t}`,
    typeOrSpeak: "टाइप करें या बोलें",
    next: "अगला प्रश्न",
    finish: "समाप्त",
    finished: "बहुत बढ़िया।",
    score: (c, t) => `आपने ${t} में से ${c} सही किए।`,
    back: "मॉड्यूल पर वापस",
    error: "कुछ गलत हुआ।",
    modelLabel: "हाइपररीयल VRM",
    selectAnswer: "विकल्प चुनें",
  },
  HING: {
    workspaceTag: "Avatar Training",
    title: "AI Trainer",
    subtitle: "Tera AI trainer is procedure ko step-by-step samjhata hai — real lip sync aur natural voice ke saath.",
    loadingLesson: "Trainer prepare ho raha hai, audio pre-bake ho rahi hai...",
    noLesson: "Lesson load nahi ho paaya.",
    regenerate: "Audio dubara banao",
    startQuiz: "Quiz start karo",
    quizIntro: "Ab main kuch sawaal puchhunga. Bolke ya tap karke jawab do.",
    quizLoading: "Quiz load ho rahi hai...",
    quizQuestion: (n, t) => `Sawaal ${n}/${t}`,
    typeOrSpeak: "Type ya bolke do",
    next: "Next sawaal",
    finish: "Finish",
    finished: "Badhiya kaam.",
    score: (c, t) => `Tu ${t} mein se ${c} sahi paaya.`,
    back: "Module pe wapas",
    error: "Kuch gadbad ho gayi.",
    modelLabel: "Hyperreal VRM",
    selectAnswer: "Option chun",
  },
};

type Phase = "lesson" | "quiz_intro" | "quiz_taking" | "quiz_done";

export default function AvatarTrainingPage() {
  const { user, language } = useAuth();
  const router = useRouter();
  const params = useParams<{ moduleId: string }>();
  const copy = COPY[language];
  const moduleId = params?.moduleId;

  const [lesson, setLesson] = useState<LessonApiResponse | null>(null);
  const [lessonLoading, setLessonLoading] = useState(true);
  const [lessonError, setLessonError] = useState("");
  const [modelError, setModelError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("lesson");
  const [quiz, setQuiz] = useState<QuizApiResponse | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizIdx, setQuizIdx] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizResult, setQuizResult] = useState<{ correct: number; total: number } | null>(null);
  const [isAvatarPlaying, setIsAvatarPlaying] = useState(false);
  const [lastAnswerWrong, setLastAnswerWrong] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const energyRef = useAudioEnergy(audioRef, isAvatarPlaying);

  const expression: AvatarExpression = useMemo(() => {
    if (phase === "quiz_done") {
      return quizResult && quizResult.correct / Math.max(1, quizResult.total) >= 0.7 ? "celebrate" : "smile";
    }
    if (phase === "quiz_taking") return lastAnswerWrong ? "concern" : "thinking";
    if (phase === "quiz_intro") return "smile";
    return "neutral";
  }, [phase, quizResult, lastAnswerWrong]);

  useEffect(() => {
    setLastAnswerWrong(false);
  }, [phase, quizIdx]);

  useEffect(() => {
    if (!user?.id || !moduleId) return;
    let cancelled = false;
    setLessonLoading(true);
    (async () => {
      try {
        const payload = (await apiClient.get(
          `/api/avatar/lesson/${moduleId}?user_id=${encodeURIComponent(user.id)}&language=${language === "HIN" ? "hi" : language === "HING" ? "hing" : "en"}`,
        )) as LessonApiResponse;
        if (cancelled) return;
        setLesson(payload);
        setLessonError("");
      } catch (err) {
        if (!cancelled) setLessonError(err instanceof Error ? err.message : copy.error);
      } finally {
        if (!cancelled) setLessonLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, moduleId, language, copy.error]);

  async function startQuiz() {
    if (!user?.id || !moduleId) return;
    setQuizLoading(true);
    setPhase("quiz_intro");
    try {
      const payload = (await apiClient.post(`/api/avatar/quiz/${moduleId}`, {
        user_id: user.id,
        query: "avatar quiz",
        language: language === "HIN" ? "hi" : language === "HING" ? "hing" : "en",
        conversation_id: null,
      })) as QuizApiResponse;
      setQuiz(payload);
      setQuizIdx(0);
      setQuizAnswers({});
      setQuizResult(null);
      setPhase("quiz_taking");
    } catch (err) {
      setPhase("lesson");
      setLessonError(err instanceof Error ? err.message : copy.error);
    } finally {
      setQuizLoading(false);
    }
  }

  async function finishQuiz() {
    if (!quiz || !user?.id) return;
    try {
      const result = (await apiClient.post("/api/quiz/submit", {
        user_id: user.id,
        questions: quiz.questions,
        answers: quizAnswers,
      })) as { correct: number; total: number };
      setQuizResult({ correct: result.correct, total: result.total });
      setPhase("quiz_done");
    } catch (err) {
      setLessonError(err instanceof Error ? err.message : copy.error);
    }
  }

  return (
    <OperatorLayout>
      <div className="mx-auto max-w-[1280px] px-4 py-6 space-y-6">
        <div className="hero-panel p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{copy.workspaceTag}</p>
              <h1 className="mt-2 text-2xl font-bold text-foreground">{copy.title}</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted">{copy.subtitle}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Operator</p>
              <p className="mt-1 font-semibold text-foreground">{user?.name || "—"}</p>
            </div>
          </div>
        </div>

        {lessonLoading ? (
          <Card>
            <div className="flex items-center gap-3 py-4 text-sm text-muted">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              {copy.loadingLesson}
            </div>
          </Card>
        ) : lessonError ? (
          <Card>
            <p className="py-2 text-sm text-danger">{lessonError}</p>
          </Card>
        ) : !lesson ? (
          <Card>
            <p className="py-2 text-sm text-muted">{copy.noLesson}</p>
          </Card>
        ) : phase === "lesson" ? (
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-[#0019a8]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-primary">{copy.modelLabel}</span>
                  <span className="text-[10px] text-muted">{lesson.source === "cache" ? "cached" : "fresh"}</span>
                </div>
                <AvatarWithDrop
                  initialModelUrl={lesson.model_url}
                  defaultModelUrl="/models/avatar.glb"
                  timeline={lesson.viseme_timeline}
                  isPlaying={isAvatarPlaying}
                  audioRef={audioRef}
                  currentExpression={expression}
                  expressionIntensity={0.7}
                  energyRef={energyRef}
                  onError={(m) => setModelError(m)}
                  height={520}
                />
                {modelError ? (
                  <div className="rounded-[10px] border border-[#f4a623]/40 bg-[#fff8e8] px-3 py-2 text-[11px] text-[#7a4f00]">
                    <p className="font-semibold">Avatar model not loaded: {modelError}</p>
                    <p className="mt-1 text-[10px]">Audio is still playing. Drop a hyperreal .vrm model into <code>public/models/avatar.vrm</code> to enable the 3D trainer.</p>
                  </div>
                ) : null}
              </div>
            </Card>
            <Card>
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Step-by-step audio lesson</p>
                  <p className="mt-1 text-xs text-muted">Pre-baked in your language. Plays back instantly with real viseme lip sync.</p>
                </div>
                <LessonPlayer
                  audioUrl={lesson.audio_url}
                  script={lesson.script}
                  onPlayStateChange={setIsAvatarPlaying}
                  audioRef={audioRef}
                />
                <div className="border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => void startQuiz()}
                    className="w-full rounded-[12px] bg-[#00782a] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#00782a]/90"
                  >
                    {copy.startQuiz}
                  </button>
                </div>
              </div>
            </Card>
          </div>
        ) : null}

        {phase === "quiz_intro" && quizLoading ? (
          <Card>
            <div className="flex items-center gap-3 py-4 text-sm text-muted">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              {copy.quizLoading}
            </div>
          </Card>
        ) : null}

        {phase === "quiz_taking" && quiz ? (
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <AvatarWithDrop
                initialModelUrl={lesson?.model_url || "/models/avatar.glb"}
                defaultModelUrl="/models/avatar.glb"
                timeline={isAvatarPlaying ? (lesson?.viseme_timeline || []) : []}
                isPlaying={isAvatarPlaying}
                audioRef={audioRef}
                currentExpression={expression}
                expressionIntensity={0.8}
                energyRef={energyRef}
                height={520}
              />
            </Card>
            <Card>
              {(() => {
                const q = quiz.questions[quizIdx];
                if (!q) return null;
                return (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                      <span>{copy.quizQuestion(quizIdx + 1, quiz.questions.length)}</span>
                      <span className="rounded-full bg-[#0019a8]/10 px-2 py-0.5 text-primary">{q.type.replace("_", " ")}</span>
                    </div>
                    <p className="text-base font-semibold text-foreground">{q.question}</p>

                    {q.choices && q.choices.length > 0 ? (
                      <div className="grid gap-2">
                        {q.choices.map((c, i) => {
                          const selected = quizAnswers[q.id] === String(i);
                          return (
                            <button
                              key={i}
                              onClick={() => setQuizAnswers((a) => ({ ...a, [q.id]: String(i) }))}
                              className={`rounded-[12px] border px-4 py-3 text-left text-sm transition-colors ${
                                selected ? "border-primary bg-primary/5 text-primary font-semibold" : "border-border bg-white text-foreground hover:border-primary/30"
                              }`}
                            >
                              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px] font-bold">
                                {String.fromCharCode(65 + i)}
                              </span>
                              {c}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.selectAnswer}</p>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={quizAnswers[q.id] || ""}
                            onChange={(e) => setQuizAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                            placeholder={copy.typeOrSpeak}
                            className="flex-1 rounded-[12px] border border-border bg-white px-4 py-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                          <VoiceMicButton
                            scope="general"
                            language="auto"
                            onSubmit={({ text }) => setQuizAnswers((a) => ({ ...a, [q.id]: text }))}
                            size="md"
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setQuizIdx((i) => Math.max(0, i - 1))}
                        disabled={quizIdx === 0}
                        className="rounded-[10px] border border-border bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted transition-colors hover:border-primary/30 hover:text-primary disabled:opacity-40"
                      >
                        Back
                      </button>
                      {quizIdx === quiz.questions.length - 1 ? (
                        <button
                          onClick={() => void finishQuiz()}
                          className="rounded-[10px] bg-[#00782a] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#00782a]/90"
                        >
                          {copy.finish}
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            if (!quizAnswers[q.id] || quizAnswers[q.id].trim() === "") {
                              setLastAnswerWrong(true);
                              window.setTimeout(() => setLastAnswerWrong(false), 1800);
                            }
                            setQuizIdx((i) => i + 1);
                          }}
                          className="rounded-[10px] bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
                        >
                          {copy.next}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </Card>
          </div>
        ) : null}

        {phase === "quiz_done" && quizResult ? (
          <Card>
            <div className="py-8 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.finished}</p>
              <p className="mt-2 text-5xl font-bold text-foreground">{Math.round((quizResult.correct / quizResult.total) * 100)}%</p>
              <p className="mt-1 text-sm text-muted">{copy.score(quizResult.correct, quizResult.total)}</p>
              <button
                onClick={() => router.push(`/operator/training/${moduleId}`)}
                className="mt-6 rounded-[10px] bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
              >
                {copy.back}
              </button>
            </div>
          </Card>
        ) : null}
      </div>
    </OperatorLayout>
  );
}
