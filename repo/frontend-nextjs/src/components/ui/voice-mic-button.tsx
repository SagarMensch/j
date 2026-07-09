"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  STTAssistantScope,
  STTLanguageHint,
  useSarvamStreamingSTT,
} from "@/lib/useSarvamStreamingSTT";

export type VoiceMicSubmitPayload = {
  text: string;
  normalizedText: string;
  language?: string;
};

type VoiceMicButtonProps = {
  scope: STTAssistantScope;
  language?: STTLanguageHint;
  onSubmit: (payload: VoiceMicSubmitPayload) => void | Promise<void>;
  onError?: (message: string) => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  variant?: "circle" | "pill";
  label?: string;
};

export function VoiceMicButton(props: VoiceMicButtonProps) {
  const {
    scope,
    language = "auto",
    onSubmit,
    onError,
    disabled,
    size = "md",
    className,
    variant = "circle",
    label = "Voice",
  } = props;

  const [submitting, setSubmitting] = useState(false);
  const lastSubmittedRef = useRef<string>("");

  const onSubmitRef = useRef(onSubmit);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
    onErrorRef.current = onError;
  }, [onSubmit, onError]);

  const stt = useSarvamStreamingSTT({
    scope,
    language,
    onPartial: () => undefined,
    onError: (msg) => onErrorRef.current?.(msg),
    onFinal: () => undefined,
  });

  const handlePress = useCallback(async () => {
    if (disabled || submitting) return;
    if (stt.state === "idle") {
      stt.reset();
      await stt.start();
      return;
    }
    if (stt.state === "listening" || stt.state === "connecting") {
      setSubmitting(true);
      try {
        const result = await stt.stop("user");
        const text = (result?.text || stt.finalText || stt.interim || "").trim();
        if (!text || lastSubmittedRef.current === text) {
          return;
        }
        lastSubmittedRef.current = text;
        await onSubmitRef.current({
          text,
          normalizedText: (result?.normalizedText || text).trim(),
          language: result?.language || stt.language || undefined,
        });
      } finally {
        setSubmitting(false);
      }
    }
  }, [disabled, onSubmitRef, stt, submitting]);

  if (variant === "pill") {
    const buttonLabel = stt.state === "listening" ? label : stt.state === "connecting" || stt.state === "stopping" ? label : label;
    return (
      <button
        type="button"
        onClick={handlePress}
        disabled={disabled || submitting}
        className={`inline-flex items-center gap-2 rounded-[10px] border px-3.5 py-2 text-xs font-semibold select-none transition-all ${
          stt.state === "listening"
            ? "border-[#10a37f] bg-[#10a37f] text-white shadow-sm"
            : stt.state === "connecting" || stt.state === "stopping"
              ? "border-[#10a37f]/40 bg-[#10a37f]/10 text-[#10a37f]"
              : "border-border bg-white text-muted hover:border-[#10a37f]/40 hover:text-[#10a37f]"
        } disabled:cursor-not-allowed disabled:opacity-50 ${className || ""}`}
      >
        {stt.state === "listening" ? (
          <span className="flex items-center gap-[2px]">
            <span className="h-3 w-[2.5px] animate-pulse rounded-full bg-white/70" style={{ animationDelay: "0ms" }} />
            <span className="h-4 w-[2.5px] animate-pulse rounded-full bg-white" style={{ animationDelay: "150ms" }} />
            <span className="h-2.5 w-[2.5px] animate-pulse rounded-full bg-white/70" style={{ animationDelay: "300ms" }} />
            <span className="h-3.5 w-[2.5px] animate-pulse rounded-full bg-white/80" style={{ animationDelay: "100ms" }} />
          </span>
        ) : (
          <MicIcon />
        )}
        <span>{buttonLabel}</span>
      </button>
    );
  }

  const sizeClass = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-10 w-10";
  const iconSize = size === "sm" ? 14 : size === "lg" ? 20 : 16;

  return (
    <div className={className}>
      <div className="relative inline-flex items-center justify-center">
        <button
          type="button"
          onClick={handlePress}
          disabled={disabled || submitting}
          aria-label={stt.state === "listening" ? "Stop recording" : "Start voice input"}
          className={`relative z-10 ${sizeClass} inline-flex items-center justify-center rounded-full border-2 transition-all select-none ${
            stt.state === "listening"
              ? "border-[#10a37f] bg-[#10a37f] text-white shadow-[0_0_12px_rgba(16,163,127,0.3)]"
              : stt.state === "connecting"
                ? "border-[#10a37f]/50 bg-white text-[#10a37f]"
                : stt.state === "stopping"
                  ? "border-[#10a37f]/30 bg-[#10a37f]/10 text-[#10a37f]"
                  : "border-border bg-white text-muted hover:border-[#10a37f]/40 hover:text-[#10a37f]"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {submitting || stt.state === "stopping" ? (
            <svg className={iconSize === 14 ? "h-3.5 w-3.5" : iconSize === 20 ? "h-5 w-5" : "h-4 w-4"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeDashoffset="10" className="animate-spin" />
            </svg>
          ) : (
            <MicIcon size={iconSize} />
          )}
        </button>
        {stt.state === "listening" ? (
          <span className="absolute inset-0 rounded-full animate-ping border-2 border-[#10a37f]/40" />
        ) : null}
        {stt.state === "listening" ? (
          <div className="absolute -bottom-4 flex items-center gap-[2.5px]">
            <span className="h-2 w-[3px] animate-pulse rounded-full bg-[#10a37f]/60" style={{ animationDelay: "0ms", animationDuration: "600ms" }} />
            <span className="h-3 w-[3px] animate-pulse rounded-full bg-[#10a37f]" style={{ animationDelay: "150ms", animationDuration: "500ms" }} />
            <span className="h-1.5 w-[3px] animate-pulse rounded-full bg-[#10a37f]/50" style={{ animationDelay: "300ms", animationDuration: "700ms" }} />
            <span className="h-2.5 w-[3px] animate-pulse rounded-full bg-[#10a37f]/70" style={{ animationDelay: "80ms", animationDuration: "450ms" }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MicIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="2" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5 10a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
