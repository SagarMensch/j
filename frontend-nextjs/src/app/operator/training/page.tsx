"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/telemetry";
import {
  MissionCard,
  ScoreRing,
  XpPanel,
  deriveGameProfile,
} from "@/components/ui/gamification";

type Assignment = {
  assignment_id: string;
  module_id: string;
  module_title: string;
  criticality: string;
  total_steps: number;
  is_mandatory: boolean;
  status: "assigned" | "in_progress" | "completed";
  progress_percent: number;
  current_step: number | null;
  due_at: string | null;
  completed_at: string | null;
  assessment_id: string | null;
};

type TrainingCopy = {
  workspaceTag: string;
  title: string;
  subtitle: string;
  overallProgress: string;
  continueRoute: string;
  learningReadiness: string;
  learningReadinessSubtitle: string;
  featuredModule: string;
  noActiveModule: string;
  noActiveModuleHint: string;
  dueLabel: (date: string, steps: number) => string;
  reviewModule: string;
  resumeModule: string;
  startModule: string;
  openQuiz: string;
  currentLearningLane: string;
  assigned: string;
  active: string;
  complete: string;
  trainingSignals: string;
  newQueue: string;
  overdue: string;
  completion: string;
  total: string;
  assignedModules: string;
  loadingAssignments: string;
  backendHint: string;
  noModules: string;
  noModulesHint: string;
  review: string;
  continueAction: string;
  start: string;
  assessment: string;
  mandatory: string;
  highCriticality: string;
  stepsLabel: (steps: number) => string;
  duePrefix: string;
  currentStep: (step: number) => string;
  mission01: string;
  mission01Sub: string;
  mission02: string;
  mission02Sub: string;
  mission03: string;
  mission03Sub: string;
  noDueDate: string;
};

const COPY: Record<AppLanguage, TrainingCopy> = {
  ENG: {
    workspaceTag: "Training",
    title: "Training and enablement",
    subtitle: "Assigned modules from the latest approved documents.",
    overallProgress: "Overall progress",
    continueRoute: "Continue route",
    learningReadiness: "Learning readiness",
    learningReadinessSubtitle: "Live progress across assigned modules",
    featuredModule: "Featured module",
    noActiveModule: "No active module",
    noActiveModuleHint: "Waiting for the next approved module.",
    dueLabel: (date, steps) => `Due ${date} | ${steps} steps`,
    reviewModule: "Review module",
    resumeModule: "Resume module",
    startModule: "Start module",
    openQuiz: "Open quiz",
    currentLearningLane: "Current learning lane",
    assigned: "Assigned",
    active: "Active",
    complete: "Complete",
    trainingSignals: "Training signals",
    newQueue: "New queue",
    overdue: "Overdue",
    completion: "Completion",
    total: "Total",
    assignedModules: "Assigned modules",
    loadingAssignments: "Loading training assignments...",
    backendHint: "Check that the backend is running and documents are ready.",
    noModules: "No training modules assigned yet",
    noModulesHint: "Publish an approved document from admin to generate a module and quiz.",
    review: "Review",
    continueAction: "Continue",
    start: "Start",
    assessment: "Assessment",
    mandatory: "Mandatory",
    highCriticality: "High priority",
    stepsLabel: (steps) => `${steps} steps`,
    duePrefix: "Due",
    currentStep: (step) => `Current step: ${step}`,
    mission01: "Mission 01",
    mission01Sub: "Start all assigned modules",
    mission02: "Mission 02",
    mission02Sub: "Push in-progress to completion",
    mission03: "Mission 03",
    mission03Sub: "Clear overdue items this shift",
    noDueDate: "No due date",
  },
  HIN: {
    workspaceTag: "ट्रेनिंग",
    title: "ट्रेनिंग और तैयारी",
    subtitle: "नए अनुमोदित दस्तावेजों से बने दिए गए मॉड्यूल।",
    overallProgress: "कुल प्रगति",
    continueRoute: "आगे बढ़ें",
    learningReadiness: "सीखने की स्थिति",
    learningReadinessSubtitle: "दिए गए मॉड्यूल की लाइव प्रगति",
    featuredModule: "मुख्य मॉड्यूल",
    noActiveModule: "कोई चालू मॉड्यूल नहीं",
    noActiveModuleHint: "अगले अनुमोदित मॉड्यूल का इंतजार है।",
    dueLabel: (date, steps) => `जमा ${date} | ${steps} स्टेप`,
    reviewModule: "मॉड्यूल देखें",
    resumeModule: "जारी रखें",
    startModule: "शुरू करें",
    openQuiz: "क्विज खोलें",
    currentLearningLane: "अभी की प्रगति",
    assigned: "दिया गया",
    active: "चालू",
    complete: "पूरा",
    trainingSignals: "ट्रेनिंग संकेत",
    newQueue: "नई कतार",
    overdue: "लेट",
    completion: "पूरा",
    total: "कुल",
    assignedModules: "दिए गए मॉड्यूल",
    loadingAssignments: "ट्रेनिंग लोड हो रही है...",
    backendHint: "देखें कि बैकएंड चालू है और दस्तावेज तैयार हैं।",
    noModules: "अभी कोई ट्रेनिंग मॉड्यूल नहीं मिला",
    noModulesHint: "एडमिन से अनुमोदित दस्तावेज पब्लिश होने पर मॉड्यूल और क्विज बनेगा।",
    review: "देखें",
    continueAction: "जारी रखें",
    start: "शुरू करें",
    assessment: "जांच",
    mandatory: "जरूरी",
    highCriticality: "बहुत जरूरी",
    stepsLabel: (steps) => `${steps} स्टेप`,
    duePrefix: "जमा",
    currentStep: (step) => `अभी स्टेप: ${step}`,
    mission01: "लक्ष्य 01",
    mission01Sub: "सभी दिए गए मॉड्यूल शुरू करें",
    mission02: "लक्ष्य 02",
    mission02Sub: "चालू मॉड्यूल पूरा करें",
    mission03: "लक्ष्य 03",
    mission03Sub: "इस शिफ्ट में लेट काम खत्म करें",
    noDueDate: "कोई तारीख नहीं",
  },
  HING: {
    workspaceTag: "Training",
    title: "Training aur tayari",
    subtitle: "Latest approved documents se bane assigned modules.",
    overallProgress: "Overall progress",
    continueRoute: "Aage badho",
    learningReadiness: "Learning status",
    learningReadinessSubtitle: "Assigned modules ki live progress",
    featuredModule: "Main module",
    noActiveModule: "Koi active module nahi",
    noActiveModuleHint: "Next approved module ka wait hai.",
    dueLabel: (date, steps) => `Due ${date} | ${steps} steps`,
    reviewModule: "Module dekho",
    resumeModule: "Resume karo",
    startModule: "Start karo",
    openQuiz: "Quiz kholo",
    currentLearningLane: "Abhi ki progress",
    assigned: "Assigned",
    active: "Active",
    complete: "Complete",
    trainingSignals: "Training signals",
    newQueue: "New queue",
    overdue: "Late",
    completion: "Complete",
    total: "Total",
    assignedModules: "Assigned modules",
    loadingAssignments: "Training assignments load ho rahe hain...",
    backendHint: "Check karo backend chal raha hai aur documents ready hain.",
    noModules: "Abhi koi training module assign nahi hua",
    noModulesHint: "Admin approved document publish karega tab module aur quiz banega.",
    review: "Review",
    continueAction: "Continue",
    start: "Start",
    assessment: "Assessment",
    mandatory: "Mandatory",
    highCriticality: "High priority",
    stepsLabel: (steps) => `${steps} steps`,
    duePrefix: "Due",
    currentStep: (step) => `Current step: ${step}`,
    mission01: "Mission 01",
    mission01Sub: "Sab assigned modules start karo",
    mission02: "Mission 02",
    mission02Sub: "In-progress modules complete karo",
    mission03: "Mission 03",
    mission03Sub: "Is shift me late items clear karo",
    noDueDate: "Due date nahi hai",
  },
};

function statusBadges(copy: TrainingCopy): Record<
  Assignment["status"],
  { variant: "default" | "warning" | "success"; label: string }
> {
  return {
    assigned: { variant: "default", label: copy.assigned },
    in_progress: { variant: "warning", label: copy.active },
    completed: { variant: "success", label: copy.complete },
  };
}

function formatDate(value: string | null, language: AppLanguage, copy: TrainingCopy) {
  if (!value) return copy.noDueDate;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return copy.noDueDate;
  return date.toLocaleDateString(language === "ENG" ? "en-IN" : "hi-IN", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function TrainingPage() {
  const { user, language } = useAuth();
  const copy = COPY[language];
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function loadAssignments() {
      try {
        trackEvent("ui.training_assignments_opened", { userId: user.id });
        const payload = await apiClient.get(
          `/api/training/assignments?user_id=${user.id}`,
        );
        if (!isMounted) return;
        setAssignments((payload?.assignments || []) as Assignment[]);
        setError("");
      } catch (err) {
        if (!isMounted) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load training assignments.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadAssignments();
    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  const stats = useMemo(() => {
    const total = assignments.length;
    const completed = assignments.filter(
      (item) => item.status === "completed",
    ).length;
    const inProgress = assignments.filter(
      (item) => item.status === "in_progress",
    ).length;
    const assigned = assignments.filter(
      (item) => item.status === "assigned",
    ).length;
    const overallProgress = total
      ? Math.round(
          assignments.reduce(
            (sum, item) => sum + Number(item.progress_percent || 0),
            0,
          ) / total,
        )
      : 0;
    const now = Date.now();
    const overdue = assignments.filter((item) => {
      if (item.status === "completed" || !item.due_at) return false;
      const dueAt = new Date(item.due_at).getTime();
      return Number.isFinite(dueAt) && dueAt < now;
    }).length;

    return { total, completed, inProgress, assigned, overdue, overallProgress };
  }, [assignments]);
  const gameProfile = deriveGameProfile({
    completionRate: stats.overallProgress,
    inProgress: stats.inProgress,
    overdue: stats.overdue,
    activeCertifications: stats.completed,
  });
  const featuredAssignment =
    assignments.find((item) => item.status === "in_progress") ||
    assignments.find((item) => item.status === "assigned") ||
    assignments[0] ||
    null;
  const STATUS_BADGES = statusBadges(copy);

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
                {copy.overallProgress}
              </p>
              <p className="mt-1 text-2xl font-bold text-primary">
                {stats.overallProgress}%
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <Card title={copy.continueRoute} className="!p-0">
            <div className="space-y-4 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-4">
                    <ScoreRing
                      value={stats.overallProgress}
                      title={copy.learningReadiness}
                      subtitle={copy.learningReadinessSubtitle}
                    />
                  <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                        {copy.featuredModule}
                      </p>
                      <p className="mt-1 text-xl font-semibold text-foreground">
                        {featuredAssignment?.module_title || copy.noActiveModule}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                      {featuredAssignment
                        ? copy.dueLabel(
                            formatDate(featuredAssignment.due_at, language, copy),
                            featuredAssignment.total_steps || 0,
                          )
                        : copy.noActiveModuleHint}
                    </p>
                  </div>
                </div>
                {featuredAssignment ? (
                  <div className="flex gap-2">
                    <Link
                      href={`/operator/training/${featuredAssignment.module_id}`}
                    >
                      <Button variant="primary">
                        {featuredAssignment.status === "completed"
                          ? copy.reviewModule
                          : featuredAssignment.status === "in_progress"
                            ? copy.resumeModule
                            : copy.startModule}
                      </Button>
                    </Link>
                    {featuredAssignment.assessment_id ? (
                      <Link
                        href={`/operator/training/${featuredAssignment.module_id}/assessment`}
                      >
                        <Button variant="secondary">{copy.openQuiz}</Button>
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="rounded-[14px] border border-border bg-[#f7faff] p-4">
                <ProgressBar
                  value={Number(
                    featuredAssignment?.progress_percent ||
                      stats.overallProgress,
                  )}
                  showLabel
                  label={copy.currentLearningLane}
                  color="bg-primary"
                  height="h-2.5"
                />
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-[12px] border border-border bg-white px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                      {copy.assigned}
                    </p>
                    <p className="mt-1 text-lg font-bold text-foreground">
                      {stats.assigned}
                    </p>
                  </div>
                  <div className="rounded-[12px] border border-border bg-white px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                      {copy.active}
                    </p>
                    <p className="mt-1 text-lg font-bold text-primary">
                      {stats.inProgress}
                    </p>
                  </div>
                  <div className="rounded-[12px] border border-border bg-white px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                      {copy.complete}
                    </p>
                    <p className="mt-1 text-lg font-bold text-accent">
                      {stats.completed}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <XpPanel
              xp={gameProfile.xp}
              level={gameProfile.level}
              streakDays={gameProfile.streakDays}
              badgeLabel={gameProfile.badgeLabel}
            />
            <Card title={copy.trainingSignals}>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[14px] border border-border bg-[#f7f9ff] px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    {copy.newQueue}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-foreground">
                    {stats.assigned}
                  </p>
                </div>
                <div className="rounded-[14px] border border-border bg-[#fff8ee] px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    {copy.overdue}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-danger">
                    {stats.overdue}
                  </p>
                </div>
                <div className="rounded-[14px] border border-border bg-[#f8fbfa] px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    {copy.completion}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-accent">
                    {stats.overallProgress}%
                  </p>
                </div>
                <div className="rounded-[14px] border border-border bg-white px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    {copy.total}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-foreground">
                    {stats.total}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.18fr_0.82fr]">
          <Card title={copy.assignedModules} className="!p-0">
            <div className="space-y-3 p-4">
              {isLoading ? (
                <div className="py-12 text-center text-muted">
                  <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  <p>{copy.loadingAssignments}</p>
                </div>
              ) : error ? (
                <div className="py-6 text-center">
                  <p className="text-danger font-medium">{error}</p>
                  <p className="mt-2 text-sm text-muted">
                    {copy.backendHint}
                  </p>
                </div>
              ) : assignments.length === 0 ? (
                <div className="py-10 text-center">
                  <h2 className="text-lg font-semibold text-foreground">
                    {copy.noModules}
                  </h2>
                  <p className="mt-2 text-sm text-muted">
                    {copy.noModulesHint}
                  </p>
                </div>
              ) : (
                assignments.map((module) => {
                  const status = STATUS_BADGES[module.status];
                  const actionLabel =
                    module.status === "completed"
                      ? copy.review
                      : module.status === "in_progress"
                        ? copy.continueAction
                        : copy.start;
                  const railColor =
                    module.status === "completed"
                      ? "bg-accent"
                      : module.status === "in_progress"
                        ? "bg-primary"
                        : "bg-warning";

                  return (
                    <div
                      key={module.assignment_id}
                      className="rounded-[16px] border border-border bg-[linear-gradient(180deg,#ffffff_0%,#f7fafc_100%)] p-4"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-1 h-12 w-1 rounded-full ${railColor}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold text-foreground">
                              {module.module_title}
                            </h3>
                            <Badge variant={status.variant}>
                              {status.label}
                            </Badge>
                            {module.is_mandatory ? (
                              <Badge variant="info">{copy.mandatory}</Badge>
                            ) : null}
                            {module.criticality === "high" ? (
                              <Badge variant="warning">{copy.highCriticality}</Badge>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted">
                            <span>{copy.stepsLabel(module.total_steps || 0)}</span>
                            <span>{copy.duePrefix}: {formatDate(module.due_at, language, copy)}</span>
                            {module.current_step ? (
                              <span>{copy.currentStep(module.current_step)}</span>
                            ) : null}
                          </div>
                          <ProgressBar
                            value={Number(module.progress_percent || 0)}
                            showLabel={false}
                            color={
                              module.status === "completed"
                                ? "bg-accent"
                                : module.status === "in_progress"
                                  ? "bg-primary"
                                  : "bg-warning"
                            }
                            height="h-2.5"
                            className="mt-3"
                          />
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Link
                              href={`/operator/training/${module.module_id}`}
                            >
                              <Button variant="primary" size="sm">
                                {actionLabel}
                              </Button>
                            </Link>
                            {module.assessment_id ? (
                              <Link
                                href={`/operator/training/${module.module_id}/assessment`}
                              >
                                <Button
                                  variant={
                                    module.status === "completed"
                                      ? "outline"
                                      : "secondary"
                                  }
                                  size="sm"
                                >
                                  {copy.assessment}
                                </Button>
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          <div className="space-y-3">
            <MissionCard
              title={copy.mission01}
              subtitle={copy.mission01Sub}
              progress={
                stats.assigned === 0
                  ? 100
                  : Math.max(20, 100 - stats.assigned * 18)
              }
              tone={stats.assigned > 0 ? "warning" : "primary"}
            />
            <MissionCard
              title={copy.mission02}
              subtitle={copy.mission02Sub}
              progress={Math.min(100, stats.overallProgress + 20)}
              tone="primary"
            />
            <MissionCard
              title={copy.mission03}
              subtitle={copy.mission03Sub}
              progress={
                stats.overdue === 0
                  ? 100
                  : Math.max(15, 100 - stats.overdue * 24)
              }
              tone={stats.overdue > 0 ? "danger" : "primary"}
            />
          </div>
        </div>
      </div>
    </OperatorLayout>
  );
}
