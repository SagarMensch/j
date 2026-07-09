"use client";

import React, { useEffect, useRef, useState } from "react";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";

type ActiveRun = {
  run_id: string;
  equipment: string;
  task: string;
  current_phase: string;
  current_step: number;
  status: string;
  started_at: string | null;
};

type Operator = {
  operator_id: string;
  operator_name: string;
  operator_role: string;
  active_runs: ActiveRun[];
  risk_score: number;
  risk_factors: string[];
  open_handoffs: number;
};

type Handoff = {
  handoff_id: string;
  operator_id: string;
  operator_name: string;
  equipment: string;
  task: string;
  reason: string;
  severity: string;
  created_at: string | null;
};

type Activity = {
  activity_id: string;
  operator_id: string;
  operator_name: string;
  event_type: string;
  severity: string;
  title: string;
  created_at: string | null;
};

type ShiftStatus = {
  supervisor_id: string;
  active_operator_count: number;
  active_run_count: number;
  open_handoff_count: number;
  operators: Operator[];
  open_handoffs: Handoff[];
  recent_activity: Activity[];
  computed_at: string;
};

type Copy = {
  workspaceTag: string;
  title: string;
  subtitle: string;
  loading: string;
  error: string;
  live: string;
  refresh: string;
  refreshIn: (s: number) => string;
  activeOps: string;
  activeRuns: string;
  openHandoffs: string;
  opsByRisk: string;
  openHandoffsLane: string;
  recentActivity: string;
  risk: (v: number) => string;
  noOperators: string;
  noHandoffs: string;
  noActivity: string;
  factors: string;
  since: string;
  view: string;
};

const COPY: Record<AppLanguage, Copy> = {
  ENG: {
    workspaceTag: "Bridge",
    title: "Supervisor Bridge",
    subtitle: "Live shift status — every active operator, every open handoff, every recent incident.",
    loading: "Loading shift status...",
    error: "Failed to load shift status.",
    live: "Live",
    refresh: "Refresh",
    refreshIn: (s) => `Auto-refresh in ${s}s`,
    activeOps: "Active operators",
    activeRuns: "Active runs",
    openHandoffs: "Open handoffs",
    opsByRisk: "Operators by risk",
    openHandoffsLane: "Open handoffs",
    recentActivity: "Recent activity (2h)",
    risk: (v) => `Risk ${Math.round(v * 100)}%`,
    noOperators: "No active operators right now.",
    noHandoffs: "No open handoffs.",
    noActivity: "No recent activity.",
    factors: "Factors",
    since: "Started",
    view: "View",
  },
  HIN: {
    workspaceTag: "सेतु",
    title: "पर्यवेक्षक सेतु",
    subtitle: "लाइव शिफ्ट स्थिति — हर सक्रिय ऑपरेटर, हर खुला हैंडऑफ, हर हाल की घटना।",
    loading: "शिफ्ट स्थिति लोड हो रही है...",
    error: "शिफ्ट स्थिति लोड करने में विफल।",
    live: "लाइव",
    refresh: "ताज़ा करें",
    refreshIn: (s) => `${s} सेकंड में ऑटो-रिफ्रेश`,
    activeOps: "सक्रिय ऑपरेटर",
    activeRuns: "सक्रिय रन",
    openHandoffs: "खुले हैंडऑफ",
    opsByRisk: "जोखिम के अनुसार ऑपरेटर",
    openHandoffsLane: "खुले हैंडऑफ",
    recentActivity: "हाल की गतिविधि (2 घंटे)",
    risk: (v) => `जोखिम ${Math.round(v * 100)}%`,
    noOperators: "अभी कोई सक्रिय ऑपरेटर नहीं।",
    noHandoffs: "कोई खुला हैंडऑफ नहीं।",
    noActivity: "कोई हाल की गतिविधि नहीं।",
    factors: "कारक",
    since: "शुरू",
    view: "देखें",
  },
  HING: {
    workspaceTag: "Bridge",
    title: "Supervisor Bridge",
    subtitle: "Live shift status — har active operator, har open handoff, har recent incident.",
    loading: "Shift status load ho rahi hai...",
    error: "Shift status load nahi hua.",
    live: "Live",
    refresh: "Refresh",
    refreshIn: (s) => `${s}s me auto-refresh`,
    activeOps: "Active operators",
    activeRuns: "Active runs",
    openHandoffs: "Open handoffs",
    opsByRisk: "Risk ke hisaab se operators",
    openHandoffsLane: "Open handoffs",
    recentActivity: "Recent activity (2h)",
    risk: (v) => `Risk ${Math.round(v * 100)}%`,
    noOperators: "Abhi koi active operator nahi.",
    noHandoffs: "Koi open handoff nahi.",
    noActivity: "Koi recent activity nahi.",
    factors: "Factors",
    since: "Started",
    view: "View",
  },
};

function riskBg(v: number): string {
  if (v >= 0.75) return "bg-danger text-white";
  if (v >= 0.5) return "bg-[#f4a623] text-white";
  if (v >= 0.25) return "bg-[#ffd329] text-[#1a1a1a]";
  return "bg-[#00782a] text-white";
}

function severityColor(sev: string): string {
  if (sev === "high" || sev === "critical") return "bg-danger";
  if (sev === "medium") return "bg-[#f4a623]";
  return "bg-accent";
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  try {
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m ago`;
  } catch {
    return "—";
  }
}

export default function SupervisorPage() {
  const { user, language } = useAuth();
  const copy = COPY[language];
  const [data, setData] = useState<ShiftStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(20);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchStatus() {
    if (!user?.id) return;
    try {
      const payload = (await apiClient.get(
        `/api/supervisor/shift-status?user_id=${encodeURIComponent(user.id)}`,
      )) as ShiftStatus;
      setData(payload);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.error);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }
    void fetchStatus();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          void fetchStatus();
          return 20;
        }
        return c - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <OperatorLayout>
      <div className="mx-auto max-w-[1520px] px-4 py-6 space-y-6">
        <div className="hero-panel p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{copy.workspaceTag}</p>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dc241f]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-danger">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
                  {copy.live}
                </span>
              </div>
              <h1 className="mt-2 text-2xl font-bold text-foreground">{copy.title}</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted">{copy.subtitle}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => {
                  setCountdown(20);
                  void fetchStatus();
                }}
                className="rounded-[10px] border border-border bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary transition-colors hover:border-primary/30 hover:bg-primary/5"
              >
                {copy.refresh}
              </button>
              <p className="text-[10px] text-muted">{copy.refreshIn(countdown)}</p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <div className="flex items-center gap-3 py-4 text-sm text-muted">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              {copy.loading}
            </div>
          </Card>
        ) : error ? (
          <Card>
            <p className="py-2 text-sm text-danger">{error}</p>
          </Card>
        ) : !data ? null : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.activeOps}</p>
                <p className="mt-2 text-4xl font-bold text-foreground">{data.active_operator_count}</p>
              </Card>
              <Card>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.activeRuns}</p>
                <p className="mt-2 text-4xl font-bold text-foreground">{data.active_run_count}</p>
              </Card>
              <Card>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.openHandoffs}</p>
                <p className={`mt-2 text-4xl font-bold ${data.open_handoff_count > 0 ? "text-danger" : "text-[#00782a]"}`}>{data.open_handoff_count}</p>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <Card title={copy.opsByRisk}>
                {data.operators.length === 0 ? (
                  <p className="py-2 text-sm text-muted">{copy.noOperators}</p>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {data.operators.map((op) => (
                      <li key={op.operator_id} className="py-3">
                        <div className="flex items-start gap-3">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${riskBg(op.risk_score)}`}>
                            {op.operator_name?.split(" ").map((n) => n[0]).slice(0, 2).join("") || "?"}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-semibold text-foreground">{op.operator_name}</p>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${riskBg(op.risk_score)}`}>
                                {copy.risk(op.risk_score)}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-muted">{op.operator_role}</p>
                            <div className="mt-2 space-y-1.5">
                              {op.active_runs.map((r) => (
                                <div key={r.run_id} className="rounded-[10px] border border-border bg-[#f8fbfa] px-3 py-2">
                                  <p className="text-xs font-semibold text-foreground">{r.equipment} — {r.task}</p>
                                  <p className="mt-0.5 text-[10px] text-muted">
                                    {r.current_phase} • step {r.current_step} • {r.status} • {timeAgo(r.started_at)}
                                  </p>
                                </div>
                              ))}
                            </div>
                            {op.risk_factors.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {op.risk_factors.map((f) => (
                                  <span key={f} className="rounded-full border border-danger/30 bg-danger/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-danger">
                                    {copy.factors}: {f}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <div className="space-y-4">
                <Card title={copy.openHandoffsLane}>
                  {data.open_handoffs.length === 0 ? (
                    <p className="py-2 text-sm text-muted">{copy.noHandoffs}</p>
                  ) : (
                    <ul className="space-y-2">
                      {data.open_handoffs.map((h) => (
                        <li key={h.handoff_id} className="rounded-[10px] border border-border bg-white px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${severityColor(h.severity)}`} />
                            <p className="text-xs font-semibold text-foreground">{h.operator_name} • {h.equipment}</p>
                          </div>
                          <p className="mt-1 text-[10px] text-muted">{h.task} — {h.reason}</p>
                          <p className="mt-1 text-[10px] text-muted">{timeAgo(h.created_at)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card title={copy.recentActivity}>
                  {data.recent_activity.length === 0 ? (
                    <p className="py-2 text-sm text-muted">{copy.noActivity}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {data.recent_activity.map((a) => (
                        <li key={a.activity_id} className="flex items-start gap-2 py-1.5">
                          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${severityColor(a.severity)}`} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-foreground">{a.title}</p>
                            <p className="text-[10px] text-muted">{a.operator_name} • {a.event_type} • {timeAgo(a.created_at)}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
    </OperatorLayout>
  );
}
