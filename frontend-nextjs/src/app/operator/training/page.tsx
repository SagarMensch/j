"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
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

const STATUS_BADGES: Record<
  Assignment["status"],
  { variant: "default" | "warning" | "success"; label: string }
> = {
  assigned: { variant: "default", label: "Assigned" },
  in_progress: { variant: "warning", label: "In Progress" },
  completed: { variant: "success", label: "Completed" },
};

function formatDate(value: string | null) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function TrainingPage() {
  const { user } = useAuth();
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

  return (
    <OperatorLayout>
      <div className="mx-auto max-w-[1520px] px-4 py-6 space-y-6">
        <div className="hero-panel p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                Training Workspace
              </p>
              <h1 className="mt-2 text-2xl font-bold text-foreground">
                Training and enablement
              </h1>
              <p className="mt-2 text-sm text-muted">
                Guided modules generated from the latest approved SOP, SMP, and
                work-instruction revisions.
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Overall Progress
              </p>
              <p className="mt-1 text-2xl font-bold text-primary">
                {stats.overallProgress}%
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <Card title="Continue Route" className="!p-0">
            <div className="space-y-4 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-4">
                  <ScoreRing
                    value={stats.overallProgress}
                    title="Learning Readiness"
                    subtitle="Live completion across assigned modules"
                  />
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                      Featured Module
                    </p>
                    <p className="mt-1 text-xl font-semibold text-foreground">
                      {featuredAssignment?.module_title || "No active module"}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {featuredAssignment
                        ? `Due ${formatDate(featuredAssignment.due_at)} | ${featuredAssignment.total_steps || 0} steps`
                        : "Waiting for next approved module release."}
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
                          ? "Review Module"
                          : featuredAssignment.status === "in_progress"
                            ? "Resume Module"
                            : "Start Module"}
                      </Button>
                    </Link>
                    {featuredAssignment.assessment_id ? (
                      <Link
                        href={`/operator/training/${featuredAssignment.module_id}/assessment`}
                      >
                        <Button variant="secondary">Open Quiz</Button>
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
                  label="Current learning lane"
                  color="bg-primary"
                  height="h-2.5"
                />
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-[12px] border border-border bg-white px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                      Assigned
                    </p>
                    <p className="mt-1 text-lg font-bold text-foreground">
                      {stats.assigned}
                    </p>
                  </div>
                  <div className="rounded-[12px] border border-border bg-white px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                      Active
                    </p>
                    <p className="mt-1 text-lg font-bold text-primary">
                      {stats.inProgress}
                    </p>
                  </div>
                  <div className="rounded-[12px] border border-border bg-white px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                      Complete
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
            <Card title="Training Signals">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[14px] border border-border bg-[#f7f9ff] px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    New Queue
                  </p>
                  <p className="mt-1 text-2xl font-bold text-foreground">
                    {stats.assigned}
                  </p>
                </div>
                <div className="rounded-[14px] border border-border bg-[#fff8ee] px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    Overdue
                  </p>
                  <p className="mt-1 text-2xl font-bold text-danger">
                    {stats.overdue}
                  </p>
                </div>
                <div className="rounded-[14px] border border-border bg-[#f8fbfa] px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    Completion
                  </p>
                  <p className="mt-1 text-2xl font-bold text-accent">
                    {stats.overallProgress}%
                  </p>
                </div>
                <div className="rounded-[14px] border border-border bg-white px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    Total
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
          <Card title="Assigned Modules" className="!p-0">
            <div className="space-y-3 p-4">
              {isLoading ? (
                <div className="py-12 text-center text-muted">
                  <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  <p>Loading training assignments...</p>
                </div>
              ) : error ? (
                <div className="py-6 text-center">
                  <p className="text-danger font-medium">{error}</p>
                  <p className="mt-2 text-sm text-muted">
                    Check that the backend is running and documents have been
                    ingested.
                  </p>
                </div>
              ) : assignments.length === 0 ? (
                <div className="py-10 text-center">
                  <h2 className="text-lg font-semibold text-foreground">
                    No training modules assigned yet
                  </h2>
                  <p className="mt-2 text-sm text-muted">
                    Upload an approved document from the admin console to
                    generate a module and assessment automatically.
                  </p>
                </div>
              ) : (
                assignments.map((module) => {
                  const status = STATUS_BADGES[module.status];
                  const actionLabel =
                    module.status === "completed"
                      ? "Review"
                      : module.status === "in_progress"
                        ? "Continue"
                        : "Start";
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
                              <Badge variant="info">Mandatory</Badge>
                            ) : null}
                            {module.criticality === "high" ? (
                              <Badge variant="warning">High Criticality</Badge>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted">
                            <span>{module.total_steps || 0} steps</span>
                            <span>Due: {formatDate(module.due_at)}</span>
                            {module.current_step ? (
                              <span>Current step: {module.current_step}</span>
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
                                  Assessment
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
              title="Mission 01"
              subtitle="Start all assigned modules"
              progress={
                stats.assigned === 0
                  ? 100
                  : Math.max(20, 100 - stats.assigned * 18)
              }
              tone={stats.assigned > 0 ? "warning" : "primary"}
            />
            <MissionCard
              title="Mission 02"
              subtitle="Push in-progress to completion"
              progress={Math.min(100, stats.overallProgress + 20)}
              tone="primary"
            />
            <MissionCard
              title="Mission 03"
              subtitle="Zero overdue by end of shift"
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
