import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoPrintOnLoad } from "@/components/report/AutoPrintOnLoad";
import { PrintNowButton } from "@/components/report/PrintNowButton";
import { fetchAnalysis, resolveApiUrl } from "@/lib/api";
import { PageResult, TamperedRegion } from "@/lib/api-types";
import { getTamperedRegionCount, getTopRegion } from "@/lib/case-view";
import { formatDateTime, formatPercent, formatVerdict, verdictTone } from "@/lib/format";

export default async function ReportPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ autoprint?: string }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const analysis = await fetchAnalysis(id).catch(() => null);

  if (!analysis) {
    notFound();
  }

  const tone = verdictTone(analysis.verdict);
  const topRegion = getTopRegion(analysis);
  const regionCount = getTamperedRegionCount(analysis);
  const primaryPage = analysis.pages[0] ?? null;
  const shouldAutoPrint = resolvedSearchParams.autoprint === "1";

  return (
    <div className="min-h-screen bg-[#f4f6f8] px-4 py-6 text-text-main print:bg-white print:p-0">
      <style>{`
        @page {
          size: A4;
          margin: 12mm;
        }
        html, body {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
          background: #ffffff !important;
        }
        .print-shell,
        .print-shell * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        .print-brandbar {
          background: #2109aa !important;
          color: #ffffff !important;
        }
        .print-surface {
          background: #f6f5f8 !important;
        }
        .print-card {
          background: #ffffff !important;
          border-color: #e5e5e5 !important;
        }
        .print-chip-blue {
          background: #eef2ff !important;
          color: #2109aa !important;
        }
        .print-chip-green {
          background: rgba(52, 199, 89, 0.12) !important;
          color: #34c759 !important;
        }
        @media print {
          .print-toolbar {
            display: none !important;
          }
          .print-shell {
            max-width: none !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          .print-break {
            break-before: page;
            page-break-before: always;
          }
          .print-avoid-break {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>

      <AutoPrintOnLoad enabled={shouldAutoPrint} />

      <div className="print-shell mx-auto max-w-5xl overflow-hidden rounded-[28px] border border-border-color bg-white shadow-subtle">
        <header className="print-toolbar flex items-center justify-between gap-4 border-b border-border-color px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
              Print-ready forensic export
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">
              {analysis.filename}
            </h1>
            <p className="mt-1 text-sm font-medium text-muted">
              This export includes all {analysis.page_count} document page
              {analysis.page_count === 1 ? "" : "s"}.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              className="rounded-full border border-border-color px-5 py-3 text-sm font-bold transition-colors hover:bg-surface"
              href={`/analyst/analysis/${analysis.analysis_id}/report`}
            >
              Back to preview
            </Link>
            <PrintNowButton />
          </div>
        </header>

        <main className="space-y-8 px-6 py-6 print:px-0 print:py-0">
          <section className="print-avoid-break print-surface overflow-hidden rounded-[28px] border border-border-color bg-background-light">
            <div className="print-brandbar flex items-center gap-3 bg-primary px-6 py-5 text-white">
              <span className="material-symbols-outlined text-3xl">policy</span>
              <div>
                <h2 className="text-2xl font-bold tracking-tight">
                  {formatVerdict(analysis.verdict)}
                </h2>
                <p className="text-sm font-medium text-white/80">
                  Generated {formatDateTime(analysis.created_at)}
                </p>
              </div>
            </div>

            <div className="grid gap-6 bg-white p-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <div className="flex items-center gap-3">
                  <span className={`print-chip-green rounded-full px-4 py-2 text-sm font-bold ${tone.chip}`}>
                    {formatVerdict(analysis.verdict)}
                  </span>
                  <span className="print-chip-blue rounded-full bg-[#eef2ff] px-4 py-2 text-sm font-bold text-primary">
                    {analysis.page_count} document page{analysis.page_count === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="mt-6 text-5xl font-bold leading-none tracking-tight">
                  {formatPercent(analysis.forensic_risk_score)}
                </p>
                <p className="mt-3 text-base font-medium text-muted">
                  Overall forgery probability
                </p>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <SummaryMetric label="Duplicate status" value={analysis.duplicate_check.duplicate_status.replaceAll("_", " ")} />
                  <SummaryMetric label="OCR anomalies" value={`${analysis.ocr_anomalies.length}`} />
                  <SummaryMetric label="Warnings" value={`${analysis.warnings.length}`} />
                  <SummaryMetric label="Marked regions" value={`${regionCount}`} />
                  <SummaryMetric label="Runtime" value={`${analysis.processing_time_ms} ms`} />
                  <SummaryMetric
                    label="Top region"
                    value={
                      topRegion
                        ? `${topRegion.width} x ${topRegion.height} px`
                        : "No dominant region"
                    }
                  />
                </div>
              </div>

              <div className="grid gap-4">
                {primaryPage ? (
                    <div className="print-card overflow-hidden rounded-[24px] border border-border-color bg-surface">
                    <img
                      alt={`${analysis.filename} original page`}
                      className="block h-52 w-full object-contain bg-white"
                      src={resolveApiUrl(primaryPage.artifacts.original_url)}
                    />
                    <div className="border-t border-border-color px-4 py-3">
                      <p className="text-sm font-bold">Original document page</p>
                    </div>
                  </div>
                ) : null}
                {primaryPage ? (
                    <div className="print-card overflow-hidden rounded-[24px] border border-border-color bg-surface">
                    <img
                      alt={`${analysis.filename} overlay page`}
                      className="block h-52 w-full object-contain bg-white"
                      src={resolveApiUrl(primaryPage.artifacts.overlay_url)}
                    />
                    <div className="border-t border-border-color px-4 py-3">
                      <p className="text-sm font-bold">Reviewed overlay</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="print-card print-avoid-break rounded-[28px] border border-border-color bg-white p-6 shadow-subtle">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                  Engine output
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight">
                  Per-engine risk distribution
                </h2>
              </div>
              <span className="print-chip-green rounded-full bg-accent-green/10 px-3 py-1 text-xs font-bold text-accent-green">
                Export includes page-level evidence
              </span>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[
                ["ELA", analysis.engine_scores.ela_score],
                ["SRM", analysis.engine_scores.srm_score],
                ["Noiseprint", analysis.engine_scores.noiseprint_score],
                ["DINO", analysis.engine_scores.dino_vit_score],
                ["OCR", analysis.engine_scores.ocr_anomaly_score],
                ["Segmentation", analysis.engine_scores.segmentation_score],
              ].map(([label, score]) => (
                <div
                  className="print-surface rounded-[20px] border border-border-color bg-background-light px-4 py-4"
                  key={label}
                >
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                    {label}
                  </p>
                  <p className="mt-3 text-2xl font-bold">
                    {formatPercent(Number(score))}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {analysis.pages.map((page, index) => (
            <section
              className={`${index === 0 ? "" : "print-break"} print-card rounded-[28px] border border-border-color bg-white p-6 shadow-subtle`}
              key={page.page_index}
            >
              <div className="flex items-center justify-between gap-4 border-b border-border-color pb-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                    Document page {page.page_index}
                  </p>
                  <h2 className="mt-2 text-2xl font-bold tracking-tight">
                    Page evidence and reviewed output
                  </h2>
                </div>
                <span className="print-chip-blue rounded-full bg-[#eef2ff] px-3 py-1 text-xs font-bold text-primary">
                  {page.tampered_regions.length} marked area{page.tampered_regions.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="grid gap-5">
                  <PageArtifactCard
                    imageUrl={resolveApiUrl(page.artifacts.original_url)}
                    title="Original document page"
                  />
                  <PageArtifactCard
                    imageUrl={resolveApiUrl(page.artifacts.overlay_url)}
                    title="Reviewed overlay"
                  />
                </div>

                <aside className="space-y-5">
                  <div className="print-surface rounded-[24px] border border-border-color bg-background-light p-5">
                    <h3 className="text-lg font-bold">Page summary</h3>
                    <div className="mt-4 space-y-3 text-sm font-medium text-muted">
                      <p>
                        Dimensions:{" "}
                        <span className="font-bold text-text-main">
                          {page.width} x {page.height} px
                        </span>
                      </p>
                      <p>
                        Regions marked:{" "}
                        <span className="font-bold text-text-main">
                          {page.tampered_regions.length}
                        </span>
                      </p>
                      <p>
                        Top page region:{" "}
                        <span className="font-bold text-text-main">
                          {describePageRegion(page)}
                        </span>
                      </p>
                      <p>
                        OCR notes on this page:{" "}
                        <span className="font-bold text-text-main">
                          {analysis.ocr_anomalies.filter(
                            (anomaly) => anomaly.page_index === page.page_index,
                          ).length}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="print-surface rounded-[24px] border border-border-color bg-background-light p-5">
                    <h3 className="text-lg font-bold">Recommended attachments</h3>
                    <div className="mt-4 space-y-3">
                      {[
                        "Original page image",
                        "Overlay artifact",
                        "Mask and contour assets",
                        "Region coordinate evidence",
                      ].map((item) => (
                        <div
                          className="flex items-center gap-3 rounded-2xl border border-border-color bg-white px-4 py-3"
                          key={item}
                        >
                          <span className="material-symbols-outlined text-primary">
                            check_circle
                          </span>
                          <span className="text-sm font-medium">{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </aside>
              </div>
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-border-color bg-background-light px-4 py-4">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
        {label}
      </p>
      <p className="mt-3 text-lg font-bold">{value}</p>
    </div>
  );
}

function PageArtifactCard({
  imageUrl,
  title,
}: {
  imageUrl: string;
  title: string;
}) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-border-color bg-surface">
      <img
        alt={title}
        className="block max-h-[620px] w-full object-contain bg-white"
        src={imageUrl}
      />
      <div className="border-t border-border-color px-4 py-3">
        <p className="text-sm font-bold">{title}</p>
      </div>
    </div>
  );
}

function describePageRegion(page: PageResult) {
  const region = getTopRegionForPage(page);
  if (!region) {
    return "No dominant region";
  }
  return `${region.width} x ${region.height} px at X ${region.x}, Y ${region.y}`;
}

function getTopRegionForPage(page: PageResult): TamperedRegion | null {
  return (
    page.tampered_regions
      .slice()
      .sort((left, right) => right.max_mask_score - left.max_mask_score)[0] ?? null
  );
}
