import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchAnalysis, resolveApiUrl } from "@/lib/api";
import { getTopRegion } from "@/lib/case-view";
import { formatPercent } from "@/lib/format";

export default async function EvidencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const analysis = await fetchAnalysis(id).catch(() => null);

  if (!analysis) {
    notFound();
  }

  const primaryPage = analysis.pages[0] ?? null;
  const topRegion = getTopRegion(analysis);

  return (
    <div className="flex min-h-screen w-full bg-surface text-text-main">
      <div className="flex min-h-screen w-full overflow-hidden">
        <div className="hidden h-screen w-[60%] items-center justify-center border-r border-border-color bg-white p-8 md:flex">
          {primaryPage ? (
            <div className="overflow-hidden rounded-[24px] border border-border-color bg-surface shadow-subtle">
              <img
                alt={`${analysis.filename} combined heatmap`}
                className="block h-auto max-h-[78vh] w-auto max-w-full"
                src={resolveApiUrl(primaryPage.artifacts.combined_heatmap_url)}
              />
            </div>
          ) : null}
        </div>

        <div className="relative flex h-screen w-full flex-col bg-white shadow-[-4px_0_20px_rgba(0,0,0,0.04)] md:w-[40%]">
          <header className="sticky top-0 z-20 flex items-center border-b border-border-color bg-white px-6 py-4">
            <Link className="flex items-center gap-2 text-base font-bold transition-colors hover:text-primary" href={`/analyst/analysis/${analysis.analysis_id}`}>
              <span className="material-symbols-outlined text-2xl">chevron_left</span>
              <span>Back to Status</span>
            </Link>
          </header>

          <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="h-8 w-3 rounded-sm bg-accent-red"></div>
                <h1 className="text-[32px] font-bold leading-tight tracking-tight">Evidence Stack</h1>
              </div>
              <p className="ml-6 text-base font-medium text-muted">
                Combined artifact view from the persisted FastAPI analysis.
              </p>
            </div>

            <div className="rounded-[24px] border border-border-color bg-background-light p-6 shadow-subtle">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-text-main">Forgery Probability</p>
              <p className="mt-3 text-[64px] font-bold leading-none tracking-tighter text-accent-red">
                {Math.round(analysis.forensic_risk_score * 100)}
                <span className="text-4xl">%</span>
              </p>
              <p className="mt-3 text-sm font-medium text-muted">
                Segmentation score {formatPercent(analysis.engine_scores.segmentation_score)} · DINO score {formatPercent(analysis.engine_scores.dino_vit_score)}
              </p>
            </div>

            <div className="rounded-[24px] border border-border-color bg-white p-6 shadow-subtle">
              <h2 className="text-lg font-bold">Primary Region</h2>
              {topRegion ? (
                <div className="mt-4 space-y-3">
                  {[
                    ["Coordinates", `X ${topRegion.x}, Y ${topRegion.y}`],
                    ["Dimensions", `${topRegion.width} x ${topRegion.height} px`],
                    ["Area", `${topRegion.area_px.toLocaleString()} px`],
                    ["Mean Score", formatPercent(topRegion.mean_mask_score)],
                    ["Max Score", formatPercent(topRegion.max_mask_score)],
                  ].map(([label, value]) => (
                    <div className="flex items-center justify-between border-b border-dashed border-border-color py-2 last:border-b-0" key={label}>
                      <span className="text-sm font-medium text-muted">{label}</span>
                      <span className="text-sm font-bold">{value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm font-medium text-muted">No segmented tampered region was returned.</p>
              )}
            </div>

            {primaryPage ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["Overlay", primaryPage.artifacts.overlay_url],
                  ["Mask", primaryPage.artifacts.mask_url],
                  ["Contours", primaryPage.artifacts.contours_url],
                  ["ELA", primaryPage.artifacts.ela_heatmap_url],
                ].map(([label, url]) => (
                  <div className="overflow-hidden rounded-[24px] border border-border-color bg-white shadow-subtle" key={label}>
                    <div className="border-b border-border-color px-4 py-3 text-sm font-bold">{label}</div>
                    <img alt={`${analysis.filename} ${label}`} className="block h-44 w-full object-cover" src={resolveApiUrl(url)} />
                  </div>
                ))}
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
