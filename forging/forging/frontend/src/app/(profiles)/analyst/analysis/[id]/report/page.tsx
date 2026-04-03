import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchAnalysis, resolveApiUrl } from "@/lib/api";
import { getTopRegion } from "@/lib/case-view";
import { formatDateTime, formatPercent, formatVerdict, verdictTone } from "@/lib/format";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const analysis = await fetchAnalysis(id).catch(() => null);

  if (!analysis) {
    notFound();
  }

  const topRegion = getTopRegion(analysis);
  const tone = verdictTone(analysis.verdict);
  const primaryPage = analysis.pages[0] ?? null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-light p-4 text-text-main">
      <div className="w-full max-w-4xl overflow-hidden rounded-[28px] border border-border-color bg-white shadow-subtle">
        <header className="flex items-center justify-between border-b border-border-color px-6 py-5">
          <div className="flex items-center gap-3">
            <Link className="flex size-10 items-center justify-center rounded-full transition-colors hover:bg-surface" href={`/analyst/analysis/${analysis.analysis_id}`}>
              <span className="material-symbols-outlined text-2xl">arrow_back</span>
            </Link>
            <div>
              <h2 className="text-xl font-bold tracking-tight">Forensic Report Preview</h2>
              <p className="mt-1 text-sm font-medium text-muted">{analysis.analysis_id}</p>
            </div>
          </div>
          <span className={`rounded-full px-4 py-2 text-sm font-bold ${tone.chip}`}>
            {formatVerdict(analysis.verdict)}
          </span>
        </header>

        <div className="grid gap-0 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="border-r border-border-color p-6">
            <div className="overflow-hidden rounded-[24px] border border-border-color bg-background-light">
              <div className="flex items-center gap-3 bg-primary px-5 py-4 text-white">
                <span className="material-symbols-outlined text-3xl">policy</span>
                <div>
                  <h3 className="text-xl font-bold tracking-tight">{formatVerdict(analysis.verdict)}</h3>
                  <p className="text-sm font-medium text-white/80">Generated {formatDateTime(analysis.created_at)}</p>
                </div>
              </div>
              <div className="grid gap-5 bg-white p-5 md:grid-cols-[1fr_160px] md:items-center">
                <div>
                  <p className="text-4xl font-bold leading-none tracking-tight">{formatPercent(analysis.forensic_risk_score)}</p>
                  <p className="mt-2 text-sm font-medium text-muted">Overall forgery probability</p>
                  <p className="mt-4 text-base font-medium">
                    File <span className="font-bold">{analysis.filename}</span>
                  </p>
                </div>
                {primaryPage ? (
                  <div className="overflow-hidden rounded-lg border border-border-color bg-surface">
                    <img alt={`${analysis.filename} report preview`} className="block h-32 w-full object-cover" src={resolveApiUrl(primaryPage.artifacts.overlay_url)} />
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {[
                ["ELA", analysis.engine_scores.ela_score],
                ["SRM", analysis.engine_scores.srm_score],
                ["Noiseprint", analysis.engine_scores.noiseprint_score],
                ["DINO", analysis.engine_scores.dino_vit_score],
                ["OCR", analysis.engine_scores.ocr_anomaly_score],
                ["Segmentation", analysis.engine_scores.segmentation_score],
              ].map(([label, score]) => (
                <div className="rounded-[20px] border border-border-color bg-background-light px-4 py-4" key={label}>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">{label}</p>
                  <p className="mt-3 text-2xl font-bold">{formatPercent(Number(score))}</p>
                </div>
              ))}
            </div>
          </div>

          <aside className="space-y-6 bg-background-light p-6">
            <section className="rounded-[24px] border border-border-color bg-white p-5 shadow-subtle">
              <h3 className="text-lg font-bold">Recommended Attachments</h3>
              <div className="mt-4 space-y-3">
                {[
                  "Overlay and mask artifacts",
                  "Structured OCR anomalies",
                  "Duplicate match metadata",
                  "Segmentation region coordinates",
                ].map((item) => (
                  <div className="flex items-center gap-3 rounded-2xl border border-border-color bg-background-light px-4 py-3" key={item}>
                    <span className="material-symbols-outlined text-primary">check_circle</span>
                    <span className="text-sm font-medium">{item}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[24px] border border-border-color bg-white p-5 shadow-subtle">
              <h3 className="text-lg font-bold">Case Summary</h3>
              <div className="mt-4 space-y-3">
                <p className="text-sm font-medium text-muted">
                  Duplicate status: <span className="font-bold text-text-main">{analysis.duplicate_check.duplicate_status.replaceAll("_", " ")}</span>
                </p>
                <p className="text-sm font-medium text-muted">
                  OCR anomalies: <span className="font-bold text-text-main">{analysis.ocr_anomalies.length}</span>
                </p>
                <p className="text-sm font-medium text-muted">
                  Warning count: <span className="font-bold text-text-main">{analysis.warnings.length}</span>
                </p>
                <p className="text-sm font-medium text-muted">
                  Runtime: <span className="font-bold text-text-main">{analysis.processing_time_ms} ms</span>
                </p>
                {topRegion ? (
                  <p className="text-sm font-medium text-muted">
                    Top region: <span className="font-bold text-text-main">{topRegion.width} x {topRegion.height} px at X {topRegion.x}, Y {topRegion.y}</span>
                  </p>
                ) : null}
              </div>
            </section>

            <button className="flex h-14 w-full items-center justify-center gap-2 rounded-[32px] bg-primary text-base font-bold text-white shadow-sm transition-colors hover:bg-primary/90">
              <span className="material-symbols-outlined text-xl">picture_as_pdf</span>
              <span>Generate PDF</span>
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}
