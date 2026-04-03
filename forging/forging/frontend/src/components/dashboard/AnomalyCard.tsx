import React from "react";

interface AnomalyCardProps {
  name: string;
  date: string;
  score: number;
}

export function AnomalyCard({ name, date, score }: AnomalyCardProps) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-border-color shadow-[0_4px_15px_rgba(0,0,0,0.02)] border-l-[6px] border-l-accent-amber hover:shadow-[0_8px_25px_rgba(0,0,0,0.05)] transition-all duration-300 flex items-center justify-between group">
      <div className="flex flex-col gap-1.5">
        <h4 className="text-sm font-black text-text-main group-hover:text-primary transition-colors">
          {name}
        </h4>
        <span className="text-[10px] text-muted font-bold uppercase tracking-widest">
          {date}
        </span>
      </div>
      <div className="bg-surface px-5 py-2 rounded-xl text-xs font-black text-muted border border-border-color group-hover:bg-white transition-colors">
        {score}
      </div>
    </div>
  );
}
