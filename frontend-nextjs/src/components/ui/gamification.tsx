"use client";

import React from "react";
import { ProgressBar } from "@/components/ui/progress";

type ScoreRingProps = {
  value: number;
  title: string;
  subtitle: string;
  size?: number;
};

type XpPanelProps = {
  xp: number;
  level: number;
  streakDays: number;
  badgeLabel: string;
};

type MissionCardProps = {
  title: string;
  subtitle: string;
  progress: number;
  tone?: "primary" | "warning" | "danger";
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function deriveGameProfile(input: {
  completionRate: number;
  inProgress: number;
  overdue: number;
  passed?: number;
  activeCertifications?: number;
}) {
  const completionRate = clamp(Math.round(input.completionRate || 0), 0, 100);
  const inProgress = Math.max(0, Math.round(input.inProgress || 0));
  const overdue = Math.max(0, Math.round(input.overdue || 0));
  const passed = Math.max(0, Math.round(input.passed || 0));
  const activeCertifications = Math.max(
    0,
    Math.round(input.activeCertifications || 0),
  );

  const rawXp =
    completionRate * 8 +
    inProgress * 30 +
    passed * 50 +
    activeCertifications * 40 -
    overdue * 25;
  const xp = Math.max(0, Math.round(rawXp));
  const levelSpan = 250;
  const level = Math.floor(xp / levelSpan) + 1;
  const xpIntoLevel = xp - (level - 1) * levelSpan;
  const levelProgress = clamp(
    Math.round((xpIntoLevel / levelSpan) * 100),
    0,
    100,
  );
  const streakDays = clamp(
    Math.round(completionRate / 14) +
      Math.max(0, inProgress - overdue) +
      passed,
    1,
    30,
  );

  const badgeLabel =
    level >= 8
      ? "Platinum Operator"
      : level >= 5
        ? "Gold Operator"
        : level >= 3
          ? "Silver Operator"
          : "Bronze Operator";

  return {
    xp,
    level,
    levelProgress,
    streakDays,
    badgeLabel,
  };
}

export function ScoreRing({
  value,
  title,
  subtitle,
  size = 96,
}: ScoreRingProps) {
  const safeValue = clamp(Math.round(value), 0, 100);
  const innerSize = Math.round(size * 0.68);
  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0">
        <div
          className="rounded-full"
          style={{
            width: `${size}px`,
            height: `${size}px`,
            background: `conic-gradient(#0019a8 0deg ${safeValue * 2.2}deg, #00782a ${safeValue * 2.2}deg ${safeValue * 3.15}deg, #ffd329 ${safeValue * 3.15}deg ${safeValue * 3.6}deg, #d7dde6 ${safeValue * 3.6}deg 360deg)`,
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 rounded-full border border-border bg-white"
          style={{
            width: `${innerSize}px`,
            height: `${innerSize}px`,
            transform: "translate(-50%, -50%)",
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold text-foreground">
            {safeValue}%
          </span>
        </div>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          {title}
        </p>
        <p className="mt-1 text-sm font-medium text-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

export function XpPanel({ xp, level, streakDays, badgeLabel }: XpPanelProps) {
  const levelSpan = 250;
  const xpIntoLevel = xp - (level - 1) * levelSpan;
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#2640c1] bg-white shadow-[0px_10px_28px_rgba(0,25,168,0.1)]">
      <div className="bg-[#0019a8] px-3 py-3 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/60">
          Performance Tier
        </p>
        <div className="mt-1 flex items-end justify-between">
          <p className="text-2xl font-bold">L{level}</p>
          <p className="text-sm font-semibold text-white/80">{xp} XP</p>
        </div>
      </div>
      <div className="space-y-3 px-3 py-3">
        <ProgressBar
          value={xpIntoLevel}
          max={levelSpan}
          showLabel={false}
          color="bg-accent"
          height="h-2"
        />
        <div className="flex items-center justify-between text-xs text-muted">
          <span className="font-semibold text-foreground">{badgeLabel}</span>
          <span>{streakDays} day streak</span>
        </div>
      </div>
    </div>
  );
}

export function MissionCard({
  title,
  subtitle,
  progress,
  tone = "primary",
}: MissionCardProps) {
  const safeProgress = clamp(Math.round(progress), 0, 100);
  const toneClass =
    tone === "danger"
      ? "bg-danger"
      : tone === "warning"
        ? "bg-warning"
        : "bg-primary";

  return (
    <div className="rounded-[12px] border border-border bg-white p-3 shadow-[0px_8px_20px_rgba(0,25,168,0.04)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted">
        {title}
      </p>
      <p className="mt-1 text-sm text-foreground">{subtitle}</p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-[4px] bg-muted-light">
        <div
          className={`h-full rounded-[4px] transition-all ${toneClass}`}
          style={{ width: `${safeProgress}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] font-semibold text-muted">
        {safeProgress}% complete
      </p>
    </div>
  );
}
