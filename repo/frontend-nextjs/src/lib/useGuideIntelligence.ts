"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "@/lib/api";
import { latencyTracker } from "@/lib/latencyTracker";

export type RiskInfo = {
  score: number;
  level: "low" | "moderate" | "elevated" | "high";
  factors: string[];
  phase?: string;
  computed_at?: string;
};

export type StepTiming = {
  step_index: number | null;
  expected_seconds: number;
  on_step_seconds: number;
  elapsed_total: number;
  delta_seconds: number;
  status: "on_track" | "slow" | "stalled" | "fast";
  help_hint?: string | null;
};

export type Personalization = {
  experience_level: "novice" | "standard" | "senior" | "expert";
  verbosity: "concise" | "normal" | "verbose";
  safety_conservatism: "relaxed" | "standard" | "strict";
  language?: string;
};

export type ProceduralMemoryItem = {
  run_id: string;
  equipment: string;
  task: string | null;
  status: string | null;
  total_steps: number | null;
  completed_at: string | null;
  notes: string | null;
};

export type GuideIntelligence = {
  risk: RiskInfo | null;
  stepTiming: StepTiming | null;
  personalization: Personalization | null;
  proceduralMemory: ProceduralMemoryItem[];
};

const DEFAULT_INTELLIGENCE: GuideIntelligence = {
  risk: null,
  stepTiming: null,
  personalization: null,
  proceduralMemory: [],
};

const STORAGE_KEY_OPERATOR_MODE = "jival:operator-mode";

export function useOperatorMode(): [Personalization["experience_level"], (level: Personalization["experience_level"]) => void] {
  const [mode, setMode] = useState<Personalization["experience_level"]>(() => {
    if (typeof window === "undefined") return "standard";
    const stored = window.localStorage.getItem(STORAGE_KEY_OPERATOR_MODE);
    if (stored === "novice" || stored === "standard" || stored === "senior" || stored === "expert") {
      return stored;
    }
    return "standard";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY_OPERATOR_MODE, mode);
  }, [mode]);

  return [mode, setMode];
}

export function riskColor(score: number): string {
  if (score < 0.25) return "#16a34a";
  if (score < 0.5) return "#ffd329";
  if (score < 0.75) return "#f97316";
  return "#dc241f";
}

export function riskLabel(level: RiskInfo["level"]): string {
  switch (level) {
    case "low":
      return "Safe";
    case "moderate":
      return "Watch";
    case "elevated":
      return "Caution";
    case "high":
      return "Critical";
  }
}

export function timingColor(status: StepTiming["status"]): string {
  switch (status) {
    case "on_track":
      return "#16a34a";
    case "slow":
      return "#ffd329";
    case "stalled":
      return "#dc241f";
    case "fast":
      return "#f97316";
  }
}

export type PreviewNextResponse = {
  next_step_index: number;
  preview_text: string;
  evidence_count: number;
  audio_base64: string;
  audio_mime_type: string;
  language: string;
  latency_ms: number;
};

export type VoiceCommandResponse = {
  intent: string;
  confidence: number;
  params: Record<string, any>;
  source: string;
};

export function useGuideIntelligence() {
  const [intelligence, setIntelligence] = useState<GuideIntelligence>(DEFAULT_INTELLIGENCE);
  const lastServerResponseRef = useRef<any>(null);

  const updateFromServerResponse = useCallback((response: any) => {
    if (!response) return;
    lastServerResponseRef.current = response;
    setIntelligence({
      risk: response.risk ?? null,
      stepTiming: response.step_timing ?? null,
      personalization: response.personalization ?? null,
      proceduralMemory: response.procedural_memory ?? [],
    });
  }, []);

  return {
    intelligence,
    updateFromServerResponse,
    lastServerResponse: lastServerResponseRef,
  };
}

export function useSpeculativeNextStep() {
  const [preview, setPreview] = useState<PreviewNextResponse | null>(null);
  const [isPrefetching, setIsPrefetching] = useState(false);
  const abortedRef = useRef(false);

  const prefetch = useCallback(
    async (userId: string, conversationId: string | null, query: string, language: string = "en") => {
      if (!userId) return;
      setIsPrefetching(true);
      abortedRef.current = false;
      const traceId = latencyTracker.start("preview-next", { hasConvo: Boolean(conversationId) });
      try {
        const res = await fetch(`${API_BASE_URL}/api/operation-guide/preview-next`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, conversation_id: conversationId, query, language }),
        });
        if (!res.ok) throw new Error(`preview-next failed: ${res.status}`);
        const data = (await res.json()) as PreviewNextResponse;
        latencyTracker.mark(traceId, "firstByte");
        if (data.audio_base64) {
          latencyTracker.mark(traceId, "firstAudio");
        }
        if (!abortedRef.current) {
          setPreview(data);
        }
        latencyTracker.complete(traceId);
      } catch (err) {
        if (!abortedRef.current) {
          console.error("Speculative next-step prefetch failed:", err);
        }
        latencyTracker.complete(traceId);
      } finally {
        setIsPrefetching(false);
      }
    },
    [],
  );

  const clear = useCallback(() => {
    abortedRef.current = true;
    setPreview(null);
  }, []);

  useEffect(() => {
    return () => {
      abortedRef.current = true;
    };
  }, []);

  return { preview, isPrefetching, prefetch, clear };
}

export function useUniversalVoiceCommand() {
  const parse = useCallback(async (text: string, userId: string, language: string = "en"): Promise<VoiceCommandResponse | null> => {
    if (!text.trim() || !userId) return null;
    try {
      const res = await fetch(`${API_BASE_URL}/api/operation-guide/voice-command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, text, language }),
      });
      if (!res.ok) return null;
      return (await res.json()) as VoiceCommandResponse;
    } catch (err) {
      console.error("Voice command parse failed:", err);
      return null;
    }
  }, []);

  return { parse };
}
