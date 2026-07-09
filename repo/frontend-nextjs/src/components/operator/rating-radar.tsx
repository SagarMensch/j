"use client";

import React from "react";

type Axis = { label: string; value: number; };

type Props = {
  axes: Axis[];
  size?: number;
  title?: string;
  caption?: string;
};

export function RatingRadar({ axes, size = 260, title, caption }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.36;
  const n = axes.length;

  const point = (i: number, value: number) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = radius * Math.max(0, Math.min(1, value));
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
  };

  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <div className="flex flex-col items-center">
      {title ? <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{title}</p> : null}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        {gridLevels.map((level) => {
          const pts = Array.from({ length: n }, (_, i) => point(i, level).join(",")).join(" ");
          return (
            <polygon
              key={level}
              points={pts}
              fill="none"
              stroke="rgba(0,25,168,0.10)"
              strokeWidth={1}
            />
          );
        })}

        {axes.map((_, i) => {
          const [x, y] = point(i, 1);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(0,25,168,0.10)" strokeWidth={1} />;
        })}

        <polygon
          points={axes.map((a, i) => point(i, a.value).join(",")).join(" ")}
          fill="rgba(0,25,168,0.22)"
          stroke="#0019a8"
          strokeWidth={2}
        />
        {axes.map((a, i) => {
          const [x, y] = point(i, a.value);
          return <circle key={i} cx={x} cy={y} r={3.5} fill="#0019a8" />;
        })}

        {axes.map((a, i) => {
          const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
          const labelR = radius + 22;
          const x = cx + labelR * Math.cos(angle);
          const y = cy + labelR * Math.sin(angle);
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-foreground"
              style={{ fontSize: 11, fontWeight: 600 }}
            >
              {a.label}
              <tspan dx={4} className="fill-muted" style={{ fontSize: 10 }}>
                {Math.round(a.value * 100)}%
              </tspan>
            </text>
          );
        })}
      </svg>
      {caption ? <p className="mt-1 text-[10px] text-muted">{caption}</p> : null}
    </div>
  );
}
