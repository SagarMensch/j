'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/admin/admin-layout';
import { Card, KpiCard } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { DocumentStackIcon, UsersClusterIcon, AnalyticsBarsIcon, LookupNodesIcon } from '@/components/ui/icons';

type DashboardSummary = {
  stats: {
    mandatory_completion_rate: number;
    mandatory_total: number;
    mandatory_completed: number;
    in_progress: number;
    overdue: number;
  };
  recent_sops: {
    code: string;
    title: string;
    document_type: string;
    revision_label: string;
    page_count: number;
    updated_at: string;
  }[];
  safety_alerts: {
    document_code: string;
    document_title: string;
    page_start: number | null;
    citation_label: string | null;
    alert_text: string;
    severity: string;
  }[];
};

type RetrievalStatus = {
  postgres?: {
    documents?: number;
    embedded_chunks?: number;
    retrieval_events?: number;
  };
};

type UsersPayload = {
  users: {
    id: string;
    full_name: string;
    role: string;
    department: string | null;
    mandatory_completion_rate: number;
    active_certifications: number;
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

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function AdminHome() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [retrievalStatus, setRetrievalStatus] = useState<RetrievalStatus | null>(null);
  const [users, setUsers] = useState<UsersPayload['users']>([]);
  const [incidents, setIncidents] = useState<GuardrailIncidentsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function loadSummary() {
      try {
        const [dashboardResponse, retrievalResponse, usersResponse, incidentsResponse] = await Promise.all([
          apiClient.get(`/api/dashboard/summary?user_id=${user.id}`),
          apiClient.get('/api/retrieval/status'),
          apiClient.get('/api/users'),
          apiClient.get(`/api/admin/guardrail/incidents?user_id=${user.id}&limit=8`),
        ]);

        if (!isMounted) return;

        setDashboard(dashboardResponse as DashboardSummary);
        setRetrievalStatus(retrievalResponse as RetrievalStatus);
        setUsers((usersResponse as UsersPayload).users || []);
        setIncidents(incidentsResponse as GuardrailIncidentsPayload);
        setError('');
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load admin summary.');
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadSummary();
    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  const readyOperators = useMemo(
    () => users.filter((item) => item.role === 'operator' && Number(item.mandatory_completion_rate || 0) >= 100).length,
    [users],
  );
  const highSeverityIncidents = Number(incidents?.summary.counts_by_severity?.high || 0);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="hero-panel p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Executive Summary</p>
              <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-foreground">Operational readiness at a glance</h1>
              <p className="mt-2 text-sm text-muted">
                Document coverage, workforce completion, and grounded usage signals from the live system.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="success">Approved Sources Active</Badge>
              <Badge variant="info">Retrieval Monitoring Live</Badge>
            </div>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <div className="py-12 text-center text-muted">
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <p>Loading admin summary...</p>
            </div>
          </Card>
        ) : error ? (
          <Card>
            <div className="py-6 text-center">
              <p className="font-medium text-danger">{error}</p>
            </div>
          </Card>
        ) : dashboard ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                title="Mandatory Completion"
                value={`${Math.round(dashboard.stats.mandatory_completion_rate || 0)}%`}
                subtitle={`${dashboard.stats.mandatory_completed} of ${dashboard.stats.mandatory_total} modules`}
                color="text-primary"
              />
              <KpiCard
                title="Approved Documents"
                value={retrievalStatus?.postgres?.documents || 0}
                subtitle={`${retrievalStatus?.postgres?.embedded_chunks || 0} embedded chunks`}
                color="text-foreground"
              />
              <KpiCard
                title="Operators Ready"
                value={readyOperators}
                subtitle={`${users.filter((item) => item.role === 'operator').length} operators in system`}
                color="text-primary"
              />
              <KpiCard
                title="Retrieval Events"
                value={retrievalStatus?.postgres?.retrieval_events || 0}
                subtitle={`${dashboard.stats.in_progress} modules in progress`}
                color="text-secondary"
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <Card title="Guardrail Command Center">
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Recent incidents</p>
                      <p className="mt-2 text-2xl font-bold text-danger">{incidents?.summary.total || 0}</p>
                    </div>
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">High severity</p>
                      <p className="mt-2 text-2xl font-bold text-danger">{highSeverityIncidents}</p>
                    </div>
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Unique actors</p>
                      <p className="mt-2 text-2xl font-bold text-foreground">{incidents?.summary.unique_actor_count || 0}</p>
                    </div>
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">First-time actors</p>
                      <p className="mt-2 text-2xl font-bold text-secondary">{incidents?.summary.first_time_actor_count || 0}</p>
                    </div>
                  </div>

                  {(incidents?.incidents || []).length === 0 ? (
                    <div className="rounded-[4px] border border-dashed border-border px-4 py-6 text-sm text-muted">
                      No blocked unsafe or abusive requests have been recorded yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(incidents?.incidents || []).slice(0, 4).map((incident) => (
                        <div key={incident.incident_id} className="rounded-[4px] border border-border px-4 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={incident.severity === 'high' ? 'danger' : 'warning'}>
                              {incident.severity}
                            </Badge>
                            <Badge variant="default">{incident.category}</Badge>
                            {incident.is_first_incident_for_actor ? (
                              <Badge variant="success">First time</Badge>
                            ) : (
                              <Badge variant="info">
                                Repeat #{incident.actor_incident_count || 2}
                              </Badge>
                            )}
                            {incident.actor_incidents_last_24h && incident.actor_incidents_last_24h > 1 ? (
                              <Badge variant="warning">
                                {incident.actor_incidents_last_24h} in 24h
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground">
                                {incident.actor_name || incident.actor_user_id || 'Anonymous user'}
                              </p>
                              <p className="mt-1 text-xs text-muted">
                                {incident.actor_role || 'unknown role'}
                                {incident.actor_department ? ` | ${incident.actor_department}` : ''}
                                {incident.channel ? ` | ${incident.channel}` : ''}
                              </p>
                              <p className="mt-3 text-sm text-foreground">
                                {incident.query_excerpt || 'No query excerpt recorded.'}
                              </p>
                            </div>
                            <div className="shrink-0 text-left sm:text-right">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Last seen</p>
                              <p className="mt-1 text-xs text-foreground">
                                {formatDateTime(incident.created_at)}
                              </p>
                              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Reason</p>
                              <p className="mt-1 text-xs text-foreground">
                                {(incident.reason || 'policy').replaceAll('_', ' ')}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Link href="/admin/analytics?focus=guardrails" className="tfl-tab tfl-tab-active">
                      <span>Open full guardrail analytics</span>
                    </Link>
                  </div>
                </div>
              </Card>

              <Card title="Quick Navigation">
                <div className="space-y-3">
                  <Link href="/admin/analytics" className="block">
                    <div className="flex items-start gap-3 rounded-[4px] border border-border px-4 py-4 transition-colors hover:border-secondary hover:bg-secondary/5">
                      <AnalyticsBarsIcon className="mt-0.5 text-secondary" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">Analytics Workspace</p>
                        <p className="mt-1 text-xs text-muted">Deep readiness, reporting, and guardrail breakdowns.</p>
                      </div>
                    </div>
                  </Link>
                  <Link href="/admin/graph" className="block">
                    <div className="flex items-start gap-3 rounded-[4px] border border-border px-4 py-4 transition-colors hover:border-secondary hover:bg-secondary/5">
                      <LookupNodesIcon className="mt-0.5 text-primary" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">Knowledge Graph</p>
                        <p className="mt-1 text-xs text-muted">Explore connected SOP entities with live node navigation.</p>
                      </div>
                    </div>
                  </Link>
                  <Link href="/admin/documents" className="block">
                    <div className="flex items-start gap-3 rounded-[4px] border border-border px-4 py-4 transition-colors hover:border-secondary hover:bg-secondary/5">
                      <DocumentStackIcon className="mt-0.5 text-primary" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">Document Control</p>
                        <p className="mt-1 text-xs text-muted">Upload, revise, and validate approved content.</p>
                      </div>
                    </div>
                  </Link>
                  <Link href="/admin/users" className="block">
                    <div className="flex items-start gap-3 rounded-[4px] border border-border px-4 py-4 transition-colors hover:border-secondary hover:bg-secondary/5">
                      <UsersClusterIcon className="mt-0.5 text-foreground" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">User Directory</p>
                        <p className="mt-1 text-xs text-muted">Inspect operator completion and certification status.</p>
                      </div>
                    </div>
                  </Link>
                </div>
              </Card>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <Card title="Workforce Readiness">
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Completed</p>
                      <p className="mt-2 text-2xl font-bold text-primary">{dashboard.stats.mandatory_completed}</p>
                    </div>
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">In Progress</p>
                      <p className="mt-2 text-2xl font-bold text-secondary">{dashboard.stats.in_progress}</p>
                    </div>
                    <div className="rounded-[4px] border border-border bg-muted-light px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Overdue</p>
                      <p className="mt-2 text-2xl font-bold text-danger">{dashboard.stats.overdue}</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {users.slice(0, 5).map((operator) => (
                      <div key={operator.id} className="flex items-center justify-between rounded-[4px] border border-border px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{operator.full_name}</p>
                          <p className="text-xs text-muted">{operator.department || 'Unassigned'} | {operator.role}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-foreground">{Math.round(operator.mandatory_completion_rate || 0)}%</p>
                          <p className="text-xs text-muted">{operator.active_certifications} active certifications</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <Card title="Latest Approved Documents">
                <div className="space-y-3">
                  {dashboard.recent_sops.map((document) => (
                    <div key={`${document.code}-${document.revision_label}`} className="flex items-center justify-between rounded-[4px] border border-border px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{document.title}</p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                          {document.code} | {document.document_type}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge variant="default">{document.revision_label}</Badge>
                        <p className="mt-2 text-xs text-muted">{formatDate(document.updated_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="Safety and Compliance Signals">
                <div className="space-y-3">
                  {dashboard.safety_alerts.length === 0 ? (
                    <p className="text-sm text-muted">No active safety extraction signals were found in the current document set.</p>
                  ) : (
                    dashboard.safety_alerts.map((alert, index) => (
                      <div key={`${alert.document_code}-${index}`} className="rounded-[4px] border border-border px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-foreground">{alert.document_title}</p>
                          <Badge variant={alert.severity === 'critical' || alert.severity === 'high' ? 'danger' : 'warning'}>
                            {alert.severity}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted">{alert.citation_label || alert.document_code}</p>
                        <p className="mt-3 text-sm text-foreground">{alert.alert_text}</p>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>
          </>
        ) : null}
      </div>
    </AdminLayout>
  );
}
