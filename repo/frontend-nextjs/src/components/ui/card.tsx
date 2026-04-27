"use client";

import React from "react";

interface CardProps {
  title?: string;
  icon?: React.ReactNode;
  headerColor?: string;
  children: React.ReactNode;
  className?: string;
}

export function Card({
  title,
  icon,
  headerColor = "bg-primary",
  children,
  className = "",
}: CardProps) {
  return (
    <div className={`tfl-panel ${className}`}>
      {(title || icon) && (
        <div className="relative border-b border-border/80 bg-[rgba(255,255,255,0.82)] px-4 py-3.5">
          <div className="flex items-center gap-2 text-foreground">
            {icon && (
              <span
                className={`inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-border bg-[#f4f8fc] text-sm ${headerColor.replace("bg-", "text-")}`}
              >
                {icon}
              </span>
            )}
            {title && (
              <h3 className="text-[0.78rem] font-semibold uppercase tracking-[0.12em] text-muted">
                {title}
              </h3>
            )}
          </div>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  color?: string;
}

export function KpiCard({
  title,
  value,
  subtitle,
  trend,
  color = "text-primary",
}: KpiCardProps) {
  return (
    <div className="tfl-panel px-4 py-4">
      <div className="mb-3 flex items-center gap-1">
        <span className="h-1 w-10 rounded-full bg-primary" />
        <span className="h-1 w-7 rounded-full bg-accent" />
        <span className="h-1 w-5 rounded-full bg-warning" />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        {title}
      </p>
      <p className={`mt-2 text-[2rem] font-bold tracking-[-0.03em] ${color}`}>
        {value}
      </p>
      {subtitle && (
        <div className="mt-2 flex items-center gap-1">
          {trend === "up" && <span className="text-primary text-xs">+</span>}
          {trend === "down" && <span className="text-danger text-xs">-</span>}
          <span className="text-xs text-muted">{subtitle}</span>
        </div>
      )}
    </div>
  );
}
