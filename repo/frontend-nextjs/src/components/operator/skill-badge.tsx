"use client";

import React from "react";

export type SkillLevel = "mastered" | "proficient" | "learning" | "novice" | "untrained";

const LEVEL_STYLES: Record<SkillLevel, { bg: string; fg: string; ring: string; label: string; pct: number }> = {
  mastered:    { bg: "bg-[#00782a]", fg: "text-white",   ring: "ring-[#00782a]/30", label: "Mastered",    pct: 100 },
  proficient:  { bg: "bg-[#0019a8]", fg: "text-white",   ring: "ring-[#0019a8]/30", label: "Proficient",  pct: 80 },
  learning:    { bg: "bg-[#ffd329]", fg: "text-[#1a1a1a]", ring: "ring-[#ffd329]/40", label: "Learning",    pct: 55 },
  novice:      { bg: "bg-[#f4a623]", fg: "text-white",   ring: "ring-[#f4a623]/30", label: "Novice",      pct: 25 },
  untrained:   { bg: "bg-muted",     fg: "text-foreground", ring: "ring-border",   label: "Untrained",   pct: 5 },
};

type Props = {
  level: SkillLevel;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
};

export function SkillBadge({ level, size = "md", showLabel = true }: Props) {
  const style = LEVEL_STYLES[level] ?? LEVEL_STYLES.untrained;
  const padding = size === "sm" ? "px-2 py-0.5 text-[10px]" : size === "lg" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-[0.08em] ring-1 ${style.bg} ${style.fg} ${style.ring} ${padding}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
      {showLabel ? style.label : null}
    </span>
  );
}

type BarProps = {
  level: SkillLevel;
  height?: number;
  showLabel?: boolean;
};

export function SkillBar({ level, height = 8, showLabel = false }: BarProps) {
  const style = LEVEL_STYLES[level] ?? LEVEL_STYLES.untrained;

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 overflow-hidden rounded-full bg-muted-light" style={{ height }}>
        <div
          className={`h-full rounded-full ${style.bg}`}
          style={{ width: `${style.pct}%`, transition: "width 600ms ease-out" }}
        />
      </div>
      {showLabel ? <span className="text-[10px] font-semibold text-muted">{style.label}</span> : null}
    </div>
  );
}
