"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "./api";

export type STTAssistantScope = "general" | "reader" | "guided";

export type STTLanguageHint = "auto" | "en-IN" | "hi-IN";

export type StreamingSTTState = "idle" | "connecting" | "listening" | "stopping";

type ServerEvent =
  | { type: "ready"; sample_rate?: number; flush_interval_ms?: number; language?: string; assistant?: string }
  | { type: "partial"; text: string; language?: string; flush_id?: number }
  | { type: "final"; text: string; language?: string; normalized_text?: string; flush_id?: number }
  | { type: "stopped"; text: string; normalized_text?: string; language?: string; flush_id?: number }
  | { type: "language"; language: string }
  | { type: "error"; message: string }
  | { type: "pong" };

export type STTFinalPayload = {
  text: string;
  normalizedText: string;
  language?: string;
};

type UseSarvamStreamingSTTOptions = {
  scope: STTAssistantScope;
  language?: STTLanguageHint;
  sampleRate?: number;
  onFinal?: (payload: STTFinalPayload) => void;
  onPartial?: (text: string, language?: string) => void;
  onError?: (message: string) => void;
};

const PCM_WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = (options && options.processorOptions && options.processorOptions.targetSampleRate) || 16000;
    this.sourceSampleRate = sampleRate;
    this._resampleRatio = this.sourceSampleRate / this.targetSampleRate;
    this._buffer = [];
    this._bufferedSamples = 0;
    this._targetChunkSamples = Math.max(96, Math.floor(this.targetSampleRate * 0.06));
    this._lastFlushFrame = currentFrame;
  }

  _resample(input) {
    if (this.sourceSampleRate === this.targetSampleRate) return input;
    const outLength = Math.max(1, Math.floor(input.length / this._resampleRatio));
    const output = new Float32Array(outLength);
    for (let i = 0; i < outLength; i += 1) {
      const sourceIndex = i * this._resampleRatio;
      const lower = Math.floor(sourceIndex);
      const upper = Math.min(input.length - 1, lower + 1);
      const t = sourceIndex - lower;
      output[i] = input[lower] * (1 - t) + input[upper] * t;
    }
    return output;
  }

  _flush() {
    if (this._bufferedSamples === 0) return;
    const out = new Int16Array(this._bufferedSamples);
    for (let i = 0; i < this._bufferedSamples; i += 1) {
      const s = Math.max(-1, Math.min(1, this._buffer[i]));
      out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    }
    this.port.postMessage(out.buffer, [out.buffer]);
    this._buffer = [];
    this._bufferedSamples = 0;
    this._lastFlushFrame = currentFrame;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;
    const resampled = this._resample(channel);
    for (let i = 0; i < resampled.length; i += 1) {
      this._buffer.push(resampled[i]);
    }
    this._bufferedSamples += resampled.length;
    const frameElapsed = currentFrame - this._lastFlushFrame;
    if (this._bufferedSamples >= this._targetChunkSamples || frameElapsed >= this.targetSampleRate * 0.06) {
      this._flush();
    }
    return true;
  }
}
registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
`;

function closeWebSocket(ws: WebSocket | null) {
  if (!ws) return;
  try {
    ws.close(1000, "teardown");
  } catch {
    /* noop */
  }
}

export function useSarvamStreamingSTT(options: UseSarvamStreamingSTTOptions) {
  const { scope, language = "auto", sampleRate = 16000 } = options;
  const onFinalRef = useRef(options.onFinal);
  const onPartialRef = useRef(options.onPartial);
  const onErrorRef = useRef(options.onError);

  const [state, setState] = useState<StreamingSTTState>("idle");
  const [interim, setInterim] = useState("");
  const [finalText, setFinalText] = useState("");
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    onFinalRef.current = options.onFinal;
    onPartialRef.current = options.onPartial;
    onErrorRef.current = options.onError;
  }, [options.onFinal, options.onPartial, options.onError]);

  const teardownAudio = useCallback(() => {
    try {
      if (workletNodeRef.current) {
        workletNodeRef.current.port.onmessage = null;
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
      }
    } catch {
      /* noop */
    }
    try {
      sourceNodeRef.current?.disconnect();
      sourceNodeRef.current = null;
    } catch {
      /* noop */
    }
    try {
      void audioContextRef.current?.close();
    } catch {
      /* noop */
    }
    audioContextRef.current = null;
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    } catch {
      /* noop */
    }
    streamRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      const ws = wsRef.current;
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "stop" }));
          }
        } catch {
          /* noop */
        }
        closeWebSocket(ws);
      }
      teardownAudio();
    };
  }, [teardownAudio]);

  const reset = useCallback(() => {
    setInterim("");
    setFinalText("");
    setDetectedLanguage(null);
    setError(null);
  }, []);

  const stop = useCallback(
    async (reason: "user" | "auto" = "user"): Promise<STTFinalPayload | null> => {
      const ws = wsRef.current;
      if (!ws) {
        setState("idle");
        return null;
      }
      setState("stopping");
      return new Promise<STTFinalPayload | null>((resolve) => {
        let settled = false;
        let safetyTimer: number | null = null;
        const handler = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data) as ServerEvent;
            if (data.type === "stopped") {
              const payload: STTFinalPayload = {
                text: (data.text || "").trim(),
                normalizedText: (data.normalized_text || data.text || "").trim(),
                language: data.language,
              };
              if (payload.text) {
                setFinalText(payload.text);
                if (data.language) setDetectedLanguage(data.language);
              }
              finish(payload);
            } else if (data.type === "error") {
              setError(data.message || "stream error");
              onErrorRef.current?.(data.message || "stream error");
              finish(null);
            }
          } catch {
            /* noop */
          }
        };

        const finish = (payload: STTFinalPayload | null) => {
          if (settled) return;
          settled = true;
          if (safetyTimer !== null) window.clearTimeout(safetyTimer);
          ws.removeEventListener("message", handler);
          try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "stop" }));
            }
          } catch {
            /* noop */
          }
          closeWebSocket(ws);
          if (wsRef.current === ws) wsRef.current = null;
          teardownAudio();
          setState("idle");
          resolve(payload);
        };

        ws.addEventListener("message", handler);
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "stop" }));
          }
        } catch {
          /* noop */
        }
        safetyTimer = window.setTimeout(() => finish(null), 800);
        void reason; // currently unused; kept for future telemetry
      });
    },
    [teardownAudio],
  );

  const start = useCallback(async () => {
    if (state === "listening" || state === "connecting") {
      return;
    }
    setError(null);
    setInterim("");
    setFinalText("");

    if (
      typeof window === "undefined" ||
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof WebSocket === "undefined" ||
      typeof AudioContext === "undefined"
    ) {
      const message = "Voice streaming is not supported in this browser.";
      setError(message);
      onErrorRef.current?.(message);
      return;
    }

    setState("connecting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone permission denied."
          : "Could not access microphone.";
      setError(message);
      onErrorRef.current?.(message);
      setState("idle");
      return;
    }
    streamRef.current = stream;

    const wsBase = API_BASE_URL.replace(/^http/i, "ws");
    const url = `${wsBase}/api/stt/stream?scope=${encodeURIComponent(scope)}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      try {
        ws.send(
          JSON.stringify({
            type: "start",
            language,
            sample_rate: sampleRate,
            assistant: scope,
          }),
        );
      } catch {
        /* noop */
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ServerEvent;
        if (data.type === "ready") {
          setState("listening");
        } else if (data.type === "partial") {
          const text = (data.text || "").trim();
          setInterim(text);
          if (data.language) setDetectedLanguage(data.language);
          onPartialRef.current?.(text, data.language);
        } else if (data.type === "final") {
          const payload: STTFinalPayload = {
            text: (data.text || "").trim(),
            normalizedText: (data.normalized_text || data.text || "").trim(),
            language: data.language,
          };
          setFinalText(payload.text);
          if (data.language) setDetectedLanguage(data.language);
          onFinalRef.current?.(payload);
        } else if (data.type === "stopped") {
          const text = (data.text || "").trim();
          if (text) {
            setFinalText(text);
            if (data.language) setDetectedLanguage(data.language);
            onFinalRef.current?.({
              text,
              normalizedText: (data.normalized_text || text).trim(),
              language: data.language,
            });
          }
        } else if (data.type === "language") {
          setDetectedLanguage(data.language);
        } else if (data.type === "error") {
          setError(data.message || "stream error");
          onErrorRef.current?.(data.message || "stream error");
        }
      } catch {
        /* noop */
      }
    };

    ws.onerror = () => {
      const message = "Could not open streaming STT socket.";
      setError(message);
      onErrorRef.current?.(message);
    };

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      setState((current) => (current === "stopping" ? current : "idle"));
      teardownAudio();
    };

    try {
      const AudioContextCtor: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioContext = new AudioContextCtor({ sampleRate, latencyHint: "interactive" });
      audioContextRef.current = audioContext;
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      const blob = new Blob([PCM_WORKLET_SOURCE], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);
      try {
        await audioContext.audioWorklet.addModule(workletUrl);
      } finally {
        URL.revokeObjectURL(workletUrl);
      }
      const source = audioContext.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioContext, "pcm-capture-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: "explicit",
        processorOptions: { targetSampleRate: sampleRate },
      });
      workletNodeRef.current = worklet;
      sourceNodeRef.current = source;
      worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const wsNow = wsRef.current;
        if (!wsNow || wsNow.readyState !== WebSocket.OPEN) return;
        try {
          wsNow.send(event.data);
        } catch {
          /* noop */
        }
      };
      source.connect(worklet);
    } catch (err) {
      const message =
        err instanceof Error
          ? `Audio capture failed: ${err.message}`
          : "Audio capture failed.";
      setError(message);
      onErrorRef.current?.(message);
      try {
        ws.close();
      } catch {
        /* noop */
      }
      teardownAudio();
      setState("idle");
    }
  }, [language, sampleRate, scope, state, teardownAudio]);

  return {
    state,
    interim,
    finalText,
    language: detectedLanguage,
    error,
    start,
    stop,
    reset,
    isListening: state === "listening",
    isConnecting: state === "connecting",
  };
}
