"use client";

import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "secondary"
    | "outline"
    | "ghost"
    | "success"
    | "danger";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  children,
  className = "",
  ...props
}: ButtonProps) {
  const baseStyles =
    "inline-flex items-center justify-center gap-2 rounded-[10px] border font-semibold tracking-[0.01em] transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-secondary/20 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60 shadow-none";

  const variants = {
    primary:
      "border-primary bg-primary text-white hover:border-primary-light hover:bg-primary-light",
    secondary:
      "border-border bg-white text-foreground hover:border-primary/30 hover:bg-[#f7fafe]",
    outline:
      "border-primary/18 bg-white text-primary hover:border-primary hover:bg-primary/5",
    ghost:
      "border-transparent bg-transparent text-muted hover:bg-muted-light hover:text-foreground",
    success:
      "border-accent bg-accent text-white hover:border-[#016824] hover:bg-[#016824]",
    danger:
      "border-danger bg-danger text-white hover:bg-[#b61d1a] hover:border-[#b61d1a]",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-[0.82rem]",
    md: "px-4 py-2.5 text-[0.86rem]",
    lg: "px-5 py-3 text-base",
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
