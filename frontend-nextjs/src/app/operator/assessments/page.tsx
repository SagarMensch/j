"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
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

export default function AssessmentsPage() {
  const { user } = useAuth();
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
                Assessment Workspace
              </p>
              <h1 className="mt-2 text-2xl font-bold text-foreground">
                Assessments
              </h1>
              <p className="mt-2 text-sm text-muted">
                Generated readiness checks linked to your assigned training
                modules and approved document sources.
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Operator
              </p>
              <p className="mt-1 font-semibold text-foreground">
                {user?.name || "User"}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
          <div className="space-y-4">
            <Card title="Assessment Score">
              <div className="space-y-4">
                <ScoreRing
                  value={stats.passRate}
                  title="Assessment Reliability"
                  subtitle={`Average score ${stats.averageScore}%`}
                />
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-[12px] border border-border bg-[#f8fbfa] px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                      Passed
                    </p>
                    <p className="mt-1 text-xl font-bold text-accent">
                      {stats.passed}
                    </p>
                  </div>
                  <div className="rounded-[12px] border border-border bg-[#f7f9ff] px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                      Open
                    </p>
                    <p className="mt-1 text-xl font-bold text-primary">
                      {stats.available}
                    </p>
                  </div>
                  <div className="rounded-[12px] border border-border bg-[#fff3f1] px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                      Retry
                    </p>
                    <p className="mt-1 text-xl font-bold text-danger">
                      {stats.failed}
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            <Card title="Attempt Rules">
              <div className="space-y-3">
                <div className="rounded-[14px] border border-border bg-[#f7faff] px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    Highlighted Quiz
                  </p>
                  <p className="mt-1 text-base font-semibold text-foreground">
                    {highlightedAssessment?.title || "No active assessment"}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {highlightedAssessment
                      ? `${highlightedAssessment.question_count} questions | ${highlightedAssessment.passing_score}% pass mark`
                      : "Waiting for the next generated assessment."}
                  </p>
                </div>
                <div className="space-y-2 text-sm text-muted">
                  <div className="flex items-center justify-between rounded-[12px] border border-border bg-white px-3 py-2.5">
                    <span>Attempted</span>
                    <span className="font-semibold text-foreground">
                      {stats.attempted}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-[12px] border border-border bg-white px-3 py-2.5">
                    <span>Pass Rate</span>
                    <span className="font-semibold text-foreground">
                      {stats.passRate}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-[12px] border border-border bg-white px-3 py-2.5">
                    <span>Average Score</span>
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

          <Card title="Assessment Board" className="!p-0">
            <div className="space-y-3 p-4">
              {isLoading ? (
                <div className="py-12 text-center text-muted">
                  <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  <p>Loading assessments...</p>
                </div>
              ) : error ? (
                <div className="py-6 text-center">
                  <p className="text-danger font-medium">{error}</p>
                </div>
              ) : assessments.length === 0 ? (
                <div className="py-10 text-center">
                  <h2 className="text-lg font-semibold text-foreground">
                    No assessments assigned yet
                  </h2>
                  <p className="mt-2 text-sm text-muted">
                    Upload and publish a training document to generate the
                    corresponding assessment automatically.
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
                                ? "Passed"
                                : assessment.status === "failed"
                                  ? "Retry Required"
                                  : "Available"}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted">
                            {assessment.module_title}
                          </p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-[12px] border border-border bg-white px-3 py-2.5">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                                Questions
                              </p>
                              <p className="mt-1 text-sm font-semibold text-foreground">
                                {assessment.question_count}
                              </p>
                            </div>
                            <div className="rounded-[12px] border border-border bg-white px-3 py-2.5">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                                Pass Mark
                              </p>
                              <p className="mt-1 text-sm font-semibold text-foreground">
                                {assessment.passing_score}%
                              </p>
                            </div>
                            <div className="rounded-[12px] border border-border bg-white px-3 py-2.5">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                                Duration
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
                                Last Score
                              </p>
                              <p className="mt-1 text-sm font-semibold text-foreground">
                                {assessment.latest_score !== null
                                  ? `${Math.round(assessment.latest_score)}%`
                                  : "Not attempted"}
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
                              ? "Review"
                              : assessment.status === "failed"
                                ? "Retry"
                                : "Take Assessment"}
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
                Pass Lane
              </p>
              <p className="text-3xl font-bold text-foreground">
                {stats.passed}
              </p>
              <p className="text-sm text-muted">
                Completed assessments with passing outcome.
              </p>
            </div>
          </Card>
          <Card className="!p-4">
            <div className="space-y-2">
              <div className="h-1.5 w-14 rounded-full bg-primary" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                Open Lane
              </p>
              <p className="text-3xl font-bold text-foreground">
                {stats.available}
              </p>
              <p className="text-sm text-muted">
                Assessments ready to be taken in the current cycle.
              </p>
            </div>
          </Card>
          <Card className="!p-4">
            <div className="space-y-2">
              <div className="h-1.5 w-14 rounded-full bg-danger" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                Retry Lane
              </p>
              <p className="text-3xl font-bold text-foreground">
                {stats.failed}
              </p>
              <p className="text-sm text-muted">
                Assessments needing another attempt before sign-off.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </OperatorLayout>
  );
}
