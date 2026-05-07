"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/telemetry";
import { apiClient, API_BASE_URL, postJsonSse } from "@/lib/api";
import {
  DocumentStackIcon,
  MicPulseIcon,
  SearchGridIcon,
  SpeakerWaveIcon,
  StopSquareIcon,
  TranslateSparkIcon,
} from "@/components/ui/icons";
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
  conversation_id?: string;
  evidence?: QueryEvidencePayload[];
};

type OperationGuideApiResponse = {
  answer: string;
  mode: "clarify" | "learn" | "run" | "blocked";
  next_actions?: string[];
  state?: Record<string, unknown>;
  state_label?: string | null;
  step_index?: number | null;
  requires_supervisor?: boolean;
  completion_record_id?: string | null;
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
  audio_mime_type?: string;
  detected_language?: string;
  tts_language?: string;
  stt_status?: string;
  conversation_id?: string;
  citations?: VoiceCitationPayload[];
};

type ConversationSummaryPayload = {
  id: string;
  user_id: string;
  title: string;
  language: string;
  status: string;
  chat_scope?: "general" | "reader" | "guided";
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

type ChatMessage = {
  id: string;
  role: string;
  content: string;
  citations?: CitationType[];
  createdAt?: string | null;
  responseMode?: string;
  language?: string | null;
  translatedHindi?: string | null;
  ttsText?: string | null;
  audioBase64?: string;
  audioMimeType?: string;
  ttsLanguage?: string | null;
  nextActions?: string[];
  isStreaming?: boolean;
  streamStatus?: string | null;
  operationStateLabel?: string | null;
  operationStepIndex?: number | null;
  requiresSupervisor?: boolean;
  completionRecordId?: string | null;
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

type WorkerBriefItem = {
  type: string;
  priority?: string;
  title: string;
  detail?: string | null;
  cta_url?: string | null;
  document_code?: string | null;
  revision_label?: string | null;
  updated_at?: string | null;
  due_at?: string | null;
  created_at?: string | null;
};

type WorkerBriefResponse = {
  memory?: {
    preferred_language?: string | null;
    skill_tags?: string[];
    risk_flags?: string[];
    last_equipment?: string | null;
    last_sop_code?: string | null;
    interaction_count?: number;
    last_interaction_at?: string | null;
  };
  today?: WorkerBriefItem[];
  open_handoffs?: WorkerBriefItem[];
  recent_activity?: WorkerBriefItem[];
};

type LookupCopy = {
  title: string;
  subtitle: string;
  placeholder: string;
  followUpPlaceholder: string;
  askButton: string;
  voiceStartAction: string;
  voiceStopRecordingAction: string;
  voiceCancelProcessingAction: string;
  voiceStopPlaybackAction: string;
  voiceReady: string;
  listening: string;
  voiceProcessing: string;
  voicePlaying: string;
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
  newChat: string;
  recentChats: string;
  noChats: string;
  loadingChats: string;
  features: string[];
};

type HighlightBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type AnswerParagraph = {
  text: string;
  proofText: string;
  primaryCitation: CitationType | null;
  segments: {
    text: string;
    citation: CitationType | null;
    isCitation: boolean;
  }[];
};

type TextSegment = {
  text: string;
  highlighted: boolean;
};

type VoiceState = "idle" | "recording" | "processing" | "playing";
type ConversationScope = "general" | "reader" | "guided";

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

function conversationScopeLabel(
  language: AppLanguage,
  scope: ConversationScope,
) {
  if (scope === "guided") {
    return "Run Guide";
  }
  if (language === "HIN") {
    return scope === "general" ? "à¤¸à¤¾à¤®à¤¾à¤¨à¥à¤¯" : "à¤°à¥€à¤¡à¤°";
  }
  return scope === "general" ? "General" : "Reader";
}

function conversationThreadSummary(
  language: AppLanguage,
  scope: ConversationScope,
  count: number,
) {
  const scopeText = conversationScopeLabel(language, scope);
  if (language === "HIN") {
    return `${count} ${scopeText} à¤¥à¥à¤°à¥‡à¤¡`;
  }
  if (language === "HING") {
    return `${count} ${scopeText} thread`;
  }
  return `${count} ${scopeText.toLowerCase()} thread${count === 1 ? "" : "s"}`;
}

function readerThreadsHint(language: AppLanguage) {
  if (language === "HIN") {
    return "à¤…à¤­à¥€ à¤•à¥‹à¤ˆ à¤°à¥€à¤¡à¤° à¤¥à¥à¤°à¥‡à¤¡ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¥¤ à¤¸à¤¾à¤®à¤¾à¤¨à¥à¤¯ à¤šà¥ˆà¤Ÿ à¤‡à¤¤à¤¿à¤¹à¤¾à¤¸ à¤¸à¤¾à¤®à¤¾à¤¨à¥à¤¯ à¤Ÿà¥ˆà¤¬ à¤®à¥‡à¤‚ à¤¹à¥ˆà¥¤";
  }
  if (language === "HING") {
    return "Abhi koi reader thread nahi hai. General chat history General tab me hai.";
  }
  return "No reader threads yet. General chat history is in the General tab.";
}

function openReaderLabel(language: AppLanguage) {
  if (language === "HIN") return "à¤°à¥€à¤¡à¤° à¤–à¥‹à¤²à¥‡à¤‚";
  if (language === "HING") return "Reader kholo";
  return "Open Reader";
}

function readerContinueHint(language: AppLanguage) {
  if (language === "HIN") return "à¤†à¤—à¥‡ à¤¬à¤¢à¤¼à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤°à¥€à¤¡à¤° à¤®à¥‡à¤‚ à¤–à¥‹à¤²à¥‡à¤‚à¥¤";
  if (language === "HING") return "Continue karne ke liye Reader me kholo.";
  return "Open in Reader workspace to continue.";
}

function generalContinueHint(language: AppLanguage) {
  if (language === "HIN") return "à¤‡à¤¸ à¤¬à¤¾à¤¤à¤šà¥€à¤¤ à¤•à¥‹ à¤†à¤—à¥‡ à¤œà¤¾à¤°à¥€ à¤°à¤–à¥‡à¤‚à¥¤";
  if (language === "HING") return "Is conversation ko aage continue karo.";
  return "Ready to continue this conversation.";
}

function readerEmptyHint(language: AppLanguage) {
  if (language === "HIN") {
    return "à¤…à¤­à¥€ à¤•à¥‹à¤ˆ à¤°à¥€à¤¡à¤° à¤¥à¥à¤°à¥‡à¤¡ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¥¤ à¤¦à¤¸à¥à¤¤à¤¾à¤µà¥‡à¤œ à¤¸à¥‡ à¤°à¥€à¤¡à¤° à¤–à¥‹à¤²à¤•à¤° à¤¨à¤¯à¤¾ à¤¥à¥à¤°à¥‡à¤¡ à¤¬à¤¨à¤¾à¤à¤‚à¥¤";
  }
  if (language === "HING") {
    return "Abhi koi reader thread nahi hai. Document se Reader kholo aur naya thread banao.";
  }
  return "No reader threads yet. Open Reader from a document to create one.";
}

function guidedEmptyHint(language: AppLanguage) {
  if (language === "HING") {
    return "Abhi koi Run Guide thread nahi hai. Naya guide start karo.";
  }
  return "No run guide threads yet. Start a new guided operation.";
}

function startGuidedLabel(language: AppLanguage) {
  if (language === "HING") return "Guide shuru karo";
  return "Start Guide";
}

function operationStatusLabel(message: ChatMessage) {
  if (message.requiresSupervisor) return "Supervisor help";
  if (message.completionRecordId) return "Completed";
  if (!message.operationStateLabel) return null;
  const normalized = message.operationStateLabel.toLowerCase();
  if (normalized.includes("learning")) return "Learning";
  if (normalized.includes("pre-check")) return "Pre-checks";
  if (normalized.includes("live")) return "Live guide";
  if (normalized.includes("task")) return "Task setup";
  return null;
}

function shouldShowOperationStep(message: ChatMessage) {
  return (
    message.responseMode === "operation" &&
    !message.requiresSupervisor &&
    !message.completionRecordId &&
    Boolean(message.operationStateLabel?.toLowerCase().includes("live")) &&
    Boolean(message.operationStepIndex)
  );
}

function shiftCommandLabel(language: AppLanguage) {
  if (language === "HIN") return "à¤¶à¤¿à¤«à¥à¤Ÿ à¤•à¤®à¤¾à¤¨à¥à¤¡";
  if (language === "HING") return "Shift command";
  return "Shift Command";
}

function latestRevisionLabel(language: AppLanguage) {
  if (language === "HIN") return "à¤¨à¤¯à¤¾ à¤°à¤¿à¤µà¤¿à¤œà¤¨";
  if (language === "HING") return "Latest revision";
  return "Latest Revision";
}

function noDocumentLabel(language: AppLanguage) {
  if (language === "HIN") return "à¤•à¥‹à¤ˆ à¤¦à¤¸à¥à¤¤à¤¾à¤µà¥‡à¤œ à¤¨à¤¹à¥€à¤‚";
  if (language === "HING") return "Koi document nahi";
  return "No document";
}

function noApprovedRevisionLabel(language: AppLanguage) {
  if (language === "HIN") return "à¤…à¤­à¥€ à¤•à¥‹à¤ˆ à¤…à¤¨à¥à¤®à¥‹à¤¦à¤¿à¤¤ à¤°à¤¿à¤µà¤¿à¤œà¤¨ à¤¨à¤¹à¥€à¤‚ à¤®à¤¿à¤²à¤¾à¥¤";
  if (language === "HING") return "Abhi koi approved revision nahi mila.";
  return "No approved revision found yet.";
}

function generatingResponseLabel(language: AppLanguage) {
  if (language === "HIN") return "à¤œà¤µà¤¾à¤¬ à¤¬à¤¨ à¤°à¤¹à¤¾ à¤¹à¥ˆ...";
  if (language === "HING") return "Answer ban raha hai...";
  return "Generating response...";
}

function backToHubLabel(language: AppLanguage) {
  if (language === "HIN") return "â† à¤•à¤®à¤¾à¤¨à¥à¤¡ à¤¹à¤¬ à¤ªà¤° à¤µà¤¾à¤ªà¤¸";
  if (language === "HING") return "â† Command Hub par wapas";
  return "â† Back to Command Hub";
}

function shouldAutoOpenSourcePanel(query: string, citations: CitationType[]) {
  if (citations.length === 0) return false;

  const normalizedQuery = query.toLowerCase();
  const nonDocumentIntent =
    /\b(training|module|quiz|assessment|score|rating|rank|badge|xp|level|certificate|certification|streak|progress|performance)\b/.test(
      normalizedQuery,
    );
  if (nonDocumentIntent) return false;

  const documentIntent =
    /\b(sop|manual|document|doc|page|revision|rev|section|procedure|instruction|source|pdf|safety|chemical|ppe|permit|machine)\b/.test(
      normalizedQuery,
    ) ||
    /\b\d+(st|nd|rd|th)?\s+(page|sop|manual|document|doc)\b/.test(
      normalizedQuery,
    );

  if (!documentIntent) return false;

  const uniqueDocuments = new Set(
    citations
      .map((citation) => citation.documentCode || citation.documentTitle)
      .filter(Boolean),
  );

  return uniqueDocuments.size === 1;
}

function isHindiLike(languageCode?: string | null, text?: string) {
  const normalized = (languageCode || "").toLowerCase();
  if (normalized.startsWith("hi")) {
    return true;
  }
  return /[\u0900-\u097F]/.test(text || "");
}

function getHighlightBoxes(
  citation: CitationType | null,
  pagePayload: PagePayload | null,
  proofTarget?: string | null,
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

  const normalizedProofTarget = normalizeForMatch(proofTarget || "");
  if (normalizedProofTarget) {
    const textMatchedHighlights = pagePayload.blocks
      .filter((block) => {
        const blockText = normalizeForMatch(block.text || "");
        return (
          blockText.length > 0 &&
          (normalizedProofTarget.includes(blockText) ||
            blockText.includes(normalizedProofTarget) ||
            normalizedProofTarget
              .split(" ")
              .filter(Boolean)
              .slice(0, 8)
              .every((word) => blockText.includes(word)))
        );
      })
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

    if (textMatchedHighlights.length > 0) {
      return textMatchedHighlights;
    }
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

function normalizeAnswerText(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\r/g, "")
    .trim();
}

function parseAnswerParagraphs(
  text: string,
  citations?: CitationType[],
): AnswerParagraph[] {
  const normalized = normalizeAnswerText(text);
  const lines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const segments: AnswerParagraph["segments"] = [];
    const citationPattern = /\[(\d+)([^\]]*)\]/g;
    let lastIndex = 0;
    let primaryCitation: CitationType | null = null;

    for (const match of line.matchAll(citationPattern)) {
      const matchIndex = match.index ?? 0;
      if (matchIndex > lastIndex) {
        segments.push({
          text: line.slice(lastIndex, matchIndex),
          citation: null,
          isCitation: false,
        });
      }

      const citationIndex = Number(match[1]) - 1;
      const citation = citations?.[citationIndex] ?? null;
      if (!primaryCitation && citation) {
        primaryCitation = citation;
      }

      segments.push({
        text: match[0],
        citation,
        isCitation: true,
      });
      lastIndex = matchIndex + match[0].length;
    }

    if (lastIndex < line.length) {
      segments.push({
        text: line.slice(lastIndex),
        citation: null,
        isCitation: false,
      });
    }

    return {
      text: line,
      proofText: line.replace(/\[[^\]]+\]/g, "").trim(),
      primaryCitation,
      segments: segments.length
        ? segments
        : [
            {
              text: line,
              citation: null,
              isCitation: false,
            },
          ],
    };
  });
}

function getSourceProofText(
  citation: CitationType | null,
  pagePayload: PagePayload | null,
) {
  if (!citation || !pagePayload) {
    return "";
  }

  const blockTexts = pagePayload.blocks
    .filter(
      (block) =>
        citation.blockIds.includes(block.block_id) && (block.text || "").trim(),
    )
    .map((block) => (block.text || "").trim());

  if (blockTexts.length > 0) {
    return blockTexts.join("\n\n");
  }

  return (pagePayload.page.raw_text || "").trim();
}

function normalizeForMatch(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function getProofHighlightPhrases(
  citation: CitationType | null,
  pagePayload: PagePayload | null,
) {
  if (!citation || !pagePayload) {
    return [] as string[];
  }

  const phrases = pagePayload.blocks
    .filter(
      (block) =>
        citation.blockIds.includes(block.block_id) && (block.text || "").trim(),
    )
    .map((block) => (block.text || "").trim())
    .filter(Boolean);

  if (phrases.length > 0) {
    return phrases;
  }

  const fallback = (pagePayload.page.raw_text || "").trim();
  return fallback ? [fallback] : [];
}

function highlightProofText(text: string, phrases: string[]) {
  if (!text.trim() || phrases.length === 0) {
    return [{ text, highlighted: false }] as TextSegment[];
  }

  const normalizedText = normalizeForMatch(text);
  const normalizedPhrases = phrases
    .map((phrase) => ({
      raw: phrase,
      normalized: normalizeForMatch(phrase),
    }))
    .filter((item) => item.normalized.length >= 20)
    .sort((a, b) => b.normalized.length - a.normalized.length);

  const match = normalizedPhrases.find((item) =>
    normalizedText.includes(item.normalized),
  );

  if (!match) {
    return [{ text, highlighted: false }] as TextSegment[];
  }

  const phraseWords = match.raw.split(/\s+/).filter(Boolean);
  if (phraseWords.length < 4) {
    return [{ text, highlighted: false }] as TextSegment[];
  }

  const escapedWords = phraseWords
    .slice(0, Math.min(24, phraseWords.length))
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escapedWords.join("\\s+")})`, "i");
  const parts = text.split(regex);

  if (parts.length === 1) {
    return [{ text, highlighted: false }] as TextSegment[];
  }

  return parts
    .filter((part) => part.length > 0)
    .map((part) => ({
      text: part,
      highlighted: regex.test(part),
    }));
}

const COPY: Record<AppLanguage, LookupCopy> = {
  ENG: {
    title: "Ask SOP, get exact answer",
    subtitle:
      "Type or speak your question. Response is grounded in approved documents.",
    placeholder: "Ask procedure, safety step, machine operation...",
    followUpPlaceholder: "Ask...",
    askButton: "Ask",
    voiceStartAction: "Start voice",
    voiceStopRecordingAction: "Stop and send",
    voiceCancelProcessingAction: "Cancel",
    voiceStopPlaybackAction: "Stop audio",
    voiceReady: "Tap once to start. Tap again to stop and send.",
    listening: "Listening. Speak now.",
    voiceProcessing: "Processing voice query. Tap cancel to stop.",
    voicePlaying: "Playing voice answer. Tap stop audio to end playback.",
    conversation: "Conversation",
    sources: "Sources",
    sourceDoc: "Source Document",
    noDocTitle: "No source selected",
    noDocHint: "Tap a source chip to view exact document text.",
    loadDoc: "Loading document...",
    assistantTag: "Assistant",
    chunkTag: "Retrieved Chunk",
    sourceProofLabel: "Exact source text",
    voiceError: "Voice query failed. Please try again.",
    queryError: "Could not connect to backend right now.",
    voiceUnsupported: "Voice input is not supported in this browser.",
    newChat: "New Chat",
    recentChats: "Recent Chats",
    noChats: "No saved chats yet.",
    loadingChats: "Loading saved chats...",
    features: ["Voice query", "Hindi/Hinglish", "Exact source text"],
  },
  HIN: {
    title: "SOP à¤ªà¥‚à¤›à¥‡à¤‚, à¤¸à¤¹à¥€ à¤‰à¤¤à¥à¤¤à¤° à¤ªà¤¾à¤à¤‚",
    subtitle:
      "à¤ªà¥à¤°à¤¶à¥à¤¨ à¤Ÿà¤¾à¤‡à¤ª à¤•à¤°à¥‡à¤‚ à¤¯à¤¾ à¤¬à¥‹à¤²à¥‡à¤‚à¥¤ à¤‰à¤¤à¥à¤¤à¤° à¤•à¥‡à¤µà¤² à¤…à¤¨à¥à¤®à¥‹à¤¦à¤¿à¤¤ à¤¦à¤¸à¥à¤¤à¤¾à¤µà¥‡à¤œà¥‹à¤‚ à¤¸à¥‡ à¤®à¤¿à¤²à¥‡à¤—à¤¾à¥¤",
    placeholder: "à¤ªà¥à¤°à¤•à¥à¤°à¤¿à¤¯à¤¾, à¤¸à¥à¤°à¤•à¥à¤·à¤¾ à¤¸à¥à¤Ÿà¥‡à¤ª, à¤®à¤¶à¥€à¤¨ à¤‘à¤ªà¤°à¥‡à¤¶à¤¨ à¤ªà¥‚à¤›à¥‡à¤‚...",
    followUpPlaceholder: "à¤…à¤—à¤²à¤¾ à¤ªà¥à¤°à¤¶à¥à¤¨ à¤ªà¥‚à¤›à¥‡à¤‚...",
    askButton: "à¤ªà¥‚à¤›à¥‡à¤‚",
    voiceStartAction: "Voice shuru karein",
    voiceStopRecordingAction: "Rok kar bhejein",
    voiceCancelProcessingAction: "Radd karein",
    voiceStopPlaybackAction: "Audio rokein",
    voiceReady: "Ek baar tap karke bolna shuru karein. Dobara tap karke bhejein.",
    listening: "à¤¸à¥à¤¨ à¤°à¤¹à¤¾ à¤¹à¥ˆà¥¤ à¤…à¤­à¥€ à¤¬à¥‹à¤²à¥‡à¤‚à¥¤",
    voiceProcessing: "Voice query process ho rahi hai. Radd karne ke liye tap karein.",
    voicePlaying: "Voice jawab baj raha hai. Audio rokne ke liye tap karein.",
    conversation: "à¤¬à¤¾à¤¤à¤šà¥€à¤¤",
    sources: "à¤¸à¥à¤°à¥‹à¤¤",
    sourceDoc: "à¤¸à¥à¤°à¥‹à¤¤ à¤¦à¤¸à¥à¤¤à¤¾à¤µà¥‡à¤œ",
    noDocTitle: "à¤•à¥‹à¤ˆ à¤¸à¥à¤°à¥‹à¤¤ à¤šà¤¯à¤¨à¤¿à¤¤ à¤¨à¤¹à¥€à¤‚",
    noDocHint: "à¤¸à¤¹à¥€ à¤Ÿà¥‡à¤•à¥à¤¸à¥à¤Ÿ à¤¦à¥‡à¤–à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤¸à¥à¤°à¥‹à¤¤ à¤šà¤¿à¤ª à¤ªà¤° à¤•à¥à¤²à¤¿à¤• à¤•à¤°à¥‡à¤‚à¥¤",
    loadDoc: "à¤¦à¤¸à¥à¤¤à¤¾à¤µà¥‡à¤œ à¤²à¥‹à¤¡ à¤¹à¥‹ à¤°à¤¹à¤¾ à¤¹à¥ˆ...",
    assistantTag: "à¤¸à¤¹à¤¾à¤¯à¤•",
    chunkTag: "à¤®à¤¿à¤²à¤¾ à¤¹à¥à¤† à¤­à¤¾à¤—",
    sourceProofLabel: "à¤¸à¥à¤°à¥‹à¤¤ à¤ªà¥à¤°à¤®à¤¾à¤£",
    voiceError: "à¤µà¥‰à¤‡à¤¸ à¤•à¥à¤µà¥‡à¤°à¥€ à¤¨à¤¹à¥€à¤‚ à¤šà¤²à¥€à¥¤ à¤«à¤¿à¤° à¤¸à¥‡ à¤•à¥‹à¤¶à¤¿à¤¶ à¤•à¤°à¥‡à¤‚à¥¤",
    queryError: "à¤…à¤­à¥€ à¤¬à¥ˆà¤•à¤à¤‚à¤¡ à¤¸à¥‡ à¤•à¤¨à¥‡à¤•à¥à¤Ÿ à¤¨à¤¹à¥€à¤‚ à¤¹à¥‹ à¤ªà¤¾à¤¯à¤¾à¥¤",
    voiceUnsupported: "à¤‡à¤¸ à¤¬à¥à¤°à¤¾à¤‰à¤œà¤° à¤®à¥‡à¤‚ à¤µà¥‰à¤‡à¤¸ à¤‡à¤¨à¤ªà¥à¤Ÿ à¤‰à¤ªà¤²à¤¬à¥à¤§ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¥¤",
    newChat: "à¤¨à¤ˆ à¤šà¥ˆà¤Ÿ",
    recentChats: "à¤ªà¥à¤°à¤¾à¤¨à¥€ à¤šà¥ˆà¤Ÿ",
    noChats: "à¤…à¤­à¥€ à¤•à¥‹à¤ˆ à¤¸à¥‡à¤µ à¤šà¥ˆà¤Ÿ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¥¤",
    loadingChats: "à¤¸à¥‡à¤µ à¤šà¥ˆà¤Ÿ à¤²à¥‹à¤¡ à¤¹à¥‹ à¤°à¤¹à¥€ à¤¹à¥ˆ...",
    features: ["à¤µà¥‰à¤‡à¤¸ à¤•à¥à¤µà¥‡à¤°à¥€", "à¤¹à¤¿à¤‚à¤¦à¥€/à¤¹à¤¿à¤‚à¤—à¥à¤²à¤¿à¤¶", "à¤¸à¥à¤°à¥‹à¤¤ à¤ªà¥à¤°à¤®à¤¾à¤£"],
  },
  HING: {
    title: "SOP pucho, exact answer lo",
    subtitle: "Type karo ya bolo. Jawab sirf approved documents se aayega.",
    placeholder: "Procedure, safety step, machine operation pucho...",
    followUpPlaceholder: "Next question pucho...",
    askButton: "Pucho",
    voiceStartAction: "Voice start",
    voiceStopRecordingAction: "Stop karke bhejo",
    voiceCancelProcessingAction: "Cancel",
    voiceStopPlaybackAction: "Audio stop",
    voiceReady: "Ek tap se recording start hogi. Dobara tap se stop karke send hoga.",
    listening: "Listening. Ab bolo.",
    voiceProcessing: "Voice query process ho rahi hai. Cancel tap karo.",
    voicePlaying: "Voice answer chal raha hai. Audio stop tap karo.",
    conversation: "Conversation",
    sources: "Sources",
    sourceDoc: "Source Document",
    noDocTitle: "Source select nahi hua",
    noDocHint: "Exact text dekhne ke liye source chip tap karo.",
    loadDoc: "Document load ho raha hai...",
    assistantTag: "Assistant",
    chunkTag: "Retrieved Chunk",
    sourceProofLabel: "Source ka exact text",
    voiceError: "Voice query fail hui. Dobara try karo.",
    queryError: "Abhi backend se connect nahi ho pa raha.",
    voiceUnsupported: "Is browser me voice input support nahi hai.",
    newChat: "Nayi Chat",
    recentChats: "Recent Chats",
    noChats: "Abhi koi saved chat nahi hai.",
    loadingChats: "Saved chats load ho rahi hain...",
    features: ["Voice query", "Hindi/Hinglish", "Source ka exact text"],
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
  const router = useRouter();
  const { user, language, setLanguage } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isFreshChatOpen, setIsFreshChatOpen] = useState(false);
  const [isConversationViewOpen, setIsConversationViewOpen] = useState(false);
  const [conversations, setConversations] = useState<
    ConversationSummaryPayload[]
  >([]);
  const [conversationScopeTab, setConversationScopeTab] =
    useState<ConversationScope>("general");
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [isConversationLoading, setIsConversationLoading] = useState(false);
  const [activeCitation, setActiveCitation] = useState<CitationType | null>(
    null,
  );
  const [activeProofTarget, setActiveProofTarget] = useState<string | null>(
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
  const [workerBrief, setWorkerBrief] = useState<WorkerBriefResponse | null>(
    null,
  );
  const [dashboardLoading, setDashboardLoading] = useState(false);
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
  const followUpInputRef = useRef<HTMLInputElement>(null);
  const initialQueryHandledRef = useRef(false);
  const conversationsBootstrappedRef = useRef(false);

  const hasStarted = isFreshChatOpen || chatMessages.length > 0;
  const showConversationView = hasStarted && isConversationViewOpen;
  const copy = COPY[language];
  const isListening = voiceState === "recording";
  const isVoiceProcessing = voiceState === "processing";
  const isVoicePlaying = voiceState === "playing";
  const pageImageUrl = normalizeApiAssetUrl(pagePayload?.page?.image_url);
  const highlightBoxes = getHighlightBoxes(
    activeCitation,
    pagePayload,
    activeProofTarget,
  );
  const sourceProofText = getSourceProofText(activeCitation, pagePayload);
  const proofTextSegments = highlightProofText(
    sourceProofText,
    getProofHighlightPhrases(activeCitation, pagePayload),
  );
  const showSourcePanel = Boolean(activeCitation);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceAbortControllerRef.current?.abort();
      activeAudioRef.current?.pause();
      if (activeAudioUrlRef.current) {
        URL.revokeObjectURL(activeAudioUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setDashboardData(null);
      setWorkerBrief(null);
      return;
    }

    let cancelled = false;
    const loadDashboardSummary = async () => {
      setDashboardLoading(true);
      try {
        const payload = (await apiClient.get(
          `/api/dashboard/summary?user_id=${encodeURIComponent(user.id)}`,
        )) as DashboardSummaryResponse;
        const brief = (await apiClient.get(
          `/api/worker/brief?user_id=${encodeURIComponent(user.id)}`,
        )) as WorkerBriefResponse;
        if (!cancelled) {
          setDashboardData(payload);
          setWorkerBrief(brief);
        }
      } catch {
        if (!cancelled) {
          setDashboardData(null);
          setWorkerBrief(null);
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

  useEffect(() => {
    if (!user?.id) {
      setConversations([]);
      setActiveConversationId(null);
      setChatMessages([]);
      setIsFreshChatOpen(false);
      setIsConversationViewOpen(false);
      conversationsBootstrappedRef.current = false;
      return;
    }

    let cancelled = false;

    const loadConversationState = async () => {
      try {
        const items = await refreshConversations(conversationScopeTab);
        if (cancelled) return;

        if (conversationScopeTab === "reader") {
          setActiveConversationId(null);
          setChatMessages([]);
          setIsFreshChatOpen(false);
          setIsConversationViewOpen(false);
          return;
        }

        const query = new URLSearchParams(window.location.search).get("q");
        if (
          !query &&
          !conversationsBootstrappedRef.current &&
          !activeConversationId &&
          items[0]?.id
        ) {
          conversationsBootstrappedRef.current = true;
          await loadConversation(items[0].id);
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setConversations([]);
        }
      }
    };

    void loadConversationState();
    return () => {
      cancelled = true;
    };
  }, [user?.id, conversationScopeTab]);

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

  const mapConversationMessage = (
    message: ConversationMessagePayload,
  ): ChatMessage => ({
    id: message.id,
    role: message.role,
    content: message.content,
    citations: (message.citations || []).map(mapCitationPayload),
    createdAt: message.created_at,
    responseMode: message.response_mode,
    language: message.language,
    ttsText: message.content,
  });

  async function refreshConversations(
    scope: ConversationScope,
    preferredConversationId?: string | null,
  ) {
    if (!user?.id) return [];

    try {
      const payload = (await apiClient.get(
        `/api/conversations?user_id=${encodeURIComponent(user.id)}&limit=12&scope=${scope}`,
      )) as ConversationSummaryPayload[];
      setConversations(payload);
      if (scope === "general" && preferredConversationId) {
        setActiveConversationId(preferredConversationId);
      }
      return payload;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Backend unavailable")
      ) {
        console.warn(error.message);
        return [];
      }
      console.error(error);
      return [];
    }
  }

  async function loadConversation(
    conversationId: string,
    scope: ConversationScope = conversationScopeTab,
  ) {
    if (!user?.id) return;

    setIsConversationLoading(true);
    try {
      const payload = (await apiClient.get(
        `/api/conversations/${conversationId}?user_id=${encodeURIComponent(user.id)}&scope=${scope}`,
      )) as ConversationDetailPayload;
      const mappedMessages = payload.messages.map(mapConversationMessage);
      setActiveConversationId(payload.conversation.id);
      setChatMessages(mappedMessages);
      setIsFreshChatOpen(false);
      setIsConversationViewOpen(true);
      setActiveCitation(null);
      setActiveProofTarget(null);
      setPagePayload(null);
    } finally {
      setIsConversationLoading(false);
    }
  }

  function startNewConversation() {
    if (conversationScopeTab === "reader") {
      const readerRevisionId =
        conversations.find((item) => item.revision_id)?.revision_id ||
        recentSops.find((item) => item.revision_id)?.revision_id;
      if (readerRevisionId) {
        router.push(`/operator/reader/${readerRevisionId}?page=1`);
      }
      return;
    }

    conversationsBootstrappedRef.current = true;
    setActiveConversationId(null);
    setChatMessages(
      conversationScopeTab === "guided"
        ? [
            {
              id: createLocalMessageId("guided-intro"),
              role: "assistant",
              content:
                "Tell me the equipment and task. Example: how to start centrifugal pump. I will ask whether you want to run it now or learn first.",
              language: toQueryLanguage(language),
              responseMode: "operation",
              nextActions: [
                "How to start centrifugal pump",
                "Run centrifugal pump now",
                "Learn centrifugal pump startup",
              ],
            },
          ]
        : [],
    );
    setIsFreshChatOpen(true);
    setIsConversationViewOpen(true);
    setSearchQuery("");
    setActiveCitation(null);
    setActiveProofTarget(null);
    setPagePayload(null);
    setPageImageSize(null);
    router.replace("/operator", { scroll: false });
  }

  useEffect(() => {
    if (!hasStarted) return;
    if (chatMessages.length > 0) return;
    const timer = window.setTimeout(() => {
      followUpInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hasStarted, chatMessages.length]);

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

  const getVoiceHelperText = () => {
    if (isListening) return copy.listening;
    if (isVoiceProcessing) return copy.voiceProcessing;
    if (isVoicePlaying) return copy.voicePlaying;
    return copy.voiceReady;
  };

  const getVoiceButtonLabel = () => {
    if (isListening) return copy.voiceStopRecordingAction;
    if (isVoiceProcessing) return copy.voiceCancelProcessingAction;
    if (isVoicePlaying) return copy.voiceStopPlaybackAction;
    return copy.voiceStartAction;
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
      console.error("Voice playback failed", error);
    }
  };

  const updateChatMessage = (
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) => {
    setChatMessages((prev) =>
      prev.map((message) =>
        message.id === messageId ? updater(message) : message,
      ),
    );
  };

  const requestHindiTranslation = async (messageId: string) => {
    const message = chatMessages.find((item) => item.id === messageId);
    if (!message || message.role !== "assistant") return;
    if (message.translatedHindi) {
      updateChatMessage(messageId, (current) => ({
        ...current,
        translatedHindi: null,
      }));
      return;
    }

    if (isHindiLike(message.language, message.content)) {
      updateChatMessage(messageId, (current) => ({
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

      updateChatMessage(messageId, (current) => ({
        ...current,
        translatedHindi: payload.translated_text,
      }));
    } catch (error) {
      console.error(error);
    }
  };

  const requestSpeechForMessage = async (messageId: string) => {
    const message = chatMessages.find((item) => item.id === messageId);
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
        language: message.translatedHindi ? "hi-IN" : message.ttsLanguage || message.language || toSpeechLanguage(language),
        speaker: "suhani",
      })) as SpeechSynthesisApiResponse;

      updateChatMessage(messageId, (current) => ({
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
    formData.append("audio", audioBlob, `voice-query.${fileExtension}`);
    formData.append("language", "auto");
    formData.append("speaker", "suhani");
    if (user?.id) {
      formData.append("user_id", user.id);
    }
    if (activeConversationId) {
      formData.append("conversation_id", activeConversationId);
    }
    formData.append("chat_scope", "general");

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
      console.error("MediaRecorder error in Command Hub voice:", event);
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
        console.warn("Command Hub voice: no audio chunks recorded");
        setVoiceState("idle");
        return;
      }

      const audioBlob = new Blob(chunks, {
        type: recorder.mimeType || mimeType || "audio/webm",
      });

      if (!audioBlob.size) {
        console.warn("Command Hub voice: audio blob is empty");
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
        const citations = (voiceResponse.citations || []).map(
          mapCitationPayload,
        );
        const nextConversationId =
          voiceResponse.conversation_id || activeConversationId || null;
        const userMessageId = createLocalMessageId("voice-user");
        const assistantMessageId = createLocalMessageId("voice-assistant");

        setChatMessages((prev) => {
          const next = [...prev];
          if (voiceResponse.user_text?.trim()) {
            next.push({
              id: userMessageId,
              role: "user",
              content: voiceResponse.user_text,
              language: voiceResponse.detected_language || toSpeechLanguage(language),
            });
          }
          next.push({
            id: assistantMessageId,
            role: "assistant",
            content: voiceResponse.assistant_text || copy.voiceError,
            citations: citations.length > 0 ? citations : undefined,
            language: voiceResponse.detected_language || toSpeechLanguage(language),
            ttsText:
              voiceResponse.assistant_tts_text || voiceResponse.assistant_text,
            audioBase64: voiceResponse.audio_base64,
            audioMimeType: voiceResponse.audio_mime_type,
            ttsLanguage: voiceResponse.tts_language,
          });
          return next;
        });
        if (nextConversationId) {
          setActiveConversationId(nextConversationId);
          void refreshConversations("general", nextConversationId);
        }

        if (shouldAutoOpenSourcePanel(voiceResponse.user_text || "", citations)) {
          void loadCitation(citations[0]);
        } else {
          setActiveCitation(null);
          setActiveProofTarget(null);
          setPagePayload(null);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          setVoiceState("idle");
          return;
        }

        setVoiceState("idle");
        console.error("Command Hub voice query error:", error);
        setChatMessages((prev) => [
          ...prev,
          {
            id: createLocalMessageId("voice-error"),
            role: "assistant",
            content: copy.voiceError,
          },
        ]);
      } finally {
        voiceAbortControllerRef.current = null;
        setIsQuerying(false);
        setVoiceState((current) => (current === "processing" ? "idle" : current));
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
      console.error("Command Hub voice: failed to start recording", error);
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        alert(copy.voiceUnsupported);
      }
    }
  };

  const loadCitation = async (
    citation: CitationType,
    proofTarget?: string | null,
  ) => {
    if (!citation.chunkId) return;
    setActiveCitation(citation);
    setActiveProofTarget(proofTarget || null);
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
    setIsFreshChatOpen(true);
    setIsConversationViewOpen(true);
    const userMessageId = createLocalMessageId("user");
    const assistantMessageId = createLocalMessageId("assistant");
    setChatMessages((prev) => [
      ...prev,
      {
        id: userMessageId,
        role: "user",
        content: currentQuery,
        language: requestLanguageOverride ?? toQueryLanguage(language),
      },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        citations: [],
        language: requestLanguageOverride ?? toQueryLanguage(language),
        ttsText: "",
        responseMode: conversationScopeTab === "guided" ? "operation" : "text",
        isStreaming: true,
        streamStatus: "Verifying your request",
      },
    ]);
    setSearchQuery("");
    setIsQuerying(true);

    try {
      const requestLanguage = requestLanguageOverride ?? toQueryLanguage(language);
      const isGuidedMode = conversationScopeTab === "guided";

      if (isGuidedMode) {
        // Guided mode: use /api/operation-guide for state machine
        updateChatMessage(assistantMessageId, (current) => ({
          ...current,
          streamStatus: "Preparing the run guide",
        }));
        const guidedResponse = (await apiClient.post(
          "/api/operation-guide",
          {
            query: currentQuery,
            language: requestLanguage,
            role: "operator",
            user_id: user?.id,
            conversation_id: activeConversationId,
            chat_scope: "guided",
            top_k: 6,
          },
        )) as OperationGuideApiResponse;
        const guidedCitations = (guidedResponse.evidence || []).map(mapCitationPayload);
        const guidedConversationId =
          guidedResponse.conversation_id || activeConversationId || null;
        updateChatMessage(assistantMessageId, () => ({
          id: assistantMessageId,
          role: "assistant",
          content: guidedResponse.answer,
          citations: guidedCitations.length > 0 ? guidedCitations : undefined,
          language: requestLanguage,
          ttsText: guidedResponse.answer,
          responseMode: "operation",
          nextActions: guidedResponse.next_actions || [],
          operationStateLabel: guidedResponse.state_label || null,
          operationStepIndex: guidedResponse.step_index || null,
          requiresSupervisor: Boolean(guidedResponse.requires_supervisor),
          completionRecordId: guidedResponse.completion_record_id || null,
          isStreaming: false,
          streamStatus: null,
        }));
        if (guidedConversationId) {
          setActiveConversationId(guidedConversationId);
          void refreshConversations("guided", guidedConversationId);
        }
        if (shouldAutoOpenSourcePanel(currentQuery, guidedCitations)) {
          void loadCitation(guidedCitations[0]);
        } else {
          setActiveCitation(null);
          setActiveProofTarget(null);
          setPagePayload(null);
        }
      } else {
        // General mode: SSE streaming via /api/query/stream
        let finalResponse: QueryApiResponse | null = null;
        await postJsonSse(
          "/api/query/stream",
          {
            query: currentQuery,
            language: requestLanguage,
            role: "operator",
            user_id: user?.id,
            conversation_id: activeConversationId,
            chat_scope: "general",
            top_k: 5,
          },
          {
            onEvent: (event, payload) => {
              if (!payload || typeof payload !== "object") return;
              if (event === "status" && "message" in payload) {
                const message = String((payload as { message: unknown }).message);
                updateChatMessage(assistantMessageId, (current) => ({
                  ...current,
                  streamStatus: message,
                }));
              }
              if (event === "answer_delta" && "text" in payload) {
                const text = String((payload as { text: unknown }).text);
                updateChatMessage(assistantMessageId, (current) => ({
                  ...current,
                  content: `${current.content}${text}`,
                  ttsText: `${current.ttsText || current.content}${text}`,
                }));
              }
              if (event === "final") {
                finalResponse = payload as QueryApiResponse;
              }
              if (event === "error" && "message" in payload) {
                throw new Error(String((payload as { message: unknown }).message));
              }
            },
          },
        );

        if (!finalResponse) {
          throw new Error(copy.queryError);
        }

        const streamCitations = (finalResponse.evidence || []).map(mapCitationPayload);
        const streamConversationId =
          finalResponse.conversation_id || activeConversationId || null;
        updateChatMessage(assistantMessageId, (current) => ({
          ...current,
          content: finalResponse?.answer || current.content,
          citations: streamCitations.length > 0 ? streamCitations : undefined,
          language: requestLanguage,
          ttsText: finalResponse?.answer || current.content,
          responseMode: "text",
          isStreaming: false,
          streamStatus: null,
        }));
        if (streamConversationId) {
          setActiveConversationId(streamConversationId);
          void refreshConversations("general", streamConversationId);
        }

        if (shouldAutoOpenSourcePanel(currentQuery, streamCitations)) {
          void loadCitation(streamCitations[0]);
        } else {
          setActiveCitation(null);
          setActiveProofTarget(null);
          setPagePayload(null);
        }
      }
    } catch (error) {
      console.error(error);
      updateChatMessage(assistantMessageId, (current) => ({
          ...current,
          content: copy.queryError,
          isStreaming: false,
          streamStatus: null,
        }));
    } finally {
      setIsQuerying(false);
    }
  };

  const handleCitationClick = (citation: CitationType) => {
    trackEvent("ui.citation_opened", {
      documentCode: citation.documentCode,
      section: citation.sectionTitle,
    });
    void loadCitation(citation, null);
  };

  const openRecentDoc = (
    doc: DashboardSummaryResponse["recent_sops"] extends Array<infer T>
      ? T
      : never,
  ) => {
    if (doc.revision_id) {
      const params = new URLSearchParams({
        page: "1",
        code: doc.code || "",
        title: doc.title || "",
      });
      router.push(`/operator/reader/${doc.revision_id}?${params.toString()}`);
      return;
    }

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
  const todayItems = workerBrief?.today || [];
  const memory = workerBrief?.memory;
  const lastUsedLabel =
    [memory?.last_equipment, memory?.last_sop_code].filter(Boolean).join(" | ") ||
    "";
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
  const canOpenReaderFromTab = Boolean(
    conversations.find((item) => item.revision_id)?.revision_id ||
      recentSops.find((item) => item.revision_id)?.revision_id,
  );
  const todayTitle =
    language === "HIN"
      ? "Aaj ke kaam"
      : language === "HING"
        ? "Aaj ke kaam"
        : "Today for you";
  const noTodayText =
    language === "HIN"
      ? "Aaj koi urgent kaam nahi. Latest SOP ya training dekh sakte hain."
      : language === "HING"
        ? "Aaj koi urgent kaam nahi. Latest SOP ya training dekh lo."
        : "No urgent action. Review the latest SOP or continue training.";
  const openItemLabel =
    language === "HIN" ? "Open karein" : language === "HING" ? "Open karo" : "Open";
  const priorityClass = (priority?: string) =>
    priority === "high"
      ? "border-[#dc241f]/25 bg-[#fff1f0] text-[#b3201d]"
      : priority === "medium"
        ? "border-[#ffd329]/40 bg-[#fff8d9] text-[#7a6100]"
        : "border-[#00782a]/20 bg-[#ecf8f0] text-[#00782a]";

  const conversationStrip = (
    <div className="mb-4 rounded-[14px] border border-[#d2d8e0] bg-white p-3 shadow-[0px_6px_18px_rgba(0,25,168,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            {copy.recentChats}
          </p>
          <p className="mt-1 text-xs text-muted">
            {isConversationLoading
              ? copy.loadingChats
                : conversations.length > 0
                  ? conversationThreadSummary(
                      language,
                      conversationScopeTab,
                      conversations.length,
                    )
                : conversationScopeTab === "reader"
                  ? readerThreadsHint(language)
                  : conversationScopeTab === "guided"
                    ? guidedEmptyHint(language)
                  : copy.noChats}
          </p>
          <div className="mt-2 inline-flex items-center rounded-[10px] border border-border bg-[#f5f8fc] p-1">
            {(["general", "reader", "guided"] as ConversationScope[]).map((scope) => (
              <button
                key={scope}
                type="button"
                onClick={() => setConversationScopeTab(scope)}
                className={`rounded-[8px] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                  conversationScopeTab === scope
                    ? "bg-primary text-white"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {conversationScopeLabel(language, scope)}
              </button>
            ))}
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={startNewConversation}
          disabled={
            isQuerying || (conversationScopeTab === "reader" && !canOpenReaderFromTab)
          }
        >
          {conversationScopeTab === "reader"
            ? openReaderLabel(language)
            : conversationScopeTab === "guided"
              ? startGuidedLabel(language)
              : copy.newChat}
        </Button>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {conversations.length > 0 ? (
          conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => {
                if (conversationScopeTab === "reader") {
                  if (!conversation.revision_id) return;
                  const params = new URLSearchParams({
                    page: "1",
                    conversation_id: conversation.id,
                  });
                  router.push(
                    `/operator/reader/${conversation.revision_id}?${params.toString()}`,
                  );
                  return;
                }
                setIsConversationViewOpen(true);
                void loadConversation(conversation.id, conversationScopeTab);
              }}
              className={`min-w-[220px] rounded-[12px] border px-3 py-2 text-left transition-colors ${
                activeConversationId === conversation.id
                  ? "border-primary bg-[#eef3ff]"
                  : "border-border bg-[#f8fafd] hover:border-[#9fb0d0] hover:bg-white"
              } ${
                conversationScopeTab === "reader" && !conversation.revision_id
                  ? "cursor-not-allowed opacity-60"
                  : ""
              }`}
            >
              <p className="truncate text-sm font-semibold text-foreground">
                {conversation.title}
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-muted">
                {conversation.preview ||
                  (conversationScopeTab === "reader"
                    ? readerContinueHint(language)
                    : generalContinueHint(language))}
              </p>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
                <span>{conversation.message_count} msg</span>
                <span>{formatDateLabel(conversation.last_message_at)}</span>
              </div>
            </button>
          ))
        ) : (
          <div className="rounded-[12px] border border-dashed border-border px-3 py-2 text-xs text-muted">
            {conversationScopeTab === "reader"
              ? readerEmptyHint(language)
              : conversationScopeTab === "guided"
                ? guidedEmptyHint(language)
              : copy.noChats}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <OperatorLayout>
      <div className="relative min-h-[calc(100vh-170px)]">
        <div
          className={`transition duration-200 ${
            showConversationView
              ? "pointer-events-none select-none scale-[0.992] opacity-60 blur-[2px]"
              : ""
          }`}
        >
          {conversationStrip}
          <div className="grid gap-4 xl:grid-cols-[1.24fr_0.96fr]">
            <section className="rounded-[20px] border border-[#d2d8e0] bg-[#f4f7fb] p-4 shadow-[0px_8px_20px_rgba(0,25,168,0.06)] md:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                    {shiftCommandLabel(language)}
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

              <section className="mt-4 rounded-[12px] border border-border bg-white p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                      {todayTitle}
                    </p>
                    {lastUsedLabel ? (
                      <p className="mt-1 text-xs text-muted">
                        Last used: {lastUsedLabel}
                      </p>
                    ) : null}
                  </div>
                  {memory?.interaction_count ? (
                    <span className="rounded-full border border-[#00782a]/20 bg-[#ecf8f0] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#00782a]">
                      {memory.interaction_count} assisted
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {todayItems.length === 0 ? (
                    <div className="rounded-[10px] border border-dashed border-border bg-[#f8fafd] p-3 text-sm text-muted md:col-span-3">
                      {dashboardLoading ? "Loading..." : noTodayText}
                    </div>
                  ) : (
                    todayItems.slice(0, 3).map((item, index) => (
                      <button
                        key={`${item.type}-${item.title}-${index}`}
                        type="button"
                        onClick={() => {
                          if (item.type === "supervisor_handoff") {
                            setConversationScopeTab("guided");
                            setIsFreshChatOpen(true);
                            setIsConversationViewOpen(true);
                            return;
                          }
                          if (item.cta_url) {
                            router.push(item.cta_url);
                          }
                        }}
                        className="rounded-[10px] border border-border bg-[#f8fafd] p-3 text-left transition-colors hover:border-[#9fb0d0] hover:bg-white"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="line-clamp-2 text-sm font-semibold text-foreground">
                            {item.title}
                          </p>
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${priorityClass(item.priority)}`}
                          >
                            {item.priority || "info"}
                          </span>
                        </div>
                        {item.detail ? (
                          <p className="mt-1.5 line-clamp-2 text-xs text-muted">
                            {item.detail}
                          </p>
                        ) : null}
                        <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">
                          {openItemLabel}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </section>

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
                      disabled={isQuerying && !isVoiceProcessing}
                      className={`inline-flex items-center gap-2 rounded-[8px] border px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${
                        isListening
                          ? "border-danger bg-danger text-white"
                          : isVoiceProcessing
                            ? "border-[#ffd329] bg-[#ffd329] text-[#232323]"
                            : isVoicePlaying
                              ? "border-secondary bg-secondary text-white"
                              : "border-border bg-white text-muted hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                      }`}
                    >
                      <SiriRing animate={voiceState !== "idle"} />
                      {getVoiceButtonLabel()}
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
                  {latestRevisionLabel(language)}
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {recentSops[0]?.code || noDocumentLabel(language)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {recentSops[0]
                    ? `${recentSops[0].title} | Rev ${recentSops[0].revision_label || "-"}`
                    : noApprovedRevisionLabel(language)}
                </p>
                {recentSops[0]?.revision_id ? (
                  <button
                    onClick={() => openRecentDoc(recentSops[0])}
                    className="mt-2 rounded-[8px] border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary transition-colors hover:border-primary hover:bg-primary hover:text-white"
                  >
                    {openReaderLabel(language)}
                  </button>
                ) : null}
              </div>
            </section>
          </div>
        </div>

        {showConversationView ? (
          <div className="fixed inset-x-0 bottom-4 top-[132px] z-[80] flex items-start justify-center bg-[#07122f]/38 px-3 pt-2 backdrop-blur-md md:px-6">
            <div className="h-full w-[min(1580px,96vw)] overflow-hidden rounded-[24px] border border-white/60 bg-[#edf3f8] shadow-[0_28px_80px_rgba(0,25,168,0.28)]">
              <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3 lg:flex-row">
            <div
              className={`${
                showSourcePanel ? "lg:w-[62%]" : "lg:w-full"
              } tfl-panel flex min-h-0 flex-col overflow-hidden`}
            >
              <div className="flex items-center justify-between border-b border-border bg-[rgba(248,251,255,0.85)] px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setIsConversationViewOpen(false)}
                    className="rounded-full border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-primary hover:text-primary"
                  >
                    {backToHubLabel(language)}
                  </button>
                  <h2 className="text-sm font-semibold text-foreground">
                    {copy.conversation}
                  </h2>
                </div>
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
                    key={msg.id}
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
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <SiriRing animate={Boolean(msg.isStreaming)} />
                              <span className="text-xs font-medium text-muted">
                                {msg.responseMode === "operation"
                                  ? "Run Guide"
                                  : copy.assistantTag}
                              </span>
                              {msg.responseMode === "operation" &&
                              operationStatusLabel(msg) ? (
                                <span className="rounded-full bg-[#00782a]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#00782a]">
                                  {operationStatusLabel(msg)}
                                </span>
                              ) : null}
                              {shouldShowOperationStep(msg) ? (
                                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">
                                  step {msg.operationStepIndex}
                                </span>
                              ) : null}
                              {msg.requiresSupervisor ? (
                                <span className="rounded-full bg-danger-light px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-danger">
                                  supervisor
                                </span>
                              ) : null}
                              {msg.completionRecordId ? (
                                <span className="rounded-full bg-secondary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-secondary">
                                  {msg.completionRecordId}
                                </span>
                              ) : null}
                            </div>
                            {!msg.isStreaming ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void requestHindiTranslation(msg.id)}
                                className="inline-flex items-center gap-1 rounded-full border border-[#d8dfec] bg-[#f6f8ff] px-2.5 py-1 text-[11px] font-semibold text-[#2947b2] transition-colors hover:border-[#a9b8e4] hover:bg-white"
                                title={msg.translatedHindi ? "Hide Hindi translation" : "Translate to Hindi"}
                              >
                                <TranslateSparkIcon className="h-3.5 w-3.5" />
                                <span>Hindi</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => void requestSpeechForMessage(msg.id)}
                                className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                                  activeAudioMessageId === msg.id && isVoicePlaying
                                    ? "border-secondary bg-secondary text-white"
                                    : "border-[#d8dfec] bg-[#f6f8ff] text-[#2947b2] hover:border-[#a9b8e4] hover:bg-white"
                                }`}
                                title={activeAudioMessageId === msg.id && isVoicePlaying ? "Stop audio" : "Speak answer"}
                              >
                                {activeAudioMessageId === msg.id && isVoicePlaying ? (
                                  <StopSquareIcon className="h-3.5 w-3.5" />
                                ) : (
                                  <SpeakerWaveIcon className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                            ) : null}
                          </div>
                          {msg.isStreaming ? (
                            <div className="mb-3 rounded-[12px] border border-[#c9d6f2] bg-[#f5f8ff] px-3 py-2 shadow-[0_8px_22px_rgba(0,25,168,0.06)]">
                              <div className="flex items-center gap-2 text-[12px] font-semibold text-[#2947b2]">
                                <SiriRing animate />
                                <span>
                                  {msg.streamStatus || "Generating your response"}
                                </span>
                              </div>
                              {!msg.content ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {["safety", "sources", "answer"].map((label) => (
                                    <span
                                      key={label}
                                      className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted"
                                    >
                                      {label}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="space-y-2">
                            {parseAnswerParagraphs(
                              msg.content,
                              msg.citations,
                            ).map((paragraph, paragraphIndex) =>
                              paragraph.primaryCitation ? (
                                <button
                                  key={`${idx}-${paragraphIndex}`}
                                  type="button"
                                  onClick={() => {
                                    const citation =
                                      paragraph.primaryCitation as CitationType;
                                    trackEvent("ui.citation_opened", {
                                      documentCode: citation.documentCode,
                                      section: citation.sectionTitle,
                                    });
                                    void loadCitation(
                                      citation,
                                      paragraph.proofText,
                                    );
                                  }}
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  className="block w-full rounded-[10px] border border-transparent px-2 py-1.5 text-left transition-colors hover:border-[#c8d2e5] hover:bg-[#f7faff]"
                                >
                                  <span className="text-sm leading-relaxed text-foreground">
                                    {paragraph.segments.map(
                                      (segment, segmentIndex) =>
                                        segment.isCitation &&
                                        segment.citation ? (
                                          <span
                                            key={`${idx}-${paragraphIndex}-${segmentIndex}`}
                                            className="rounded-[4px] bg-[#e7ebff] px-1 py-0.5 text-[11px] font-semibold text-primary"
                                          >
                                            {segment.text}
                                          </span>
                                        ) : (
                                          <React.Fragment
                                            key={`${idx}-${paragraphIndex}-${segmentIndex}`}
                                          >
                                            {segment.text}
                                          </React.Fragment>
                                        ),
                                    )}
                                  </span>
                                </button>
                              ) : (
                                <p
                                  key={`${idx}-${paragraphIndex}`}
                                  className="px-2 text-sm leading-relaxed text-foreground"
                                >
                                  {paragraph.text}
                                </p>
                              ),
                            )}
                          </div>
                          {msg.isStreaming && msg.content ? (
                            <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-primary align-[-2px]" />
                          ) : null}
                          {!msg.isStreaming && msg.translatedHindi ? (
                            <div className="mt-3 rounded-[10px] border border-[#d7def0] bg-[#f7faff] px-3 py-2.5">
                              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#2947b2]">
                                Hindi translation
                              </p>
                              <p className="text-sm leading-relaxed text-foreground">
                                {msg.translatedHindi}
                              </p>
                            </div>
                          ) : null}
                          {!msg.isStreaming && msg.nextActions && msg.nextActions.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {msg.nextActions.map((action) => (
                                <button
                                  key={action}
                                  type="button"
                                  onClick={() => void handleSearch(action)}
                                  className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:border-primary hover:bg-primary hover:text-white"
                                >
                                  {action}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {!msg.isStreaming && msg.citations && msg.citations.length > 0 ? (
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

                {isQuerying && !chatMessages.some((msg) => msg.isStreaming) ? (
                  <div className="flex justify-start">
                    <div className="rounded-[14px] border border-border bg-white px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <SiriRing animate={voiceState !== "idle"} />
                        <span className="text-xs font-medium text-muted">
                          {isVoiceProcessing
                            ? copy.voiceProcessing
                            : generatingResponseLabel(language)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div ref={chatEndRef} />
              </div>

              <div className="shrink-0 border-t border-border bg-[rgba(248,251,255,0.92)] p-3">
                <div className="flex gap-2 rounded-[14px] border border-border bg-white p-2">
                  <input
                    ref={followUpInputRef}
                    type="text"
                    placeholder={copy.followUpPlaceholder}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
                    className="flex-1 bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted"
                  />
                  <button
                    onClick={handleVoiceInput}
                    disabled={isQuerying && !isVoiceProcessing}
                    title={getVoiceHelperText()}
                    className={`inline-flex items-center justify-center rounded-[6px] border px-2 ${
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
                    size="sm"
                    onClick={() => void handleSearch()}
                    disabled={!searchQuery.trim() || isQuerying}
                  >
                    {copy.askButton}
                  </Button>
                </div>
              </div>
            </div>

            {showSourcePanel ? (
            <div className="tfl-panel flex min-h-0 flex-col overflow-hidden lg:w-[38%]">
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
                                      className="pointer-events-none absolute rounded-[10px] border-2 border-[#7c3aed] bg-[rgba(124,58,237,0.18)] shadow-[0_0_0_2px_rgba(124,58,237,0.14),0_8px_24px_rgba(124,58,237,0.18)]"
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

                      {!pageImageUrl || highlightBoxes.length === 0 ? (
                        <div className="rounded-[12px] border border-warning/30 bg-warning-light p-3">
                          <div className="mb-2 flex items-center gap-2">
                            <span className="rounded-[4px] bg-warning px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#3f3100]">
                              {copy.sourceProofLabel}
                            </span>
                            {activeCitation?.sectionTitle ? (
                              <span className="text-xs font-medium text-[#5b4700]">
                                {activeCitation.sectionTitle}
                              </span>
                            ) : null}
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#352e16]">
                            {proofTextSegments.map((segment, index) =>
                              segment.highlighted ? (
                                <mark
                                  key={`proof-${index}`}
                                  className="rounded-[3px] bg-[#ffeb70] px-0.5 text-[#2b2100]"
                                >
                                  {segment.text}
                                </mark>
                              ) : (
                                <React.Fragment key={`proof-${index}`}>
                                  {segment.text}
                                </React.Fragment>
                              ),
                            )}
                          </p>
                        </div>
                      ) : null}
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
            ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </OperatorLayout>
  );
}
