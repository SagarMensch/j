"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";
import {
  ScoreRing,
  XpPanel,
  deriveGameProfile,
} from "@/components/ui/gamification";

type AssessmentRow = {
  assessment_id: string;
  title: string;
  passing_score: number;
  time_limit_seconds: number | null;
  certification_label: string | null;
  module_id: string;
  module_title: string;
  assignment_status: string;
  progress_percent: number;
  latest_score: number | null;
  latest_completed_at: string | null;
  question_count: number;
  status: "available" | "passed" | "failed";
};

type AssessmentCopy = {
  workspaceTag: string;
  title: string;
  subtitle: string;
  operatorLabel: string;
  fallbackUser: string;
  assessmentScore: string;
  reliability: string;
  averageScoreLabel: (value: number) => string;
  passed: string;
  open: string;
  retry: string;
  attemptRules: string;
  highlightedQuiz: string;
  noActiveAssessment: string;
  highlightedHint: string;
  highlightedMeta: (questions: number, passMark: number) => string;
  attempted: string;
  passRate: string;
  averageScore: string;
  boardTitle: string;
  loading: string;
  noAssessments: string;
  noAssessmentsHint: string;
  passedStatus: string;
  retryRequired: string;
  available: string;
  questions: string;
  passMark: string;
  duration: string;
  lastScore: string;
  notAttempted: string;
  review: string;
  retryAction: string;
  takeAssessment: string;
  passLane: string;
  passLaneBody: string;
  openLane: string;
  openLaneBody: string;
  retryLane: string;
  retryLaneBody: string;
};

const COPY: Record<AppLanguage, AssessmentCopy> = {
  ENG: {
    workspaceTag: "Assessment",
    title: "Assessments",
    subtitle: "Readiness checks linked to your assigned training.",
    operatorLabel: "Operator",
    fallbackUser: "User",
    assessmentScore: "Assessment score",
    reliability: "Assessment reliability",
    averageScoreLabel: (value) => `Average score ${value}%`,
    passed: "Passed",
    open: "Open",
    retry: "Retry",
    attemptRules: "Attempt rules",
    highlightedQuiz: "Highlighted quiz",
    noActiveAssessment: "No active assessment",
    highlightedHint: "Waiting for the next generated assessment.",
    highlightedMeta: (questions, passMark) => `${questions} questions | ${passMark}% pass mark`,
    attempted: "Attempted",
    passRate: "Pass rate",
    averageScore: "Average score",
    boardTitle: "Assessment board",
    loading: "Loading assessments...",
    noAssessments: "No assessments assigned yet",
    noAssessmentsHint: "Publish a training document to generate an assessment automatically.",
    passedStatus: "Passed",
    retryRequired: "Retry required",
    available: "Available",
    questions: "Questions",
    passMark: "Pass mark",
    duration: "Duration",
    lastScore: "Last score",
    notAttempted: "Not attempted",
    review: "Review",
    retryAction: "Retry",
    takeAssessment: "Take assessment",
    passLane: "Pass lane",
    passLaneBody: "Assessments completed with a passing score.",
    openLane: "Open lane",
    openLaneBody: "Assessments ready to be taken now.",
    retryLane: "Retry lane",
    retryLaneBody: "Assessments that need another attempt.",
  },
  HIN: {
    workspaceTag: "जांच",
    title: "जांच",
    subtitle: "आपकी ट्रेनिंग से जुड़ी तैयारी जांच।",
    operatorLabel: "ऑपरेटर",
    fallbackUser: "यूज़र",
    assessmentScore: "जांच स्कोर",
    reliability: "जांच स्थिति",
    averageScoreLabel: (value) => `औसत स्कोर ${value}%`,
    passed: "पास",
    open: "खुला",
    retry: "फिर से",
    attemptRules: "नियम",
    highlightedQuiz: "मुख्य क्विज",
    noActiveAssessment: "कोई चालू जांच नहीं",
    highlightedHint: "अगली जांच का इंतजार है।",
    highlightedMeta: (questions, passMark) => `${questions} सवाल | ${passMark}% पास मार्क`,
    attempted: "कोशिश",
    passRate: "पास दर",
    averageScore: "औसत स्कोर",
    boardTitle: "जांच सूची",
    loading: "जांच लोड हो रही है...",
    noAssessments: "अभी कोई जांच नहीं मिली",
    noAssessmentsHint: "ट्रेनिंग दस्तावेज पब्लिश होने पर जांच अपने आप बनेगी।",
    passedStatus: "पास",
    retryRequired: "फिर से दें",
    available: "उपलब्ध",
    questions: "सवाल",
    passMark: "पास मार्क",
    duration: "समय",
    lastScore: "पिछला स्कोर",
    notAttempted: "कोशिश नहीं हुई",
    review: "देखें",
    retryAction: "फिर से दें",
    takeAssessment: "जांच दें",
    passLane: "पास लाइन",
    passLaneBody: "जो जांच पास हो चुकी हैं।",
    openLane: "खुली लाइन",
    openLaneBody: "जो जांच अभी दी जा सकती हैं।",
    retryLane: "फिर से लाइन",
    retryLaneBody: "जिन्हें दोबारा देना है।",
  },
  HING: {
    workspaceTag: "Assessment",
    title: "Assessments",
    subtitle: "Aapki training se judi readiness checks.",
    operatorLabel: "Operator",
    fallbackUser: "User",
    assessmentScore: "Assessment score",
    reliability: "Assessment status",
    averageScoreLabel: (value) => `Average score ${value}%`,
    passed: "Passed",
    open: "Open",
    retry: "Retry",
    attemptRules: "Rules",
    highlightedQuiz: "Main quiz",
    noActiveAssessment: "Koi active assessment nahi",
    highlightedHint: "Next assessment ka wait hai.",
    highlightedMeta: (questions, passMark) => `${questions} questions | ${passMark}% pass mark`,
    attempted: "Attempted",
    passRate: "Pass rate",
    averageScore: "Average score",
    boardTitle: "Assessment board",
    loading: "Assessments load ho rahe hain...",
    noAssessments: "Abhi koi assessment assign nahi hua",
    noAssessmentsHint: "Training document publish hote hi assessment ban jayega.",
    passedStatus: "Passed",
    retryRequired: "Retry required",
    available: "Available",
    questions: "Questions",
    passMark: "Pass mark",
    duration: "Duration",
    lastScore: "Last score",
    notAttempted: "Not attempted",
    review: "Review",
    retryAction: "Retry",
    takeAssessment: "Take assessment",
    passLane: "Pass lane",
    passLaneBody: "Jo assessments pass ho chuki hain.",
    openLane: "Open lane",
    openLaneBody: "Jo assessments abhi ready hain.",
    retryLane: "Retry lane",
    retryLaneBody: "Jin assessments ko dobara dena hai.",
  },
};

export default function AssessmentsPage() {
  const { user, language } = useAuth();
  const copy = COPY[language];
  const [assessments, setAssessments] = useState<AssessmentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function loadAssessments() {
      try {
        const payload = await apiClient.get(
          `/api/assessments?user_id=${user.id}`,
        );
        if (!isMounted) return;
        setAssessments((payload?.assessments || []) as AssessmentRow[]);
        setError("");
      } catch (err) {
        if (!isMounted) return;
        setError(
          err instanceof Error ? err.message : "Failed to load assessments.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadAssessments();
    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  const stats = useMemo(() => {
    const passed = assessments.filter(
      (item) => item.status === "passed",
    ).length;
    const available = assessments.filter(
      (item) => item.status === "available",
    ).length;
    const failed = assessments.filter(
      (item) => item.status === "failed",
    ).length;
    const attempted = assessments.filter(
      (item) => item.latest_score !== null,
    ).length;
    const passRate = attempted ? Math.round((passed / attempted) * 100) : 0;
    const averageScore = attempted
      ? Math.round(
          assessments.reduce(
            (sum, item) => sum + Number(item.latest_score || 0),
            0,
          ) / attempted,
        )
      : 0;
    return { passed, available, failed, attempted, passRate, averageScore };
  }, [assessments]);
  const gameProfile = deriveGameProfile({
    completionRate: stats.passRate,
    inProgress: stats.available,
    overdue: stats.failed,
    passed: stats.passed,
  });
  const highlightedAssessment =
    assessments.find((item) => item.status === "failed") ||
    assessments.find((item) => item.status === "available") ||
    assessments[0] ||
    null;

  return (
    <OperatorLayout>
      <div className="mx-auto max-w-[1520px] px-4 py-6 space-y-6">
        <div className="hero-panel p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                {copy.workspaceTag}
              </p>
              <h1 className="mt-2 text-2xl font-bold text-foreground">
                {copy.title}
              </h1>
              <p className="mt-2 text-sm text-muted">
                {copy.subtitle}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                {copy.operatorLabel}
              </p>
              <p className="mt-1 font-semibold text-foreground">
                {user?.name || copy.fallbackUser}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
          <div className="space-y-4">
            <Card title={copy.assessmentScore}>
              <div className="space-y-4">
                <ScoreRing
                  value={stats.passRate}
                  title={copy.reliability}
                  subtitle={copy.averageScoreLabel(stats.averageScore)}
                />
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-[12px] border border-border bg-[#f8fbfa] px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                      {copy.passed}
                    </p>
                    <p className="mt-1 text-xl font-bold text-accent">
                      {stats.passed}
                    </p>
                  </div>
                  <div className="rounded-[12px] border border-border bg-[#f7f9ff] px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                      {copy.open}
                    </p>
                    <p className="mt-1 text-xl font-bold text-primary">
                      {stats.available}
                    </p>
                  </div>
                  <div className="rounded-[12px] border border-border bg-[#fff3f1] px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                      {copy.retry}
                    </p>
                    <p className="mt-1 text-xl font-bold text-danger">
                      {stats.failed}
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            <Card title={copy.attemptRules}>
              <div className="space-y-3">
                <div className="rounded-[14px] border border-border bg-[#f7faff] px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    {copy.highlightedQuiz}
                  </p>
                  <p className="mt-1 text-base font-semibold text-foreground">
                    {highlightedAssessment?.title || copy.noActiveAssessment}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {highlightedAssessment
                      ? copy.highlightedMeta(
                          highlightedAssessment.question_count,
                          highlightedAssessment.passing_score,
                        )
                      : copy.highlightedHint}
                  </p>
                </div>
                <div className="space-y-2 text-sm text-muted">
                  <div className="flex items-center justify-between rounded-[12px] border border-border bg-white px-3 py-2.5">
                    <span>{copy.attempted}</span>
                    <span className="font-semibold text-foreground">
                      {stats.attempted}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-[12px] border border-border bg-white px-3 py-2.5">
                    <span>{copy.passRate}</span>
                    <span className="font-semibold text-foreground">
                      {stats.passRate}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-[12px] border border-border bg-white px-3 py-2.5">
                    <span>{copy.averageScore}</span>
                    <span className="font-semibold text-foreground">
                      {stats.averageScore}%
                    </span>
                  </div>
                </div>
              </div>
            </Card>

            <XpPanel
              xp={gameProfile.xp}
              level={gameProfile.level}
              streakDays={gameProfile.streakDays}
              badgeLabel={gameProfile.badgeLabel}
            />
          </div>

          <Card title={copy.boardTitle} className="!p-0">
            <div className="space-y-3 p-4">
              {isLoading ? (
                <div className="py-12 text-center text-muted">
                  <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  <p>{copy.loading}</p>
                </div>
              ) : error ? (
                <div className="py-6 text-center">
                  <p className="text-danger font-medium">{error}</p>
                </div>
              ) : assessments.length === 0 ? (
                <div className="py-10 text-center">
                  <h2 className="text-lg font-semibold text-foreground">
                    {copy.noAssessments}
                  </h2>
                  <p className="mt-2 text-sm text-muted">
                    {copy.noAssessmentsHint}
                  </p>
                </div>
              ) : (
                assessments.map((assessment) => {
                  const railColor =
                    assessment.status === "passed"
                      ? "bg-accent"
                      : assessment.status === "failed"
                        ? "bg-danger"
                        : "bg-primary";
                  return (
                    <div
                      key={assessment.assessment_id}
                      className="rounded-[16px] border border-border bg-[linear-gradient(180deg,#ffffff_0%,#f7fafc_100%)] p-4"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-1 h-14 w-1 rounded-full ${railColor}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold text-foreground">
                              {assessment.title}
                            </h3>
                            <Badge
                              variant={
                                assessment.status === "passed"
                                  ? "success"
                                  : assessment.status === "failed"
                                    ? "danger"
                                    : "info"
                              }
                            >
                              {assessment.status === "passed"
                                ? copy.passedStatus
                                : assessment.status === "failed"
                                  ? copy.retryRequired
                                  : copy.available}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted">
                            {assessment.module_title}
                          </p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-[12px] border border-border bg-white px-3 py-2.5">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                                {copy.questions}
                              </p>
                              <p className="mt-1 text-sm font-semibold text-foreground">
                                {assessment.question_count}
                              </p>
                            </div>
                            <div className="rounded-[12px] border border-border bg-white px-3 py-2.5">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                                {copy.passMark}
                              </p>
                              <p className="mt-1 text-sm font-semibold text-foreground">
                                {assessment.passing_score}%
                              </p>
                            </div>
                            <div className="rounded-[12px] border border-border bg-white px-3 py-2.5">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                                {copy.duration}
                              </p>
                              <p className="mt-1 text-sm font-semibold text-foreground">
                                {assessment.time_limit_seconds
                                  ? Math.ceil(
                                      assessment.time_limit_seconds / 60,
                                    )
                                  : 5}{" "}
                                min
                              </p>
                            </div>
                            <div className="rounded-[12px] border border-border bg-white px-3 py-2.5">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                                {copy.lastScore}
                              </p>
                              <p className="mt-1 text-sm font-semibold text-foreground">
                                {assessment.latest_score !== null
                                  ? `${Math.round(assessment.latest_score)}%`
                                  : copy.notAttempted}
                              </p>
                            </div>
                          </div>
                        </div>
                        <Link
                          href={`/operator/training/${assessment.module_id}/assessment`}
                        >
                          <Button
                            variant={
                              assessment.status === "passed"
                                ? "outline"
                                : "primary"
                            }
                          >
                            {assessment.status === "passed"
                              ? copy.review
                              : assessment.status === "failed"
                                ? copy.retryAction
                                : copy.takeAssessment}
                          </Button>
                        </Link>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="!p-4">
            <div className="space-y-2">
              <div className="h-1.5 w-14 rounded-full bg-accent" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                {copy.passLane}
              </p>
              <p className="text-3xl font-bold text-foreground">
                {stats.passed}
              </p>
              <p className="text-sm text-muted">
                {copy.passLaneBody}
              </p>
            </div>
          </Card>
          <Card className="!p-4">
            <div className="space-y-2">
              <div className="h-1.5 w-14 rounded-full bg-primary" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                {copy.openLane}
              </p>
              <p className="text-3xl font-bold text-foreground">
                {stats.available}
              </p>
              <p className="text-sm text-muted">
                {copy.openLaneBody}
              </p>
            </div>
          </Card>
          <Card className="!p-4">
            <div className="space-y-2">
              <div className="h-1.5 w-14 rounded-full bg-danger" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                {copy.retryLane}
              </p>
              <p className="text-3xl font-bold text-foreground">
                {stats.failed}
              </p>
              <p className="text-sm text-muted">
                {copy.retryLaneBody}
              </p>
            </div>
          </Card>
        </div>
      </div>
    </OperatorLayout>
  );
}
