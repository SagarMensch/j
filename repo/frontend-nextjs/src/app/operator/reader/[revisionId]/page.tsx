"use client";

import React, { FormEvent, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DocumentStackIcon,
  MicPulseIcon,
  SpeakerWaveIcon,
  StopSquareIcon,
  TranslateSparkIcon,
} from "@/components/ui/icons";
import { apiClient, API_BASE_URL } from "@/lib/api";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/telemetry";

type ReaderCopy = {
  title: string;
  subtitle: string;
  docPanelTitle: string;
  chatPanelTitle: string;
  currentRevision: string;
  askPlaceholder: string;
  askButton: string;
  queryError: string;
  voiceError: string;
  voiceUnsupported: string;
  voiceReady: string;
  listening: string;
  processing: string;
  playing: string;
  loadingPage: string;
  noPreview: string;
  docSelectLabel: string;
  pageLabel: string;
  prevPage: string;
  nextPage: string;
  jumpToPage: string;
  goLabel: string;
  conversationLive: string;
  emptyChatHint: string;
  translateHindi: string;
  hideHindi: string;
  speakAnswer: string;
  stopAudio: string;
  hindiTranslation: string;
  generating: string;
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

type TranslationApiResponse = {
  translated_text: string;
  source_language: string;
  target_language: string;
};

type SpeechSynthesisApiResponse = {
  text: string;
  language: string;
  audio_base64: string;
  audio_mime_type?: string;
};

type VoiceApiResponse = {
  user_text: string;
  assistant_text: string;
  assistant_tts_text?: string;
  audio_base64?: string;
  audio_mime_type?: string;
  detected_language?: string;
  tts_language?: string;
  stt_status?: string;
  conversation_id?: string;
  citations?: QueryEvidencePayload[];
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
  language?: string | null;
  translatedHindi?: string | null;
  ttsText?: string | null;
  audioBase64?: string;
  audioMimeType?: string;
  ttsLanguage?: string | null;
};

type VoiceState = "idle" | "recording" | "processing" | "playing";

const COPY: Record<AppLanguage, ReaderCopy> = {
  ENG: {
    title: "Reader Workspace",
    subtitle:
      "Select a company document, read it on the left, and ask naturally on the right.",
    docPanelTitle: "Document Reader",
    chatPanelTitle: "Chat",
    currentRevision: "Current",
    askPlaceholder: "Ask anything about the selected document...",
    askButton: "Ask",
    queryError: "Could not connect to backend right now.",
    voiceError: "Voice query failed. Please try again.",
    voiceUnsupported: "Voice input is not supported in this browser.",
    voiceReady: "Use mic to ask from this document. Audio only plays when you tap speak.",
    listening: "Listening. Speak now.",
    processing: "Processing voice query...",
    playing: "Audio answer is playing.",
    loadingPage: "Loading page...",
    noPreview: "Page preview not available for this revision/page.",
    docSelectLabel: "Document",
    pageLabel: "Page",
    prevPage: "Prev Page",
    nextPage: "Next Page",
    jumpToPage: "Jump to page",
    goLabel: "Go",
    conversationLive: "Conversation live",
    emptyChatHint: "Ask naturally or use the mic. Answers stay grounded to this document.",
    translateHindi: "Translate to Hindi",
    hideHindi: "Hide Hindi translation",
    speakAnswer: "Speak answer",
    stopAudio: "Stop audio",
    hindiTranslation: "Hindi translation",
    generating: "Generating response...",
  },
  HIN: {
    title: "रीडर",
    subtitle:
      "कंपनी का दस्तावेज चुनें, बाएं पढ़ें और दाएं पूछें।",
    docPanelTitle: "दस्तावेज",
    chatPanelTitle: "चैट",
    currentRevision: "चालू",
    askPlaceholder: "चुने हुए दस्तावेज के बारे में पूछें...",
    askButton: "पूछें",
    queryError: "अभी बैकएंड से जुड़ नहीं पा रहा।",
    voiceError: "आवाज वाला सवाल नहीं चला। फिर से कोशिश करें।",
    voiceUnsupported: "इस ब्राउज़र में आवाज से पूछना उपलब्ध नहीं है।",
    voiceReady: "माइक दबाकर इसी दस्तावेज से पूछें। आवाज तभी बजेगी जब आप सुनें दबाएंगे।",
    listening: "सुन रहा है। अब बोलिए।",
    processing: "आवाज वाला सवाल चल रहा है...",
    playing: "आवाज वाला जवाब चल रहा है।",
    loadingPage: "पेज लोड हो रहा है...",
    noPreview: "इस पेज का प्रीव्यू उपलब्ध नहीं है।",
    docSelectLabel: "दस्तावेज",
    pageLabel: "पेज",
    prevPage: "पिछला",
    nextPage: "अगला",
    jumpToPage: "पेज पर जाएं",
    goLabel: "जाएं",
    conversationLive: "चैट चालू",
    emptyChatHint: "सीधा पूछें या माइक इस्तेमाल करें। जवाब इसी दस्तावेज से रहेगा।",
    translateHindi: "हिंदी में देखें",
    hideHindi: "हिंदी छुपाएं",
    speakAnswer: "जवाब सुनें",
    stopAudio: "आवाज रोकें",
    hindiTranslation: "हिंदी अनुवाद",
    generating: "जवाब बन रहा है...",
  },
  HING: {
    title: "Reader",
    subtitle:
      "Company document select karo, left me padho aur right me pucho.",
    docPanelTitle: "Document",
    chatPanelTitle: "Chat",
    currentRevision: "Current",
    askPlaceholder: "Selected document ke baare mein kuch bhi pucho...",
    askButton: "Pucho",
    queryError: "Abhi backend se connect nahi ho pa raha.",
    voiceError: "Voice query fail ho gayi. Dobara try karo.",
    voiceUnsupported: "Is browser mein voice input supported nahi hai.",
    voiceReady: "Mic dabake isi document se pucho. Audio sirf speak dabane par chalega.",
    listening: "Listening. Ab bolo.",
    processing: "Voice query process ho rahi hai...",
    playing: "Audio answer chal raha hai.",
    loadingPage: "Page load ho raha hai...",
    noPreview: "Is revision/page ke liye page preview available nahi hai.",
    docSelectLabel: "Document",
    pageLabel: "Page",
    prevPage: "Prev",
    nextPage: "Next",
    jumpToPage: "Page par jao",
    goLabel: "Go",
    conversationLive: "Chat live",
    emptyChatHint: "Seedha pucho ya mic use karo. Answer isi document se rahega.",
    translateHindi: "Hindi me dekho",
    hideHindi: "Hindi chhupao",
    speakAnswer: "Answer suno",
    stopAudio: "Audio roko",
    hindiTranslation: "Hindi translation",
    generating: "Answer ban raha hai...",
  },
};

function normalizeApiAssetUrl(url?: string | null) {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${API_BASE_URL}${url.startsWith("/") ? url : `/${url}`}`;
}

function createLocalMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function toQueryLanguage(appLanguage: AppLanguage) {
  return appLanguage === "ENG" ? "en" : "hi";
}

function toSpeechLanguage(appLanguage: AppLanguage) {
  return appLanguage === "ENG" ? "en-IN" : "hi-IN";
}

function isHindiLike(languageCode?: string | null, text?: string) {
  const normalized = (languageCode || "").toLowerCase();
  if (normalized.startsWith("hi")) {
    return true;
  }
  return /[\u0900-\u097F]/.test(text || "");
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
  const { user, language, setLanguage } = useAuth();

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
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId || null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeCitation, setActiveCitation] = useState<CitationType | null>(
    null,
  );
  const [activeAudioMessageId, setActiveAudioMessageId] = useState<
    string | null
  >(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioUrlRef = useRef<string | null>(null);
  const voiceAbortControllerRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fallbackCode = searchParams.get("code") || "DOCUMENT";
  const fallbackTitle = searchParams.get("title") || "Approved Revision";
  const documentMeta =
    documents.find((doc) => doc.revision_id === revisionId) || null;
  const totalPages = Number(documentMeta?.pages || 0);
  const pageImageUrl = normalizeApiAssetUrl(pagePayload?.page.image_url);
  const isListening = voiceState === "recording";
  const isVoiceProcessing = voiceState === "processing";
  const isVoicePlaying = voiceState === "playing";

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
    language: message.language,
    ttsText: message.content,
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

  const stopVoicePlayback = (nextState: VoiceState = "idle") => {
    activeAudioRef.current?.pause();
    activeAudioRef.current = null;
    if (activeAudioUrlRef.current) {
      URL.revokeObjectURL(activeAudioUrlRef.current);
      activeAudioUrlRef.current = null;
    }
    setActiveAudioMessageId(null);
    setVoiceState((current) =>
      current === "playing" || nextState !== "idle" ? nextState : current,
    );
  };

  const playAudioBase64 = async (
    audioBase64?: string,
    audioMimeType = "audio/wav",
    messageId?: string | null,
  ) => {
    if (!audioBase64) {
      setVoiceState("idle");
      setActiveAudioMessageId(null);
      return;
    }

    try {
      const binaryString = window.atob(audioBase64);
      const byteArray = new Uint8Array(binaryString.length);
      for (let index = 0; index < binaryString.length; index += 1) {
        byteArray[index] = binaryString.charCodeAt(index);
      }

      stopVoicePlayback();

      const audioBlob = new Blob([byteArray], { type: audioMimeType });
      const audioUrl = URL.createObjectURL(audioBlob);
      activeAudioUrlRef.current = audioUrl;

      const audio = new Audio(audioUrl);
      audio.onended = () => stopVoicePlayback();
      audio.onerror = () => stopVoicePlayback();
      activeAudioRef.current = audio;
      setActiveAudioMessageId(messageId || null);
      setVoiceState("playing");
      await audio.play();
    } catch (error) {
      setVoiceState("idle");
      setActiveAudioMessageId(null);
      console.error("Reader voice playback failed", error);
    }
  };

  const updateMessage = (
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId ? updater(message) : message,
      ),
    );
  };

  const requestHindiTranslation = async (messageId: string) => {
    const message = messages.find((item) => item.id === messageId);
    if (!message || message.role !== "assistant") return;
    if (message.translatedHindi) {
      updateMessage(messageId, (current) => ({
        ...current,
        translatedHindi: null,
      }));
      return;
    }

    if (isHindiLike(message.language, message.content)) {
      updateMessage(messageId, (current) => ({
        ...current,
        translatedHindi: current.content,
      }));
      return;
    }

    try {
      const payload = (await apiClient.post("/api/translate", {
        text: message.content,
        source_language: message.language || toSpeechLanguage(language),
        target_language: "hi-IN",
      })) as TranslationApiResponse;

      updateMessage(messageId, (current) => ({
        ...current,
        translatedHindi: payload.translated_text,
      }));
    } catch (error) {
      console.error(error);
    }
  };

  const requestSpeechForMessage = async (messageId: string) => {
    const message = messages.find((item) => item.id === messageId);
    if (!message || message.role !== "assistant") return;

    if (activeAudioMessageId === messageId && isVoicePlaying) {
      stopVoicePlayback();
      return;
    }

    const speechText = message.translatedHindi || message.ttsText || message.content;
    if (!speechText.trim()) return;

    const wantsHindiAudio = Boolean(message.translatedHindi);
    const canReuseCachedAudio =
      Boolean(message.audioBase64) &&
      (!wantsHindiAudio ||
        isHindiLike(message.ttsLanguage, message.translatedHindi || message.content));

    if (canReuseCachedAudio) {
      await playAudioBase64(
        message.audioBase64,
        message.audioMimeType || "audio/wav",
        messageId,
      );
      return;
    }

    try {
      const payload = (await apiClient.post("/api/tts", {
        text: speechText,
        language:
          message.translatedHindi
            ? "hi-IN"
            : message.ttsLanguage || message.language || toSpeechLanguage(language),
        speaker: "suhani",
      })) as SpeechSynthesisApiResponse;

      updateMessage(messageId, (current) => ({
        ...current,
        audioBase64: payload.audio_base64,
        audioMimeType: payload.audio_mime_type || "audio/wav",
        ttsLanguage: payload.language,
      }));

      await playAudioBase64(
        payload.audio_base64,
        payload.audio_mime_type || "audio/wav",
        messageId,
      );
    } catch (error) {
      console.error(error);
    }
  };

  const getVoiceHelperText = () => {
    if (isListening) return copy.listening;
    if (isVoiceProcessing) return copy.processing;
    if (isVoicePlaying) return copy.playing;
    return copy.voiceReady;
  };

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
    return () => {
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceAbortControllerRef.current?.abort();
      stopVoicePlayback();
    };
  }, []);

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

  const submitVoiceQuery = async (
    audioBlob: Blob,
    signal?: AbortSignal,
  ) => {
    const formData = new FormData();
    const mimeType = audioBlob.type || "audio/webm";
    const fileExtension =
      mimeType === "audio/mp4"
        ? "mp4"
        : mimeType === "audio/wav"
          ? "wav"
          : "webm";
    formData.append("audio", audioBlob, `reader-voice.${fileExtension}`);
    formData.append("language", "auto");
    formData.append("speaker", "suhani");
    formData.append("chat_scope", "reader");
    formData.append("revision_id", revisionId);
    if (user?.id) {
      formData.append("user_id", user.id);
    }
    if (conversationId) {
      formData.append("conversation_id", conversationId);
    }

    const response = await fetch(`${API_BASE_URL}/api/voice`, {
      method: "POST",
      body: formData,
      signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Voice pipeline error: ${response.status} ${detail}`);
    }

    const payload = (await response.json()) as VoiceApiResponse;
    if (!payload.user_text?.trim() && !payload.assistant_text?.trim()) {
      throw new Error("No voice response returned");
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

    stopVoicePlayback("idle");

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getRecordingMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    audioChunksRef.current = [];
    mediaStreamRef.current = stream;
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    recorder.onerror = (event) => {
      console.error("MediaRecorder error in Reader voice:", event);
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      setVoiceState("idle");
    };

    recorder.onstart = () => {
      setVoiceState("recording");
    };

    recorder.onstop = async () => {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;

      // Small yield to let any pending ondataavailable events flush
      await new Promise((resolve) => setTimeout(resolve, 80));

      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];

      if (!chunks.length) {
        console.warn("Reader voice: no audio chunks recorded");
        setVoiceState("idle");
        return;
      }

      const audioBlob = new Blob(chunks, {
        type: recorder.mimeType || mimeType || "audio/webm",
      });

      if (!audioBlob.size) {
        console.warn("Reader voice: audio blob is empty");
        setVoiceState("idle");
        return;
      }

      setVoiceState("processing");
      setIsQuerying(true);
      voiceAbortControllerRef.current = new AbortController();
      try {
        const voiceResponse = await submitVoiceQuery(
          audioBlob,
          voiceAbortControllerRef.current.signal,
        );
        const citations = (voiceResponse.citations || []).map(mapCitationPayload);
        const nextConversationId =
          voiceResponse.conversation_id || conversationId || null;

        setMessages((prev) => {
          const next = [...prev];
          if (voiceResponse.user_text?.trim()) {
            next.push({
              id: createLocalMessageId("voice-user"),
              role: "user",
              content: voiceResponse.user_text,
              citations: [],
              language:
                voiceResponse.detected_language || toSpeechLanguage(language),
            });
          }
          next.push({
            id: createLocalMessageId("voice-assistant"),
            role: "assistant",
            content: voiceResponse.assistant_text || copy.voiceError,
            citations,
            language:
              voiceResponse.detected_language || toSpeechLanguage(language),
            ttsText:
              voiceResponse.assistant_tts_text || voiceResponse.assistant_text,
            audioBase64: voiceResponse.audio_base64,
            audioMimeType: voiceResponse.audio_mime_type,
            ttsLanguage: voiceResponse.tts_language,
          });
          return next;
        });

        if (nextConversationId) {
          setConversationId(nextConversationId);
          if (nextConversationId !== conversationId) {
            const next = new URLSearchParams(searchParams.toString());
            next.set("page", String(pageNumber));
            next.set("conversation_id", nextConversationId);
            router.replace(`/operator/reader/${revisionId}?${next.toString()}`);
          }
        }

        if (citations.length > 0) {
          jumpToCitation(citations[0]);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          setVoiceState("idle");
          return;
        }

        console.error("Reader voice query error:", error);
        setMessages((prev) => [
          ...prev,
          {
            id: createLocalMessageId("voice-error"),
            role: "assistant",
            content: copy.voiceError,
            citations: [],
            language: toSpeechLanguage(language),
          },
        ]);
        setVoiceState("idle");
      } finally {
        voiceAbortControllerRef.current = null;
        setIsQuerying(false);
        setVoiceState((current) =>
          current === "processing" ? "idle" : current,
        );
      }
    };

    recorder.start(250);
  };

  const handleVoiceInput = async () => {
    if (isListening) {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (isVoiceProcessing) {
      voiceAbortControllerRef.current?.abort();
      return;
    }

    if (isVoicePlaying) {
      stopVoicePlayback();
      return;
    }

    try {
      await startVoiceRecording();
    } catch (error) {
      setVoiceState("idle");
      console.error("Reader voice: failed to start recording", error);
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        alert(copy.voiceUnsupported);
      }
    }
  };

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
        id: createLocalMessageId("user"),
        role: "user",
        content: currentQuestion,
        citations: [],
        language: toQueryLanguage(language),
      },
    ]);
    setQuestion("");
    setIsQuerying(true);

    try {
      const response = (await apiClient.post("/api/query", {
        query: currentQuestion,
        language: toQueryLanguage(language),
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
          id: createLocalMessageId("assistant"),
          role: "assistant",
          content: response.answer,
          citations,
          language: toQueryLanguage(language),
          ttsText: response.answer,
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
          id: createLocalMessageId("assistant-error"),
          role: "assistant",
          content: copy.queryError,
          citations: [],
          language: toSpeechLanguage(language),
        },
      ]);
    } finally {
      setIsQuerying(false);
    }
  };

  const headingCode = documentMeta?.code || fallbackCode;
  const headingTitle = documentMeta?.title || fallbackTitle;
  const revisionLabel = documentMeta?.revision || copy.currentRevision;

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
                {copy.pageLabel} {pageNumber}
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
              {copy.prevPage}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => goToPage(pageNumber + 1)}
              disabled={
                isPageLoading || (totalPages > 0 && pageNumber >= totalPages)
              }
            >
              {copy.nextPage}
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
                aria-label={copy.jumpToPage}
              />
              <Button variant="outline" size="sm" type="submit">
                {copy.goLabel}
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
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center rounded-full border border-border bg-[#f5f8fc] p-1">
                  {(["ENG", "HIN", "HING"] as AppLanguage[]).map((lang) => (
                    <button
                      key={lang}
                      type="button"
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
                {conversationId ? (
                  <Badge variant="success" size="sm">
                    {copy.conversationLive}
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <div className="rounded-[12px] border border-border bg-white p-3 text-sm text-muted">
                  {copy.emptyChatHint}
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
                    {message.role === "assistant" ? (
                      <div className="mb-2 flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => void requestHindiTranslation(message.id)}
                          className="inline-flex items-center gap-1 rounded-full border border-[#d8dfec] bg-[#f6f8ff] px-2.5 py-1 text-[11px] font-semibold text-[#2947b2] transition-colors hover:border-[#a9b8e4] hover:bg-white"
                          title={
                            message.translatedHindi
                              ? copy.hideHindi
                              : copy.translateHindi
                          }
                        >
                          <TranslateSparkIcon className="h-3.5 w-3.5" />
                          <span>Hindi</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void requestSpeechForMessage(message.id)}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                            activeAudioMessageId === message.id &&
                            isVoicePlaying
                              ? "border-secondary bg-secondary text-white"
                              : "border-[#d8dfec] bg-[#f6f8ff] text-[#2947b2] hover:border-[#a9b8e4] hover:bg-white"
                          }`}
                          title={
                            activeAudioMessageId === message.id && isVoicePlaying
                              ? copy.stopAudio
                              : copy.speakAnswer
                          }
                        >
                          {activeAudioMessageId === message.id &&
                          isVoicePlaying ? (
                            <StopSquareIcon className="h-3.5 w-3.5" />
                          ) : (
                            <SpeakerWaveIcon className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    ) : null}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {message.content}
                    </p>
                    {message.translatedHindi ? (
                      <div className="mt-3 rounded-[10px] border border-[#d7def0] bg-[#f7faff] px-3 py-2.5">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#2947b2]">
                          {copy.hindiTranslation}
                        </p>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                          {message.translatedHindi}
                        </p>
                      </div>
                    ) : null}
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
                    {isVoiceProcessing ? copy.processing : copy.generating}
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
                <button
                  type="button"
                  onClick={handleVoiceInput}
                  disabled={isQuerying && !isVoiceProcessing}
                  title={getVoiceHelperText()}
                  className={`inline-flex items-center justify-center rounded-[10px] border px-3 ${
                    isListening
                      ? "border-danger bg-danger text-white"
                      : isVoiceProcessing
                        ? "border-[#ffd329] bg-[#ffd329] text-[#232323]"
                        : isVoicePlaying
                          ? "border-secondary bg-secondary text-white"
                          : "border-border bg-white text-muted hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  }`}
                >
                  {isVoicePlaying ? (
                    <StopSquareIcon className="h-4 w-4" />
                  ) : (
                    <MicPulseIcon className="h-4 w-4" />
                  )}
                </button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={!question.trim() || isQuerying}
                >
                  {copy.askButton}
                </Button>
              </div>
              <p
                className={`mt-2 text-xs font-medium ${
                  isListening
                    ? "text-danger"
                    : isVoiceProcessing
                      ? "text-[#8a6d00]"
                      : isVoicePlaying
                        ? "text-secondary"
                        : "text-muted"
                }`}
              >
                {getVoiceHelperText()}
              </p>
            </form>
          </section>
        </div>
      </div>
    </OperatorLayout>
  );
}
