"use client";

import React from "react";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "info";
  size?: "sm" | "md";
  className?: string;
}

export function Badge({
  children,
  variant = "default",
  size = "sm",
  className = "",
}: BadgeProps) {
  const variants = {
    default: "border border-border bg-white text-muted",
    success: "border border-accent/20 bg-accent-light text-accent",
    warning: "border border-warning/30 bg-warning-light text-[#6b5200]",
    danger: "border border-danger/18 bg-danger-light text-danger",
    info: "border border-primary/18 bg-primary/8 text-primary",
  };

  const sizes = {
    sm: "px-2.5 py-1 text-[11px] uppercase tracking-[0.12em]",
    md: "px-3 py-1.5 text-xs uppercase tracking-[0.12em]",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </span>
  );
}
