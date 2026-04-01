"use client";

import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  error?: string;
}

export function Input({
  icon,
  rightIcon,
  error,
  className = "",
  ...props
}: InputProps) {
  return (
    <div className="relative">
      {icon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
          {icon}
        </div>
      )}
      <input
        className={`w-full rounded-[12px] border border-border bg-white py-2.5 text-sm text-foreground transition-colors
          focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10
          ${icon ? "pl-10" : "pl-4"} ${rightIcon ? "pr-10" : "pr-4"}
          ${error ? "border-danger" : ""}
          ${className}`}
        {...props}
      />
      {rightIcon && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
          {rightIcon}
        </div>
      )}
      {error && <p className="text-danger text-xs mt-1">{error}</p>}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
  icon?: React.ReactNode;
}

export function Select({
  options,
  icon,
  className = "",
  ...props
}: SelectProps) {
  return (
    <div className="relative">
      {icon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
          {icon}
        </div>
      )}
      <select
        className={`w-full appearance-none rounded-[12px] border border-border bg-white py-2.5 text-sm text-foreground transition-colors
          focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10
          ${icon ? "pl-10" : "pl-4"} pr-10 appearance-none cursor-pointer
          ${className}`}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted">
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>
    </div>
  );
}
