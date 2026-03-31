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
  strokeWidth = 15,
  color = "#22c55e",
}: DonutChartProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          {/* Background circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={strokeWidth}
          />
          {/* Progress circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-foreground">{value}%</span>
        </div>
      </div>
      <p
        className={`mt-2 font-medium ${value >= 80 ? "text-accent" : value >= 60 ? "text-warning" : "text-danger"}`}
      >
        {label}
      </p>
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
        <div key={index} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="font-medium">{item.label}</span>
            <span className="text-muted">{item.percentage}%</span>
          </div>
          <div className="flex h-6 rounded-md overflow-hidden bg-muted-light">
            {item.values.map((value, vIndex) => (
              <div
                key={vIndex}
                className="h-full transition-all"
                style={{
                  width: `${(value / maxValue) * 100}%`,
                  backgroundColor: item.colors[vIndex],
                }}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="flex gap-4 mt-4 text-xs text-muted">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-primary-light" />
          <span>Completed</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-accent" />
          <span>In Progress</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-warning" />
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
        className="w-full flex items-center justify-center text-xs text-muted"
        style={{ height }}
      >
        No data available
      </div>
    );
  }

  const numericValues = data.map((d) =>
    Number.isFinite(d.value) ? d.value : 0,
  );
  const maxValue = numericValues.length ? Math.max(...numericValues) : 0;
  const minValue = 0;
  const range = maxValue - minValue;
  const safeRange = range === 0 ? 1 : range;
  const denom = data.length > 1 ? data.length - 1 : 1;

  const points = data
    .map((d, i) => {
      const safeValue = Number.isFinite(d.value) ? d.value : minValue;
      const x = (i / denom) * 100;
      const y = 100 - ((safeValue - minValue) / safeRange) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  const areaPoints = `0,100 ${points} 100,100`;

  return (
    <div className="w-full" style={{ height }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="w-full h-full"
      >
        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="100"
            y2={y}
            stroke="#e2e8f0"
            strokeWidth="0.5"
          />
        ))}
        {/* Area fill */}
        <polygon points={areaPoints} fill="url(#gradient)" opacity="0.3" />
        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke="#1e3a5f"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {/* Points */}
        {data.map((d, i) => {
          const safeValue = Number.isFinite(d.value) ? d.value : minValue;
          const x = (i / denom) * 100;
          const y = 100 - ((safeValue - minValue) / safeRange) * 100;
          return <circle key={i} cx={x} cy={y} r="2" fill="#1e3a5f" />;
        })}
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1e3a5f" />
            <stop offset="100%" stopColor="#1e3a5f" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <div className="flex justify-between text-xs text-muted mt-2">
        {data.map((d, i) => (
          <span key={i}>{d.month}</span>
        ))}
      </div>
    </div>
  );
}
