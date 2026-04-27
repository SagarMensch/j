"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AdminLayout } from "@/components/admin/admin-layout";
import { Card } from "@/components/ui/card";
import { DonutChart, LineChart, BarChart } from "@/components/ui/charts";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { trackEvent } from "@/lib/telemetry";
import { useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";

type ReadinessPayload = {
  kpis: {
    operational_readiness_score: number;
    mandatory_completion_rate: number;
    certification_rate: number;
    average_assessment_score: number;
    in_progress_count: number;
    assigned_count: number;
  };
  department_compliance: {
    department: string;
    mandatory_total: number;
    mandatory_completed: number;
    completion_rate: number;
  }[];
  training_completion_trend: {
    day: string;
    completed_count: number;
  }[];
  operator_status: {
    user_id: string;
    full_name: string;
    role: string;
    department: string;
    mandatory_total: number;
    mandatory_completed: number;
    active_certifications: number;
    latest_cert_expiry: string | null;
    completion_rate: number;
  }[];
};

type ReportingPayload = {
  platform_usage: {
    daily_active: number;
    weekly_active: number;
    queries_today: number;
    avg_latency_ms: number;
  };
  department_usage: {
    name: string;
    usage: number;
    percentage: number;
  }[];
  top_queries: {
    query: string;
    count: number;
  }[];
  query_trend: {
    month: string;
    value: number;
  }[];
};

type GuardrailIncidentsPayload = {
  incidents: {
    incident_id: string;
    actor_user_id: string | null;
    actor_name: string | null;
    actor_role: string | null;
    actor_department?: string | null;
    category: string;
    reason: string | null;
    severity: string;
    channel: string | null;
    query_excerpt: string | null;
    matched_terms: string[];
    actor_incident_count?: number;
    actor_incident_sequence?: number;
    actor_incidents_last_24h?: number;
    is_first_incident_for_actor?: boolean;
    is_repeat_actor?: boolean;
    actor_first_seen_at?: string | null;
    actor_last_seen_at?: string | null;
    created_at: string;
  }[];
  summary: {
    total: number;
    counts_by_category: Record<string, number>;
    counts_by_severity?: Record<string, number>;
    unique_actor_count?: number;
    first_time_actor_count?: number;
    repeat_actor_count?: number;
    latest_incident_at?: string | null;
  };
};

type GuardrailAppealsPayload = {
  appeals: {
    appeal_id: string;
    incident_id: string;
    requester_user_id: string | null;
    requester_name: string | null;
    requester_role: string | null;
    appeal_text: string | null;
    status: string;
    resolution_notes: string | null;
    reviewed_by_name: string | null;
    created_at: string | null;
    reviewed_at: string | null;
    incident_category: string | null;
    incident_reason: string | null;
    incident_severity: string;
    query_excerpt: string | null;
  }[];
  summary: {
    total: number;
    counts_by_status: Record<string, number>;
  };
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

function deriveOperatorStatus(
  item: ReadinessPayload["operator_status"][number],
) {
  if (item.completion_rate >= 100 && item.active_certifications > 0) {
    return "Ready";
  }
  if (item.mandatory_completed > 0 || item.active_certifications > 0) {
    return "In Progress";
  }
  return "Needs Attention";
}

export default function AdminAnalytics() {
  const { user } = useAuth();
  const guardrailCardRef = useRef<HTMLDivElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [readiness, setReadiness] = useState<ReadinessPayload | null>(null);
  const [reporting, setReporting] = useState<ReportingPayload | null>(null);
  const [incidents, setIncidents] = useState<GuardrailIncidentsPayload | null>(
    null,
  );
  const [appeals, setAppeals] = useState<GuardrailAppealsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewingAppealId, setReviewingAppealId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function loadAnalytics() {
      try {
        trackEvent("ui.admin_readiness_opened", {
          scope: "live",
          role: user.role,
        });
        const [
          readinessResponse,
          reportingResponse,
          incidentsResponse,
          appealsResponse,
        ] =
          await Promise.all([
            apiClient.get(`/api/admin/readiness/overview?user_id=${user.id}`),
            apiClient.get(`/api/admin/reporting/overview?user_id=${user.id}`),
            apiClient.get(`/api/admin/guardrail/incidents?user_id=${user.id}`),
            apiClient.get(`/api/admin/guardrail/appeals?user_id=${user.id}`),
          ]);

        if (!isMounted) return;

        setReadiness(readinessResponse as ReadinessPayload);
        setReporting(reportingResponse as ReportingPayload);
        setIncidents(incidentsResponse as GuardrailIncidentsPayload);
        setAppeals(appealsResponse as GuardrailAppealsPayload);
        setError("");
      } catch (err) {
        if (!isMounted) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load admin analytics.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadAnalytics();
    return () => {
      isMounted = false;
    };
  }, [user?.id, user?.role]);

  const handleAppealReview = async (
    appealId: string,
    status: "approved" | "rejected",
  ) => {
    if (!user?.id) return;
    setReviewingAppealId(appealId);
    try {
      await apiClient.post(`/api/admin/guardrail/appeals/${appealId}/review`, {
        user_id: user.id,
        status,
        resolution_notes: (reviewNotes[appealId] || "").trim() || undefined,
      });
      const appealsResponse = (await apiClient.get(
        `/api/admin/guardrail/appeals?user_id=${user.id}`,
      )) as GuardrailAppealsPayload;
      setAppeals(appealsResponse);
      setReviewNotes((prev) => ({ ...prev, [appealId]: "" }));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to review guardrail appeal.",
      );
    } finally {
      setReviewingAppealId(null);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("focus") !== "guardrails") return;
    const target = guardrailCardRef.current;
    if (!target) return;
    const timeout = window.setTimeout(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [incidents]);

  const filteredOperators = useMemo(() => {
    if (!readiness) return [];
    return readiness.operator_status.filter((operator) => {
      const derivedStatus = deriveOperatorStatus(operator);
      const matchesSearch =
        operator.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        operator.department.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter =
        filterStatus === "all" ||
        derivedStatus.toLowerCase().replace(" ", "-") === filterStatus;
      return matchesSearch && matchesFilter;
    });
  }, [filterStatus, readiness, searchQuery]);

  const departmentBars = useMemo(() => {
    return (readiness?.department_compliance || []).map((item) => ({
      label: item.department,
      values: [Number(item.completion_rate || 0)],
      colors: ["#0019a8"],
      percentage: Math.round(Number(item.completion_rate || 0)),
    }));
  }, [readiness?.department_compliance]);

  const usageBars = useMemo(() => {
    return (reporting?.department_usage || []).map((item) => ({
      label: item.name,
      values: [Number(item.percentage || 0)],
      colors: ["#00782a"],
      percentage: Math.round(Number(item.percentage || 0)),
    }));
  }, [reporting?.department_usage]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="hero-panel p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="tfl-kicker">Analytics Command</p>
              <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-foreground">
                Admin readiness analytics
              </h1>
              <p className="mt-2 text-sm text-muted">
                Live readiness, compliance, and usage signals styled for fast
                operational scanning.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              Demo monitoring live
            </div>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <div className="py-12 text-center text-muted">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p>Loading readiness analytics...</p>
            </div>
          </Card>
        ) : error ? (
          <Card>
            <div className="py-6 text-center">
              <p className="text-danger font-medium">{error}</p>
            </div>
          </Card>
        ) : readiness && reporting ? (
          <>
            <div className="grid lg:grid-cols-3 gap-6">
              <Card
                title="Operational Readiness Score"
                className="flex items-center justify-center py-6"
              >
                <DonutChart
                  value={Math.round(
                    readiness.kpis.operational_readiness_score || 0,
                  )}
                  label="Readiness"
                  size={180}
                />
              </Card>

              <Card title="Department SOP Compliance">
                {departmentBars.length > 0 ? (
                  <BarChart data={departmentBars} />
                ) : (
                  <div className="py-12 text-center text-sm text-muted">
                    No departmental compliance data yet.
                  </div>
                )}
              </Card>

              <Card title="Training Completion Trend">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl font-bold text-primary">
                    {Math.round(readiness.kpis.mandatory_completion_rate || 0)}%
                  </span>
                  <Badge variant="info">
                    {readiness.kpis.in_progress_count} in progress
                  </Badge>
                </div>
                <LineChart
                  data={readiness.training_completion_trend.map((item) => ({
                    month: formatDate(item.day).split(",")[0],
                    value: Number(item.completed_count || 0),
                  }))}
                  height={120}
                />
              </Card>
            </div>

            <div className="grid lg:grid-cols-4 gap-4">
              <Card className="!p-4">
                <p className="text-3xl font-bold text-accent">
                  {Math.round(readiness.kpis.mandatory_completion_rate || 0)}%
                </p>
                <p className="text-sm text-muted">Mandatory Completion</p>
              </Card>
              <Card className="!p-4">
                <p className="text-3xl font-bold text-primary">
                  {Math.round(readiness.kpis.average_assessment_score || 0)}%
                </p>
                <p className="text-sm text-muted">Average Assessment Score</p>
              </Card>
              <Card className="!p-4">
                <p className="text-3xl font-bold text-foreground">
                  {reporting.platform_usage.daily_active}
                </p>
                <p className="text-sm text-muted">Daily Active Users</p>
              </Card>
              <Card className="!p-4">
                <p className="text-3xl font-bold text-foreground">
                  {reporting.platform_usage.queries_today}
                </p>
                <p className="text-sm text-muted">Queries Today</p>
              </Card>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <Card title="Department-wise Platform Usage">
                {usageBars.length > 0 ? (
                  <BarChart data={usageBars} />
                ) : (
                  <div className="py-12 text-center text-sm text-muted">
                    No retrieval events recorded yet.
                  </div>
                )}
              </Card>

              <Card title="Query Trend">
                <LineChart data={reporting.query_trend} height={160} />
              </Card>
            </div>

            <Card title="Most Frequent Queries">
              <div className="space-y-3">
                {reporting.top_queries.length === 0 ? (
                  <p className="text-sm text-muted">
                    No query activity recorded yet.
                  </p>
                ) : (
                  reporting.top_queries.map((query, index) => (
                    <div
                      key={`${query.query}-${index}`}
                      className="flex items-center justify-between p-3 bg-muted-light rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium">
                          {index + 1}
                        </span>
                        <span className="text-sm text-foreground">
                          {query.query}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-primary">
                        {query.count}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <div ref={guardrailCardRef}>
            <Card title="Guardrail Incidents" className="!p-0">
              <div className="border-b border-border bg-muted-light px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Blocked risky or abusive requests
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      First-time actors, repeat behavior, and severity are tracked per incident.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="danger">
                      {incidents?.summary.total || 0} recent
                    </Badge>
                    <Badge variant="warning">
                      {incidents?.summary.counts_by_severity?.high || 0} high
                    </Badge>
                    <Badge variant="info">
                      {incidents?.summary.unique_actor_count || 0} actors
                    </Badge>
                    <Badge variant="success">
                      {incidents?.summary.first_time_actor_count || 0} first-time
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="divide-y divide-border">
                {(incidents?.incidents || []).length === 0 ? (
                  <div className="p-4 text-sm text-muted">
                    No guardrail incidents recorded yet.
                  </div>
                ) : (
                  (incidents?.incidents || []).slice(0, 10).map((incident) => (
                    <div
                      key={incident.incident_id}
                      className="flex items-start justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              incident.severity === "high"
                                ? "danger"
                                : "warning"
                            }
                          >
                            {incident.severity}
                          </Badge>
                          <Badge variant="default">{incident.category}</Badge>
                          {incident.is_first_incident_for_actor ? (
                            <Badge variant="success">First time</Badge>
                          ) : incident.actor_incident_count ? (
                            <Badge variant="warning">
                              Repeat #{incident.actor_incident_count}
                            </Badge>
                          ) : null}
                          {incident.actor_incidents_last_24h && incident.actor_incidents_last_24h > 1 ? (
                            <Badge variant="info">
                              {incident.actor_incidents_last_24h} in 24h
                            </Badge>
                          ) : null}
                          <span className="text-xs text-muted">
                            {incident.channel || "unknown channel"}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-foreground">
                          {incident.query_excerpt || "No excerpt available"}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          Actor: {incident.actor_name || incident.actor_user_id || "anonymous"}{" "}
                          {incident.actor_role ? `| ${incident.actor_role}` : ""}{" "}
                          {incident.actor_department ? `| ${incident.actor_department}` : ""}{" "}
                          | {formatDate(incident.created_at)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                          Reason
                        </p>
                        <p className="mt-1 text-xs text-foreground">
                          {incident.reason || "policy"}
                        </p>
                        {incident.actor_first_seen_at ? (
                          <>
                            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                              First seen
                            </p>
                            <p className="mt-1 text-xs text-foreground">
                              {formatDate(incident.actor_first_seen_at)}
                            </p>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
            </div>

            <Card title="Guardrail Appeals" className="!p-0">
              <div className="border-b border-border bg-muted-light px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="warning">
                    {appeals?.summary.counts_by_status?.pending || 0} pending
                  </Badge>
                  <Badge variant="success">
                    {appeals?.summary.counts_by_status?.approved || 0} approved
                  </Badge>
                  <Badge variant="default">
                    {appeals?.summary.counts_by_status?.rejected || 0} rejected
                  </Badge>
                </div>
              </div>
              <div className="divide-y divide-border">
                {(appeals?.appeals || []).length === 0 ? (
                  <div className="p-4 text-sm text-muted">
                    No guardrail appeals submitted yet.
                  </div>
                ) : (
                  (appeals?.appeals || []).slice(0, 10).map((appeal) => {
                    const isPending = appeal.status === "pending";
                    return (
                      <div key={appeal.appeal_id} className="px-4 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              appeal.incident_severity === "high"
                                ? "danger"
                                : "warning"
                            }
                          >
                            {appeal.incident_severity}
                          </Badge>
                          <Badge
                            variant={
                              appeal.status === "pending"
                                ? "warning"
                                : appeal.status === "approved"
                                  ? "success"
                                  : "default"
                            }
                          >
                            {appeal.status}
                          </Badge>
                          <Badge variant="default">
                            {appeal.incident_category || "guardrail"}
                          </Badge>
                          <span className="text-xs text-muted">
                            {formatDate(appeal.created_at)}
                          </span>
                        </div>
                        <p className="mt-3 text-sm font-medium text-foreground">
                          {appeal.requester_name || "Unknown operator"}
                          {appeal.requester_role ? ` | ${appeal.requester_role}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          Query: {appeal.query_excerpt || "No excerpt recorded"}
                        </p>
                        <p className="mt-3 text-sm text-foreground">
                          Appeal: {appeal.appeal_text || "No appeal text provided."}
                        </p>
                        {appeal.resolution_notes ? (
                          <p className="mt-2 text-xs text-muted">
                            Resolution: {appeal.resolution_notes}
                          </p>
                        ) : null}
                        {appeal.reviewed_by_name ? (
                          <p className="mt-1 text-xs text-muted">
                            Reviewed by {appeal.reviewed_by_name} on {formatDate(appeal.reviewed_at)}
                          </p>
                        ) : null}
                        {isPending ? (
                          <div className="mt-4 rounded-[12px] border border-border bg-white p-3">
                            <textarea
                              value={reviewNotes[appeal.appeal_id] || ""}
                              onChange={(event) =>
                                setReviewNotes((prev) => ({
                                  ...prev,
                                  [appeal.appeal_id]: event.target.value,
                                }))
                              }
                              placeholder="Optional review note"
                              className="min-h-[88px] w-full rounded-[12px] border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary"
                            />
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                onClick={() =>
                                  void handleAppealReview(appeal.appeal_id, "approved")
                                }
                                disabled={reviewingAppealId === appeal.appeal_id}
                                className="rounded-full bg-[#00782a] px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Approve appeal
                              </button>
                              <button
                                onClick={() =>
                                  void handleAppealReview(appeal.appeal_id, "rejected")
                                }
                                disabled={reviewingAppealId === appeal.appeal_id}
                                className="rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-foreground transition hover:border-primary/30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Reject appeal
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </Card>

            <Card title="Operator Certification Status" className="!p-0">
              <div className="p-4 border-b border-border">
                <div className="flex flex-col sm:flex-row gap-4 justify-between">
                  <div className="flex-1 max-w-md">
                    <Input
                      placeholder="Search operators or departments..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      icon={
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
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                          />
                        </svg>
                      }
                    />
                  </div>
                  <div className="w-48">
                    <Select
                      value={filterStatus}
                      onChange={(event) => setFilterStatus(event.target.value)}
                      options={[
                        { value: "all", label: "All Status" },
                        { value: "ready", label: "Ready" },
                        { value: "in-progress", label: "In Progress" },
                        { value: "needs-attention", label: "Needs Attention" },
                      ]}
                    />
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="tfl-table">
                  <thead>
                    <tr className="bg-muted-light">
                      <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                        Name
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                        Role
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                        Department
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                        Completion
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                        Certifications
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredOperators.map((operator) => {
                      const status = deriveOperatorStatus(operator);
                      return (
                        <tr
                          key={operator.user_id}
                          className="hover:bg-muted-light/50 transition-colors"
                        >
                          <td className="px-4 py-3 text-sm font-medium text-foreground">
                            {operator.full_name}
                          </td>
                          <td className="px-4 py-3 text-sm text-muted">
                            {operator.role}
                          </td>
                          <td className="px-4 py-3 text-sm text-muted">
                            {operator.department}
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground">
                            {Math.round(operator.completion_rate || 0)}%
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground">
                            {operator.active_certifications}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant={
                                status === "Ready"
                                  ? "success"
                                  : status === "In Progress"
                                    ? "warning"
                                    : "danger"
                              }
                            >
                              {status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {filteredOperators.length === 0 ? (
                <div className="text-center py-8 text-muted">
                  No operators found matching your criteria.
                </div>
              ) : null}
            </Card>
          </>
        ) : null}
      </div>
    </AdminLayout>
  );
}
