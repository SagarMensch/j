import {
  fetchDevOpsMonitoring,
  fetchHealth,
  fetchModelInfo,
  fetchDevOpsTelemetry,
} from "@/lib/api";
import { formatDateTime, formatPercent } from "@/lib/format";

export default async function DevopsDashboardPage() {
  const [health, modelInfo, telemetry, monitoring] = await Promise.all([
    fetchHealth().catch(() => null),
    fetchModelInfo().catch(() => null),
    fetchDevOpsTelemetry().catch(() => []),
    fetchDevOpsMonitoring().catch(() => null),
  ]);

  const cards = [
    {
      label: "Model Package",
      value: modelInfo?.model_loaded ? "Primary checkpoint active" : "Model attention required",
      detail: health?.checkpoint_exists
        ? "The production review package is available to the service."
        : "The service cannot find the current checkpoint package.",
    },
    {
      label: "Analysis Backbone",
      value: modelInfo?.selected_encoder
        ? formatEncoderName(modelInfo.selected_encoder)
        : "Backbone unavailable",
      detail:
        modelInfo?.input_channels != null
          ? `${modelInfo.input_channels}-channel forensic review stack configured.`
          : "Backbone configuration is not available.",
    },
    {
      label: "Case Storage",
      value: health?.database_ready ? "Case datastore online" : "Datastore unavailable",
      detail: health?.database_ready
        ? "Queue, history, and persistence services are responding."
        : "Case persistence needs attention before review can continue.",
    },
    {
      label: "Serving Profile",
      value: health?.status === "ok" ? "Ready for intake" : "Service attention required",
      detail: buildRuntimeDetail(modelInfo?.device),
    },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background-light text-text-main">
      <header className="border-b border-border-color bg-white px-6 py-6 shadow-subtle lg:px-10">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">
          DevOps
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          System health
        </h1>
      </header>

      <main className="grid flex-1 gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:p-8">
        <section className="rounded-[28px] border border-border-color bg-white p-6 shadow-subtle">
          <div className="grid gap-4 md:grid-cols-2">
            {cards.map((card) => (
              <div
                className="rounded-[24px] border border-border-color bg-background-light p-5"
                key={card.label}
              >
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                  {card.label}
                </p>
                <p className="mt-4 text-2xl font-bold tracking-tight leading-tight">
                  {card.value}
                </p>
                <p className="mt-3 text-sm font-medium text-muted">
                  {card.detail}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-[24px] border border-border-color bg-background-light p-5">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                Model Release
              </p>
              <p className="mt-4 text-base font-bold">
                {modelInfo?.model_loaded
                  ? "Production checkpoint synced"
                  : "Checkpoint unavailable"}
              </p>
              <p className="mt-2 text-sm font-medium text-muted">
                {health?.checkpoint_exists
                  ? "The active model package is available for live review."
                  : "The service needs a valid checkpoint file before it can accept cases."}
              </p>
            </div>
            <div className="rounded-[24px] border border-border-color bg-background-light p-5">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                Review Stack
              </p>
              <p className="mt-4 text-base font-bold">
                {modelInfo?.selected_encoder
                  ? `${formatEncoderName(modelInfo.selected_encoder)} backbone`
                  : "Configuration unavailable"}
              </p>
              <p className="mt-2 text-sm font-medium text-muted">
                {modelInfo?.input_channels != null
                  ? `${modelInfo.input_channels} forensic input channels are active.`
                  : "Input channel metadata is unavailable."}
              </p>
            </div>
          </div>

          <div className="mt-8 rounded-[24px] border border-border-color bg-background-light p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                  Serving Calibration
                </p>
                <h2 className="mt-2 text-xl font-bold tracking-tight">
                  Threshold and benchmark profile
                </h2>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  monitoring?.calibration_loaded
                    ? "bg-accent-green/10 text-accent-green"
                    : "bg-accent-amber/10 text-accent-amber"
                }`}
              >
                {monitoring?.calibration_loaded ? "Loaded" : "Not Loaded"}
              </span>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-border-color bg-white px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted">
                  Samples
                </p>
                <p className="mt-1 text-lg font-bold">
                  {monitoring?.calibration_sample_count ?? 0}
                </p>
              </div>
              <div className="rounded-2xl border border-border-color bg-white px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted">
                  Mean IoU
                </p>
                <p className="mt-1 text-lg font-bold">
                  {monitoring?.calibration_mean_iou != null
                    ? formatPercent(monitoring.calibration_mean_iou)
                    : "Unavailable"}
                </p>
              </div>
              <div className="rounded-2xl border border-border-color bg-white px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted">
                  Mean F1
                </p>
                <p className="mt-1 text-lg font-bold">
                  {monitoring?.calibration_mean_f1 != null
                    ? formatPercent(monitoring.calibration_mean_f1)
                    : "Unavailable"}
                </p>
              </div>
            </div>
            <p className="mt-4 text-sm font-medium text-muted">
              Generated{" "}
              {monitoring?.calibration_generated_at
                ? formatDateTime(monitoring.calibration_generated_at)
                : "not yet benchmarked"}
            </p>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-[28px] border border-border-color bg-white p-6 shadow-subtle">
            <h2 className="text-2xl font-bold tracking-tight">
              Runtime Overview
            </h2>
            <div className="mt-6 grid gap-3">
              {[
                ["Total Analyses", `${monitoring?.total_analyses ?? 0}`],
                ["Warning Rate", formatPercent(monitoring?.warning_rate ?? 0)],
                ["P50 Runtime", `${Math.round(monitoring?.p50_processing_time_ms ?? 0)}ms`],
                ["P95 Runtime", `${Math.round(monitoring?.p95_processing_time_ms ?? 0)}ms`],
              ].map(([label, value]) => (
                <div
                  className="flex items-center justify-between rounded-2xl border border-border-color bg-background-light px-4 py-3"
                  key={label}
                >
                  <span className="text-sm font-bold uppercase tracking-widest text-muted">
                    {label}
                  </span>
                  <span className="text-sm font-bold text-text-main">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-border-color bg-white p-6 shadow-subtle">
          <h2 className="text-2xl font-bold tracking-tight">
            Service Activity
          </h2>
          <div className="mt-6 space-y-3">
            {telemetry.length === 0 ? (
              <p className="text-sm text-muted text-center py-10">No recent activity recorded.</p>
            ) : (
              telemetry.map((layer) => (
                <div
                  className="flex items-center justify-between rounded-2xl border border-border-color bg-background-light px-4 py-3"
                  key={layer.layer_name}
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-bold uppercase tracking-widest">{layer.layer_name.replace(/_/g, " ")}</span>
                    <span className="text-xs font-medium text-muted mt-1">{layer.execution_count} runs</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-sm font-bold tracking-widest text-[#0019a8]">
                      {Math.round(layer.avg_processing_ms)}ms
                    </span>
                    <span className="text-xs font-medium text-muted mt-1">{formatPercent(layer.avg_confidence_score)} avg.</span>
                  </div>
                </div>
              ))
            )}
          </div>
          </div>

          <div className="rounded-[28px] border border-border-color bg-white p-6 shadow-subtle">
            <h2 className="text-2xl font-bold tracking-tight">
              Recent Warnings
            </h2>
            <div className="mt-6 space-y-3">
              {(monitoring?.recent_warning_events ?? []).length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  No recent system notes recorded.
                </p>
              ) : (
                monitoring?.recent_warning_events.map((event) => (
                  <div
                    className="rounded-2xl border border-border-color bg-background-light px-4 py-3"
                    key={`${event.analysis_id}-${event.warning}`}
                  >
                    <p className="text-sm font-bold">{event.filename}</p>
                    <p className="mt-1 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                      {event.analysis_id}
                    </p>
                    <p className="mt-3 text-sm font-medium text-text-main">
                      {event.warning}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

function formatEncoderName(value: string) {
  return value.replaceAll("_", " ").toUpperCase();
}

function buildRuntimeDetail(device: string | null | undefined) {
  if (device === "cuda") {
    return "Hardware acceleration is active for the live serving profile.";
  }
  if (device === "cpu") {
    return "The service is running on the standard compute lane.";
  }
  return "The runtime profile is available, but device metadata is limited.";
}
