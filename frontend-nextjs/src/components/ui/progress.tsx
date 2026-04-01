"use client";

import React from "react";

interface ProgressBarProps {
  value: number;
  max?: number;
  showLabel?: boolean;
  label?: string;
  color?: string;
  height?: string;
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  showLabel = true,
  label,
  color = "bg-primary",
  height = "h-2",
  className = "",
}: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={`w-full ${className}`}>
      {showLabel && (
        <div className="flex justify-between items-center mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            {label || `${value}% Complete`}
          </span>
          <span className="text-sm font-semibold text-foreground">
            {Math.round(percentage)}%
          </span>
        </div>
      )}
      <div
        className={`w-full overflow-hidden rounded-full bg-muted-light ${height}`}
      >
        <div
          className={`${color} ${height} rounded-full transition-all duration-500 ease-out`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

interface StepProgressProps {
  currentStep: number;
  totalSteps: number;
  steps?: string[];
}

export function StepProgress({
  currentStep,
  totalSteps,
  steps,
}: StepProgressProps) {
  return (
    <div className="w-full">
      <div className="flex items-center gap-1 mb-2">
        {Array.from({ length: totalSteps }).map((_, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <React.Fragment key={index}>
              <div
                className={`h-2 flex-1 rounded-full transition-all ${
                  isCompleted
                    ? "bg-primary"
                    : isCurrent
                      ? "bg-accent"
                      : "bg-muted-light"
                }`}
              />
              {index < totalSteps - 1 && <div className="w-1" />}
            </React.Fragment>
          );
        })}
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        Step {currentStep + 1} of {totalSteps}
      </p>
    </div>
  );
}
