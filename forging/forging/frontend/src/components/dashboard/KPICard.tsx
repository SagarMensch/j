import React from "react";
import { cn } from "@/lib/utils";
import { MaterialSymbol } from "@/components/ui/MaterialSymbol";

interface KPICardProps {
  label: string;
  value: string;
  description: string;
  icon: string;
  color: string;
}

export function KPICard({
  label,
  value,
  description,
  icon,
  color,
}: KPICardProps) {
  const colorVariants: Record<string, string> = {
    blue: "bg-primary/8 text-primary",
    emerald: "bg-accent-green/10 text-accent-green",
    rose: "bg-accent-red/10 text-accent-red",
    indigo: "bg-primary/10 text-primary",
    sky: "bg-primary/8 text-primary",
    teal: "bg-primary/10 text-primary",
  };

  return (
    <div className="pattern-orb bg-white p-7 rounded-[24px] border border-border-color shadow-subtle transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_40px_rgba(18,18,18,0.08)] flex items-start gap-5">
      <div
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-2xl shadow-inner",
          colorVariants[color] || "bg-surface text-primary",
        )}
      >
        <MaterialSymbol icon={icon} className="text-[30px]" />
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] font-black text-muted uppercase tracking-[0.18em] mb-2">
          {label}
        </span>
        <span className="text-4xl font-black text-text-main tracking-[-0.03em] leading-tight mb-2">
          {value}
        </span>
        <span className="text-[11px] text-muted font-bold opacity-80 leading-relaxed uppercase tracking-wide">
          {description}
        </span>
      </div>
    </div>
  );
}
