"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminLayout } from "@/components/admin/admin-layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type ReadinessPayload = {
  stats: {
    total_operators: number;
    ready_operators: number;
    completion_rate: number;
    in_progress: number;
    overdue: number;
    assessments_due: number;
    expiring_soon: number;
  };
  by_department: {
    department: string;
    total: number;
    completed: number;
    rate: number;
  }[];
  recent_completions: {
    user_name: string;
    module_title: string;
    completed_at: string;
  }[];
};

type ReportingPayload = {
  stats: {
    total_retrieval_events: number;
    active_users_7d: number;
    avg_response_time_ms: number;
    top_documents: { code: string; title: string; hits: number }[];
    top_queries: { query: string; count: number }[];
  };
};

type GuardrailPayload = {
  incidents: {
    incident_id: string;
    actor_user_id: string | null;
    actor_name: string | null;
    actor_role: string | null;
    actor_department: string | null;
    category: string;
    reason: string | null;
    severity: string;
    channel: string | null;
    query_excerpt: string | null;
    matched_terms: string[];
    is_first_incident_for_actor: boolean;
    actor_incident_count: number;
    actor_incidents_last_24h: number;
    created_at: string;
  }[];
  summary: {
    total: number;
    counts_by_category: Record<string, number>;
    counts_by_severity: Record<string, number>;
    unique_actor_count: number;
    first_time_actor_count: number;
    repeat_actor_count: number;
  };
};

type FocusTab = "overview" | "readiness" | "guardrails" | "retrieval";

function formatDate(value: string) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const focusParam = searchParams.get("focus") as FocusTab | null;
  const [activeTab, setActiveTab] = useState<FocusTab>(focusParam || "overview");
  const [readiness, setReadiness] = useState<ReadinessPayload | null>(null);
  const [reporting, setReporting] = useState<ReportingPayload | null>(null);
  const [guardrails, setGuardrails] = useState<GuardrailPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) { setIsLoading(false); return; }
    let cancelled = false;

    async function loadAll() {
      setIsLoading(true);
      try {
        const [r, rep, g] = await Promise.all([
          apiClient.get("/api/admin/readiness/overview") as Promise<ReadinessPayload>,
          apiClient.get("/api/admin/reporting/overview") as Promise<ReportingPayload>,
          apiClient.get(`/api/admin/guardrail/incidents?user_id=${user.id}&limit=100`) as Promise<GuardrailPayload>,
        ]);
        if (!cancelled) { setReadiness(r); setReporting(rep); setGuardrails(g); }
      } catch { /* non-fatal */ }
      finally { if (!cancelled) setIsLoading(false); }
    }

    void loadAll();
    return () => { cancelled = true; };
  }, [user?.id]);

  const tabs: { key: FocusTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "readiness", label: "Workforce Readiness" },
    { key: "guardrails", label: "Guardrails" },
    { key: "retrieval", label: "Retrieval Quality" },
  ];

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="min-h-[50vh] flex flex-col items-center justify-center p-12 text-muted">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
          <p>Loading analytics...</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="hero-panel p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="tfl-kicker">Analytics Workspace</p>
              <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-foreground">
                Deep operational analytics
              </h1>
              <p className="mt-2 text-sm text-muted">
                Readiness breakdowns, retrieval signals, and guardrail patterns from the live system.
              </p>
            </div>
            <div className="flex gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                    activeTab === tab.key
                      ? "bg-primary text-white"
                      : "bg-muted-light text-muted hover:bg-muted"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {activeTab === "overview" && (
          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Workforce Readiness">
              {readiness ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Ready</p>
                      <p className="mt-2 text-2xl font-bold text-primary">
                        {readiness.stats.ready_operators}/{readiness.stats.total_operators}
                      </p>
                    </div>
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">In Progress</p>
                      <p className="mt-2 text-2xl font-bold text-secondary">{readiness.stats.in_progress}</p>
                    </div>
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Overdue</p>
                      <p className="mt-2 text-2xl font-bold text-danger">{readiness.stats.overdue}</p>
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-foreground mt-2">By Department</p>
                  <div className="space-y-2">
                    {(readiness.by_department || []).map((dept) => (
                      <div key={dept.department} className="flex items-center justify-between">
                        <span className="text-sm text-foreground">{dept.department}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${dept.rate}%` }} />
                          </div>
                          <span className="text-xs font-mono text-muted">{dept.rate}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">No readiness data available.</p>
              )}
            </Card>

            <Card title="Retrieval Quality">
              {reporting ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Total Events</p>
                      <p className="mt-2 text-2xl font-bold text-foreground">
                        {reporting.stats.total_retrieval_events?.toLocaleString() || 0}
                      </p>
                    </div>
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Avg Latency</p>
                      <p className="mt-2 text-2xl font-bold text-secondary">
                        {Math.round(reporting.stats.avg_response_time_ms || 0)}ms
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-2">Top Documents</p>
                    {((reporting.stats.top_documents || []).slice(0, 5)).map((doc, i) => (
                      <div key={i} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                        <span className="text-xs font-mono text-primary">{doc.code}</span>
                        <span className="text-xs text-muted">{doc.title}</span>
                        <Badge variant="default" size="sm">{doc.hits} hits</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">No retrieval data available.</p>
              )}
            </Card>

            <Card title="Guardrail Summary" className="xl:col-span-2">
              {guardrails ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Total</p>
                      <p className="mt-2 text-2xl font-bold text-danger">{guardrails.summary.total}</p>
                    </div>
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Unique Actors</p>
                      <p className="mt-2 text-2xl font-bold text-foreground">{guardrails.summary.unique_actor_count}</p>
                    </div>
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">First-Time</p>
                      <p className="mt-2 text-2xl font-bold text-secondary">{guardrails.summary.first_time_actor_count}</p>
                    </div>
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Repeat</p>
                      <p className="mt-2 text-2xl font-bold text-primary">{guardrails.summary.repeat_actor_count}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(guardrails.summary.counts_by_severity || {}).map(([sev, count]) => (
                      <Badge key={sev} variant={sev === "high" ? "danger" : sev === "medium" ? "warning" : "default"}>
                        {sev}: {count}
                      </Badge>
                    ))}
                    {Object.entries(guardrails.summary.counts_by_category || {}).map(([cat, count]) => (
                      <Badge key={cat} variant="default">{cat}: {count}</Badge>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">No guardrail data available.</p>
              )}
            </Card>
          </div>
        )}

        {activeTab === "readiness" && (
          <Card title="Workforce Readiness Detail">
            {readiness ? (
              <div className="space-y-6">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Ready Operators</p>
                    <p className="mt-2 text-2xl font-bold text-primary">{readiness.stats.ready_operators}</p>
                    <p className="mt-1 text-xs text-muted">of {readiness.stats.total_operators} total</p>
                  </div>
                  <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Completion Rate</p>
                    <p className="mt-2 text-2xl font-bold text-secondary">{readiness.stats.completion_rate}%</p>
                  </div>
                  <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Overdue</p>
                    <p className="mt-2 text-2xl font-bold text-danger">{readiness.stats.overdue}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground mb-3">Recent Completions</p>
                  <div className="space-y-2">
                    {(readiness.recent_completions || []).map((item, i) => (
                      <div key={i} className="flex items-center justify-between rounded-[4px] border border-border px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{item.user_name}</p>
                          <p className="text-xs text-muted">{item.module_title}</p>
                        </div>
                        <span className="text-xs text-muted">{formatDate(item.completed_at)}</span>
                      </div>
                    ))}
                    {(!readiness.recent_completions || readiness.recent_completions.length === 0) && (
                      <p className="text-sm text-muted">No recent completions.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">No readiness data available.</p>
            )}
          </Card>
        )}

        {activeTab === "guardrails" && (
          <Card title="Guardrail Incident Log">
            {guardrails ? (
              <div className="space-y-3">
                {guardrails.incidents.length === 0 ? (
                  <p className="text-sm text-muted py-6 text-center">No incidents recorded.</p>
                ) : (
                  guardrails.incidents.map((incident) => (
                    <div key={incident.incident_id} className="rounded-[4px] border border-border px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={incident.severity === "high" ? "danger" : "warning"}>{incident.severity}</Badge>
                        <Badge variant="default">{incident.category}</Badge>
                        {incident.is_first_incident_for_actor ? (
                          <Badge variant="success">First time</Badge>
                        ) : (
                          <Badge variant="info">Repeat #{incident.actor_incident_count}</Badge>
                        )}
                        {incident.actor_incidents_last_24h > 1 && (
                          <Badge variant="warning">{incident.actor_incidents_last_24h} in 24h</Badge>
                        )}
                      </div>
                      <div className="mt-3 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">
                            {incident.actor_name || incident.actor_user_id || "Anonymous"}
                          </p>
                          <p className="text-xs text-muted">
                            {incident.actor_role || "unknown role"}
                            {incident.actor_department ? ` | ${incident.actor_department}` : ""}
                            {incident.channel ? ` | ${incident.channel}` : ""}
                          </p>
                          <p className="mt-2 text-sm text-foreground">{incident.query_excerpt || "No excerpt"}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-muted">{formatDateTime(incident.created_at)}</p>
                          <p className="mt-1 text-xs text-muted">{(incident.reason || "policy").replaceAll("_", " ")}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">No guardrail data available.</p>
            )}
          </Card>
        )}

        {activeTab === "retrieval" && (
          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Top Documents by Retrieval">
              {reporting ? (
                <div className="space-y-2">
                  {(reporting.stats.top_documents || []).map((doc, i) => (
                    <div key={i} className="flex items-center justify-between rounded-[4px] border border-border px-4 py-3">
                      <div>
                        <p className="font-mono text-xs text-primary">{doc.code}</p>
                        <p className="text-sm text-foreground">{doc.title}</p>
                      </div>
                      <Badge variant="success" size="sm">{doc.hits} hits</Badge>
                    </div>
                  ))}
                  {(!reporting.stats.top_documents || reporting.stats.top_documents.length === 0) && (
                    <p className="text-sm text-muted">No retrieval data yet.</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted">No data available.</p>
              )}
            </Card>
            <Card title="Top Search Queries">
              {reporting ? (
                <div className="space-y-2">
                  {(reporting.stats.top_queries || []).map((q, i) => (
                    <div key={i} className="flex items-center justify-between rounded-[4px] border border-border px-4 py-3">
                      <p className="text-sm text-foreground">{q.query}</p>
                      <Badge variant="default" size="sm">{q.count}x</Badge>
                    </div>
                  ))}
                  {(!reporting.stats.top_queries || reporting.stats.top_queries.length === 0) && (
                    <p className="text-sm text-muted">No query data yet.</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted">No data available.</p>
              )}
            </Card>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}