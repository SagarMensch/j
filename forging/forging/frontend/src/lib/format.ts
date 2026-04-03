import { DuplicateStatus, Verdict } from "@/lib/api-types";

export function formatVerdict(verdict: Verdict) {
  return verdict.replaceAll("_", " ");
}

export function verdictTone(verdict: Verdict) {
  switch (verdict) {
    case "CONFIRMED_FORGERY":
      return {
        chip: "bg-accent-red/10 text-accent-red",
        dot: "bg-accent-red shadow-[0_0_0_4px_rgba(238,42,36,0.12)]",
        accent: "border-accent-red",
      };
    case "SUSPICIOUS":
      return {
        chip: "bg-accent-amber/15 text-[#b45309]",
        dot: "bg-accent-amber shadow-[0_0_0_4px_rgba(255,200,10,0.14)]",
        accent: "border-accent-amber",
      };
    default:
      return {
        chip: "bg-accent-green/10 text-accent-green",
        dot: "bg-accent-green shadow-[0_0_0_4px_rgba(0,130,59,0.12)]",
        accent: "border-accent-green",
      };
  }
}

export function formatDuplicateStatus(status: DuplicateStatus) {
  return status.replaceAll("_", " ");
}

export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function formatMs(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}s`;
  }
  return `${Math.round(value)}ms`;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatRelativeTime(value: string) {
  const date = new Date(value);
  const diffMs = date.getTime() - Date.now();
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  return formatter.format(diffDays, "day");
}
