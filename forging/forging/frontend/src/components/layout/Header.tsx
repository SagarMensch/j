"use client";

import React from "react";

interface HeaderProps {
  title: string;
  subtitle?: string;
  badge?: string;
}

export function Header({ title, subtitle, badge }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-8 py-8 bg-transparent">
      <div className="flex flex-col gap-1.5">
        <h1
          className="text-3xl font-bold leading-tight tracking-tight"
          style={{ color: "#121212" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className="text-xs font-bold uppercase tracking-[0.2em]"
            style={{ color: "#737373" }}
          >
            {subtitle}
          </p>
        )}
      </div>

      {badge && (
        /* TfL line-status style: green pill = "Good Service" */
        <div
          className="flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold text-white shadow-md"
          style={{ backgroundColor: "#00823b" }}
        >
          <span
            className="h-2 w-2 animate-pulse rounded-full bg-white"
            style={{ boxShadow: "0 0 6px rgba(255,255,255,0.8)" }}
          />
          {badge}
        </div>
      )}
    </header>
  );
}
