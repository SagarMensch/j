"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postJsonSse } from "@/lib/api";
import { latencyTracker } from "@/lib/latencyTracker";

export type StreamingTTSState = "idle" | "loading" | "playing" | "error";

type AudioChunk = {
  audioBase64: string;
  url: string;
  isFinal: boolean;
};

export type StreamingTTSResult = {
  state: StreamingTTSState;
  play: (text: string, language?: string, speaker?: string) => Promise<void>;
  stop: () => void;
};

function base64ToBlob(audioBase64: string, mime: string = "audio/wav"): Blob {
  const binaryString = window.atob(audioBase64);
  const byteArray = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    byteArray[i] = binaryString.charCodeAt(i);
  }
  return new Blob([byteArray], { type: mime });
}

export function useStreamingTTS(): StreamingTTSResult {
  const [state, setState] = useState<StreamingTTSState>("idle");

  const queueRef = useRef<AudioChunk[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const abortedRef = useRef(false);
  const playingRef = useRef(false);

  const setStateRef = useRef(setState);
  setStateRef.current = setState;

  const drainQueue = useCallback(() => {
    if (abortedRef.current) return;
    if (playingRef.current) return;

    const next = queueRef.current.shift();
    if (!next) return;

    playingRef.current = true;
    const audio = new Audio(next.url);
    currentAudioRef.current = audio;

    audio.onended = () => {
      URL.revokeObjectURL(next.url);
      playingRef.current = false;
      currentAudioRef.current = null;

      if (next.isFinal && queueRef.current.length === 0) {
        setStateRef.current("idle");
        return;
      }
      drainQueue();
    };

    audio.onerror = () => {
      URL.revokeObjectURL(next.url);
      playingRef.current = false;
      currentAudioRef.current = null;
      console.error("TTS chunk playback error");
      if (next.isFinal && queueRef.current.length === 0) {
        setStateRef.current("idle");
      } else {
        drainQueue();
      }
    };

    audio.play().catch(() => {
      playingRef.current = false;
      if (next.isFinal) setStateRef.current("idle");
    });
  }, []);

  const play = useCallback(
    async (text: string, language: string = "en-IN", speaker: string = "suhani") => {
      if (!text.trim()) return;

      setStateRef.current("loading");
      abortedRef.current = false;
      queueRef.current = [];

      const traceId = latencyTracker.start("tts-stream", { textLen: text.length, language });

      try {
        await postJsonSse(
          "/api/tts/stream",
          { text, language, speaker },
          {
            onEvent(event, payload) {
              if (abortedRef.current) return;
              const data = payload as Record<string, unknown>;

              if (event === "chunk" && data.audio_base64) {
                const audioBase64 = data.audio_base64 as string;
                const isFinal = Boolean(data.is_final);
                const blob = base64ToBlob(audioBase64);
                const url = URL.createObjectURL(blob);

                queueRef.current.push({ audioBase64, url, isFinal });

                if (queueRef.current.length === 1) {
                  latencyTracker.mark(traceId, "firstChunk");
                }
                if (!playingRef.current) {
                  latencyTracker.mark(traceId, "firstAudio");
                  drainQueue();
                }

                setStateRef.current("playing");
              }

              if (event === "done") {
                if (queueRef.current.length === 0 && !playingRef.current) {
                  latencyTracker.complete(traceId);
                  setStateRef.current("idle");
                }
              }

              if (event === "error") {
                console.error("TTS stream error:", data.message);
              }
            },
          },
        );
        latencyTracker.complete(traceId);
      } catch (err) {
        if (!abortedRef.current) {
          console.error("Streaming TTS fetch failed:", err);
          latencyTracker.complete(traceId);
          setStateRef.current("error");
        }
      }
    },
    [drainQueue],
  );

  const stop = useCallback(() => {
    abortedRef.current = true;

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.onended = null;
      currentAudioRef.current.onerror = null;
      currentAudioRef.current = null;
    }
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current);
      currentUrlRef.current = null;
    }

    for (const chunk of queueRef.current) {
      URL.revokeObjectURL(chunk.url);
    }
    queueRef.current = [];
    playingRef.current = false;

    setStateRef.current("idle");
  }, []);

  useEffect(() => {
    return () => {
      abortedRef.current = true;
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
      }
      for (const chunk of queueRef.current) {
        URL.revokeObjectURL(chunk.url);
      }
    };
  }, []);

  return { state, play, stop };
}
