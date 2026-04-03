import Link from "next/link";
import { fetchDashboardSummary } from "@/lib/api";
import { formatPercent, formatRelativeTime, formatVerdict } from "@/lib/format";

export default async function AnalystDashboardPage() {
  const summary = await fetchDashboardSummary().catch(() => null);

  const total = summary?.total_analyses ?? 0;
  const flagged = (summary?.suspicious_count ?? 0) + (summary?.confirmed_forgery_count ?? 0);
  
  return (
    <div className="min-h-screen flex flex-col antialiased" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", backgroundColor: "#FFFFFF", color: "#121212" }}>
      {/* Global Header — exact clone of investigation_dashboard/code.html line 54-74 */}
      <header className="h-[80px] flex items-center justify-between px-6 lg:px-10 shrink-0 text-white shadow-[0_4px_20px_rgba(0,0,0,0.04)] z-10 relative" style={{ backgroundColor: "#2109aa" }}>
        <div className="flex items-center gap-4 w-1/4">
          <div className="size-8 rounded bg-white/20 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-white text-xl">security</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight whitespace-nowrap">Operational Trust</h1>
        </div>
        <div className="flex-1 max-w-2xl px-4 flex justify-center">
          <div className="w-full relative flex items-center">
            <span className="material-symbols-outlined absolute left-4 text-white/60 pointer-events-none">search</span>
            <input className="w-full h-12 bg-white/10 border-transparent focus:border-white/30 focus:ring-0 rounded-full pl-12 pr-4 text-white placeholder:text-white/60 font-medium text-sm transition-colors" placeholder="Search Document ID..." type="text" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-6 w-1/4">
          <button className="relative text-white/80 hover:text-white transition-colors">
            <span className="material-symbols-outlined">notifications</span>
            {flagged > 0 && <span className="absolute top-0 right-0 size-2.5 rounded-full border-2" style={{ backgroundColor: "#EE2A24", borderColor: "#2109aa" }}></span>}
          </button>
          <div className="size-10 rounded-full bg-cover bg-center border border-white/10 cursor-pointer shrink-0" style={{ backgroundColor: "rgba(244,246,248,0.2)", backgroundImage: "url('https://ui-avatars.com/api/?name=A&background=2109aa&color=fff&bold=true')" }}></div>
        </div>
      </header>

      {/* Main Content — exact clone of investigation_dashboard/code.html line 76-198 */}
      <main className="flex-1 flex flex-col lg:flex-row p-6 lg:p-8 gap-8 overflow-hidden">
        
        {/* Upload Zone (Left 2/3) — line 78-113 */}
        <section className="flex-1 lg:w-2/3 flex flex-col min-h-[400px]">
          <h2 className="text-2xl font-bold mb-6" style={{ color: "#121212" }}>Document Triage</h2>
          <div className="flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-10 transition-colors hover:border-[#2109aa]/40 group relative overflow-hidden" style={{ backgroundColor: "#F4F6F8", borderColor: "#E5E5E5" }}>
            {/* Default State */}
            <div className="flex flex-col items-center justify-center max-w-md text-center z-10">
              <div className="size-20 bg-white rounded-full flex items-center justify-center shadow-[0_4px_20px_rgba(0,0,0,0.04)] mb-6 group-hover:scale-105 transition-transform" style={{ color: "#2109aa" }}>
                <span className="material-symbols-outlined text-4xl">upload_file</span>
              </div>
              <h3 className="text-xl font-bold mb-2" style={{ color: "#121212" }}>Drag and drop suspicious document here</h3>
              <p className="font-medium mb-8" style={{ color: "#737373" }}>Supported formats: PDF, JPEG, PNG, TIFF</p>
              <div className="flex items-center gap-4 w-full mb-8">
                <div className="h-px flex-1" style={{ backgroundColor: "#E5E5E5" }}></div>
                <span className="font-bold text-sm uppercase tracking-wider" style={{ color: "#737373" }}>or</span>
                <div className="h-px flex-1" style={{ backgroundColor: "#E5E5E5" }}></div>
              </div>
              <Link href="/submitter/upload" className="h-14 px-8 hover:opacity-90 text-white rounded-full font-bold text-base transition-colors shadow-[0_4px_20px_rgba(0,0,0,0.04)] flex items-center gap-2" style={{ backgroundColor: "#2109aa" }}>
                <span>Select File</span>
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </Link>
            </div>
            {/* Decorative background element */}
            <div className="absolute top-0 left-0 w-full h-full opacity-5 pointer-events-none flex items-center justify-center">
              <span className="material-symbols-outlined text-[400px]">policy</span>
            </div>
          </div>
        </section>

        {/* Recent Alerts Feed (Right 1/3) — line 114-197 */}
        <aside className="w-full lg:w-1/3 flex flex-col min-w-[320px] max-w-md">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold" style={{ color: "#121212" }}>Recent Alerts</h2>
            <Link href="/analyst/queue" className="font-bold text-sm hover:underline" style={{ color: "#2109aa" }}>View All</Link>
          </div>
          <div className="flex-1 bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col" style={{ border: "1px solid #E5E5E5" }}>
            <div className="flex-1 overflow-y-auto">
              <ul className="flex flex-col">
                {summary && summary.flagged_analyses.length > 0 ? (
                  summary.flagged_analyses.map((item, index) => {
                    const isRed = item.verdict === "CONFIRMED_FORGERY";
                    const dotBg = isRed ? "bg-accent-red" : "bg-accent-amber";
                    const dotShadow = isRed ? "shadow-[0_0_0_4px_rgba(255,45,85,0.1)]" : "shadow-[0_0_0_4px_rgba(255,214,10,0.1)]";

                    return (
                      <li key={item.analysis_id} className="group cursor-pointer" style={index > 0 ? { borderTop: "1px solid #E5E5E5" } : {}}>
                        <Link href={`/analyst/analysis/${item.analysis_id}`} className="flex items-start gap-4 p-5 transition-colors hover:bg-[#F4F6F8]">
                          <div className="mt-1">
                            <div className={`size-3 rounded-full ${dotBg} ${dotShadow}`}></div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between mb-1">
                              <h4 className="font-bold truncate pr-2" style={{ color: "#121212" }}>{item.filename}</h4>
                              <span className="text-xs font-medium shrink-0" style={{ color: "#737373" }}>{formatRelativeTime(item.created_at)}</span>
                            </div>
                            <p className="text-sm font-medium mb-1" style={{ color: "#121212" }}>{formatVerdict(item.verdict)}</p>
                            <p className="text-xs truncate" style={{ color: "#737373" }}>{formatPercent(item.forensic_risk_score)} forensic risk · {item.analysis_id.slice(0, 12)}</p>
                          </div>
                          <span className="material-symbols-outlined self-center transition-colors group-hover:text-[#2109aa]" style={{ color: "#737373" }}>chevron_right</span>
                        </Link>
                      </li>
                    );
                  })
                ) : (
                  <li className="p-8 text-center text-sm font-medium" style={{ color: "#737373" }}>No pending alerts.</li>
                )}
              </ul>
            </div>
            <div className="p-4 text-center" style={{ borderTop: "1px solid #E5E5E5", backgroundColor: "rgba(244,246,248,0.5)" }}>
              <p className="text-xs font-medium" style={{ color: "#737373" }}>
                Showing {summary?.flagged_analyses?.length ?? 0} of {flagged} pending alerts
              </p>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
