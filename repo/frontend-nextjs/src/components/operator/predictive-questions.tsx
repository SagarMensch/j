"use client";

import React, { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type PredictResponse = {
  questions: string[];
  source: "llm" | "template_fallback" | "empty";
};

type Copy = {
  title: string;
  loading: string;
  empty: string;
  fallback: string;
  ask: string;
};

const COPY: Record<string, Copy> = {
  ENG: { title: "You might also ask", loading: "Predicting...", empty: "No follow-ups yet.", fallback: "Suggested", ask: "Ask" },
  HIN: { title: "आप यह भी पूछ सकते हैं", loading: "सुझाव लोड हो रहे हैं...", empty: "कोई फॉलो-अप नहीं।", fallback: "सुझाव", ask: "पूछें" },
  HING: { title: "Tu yeh bhi pooch sakta hai", loading: "Predicting...", empty: "Koi follow-up nahi.", fallback: "Suggested", ask: "Pooch" },
};

type Props = {
  context: string;
  language: "ENG" | "HIN" | "HING";
  onAsk?: (question: string) => void;
};

export function PredictiveQuestions({ context, language, onAsk }: Props) {
  const { user } = useAuth();
  const copy = COPY[language] || COPY.ENG;
  const [questions, setQuestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [source, setSource] = useState<PredictResponse["source"] | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const cacheRef = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    const key = context.trim().toLowerCase();
    if (!user?.id || !key) {
      setQuestions([]);
      setHasFetched(false);
      return;
    }

    const cached = cacheRef.current.get(key);
    if (cached) {
      setQuestions(cached);
      setSource("llm");
      setHasFetched(true);
      return;
    }

    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        setIsLoading(true);
        setHasFetched(false);
        try {
          const payload = (await apiClient.post("/api/assistant/predict-questions", {
            user_id: user.id,
            query: context,
            language: language === "ENG" ? "en" : language === "HIN" ? "hi" : "hing",
            conversation_id: null,
          })) as PredictResponse;
          if (cancelled) return;
          setQuestions(payload.questions || []);
          setSource(payload.source || null);
          cacheRef.current.set(key, payload.questions || []);
        } catch {
          if (!cancelled) setQuestions([]);
        } finally {
          if (!cancelled) {
            setIsLoading(false);
            setHasFetched(true);
          }
        }
      })();
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [context, user?.id, language]);

  if (!context.trim() || (!isLoading && questions.length === 0 && hasFetched)) {
    return null;
  }

  return (
    <div className="rounded-[12px] border border-border bg-[#f8fbfa] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{copy.title}</p>
        {source === "template_fallback" ? (
          <span className="rounded-full border border-[#ffd329]/40 bg-[#fff8e8] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#7a4f00]">
            {copy.fallback}
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          {copy.loading}
        </div>
      ) : questions.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted">{copy.empty}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {questions.map((q, i) => (
            <button
              key={`${q}-${i}`}
              onClick={() => onAsk?.(q)}
              className="rounded-full border border-border bg-white px-3 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
