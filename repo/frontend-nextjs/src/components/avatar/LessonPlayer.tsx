"use client";

import React, { useEffect, useRef, useState } from "react";

type Props = {
  audioUrl: string;
  script: string;
  onEnded?: () => void;
  onPlayStateChange?: (playing: boolean) => void;
  audioRef?: React.RefObject<HTMLAudioElement>;
};

export function LessonPlayer({ audioUrl, script, onEnded, onPlayStateChange, audioRef: externalRef }: Props) {
  const localRef = useRef<HTMLAudioElement | null>(null);
  const ref = (externalRef || localRef) as React.RefObject<HTMLAudioElement>;
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const onPlay = () => { setIsPlaying(true); onPlayStateChange?.(true); };
    const onPause = () => { setIsPlaying(false); onPlayStateChange?.(false); };
    const onTime = () => setProgress(a.currentTime);
    const onMeta = () => setDuration(a.duration || 0);
    const onEnd = () => { setIsPlaying(false); onPlayStateChange?.(false); onEnded?.(); };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnd);
    };
  }, [ref, onEnded, onPlayStateChange]);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }

  function seek(pct: number) {
    const a = ref.current;
    if (!a || !a.duration) return;
    a.currentTime = pct * a.duration;
  }

  const pct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div className="space-y-3">
      <audio ref={localRef} src={audioUrl} preload="auto" crossOrigin="anonymous" />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-[0_8px_20px_rgba(0,25,168,0.25)] transition-transform hover:scale-105"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div
            className="relative h-2 cursor-pointer overflow-hidden rounded-full bg-muted-light"
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const x = e.clientX - rect.left;
              seek(x / rect.width);
            }}
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-100" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] font-mono text-muted">
            <span>{formatTime(progress)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>

      <details className="rounded-[10px] border border-border bg-[#f8fbfa] px-3 py-2 text-xs text-muted">
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Script</summary>
        <p className="mt-2 leading-relaxed text-foreground">{script}</p>
      </details>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
