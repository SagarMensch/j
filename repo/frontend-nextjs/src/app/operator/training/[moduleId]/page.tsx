"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";
import { ProgressBar, StepProgress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DocumentStackIcon,
  SpeakerWaveIcon,
  StopSquareIcon,
  TrainingStepsIcon,
  TranslateSparkIcon,
} from "@/components/ui/icons";
import { apiClient } from "@/lib/api";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/telemetry";

type ModuleSummary = {
  id: string;
  title: string;
  description: string | null;
  document_code: string | null;
  document_title: string | null;
  revision_label: string | null;
  criticality: string;
  total_steps: number;
};

type ModuleStep = {
  id: string;
  step_number: number;
  title: string;
  instruction: string;
  voice_prompt: string | null;
  operator_check: string | null;
  citation_label: string | null;
  page_start: number | null;
  page_end: number | null;
};

type ModuleAssignment = {
  assignment_id: string;
  status: "assigned" | "in_progress" | "completed";
  progress_percent: number;
  current_step: number | null;
};

type AssessmentSummary = {
  assessment_id: string;
  assessment_title: string;
  passing_score: number;
  time_limit_seconds: number | null;
  certification_label: string | null;
};

type ModuleResponse = {
  module: ModuleSummary;
  steps: ModuleStep[];
  assignment: ModuleAssignment | null;
  assessment: AssessmentSummary | null;
};

type ProgressResponse = {
  assignment: ModuleAssignment;
};

type TranslationApiResponse = {
  translated_text: string;
  source_language: string;
  target_language: string;
};

type SpeechSynthesisApiResponse = {
  text: string;
  language: string;
  audio_base64: string;
  audio_mime_type?: string;
};

type LocalizedStepContent = {
  instruction: string;
  operatorCheck: string;
  practiceLine: string;
  speechText: string;
  speechLanguage: string;
};

type CachedAudio = {
  audioBase64: string;
  audioMimeType: string;
  language: string;
};

type TrainingModuleCopy = {
  loading: string;
  loadErrorHint: string;
  noSteps: string;
  backToTraining: string;
  highCriticality: string;
  standardCriticality: string;
  routeTitle: string;
  basedOnApprovedDoc: string;
  progressLabel: string;
  trainingLanguageHint: string;
  stepBadge: (step: number, total: number) => string;
  statusAssigned: string;
  statusInProgress: string;
  statusCompleted: string;
  sourceLabel: string;
  pageLabel: (page: number) => string;
  preparingHindi: string;
  preparingHinglish: string;
  instructionTitle: string;
  instructionHint: string;
  quickCheckTitle: string;
  quickCheckHint: string;
  practiceTitle: string;
  practiceHint: string;
  speakStep: string;
  stopAudio: string;
  preparingAudio: string;
  saving: string;
  saved: string;
  previous: string;
  next: string;
  complete: string;
  openAssessment: string;
  noModuleDescription: string;
  reviewHint: string;
};

const COPY: Record<AppLanguage, TrainingModuleCopy> = {
  ENG: {
    loading: "Loading training step...",
    loadErrorHint:
      "Open this module from the training page after logging in as an operator.",
    noSteps: "This module has no generated steps yet.",
    backToTraining: "Back to training",
    highCriticality: "High priority",
    standardCriticality: "Standard priority",
    routeTitle: "Training route",
    basedOnApprovedDoc: "Based on approved document steps",
    progressLabel: "Training progress",
    trainingLanguageHint: "Step language follows the top ENG / HIN / HING switch.",
    stepBadge: (step, total) => `Step ${step} of ${total}`,
    statusAssigned: "Assigned",
    statusInProgress: "In progress",
    statusCompleted: "Completed",
    sourceLabel: "Source",
    pageLabel: (page) => `Page ${page}`,
    preparingHindi: "Preparing Hindi step...",
    preparingHinglish: "Preparing Hinglish step...",
    instructionTitle: "What to do",
    instructionHint: "Read once, then use the quick check and practice line below.",
    quickCheckTitle: "Quick check",
    quickCheckHint: "Say the key point before you move ahead.",
    practiceTitle: "Speak this line",
    practiceHint: "Short line for spoken practice and recall.",
    speakStep: "Listen",
    stopAudio: "Stop",
    preparingAudio: "Preparing audio...",
    saving: "Saving progress...",
    saved: "Progress is saved to your live training assignment.",
    previous: "Previous",
    next: "Next step",
    complete: "Complete module",
    openAssessment: "Open assessment",
    noModuleDescription:
      "Grounded learning steps from the latest approved document revision.",
    reviewHint: "Review this step once before you continue.",
  },
  HIN: {
    loading: "ट्रेनिंग स्टेप लोड हो रहा है...",
    loadErrorHint:
      "ऑपरेटर के रूप में लॉग इन करने के बाद इस मॉड्यूल को ट्रेनिंग पेज से खोलें।",
    noSteps: "इस मॉड्यूल के लिए अभी स्टेप नहीं बने हैं।",
    backToTraining: "ट्रेनिंग पर वापस",
    highCriticality: "बहुत जरूरी",
    standardCriticality: "सामान्य",
    routeTitle: "ट्रेनिंग रूट",
    basedOnApprovedDoc: "अनुमोदित दस्तावेज के स्टेप पर आधारित",
    progressLabel: "ट्रेनिंग प्रगति",
    trainingLanguageHint: "स्टेप की भाषा ऊपर वाले ENG / HIN / HING स्विच से बदलेगी।",
    stepBadge: (step, total) => `स्टेप ${step} / ${total}`,
    statusAssigned: "दिया गया",
    statusInProgress: "चालू",
    statusCompleted: "पूरा",
    sourceLabel: "स्रोत",
    pageLabel: (page) => `पेज ${page}`,
    preparingHindi: "हिंदी स्टेप तैयार हो रहा है...",
    preparingHinglish: "हिंग्लिश स्टेप तैयार हो रहा है...",
    instructionTitle: "क्या करना है",
    instructionHint: "एक बार पढ़ें, फिर नीचे क्विक चेक और प्रैक्टिस लाइन देखें।",
    quickCheckTitle: "क्विक चेक",
    quickCheckHint: "आगे बढ़ने से पहले मुख्य बात बोलें।",
    practiceTitle: "यह लाइन बोलें",
    practiceHint: "याद रखने और बोलकर अभ्यास करने के लिए छोटी लाइन।",
    speakStep: "सुनें",
    stopAudio: "रोकें",
    preparingAudio: "आवाज़ तैयार हो रही है...",
    saving: "प्रगति सेव हो रही है...",
    saved: "आपकी लाइव ट्रेनिंग असाइनमेंट में प्रगति सेव हो गई है।",
    previous: "पिछला",
    next: "अगला स्टेप",
    complete: "मॉड्यूल पूरा करें",
    openAssessment: "जांच खोलें",
    noModuleDescription:
      "नवीनतम अनुमोदित दस्तावेज संशोधन से बने ग्राउंडेड लर्निंग स्टेप।",
    reviewHint: "आगे बढ़ने से पहले इस स्टेप को एक बार देखें।",
  },
  HING: {
    loading: "Training step load ho raha hai...",
    loadErrorHint: "Operator login ke baad is module ko training page se kholo.",
    noSteps: "Is module ke liye abhi steps ready nahi hain.",
    backToTraining: "Training par wapas",
    highCriticality: "Bahut zaroori",
    standardCriticality: "Normal",
    routeTitle: "Training route",
    basedOnApprovedDoc: "Approved document ke steps par based",
    progressLabel: "Training progress",
    trainingLanguageHint: "Step ki language upar wale ENG / HIN / HING switch se badlegi.",
    stepBadge: (step, total) => `Step ${step} / ${total}`,
    statusAssigned: "Assigned",
    statusInProgress: "Chalu",
    statusCompleted: "Poora",
    sourceLabel: "Source",
    pageLabel: (page) => `Page ${page}`,
    preparingHindi: "Hindi step taiyaar ho raha hai...",
    preparingHinglish: "Hinglish step taiyaar ho raha hai...",
    instructionTitle: "Kya karna hai",
    instructionHint: "Ek baar padho, phir neeche quick check aur practice line dekho.",
    quickCheckTitle: "Quick check",
    quickCheckHint: "Aage badhne se pehle main point bolo.",
    practiceTitle: "Yeh line bolo",
    practiceHint: "Bolkar practice aur yaad rakhne ke liye short line.",
    speakStep: "Suno",
    stopAudio: "Roko",
    preparingAudio: "Audio taiyaar ho raha hai...",
    saving: "Progress save ho rahi hai...",
    saved: "Progress aapki live training assignment me save ho gayi hai.",
    previous: "Pichhla",
    next: "Agla step",
    complete: "Module poora karo",
    openAssessment: "Jaanch kholo",
    noModuleDescription:
      "Latest approved document revision se bane grounded learning steps.",
    reviewHint: "Aage badhne se pehle is step ko ek baar dekh lo.",
  },
};

function clampStep(stepIndex: number, totalSteps: number) {
  if (totalSteps <= 0) return 0;
  return Math.min(Math.max(stepIndex, 0), totalSteps - 1);
}

function normalizeText(text?: string | null) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function truncateText(text: string, limit: number) {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 3).trimEnd()}...`;
}

function firstSentence(text: string, limit = 220) {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  const parts = normalized.match(/[^.!?]+[.!?]?/g) || [normalized];
  const candidate =
    parts.find((part) => part.trim().length > 24)?.trim() || normalized;
  return truncateText(candidate, limit);
}

function buildQuickCheck(step: ModuleStep) {
  return (
    normalizeText(step.operator_check) ||
    firstSentence(step.instruction, 220) ||
    normalizeText(step.title)
  );
}

function buildPracticeLine(step: ModuleStep) {
  const voicePrompt = normalizeText(step.voice_prompt);
  const instruction = normalizeText(step.instruction);
  if (voicePrompt && voicePrompt.length <= 220 && voicePrompt !== instruction) {
    return voicePrompt;
  }
  return buildQuickCheck(step);
}

function isHindiLike(text?: string | null) {
  return /[\u0900-\u097F]/.test(text || "");
}

function inferSourceLanguage(text: string) {
  return isHindiLike(text) ? "hi-IN" : "en-IN";
}

function toTranslationTarget(language: AppLanguage) {
  if (language === "HIN") return "hi-IN";
  if (language === "HING") return "hinglish";
  return "en-IN";
}

function toSpeechLanguage(language: AppLanguage) {
  return language === "ENG" ? "en-IN" : "hi-IN";
}

function getStatusBadge(
  status: ModuleAssignment["status"] | undefined,
  copy: TrainingModuleCopy,
) {
  if (status === "completed") {
    return { label: copy.statusCompleted, variant: "success" as const };
  }
  if (status === "in_progress") {
    return { label: copy.statusInProgress, variant: "warning" as const };
  }
  return { label: copy.statusAssigned, variant: "default" as const };
}

export default function TrainingModulePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, language } = useAuth();
  const copy = COPY[language];
  const moduleId = params.moduleId as string;
  const stepParam = searchParams.get("step");

  const [payload, setPayload] = useState<ModuleResponse | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [translatedSteps, setTranslatedSteps] = useState<
    Record<string, Partial<Record<"HIN" | "HING", LocalizedStepContent>>>
  >({});
  const [isTranslatingStepId, setIsTranslatingStepId] = useState<string | null>(
    null,
  );
  const [cachedAudio, setCachedAudio] = useState<Record<string, CachedAudio>>(
    {},
  );
  const [activeAudioKey, setActiveAudioKey] = useState<string | null>(null);
  const [isPreparingAudio, setIsPreparingAudio] = useState(false);
  const hasMarkedStartRef = useRef(false);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    hasMarkedStartRef.current = false;
    setTranslatedSteps({});
    setCachedAudio({});
    setCurrentStepIndex(0);
  }, [moduleId]);

  useEffect(() => {
    if (!user?.id || !moduleId) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function loadModule() {
      try {
        trackEvent("ui.training_module_opened", { moduleId, userId: user.id });
        const response = (await apiClient.get(
          `/api/training/modules/${moduleId}?user_id=${user.id}`,
        )) as ModuleResponse;

        if (!isMounted) return;

        const requestedStep = Number.parseInt(stepParam || "", 10);
        const assignmentStep = (response.assignment?.current_step || 1) - 1;
        const startingStep = Number.isFinite(requestedStep)
          ? requestedStep - 1
          : assignmentStep;

        setPayload(response);
        setCurrentStepIndex(clampStep(startingStep, response.steps.length));
        setError("");
      } catch (err) {
        if (!isMounted) return;
        setError(
          err instanceof Error ? err.message : "Failed to load module details.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadModule();
    return () => {
      isMounted = false;
    };
  }, [moduleId, stepParam, user?.id]);

  useEffect(() => {
    if (!user?.id || !payload?.assignment || hasMarkedStartRef.current) {
      return;
    }
    if (payload.assignment.status !== "assigned") {
      return;
    }

    hasMarkedStartRef.current = true;
    void apiClient
      .post(
        `/api/training/assignments/${payload.assignment.assignment_id}/progress`,
        {
          user_id: user.id,
          progress_percent: Number(payload.assignment.progress_percent || 0),
          current_step: Math.max(currentStepIndex + 1, 1),
          status: "in_progress",
        },
      )
      .then((response) => {
        const nextAssignment = (response as ProgressResponse).assignment;
        setPayload((current) =>
          current ? { ...current, assignment: nextAssignment } : current,
        );
      })
      .catch(() => {
        hasMarkedStartRef.current = false;
      });
  }, [currentStepIndex, payload, user?.id]);

  const currentStep = payload?.steps[currentStepIndex] || null;
  const totalSteps = payload?.steps.length || 0;
  const completionRate = payload?.assignment?.progress_percent || 0;
  const statusBadge = getStatusBadge(payload?.assignment?.status, copy);

  const baseStepContent = useMemo<LocalizedStepContent | null>(() => {
    if (!currentStep) return null;
    const practiceLine = buildPracticeLine(currentStep);
    return {
      instruction: normalizeText(currentStep.instruction),
      operatorCheck: buildQuickCheck(currentStep),
      practiceLine,
      speechText: practiceLine,
      speechLanguage: inferSourceLanguage(practiceLine || currentStep.instruction),
    };
  }, [currentStep]);

  const translatedContent =
    currentStep && language !== "ENG"
      ? translatedSteps[currentStep.id]?.[language]
      : undefined;

  const visibleStepContent = translatedContent || baseStepContent;
  const isPreparingStepTranslation =
    Boolean(currentStep) &&
    language !== "ENG" &&
    !translatedContent &&
    isTranslatingStepId === currentStep.id;
  const currentAudioKey = currentStep ? `${currentStep.id}:${language}` : null;
  const isCurrentStepSpeaking =
    Boolean(currentAudioKey) && activeAudioKey === currentAudioKey;

  function stopAudioPlayback() {
    activeAudioRef.current?.pause();
    activeAudioRef.current = null;
    if (activeAudioUrlRef.current) {
      URL.revokeObjectURL(activeAudioUrlRef.current);
      activeAudioUrlRef.current = null;
    }
    setActiveAudioKey(null);
    setIsPreparingAudio(false);
  }

  useEffect(() => {
    stopAudioPlayback();
    return () => {
      stopAudioPlayback();
    };
  }, [currentStepIndex, language]);

  const ensureTranslatedStep = async (
    step: ModuleStep,
    targetLanguage: "HIN" | "HING",
  ) => {
    if (translatedSteps[step.id]?.[targetLanguage]) {
      return translatedSteps[step.id]?.[targetLanguage] || null;
    }

    const practiceLine = buildPracticeLine(step);
    const quickCheck = buildQuickCheck(step);
    const sourceLanguage = inferSourceLanguage(step.instruction);

    setIsTranslatingStepId(step.id);
    try {
      trackEvent("ui.training_step_translated", {
        moduleId,
        stepId: step.id,
        targetLanguage,
      });

      const translationTarget = toTranslationTarget(targetLanguage);
      const [
        instructionPayload,
        quickCheckPayload,
        practicePayload,
        speechPayload,
      ] = (await Promise.all([
        apiClient.post("/api/translate", {
          text: step.instruction,
          source_language: sourceLanguage,
          target_language: translationTarget,
        }),
        apiClient.post("/api/translate", {
          text: quickCheck,
          source_language: inferSourceLanguage(quickCheck),
          target_language: translationTarget,
        }),
        apiClient.post("/api/translate", {
          text: practiceLine,
          source_language: inferSourceLanguage(practiceLine),
          target_language: translationTarget,
        }),
        targetLanguage === "HING"
          ? apiClient.post("/api/translate", {
              text: practiceLine,
              source_language: inferSourceLanguage(practiceLine),
              target_language: "hi-IN",
            })
          : Promise.resolve(null),
      ])) as [
        TranslationApiResponse,
        TranslationApiResponse,
        TranslationApiResponse,
        TranslationApiResponse | null,
      ];

      const localized: LocalizedStepContent = {
        instruction: instructionPayload.translated_text,
        operatorCheck: quickCheckPayload.translated_text,
        practiceLine: practicePayload.translated_text,
        speechText:
          targetLanguage === "HING"
            ? speechPayload?.translated_text || practicePayload.translated_text
            : practicePayload.translated_text,
        speechLanguage: toSpeechLanguage(targetLanguage),
      };

      setTranslatedSteps((current) => ({
        ...current,
        [step.id]: {
          ...current[step.id],
          [targetLanguage]: localized,
        },
      }));

      return localized;
    } finally {
      setIsTranslatingStepId((current) => (current === step.id ? null : current));
    }
  };

  useEffect(() => {
    if (!currentStep || language === "ENG") {
      return;
    }
    void ensureTranslatedStep(currentStep, language);
  }, [currentStep, language]);

  async function playAudioBase64(
    audioBase64: string,
    audioMimeType: string,
    audioKey: string,
  ) {
    const binaryString = window.atob(audioBase64);
    const byteArray = new Uint8Array(binaryString.length);
    for (let index = 0; index < binaryString.length; index += 1) {
      byteArray[index] = binaryString.charCodeAt(index);
    }

    stopAudioPlayback();

    const audioBlob = new Blob([byteArray], { type: audioMimeType });
    const audioUrl = URL.createObjectURL(audioBlob);
    activeAudioUrlRef.current = audioUrl;

    const audio = new Audio(audioUrl);
    audio.onended = () => stopAudioPlayback();
    audio.onerror = () => stopAudioPlayback();
    activeAudioRef.current = audio;
    setActiveAudioKey(audioKey);
    await audio.play();
  }

  async function handleSpeakStep() {
    if (!currentStep || !baseStepContent || !currentAudioKey) {
      return;
    }

    if (isCurrentStepSpeaking) {
      stopAudioPlayback();
      return;
    }

    let speechSource = baseStepContent;
    if (language !== "ENG") {
      speechSource =
        (await ensureTranslatedStep(currentStep, language)) || baseStepContent;
    }

    const cacheHit = cachedAudio[currentAudioKey];
    if (
      cacheHit &&
      cacheHit.language === speechSource.speechLanguage &&
      cacheHit.audioBase64
    ) {
      await playAudioBase64(
        cacheHit.audioBase64,
        cacheHit.audioMimeType,
        currentAudioKey,
      );
      return;
    }

    setIsPreparingAudio(true);
    try {
      trackEvent("ui.training_step_spoken", {
        moduleId,
        stepId: currentStep.id,
        language,
      });

      const payload = (await apiClient.post("/api/tts", {
        text: speechSource.speechText,
        language: speechSource.speechLanguage,
        speaker: "suhani",
      })) as SpeechSynthesisApiResponse;

      setCachedAudio((current) => ({
        ...current,
        [currentAudioKey]: {
          audioBase64: payload.audio_base64,
          audioMimeType: payload.audio_mime_type || "audio/wav",
          language: payload.language,
        },
      }));

      await playAudioBase64(
        payload.audio_base64,
        payload.audio_mime_type || "audio/wav",
        currentAudioKey,
      );
    } finally {
      setIsPreparingAudio(false);
    }
  }

  async function persistProgress(
    nextStepIndex: number,
    completedSteps: number,
    status?: ModuleAssignment["status"],
  ) {
    if (!user?.id || !payload?.assignment) {
      return;
    }

    setIsSaving(true);
    try {
      const response = (await apiClient.post(
        `/api/training/assignments/${payload.assignment.assignment_id}/progress`,
        {
          user_id: user.id,
          current_step: Math.max(nextStepIndex + 1, 1),
          progress_percent: totalSteps
            ? Math.round((completedSteps / totalSteps) * 100)
            : 0,
          status,
        },
      )) as ProgressResponse;

      setPayload((current) =>
        current ? { ...current, assignment: response.assignment } : current,
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleNext() {
    if (!payload || currentStepIndex >= totalSteps - 1) return;
    const nextIndex = currentStepIndex + 1;
    const completedSteps = currentStepIndex + 1;

    await persistProgress(nextIndex, completedSteps, "in_progress");
    setCurrentStepIndex(nextIndex);
    trackEvent("ui.training_step_advanced", {
      moduleId,
      stepNumber: nextIndex + 1,
      totalSteps,
    });
  }

  function handlePrevious() {
    if (currentStepIndex <= 0) return;
    setCurrentStepIndex((value) => value - 1);
  }

  async function handleCompleteModule() {
    if (!payload) return;

    await persistProgress(totalSteps - 1, totalSteps, "completed");
    trackEvent("ui.training_module_completed", { moduleId, totalSteps });

    if (payload.assessment?.assessment_id) {
      router.push(`/operator/training/${moduleId}/assessment`);
      return;
    }
    router.push("/operator/training");
  }

  return (
    <OperatorLayout>
      <div className="mx-auto max-w-[1520px] px-4 py-8">
        {isLoading ? (
          <Card>
            <div className="py-12 text-center text-muted">
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <p>{copy.loading}</p>
            </div>
          </Card>
        ) : error ? (
          <Card>
            <div className="py-6 text-center">
              <p className="font-medium text-danger">{error}</p>
              <p className="mt-2 text-sm text-muted">{copy.loadErrorHint}</p>
            </div>
          </Card>
        ) : !payload || !currentStep || !baseStepContent || !visibleStepContent ? (
          <Card>
            <div className="py-6 text-center text-muted">{copy.noSteps}</div>
          </Card>
        ) : (
          <>
            <div className="hero-panel mb-6 p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-3">
                  <Link
                    href="/operator/training"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-muted transition-colors hover:text-primary"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                    {copy.backToTraining}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        payload.module.criticality === "high" ? "warning" : "info"
                      }
                    >
                      {payload.module.criticality === "high"
                        ? copy.highCriticality
                        : copy.standardCriticality}
                    </Badge>
                    {payload.assessment ? (
                      <Link href={`/operator/training/${moduleId}/assessment`}>
                        <Button variant="outline" size="sm">
                          {copy.openAssessment}
                        </Button>
                      </Link>
                    ) : null}
                  </div>
                  <div>
                    <h1 className="text-[1.85rem] font-bold tracking-[-0.03em] text-foreground">
                      {payload.module.title}
                    </h1>
                    <p className="mt-2 text-sm text-muted">
                      {payload.module.document_code ||
                        payload.module.document_title ||
                        "Document"}
                      {payload.module.revision_label
                        ? ` | ${payload.module.revision_label}`
                        : ""}
                    </p>
                  </div>
                </div>

                <div className="min-w-[260px] max-w-[360px] flex-1 rounded-[22px] border border-border bg-white/88 p-4 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-muted">
                      {copy.progressLabel}
                    </p>
                    <p className="text-sm font-semibold text-foreground">
                      {Math.round(completionRate)}%
                    </p>
                  </div>
                  <ProgressBar
                    value={Number(completionRate)}
                    color={
                      payload.assignment?.status === "completed"
                        ? "bg-accent"
                        : "bg-primary"
                    }
                  />
                  <p className="mt-3 text-xs text-muted">
                    {copy.trainingLanguageHint}
                  </p>
                </div>
              </div>
              <StepProgress currentStep={currentStepIndex} totalSteps={totalSteps} />
            </div>

            <div className="grid gap-6 xl:grid-cols-[330px_minmax(0,1fr)]">
              <Card title={copy.routeTitle} icon={<TrainingStepsIcon />} className="h-fit">
                <div className="space-y-5">
                  <div className="rounded-[18px] border border-border bg-[#f7fafe] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                      {copy.basedOnApprovedDoc}
                    </p>
                    <p className="mt-2 text-sm text-foreground">
                      {payload.module.description || copy.noModuleDescription}
                    </p>
                  </div>

                  <ProgressBar
                    value={Number(completionRate)}
                    showLabel
                    label={copy.progressLabel}
                    color={
                      payload.assignment?.status === "completed"
                        ? "bg-accent"
                        : "bg-primary"
                    }
                  />

                  <div className="space-y-3">
                    {payload.steps.map((step, index) => {
                      const isCurrent = index === currentStepIndex;
                      const isDone = index < currentStepIndex;
                      return (
                        <button
                          key={step.id}
                          onClick={() => setCurrentStepIndex(index)}
                          className={`w-full rounded-[18px] border px-3 py-3 text-left transition-all ${
                            isCurrent
                              ? "border-primary bg-primary/6 shadow-[0_8px_18px_rgba(26,46,182,0.08)]"
                              : "border-border bg-white hover:border-primary/30 hover:bg-[#f8fbff]"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                                isDone
                                  ? "bg-accent text-white"
                                  : isCurrent
                                    ? "bg-primary text-white"
                                    : "bg-muted-light text-muted"
                              }`}
                            >
                              {isDone ? "OK" : step.step_number}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground">
                                {step.title}
                              </p>
                              <p className="mt-1 text-xs text-muted">
                                {step.citation_label ||
                                  (step.page_start
                                    ? `${copy.pageLabel(step.page_start)}`
                                    : copy.reviewHint)}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Card>

              <Card className="!p-0">
                <div className="border-b border-border bg-[rgba(244,248,252,0.78)] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="info">
                          {copy.stepBadge(currentStep.step_number, totalSteps)}
                        </Badge>
                        <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                        {isPreparingStepTranslation ? (
                          <Badge variant="default" className="gap-1">
                            <TranslateSparkIcon className="h-4 w-4" />
                            {language === "HING"
                              ? copy.preparingHinglish
                              : copy.preparingHindi}
                          </Badge>
                        ) : null}
                      </div>

                      <div>
                        <h2 className="text-[1.6rem] font-bold tracking-[-0.03em] text-foreground">
                          {currentStep.title}
                        </h2>
                        <p className="mt-2 text-sm text-muted">
                          {copy.sourceLabel}:{" "}
                          {currentStep.citation_label ||
                            payload.module.document_code ||
                            "Document"}
                          {currentStep.page_start
                            ? ` | ${copy.pageLabel(currentStep.page_start)}`
                            : ""}
                        </p>
                      </div>
                    </div>

                    <Button
                      variant={isCurrentStepSpeaking ? "danger" : "secondary"}
                      onClick={() => void handleSpeakStep()}
                      disabled={isPreparingAudio}
                    >
                      {isPreparingAudio ? (
                        <SpeakerWaveIcon className="h-5 w-5" />
                      ) : isCurrentStepSpeaking ? (
                        <StopSquareIcon className="h-5 w-5" />
                      ) : (
                        <SpeakerWaveIcon className="h-5 w-5" />
                      )}
                      {isPreparingAudio
                        ? copy.preparingAudio
                        : isCurrentStepSpeaking
                          ? copy.stopAudio
                          : copy.speakStep}
                    </Button>
                  </div>
                </div>

                <div className="space-y-5 p-5">
                  <div className="rounded-[22px] border border-border bg-[#f7fafe] p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <DocumentStackIcon className="h-5 w-5 text-primary" />
                      <p className="text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
                        {copy.instructionTitle}
                      </p>
                    </div>
                    <p className="mb-3 text-sm text-muted">{copy.instructionHint}</p>
                    <pre className="whitespace-pre-wrap font-sans text-[1.02rem] leading-8 text-foreground">
                      {visibleStepContent.instruction}
                    </pre>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-[22px] border border-border bg-white p-5">
                      <p className="text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
                        {copy.quickCheckTitle}
                      </p>
                      <p className="mt-2 text-xs text-muted">{copy.quickCheckHint}</p>
                      <p className="mt-4 text-lg font-medium leading-8 text-foreground">
                        {visibleStepContent.operatorCheck}
                      </p>
                    </div>

                    <div className="rounded-[22px] border border-border bg-white p-5">
                      <p className="text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-muted">
                        {copy.practiceTitle}
                      </p>
                      <p className="mt-2 text-xs text-muted">{copy.practiceHint}</p>
                      <p className="mt-4 text-lg font-medium leading-8 text-foreground">
                        {visibleStepContent.practiceLine}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs text-muted">
                      {isSaving ? copy.saving : copy.saved}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        onClick={handlePrevious}
                        disabled={currentStepIndex === 0 || isSaving}
                      >
                        {copy.previous}
                      </Button>
                      {currentStepIndex < totalSteps - 1 ? (
                        <Button
                          variant="primary"
                          onClick={() => void handleNext()}
                          disabled={isSaving}
                        >
                          {copy.next}
                        </Button>
                      ) : (
                        <Button
                          variant="success"
                          onClick={() => void handleCompleteModule()}
                          disabled={isSaving}
                        >
                          {copy.complete}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </OperatorLayout>
  );
}
