"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";
import { ProgressBar, StepProgress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api";
import { trackEvent } from "@/lib/telemetry";
import { useAuth } from "@/lib/auth-context";

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

function clampStep(stepIndex: number, totalSteps: number) {
  if (totalSteps <= 0) return 0;
  return Math.min(Math.max(stepIndex, 0), totalSteps - 1);
}

export default function TrainingModulePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, language } = useAuth();
  const moduleId = params.moduleId as string;
  const stepParam = searchParams.get("step");

  const [payload, setPayload] = useState<ModuleResponse | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const hasMarkedStartRef = useRef(false);

  useEffect(() => {
    hasMarkedStartRef.current = false;
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
      speechSynthesis.cancel();
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

  const readinessLabel = useMemo(() => {
    if (!payload?.module) return "";
    if (payload.module.criticality === "high") {
      return "High criticality";
    }
    return "Standard criticality";
  }, [payload?.module]);

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

  function handleSpeak() {
    if (
      !currentStep ||
      typeof window === "undefined" ||
      !("speechSynthesis" in window)
    ) {
      return;
    }

    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      currentStep.voice_prompt || currentStep.instruction,
    );
    utterance.lang =
      language === "HIN" || language === "HING" ? "hi-IN" : "en-IN";
    utterance.rate = 0.92;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    speechSynthesis.speak(utterance);
  }

  function stopSpeak() {
    speechSynthesis.cancel();
    setIsSpeaking(false);
  }

  return (
    <OperatorLayout>
      <div className="mx-auto max-w-[1520px] px-4 py-8">
        {isLoading ? (
          <Card>
            <div className="py-12 text-center text-muted">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p>Loading training module...</p>
            </div>
          </Card>
        ) : error ? (
          <Card>
            <div className="py-6 text-center">
              <p className="text-danger font-medium">{error}</p>
              <p className="text-sm text-muted mt-2">
                Open the module from the training page after logging in as an
                operator.
              </p>
            </div>
          </Card>
        ) : !payload || !currentStep ? (
          <Card>
            <div className="py-6 text-center text-muted">
              This module has no generated steps yet.
            </div>
          </Card>
        ) : (
          <>
            <div className="hero-panel mb-6 p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Link
                    href="/operator/training"
                    className="text-muted hover:text-primary"
                  >
                    <svg
                      className="w-5 h-5"
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
                  </Link>
                  <div>
                    <h1 className="text-xl font-bold text-foreground">
                      {payload.module.title}
                    </h1>
                    <p className="text-sm text-muted">
                      {payload.module.document_code || "Document"}{" "}
                      {payload.module.revision_label
                        ? `| ${payload.module.revision_label}`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      payload.module.criticality === "high" ? "warning" : "info"
                    }
                  >
                    {readinessLabel}
                  </Badge>
                  {payload.assessment ? (
                    <Link href={`/operator/training/${moduleId}/assessment`}>
                      <Button variant="outline" size="sm">
                        Assessment
                      </Button>
                    </Link>
                  ) : null}
                </div>
              </div>
              <StepProgress
                currentStep={currentStepIndex}
                totalSteps={totalSteps}
              />
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
              <Card title="Module Overview">
                <div className="space-y-4">
                  <p className="text-sm text-muted">
                    {payload.module.description ||
                      "Grounded learning steps derived from the approved document revision."}
                  </p>
                  <ProgressBar
                    value={Number(completionRate)}
                    showLabel
                    label="Training progress"
                    color={
                      payload.assignment?.status === "completed"
                        ? "bg-accent"
                        : "bg-primary"
                    }
                  />
                  <div className="space-y-3">
                    {payload.steps.map((step, index) => (
                      <button
                        key={step.id}
                        onClick={() => setCurrentStepIndex(index)}
                        className={`w-full text-left rounded-lg border px-3 py-3 transition-colors ${
                          index === currentStepIndex
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50 hover:bg-muted-light"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                              index < currentStepIndex
                                ? "bg-accent text-white"
                                : index === currentStepIndex
                                  ? "bg-primary text-white"
                                  : "bg-muted-light text-muted"
                            }`}
                          >
                            {index < currentStepIndex ? "OK" : step.step_number}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {step.title}
                            </p>
                            <p className="text-xs text-muted mt-1">
                              {step.operator_check ||
                                "Review this instruction carefully before continuing."}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </Card>

              <div className="lg:col-span-2">
                <Card className="!p-0">
                  <div className="p-4 border-b border-border bg-muted-light">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="info">
                            Step {currentStep.step_number} of {totalSteps}
                          </Badge>
                          {payload.assignment ? (
                            <Badge
                              variant={
                                payload.assignment.status === "completed"
                                  ? "success"
                                  : payload.assignment.status === "in_progress"
                                    ? "warning"
                                    : "default"
                              }
                            >
                              {payload.assignment.status.replace("_", " ")}
                            </Badge>
                          ) : null}
                        </div>
                        <h2 className="text-lg font-semibold text-foreground">
                          {currentStep.title}
                        </h2>
                        <p className="text-sm text-muted mt-1">
                          {currentStep.citation_label ||
                            "Grounded training step"}
                          {currentStep.page_start
                            ? ` | Page ${currentStep.page_start}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant={isSpeaking ? "danger" : "secondary"}
                          size="sm"
                          onClick={isSpeaking ? stopSpeak : handleSpeak}
                        >
                          {isSpeaking ? "Stop Audio" : "Speak Step"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="p-5 space-y-5">
                    <div className="bg-muted-light rounded-lg p-4">
                      <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed">
                        {currentStep.instruction}
                      </pre>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="rounded-lg border border-border p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                          Operator Check
                        </p>
                        <p className="text-sm text-foreground">
                          {currentStep.operator_check ||
                            "Confirm this instruction has been understood before moving ahead."}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                          Voice Prompt
                        </p>
                        <p className="text-sm text-foreground">
                          {currentStep.voice_prompt ||
                            currentStep.instruction.slice(0, 240)}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
                      <div className="text-xs text-muted">
                        {isSaving
                          ? "Saving progress..."
                          : "Progress is stored against your live training assignment."}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          onClick={handlePrevious}
                          disabled={currentStepIndex === 0 || isSaving}
                        >
                          Previous
                        </Button>
                        {currentStepIndex < totalSteps - 1 ? (
                          <Button
                            variant="primary"
                            onClick={() => void handleNext()}
                            disabled={isSaving}
                          >
                            Complete Step and Continue
                          </Button>
                        ) : (
                          <Button
                            variant="success"
                            onClick={() => void handleCompleteModule()}
                            disabled={isSaving}
                          >
                            Complete Module
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
    </OperatorLayout>
  );
}
