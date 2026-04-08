"use client";

import React, { useEffect, useMemo, useState } from "react";
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
    category: string;
    reason: string | null;
    severity: string;
    channel: string | null;
    query_excerpt: string | null;
    matched_terms: string[];
    created_at: string;
  }[];
  summary: {
    total: number;
    counts_by_category: Record<string, number>;
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
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [readiness, setReadiness] = useState<ReadinessPayload | null>(null);
  const [reporting, setReporting] = useState<ReportingPayload | null>(null);
  const [incidents, setIncidents] = useState<GuardrailIncidentsPayload | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

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
        const [readinessResponse, reportingResponse, incidentsResponse] =
          await Promise.all([
          apiClient.get(`/api/admin/readiness/overview?user_id=${user.id}`),
          apiClient.get(`/api/admin/reporting/overview?user_id=${user.id}`),
          apiClient.get(`/api/admin/guardrail/incidents?user_id=${user.id}`),
        ]);

        if (!isMounted) return;

        setReadiness(readinessResponse as ReadinessPayload);
        setReporting(reportingResponse as ReportingPayload);
        setIncidents(incidentsResponse as GuardrailIncidentsPayload);
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

            <Card title="Guardrail Incidents" className="!p-0">
              <div className="border-b border-border bg-muted-light px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">
                    Blocked risky or abusive requests
                  </p>
                  <Badge variant="danger">
                    {incidents?.summary.total || 0} recent
                  </Badge>
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
                      </div>
                    </div>
                  ))
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
