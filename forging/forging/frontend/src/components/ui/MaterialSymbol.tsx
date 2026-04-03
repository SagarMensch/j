import React from "react";
import { cn } from "@/lib/utils";

const SYMBOL_ALIASES: Record<string, string> = {
  Activity: "monitor_heart",
  AlertCircle: "error",
  AlertTriangle: "warning",
  ArrowLeft: "arrow_back",
  ArrowRight: "arrow_forward",
  ArrowUp: "arrow_upward",
  BarChart3: "bar_chart_4_bars",
  CheckCircle2: "check_circle",
  CheckSquare: "task_alt",
  ChevronRight: "chevron_right",
  ClipboardList: "fact_check",
  Construction: "construction",
  Download: "download",
  ExternalLink: "open_in_new",
  FileText: "description",
  FileUp: "upload_file",
  Filter: "filter_list",
  Hand: "pan_tool",
  HelpCircle: "help",
  History: "history",
  LayoutGrid: "grid_view",
  Lock: "lock",
  Mail: "mail",
  Maximize: "fit_screen",
  Maximize2: "open_in_full",
  Minus: "remove",
  Plus: "add",
  Search: "search",
  Settings: "settings",
  ShieldCheck: "verified_user",
  TrendingUp: "trending_up",
  TriangleAlert: "warning",
  Upload: "upload",
  Zap: "bolt",
};

type MaterialSymbolProps = {
  icon: string;
  className?: string;
  filled?: boolean;
  grade?: number;
  opticalSize?: number;
  weight?: number;
  label?: string;
};

export function resolveMaterialSymbol(icon: string) {
  return SYMBOL_ALIASES[icon] ?? icon;
}

export function MaterialSymbol({
  icon,
  className,
  filled = false,
  grade = 0,
  opticalSize = 24,
  weight = 400,
  label,
}: MaterialSymbolProps) {
  const resolvedIcon = resolveMaterialSymbol(icon);

  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn("material-symbol", className)}
      style={
        {
          fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${weight}, 'GRAD' ${grade}, 'opsz' ${opticalSize}`,
        } as React.CSSProperties
      }
    >
      {resolvedIcon}
    </span>
  );
}
