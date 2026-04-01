"use client";

import React, { useEffect, useState } from "react";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";

type ReportsPayload = {
  stats: {
    active_certifications: number;
    assessment_attempts: number;
    average_score: number;
    expiring_soon: number;
  };
  certifications: {
    certification_id: string;
    module_title: string;
    status: string;
    issued_at: string | null;
    expires_at: string | null;
    latest_score: number | null;
  }[];
  assessment_attempts: {
    attempt_id: string;
    attempt_number: number;
    score: number | null;
    status: string;
    started_at: string | null;
    completed_at: string | null;
    assessment_title: string;
    module_title: string;
  }[];
};

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ReportsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"certifications" | "assessments">(
    "certifications",
  );
  const [payload, setPayload] = useState<ReportsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function loadReports() {
      try {
        const response = (await apiClient.get(
          `/api/users/${user.id}/reports`,
        )) as ReportsPayload;
        if (!isMounted) return;
        setPayload(response);
        setError("");
      } catch (err) {
        if (!isMounted) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load operator reports.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadReports();
    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  return (
    <OperatorLayout>
      <div className="mx-auto max-w-[1520px] px-4 py-8 space-y-6">
        <div className="hero-panel p-6">
          <p className="tfl-kicker">Progress Ledger</p>
          <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-foreground">
            My reports
          </h1>
          <p className="mt-2 text-sm text-muted">
            Live certification and assessment history for your assigned
            training.
          </p>
        </div>

        {isLoading ? (
          <Card>
            <div className="py-12 text-center text-muted">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p>Loading reports...</p>
            </div>
          </Card>
        ) : error ? (
          <Card>
            <div className="py-6 text-center">
              <p className="text-danger font-medium">{error}</p>
            </div>
          </Card>
        ) : payload ? (
          <>
            <div className="grid sm:grid-cols-4 gap-4">
              <Card>
                <div className="text-center">
                  <p className="text-3xl font-bold text-accent">
                    {payload.stats.active_certifications}
                  </p>
                  <p className="text-sm text-muted">Active Certifications</p>
                </div>
              </Card>
              <Card>
                <div className="text-center">
                  <p className="text-3xl font-bold text-primary">
                    {Math.round(payload.stats.average_score || 0)}%
                  </p>
                  <p className="text-sm text-muted">Average Score</p>
                </div>
              </Card>
              <Card>
                <div className="text-center">
                  <p className="text-3xl font-bold text-foreground">
                    {payload.stats.assessment_attempts}
                  </p>
                  <p className="text-sm text-muted">Assessment Attempts</p>
                </div>
              </Card>
              <Card>
                <div className="text-center">
                  <p className="text-3xl font-bold text-warning">
                    {payload.stats.expiring_soon}
                  </p>
                  <p className="text-sm text-muted">Expiring Soon</p>
                </div>
              </Card>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveTab("certifications")}
                className={`tfl-tab ${activeTab === "certifications" ? "tfl-tab-active" : ""}`}
              >
                Certifications
              </button>
              <button
                onClick={() => setActiveTab("assessments")}
                className={`tfl-tab ${activeTab === "assessments" ? "tfl-tab-active" : ""}`}
              >
                Assessment History
              </button>
            </div>

            {activeTab === "certifications" ? (
              <Card className="!p-0">
                <div className="overflow-x-auto">
                  <table className="tfl-table">
                    <thead>
                      <tr className="bg-muted-light">
                        <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                          Module
                        </th>
                        <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                          Status
                        </th>
                        <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                          Issued
                        </th>
                        <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                          Expires
                        </th>
                        <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                          Latest Score
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {payload.certifications.map((cert) => (
                        <tr
                          key={cert.certification_id}
                          className="hover:bg-muted-light/50 transition-colors"
                        >
                          <td className="px-4 py-3 text-sm font-medium text-foreground">
                            {cert.module_title}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant={
                                cert.status === "active"
                                  ? "success"
                                  : cert.status === "expired"
                                    ? "danger"
                                    : "warning"
                              }
                            >
                              {cert.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-muted">
                            {formatDate(cert.issued_at)}
                          </td>
                          <td className="px-4 py-3 text-sm text-muted">
                            {formatDate(cert.expires_at)}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-primary">
                            {cert.latest_score !== null
                              ? `${Math.round(cert.latest_score)}%`
                              : "-"}
                          </td>
                        </tr>
                      ))}
                      {payload.certifications.length === 0 ? (
                        <tr>
                          <td
                            className="px-4 py-6 text-sm text-muted text-center"
                            colSpan={5}
                          >
                            No certifications recorded yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : (
              <Card className="!p-0">
                <div className="divide-y divide-border">
                  {payload.assessment_attempts.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted">
                      No assessment attempts recorded yet.
                    </div>
                  ) : (
                    payload.assessment_attempts.map((attempt) => (
                      <div
                        key={attempt.attempt_id}
                        className="p-4 flex items-center justify-between gap-4"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {attempt.assessment_title}
                          </p>
                          <p className="text-xs text-muted">
                            {attempt.module_title}
                          </p>
                          <p className="text-xs text-muted mt-1">
                            Attempt {attempt.attempt_number} | Completed{" "}
                            {formatDate(attempt.completed_at)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-primary">
                            {attempt.score !== null
                              ? `${Math.round(attempt.score)}%`
                              : "-"}
                          </p>
                          <Badge
                            variant={
                              attempt.status === "completed"
                                ? "success"
                                : "warning"
                            }
                            size="sm"
                          >
                            {attempt.status}
                          </Badge>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            )}
          </>
        ) : null}
      </div>
    </OperatorLayout>
  );
}
