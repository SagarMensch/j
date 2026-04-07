import Link from "next/link";
import { fetchAnalyses } from "@/lib/api";
import { AnalysisHistoryItem } from "@/lib/api-types";
import {
  formatDocumentType,
  formatPercent,
  formatRelativeTime,
  formatVerdict,
} from "@/lib/format";

type QueueView = "all" | "clean" | "suspicious" | "critical";

const VIEW_LABELS: Record<QueueView, string> = {
  all: "All",
  clean: "Clean",
  suspicious: "Suspicious",
  critical: "Critical",
};

export default async function AnalystQueuePage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const activeView = normaliseView(resolvedSearchParams.view);
  const history = await fetchAnalyses(100).catch(() => ({
    page: 1,
    page_size: 100,
    total: 0,
    items: [],
  }));
  const items = history.items;
  const filtered = filterItems(items, activeView);
  const counts = {
    all: items.length,
    clean: items.filter((item) => item.verdict === "CLEAN").length,
    suspicious: items.filter((item) => item.verdict === "SUSPICIOUS").length,
    critical: items.filter((item) => item.verdict === "CONFIRMED_FORGERY").length,
  } satisfies Record<QueueView, number>;

  return (
    <div
      className="min-h-screen flex flex-col antialiased"
      style={{
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        backgroundColor: "#FFFFFF",
        color: "#121212",
      }}
    >
      <header
        className="flex items-center justify-between whitespace-nowrap px-10 py-4 text-white"
        style={{ backgroundColor: "#0019A8" }}
      >
        <div className="flex items-center gap-4">
          <div className="size-6 text-white">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "24px" }}
            >
              shield
            </span>
          </div>
          <h2 className="text-white text-xl font-bold leading-tight tracking-tight">
            SequelForensics
          </h2>
        </div>
        <div className="flex flex-1 justify-end gap-6 items-center">
          <div className="relative w-64">
            <span
              className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: "#737373", fontSize: "20px" }}
            >
              search
            </span>
            <input
              className="w-full bg-white/10 border border-white/20 text-white placeholder-white/50 rounded-full py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-white/50 text-sm font-medium"
              placeholder="Search Case ID..."
              type="text"
            />
          </div>
          <div
            className="bg-center bg-no-repeat aspect-square bg-cover rounded-full size-10 border-2 border-white/20"
            style={{
              backgroundImage:
                "url('https://ui-avatars.com/api/?name=A&background=0019A8&color=fff&bold=true')",
            }}
          ></div>
        </div>
      </header>

      <main
        className="flex-1 flex flex-col"
        style={{ backgroundColor: "#F4F6F8" }}
      >
        <div
          className="flex-1 flex flex-col h-full"
          style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}
        >
          <div className="px-8 pt-8 pb-4">
            <p
              className="text-sm font-medium mb-1 uppercase tracking-wider"
              style={{ color: "#737373" }}
            >
              Analyst Review Queue
            </p>
            <h1
              className="text-3xl font-bold tracking-tight"
              style={{ color: "#121212" }}
            >
              Document Analysis Queue
            </h1>
          </div>

          <div
            className="flex px-8 gap-8"
            style={{ borderBottom: "1px solid #E5E5E5" }}
          >
            {(["all", "clean", "suspicious", "critical"] as QueueView[]).map(
              (view) => {
                const active = activeView === view;
                return (
                  <Link
                    className="flex flex-col items-center justify-center pb-3 pt-4 hover:text-[#121212] transition-colors"
                    href={view === "all" ? "/analyst/queue" : `/analyst/queue?view=${view}`}
                    key={view}
                    style={{
                      borderBottom: active
                        ? "4px solid #0019A8"
                        : "4px solid transparent",
                      color: active ? "#121212" : "#737373",
                    }}
                  >
                    <p className="text-sm font-bold leading-normal">
                      {VIEW_LABELS[view]} ({counts[view]})
                    </p>
                  </Link>
                );
              },
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-8 space-y-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold" style={{ color: "#121212" }}>
                {sectionTitle(activeView)}
              </h2>
              <span
                className="px-3 py-1 rounded-full text-sm font-bold"
                style={{
                  backgroundColor: "#E9ECFF",
                  color: "#0019A8",
                }}
              >
                {filtered.length} shown
              </span>
            </div>

            {filtered.length > 0 ? (
              filtered.map((item) => {
                const tone = rowTone(item);

                return (
                  <Link
                    key={item.analysis_id}
                    href={`/analyst/analysis/${item.analysis_id}`}
                    className="w-full flex items-stretch bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow group text-left cursor-pointer"
                    style={{ border: "1px solid #E5E5E5", minHeight: "84px" }}
                  >
                    <div
                      className="w-2 shrink-0"
                      style={{ backgroundColor: tone.stripColor }}
                    ></div>
                    <div className="flex-1 flex items-center justify-between gap-6 px-6 py-4">
                      <div className="min-w-0">
                        <span
                          className="block truncate text-lg font-bold group-hover:text-[#0019A8] transition-colors"
                          style={{ color: "#121212" }}
                        >
                          {item.filename}
                        </span>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <span
                            className="rounded-full px-3 py-1 text-xs font-bold"
                            style={{
                              backgroundColor: tone.badgeBackground,
                              color: tone.badgeText,
                            }}
                          >
                            {formatVerdict(item.verdict)}
                          </span>
                          <span
                            className="text-xs font-medium uppercase tracking-[0.18em]"
                            style={{ color: "#737373" }}
                          >
                            {formatDocumentType(item.document_type)}
                          </span>
                          <span
                            className="text-xs font-medium"
                            style={{ color: "#737373" }}
                          >
                            {item.analysis_id}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        <span
                          className="text-sm font-bold"
                          style={{ color: "#121212" }}
                        >
                          {formatPercent(item.forensic_risk_score)}
                        </span>
                        <span
                          className="text-xs font-medium"
                          style={{ color: "#737373" }}
                        >
                          {formatRelativeTime(item.created_at)}
                        </span>
                        <span
                          className="material-symbols-outlined group-hover:text-[#0019A8] transition-colors"
                          style={{ color: "#737373" }}
                        >
                          chevron_right
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })
            ) : (
              <div
                className="p-12 text-center text-sm font-medium"
                style={{ color: "#737373" }}
              >
                {emptyState(activeView)}
              </div>
            )}
          </div>

          <div
            className="p-8"
            style={{
              borderTop: "1px solid #E5E5E5",
              backgroundColor: "#F4F6F8",
            }}
          >
            <Link
              href="/analyst/override-history"
              className="w-full font-bold h-14 rounded-xl hover:opacity-90 transition-colors flex items-center justify-center gap-2 text-white"
              style={{ backgroundColor: "#0019A8" }}
            >
              <span className="material-symbols-outlined">history</span>
              Open Override History
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

function normaliseView(value?: string): QueueView {
  if (value === "clean" || value === "suspicious" || value === "critical") {
    return value;
  }
  return "all";
}

function filterItems(items: AnalysisHistoryItem[], view: QueueView) {
  if (view === "clean") {
    return items.filter((item) => item.verdict === "CLEAN");
  }
  if (view === "suspicious") {
    return items.filter((item) => item.verdict === "SUSPICIOUS");
  }
  if (view === "critical") {
    return items.filter((item) => item.verdict === "CONFIRMED_FORGERY");
  }
  return items;
}

function sectionTitle(view: QueueView) {
  if (view === "clean") {
    return "Clean Document Analyses";
  }
  if (view === "suspicious") {
    return "Suspicious Findings";
  }
  if (view === "critical") {
    return "Critical Findings";
  }
  return "All Document Analyses";
}

function emptyState(view: QueueView) {
  if (view === "clean") {
    return "No clean analyses are available yet.";
  }
  if (view === "suspicious") {
    return "No suspicious analyses are available yet.";
  }
  if (view === "critical") {
    return "No critical analyses are available yet.";
  }
  return "No analyses are available yet.";
}

function rowTone(item: AnalysisHistoryItem) {
  if (item.verdict === "CONFIRMED_FORGERY") {
    return {
      stripColor: "var(--color-accent-red)",
      badgeBackground: "rgba(238, 42, 36, 0.12)",
      badgeText: "var(--color-accent-red)",
    };
  }
  if (item.verdict === "SUSPICIOUS") {
    return {
      stripColor: "var(--color-accent-amber)",
      badgeBackground: "rgba(255, 200, 10, 0.18)",
      badgeText: "#A86000",
    };
  }
  return {
    stripColor: "var(--color-accent-green)",
    badgeBackground: "rgba(0, 130, 59, 0.12)",
    badgeText: "var(--color-accent-green)",
  };
}
