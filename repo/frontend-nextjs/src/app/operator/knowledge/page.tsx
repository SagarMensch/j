"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";

type DocRevision = {
  revision_id: string;
  document_id: string;
  code: string;
  title: string;
  document_type: string;
  department_name: string;
  revision_label: string;
  page_count: number;
  approval_status: string;
  effective_from: string | null;
  updated_at: string | null;
};

type DocumentsPayload = {
  documents: DocRevision[];
  total: number;
};

type FilterTab = "all" | "sop" | "manual" | "policy";

function formatDate(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function docTypeVariant(type: string): "default" | "success" | "warning" | "danger" {
  const t = type.toLowerCase();
  if (t.includes("policy")) return "danger";
  if (t.includes("manual")) return "success";
  if (t.includes("wid") || t.includes("work")) return "warning";
  return "default";
}

function docTypeLabel(type: string) {
  const t = type.toUpperCase();
  if (t.includes("POLICY")) return "POLICY";
  if (t.includes("MANUAL")) return "MANUAL";
  if (t.includes("WID") || t.includes("WORK")) return "WID";
  return "SOP";
}

const COPY: Record<AppLanguage, {
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  allTab: string;
  sopTab: string;
  manualTab: string;
  policyTab: string;
  documentCol: string;
  typeCol: string;
  deptCol: string;
  revisionCol: string;
  pagesCol: string;
  updatedCol: string;
  openDoc: string;
  noResults: string;
  noResultsHint: string;
  loading: string;
}> = {
  ENG: {
    title: "Knowledge Base",
    subtitle: "Browse all approved SOPs, manuals, and policies",
    searchPlaceholder: "Search by title or code...",
    allTab: "All",
    sopTab: "SOPs",
    manualTab: "Manuals",
    policyTab: "Policies",
    documentCol: "Document",
    typeCol: "Type",
    deptCol: "Department",
    revisionCol: "Revision",
    pagesCol: "Pages",
    updatedCol: "Updated",
    openDoc: "Open",
    noResults: "No documents found",
    noResultsHint: "Try a different search term or filter",
    loading: "Loading knowledge base...",
  },
  HIN: {
    title: "ज्ञान आधार",
    subtitle: "सभी अनुमोदित SOP, मैनुअल और नीतियां देखें",
    searchPlaceholder: "शीर्षक या कोड से खोजें...",
    allTab: "सभी",
    sopTab: "SOP",
    manualTab: "मैनुअल",
    policyTab: "नीतियां",
    documentCol: "दस्तावेज़",
    typeCol: "प्रकार",
    deptCol: "विभाग",
    revisionCol: "संशोधन",
    pagesCol: "पृष्ठ",
    updatedCol: "अपडेट",
    openDoc: "खोलें",
    noResults: "कोई दस्तावेज़ नहीं मिला",
    noResultsHint: "कोई अलग शब्द या फ़िल्टर आज़माएं",
    loading: "ज्ञान आधार लोड हो रहा है...",
  },
  HING: {
    title: "Knowledge Base",
    subtitle: "Sab approved SOPs, manuals, aur policies dekho",
    searchPlaceholder: "Title ya code se search karo...",
    allTab: "All",
    sopTab: "SOPs",
    manualTab: "Manuals",
    policyTab: "Policies",
    documentCol: "Document",
    typeCol: "Type",
    deptCol: "Department",
    revisionCol: "Revision",
    pagesCol: "Pages",
    updatedCol: "Updated",
    openDoc: "Open",
    noResults: "Koi document nahi mila",
    noResultsHint: "Koi aur search term ya filter try karo",
    loading: "Loading knowledge base...",
  },
};

export default function KnowledgeBasePage() {
  const { user, language } = useAuth();
  const router = useRouter();
  const copy = COPY[language];
  const [documents, setDocuments] = useState<DocRevision[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    async function loadDocuments() {
      try {
        const response = await apiClient.get("/api/documents") as DocumentsPayload;
        if (cancelled) return;
        setDocuments(response.documents || []);
        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load documents.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadDocuments();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const filteredDocuments = useMemo(() => {
    let docs = documents;

    if (activeTab !== "all") {
      docs = docs.filter((d) => {
        const t = d.document_type.toLowerCase();
        if (activeTab === "sop") return !t.includes("manual") && !t.includes("policy") && !t.includes("wid");
        if (activeTab === "manual") return t.includes("manual");
        if (activeTab === "policy") return t.includes("policy");
        return true;
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      docs = docs.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.code.toLowerCase().includes(q) ||
          d.department_name.toLowerCase().includes(q),
      );
    }

    return docs;
  }, [documents, activeTab, searchQuery]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: documents.length, sop: 0, manual: 0, policy: 0 };
    for (const d of documents) {
      const t = d.document_type.toLowerCase();
      if (t.includes("policy")) counts.policy++;
      else if (t.includes("manual")) counts.manual++;
      else counts.sop++;
    }
    return counts;
  }, [documents]);

  if (isLoading) {
    return (
      <OperatorLayout>
        <div className="mx-auto max-w-[1520px] px-4 py-6">
          <Card>
            <div className="py-12 text-center text-muted">
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <p>{copy.loading}</p>
            </div>
          </Card>
        </div>
      </OperatorLayout>
    );
  }

  return (
    <OperatorLayout>
      <div className="mx-auto max-w-[1520px] px-4 py-6 space-y-6">
        <div className="rounded-[28px] bg-white px-6 py-6 shadow-[0_16px_34px_rgba(0,25,168,0.05)]">
          <h1 className="text-2xl font-bold tracking-[-0.03em] text-foreground">{copy.title}</h1>
          <p className="mt-1 text-sm text-muted">{copy.subtitle}</p>
        </div>

        <Card>
          <div className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-2">
                {(["all", "sop", "manual", "policy"] as FilterTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                      activeTab === tab
                        ? "bg-primary text-white"
                        : "bg-muted-light text-muted hover:bg-muted"
                    }`}
                  >
                    {tab === "all" ? copy.allTab : tab === "sop" ? copy.sopTab : tab === "manual" ? copy.manualTab : copy.policyTab}
                    <span className="ml-1 opacity-70">{typeCounts[tab]}</span>
                  </button>
                ))}
              </div>
              <div className="w-full sm:w-72">
                <Input
                  placeholder={copy.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  icon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  }
                />
              </div>
            </div>

            {error ? (
              <p className="text-sm text-danger">{error}</p>
            ) : filteredDocuments.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm font-semibold text-muted">{copy.noResults}</p>
                <p className="mt-1 text-xs text-muted">{copy.noResultsHint}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted">{copy.documentCol}</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted">{copy.typeCol}</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted">{copy.deptCol}</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted">{copy.revisionCol}</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted">{copy.pagesCol}</th>
                      <th className="text-left py-3 px-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted">{copy.updatedCol}</th>
                      <th className="py-3 px-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredDocuments.map((doc) => (
                      <tr key={doc.revision_id} className="hover:bg-muted-light/40 transition-colors">
                        <td className="py-3 px-3">
                          <p className="font-semibold text-foreground">{doc.title}</p>
                          <p className="mt-0.5 font-mono text-xs text-primary">{doc.code}</p>
                        </td>
                        <td className="py-3 px-3">
                          <Badge variant={docTypeVariant(doc.document_type)} size="sm">
                            {docTypeLabel(doc.document_type)}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-muted">{doc.department_name || "-"}</td>
                        <td className="py-3 px-3 font-mono text-xs">{doc.revision_label}</td>
                        <td className="py-3 px-3 text-muted">{doc.page_count || "-"}</td>
                        <td className="py-3 px-3 text-muted">{formatDate(doc.updated_at)}</td>
                        <td className="py-3 px-3">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => router.push(`/operator/reader/${doc.revision_id}?page=1`)}
                          >
                            {copy.openDoc}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      </div>
    </OperatorLayout>
  );
}