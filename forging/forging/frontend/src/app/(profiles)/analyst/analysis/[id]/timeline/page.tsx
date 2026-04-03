import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchAnalysis } from "@/lib/api";
import { buildTimelineEvents } from "@/lib/case-view";
import { formatDateTime } from "@/lib/format";

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const analysis = await fetchAnalysis(id).catch(() => null);

  if (!analysis) {
    notFound();
  }

  const events = buildTimelineEvents(analysis);

  return (
    <div className="flex min-h-screen flex-col bg-white text-text-main">
      <header className="sticky top-0 z-50 flex h-20 items-center bg-primary px-6 text-white shadow-subtle">
        <Link className="flex items-center gap-2 transition-opacity hover:opacity-80" href={`/analyst/analysis/${analysis.analysis_id}`}>
          <span className="material-symbols-outlined text-2xl">arrow_back</span>
          <span className="text-lg font-bold tracking-wide">Back to Analysis</span>
        </Link>
        <div className="ml-auto text-xl font-bold tracking-wide">Timeline</div>
      </header>

      <main className="flex flex-1 justify-center bg-background-light px-6 py-8">
        <div className="w-full max-w-3xl rounded-[24px] border border-border-color bg-white p-8 shadow-subtle">
          <div className="mb-8 border-b border-border-color pb-4">
            <h1 className="mb-2 text-3xl font-bold">Investigation Timeline</h1>
            <p className="font-medium text-muted">{analysis.filename} · recorded at {formatDateTime(analysis.created_at)}</p>
          </div>

          <div className="relative pl-4">
            <div className="absolute bottom-4 left-[23px] top-4 w-[2px] bg-border-color"></div>
            {events.map((event, index) => (
              <div className={`relative flex items-start gap-6 ${index < events.length - 1 ? "mb-8" : ""}`} key={`${event.title}-${index}`}>
                <div className={`absolute left-[-5px] top-1 z-10 h-4 w-4 rounded-full border-4 border-white ${event.tone === "primary" ? "bg-primary" : event.tone === "accent-red" ? "bg-accent-red" : event.tone === "accent-amber" ? "bg-accent-amber" : "bg-muted"}`}></div>
                <div className={`ml-8 flex-1 overflow-hidden rounded-xl border bg-background-light p-4 ${event.tone === "accent-red" ? "border-accent-red/30" : "border-border-color"}`}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className={`material-symbols-outlined ${event.tone === "primary" ? "text-primary" : event.tone === "accent-red" ? "text-accent-red" : event.tone === "accent-amber" ? "text-[#b45309]" : "text-muted"}`}>
                      {event.icon}
                    </span>
                    <h3 className={`text-lg font-bold ${event.tone === "accent-red" ? "text-accent-red" : "text-text-main"}`}>{event.title}</h3>
                  </div>
                  <p className="mb-2 text-sm font-bold text-text-main">{formatDateTime(event.timestamp)}</p>
                  <p className="text-sm font-medium text-muted">{event.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
