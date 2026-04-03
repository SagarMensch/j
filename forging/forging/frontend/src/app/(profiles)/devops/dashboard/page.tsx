import { fetchDashboardSummary, fetchHealth, fetchModelInfo } from "@/lib/api";
import { formatPercent } from "@/lib/format";

export default async function DevopsDashboardPage() {
  const [health, modelInfo, summary] = await Promise.all([
    fetchHealth().catch(() => null),
    fetchModelInfo().catch(() => null),
    fetchDashboardSummary().catch(() => null),
  ]);

  const cards = [
    ["Health Endpoint", health?.status === "ok" ? "OK" : "Unavailable"],
    ["Model Loaded", modelInfo?.model_loaded ? "Yes" : "No"],
    ["Database Ready", health?.database_ready ? "Yes" : "No"],
    ["Checkpoint Exists", health?.checkpoint_exists ? "Yes" : "No"],
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background-light text-text-main">
      <header className="border-b border-border-color bg-white px-6 py-6 shadow-subtle lg:px-10">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">
          DevOps
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Backend system health
        </h1>
      </header>

      <main className="grid flex-1 gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:p-8">
        <section className="rounded-[28px] border border-border-color bg-white p-6 shadow-subtle">
          <div className="grid gap-4 md:grid-cols-2">
            {cards.map(([label, value]) => (
              <div
                className="rounded-[24px] border border-border-color bg-background-light p-5"
                key={label}
              >
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                  {label}
                </p>
                <p className="mt-4 text-3xl font-bold tracking-tight">
                  {value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-[24px] border border-border-color bg-background-light p-5">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                Checkpoint
              </p>
              <p className="mt-4 break-all text-base font-bold">
                {modelInfo?.checkpoint_path ?? "Unavailable"}
              </p>
            </div>
            <div className="rounded-[24px] border border-border-color bg-background-light p-5">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                Encoder
              </p>
              <p className="mt-4 text-base font-bold">
                {modelInfo?.selected_encoder ?? "Unknown"}
              </p>
              <p className="mt-2 text-sm font-medium text-muted">
                Input channels {modelInfo?.input_channels ?? "?"}
              </p>
            </div>
          </div>
        </section>

        <aside className="rounded-[28px] border border-border-color bg-white p-6 shadow-subtle">
          <h2 className="text-2xl font-bold tracking-tight">
            Average engine output
          </h2>
          <div className="mt-6 space-y-3">
            {[
              ["ELA", summary?.engine_averages.ela_score ?? 0],
              ["SRM", summary?.engine_averages.srm_score ?? 0],
              ["Noiseprint", summary?.engine_averages.noiseprint_score ?? 0],
              ["DINO", summary?.engine_averages.dino_vit_score ?? 0],
              ["OCR", summary?.engine_averages.ocr_anomaly_score ?? 0],
              [
                "Segmentation",
                summary?.engine_averages.segmentation_score ?? 0,
              ],
            ].map(([label, score]) => (
              <div
                className="flex items-center justify-between rounded-2xl border border-border-color bg-background-light px-4 py-3"
                key={label}
              >
                <span className="text-sm font-bold">{label}</span>
                <span className="text-sm font-bold">
                  {formatPercent(Number(score))}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}
