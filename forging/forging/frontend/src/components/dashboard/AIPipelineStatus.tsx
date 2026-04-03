import React from "react";

interface PipelineMetricProps {
  label: string;
  value: number;
}

export function PipelineMetric({ label, value }: PipelineMetricProps) {
  return (
    <div className="flex items-center gap-2 px-5 py-2.5 bg-slate-50 rounded-lg border border-slate-100 min-w-[150px] shadow-sm hover:bg-slate-100 transition-colors cursor-default group">
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider group-hover:text-slate-500 transition-colors">{label}:</span>
      <span className="text-sm font-black text-slate-800">{value}</span>
    </div>
  );
}

export function AIPipelineStatus({ metrics }: { metrics: PipelineMetricProps[] }) {
  return (
    <div className="bg-white p-10 rounded-2xl border border-slate-100 shadow-[0_4px_30px_rgba(0,0,0,0.02)] mb-8">
      <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.2em] mb-6 opacity-70">AI Pipeline Status</h3>
      <div className="flex flex-wrap gap-4">
        {metrics.map((m, i) => (
          <PipelineMetric key={i} label={m.label} value={m.value} />
        ))}
      </div>
    </div>
  );
}
