import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentViewer } from "@/components/analysis/DocumentViewer";
import { AnalysisTabs } from "@/components/restored/AnalysisTabs";
import { fetchAnalysis, resolveApiUrl } from "@/lib/api";
import { formatDateTime, formatPercent, formatVerdict, verdictTone } from "@/lib/format";

export default async function AnalysisDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const analysis = await fetchAnalysis(id).catch(() => null);

  if (!analysis) {
    notFound();
  }

  const tone = verdictTone(analysis.verdict);
  const primaryPage = analysis.pages[0] ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-white text-text-main">
      <header className="border-b border-border-color bg-primary px-6 py-5 text-white shadow-subtle">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <Link
              className="flex size-10 items-center justify-center rounded-full border border-white/20 transition-colors hover:bg-white/10"
              href={`/analyst/analysis/${analysis.analysis_id}`}
            >
              <span className="material-symbols-outlined text-2xl">arrow_back</span>
            </Link>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/70">Source Document</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">{analysis.filename}</h1>
            </div>
          </div>
          <span className={`rounded-full bg-white px-4 py-2 text-sm font-bold ${tone.chip}`}>
            {formatVerdict(analysis.verdict)}
          </span>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <section className="relative flex w-full items-center justify-center overflow-hidden bg-background-light lg:w-[60%]">
          {primaryPage ? (
            <DocumentViewer
              alt={`${analysis.filename} original page`}
              imageUrl={resolveApiUrl(primaryPage.artifacts.original_url)}
              pageHeight={primaryPage.height}
              pageWidth={primaryPage.width}
              maxHeightClassName="max-h-[78vh]"
            />
          ) : (
            <div className="p-8">
              <div className="rounded-[24px] border border-dashed border-border-color bg-surface px-8 py-20 text-sm font-medium text-muted">
                No document preview is available for this case.
              </div>
            </div>
          )}
        </section>

        <aside className="flex w-full flex-col border-l border-border-color bg-white lg:w-[40%]">
          <AnalysisTabs active="status" caseId={analysis.analysis_id} />
          <div className="flex-1 space-y-6 overflow-y-auto bg-background-light p-6">
            <section className="rounded-[24px] border border-border-color bg-white p-5 shadow-subtle">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Document Metadata</p>
              <div className="mt-4 grid gap-4">
                <div>
                  <p className="text-sm font-bold">Document Type</p>
                  <p className="mt-1 text-sm font-medium text-muted">{analysis.document_type || "unspecified"}</p>
                </div>
                <div>
                  <p className="text-sm font-bold">Submitter Id</p>
                  <p className="mt-1 text-sm font-medium text-muted">{analysis.submitter_id || "not provided"}</p>
                </div>
                <div>
                  <p className="text-sm font-bold">Created</p>
                  <p className="mt-1 text-sm font-medium text-muted">{formatDateTime(analysis.created_at)}</p>
                </div>
              </div>
            </section>

            <section className="rounded-[24px] border border-border-color bg-white p-5 shadow-subtle">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Page Inventory</p>
              <div className="mt-4 space-y-3">
                {analysis.pages.map((page) => (
                  <div className="rounded-2xl border border-border-color bg-background-light px-4 py-4" key={page.page_index}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-bold">Page {page.page_index}</p>
                        <p className="mt-1 text-sm font-medium text-muted">
                          {page.width} x {page.height} px
                        </p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${page.tampered_regions.length > 0 ? "bg-accent-red/10 text-accent-red" : "bg-accent-green/10 text-accent-green"}`}>
                        {page.tampered_regions.length > 0 ? `${page.tampered_regions.length} tampered region(s)` : "No regions"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[24px] border border-border-color bg-white p-5 shadow-subtle">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Risk Snapshot</p>
              <p className="mt-4 text-4xl font-bold tracking-tight">{formatPercent(analysis.forensic_risk_score)}</p>
              <p className="mt-2 text-sm font-medium text-muted">
                Model device {analysis.device} · {analysis.processing_time_ms} ms runtime
              </p>
            </section>
          </div>
        </aside>
      </main>
    </div>
  );
}
