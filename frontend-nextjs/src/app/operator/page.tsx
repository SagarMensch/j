"use client";

import React, { useEffect, useRef, useState } from "react";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/telemetry";
import { apiClient, API_BASE_URL } from "@/lib/api";
import { DocumentStackIcon, SearchGridIcon } from "@/components/ui/icons";
import {
  ScoreRing,
  XpPanel,
  deriveGameProfile,
} from "@/components/ui/gamification";

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
  blocks: PageBlock[];
  is_chunk_fallback?: boolean;
  document_code?: string;
  document_title?: string;
  bbox_x0?: number | null;
  bbox_y0?: number | null;
  bbox_x1?: number | null;
  bbox_y1?: number | null;
};

type PageBlock = {
  block_id: string;
  block_type?: string | null;
  section_title?: string | null;
  text?: string | null;
  bbox_left?: number | null;
  bbox_top?: number | null;
  bbox_right?: number | null;
  bbox_bottom?: number | null;
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

type VoiceCitationPayload = {
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

type VoiceApiResponse = {
  user_text: string;
  assistant_text: string;
  assistant_tts_text?: string;
  audio_base64?: string;
  citations?: VoiceCitationPayload[];
};

type DashboardSummaryResponse = {
  stats?: {
    mandatory_completion_rate?: number;
    in_progress?: number;
    overdue?: number;
  };
  mandatory_training?: {
    assignment_id: string;
    module_title: string;
    status: string;
    progress_percent: number;
    due_at?: string | null;
    completed_at?: string | null;
  }[];
  recent_sops?: {
    code: string;
    title: string;
    document_type?: string | null;
    revision_id?: string | null;
    revision_label?: string | null;
    updated_at?: string | null;
  }[];
};

type LookupCopy = {
  title: string;
  subtitle: string;
  placeholder: string;
  followUpPlaceholder: string;
  askButton: string;
  listening: string;
  conversation: string;
  sources: string;
  sourceDoc: string;
  noDocTitle: string;
  noDocHint: string;
  loadDoc: string;
  assistantTag: string;
  chunkTag: string;
  sourceProofLabel: string;
  voiceError: string;
  queryError: string;
  voiceUnsupported: string;
  features: string[];
};

type HighlightBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function normalizeApiAssetUrl(url?: string | null) {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${API_BASE_URL}${url.startsWith("/") ? url : `/${url}`}`;
}

function getHighlightBoxes(
  citation: CitationType | null,
  pagePayload: PagePayload | null,
) {
  if (!citation || !pagePayload) {
    return [] as HighlightBox[];
  }

  const blockHighlights = pagePayload.blocks
    .filter((block) => citation.blockIds.includes(block.block_id))
    .flatMap((block) => {
      const left = block.bbox_left;
      const top = block.bbox_top;
      const right = block.bbox_right;
      const bottom = block.bbox_bottom;

      if (
        left == null ||
        top == null ||
        right == null ||
        bottom == null ||
        right <= left ||
        bottom <= top
      ) {
        return [];
      }

      return [
        {
          left,
          top,
          width: right - left,
          height: bottom - top,
        },
      ];
    });

  if (blockHighlights.length > 0) {
    return blockHighlights;
  }

  if (
    citation.bboxX0 != null &&
    citation.bboxY0 != null &&
    citation.bboxX1 != null &&
    citation.bboxY1 != null &&
    citation.bboxX1 > citation.bboxX0 &&
    citation.bboxY1 > citation.bboxY0
  ) {
    return [
      {
        left: citation.bboxX0,
        top: citation.bboxY0,
        width: citation.bboxX1 - citation.bboxX0,
        height: citation.bboxY1 - citation.bboxY0,
      },
    ];
  }

  return [];
}

const COPY: Record<AppLanguage, LookupCopy> = {
  ENG: {
    title: "Ask SOP, get exact answer",
    subtitle:
      "Type or speak your question. Response is grounded in approved documents.",
    placeholder: "Ask procedure, safety step, machine operation...",
    followUpPlaceholder: "Ask follow-up...",
    askButton: "Ask",
    listening: "Listening. Speak now.",
    conversation: "Conversation",
    sources: "Sources",
    sourceDoc: "Source Document",
    noDocTitle: "No source selected",
    noDocHint: "Tap a source chip to view exact document text.",
    loadDoc: "Loading document...",
    assistantTag: "Assistant",
    chunkTag: "Retrieved Chunk",
    sourceProofLabel: "Source proof",
    voiceError: "Voice query failed. Please try again.",
    queryError: "Could not connect to backend right now.",
    voiceUnsupported: "Voice input is not supported in this browser.",
    features: ["Voice query", "Hindi/Hinglish", "Source proof"],
  },
  HIN: {
    title: "SOP पूछें, सही उत्तर पाएं",
    subtitle:
      "प्रश्न टाइप करें या बोलें। उत्तर केवल अनुमोदित दस्तावेजों से मिलेगा।",
    placeholder: "प्रक्रिया, सुरक्षा स्टेप, मशीन ऑपरेशन पूछें...",
    followUpPlaceholder: "अगला प्रश्न पूछें...",
    askButton: "पूछें",
    listening: "सुन रहा है। अभी बोलें।",
    conversation: "बातचीत",
    sources: "स्रोत",
    sourceDoc: "स्रोत दस्तावेज",
    noDocTitle: "कोई स्रोत चयनित नहीं",
    noDocHint: "सही टेक्स्ट देखने के लिए स्रोत चिप पर क्लिक करें।",
    loadDoc: "दस्तावेज लोड हो रहा है...",
    assistantTag: "सहायक",
    chunkTag: "मिला हुआ भाग",
    sourceProofLabel: "स्रोत प्रमाण",
    voiceError: "वॉइस क्वेरी नहीं चली। फिर से कोशिश करें।",
    queryError: "अभी बैकएंड से कनेक्ट नहीं हो पाया।",
    voiceUnsupported: "इस ब्राउजर में वॉइस इनपुट उपलब्ध नहीं है।",
    features: ["वॉइस क्वेरी", "हिंदी/हिंग्लिश", "स्रोत प्रमाण"],
  },
  HING: {
    title: "SOP pucho, exact answer lo",
    subtitle: "Type karo ya bolo. Jawab sirf approved documents se aayega.",
    placeholder: "Procedure, safety step, machine operation pucho...",
    followUpPlaceholder: "Next question pucho...",
    askButton: "Pucho",
    listening: "Listening. Ab bolo.",
    conversation: "Conversation",
    sources: "Sources",
    sourceDoc: "Source Document",
    noDocTitle: "Source select nahi hua",
    noDocHint: "Exact text dekhne ke liye source chip tap karo.",
    loadDoc: "Document load ho raha hai...",
    assistantTag: "Assistant",
    chunkTag: "Retrieved Chunk",
    sourceProofLabel: "Source proof",
    voiceError: "Voice query fail hui. Dobara try karo.",
    queryError: "Abhi backend se connect nahi ho pa raha.",
    voiceUnsupported: "Is browser me voice input support nahi hai.",
    features: ["Voice query", "Hindi/Hinglish", "Source proof"],
  },
};

function formatDateLabel(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

function getDocTypeMeta(type?: string | null) {
  const normalized = (type || "SOP").toUpperCase();
  if (normalized.includes("POLICY")) {
    return {
      label: "POLICY",
      chip: "bg-[#fce9e8] text-[#dc241f]",
      line: "bg-[#dc241f]",
    };
  }
  if (normalized.includes("MANUAL")) {
    return {
      label: "MANUAL",
      chip: "bg-[#e6f3eb] text-[#00782a]",
      line: "bg-[#00782a]",
    };
  }
  if (normalized.includes("WID") || normalized.includes("WORK")) {
    return {
      label: "WID",
      chip: "bg-[#e7f6fd] text-[#0098d4]",
      line: "bg-[#0098d4]",
    };
  }
  return {
    label: "SOP",
    chip: "bg-[#e7ebff] text-[#0019a8]",
    line: "bg-[#0019a8]",
  };
}

function SiriRing({ animate = true }: { animate?: boolean }) {
  return (
    <span className="relative inline-flex h-6 w-6 items-center justify-center">
      <span
        className={`absolute inset-0 rounded-full border border-secondary/60 ${animate ? "animate-spin" : ""}`}
      />
      <span
        className={`absolute inset-[3px] rounded-full border border-primary/55 ${animate ? "animate-pulse" : ""}`}
      />
      <span className="absolute inset-[7px] rounded-full bg-primary/90" />
    </span>
  );
}

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
  const [pageImageSize, setPageImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);
  const [dashboardData, setDashboardData] =
    useState<DashboardSummaryResponse | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const initialQueryHandledRef = useRef(false);

  const hasStarted = chatMessages.length > 0;
  const copy = COPY[language];
  const isIndicLayout = language !== "ENG";
  const pageImageUrl = normalizeApiAssetUrl(pagePayload?.page?.image_url);
  const highlightBoxes = getHighlightBoxes(activeCitation, pagePayload);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setDashboardData(null);
      return;
    }

    let cancelled = false;
    const loadDashboardSummary = async () => {
      setDashboardLoading(true);
      try {
        const payload = (await apiClient.get(
          `/api/dashboard/summary?user_id=${encodeURIComponent(user.id)}`,
        )) as DashboardSummaryResponse;
        if (!cancelled) {
          setDashboardData(payload);
        }
      } catch {
        if (!cancelled) {
          setDashboardData(null);
        }
      } finally {
        if (!cancelled) {
          setDashboardLoading(false);
        }
      }
    };

    void loadDashboardSummary();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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

  const mapCitationPayload = (
    ev: QueryEvidencePayload | VoiceCitationPayload,
  ): CitationType => ({
    chunkId: ev.chunk_id,
    documentCode: ev.document_code || ev.chunk_id.substring(0, 8),
    documentTitle: ev.document_title || "Document",
    revisionId: "revision_id" in ev ? ev.revision_id || "" : "",
    revisionLabel: ev.revision_label || "-",
    pageStart: ev.page_start || 1,
    pageEnd:
      "page_end" in ev ? ev.page_end || ev.page_start || 1 : ev.page_start || 1,
    citationLabel: ev.citation_label || "",
    sectionTitle: ev.section_title || "",
    blockIds: "block_ids" in ev ? ev.block_ids || [] : [],
    bboxX0: "bbox_x0" in ev ? (ev.bbox_x0 ?? null) : null,
    bboxY0: "bbox_y0" in ev ? (ev.bbox_y0 ?? null) : null,
    bboxX1: "bbox_x1" in ev ? (ev.bbox_x1 ?? null) : null,
    bboxY1: "bbox_y1" in ev ? (ev.bbox_y1 ?? null) : null,
  });

  const playAudioBase64 = async (audioBase64?: string) => {
    if (!audioBase64) return;

    try {
      const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
      await audio.play();
    } catch (error) {
      console.error("Voice playback failed", error);
    }
  };

  const submitVoiceQuery = async (audioBlob: Blob) => {
    const formData = new FormData();
    formData.append("audio", audioBlob, "voice-query.webm");
    formData.append("language", "auto");

    const response = await fetch(`${API_BASE_URL}/api/voice`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Voice pipeline error: ${response.status}`);
    }

    const payload = (await response.json()) as VoiceApiResponse;
    if (!payload.user_text?.trim()) {
      throw new Error("No transcript returned");
    }
    return payload;
  };

  const startVoiceRecording = async () => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      alert(copy.voiceUnsupported);
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
      if (!audioBlob.size) return;

      setIsQuerying(true);
      try {
        const voiceResponse = await submitVoiceQuery(audioBlob);
        const citations = (voiceResponse.citations || []).map(
          mapCitationPayload,
        );

        setChatMessages((prev) => [
          ...prev,
          { role: "user", content: voiceResponse.user_text },
          {
            role: "assistant",
            content:
              voiceResponse.assistant_tts_text || voiceResponse.assistant_text,
            citations: citations.length > 0 ? citations : undefined,
          },
        ]);

        if (citations.length > 0) {
          void loadCitation(citations[0]);
        }
        await playAudioBase64(voiceResponse.audio_base64);
      } catch (error) {
        console.error(error);
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: copy.voiceError,
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
    }
  };

  const loadCitation = async (citation: CitationType) => {
    if (!citation.chunkId) return;
    setActiveCitation(citation);
    setIsPageLoading(true);
    setPageImageSize(null);

    try {
      let payload: PagePayload | null = null;

      if (citation.revisionId && citation.pageStart) {
        try {
          payload = (await apiClient.get(
            `/api/documents/${citation.revisionId}/page/${citation.pageStart}`,
          )) as PagePayload;
        } catch {
          payload = null;
        }
      }

      if (!payload) {
        payload = (await apiClient.get(
          `/api/chunks/${citation.chunkId}/content`,
        )) as PagePayload;
      }

      setPagePayload({
        ...payload,
        document_code: payload.document_code || citation.documentCode,
        document_title: payload.document_title || citation.documentTitle,
        bbox_x0: payload.bbox_x0 ?? citation.bboxX0 ?? null,
        bbox_y0: payload.bbox_y0 ?? citation.bboxY0 ?? null,
        bbox_x1: payload.bbox_x1 ?? citation.bboxX1 ?? null,
        bbox_y1: payload.bbox_y1 ?? citation.bboxY1 ?? null,
      });
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

      const citations = (response.evidence || []).map(mapCitationPayload);
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
          content: copy.queryError,
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

  const openRecentDoc = (
    doc: DashboardSummaryResponse["recent_sops"] extends Array<infer T>
      ? T
      : never,
  ) => {
    const docType = getDocTypeMeta(doc.document_type).label;
    const revisionLabel = doc.revision_label
      ? ` revision ${doc.revision_label}`
      : "";
    void handleSearch(
      `Show key operator steps from ${doc.code} (${docType})${revisionLabel}. Include source reference.`,
    );
  };

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get("q");
    if (!query || initialQueryHandledRef.current) {
      return;
    }
    initialQueryHandledRef.current = true;
    setSearchQuery(query);
    void handleSearch(query);
  }, []);

  const dashboardStats = dashboardData?.stats;
  const allAssignments = dashboardData?.mandatory_training || [];
  const recentAssignments = allAssignments.slice(0, 4);
  const recentSops = (dashboardData?.recent_sops || []).slice(0, 4);
  const completionRate = Math.round(
    dashboardStats?.mandatory_completion_rate || 0,
  );
  const inProgressCount = Math.round(dashboardStats?.in_progress || 0);
  const overdueCount = Math.round(dashboardStats?.overdue || 0);
  const completedCount = allAssignments.filter(
    (item) => item.status === "completed",
  ).length;
  const gameProfile = deriveGameProfile({
    completionRate,
    inProgress: inProgressCount,
    overdue: overdueCount,
  });
  const missionCards = [
    {
      id: "overdue",
      title: "Close overdue backlog",
      detail:
        overdueCount === 0
          ? "All clear for current shift"
          : `${overdueCount} item(s) pending`,
      stripe: "bg-[#dc241f]",
    },
    {
      id: "progress",
      title: "Push active modules",
      detail:
        inProgressCount === 0
          ? "No active module pending"
          : `${inProgressCount} module(s) in progress`,
      stripe: "bg-[#0019a8]",
    },
    {
      id: "revision",
      title: "Review latest release",
      detail: recentSops[0]
        ? `${recentSops[0].code} | Rev ${recentSops[0].revision_label || "-"}`
        : "Waiting for next approved release",
      stripe: "bg-[#00782a]",
    },
  ];
  const quickPrompts =
    language === "ENG"
      ? [
          "Show startup checklist for my shift.",
          "Summarize machine safety SOP in 5 points.",
          "What changed in latest SOP revision?",
        ]
      : language === "HIN"
        ? [
            "Meri shift ka startup checklist dikhao.",
            "Machine safety SOP ko 5 points mein samjhao.",
            "Latest SOP revision mein kya badla hai?",
          ]
        : [
            "Meri shift ka startup checklist dikhao.",
            "Machine safety SOP ko 5 points mein samjhao.",
            "Latest SOP revision me kya change hua hai?",
          ];

  return (
    <OperatorLayout>
      <div className="min-h-[calc(100vh-210px)]">
        {!hasStarted ? (
          <div className="grid gap-4 xl:grid-cols-[1.24fr_0.96fr]">
            <section className="rounded-[20px] border border-[#d2d8e0] bg-[#f4f7fb] p-4 shadow-[0px_8px_20px_rgba(0,25,168,0.06)] md:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                    Shift Command
                  </p>
                  <h1 className="mt-1 text-2xl font-bold tracking-[-0.02em] text-foreground">
                    {copy.title}
                  </h1>
                  <p className="mt-1.5 max-w-2xl text-sm text-muted">
                    {copy.subtitle}
                  </p>
                </div>
                <div className="inline-flex items-center rounded-[10px] border border-border bg-white p-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.55)]">
                  {(["ENG", "HIN", "HING"] as AppLanguage[]).map((lang) => (
                    <button
                      key={lang}
                      onClick={() => setLanguage(lang)}
                      className={`rounded-[6px] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${
                        language === lang
                          ? "bg-primary text-white"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[1.08fr_0.92fr]">
                <article className="rounded-[12px] border border-border bg-white p-3.5">
                  <div className="mb-3 flex items-center gap-1">
                    <span className="h-1 w-12 rounded-full bg-[#0019a8]" />
                    <span className="h-1 w-10 rounded-full bg-[#00782a]" />
                    <span className="h-1 w-8 rounded-full bg-[#ffd329]" />
                  </div>
                  <ScoreRing
                    value={dashboardLoading ? 0 : completionRate}
                    title="Readiness Score"
                    subtitle="Live shift index"
                  />
                  <div className="mt-3 rounded-[8px] border border-border bg-[#f7f9fc] p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {recentAssignments[0]?.module_title ||
                          "No active module"}
                      </p>
                      <span className="text-xs font-semibold text-muted">
                        {dashboardLoading ? "--" : `${completionRate}%`}
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-[4px] bg-[#d9dfeb]">
                      <div
                        className="h-full rounded-[4px] bg-primary transition-all"
                        style={{
                          width: `${Math.min(100, Math.max(0, completionRate))}%`,
                        }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted">
                      <span>In Progress: {inProgressCount}</span>
                      <span>Completed: {completedCount}</span>
                      <span>Overdue: {overdueCount}</span>
                    </div>
                  </div>
                </article>

                <div className="space-y-3">
                  <XpPanel
                    xp={gameProfile.xp}
                    level={gameProfile.level}
                    streakDays={gameProfile.streakDays}
                    badgeLabel={gameProfile.badgeLabel}
                  />
                  <article className="rounded-[12px] border border-border bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                      Mission Queue
                    </p>
                    <div className="mt-2 space-y-2">
                      {missionCards.map((mission) => (
                        <div
                          key={mission.id}
                          className="rounded-[8px] border border-border bg-[#f7f9fc] px-2.5 py-2"
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={`mt-0.5 h-4 w-1 rounded-full ${mission.stripe}`}
                            />
                            <div className="min-w-0">
                              <p className="text-sm text-foreground">
                                {mission.title}
                              </p>
                              <p className="truncate text-xs text-muted">
                                {mission.detail}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                </div>
              </div>

              <section className="mt-3 rounded-[12px] border border-border bg-white p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                    Release Stream
                  </p>
                  <p className="text-[10px] font-medium text-muted">
                    Color shows doc type
                  </p>
                </div>
                <div className="mt-3 space-y-2.5">
                  {recentSops.length === 0 ? (
                    <p className="text-sm text-muted">
                      {dashboardLoading
                        ? "Loading..."
                        : "No new approved releases."}
                    </p>
                  ) : (
                    recentSops.slice(0, 3).map((doc) => {
                      const typeMeta = getDocTypeMeta(doc.document_type);
                      return (
                        <div
                          key={`${doc.code}-${doc.revision_label || ""}`}
                          className="rounded-[10px] border border-border bg-[#f8fafd] p-2.5"
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={`mt-0.5 h-10 w-1 rounded-full ${typeMeta.line}`}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-foreground">
                                    {doc.code}
                                  </p>
                                  <span
                                    className={`rounded-[999px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${typeMeta.chip}`}
                                  >
                                    {typeMeta.label}
                                  </span>
                                </div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                                  {formatDateLabel(doc.updated_at)}
                                </p>
                              </div>
                              <p className="mt-1 truncate text-xs text-muted">
                                {doc.title}
                              </p>
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <p className="text-[11px] text-muted">
                                  Rev {doc.revision_label || "-"}
                                </p>
                                <button
                                  onClick={() => openRecentDoc(doc)}
                                  className="rounded-[8px] bg-primary px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white"
                                >
                                  Open
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </section>

            <section className="rounded-[20px] border border-[#d2d8e0] bg-[#f4f7fb] p-4 shadow-[0px_8px_20px_rgba(0,25,168,0.06)] md:p-5">
              <div className="rounded-[12px] border border-border bg-white p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                  Command Hub
                </p>
                <h2 className="mt-1 text-xl font-bold tracking-[-0.02em] text-foreground">
                  Quick ask before shift
                </h2>
                <p className="mt-1.5 text-sm text-muted">
                  Use this only for exact SOP guidance. Chat opens after first
                  response.
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-[999px] bg-[#0019a8] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-white">
                    Live SOP
                  </span>
                  <span className="rounded-[999px] bg-[#00782a] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-white">
                    Source Locked
                  </span>
                  <span className="rounded-[999px] bg-[#ffd329] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#232323]">
                    Shift Ready
                  </span>
                </div>

                <div className="mt-3 rounded-[12px] border border-[#c8d2e5] bg-[#f8fafd] p-2.5">
                  <textarea
                    placeholder={copy.placeholder}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSearch();
                      }
                    }}
                    rows={4}
                    className="w-full resize-none rounded-[10px] border border-[#d0d8e6] bg-white px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted focus:border-secondary"
                  />
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <button
                      onClick={handleVoiceInput}
                      className={`inline-flex items-center gap-2 rounded-[8px] border px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${
                        isListening
                          ? "border-danger bg-danger text-white"
                          : "border-border bg-white text-muted hover:border-primary hover:text-primary"
                      }`}
                    >
                      <SiriRing animate={isListening} />
                      Voice
                    </button>
                    <Button
                      variant="primary"
                      onClick={() => void handleSearch()}
                      className="px-4"
                      disabled={isQuerying || !searchQuery.trim()}
                    >
                      <SearchGridIcon className="h-4 w-4" />
                      {copy.askButton}
                    </Button>
                  </div>
                  {isListening ? (
                    <p className="mt-2 text-xs font-medium text-danger">
                      {copy.listening}
                    </p>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {quickPrompts.map((prompt, index) => {
                    const routeClass =
                      index === 0
                        ? "bg-[#0019a8]"
                        : index === 1
                          ? "bg-[#00782a]"
                          : "bg-[#dc241f]";
                    return (
                      <button
                        key={prompt}
                        onClick={() => void handleSearch(prompt)}
                        className="group rounded-[10px] border border-border bg-[#f8fafd] px-2.5 py-2 text-left transition-colors hover:border-[#9fb0d0] hover:bg-white"
                      >
                        <span
                          className={`mb-2 block h-1.5 w-10 rounded-full ${routeClass}`}
                        />
                        <span className="line-clamp-2 text-xs text-foreground/90 group-hover:text-foreground">
                          {prompt}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 rounded-[12px] border border-border bg-white p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Latest Revision
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {recentSops[0]?.code || "No document"}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {recentSops[0]
                    ? `${recentSops[0].title} | Rev ${recentSops[0].revision_label || "-"}`
                    : "No approved revision found yet."}
                </p>
              </div>
            </section>
          </div>
        ) : (
          <div className="flex h-full flex-col gap-3 lg:flex-row">
            <div
              className={`${isIndicLayout ? "lg:w-[58%]" : "lg:w-1/2"} tfl-panel flex min-h-0 flex-col overflow-hidden`}
            >
              <div className="flex items-center justify-between border-b border-border bg-[rgba(248,251,255,0.85)] px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">
                  {copy.conversation}
                </h2>
                <div className="inline-flex items-center rounded-full border border-border bg-white p-1">
                  {(["ENG", "HIN", "HING"] as AppLanguage[]).map((lang) => (
                    <button
                      key={lang}
                      onClick={() => setLanguage(lang)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] ${
                        language === lang
                          ? "bg-primary text-white"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[88%] rounded-[14px] border px-3 py-2.5 shadow-[0px_8px_20px_rgba(0,25,168,0.04)] ${
                        msg.role === "user"
                          ? "border-primary bg-primary text-white"
                          : "border-border bg-white text-foreground"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <p className="text-sm leading-relaxed">{msg.content}</p>
                      ) : (
                        <div>
                          <div className="mb-2 flex items-center gap-2">
                            <SiriRing animate={false} />
                            <span className="text-xs font-medium text-muted">
                              {copy.assistantTag}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                            {msg.content}
                          </p>
                          {msg.citations && msg.citations.length > 0 ? (
                            <div className="mt-3 border-t border-border/60 pt-2.5">
                              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                                {copy.sources}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {msg.citations.map((cite, i) => (
                                  <button
                                    key={i}
                                    onClick={() => handleCitationClick(cite)}
                                    className={`inline-flex items-center gap-1 rounded-[6px] border px-2.5 py-1 text-xs font-medium transition-colors ${
                                      activeCitation?.chunkId === cite.chunkId
                                        ? "border-primary bg-primary text-white"
                                        : "border-border bg-white text-foreground hover:border-primary hover:text-primary"
                                    }`}
                                  >
                                    <span>{cite.documentCode}</span>
                                    <span>|</span>
                                    <span>p.{cite.pageStart}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isQuerying ? (
                  <div className="flex justify-start">
                    <div className="rounded-[14px] border border-border bg-white px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <SiriRing />
                        <span className="text-xs font-medium text-muted">
                          Generating response...
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div ref={chatEndRef} />
              </div>

              <div className="border-t border-border bg-[rgba(248,251,255,0.85)] p-3">
                <div className="flex gap-2 rounded-[14px] border border-border bg-white p-2">
                  <input
                    type="text"
                    placeholder={copy.followUpPlaceholder}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
                    className="flex-1 bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted"
                  />
                  <button
                    onClick={handleVoiceInput}
                    className={`inline-flex items-center justify-center rounded-[6px] border px-2 ${
                      isListening
                        ? "border-danger bg-danger text-white"
                        : "border-border bg-white text-muted hover:border-primary hover:text-primary"
                    }`}
                  >
                    <svg
                      className="h-4 w-4"
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
                    onClick={() => void handleSearch()}
                    disabled={!searchQuery.trim() || isQuerying}
                  >
                    {copy.askButton}
                  </Button>
                </div>
              </div>
            </div>

            <div
              className={`${isIndicLayout ? "lg:w-[42%]" : "lg:w-1/2"} tfl-panel flex min-h-0 flex-col overflow-hidden`}
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {copy.sourceDoc}
                  </h2>
                  {activeCitation ? (
                    <p className="mt-0.5 text-xs text-muted">
                      {activeCitation.documentCode} | p.
                      {activeCitation.pageStart}
                    </p>
                  ) : null}
                </div>
                {activeCitation ? (
                  <Badge variant="info" size="sm">
                    p.{activeCitation.pageStart}
                  </Badge>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-auto bg-[rgba(243,247,251,0.72)] p-4">
                {isPageLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                      <p className="text-xs text-muted">{copy.loadDoc}</p>
                    </div>
                  </div>
                ) : pagePayload?.page?.raw_text ? (
                  <div className="overflow-hidden rounded-[14px] border border-border bg-white shadow-[0px_10px_28px_rgba(0,25,168,0.06)]">
                    <div className="flex items-center justify-between border-b border-border bg-[#f7faff] px-3 py-2">
                      <div className="flex items-center gap-2 text-foreground">
                        <DocumentStackIcon className="h-4 w-4" />
                        <span className="text-xs font-semibold uppercase tracking-[0.1em]">
                          {activeCitation?.documentCode || "Document"}
                        </span>
                      </div>
                      <span className="rounded-[4px] bg-white px-2 py-1 text-xs text-muted">
                        Page {activeCitation?.pageStart || 1}
                      </span>
                    </div>

                    <div className="border-b border-border px-4 py-3">
                      <h3 className="text-sm font-semibold text-foreground">
                        {activeCitation?.documentTitle ||
                          activeCitation?.documentCode}
                      </h3>
                    </div>

                    <div className="space-y-4 p-4">
                      {pageImageUrl ? (
                        <div className="overflow-hidden rounded-[12px] border border-border bg-[#f9fbfd]">
                          <div className="border-b border-border px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                              Linked page view
                            </p>
                          </div>
                          <div className="p-3">
                            <div className="relative overflow-hidden rounded-[10px] border border-border bg-white">
                              <img
                                src={pageImageUrl}
                                alt={`${activeCitation?.documentCode || "Document"} page ${activeCitation?.pageStart || 1}`}
                                className="block h-auto w-full"
                                onLoad={(event) =>
                                  setPageImageSize({
                                    width:
                                      event.currentTarget.naturalWidth || 1,
                                    height:
                                      event.currentTarget.naturalHeight || 1,
                                  })
                                }
                              />
                              {pageImageSize
                                ? highlightBoxes.map((box, index) => (
                                    <div
                                      key={`${activeCitation?.chunkId || "highlight"}-${index}`}
                                      className="pointer-events-none absolute rounded-[6px] border-2 border-[#ffcf00] bg-[rgba(255,207,0,0.24)] shadow-[0_0_0_2px_rgba(0,25,168,0.12)]"
                                      style={{
                                        left: `${(box.left / pageImageSize.width) * 100}%`,
                                        top: `${(box.top / pageImageSize.height) * 100}%`,
                                        width: `${(box.width / pageImageSize.width) * 100}%`,
                                        height: `${(box.height / pageImageSize.height) * 100}%`,
                                      }}
                                    />
                                  ))
                                : null}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <div className="rounded-[12px] border border-warning/30 bg-warning-light p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="rounded-[4px] bg-warning px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#3f3100]">
                            {copy.chunkTag}
                          </span>
                          {activeCitation?.sectionTitle ? (
                            <span className="text-xs font-medium text-[#5b4700]">
                              {activeCitation.sectionTitle}
                            </span>
                          ) : null}
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#352e16]">
                          {pagePayload.page.raw_text}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center text-muted">
                      <DocumentStackIcon className="mx-auto h-10 w-10 text-muted/40" />
                      <p className="mt-3 text-sm font-semibold text-foreground">
                        {copy.noDocTitle}
                      </p>
                      <p className="mt-1 text-xs">{copy.noDocHint}</p>
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
