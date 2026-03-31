"use client";

import React, { useEffect, useState, useRef } from "react";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/telemetry";
import { apiClient, API_BASE_URL } from "@/lib/api";

type CitationType = {
  chunkId: string;
  documentCode: string;
  documentTitle: string;
  revisionId: string;
  revisionLabel?: string;
  pageStart: number;
  pageEnd?: number;
  citationLabel?: string;
  sectionTitle?: string;
  blockIds: string[];
  bboxX0?: number | null;
  bboxY0?: number | null;
  bboxX1?: number | null;
  bboxY1?: number | null;
};

type PagePayload = {
  page: {
    page_number: number;
    image_path?: string | null;
    image_url?: string | null;
    classification?: string | null;
    ocr_used?: boolean | null;
    ocr_confidence?: number | null;
    raw_text?: string | null;
  };
  blocks: unknown[];
  is_chunk_fallback?: boolean;
  document_code?: string;
  document_title?: string;
  bbox_x0?: number | null;
  bbox_y0?: number | null;
  bbox_x1?: number | null;
  bbox_y1?: number | null;
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
  block_ids?: string[];
  bbox_x0?: number | null;
  bbox_y0?: number | null;
  bbox_x1?: number | null;
  bbox_y1?: number | null;
};

type QueryApiResponse = {
  answer: string;
  evidence?: QueryEvidencePayload[];
};

export default function InformationLookup() {
  const { user, language, setLanguage } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [chatMessages, setChatMessages] = useState<
    { role: string; content: string; citations?: CitationType[] }[]
  >([]);
  const [activeCitation, setActiveCitation] = useState<CitationType | null>(
    null,
  );
  const [pagePayload, setPagePayload] = useState<PagePayload | null>(null);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const hasStarted = chatMessages.length > 0;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const getRecordingMimeType = () => {
    if (
      typeof MediaRecorder === "undefined" ||
      !MediaRecorder.isTypeSupported
    ) {
      return undefined;
    }

    const supportedMimeTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
    ];

    return supportedMimeTypes.find((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    );
  };

  const transcribeRecordedAudio = async (audioBlob: Blob) => {
    const formData = new FormData();
    formData.append("audio", audioBlob, "voice-query.webm");
    formData.append("language", "auto");

    const response = await fetch(`${API_BASE_URL}/api/stt`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`STT error: ${response.status}`);
    }

    const payload = await response.json();
    const translatedText = (payload.text || "").trim();
    if (!translatedText) {
      throw new Error("No transcript returned");
    }

    return translatedText;
  };

  const startVoiceRecording = async () => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      alert("Voice input is not supported in this browser.");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getRecordingMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    audioChunksRef.current = [];
    mediaStreamRef.current = stream;
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    recorder.onstart = () => {
      setIsListening(true);
    };

    recorder.onstop = async () => {
      setIsListening(false);
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;

      const audioBlob = new Blob(audioChunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      audioChunksRef.current = [];

      if (!audioBlob.size) {
        return;
      }

      setIsQuerying(true);
      try {
        const translatedText = await transcribeRecordedAudio(audioBlob);
        await handleSearch(translatedText, "en");
      } catch (error) {
        console.error(error);
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "I could not convert that voice input into English. Please try again.",
          },
        ]);
      } finally {
        setIsQuerying(false);
      }
    };

    recorder.start();
  };

  const handleVoiceInput = async () => {
    if (isListening) {
      mediaRecorderRef.current?.stop();
      return;
    }

    try {
      await startVoiceRecording();
    } catch (error) {
      console.error(error);
      return;
    }
  };

  const loadCitation = async (citation: CitationType) => {
    if (!citation.chunkId) return;
    setActiveCitation(citation);
    setIsPageLoading(true);
    try {
      const payload = await apiClient.get(
        `/api/chunks/${citation.chunkId}/content`,
      );
      setPagePayload(payload as PagePayload);
    } catch (error) {
      console.error(error);
      setPagePayload(null);
    } finally {
      setIsPageLoading(false);
    }
  };

  const handleSearch = async (
    queryOverride?: string,
    requestLanguageOverride?: "en" | "hi",
  ) => {
    const currentQuery = (queryOverride ?? searchQuery).trim();
    if (!currentQuery) return;
    trackEvent("ui.query_submitted", { query: currentQuery, language });

    setChatMessages((prev) => [
      ...prev,
      { role: "user", content: currentQuery },
    ]);
    setSearchQuery("");
    setIsQuerying(true);

    try {
      const response = (await apiClient.post("/api/query", {
        query: currentQuery,
        language: requestLanguageOverride ?? (language === "ENG" ? "en" : "hi"),
        role: "operator",
        user_id: user?.id,
        top_k: 5,
      })) as QueryApiResponse;

      const citations = (response.evidence || []).map((ev) => ({
        chunkId: ev.chunk_id,
        documentCode: ev.document_code || ev.chunk_id.substring(0, 8),
        documentTitle: ev.document_title || "Document",
        revisionId: ev.revision_id || "",
        revisionLabel: ev.revision_label || "-",
        pageStart: ev.page_start || 1,
        pageEnd: ev.page_end || ev.page_start || 1,
        citationLabel: ev.citation_label || "",
        sectionTitle: ev.section_title || "",
        blockIds: ev.block_ids || [],
        bboxX0: ev.bbox_x0 ?? null,
        bboxY0: ev.bbox_y0 ?? null,
        bboxX1: ev.bbox_x1 ?? null,
        bboxY1: ev.bbox_y1 ?? null,
      }));

      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: response.answer,
          citations: citations.length > 0 ? citations : undefined,
        },
      ]);

      if (citations.length > 0) {
        void loadCitation(citations[0]);
      }
    } catch (error) {
      console.error(error);
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I'm sorry, I couldn't connect to the backend database to retrieve this information.",
        },
      ]);
    } finally {
      setIsQuerying(false);
    }
  };

  const handleCitationClick = (citation: CitationType) => {
    trackEvent("ui.citation_opened", {
      documentCode: citation.documentCode,
      section: citation.sectionTitle,
    });
    void loadCitation(citation);
  };

  const submitTypedSearch = () => {
    void handleSearch();
  };

  return (
    <OperatorLayout>
      <div className="h-[calc(100vh-64px)] flex flex-col">
        {/* Landing State - Centered content */}
        {!hasStarted ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            {/* Language Selector */}
            <div className="flex items-center gap-2 mb-8">
              {["ENG", "HIN", "HING"].map((lang) => (
                <button
                  key={lang}
                  onClick={() => setLanguage(lang)}
                  className={`px-4 py-2 text-sm rounded-lg transition-all ${
                    language === lang
                      ? "bg-primary text-white shadow-md"
                      : "bg-muted-light text-muted hover:bg-muted"
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>

            {/* Main Title */}
            <div className="text-center mb-12">
              <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
                Your Personal Assistant
              </h1>
              <p className="text-lg text-muted max-w-xl">
                Ask questions about procedures, safety protocols, equipment
                operations, and more. All answers are sourced from approved SOP,
                SMP, and WID documents.
              </p>
            </div>

            {/* Feature Pills */}
            <div className="flex flex-wrap justify-center gap-3 mb-12">
              <span className="px-4 py-2 bg-muted-light rounded-full text-sm text-muted flex items-center gap-2">
                <span>🗣️</span> Voice Interaction
              </span>
              <span className="px-4 py-2 bg-muted-light rounded-full text-sm text-muted flex items-center gap-2">
                <span>🌐</span> Multi-Language
              </span>
              <span className="px-4 py-2 bg-muted-light rounded-full text-sm text-muted flex items-center gap-2">
                <span>📄</span> Source Traceability
              </span>
              <span className="px-4 py-2 bg-muted-light rounded-full text-sm text-muted flex items-center gap-2">
                <span>✅</span> Evidence-Grounded
              </span>
            </div>

            {/* Search Bar - Bottom Centered */}
            <div className="w-full max-w-2xl mt-auto mb-8">
              <div className="flex gap-3 bg-white rounded-2xl shadow-lg p-2 border border-border">
                <input
                  type="text"
                  placeholder="Ask about procedures, safety protocols, or equipment operations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
                  className="flex-1 px-4 py-3 text-base bg-transparent outline-none text-foreground placeholder:text-muted"
                />
                <button
                  onClick={handleVoiceInput}
                  className={`p-3 rounded-xl transition-all ${
                    isListening
                      ? "bg-danger text-white animate-pulse"
                      : "hover:bg-muted-light text-muted"
                  }`}
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                    />
                  </svg>
                </button>
                <Button
                  variant="primary"
                  onClick={submitTypedSearch}
                  className="px-6"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                </Button>
              </div>
              {isListening && (
                <p className="text-sm text-danger mt-3 flex items-center justify-center gap-2">
                  <span className="w-2 h-2 bg-danger rounded-full animate-pulse" />
                  Listening... Speak your question now
                </p>
              )}
            </div>
          </div>
        ) : (
          /* Active State - Split View (Gemini-style) */
          <div className="flex-1 flex overflow-hidden">
            {/* Left Panel - Chat */}
            <div className="w-1/2 flex flex-col border-r border-border bg-white">
              {/* Chat Header */}
              <div className="px-6 py-4 border-b border-border bg-muted-light/50">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-foreground">
                    Conversation
                  </h2>
                  <div className="flex items-center gap-2">
                    {["ENG", "HIN", "HING"].map((lang) => (
                      <button
                        key={lang}
                        onClick={() => setLanguage(lang)}
                        className={`px-2 py-1 text-xs rounded transition-colors ${
                          language === lang
                            ? "bg-primary text-white"
                            : "text-muted hover:bg-muted"
                        }`}
                      >
                        {lang}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] ${
                        msg.role === "user"
                          ? "bg-primary text-white rounded-2xl rounded-tr-sm px-4 py-3"
                          : "bg-muted-light rounded-2xl rounded-tl-sm px-4 py-3"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <p className="text-sm leading-relaxed">{msg.content}</p>
                      ) : (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-medium">
                              AI
                            </div>
                            <span className="text-xs font-medium text-muted">
                              Assistant
                            </span>
                          </div>
                          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                            {msg.content}
                          </p>
                          {msg.citations && msg.citations.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-border/50">
                              <p className="text-xs font-medium text-muted mb-2">
                                Sources:
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {msg.citations.map((cite, i) => (
                                  <button
                                    key={i}
                                    onClick={() => handleCitationClick(cite)}
                                    className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all ${
                                      activeCitation?.chunkId === cite.chunkId
                                        ? "bg-primary text-white shadow-sm"
                                        : "bg-white border border-border text-foreground hover:border-primary hover:text-primary"
                                    }`}
                                  >
                                    <span className="font-medium">
                                      {cite.documentCode}
                                    </span>
                                    <span className="opacity-60">•</span>
                                    <span>p.{cite.pageStart}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isQuerying && (
                  <div className="flex justify-start">
                    <div className="bg-muted-light rounded-2xl rounded-tl-sm px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs">
                          AI
                        </div>
                        <div className="flex gap-1">
                          <span
                            className="w-2 h-2 bg-muted rounded-full animate-bounce"
                            style={{ animationDelay: "0ms" }}
                          />
                          <span
                            className="w-2 h-2 bg-muted rounded-full animate-bounce"
                            style={{ animationDelay: "150ms" }}
                          />
                          <span
                            className="w-2 h-2 bg-muted rounded-full animate-bounce"
                            style={{ animationDelay: "300ms" }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input */}
              <div className="p-4 border-t border-border bg-white">
                <div className="flex gap-2 bg-muted-light rounded-xl p-2">
                  <input
                    type="text"
                    placeholder="Ask a follow-up question..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
                    className="flex-1 px-4 py-2 bg-transparent outline-none text-sm text-foreground placeholder:text-muted"
                  />
                  <button
                    onClick={handleVoiceInput}
                    className={`p-2 rounded-lg transition-all ${
                      isListening
                        ? "bg-danger text-white animate-pulse"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                      />
                    </svg>
                  </button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={submitTypedSearch}
                    disabled={!searchQuery.trim() || isQuerying}
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                      />
                    </svg>
                  </Button>
                </div>
              </div>
            </div>

            {/* Right Panel - PDF Viewer */}
            <div className="w-1/2 flex flex-col bg-gray-100">
              {/* PDF Header */}
              <div className="px-6 py-4 border-b border-border bg-white flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-foreground">
                    Source Document
                  </h2>
                  {activeCitation && (
                    <p className="text-xs text-muted mt-0.5">
                      {activeCitation.documentCode} • Page{" "}
                      {activeCitation.pageStart}
                    </p>
                  )}
                </div>
                {activeCitation && (
                  <Badge variant="info" size="sm">
                    p.{activeCitation.pageStart}
                  </Badge>
                )}
              </div>

              {/* PDF Content */}
              <div className="flex-1 overflow-auto p-6">
                {isPageLoading ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                      <p className="text-sm text-muted">Loading document...</p>
                    </div>
                  </div>
                ) : pagePayload?.page?.raw_text ? (
                  <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                    {/* PDF-like header */}
                    <div className="bg-gray-800 px-4 py-3 flex items-center justify-between text-white">
                      <div className="flex items-center gap-2">
                        <svg
                          className="w-5 h-5 text-red-400"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span className="text-sm font-medium">
                          {activeCitation?.documentCode || "Document"}
                        </span>
                      </div>
                      <span className="text-xs bg-gray-700 px-2 py-1 rounded">
                        Page {activeCitation?.pageStart || 1}
                      </span>
                    </div>

                    {/* Document title */}
                    <div className="px-6 py-3 border-b border-gray-200 bg-gray-50">
                      <h3 className="text-sm font-bold text-gray-800 text-center">
                        {activeCitation?.documentTitle ||
                          activeCitation?.documentCode}
                      </h3>
                    </div>

                    {/* Chunk content */}
                    <div className="p-6">
                      <div className="bg-amber-50 border-l-4 border-amber-400 rounded-r-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="bg-amber-400 text-white text-xs px-2 py-0.5 rounded font-medium">
                            Retrieved Chunk
                          </span>
                          {activeCitation?.sectionTitle && (
                            <span className="text-xs text-amber-700 font-medium">
                              {activeCitation.sectionTitle}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                          {pagePayload.page.raw_text}
                        </div>
                      </div>
                    </div>

                    {/* PDF footer */}
                    <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-center">
                      <span className="text-xs text-gray-400">
                        {activeCitation?.documentCode || "Document"} • Page{" "}
                        {activeCitation?.pageStart || 1}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center text-muted">
                      <svg
                        className="w-16 h-16 mx-auto mb-4 text-muted/30"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      <p className="font-medium text-foreground mb-1">
                        No document selected
                      </p>
                      <p className="text-sm">
                        Click a source citation to view the document
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </OperatorLayout>
  );
}
