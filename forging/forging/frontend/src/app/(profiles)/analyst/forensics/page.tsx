import Link from "next/link";
import { fetchDashboardSummary } from "@/lib/api";
import { formatPercent } from "@/lib/format";

export default async function ForensicLabPage() {
  const summary = await fetchDashboardSummary().catch(() => null);

  const signals = [
    ["Compression shifts", summary?.engine_averages.ela_score ?? 0],
    ["Texture changes", summary?.engine_averages.srm_score ?? 0],
    ["Pattern changes", summary?.engine_averages.noiseprint_score ?? 0],
    ["Visual outliers", summary?.engine_averages.dino_vit_score ?? 0],
    ["Text consistency", summary?.engine_averages.ocr_anomaly_score ?? 0],
    ["Marked areas", summary?.engine_averages.segmentation_score ?? 0],
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background-light text-text-main">
      <header className="border-b border-border-color bg-white px-6 py-6 shadow-subtle lg:px-10">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">Forensic Lab</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Signal Overview</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium text-muted">
              A summary of the strongest review signals across recent cases.
            </p>
          </div>
          <Link className="rounded-full bg-primary px-5 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90" href="/analyst/queue">
            Open Review Queue
          </Link>
        </div>
      </header>

      <main className="grid flex-1 gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:p-8">
        <section className="rounded-[28px] border border-border-color bg-white p-6 shadow-subtle">
          <h2 className="text-2xl font-bold tracking-tight">Review signal summary</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {signals.map(([label, score]) => (
              <div className="rounded-[24px] border border-border-color bg-background-light p-5" key={label}>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">{label}</p>
                <p className="mt-4 text-3xl font-bold tracking-tight">{formatPercent(Number(score))}</p>
              </div>
            ))}
          </div>
        </section>

        <aside className="rounded-[28px] border border-border-color bg-white p-6 shadow-subtle">
          <h2 className="text-2xl font-bold tracking-tight">Highest-risk cases</h2>
          <div className="mt-6 space-y-3">
            {(summary?.flagged_analyses ?? []).slice(0, 5).map((item) => (
              <Link
                className="block rounded-[24px] border border-border-color bg-background-light px-5 py-4 transition-colors hover:border-primary/30 hover:bg-white"
                href={`/analyst/analysis/${item.analysis_id}`}
                key={item.analysis_id}
              >
                <p className="text-base font-bold">{item.filename}</p>
                <p className="mt-1 text-xs font-medium uppercase tracking-[0.18em] text-muted">{item.analysis_id}</p>
                <p className="mt-4 text-sm font-medium text-muted">{formatPercent(item.forensic_risk_score)} risk level</p>
              </Link>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}
