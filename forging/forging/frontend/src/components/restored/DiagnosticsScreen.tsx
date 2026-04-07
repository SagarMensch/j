import Link from "next/link";
import { MaterialSymbol } from "@/components/ui/MaterialSymbol";
import { AnalysisTabs } from "./AnalysisTabs";

const diagnosticsCards = [
  { name: "OCR Processor", icon: "document_scanner", latency: "Latency: 12ms", status: "Online", dot: "accent-green" },
  { name: "EXIF Analyzer", icon: "data_object", latency: "Latency: 8ms", status: "Online", dot: "accent-green" },
  { name: "Pixel Heuristics", icon: "layers", latency: "Latency: 145ms", status: "Warning", dot: "accent-amber" },
  { name: "Signature Auth", icon: "fingerprint", latency: "Latency: 22ms", status: "Online", dot: "accent-green" },
  { name: "Source Routing", icon: "hub", latency: "Latency: 45ms", status: "Online", dot: "accent-green" },
] as const;

export function DiagnosticsScreen({
  caseId,
  nested = false,
}: {
  caseId?: string;
  nested?: boolean;
}) {
  const diagnosticsTab = caseId ? (
    <AnalysisTabs caseId={caseId} active="diagnostics" />
  ) : (
    <div className="border-b border-border-color bg-white px-6 pb-3 pt-4 rounded-tl-[24px]">
      <div className="flex gap-8">
        {["Status", "Evidence", "Diagnostics", "Timeline"].map((tab) => (
          <div
            key={tab}
            className={`flex flex-col items-center justify-center border-b-[4px] pb-[12px] ${tab === "Diagnostics" ? "border-primary text-text-main" : "border-transparent text-muted"}`}
          >
            <p className="text-sm font-bold leading-normal tracking-[0.015em]">{tab}</p>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-full flex-col antialiased">
      {!nested && (
        <div className="relative z-50 flex h-auto w-full flex-col bg-background-light">
          <div className="flex flex-1 justify-center px-4 py-5 xl:px-40">
            <div className="flex w-full max-w-[960px] flex-1 flex-col">
              <header className="flex items-center justify-between whitespace-nowrap rounded-t-[24px] border-b border-border-color bg-white px-6 py-3 shadow-subtle xl:px-10">
                <div className="flex items-center gap-8">
                  <div className="flex items-center gap-4 text-text-main">
                    <div className="size-4 text-primary">
                      <svg fill="none" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                        <g clipPath="url(#clip0_6_319)">
                          <path d="M8.57829 8.57829C5.52816 11.6284 3.451 15.5145 2.60947 19.7452C1.76794 23.9758 2.19984 28.361 3.85056 32.3462C5.50128 36.3314 8.29667 39.7376 11.8832 42.134C15.4698 44.5305 19.6865 45.8096 24 45.8096C28.3135 45.8096 32.5302 44.5305 36.1168 42.134C39.7033 39.7375 42.4987 36.3314 44.1494 32.3462C45.8002 28.361 46.2321 23.9758 45.3905 19.7452C44.549 15.5145 42.4718 11.6284 39.4217 8.57829L24 24L8.57829 8.57829Z" fill="currentColor"></path>
                        </g>
                        <defs>
                          <clipPath id="clip0_6_319">
                            <rect fill="white" height="48" width="48"></rect>
                          </clipPath>
                        </defs>
                      </svg>
                    </div>
                    <h2 className="text-lg font-bold leading-tight tracking-[-0.015em]">SequelForensics</h2>
                  </div>
                  <label className="flex min-w-40 max-w-64 flex-col">
                    <div className="flex h-10 w-full items-stretch rounded-full bg-surface">
                      <div className="flex items-center justify-center rounded-l-full pl-4 text-muted">
                        <MaterialSymbol icon="search" className="text-xl" />
                      </div>
                      <input className="h-full w-full rounded-r-full border-none bg-transparent px-4 pl-2 text-base font-medium text-text-main outline-none placeholder:text-muted" placeholder="Search" />
                    </div>
                  </label>
                </div>
                <div className="flex flex-1 justify-end gap-8">
                  <div
                    className="size-10 rounded-full bg-cover bg-center"
                    style={{
                      backgroundImage:
                        "url('https://lh3.googleusercontent.com/aida-public/AB6AXuChu5CN8UFoIbRODcCwk4elWbshD7hP_uRD_WuqG2sQAoHFJH6BZvo7SBRcEeUks6pWAXDffpI_z-Yx_Yg9Yrz3RjxoZp8C1i-D-SfK1oj7mexJWqbU6RsEoTMinxhcuIHn77OsP93jOZMWU-uBDGrrb47jUOUXZW2LeQ09Yb6-DhP_MtFF2y623nnz_8IcwPrWJnPW95qPDv5lqtZmtBWro-Zby7BkpV2em66MYuz9p0yL0pf6xSYFxvR_cDha8XvX9rJMU-Yr6wc')",
                    }}
                  />
                </div>
              </header>
            </div>
          </div>
        </div>
      )}

      <main className="flex flex-1 overflow-hidden">
        <section className="relative flex h-full w-[60%] items-center justify-center overflow-hidden border-r border-border-color bg-white">
          <div className="relative flex h-3/4 w-3/4 items-center justify-center rounded-[24px] border-2 border-dashed border-border-color bg-surface shadow-sm">
            <span className="font-medium text-muted">Document Preview Canvas</span>
            <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-full border border-border-color bg-surface px-4 shadow-subtle">
              <button className="flex h-8 w-8 items-center justify-center rounded-full text-text-main transition-colors hover:bg-white hover:text-primary">
                <MaterialSymbol icon="zoom_out" />
              </button>
              <span className="text-sm font-bold text-text-main">100%</span>
              <button className="flex h-8 w-8 items-center justify-center rounded-full text-text-main transition-colors hover:bg-white hover:text-primary">
                <MaterialSymbol icon="zoom_in" />
              </button>
              <div className="mx-2 h-6 w-px bg-border-color"></div>
              <button className="flex h-8 w-8 items-center justify-center rounded-full text-text-main transition-colors hover:bg-white hover:text-primary">
                <MaterialSymbol icon="pan_tool" />
              </button>
            </div>
          </div>
        </section>

        <aside className="z-10 flex h-full w-[40%] flex-col rounded-tl-[24px] bg-white shadow-[-4px_0_24px_rgba(0,0,0,0.02)]">
          {diagnosticsTab}
          <div className="flex-1 overflow-y-auto bg-background-light p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-2xl font-bold leading-tight tracking-[-0.015em] text-text-main">System Health</h3>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent-green"></span>
                <span className="text-sm font-bold text-muted">All Systems Nominal</span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {diagnosticsCards.map((card) => (
                <div
                  key={card.name}
                  className={`relative flex h-[160px] cursor-pointer flex-col justify-between overflow-hidden rounded-[16px] border bg-white p-5 transition-all ${card.status === "Warning" ? "border-accent-amber hover:shadow-subtle" : "border-border-color hover:border-primary hover:shadow-subtle"}`}
                >
                  {card.status === "Warning" && <div className="absolute -right-8 -top-8 h-16 w-16 rounded-bl-full bg-accent-amber/10"></div>}
                  <div className="relative z-10 flex justify-between">
                    <div className={`transition-colors ${card.status === "Warning" ? "text-accent-amber" : "text-text-main group-hover:text-primary"}`}>
                      <MaterialSymbol icon={card.icon} className="text-4xl" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-bold ${card.status === "Warning" ? "text-accent-amber" : "text-muted"}`}>{card.status}</span>
                      <span className={`h-2 w-2 rounded-full ${card.dot === "accent-green" ? "bg-accent-green" : "bg-accent-amber"}`}></span>
                    </div>
                  </div>
                  <div className="relative z-10">
                    <h4 className="mb-1 text-base font-bold text-text-main">{card.name}</h4>
                    <p className={`text-sm ${card.status === "Warning" ? "font-bold text-accent-amber" : "font-medium text-muted"}`}>{card.latency}</p>
                  </div>
                </div>
              ))}
            </div>
            {caseId && (
              <div className="mt-6">
                <Link href={`/analyst/analysis/${caseId}`} className="text-sm font-bold text-primary hover:underline">
                  Back to case status
                </Link>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
