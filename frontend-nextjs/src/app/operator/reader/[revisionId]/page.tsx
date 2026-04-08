"use client";

import React, { FormEvent, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DocumentStackIcon } from "@/components/ui/icons";
import { apiClient, API_BASE_URL } from "@/lib/api";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/telemetry";

type ReaderCopy = {
  title: string;
  subtitle: string;
  docPanelTitle: string;
  chatPanelTitle: string;
  askPlaceholder: string;
  askButton: string;
  queryError: string;
  loadingPage: string;
  noPreview: string;
  docSelectLabel: string;
};

type DocumentSummary = {
  id: string;
  code: string;
  title: string;
  department: string;
  revision_id: string;
  revision: string;
  pages: number;
  lastUpdated: string;
  status: string;
};

type PagePayload = {
  page: {
    page_number: number;
    image_path?: string | null;
    image_url?: string | null;
  };
};

type QueryEvidencePayload = {
  chunk_id: string;
  document_code?: string;
  document_title?: string;
  revision_id?: string;
  revision_label?: string;
  page_start?: number;
  page_end?: number;
  citation_label?: string;
  section_title?: string;
  line_start?: number | null;
  line_end?: number | null;
};

type QueryApiResponse = {
  answer: string;
  conversation_id?: string;
  evidence?: QueryEvidencePayload[];
};

type ConversationSummaryPayload = {
  id: string;
  user_id: string;
  title: string;
  language: string;
  status: string;
  chat_scope?: "general" | "reader";
  revision_id?: string | null;
  message_count: number;
  preview?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_message_at?: string | null;
};

type ConversationMessagePayload = {
  id: string;
  role: string;
  content: string;
  language?: string | null;
  citations?: QueryEvidencePayload[];
  query_text?: string | null;
  retrieval_event_id?: string | null;
  response_mode?: string;
  created_at?: string | null;
};

type ConversationDetailPayload = {
  conversation: ConversationSummaryPayload;
  messages: ConversationMessagePayload[];
};

type CitationType = {
  chunkId: string;
  documentCode: string;
  documentTitle: string;
  revisionId: string;
  revisionLabel?: string;
  pageStart: number;
  pageEnd?: number;
  sectionTitle?: string;
  lineStart?: number | null;
  lineEnd?: number | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: CitationType[];
};

const COPY: Record<AppLanguage, ReaderCopy> = {
  ENG: {
    title: "Reader Workspace",
    subtitle:
      "Select a company document, read it on the left, and ask naturally on the right.",
    docPanelTitle: "Document Reader",
    chatPanelTitle: "Chat",
    askPlaceholder: "Ask anything about the selected document...",
    askButton: "Ask",
    queryError: "Could not connect to backend right now.",
    loadingPage: "Loading page...",
    noPreview: "Page preview not available for this revision/page.",
    docSelectLabel: "Document",
  },
  HIN: {
    title: "Reader Workspace",
    subtitle:
      "Company document select karein, left mein padhein aur right mein naturally poochein.",
    docPanelTitle: "Document Reader",
    chatPanelTitle: "Chat",
    askPlaceholder: "Selected document ke baare mein kuch bhi poochein...",
    askButton: "Poochhein",
    queryError: "Abhi backend se connect nahi ho pa raha.",
    loadingPage: "Page load ho raha hai...",
    noPreview: "Is revision/page ke liye page preview available nahi hai.",
    docSelectLabel: "Document",
  },
  HING: {
    title: "Reader Workspace",
    subtitle:
      "Company document select karo, left mein padho aur right mein naturally pucho.",
    docPanelTitle: "Document Reader",
    chatPanelTitle: "Chat",
    askPlaceholder: "Selected document ke baare mein kuch bhi pucho...",
    askButton: "Pucho",
    queryError: "Abhi backend se connect nahi ho pa raha.",
    loadingPage: "Page load ho raha hai...",
    noPreview: "Is revision/page ke liye page preview available nahi hai.",
    docSelectLabel: "Document",
  },
};

function normalizeApiAssetUrl(url?: string | null) {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${API_BASE_URL}${url.startsWith("/") ? url : `/${url}`}`;
}

function parsePositiveInt(value: string | null | undefined, fallback = 1) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function formatCitationLabel(citation: CitationType) {
  const lineStart = citation.lineStart;
  const lineEnd = citation.lineEnd;
  const lineLabel =
    lineStart == null
      ? "l.-"
      : lineEnd != null && lineEnd !== lineStart
        ? `l.${lineStart}-${lineEnd}`
        : `l.${lineStart}`;
  return `${citation.documentCode} | p.${citation.pageStart} ${lineLabel}`;
}

export default function OperatorReaderPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, language } = useAuth();

  const revisionId = params.revisionId as string;
  const copy = COPY[language];
  const initialPage = parsePositiveInt(searchParams.get("page"), 1);
  const initialConversationId = searchParams.get("conversation_id");

  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [pageInput, setPageInput] = useState(String(initialPage));
  const [pagePayload, setPagePayload] = useState<PagePayload | null>(null);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");

  const [question, setQuestion] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId || null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeCitation, setActiveCitation] = useState<CitationType | null>(
    null,
  );
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fallbackCode = searchParams.get("code") || "DOCUMENT";
  const fallbackTitle = searchParams.get("title") || "Approved Revision";
  const documentMeta =
    documents.find((doc) => doc.revision_id === revisionId) || null;
  const totalPages = Number(documentMeta?.pages || 0);
  const pageImageUrl = normalizeApiAssetUrl(pagePayload?.page.image_url);

  const mapCitationPayload = (ev: QueryEvidencePayload): CitationType => ({
    chunkId: ev.chunk_id,
    documentCode: ev.document_code || fallbackCode,
    documentTitle: ev.document_title || fallbackTitle,
    revisionId: ev.revision_id || revisionId,
    revisionLabel: ev.revision_label || "-",
    pageStart: ev.page_start || 1,
    pageEnd: ev.page_end || ev.page_start || 1,
    sectionTitle: ev.section_title || "",
    lineStart: ev.line_start ?? null,
    lineEnd: ev.line_end ?? null,
  });
  const mapConversationMessage = (
    message: ConversationMessagePayload,
  ): ChatMessage => ({
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    content: message.content,
    citations: (message.citations || []).map(mapCitationPayload),
  });

  function goToPage(nextPage: number) {
    const upperBound = totalPages > 0 ? totalPages : Number.MAX_SAFE_INTEGER;
    const bounded = Math.min(Math.max(nextPage, 1), upperBound);
    setPageNumber(bounded);
    setPageInput(String(bounded));
  }

  function openRevision(
    nextRevisionId: string,
    startPage = 1,
    nextConversationId?: string | null,
  ) {
    const target = documents.find((doc) => doc.revision_id === nextRevisionId);
    const next = new URLSearchParams({
      page: String(startPage),
      code: target?.code || "",
      title: target?.title || "",
    });
    if (nextConversationId) {
      next.set("conversation_id", nextConversationId);
    }
    router.push(`/operator/reader/${nextRevisionId}?${next.toString()}`);
  }

  function jumpToCitation(citation: CitationType) {
    setActiveCitation(citation);
    const targetPage = citation.pageStart || 1;

    if (citation.revisionId && citation.revisionId !== revisionId) {
      openRevision(citation.revisionId, targetPage, conversationId);
      return;
    }

    goToPage(targetPage);
  }

  useEffect(() => {
    const requestedPage =
      typeof window === "undefined"
        ? 1
        : parsePositiveInt(
            new URLSearchParams(window.location.search).get("page"),
            1,
          );
    setPageNumber(requestedPage);
    setPageInput(String(requestedPage));
    setConversationId(initialConversationId || null);
    setMessages([]);
    setActiveCitation(null);
  }, [revisionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;

    const loadDocuments = async () => {
      try {
        const payload = (await apiClient.get("/api/documents")) as {
          documents?: DocumentSummary[];
        };
        if (cancelled) return;
        const docs = payload.documents || [];
        setDocuments(docs);

        const exists = docs.some((doc) => doc.revision_id === revisionId);
        if (!exists && docs[0]?.revision_id) {
          const first = docs[0];
          const next = new URLSearchParams({
            page: "1",
            code: first.code || "",
            title: first.title || "",
          });
          router.replace(`/operator/reader/${first.revision_id}?${next.toString()}`);
        }
      } catch {
        if (!cancelled) {
          setDocuments([]);
        }
      }
    };

    void loadDocuments();
    return () => {
      cancelled = true;
    };
  }, [revisionId, router]);

  useEffect(() => {
    if (totalPages > 0 && pageNumber > totalPages) {
      setPageNumber(totalPages);
      setPageInput(String(totalPages));
    }
  }, [totalPages, pageNumber]);

  useEffect(() => {
    let cancelled = false;
    setIsPageLoading(true);
    setPageError("");

    const loadPage = async () => {
      try {
        const payload = (await apiClient.get(
          `/api/documents/${revisionId}/page/${pageNumber}`,
        )) as PagePayload;
        if (!cancelled) {
          setPagePayload(payload);
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : "Failed to load page.";
          setPageError(message);
          setPagePayload(null);
        }
      } finally {
        if (!cancelled) {
          setIsPageLoading(false);
        }
      }
    };

    void loadPage();
    return () => {
      cancelled = true;
    };
  }, [revisionId, pageNumber]);

  useEffect(() => {
    if (!conversationId || !user?.id) return;

    let cancelled = false;
    const loadConversationHistory = async () => {
      try {
        const payload = (await apiClient.get(
          `/api/conversations/${conversationId}?user_id=${encodeURIComponent(user.id)}&scope=reader`,
        )) as ConversationDetailPayload;
        if (cancelled) return;

        if (
          payload.conversation.revision_id &&
          payload.conversation.revision_id !== revisionId
        ) {
          openRevision(
            payload.conversation.revision_id,
            1,
            payload.conversation.id,
          );
          return;
        }

        const mappedMessages = payload.messages.map(mapConversationMessage);
        setMessages(mappedMessages);
        setConversationId(payload.conversation.id);
      } catch (error) {
        if (!cancelled) {
          console.error(error);
        }
      }
    };

    void loadConversationHistory();
    return () => {
      cancelled = true;
    };
  }, [conversationId, revisionId, user?.id]);

  const submitQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const currentQuestion = question.trim();
    if (!currentQuestion || isQuerying) return;

    trackEvent("ui.query_submitted", {
      query: currentQuestion,
      revisionId,
      userId: user?.id || "unknown",
      mode: "reader",
    });

    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-user`,
        role: "user",
        content: currentQuestion,
        citations: [],
      },
    ]);
    setQuestion("");
    setIsQuerying(true);

    try {
      const response = (await apiClient.post("/api/query", {
        query: currentQuestion,
        language: language === "ENG" ? "en" : "hi",
        role: "operator",
        user_id: user?.id,
        conversation_id: conversationId,
        revision_id: revisionId,
        chat_scope: "reader",
        top_k: 6,
      })) as QueryApiResponse;

      const citations = (response.evidence || []).map(mapCitationPayload);
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-assistant`,
          role: "assistant",
          content: response.answer,
          citations,
        },
      ]);

      if (response.conversation_id) {
        setConversationId(response.conversation_id);
        if (response.conversation_id !== conversationId) {
          const next = new URLSearchParams(searchParams.toString());
          next.set("page", String(pageNumber));
          next.set("conversation_id", response.conversation_id);
          router.replace(`/operator/reader/${revisionId}?${next.toString()}`);
        }
      }
      if (citations.length > 0) {
        jumpToCitation(citations[0]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-assistant-error`,
          role: "assistant",
          content: copy.queryError,
          citations: [],
        },
      ]);
    } finally {
      setIsQuerying(false);
    }
  };

  const headingCode = documentMeta?.code || fallbackCode;
  const headingTitle = documentMeta?.title || fallbackTitle;
  const revisionLabel = documentMeta?.revision || "Current";

  return (
    <OperatorLayout>
      <div className="space-y-4">
        <section className="hero-panel p-4 md:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="tfl-kicker">{copy.title}</p>
              <h1 className="mt-1 text-xl font-bold tracking-[-0.02em] text-foreground md:text-2xl">
                {headingCode} | {revisionLabel}
              </h1>
              <p className="mt-1 text-sm text-muted">{headingTitle}</p>
              <p className="mt-2 text-xs text-muted">{copy.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info" size="sm">
                Page {pageNumber}
                {totalPages > 0 ? ` / ${totalPages}` : ""}
              </Badge>
              {activeCitation ? (
                <Badge variant="warning" size="sm">
                  {formatCitationLabel(activeCitation)}
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex min-w-[280px] flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              {copy.docSelectLabel}
              <select
                value={revisionId}
                onChange={(event) => openRevision(event.target.value)}
                className="rounded-[10px] border border-border bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary"
              >
                {documents.map((doc) => (
                  <option key={doc.revision_id} value={doc.revision_id}>
                    {doc.code} | {doc.revision} | {doc.title}
                  </option>
                ))}
              </select>
            </label>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => goToPage(pageNumber - 1)}
              disabled={pageNumber <= 1 || isPageLoading}
            >
              Prev Page
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => goToPage(pageNumber + 1)}
              disabled={
                isPageLoading || (totalPages > 0 && pageNumber >= totalPages)
              }
            >
              Next Page
            </Button>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                goToPage(parsePositiveInt(pageInput, pageNumber));
              }}
              className="inline-flex items-center gap-2"
            >
              <input
                value={pageInput}
                onChange={(event) => setPageInput(event.target.value)}
                className="w-20 rounded-[8px] border border-border bg-white px-2 py-1 text-sm text-foreground outline-none focus:border-primary"
                inputMode="numeric"
                aria-label="Jump to page"
              />
              <Button variant="outline" size="sm" type="submit">
                Go
              </Button>
            </form>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,58%)_minmax(0,42%)]">
          <section className="tfl-panel flex min-h-[620px] flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2 text-foreground">
                <DocumentStackIcon className="h-4 w-4" />
                <h2 className="text-sm font-semibold">{copy.docPanelTitle}</h2>
              </div>
              <Badge variant="default" size="sm">
                p.{pageNumber}
              </Badge>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-[rgba(243,247,251,0.72)] p-4">
              {isPageLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-muted">
                  <div className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    {copy.loadingPage}
                  </div>
                </div>
              ) : pageError ? (
                <div className="rounded-[12px] border border-danger/25 bg-danger-light p-3 text-sm text-danger">
                  {pageError}
                </div>
              ) : pageImageUrl ? (
                <div className="overflow-hidden rounded-[12px] border border-border bg-white">
                  <img
                    src={pageImageUrl}
                    alt={`${headingCode} page ${pageNumber}`}
                    className="block h-auto w-full"
                  />
                </div>
              ) : (
                <div className="rounded-[12px] border border-border bg-white p-4 text-sm text-muted">
                  {copy.noPreview}
                </div>
              )}
            </div>
          </section>

          <section className="tfl-panel flex min-h-[620px] flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                {copy.chatPanelTitle}
              </h2>
              {conversationId ? (
                <Badge variant="success" size="sm">
                  Conversation Live
                </Badge>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <div className="rounded-[12px] border border-border bg-white p-3 text-sm text-muted">
                  Ask naturally. Answers are grounded to this selected document.
                </div>
              ) : null}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[90%] rounded-[12px] border px-3 py-2 ${
                      message.role === "user"
                        ? "border-primary bg-primary text-white"
                        : "border-border bg-white text-foreground"
                    }`}
                  >
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {message.content}
                    </p>
                    {message.role === "assistant" && message.citations.length ? (
                      <div className="mt-2 border-t border-border/60 pt-2">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                          Sources
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {message.citations.map((citation) => (
                            <button
                              key={`${message.id}-${citation.chunkId}`}
                              onClick={() => jumpToCitation(citation)}
                              className="rounded-[6px] border border-border bg-white px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
                            >
                              {formatCitationLabel(citation)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}

              {isQuerying ? (
                <div className="flex justify-start">
                  <div className="rounded-[10px] border border-border bg-white px-3 py-2 text-xs text-muted">
                    Generating response...
                  </div>
                </div>
              ) : null}
              <div ref={chatEndRef} />
            </div>

            <form
              onSubmit={submitQuestion}
              className="border-t border-border bg-[rgba(248,251,255,0.85)] p-3"
            >
              <div className="flex gap-2">
                <input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder={copy.askPlaceholder}
                  className="flex-1 rounded-[10px] border border-border bg-white px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-primary"
                />
                <Button
                  variant="primary"
                  type="submit"
                  disabled={!question.trim() || isQuerying}
                >
                  {copy.askButton}
                </Button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </OperatorLayout>
  );
}
