import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalysisTabs } from "@/components/restored/AnalysisTabs";
import { fetchAnalysis, fetchHealth, fetchModelInfo } from "@/lib/api";
import { formatPercent } from "@/lib/format";

export default async function CaseDiagnosticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [analysis, health, modelInfo] = await Promise.all([
    fetchAnalysis(id).catch(() => null),
    fetchHealth().catch(() => null),
    fetchModelInfo().catch(() => null),
  ]);

  if (!analysis) {
    notFound();
  }

  const diagnostics = [
    {
      name: "Model Package",
      value: modelInfo?.model_loaded
        ? "Primary checkpoint active"
        : "Model package unavailable",
      detail: health?.checkpoint_exists
        ? "The production model package is available to the review service."
        : "The active model package could not be verified.",
      status: modelInfo?.model_loaded ? "Healthy" : "Attention",
    },
    {
      name: "Analysis Backbone",
      value: modelInfo?.selected_encoder
        ? formatBackbone(modelInfo.selected_encoder)
        : "Backbone unavailable",
      detail:
        modelInfo?.input_channels != null
          ? `${modelInfo.input_channels}-channel forensic stack configured for this service.`
          : "Backbone metadata is currently unavailable.",
      status: modelInfo?.selected_encoder ? "Healthy" : "Attention",
    },
    {
      name: "Case Storage",
      value: health?.database_ready
        ? "Case datastore online"
        : "Datastore unavailable",
      detail: health?.database_ready
        ? "History, queue, and persistence services are responding normally."
        : "Stored analyses are temporarily unavailable.",
      status: health?.database_ready ? "Healthy" : "Attention",
    },
    {
      name: "Serving Profile",
      value: describeRuntime(modelInfo?.device ?? analysis.device),
      detail:
        (modelInfo?.device ?? analysis.device) === "cuda"
          ? "Accelerated compute is active for the review service."
          : "The service is running on the standard compute lane.",
      status: health?.model_loaded ? "Healthy" : "Attention",
    },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-white text-text-main">
      <header className="border-b border-border-color bg-white px-6 py-5 shadow-subtle">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Case Diagnostics</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{analysis.filename}</h1>
          </div>
          <Link className="rounded-full border border-border-color px-5 py-3 text-sm font-bold transition-colors hover:bg-surface" href={`/analyst/analysis/${analysis.analysis_id}`}>
            Back to Status
          </Link>
        </div>
      </header>

      <AnalysisTabs active="diagnostics" caseId={analysis.analysis_id} />

      <main className="grid flex-1 gap-8 bg-background-light p-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:p-8">
        <section className="rounded-[28px] border border-border-color bg-white p-6 shadow-subtle">
          <div className="flex items-center justify-between border-b border-border-color pb-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Engine Output</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight">Per-engine risk distribution</h2>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${health?.status === "ok" ? "bg-accent-green/10 text-accent-green" : "bg-accent-red/10 text-accent-red"}`}>
              {health?.status === "ok" ? "System healthy" : "System degraded"}
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
              <div className="rounded-[24px] border border-border-color bg-background-light p-5" key={label}>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">{label}</p>
                <p className="mt-4 text-3xl font-bold tracking-tight">{formatPercent(Number(score))}</p>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          {diagnostics.map((item) => (
            <div className="rounded-[24px] border border-border-color bg-white p-5 shadow-subtle" key={item.name}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">{item.name}</p>
                  <p className="mt-3 text-base font-bold">{item.value}</p>
                  <p className="mt-2 text-sm font-medium text-muted">{item.detail}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${item.status === "Healthy" ? "bg-accent-green/10 text-accent-green" : "bg-accent-amber/15 text-[#b45309]"}`}>
                  {item.status}
                </span>
              </div>
            </div>
          ))}
        </aside>
      </main>
    </div>
  );
}

function formatBackbone(value: string) {
  return `${value.replaceAll("_", " ").toUpperCase()} backbone`;
}

function describeRuntime(value: string | null | undefined) {
  if (value === "cuda") {
    return "Accelerated compute active";
  }
  if (value === "cpu") {
    return "Standard compute active";
  }
  return "Runtime profile available";
}
