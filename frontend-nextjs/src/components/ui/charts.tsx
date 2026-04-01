"use client";

import React from "react";

interface DonutChartProps {
  value: number;
  label: string;
  size?: number;
  strokeWidth?: number;
  color?: string;
}

export function DonutChart({
  value,
  label,
  size = 180,
  strokeWidth = 14,
  color = "#0019a8",
}: DonutChartProps) {
  const clampedValue = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (clampedValue / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90 transform">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#d6deea"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="square"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-foreground">
            {Math.round(clampedValue)}%
          </span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}

interface BarChartProps {
  data: {
    label: string;
    values: number[];
    colors: string[];
    percentage: number;
  }[];
  maxValue?: number;
}

export function BarChart({ data, maxValue = 100 }: BarChartProps) {
  return (
    <div className="space-y-4">
      {data.map((item, index) => (
        <div key={index} className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium text-foreground">{item.label}</span>
            <span className="text-muted">{item.percentage}%</span>
          </div>
          <div className="flex h-4 overflow-hidden rounded-[4px] bg-muted-light">
            {item.values.map((value, valueIndex) => (
              <div
                key={valueIndex}
                className="h-full transition-all"
                style={{
                  width: `${(value / maxValue) * 100}%`,
                  backgroundColor: item.colors[valueIndex],
                }}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="mt-4 flex gap-4 text-[11px] uppercase tracking-[0.1em] text-muted">
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 bg-primary" />
          <span>Completed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 bg-accent" />
          <span>Active</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 bg-warning" />
          <span>Pending</span>
        </div>
      </div>
    </div>
  );
}

interface LineChartProps {
  data: { month: string; value: number }[];
  height?: number;
}

export function LineChart({ data, height = 150 }: LineChartProps) {
  if (!data.length) {
    return (
      <div
        className="flex w-full items-center justify-center text-xs text-muted"
        style={{ height }}
      >
        No data available
      </div>
    );
  }

  const numericValues = data.map((item) =>
    Number.isFinite(item.value) ? item.value : 0,
  );
  const maxValue = numericValues.length ? Math.max(...numericValues) : 0;
  const safeRange = maxValue === 0 ? 1 : maxValue;
  const denominator = data.length > 1 ? data.length - 1 : 1;

  const points = data
    .map((item, index) => {
      const safeValue = Number.isFinite(item.value) ? item.value : 0;
      const x = (index / denominator) * 100;
      const y = 100 - (safeValue / safeRange) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  const areaPoints = `0,100 ${points} 100,100`;

  return (
    <div className="w-full" style={{ height }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        {[0, 25, 50, 75, 100].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="100"
            y2={y}
            stroke="#dce3ec"
            strokeWidth="0.6"
          />
        ))}
        <polygon
          points={areaPoints}
          fill="url(#corporateChartGradient)"
          opacity="0.18"
        />
        <polyline
          points={points}
          fill="none"
          stroke="#0019a8"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {data.map((item, index) => {
          const safeValue = Number.isFinite(item.value) ? item.value : 0;
          const x = (index / denominator) * 100;
          const y = 100 - (safeValue / safeRange) * 100;
          return (
            <rect
              key={index}
              x={x - 1.1}
              y={y - 1.1}
              width="2.2"
              height="2.2"
              fill="#00782a"
            />
          );
        })}
        <defs>
          <linearGradient
            id="corporateChartGradient"
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#0019a8" />
            <stop offset="100%" stopColor="#0019a8" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <div className="mt-2 flex justify-between text-[11px] uppercase tracking-[0.08em] text-muted">
        {data.map((item, index) => (
          <span key={index}>{item.month}</span>
        ))}
      </div>
    </div>
  );
}
