"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";
import { RatingRadar } from "@/components/operator/rating-radar";

type PerformanceApiResponse = {
  user_id: string;
  total_runs: number;
  completed_runs: number;
  blocked_runs: number;
  completion_rate: number;
  dimensions: { speed: number; quality: number; safety: number; adherence: number };
  overall: number;
  trend: "improving" | "stable" | "declining";
  safety_incidents_90d: number;
  guardrail_blocks_90d: number;
  computed_at: string;
};

type Copy = {
  workspaceTag: string;
  title: string;
  subtitle: string;
  fallbackUser: string;
  loading: string;
  empty: string;
  emptyHint: string;
  overall: string;
  trend: { improving: string; stable: string; declining: string };
  totalRuns: string;
  completionRate: string;
  completed: string;
  blocked: string;
  safety90: string;
  guardrail90: string;
  dimensions: { speed: string; quality: string; safety: string; adherence: string };
  radar: string;
  insights: string;
  highOverall: string;
  midOverall: string;
  lowOverall: string;
};

const COPY: Record<AppLanguage, Copy> = {
  ENG: {
    workspaceTag: "Performance",
    title: "Performance Rating Engine",
    subtitle: "Four-dimension rating (speed, quality, safety, adherence) computed from your real run records and 90-day activity log.",
    fallbackUser: "Operator",
    loading: "Loading performance data...",
    empty: "No runs yet to compute a rating.",
    emptyHint: "Run a guided operation — your ratings will populate automatically.",
    overall: "Overall",
    trend: { improving: "Improving", stable: "Stable", declining: "Declining" },
    totalRuns: "Total runs",
    completionRate: "Completion",
    completed: "Completed",
    blocked: "Blocked / handoff",
    safety90: "Safety events (90d)",
    guardrail90: "Guardrail blocks (90d)",
    dimensions: { speed: "Speed", quality: "Quality", safety: "Safety", adherence: "Adherence" },
    radar: "Rating dimensions",
    insights: "Insights",
    highOverall: "You're operating at a high level. Keep current pace and look for senior tasks to stretch further.",
    midOverall: "Solid foundation. Focus on consistency — bring every run to a clean completion.",
    lowOverall: "Lots of room to grow. Lean on the RunGuide and the quiz refresher on each equipment before going solo.",
  },
  HIN: {
    workspaceTag: "प्रदर्शन",
    title: "प्रदर्शन रेटिंग इंजन",
    subtitle: "चार-आयामी रेटिंग (गति, गुणवत्ता, सुरक्षा, अनुपालन) आपके वास्तविक रन रिकॉर्ड से।",
    fallbackUser: "ऑपरेटर",
    loading: "प्रदर्शन डेटा लोड हो रहा है...",
    empty: "रेटिंग के लिए अभी कोई रन नहीं।",
    emptyHint: "एक निर्देशित संचालन चलाएँ — रेटिंग स्वचालित रूप से भर जाएगी।",
    overall: "समग्र",
    trend: { improving: "सुधार", stable: "स्थिर", declining: "गिरावट" },
    totalRuns: "कुल रन",
    completionRate: "पूर्णता",
    completed: "पूर्ण",
    blocked: "अवरुद्ध",
    safety90: "सुरक्षा घटनाएँ (90 दिन)",
    guardrail90: "गार्डरेल ब्लॉक (90 दिन)",
    dimensions: { speed: "गति", quality: "गुणवत्ता", safety: "सुरक्षा", adherence: "अनुपालन" },
    radar: "रेटिंग आयाम",
    insights: "अंतर्दृष्टि",
    highOverall: "आप उच्च स्तर पर काम कर रहे हैं।",
    midOverall: "अच्छी नींव। पूर्णता पर ध्यान दें।",
    lowOverall: "सुधार के लिए जगह है। रनगाइड और क्विज़ का उपयोग करें।",
  },
  HING: {
    workspaceTag: "Performance",
    title: "Performance Rating Engine",
    subtitle: "4-dimension rating (speed, quality, safety, adherence) — apke real run records se nikala gaya.",
    fallbackUser: "Operator",
    loading: "Performance data load ho raha hai...",
    empty: "Rating compute karne ke liye abhi koi run nahi.",
    emptyHint: "Guided operation chalao — rating khud populate ho jayegi.",
    overall: "Overall",
    trend: { improving: "Improving", stable: "Stable", declining: "Declining" },
    totalRuns: "Total runs",
    completionRate: "Completion",
    completed: "Completed",
    blocked: "Blocked / handoff",
    safety90: "Safety events (90d)",
    guardrail90: "Guardrail blocks (90d)",
    dimensions: { speed: "Speed", quality: "Quality", safety: "Safety", adherence: "Adherence" },
    radar: "Rating dimensions",
    insights: "Insights",
    highOverall: "Tu high level pe operate kar raha hai. Pace maintain rakh aur senior tasks try kar.",
    midOverall: "Solid foundation. Consistency pe focus kar — har run ko clean completion tak le jaa.",
    lowOverall: "Bahut jagah hai growth ke liye. RunGuide aur quiz refresher use kar before going solo.",
  },
};

function trendColor(t: PerformanceApiResponse["trend"]): string {
  if (t === "improving") return "text-[#00782a]";
  if (t === "declining") return "text-danger";
  return "text-muted";
}

function dimensionColor(v: number): string {
  if (v >= 0.8) return "text-[#00782a]";
  if (v >= 0.5) return "text-[#a06800]";
  return "text-danger";
}

export default function PerformancePage() {
  const { user, language } = useAuth();
  const copy = COPY[language];
  const [data, setData] = useState<PerformanceApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }
    let isMounted = true;
    async function load() {
      try {
        const payload = (await apiClient.get(
          `/api/worker/performance?user_id=${encodeURIComponent(user.id)}`,
        )) as PerformanceApiResponse;
        if (!isMounted) return;
        setData(payload);
        setError("");
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Failed to load performance.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    void load();
    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  const axes = useMemo(() => {
    if (!data) return [];
    return [
      { label: copy.dimensions.speed, value: data.dimensions.speed },
      { label: copy.dimensions.quality, value: data.dimensions.quality },
      { label: copy.dimensions.safety, value: data.dimensions.safety },
      { label: copy.dimensions.adherence, value: data.dimensions.adherence },
    ];
  }, [data, copy.dimensions]);

  const insight = useMemo(() => {
    if (!data) return "";
    if (data.overall >= 0.8) return copy.highOverall;
    if (data.overall >= 0.5) return copy.midOverall;
    return copy.lowOverall;
  }, [data, copy]);

  return (
    <OperatorLayout>
      <div className="mx-auto max-w-[1520px] px-4 py-6 space-y-6">
        <div className="hero-panel p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{copy.workspaceTag}</p>
              <h1 className="mt-2 text-2xl font-bold text-foreground">{copy.title}</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted">{copy.subtitle}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Operator</p>
              <p className="mt-1 font-semibold text-foreground">{user?.name || copy.fallbackUser}</p>
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
            <p className="py-4 text-sm text-danger">{error}</p>
          </Card>
        ) : !data || data.total_runs === 0 ? (
          <Card>
            <div className="py-8 text-center">
              <p className="text-sm font-semibold text-foreground">{copy.empty}</p>
              <p className="mt-1 text-xs text-muted">{copy.emptyHint}</p>
            </div>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.overall}</p>
                <p className={`mt-2 text-4xl font-bold ${dimensionColor(data.overall)}`}>{Math.round(data.overall * 100)}%</p>
                <p className={`mt-1 text-xs font-semibold uppercase tracking-[0.1em] ${trendColor(data.trend)}`}>
                  {copy.trend[data.trend]}
                </p>
              </Card>
              <Card>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.totalRuns}</p>
                <p className="mt-2 text-4xl font-bold text-foreground">{data.total_runs}</p>
                <p className="mt-1 text-xs text-muted">{copy.completionRate}: {Math.round(data.completion_rate * 100)}%</p>
              </Card>
              <Card>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.safety90}</p>
                <p className={`mt-2 text-4xl font-bold ${data.safety_incidents_90d === 0 ? "text-[#00782a]" : "text-danger"}`}>{data.safety_incidents_90d}</p>
                <p className="mt-1 text-xs text-muted">{copy.guardrail90}: {data.guardrail_blocks_90d}</p>
              </Card>
              <Card>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.blocked}</p>
                <p className="mt-2 text-4xl font-bold text-foreground">{data.blocked_runs}</p>
                <p className="mt-1 text-xs text-muted">{copy.completed}: {data.completed_runs}</p>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
              <Card>
                <RatingRadar axes={axes} title={copy.radar} />
              </Card>
              <Card title={copy.insights}>
                <p className="text-sm leading-relaxed text-foreground">{insight}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {axes.map((ax) => (
                    <div key={ax.label} className="rounded-[12px] border border-border bg-[#f8fbfa] px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted">{ax.label}</span>
                        <span className={`text-sm font-bold ${dimensionColor(ax.value)}`}>{Math.round(ax.value * 100)}%</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted-light">
                        <div
                          className={`h-full rounded-full ${ax.value >= 0.8 ? "bg-[#00782a]" : ax.value >= 0.5 ? "bg-[#ffd329]" : "bg-danger"}`}
                          style={{ width: `${Math.round(ax.value * 100)}%`, transition: "width 600ms ease-out" }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </OperatorLayout>
  );
}
