"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/telemetry";

type AssessmentQuestion = {
  question_id: string;
  question_order: number;
  concept_tag: string | null;
  question_text: string;
  options: { id: string; text: string }[];
  explanation: string | null;
  citation_label: string | null;
  page_start: number | null;
};

type AssessmentPayload = {
  assessment: {
    id: string;
    module_id: string;
    title: string;
    passing_score: number;
    time_limit_seconds: number | null;
    certification_label: string | null;
    module_title: string;
  };
  questions: AssessmentQuestion[];
};

type ModuleLookup = {
  assessment: {
    assessment_id: string;
  } | null;
  module: {
    title: string;
  };
};

type SubmitResult = {
  attempt_id: string;
  score: number;
  total_questions: number;
  correct_answers: number;
  passed: boolean;
  passing_score: number;
  certification_status: string;
};

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function AssessmentPage() {
  const params = useParams();
  const { user } = useAuth();
  const moduleId = params.moduleId as string;

  const [payload, setPayload] = useState<AssessmentPayload | null>(null);
  const [moduleTitle, setModuleTitle] = useState("");
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.id || !moduleId) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function loadAssessment() {
      try {
        trackEvent("ui.assessment_opened", { moduleId, userId: user.id });
        const moduleResponse = (await apiClient.get(
          `/api/training/modules/${moduleId}?user_id=${user.id}`,
        )) as ModuleLookup;

        if (!moduleResponse.assessment?.assessment_id) {
          throw new Error(
            "No generated assessment is available for this module yet.",
          );
        }

        const assessmentResponse = (await apiClient.get(
          `/api/assessments/${moduleResponse.assessment.assessment_id}?user_id=${user.id}`,
        )) as AssessmentPayload;

        if (!isMounted) return;

        setModuleTitle(moduleResponse.module.title);
        setPayload(assessmentResponse);
        setTimeLeft(assessmentResponse.assessment.time_limit_seconds || 300);
        setError("");
      } catch (err) {
        if (!isMounted) return;
        setError(
          err instanceof Error ? err.message : "Failed to load assessment.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadAssessment();
    return () => {
      isMounted = false;
    };
  }, [moduleId, user?.id]);

  useEffect(() => {
    if (!payload || result || isSubmitting) {
      return;
    }

    const timer = window.setInterval(() => {
      setTimeLeft((previous) => {
        if (previous <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return previous - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isSubmitting, payload, result]);

  const currentQuestion = payload?.questions[currentQuestionIndex] || null;
  const answeredCount = Object.keys(answers).length;
  const totalQuestions = payload?.questions.length || 0;

  useEffect(() => {
    if (timeLeft !== 0 || !payload || result || isSubmitting) {
      return;
    }
    if (answeredCount === 0) {
      setError("Time expired before any answers were submitted.");
      return;
    }
    void handleSubmit();
  }, [answeredCount, isSubmitting, payload, result, timeLeft]);

  const questionMarkers = useMemo(() => {
    return (payload?.questions || []).map((question, index) => ({
      id: question.question_id,
      label: index + 1,
      answered: Boolean(answers[question.question_id]),
      active: index === currentQuestionIndex,
    }));
  }, [answers, currentQuestionIndex, payload?.questions]);

  function handleAnswerSelect(questionId: string, optionId: string) {
    setAnswers((previous) => ({ ...previous, [questionId]: optionId }));
  }

  async function handleSubmit() {
    if (!user?.id || !payload?.assessment.id || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = (await apiClient.post(
        `/api/assessments/${payload.assessment.id}/submit`,
        {
          user_id: user.id,
          responses: answers,
        },
      )) as SubmitResult;

      trackEvent("ui.assessment_submitted", {
        moduleId,
        score: response.score,
        passed: response.passed,
      });
      setResult(response);
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to submit assessment.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <OperatorLayout>
        <div className="mx-auto max-w-[1520px] px-4 py-12">
          <Card>
            <div className="py-12 text-center text-muted">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p>Loading assessment...</p>
            </div>
          </Card>
        </div>
      </OperatorLayout>
    );
  }

  if (error && !payload) {
    return (
      <OperatorLayout>
        <div className="mx-auto max-w-[1520px] px-4 py-12">
          <Card>
            <div className="py-6 text-center">
              <p className="text-danger font-medium">{error}</p>
              <p className="text-sm text-muted mt-2">
                Complete the training module first, then reopen the assessment.
              </p>
            </div>
          </Card>
        </div>
      </OperatorLayout>
    );
  }

  if (!payload) {
    return null;
  }

  if (result) {
    return (
      <OperatorLayout>
        <div className="max-w-2xl mx-auto px-4 py-12">
          <Card className="text-center">
            <div className="py-8">
              <div
                className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-6 ${
                  result.passed ? "bg-accent-light" : "bg-danger-light"
                }`}
              >
                {result.passed ? (
                  <svg
                    className="w-10 h-10 text-accent"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-10 h-10 text-danger"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                )}
              </div>

              <h2 className="text-2xl font-bold text-foreground mb-2">
                {result.passed ? "Assessment Passed" : "Assessment Incomplete"}
              </h2>
              <p className="text-muted mb-6">
                {result.passed
                  ? "Your readiness result has been stored and certification was updated."
                  : `You need ${result.passing_score}% to pass. Review the module and try again.`}
              </p>

              <div className="bg-muted-light rounded-lg p-6 mb-6">
                <div className="text-4xl font-bold text-foreground mb-2">
                  {Math.round(result.score)}%
                </div>
                <p className="text-sm text-muted">
                  {result.correct_answers} of {result.total_questions} questions
                  answered correctly
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 mb-6">
                <Badge variant={result.passed ? "success" : "danger"} size="md">
                  {result.passed ? "Certified" : "Review Required"}
                </Badge>
                <Badge variant="info" size="md">
                  {payload.assessment.certification_label ||
                    "Operator Readiness"}
                </Badge>
              </div>

              <div className="flex justify-center gap-4">
                <Link href="/operator/training">
                  <Button variant="secondary">Back to Training</Button>
                </Link>
                {!result.passed ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      setCurrentQuestionIndex(0);
                      setAnswers({});
                      setResult(null);
                      setTimeLeft(payload.assessment.time_limit_seconds || 300);
                    }}
                  >
                    Retry Assessment
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>
        </div>
      </OperatorLayout>
    );
  }

  return (
    <OperatorLayout>
      <div className="mx-auto max-w-[1520px] px-4 py-8">
        <div className="hero-panel mb-6 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link
                href={`/operator/training/${moduleId}`}
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
                  {moduleTitle || payload.assessment.module_title}
                </h1>
                <p className="text-sm text-muted">{payload.assessment.title}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Badge variant="info">
                Question {currentQuestionIndex + 1} of {totalQuestions}
              </Badge>
              <div className="flex items-center gap-2 text-muted">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span
                  className={`font-mono font-medium ${timeLeft < 60 ? "text-danger" : ""}`}
                >
                  {formatTime(timeLeft)}
                </span>
              </div>
            </div>
          </div>
          <ProgressBar
            value={currentQuestionIndex + 1}
            max={Math.max(totalQuestions, 1)}
            showLabel={false}
            color="bg-primary"
            height="h-2"
            className="mt-4"
          />
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-danger/20 bg-danger-light p-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        <div className="grid lg:grid-cols-3 gap-6">
          <Card title="Assessment Navigator">
            <div className="space-y-4">
              <div className="grid grid-cols-5 gap-2">
                {questionMarkers.map((marker) => (
                  <button
                    key={marker.id}
                    onClick={() => {
                      const nextIndex = questionMarkers.findIndex(
                        (item) => item.id === marker.id,
                      );
                      if (nextIndex >= 0) {
                        setCurrentQuestionIndex(nextIndex);
                      }
                    }}
                    className={`h-10 rounded-lg text-sm font-semibold transition-colors ${
                      marker.active
                        ? "bg-primary text-white"
                        : marker.answered
                          ? "bg-accent-light text-accent"
                          : "bg-muted-light text-muted hover:bg-muted"
                    }`}
                  >
                    {marker.label}
                  </button>
                ))}
              </div>
              <div className="space-y-2 text-sm text-muted">
                <p>
                  Answered: {answeredCount} / {totalQuestions}
                </p>
                <p>Passing score: {payload.assessment.passing_score}%</p>
                <p>
                  Certification:{" "}
                  {payload.assessment.certification_label ||
                    "Operator Readiness"}
                </p>
              </div>
              <Button
                variant="primary"
                className="w-full"
                onClick={() => void handleSubmit()}
                disabled={isSubmitting || answeredCount === 0}
              >
                {isSubmitting ? "Submitting..." : "Submit Assessment"}
              </Button>
            </div>
          </Card>

          <div className="lg:col-span-2">
            {currentQuestion ? (
              <Card className="!p-0">
                <div className="p-4 border-b border-border bg-muted-light">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="info">
                      Question {currentQuestion.question_order}
                    </Badge>
                    {currentQuestion.concept_tag ? (
                      <Badge variant="default">
                        {currentQuestion.concept_tag}
                      </Badge>
                    ) : null}
                  </div>
                  <h2 className="text-lg font-semibold text-foreground">
                    {currentQuestion.question_text}
                  </h2>
                  <p className="text-sm text-muted mt-2">
                    {currentQuestion.citation_label || "Grounded source"}
                    {currentQuestion.page_start
                      ? ` | Page ${currentQuestion.page_start}`
                      : ""}
                  </p>
                </div>

                <div className="p-5 space-y-3">
                  {currentQuestion.options.map((option) => {
                    const selected =
                      answers[currentQuestion.question_id] === option.id;
                    return (
                      <button
                        key={option.id}
                        onClick={() =>
                          handleAnswerSelect(
                            currentQuestion.question_id,
                            option.id,
                          )
                        }
                        className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40 hover:bg-muted-light"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                              selected
                                ? "bg-primary text-white"
                                : "bg-muted-light text-muted"
                            }`}
                          >
                            {option.id}
                          </span>
                          <span className="text-sm text-foreground">
                            {option.text}
                          </span>
                        </div>
                      </button>
                    );
                  })}

                  <div className="flex items-center justify-between pt-4">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setCurrentQuestionIndex((value) =>
                          Math.max(0, value - 1),
                        )
                      }
                      disabled={currentQuestionIndex === 0}
                    >
                      Previous
                    </Button>
                    {currentQuestionIndex < totalQuestions - 1 ? (
                      <Button
                        variant="primary"
                        onClick={() =>
                          setCurrentQuestionIndex((value) => value + 1)
                        }
                      >
                        Next Question
                      </Button>
                    ) : (
                      <Button
                        variant="success"
                        onClick={() => void handleSubmit()}
                        disabled={isSubmitting || answeredCount === 0}
                      >
                        {isSubmitting ? "Submitting..." : "Finish Assessment"}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </OperatorLayout>
  );
}
