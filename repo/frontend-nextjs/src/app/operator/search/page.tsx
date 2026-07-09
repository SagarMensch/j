"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";

type Scope = "all" | "documents" | "runs" | "training" | "people";

type SearchHit = {
  type: "document" | "run" | "training" | "person";
  rank: number;
  title: string;
  snippet: string;
  url?: string | null;
  citation_label?: string;
  document_code?: string;
  module_id?: string;
  run_id?: string;
  user_id?: string;
};

type SearchApiResponse = {
  query: string;
  scope: string;
  result_count: number;
  results: SearchHit[];
  latency_ms: number;
};

type Copy = {
  workspaceTag: string;
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  scopeAll: string;
  scopeDocuments: string;
  scopeRuns: string;
  scopeTraining: string;
  scopePeople: string;
  search: string;
  searching: string;
  empty: string;
  emptyHint: string;
  noResults: string;
  noResultsHint: string;
  open: string;
  latency: (ms: number) => string;
  resultTypes: Record<SearchHit["type"], string>;
};

const COPY: Record<AppLanguage, Copy> = {
  ENG: {
    workspaceTag: "Search",
    title: "Universal Search",
    subtitle: "One search across documents, run history, training modules, and people.",
    searchPlaceholder: "Search equipment, procedures, people, training...",
    scopeAll: "All",
    scopeDocuments: "Documents",
    scopeRuns: "Runs",
    scopeTraining: "Training",
    scopePeople: "People",
    search: "Search",
    searching: "Searching...",
    empty: "Start typing to search.",
    emptyHint: "Try a procedure name, an equipment ID, or a colleague's name.",
    noResults: "No matches.",
    noResultsHint: "Try a different scope or rephrase your query.",
    open: "Open",
    latency: (ms) => `${ms} ms`,
    resultTypes: { document: "Document", run: "Run", training: "Training", person: "Person" },
  },
  HIN: {
    workspaceTag: "खोज",
    title: "सार्वभौमिक खोज",
    subtitle: "दस्तावेज़ों, रन इतिहास, प्रशिक्षण मॉड्यूल और लोगों में एक खोज।",
    searchPlaceholder: "उपकरण, प्रक्रिया, लोग, प्रशिक्षण खोजें...",
    scopeAll: "सभी",
    scopeDocuments: "दस्तावेज़",
    scopeRuns: "रन",
    scopeTraining: "प्रशिक्षण",
    scopePeople: "लोग",
    search: "खोज",
    searching: "खोज रहे हैं...",
    empty: "खोजना शुरू करने के लिए टाइप करें।",
    emptyHint: "प्रक्रिया का नाम, उपकरण आईडी, या सहकर्मी का नाम आज़माएँ।",
    noResults: "कोई मिलान नहीं।",
    noResultsHint: "अलग स्कोप आज़माएँ।",
    open: "खोलें",
    latency: (ms) => `${ms} मि.से.`,
    resultTypes: { document: "दस्तावेज़", run: "रन", training: "प्रशिक्षण", person: "व्यक्ति" },
  },
  HING: {
    workspaceTag: "Search",
    title: "Universal Search",
    subtitle: "Documents, runs, training, aur people — sab ek jagah search karo.",
    searchPlaceholder: "Equipment, procedure, log, training search karo...",
    scopeAll: "Sab",
    scopeDocuments: "Docs",
    scopeRuns: "Runs",
    scopeTraining: "Training",
    scopePeople: "People",
    search: "Search",
    searching: "Searching...",
    empty: "Type karke start karo.",
    emptyHint: "Procedure name, equipment ID, ya colleague ka naam try karo.",
    noResults: "Koi match nahi.",
    noResultsHint: "Alag scope try karo ya query rephrase karo.",
    open: "Open",
    latency: (ms) => `${ms} ms`,
    resultTypes: { document: "Document", run: "Run", training: "Training", person: "Person" },
  },
};

const TYPE_COLOR: Record<SearchHit["type"], string> = {
  document: "bg-[#0019a8] text-white",
  run: "bg-[#00782a] text-white",
  training: "bg-[#ffd329] text-[#1a1a1a]",
  person: "bg-[#dc241f] text-white",
};

export default function SearchPage() {
  const { user, language } = useAuth();
  const copy = COPY[language];
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setIsLoading(false);
      setHasSearched(false);
      setError("");
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(query, scope);
    }, 220);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, scope, user?.id]);

  async function runSearch(q: string, s: Scope) {
    if (!user?.id) return;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsLoading(true);
    setError("");
    setHasSearched(true);
    try {
      const payload = (await apiClient.get(
        `/api/search?q=${encodeURIComponent(q)}&user_id=${encodeURIComponent(user.id)}&scope=${s}&limit=20`,
      )) as SearchApiResponse;
      if (ctrl.signal.aborted) return;
      setResults(payload.results || []);
      setLatency(payload.latency_ms);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Search failed.");
      setResults([]);
    } finally {
      if (!ctrl.signal.aborted) setIsLoading(false);
    }
  }

  return (
    <OperatorLayout>
      <div className="mx-auto max-w-[1520px] px-4 py-6 space-y-6">
        <div className="hero-panel p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{copy.workspaceTag}</p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">{copy.title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">{copy.subtitle}</p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[280px]">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={copy.searchPlaceholder}
                className="w-full rounded-[12px] border border-border bg-white px-4 py-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                autoFocus
              />
            </div>
            <div className="inline-flex items-center rounded-full border border-border bg-white p-1">
              {(["all", "documents", "runs", "training", "people"] as Scope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                    scope === s ? "bg-primary text-white" : "text-muted hover:text-foreground"
                  }`}
                >
                  {s === "all" ? copy.scopeAll : s === "documents" ? copy.scopeDocuments : s === "runs" ? copy.scopeRuns : s === "training" ? copy.scopeTraining : copy.scopePeople}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error ? (
          <Card>
            <p className="py-2 text-sm text-danger">{error}</p>
          </Card>
        ) : null}

        {!hasSearched ? (
          <Card>
            <div className="py-8 text-center">
              <p className="text-sm font-semibold text-foreground">{copy.empty}</p>
              <p className="mt-1 text-xs text-muted">{copy.emptyHint}</p>
            </div>
          </Card>
        ) : isLoading ? (
          <Card>
            <div className="flex items-center gap-3 py-4 text-sm text-muted">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              {copy.searching}
            </div>
          </Card>
        ) : results.length === 0 ? (
          <Card>
            <div className="py-8 text-center">
              <p className="text-sm font-semibold text-foreground">{copy.noResults}</p>
              <p className="mt-1 text-xs text-muted">{copy.noResultsHint}</p>
            </div>
          </Card>
        ) : (
          <Card>
            <div className="mb-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              <span>{results.length} results</span>
              {latency !== null ? <span>{copy.latency(latency)}</span> : null}
            </div>
            <ul className="divide-y divide-border/60">
              {results.map((hit) => (
                <li key={`${hit.type}-${hit.rank}-${hit.title}`} className="py-3">
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${TYPE_COLOR[hit.type]}`}>
                      {copy.resultTypes[hit.type]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{hit.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted">{hit.snippet}</p>
                      {hit.citation_label ? (
                        <p className="mt-1 text-[10px] font-mono text-muted">{hit.citation_label}</p>
                      ) : null}
                    </div>
                    {hit.url ? (
                      <Link
                        href={hit.url}
                        className="shrink-0 rounded-[10px] border border-border bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary transition-colors hover:border-primary/30 hover:bg-primary/5"
                      >
                        {copy.open}
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </OperatorLayout>
  );
}
