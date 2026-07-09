"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";
import { SkillBadge, SkillBar, SkillLevel } from "@/components/operator/skill-badge";

type SkillsApiResponse = {
  user_id: string;
  skills: Array<{
    equipment: string;
    level: SkillLevel;
    total_runs: number;
    completed_runs: number;
    blocked_runs: number;
    supervisor_needed: number;
    success_rate: number;
    max_step_reached: number | null;
    avg_step_reached: number;
    last_completed_at: string | null;
    first_run_at: string | null;
    needs_practice: boolean;
  }>;
  skill_tags: string[];
  interaction_count: number;
  last_equipment: string | null;
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
  totalEquipment: string;
  mastered: string;
  proficient: string;
  learning: string;
  novice: string;
  needsPractice: string;
  skillTags: string;
  interactions: string;
  lastUsed: string;
  neverUsed: string;
  successRate: string;
  totalRuns: string;
  completedRuns: string;
  blockedRuns: string;
  avgStep: string;
  nextLevel: (level: string) => string;
  tableHeaders: {
    equipment: string;
    level: string;
    progress: string;
    runs: string;
    success: string;
    blocked: string;
    lastUsed: string;
  };
};

const COPY: Record<AppLanguage, Copy> = {
  ENG: {
    workspaceTag: "Skills",
    title: "Worker Skills Matrix",
    subtitle: "Per-equipment proficiency derived from your real run history, blocked runs, and supervisor handoffs.",
    fallbackUser: "Operator",
    loading: "Loading skills matrix...",
    empty: "No equipment runs recorded yet.",
    emptyHint: "Run a guided operation to start building your skill profile.",
    totalEquipment: "Equipment touched",
    mastered: "Mastered",
    proficient: "Proficient",
    learning: "Learning",
    novice: "Novice",
    needsPractice: "Needs practice",
    skillTags: "Skill tags",
    interactions: "Total interactions",
    lastUsed: "Last used",
    neverUsed: "Never used",
    successRate: "Success",
    totalRuns: "Runs",
    completedRuns: "Completed",
    blockedRuns: "Blocked",
    avgStep: "Avg step",
    nextLevel: (level) => `Stuck at ${level}? Pick a refresher quiz to push to the next level.`,
    tableHeaders: {
      equipment: "Equipment",
      level: "Level",
      progress: "Progress",
      runs: "Runs",
      success: "Success",
      blocked: "Blocked",
      lastUsed: "Last used",
    },
  },
  HIN: {
    workspaceTag: "कौशल",
    title: "कर्मचारी कौशल मैट्रिक्स",
    subtitle: "आपके वास्तविक रन इतिहास से प्रति-उपकरण दक्षता।",
    fallbackUser: "ऑपरेटर",
    loading: "कौशल मैट्रिक्स लोड हो रहा है...",
    empty: "अभी कोई उपकरण रन नहीं है।",
    emptyHint: "अपनी कौशल प्रोफ़ाइल बनाने के लिए एक निर्देशित संचालन चलाएँ।",
    totalEquipment: "छुआ गया उपकरण",
    mastered: "महारत",
    proficient: "निपुण",
    learning: "सीख रहे",
    novice: "नौसिखिया",
    needsPractice: "अभ्यास चाहिए",
    skillTags: "कौशल टैग",
    interactions: "कुल इंटरैक्शन",
    lastUsed: "अंतिम उपयोग",
    neverUsed: "कभी नहीं",
    successRate: "सफलता",
    totalRuns: "रन",
    completedRuns: "पूर्ण",
    blockedRuns: "अवरुद्ध",
    avgStep: "औसत चरण",
    nextLevel: (level) => `${level} पर अटके हैं? अगले स्तर पर जाने के लिए रिफ्रेशर क्विज़ चुनें।`,
    tableHeaders: {
      equipment: "उपकरण",
      level: "स्तर",
      progress: "प्रगति",
      runs: "रन",
      success: "सफलता",
      blocked: "अवरुद्ध",
      lastUsed: "अंतिम बार",
    },
  },
  HING: {
    workspaceTag: "Skills",
    title: "Worker Skills Matrix",
    subtitle: "Apke real run history se per-equipment proficiency. Koi hardcoded nahi, koi mock nahi.",
    fallbackUser: "Operator",
    loading: "Skills matrix load ho rahi hai...",
    empty: "Abhi tak koi equipment run nahi hai.",
    emptyHint: "Skill profile build karne ke liye ek guided operation chalao.",
    totalEquipment: "Equipment touched",
    mastered: "Mastered",
    proficient: "Proficient",
    learning: "Learning",
    novice: "Novice",
    needsPractice: "Practice chahiye",
    skillTags: "Skill tags",
    interactions: "Total interactions",
    lastUsed: "Last used",
    neverUsed: "Kabhi nahi",
    successRate: "Success",
    totalRuns: "Runs",
    completedRuns: "Completed",
    blockedRuns: "Blocked",
    avgStep: "Avg step",
    nextLevel: (level) => `${level} pe atke ho? Next level pe jaane ke liye refresher quiz lo.`,
    tableHeaders: {
      equipment: "Equipment",
      level: "Level",
      progress: "Progress",
      runs: "Runs",
      success: "Success",
      blocked: "Blocked",
      lastUsed: "Last used",
    },
  },
};

function formatDate(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return fallback;
  }
}

export default function SkillsPage() {
  const { user, language } = useAuth();
  const copy = COPY[language];
  const [data, setData] = useState<SkillsApiResponse | null>(null);
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
        const payload = (await apiClient.get(`/api/worker/skills?user_id=${encodeURIComponent(user.id)}`)) as SkillsApiResponse;
        if (!isMounted) return;
        setData(payload);
        setError("");
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Failed to load skills.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    void load();
    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  const levelCounts = useMemo(() => {
    const counts = { mastered: 0, proficient: 0, learning: 0, novice: 0, untrained: 0 };
    (data?.skills || []).forEach((s) => {
      if (s.level in counts) counts[s.level as keyof typeof counts] += 1;
    });
    return counts;
  }, [data]);

  const totalRuns = useMemo(
    () => (data?.skills || []).reduce((sum, s) => sum + s.total_runs, 0),
    [data],
  );

  const needsPractice = useMemo(
    () => (data?.skills || []).filter((s) => s.needs_practice),
    [data],
  );

  const stuckLevel = useMemo(() => {
    const stuck = (data?.skills || []).find((s) => s.needs_practice);
    return stuck?.level;
  }, [data]);

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
              <p className="mt-0.5 text-xs text-muted">{totalRuns} {copy.totalRuns.toLowerCase()} • {data?.skills.length ?? 0} {copy.totalEquipment.toLowerCase()}</p>
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
        ) : !data || data.skills.length === 0 ? (
          <Card>
            <div className="py-8 text-center">
              <p className="text-sm font-semibold text-foreground">{copy.empty}</p>
              <p className="mt-1 text-xs text-muted">{copy.emptyHint}</p>
            </div>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {(["mastered", "proficient", "learning", "novice", "untrained"] as SkillLevel[]).map((lvl) => (
                <Card key={lvl} className="text-center">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                    {copy[lvl]}
                  </p>
                  <p className="mt-2 text-3xl font-bold text-foreground">{levelCounts[lvl]}</p>
                  <div className="mt-3 flex justify-center">
                    <SkillBadge level={lvl} size="sm" />
                  </div>
                </Card>
              ))}
            </div>

            {(data.skill_tags.length > 0 || data.interaction_count > 0 || data.last_equipment) && (
              <Card>
                <div className="grid gap-3 text-sm md:grid-cols-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.skillTags}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {data.skill_tags.length === 0 ? (
                        <span className="text-xs text-muted">—</span>
                      ) : (
                        data.skill_tags.map((t) => (
                          <span key={t} className="rounded-full border border-border bg-muted-light px-2.5 py-0.5 text-[11px] font-semibold text-foreground">
                            {t}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.interactions}</p>
                    <p className="mt-2 text-2xl font-bold text-foreground">{data.interaction_count}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.lastUsed}</p>
                    <p className="mt-2 text-sm font-semibold text-foreground">{data.last_equipment || copy.neverUsed}</p>
                  </div>
                </div>
              </Card>
            )}

            {needsPractice.length > 0 && stuckLevel && (
              <div className="rounded-[14px] border border-[#f4a623]/30 bg-[#fff8e8] px-4 py-3 text-sm text-[#7a4f00]">
                {copy.nextLevel(stuckLevel)}
              </div>
            )}

            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                      <th className="px-3 py-2">{copy.tableHeaders.equipment}</th>
                      <th className="px-3 py-2">{copy.tableHeaders.level}</th>
                      <th className="px-3 py-2">{copy.tableHeaders.progress}</th>
                      <th className="px-3 py-2 text-right">{copy.tableHeaders.runs}</th>
                      <th className="px-3 py-2 text-right">{copy.tableHeaders.success}</th>
                      <th className="px-3 py-2 text-right">{copy.tableHeaders.blocked}</th>
                      <th className="px-3 py-2 text-right">{copy.tableHeaders.lastUsed}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.skills.map((row) => (
                      <tr key={row.equipment} className="border-b border-border/50 last:border-b-0">
                        <td className="px-3 py-3 font-semibold text-foreground">{row.equipment}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <SkillBadge level={row.level} size="sm" />
                            {row.needs_practice ? (
                              <span className="rounded-full border border-[#f4a623]/40 bg-[#fff4dd] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#7a4f00]">
                                {copy.needsPractice}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-3 w-[180px]">
                          <SkillBar level={row.level} />
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-foreground">{row.total_runs}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <span className={row.success_rate >= 0.8 ? "text-[#00782a] font-semibold" : row.success_rate >= 0.5 ? "text-[#a06800] font-semibold" : "text-danger font-semibold"}>
                            {Math.round(row.success_rate * 100)}%
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-foreground">{row.blocked_runs}</td>
                        <td className="px-3 py-3 text-right text-xs text-muted">{formatDate(row.last_completed_at, copy.neverUsed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </OperatorLayout>
  );
}
