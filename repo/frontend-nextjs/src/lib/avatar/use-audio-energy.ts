"use client";

import { useEffect, useRef } from "react";

export function useAudioEnergy(
  audioRef: React.RefObject<HTMLAudioElement> | undefined | null,
  isPlaying?: boolean,
) {
  const energyRef = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);
  const attachedRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) return;
    if (attachedRef.current === audio) return;
    attachedRef.current = audio;
    try {
      const Ctor = (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      if (!Ctor) return;
      const ctx = ctxRef.current ?? new Ctor();
      ctxRef.current = ctx;
      const src = sourceRef.current ?? ctx.createMediaElementSource(audio);
      sourceRef.current = src;
      const analyser = analyserRef.current ?? ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      analyserRef.current = analyser;
      try {
        src.connect(analyser);
      } catch {
        return;
      }
      analyser.connect(ctx.destination);
      dataRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    } catch {
      attachedRef.current = null;
    }
    return () => {
      try {
        if (sourceRef.current && analyserRef.current) {
          try {
            sourceRef.current.disconnect(analyserRef.current);
          } catch {
            /* noop */
          }
        }
        if (analyserRef.current) analyserRef.current.disconnect();
      } catch {
        /* noop */
      }
      sourceRef.current = null;
      analyserRef.current = null;
      dataRef.current = null;
      attachedRef.current = null;
    };
  }, [audioRef]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const analyser = analyserRef.current;
      const data = dataRef.current;
      if (analyser && data) {
        analyser.getByteTimeDomainData(data as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const target = Math.min(1, rms * 3.2);
        const playing =
          isPlaying ?? (audioRef?.current ? !audioRef.current.paused : false);
        const final = playing ? target : target * 0.2;
        energyRef.current = energyRef.current + (final - energyRef.current) * 0.18;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [audioRef, isPlaying]);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (isPlaying && ctx.state === "suspended") {
      ctx.resume().catch(() => undefined);
    }
  }, [isPlaying]);

  return energyRef;
}
