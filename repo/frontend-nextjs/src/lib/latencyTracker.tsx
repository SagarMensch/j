"use client";

import { useEffect, useState } from "react";

export type LatencySample = {
  label: string;
  startedAt: number;
  firstByteAt: number | null;
  firstAudioAt: number | null;
  firstChunkAt: number | null;
  completedAt: number | null;
  metadata?: Record<string, unknown>;
};

type LatencyEvent = {
  id: string;
  label: string;
  startedAt: number;
  firstByteAt: number | null;
  firstAudioAt: number | null;
  firstChunkAt: number | null;
  completedAt: number | null;
  metadata: Record<string, unknown>;
};

const MAX_EVENTS = 30;

class LatencyTrackerImpl {
  private events: LatencyEvent[] = [];
  private listeners = new Set<() => void>();
  private nextId = 0;

  start(label: string, metadata?: Record<string, unknown>): string {
    const id = `${label}-${Date.now()}-${this.nextId++}`;
    const event: LatencyEvent = {
      id,
      label,
      startedAt: performance.now(),
      firstByteAt: null,
      firstChunkAt: null,
      firstAudioAt: null,
      completedAt: null,
      metadata: metadata || {},
    };
    this.events.unshift(event);
    if (this.events.length > MAX_EVENTS) this.events.pop();
    this.notify();
    return id;
  }

  mark(id: string, kind: "firstByte" | "firstChunk" | "firstAudio" | "completed") {
    const ev = this.events.find((e) => e.id === id);
    if (!ev) return;
    if (kind === "firstByte") ev.firstByteAt = performance.now();
    if (kind === "firstChunk") ev.firstChunkAt = performance.now();
    if (kind === "firstAudio") ev.firstAudioAt = performance.now();
    if (kind === "completed") ev.completedAt = performance.now();
    this.notify();
  }

  complete(id: string) {
    this.mark(id, "completed");
  }

  getEvents(): readonly LatencyEvent[] {
    return this.events;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const l of this.listeners) l();
  }
}

export const latencyTracker = new LatencyTrackerImpl();

export function useLatencyTracker() {
  const [, setTick] = useState(0);
  useEffect(() => latencyTracker.subscribe(() => setTick((t) => t + 1)), []);
  return latencyTracker.getEvents();
}

function fmt(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function budgetColor(value: number | null, target: number, warn: number): string {
  if (value == null) return "#9ca3af";
  if (value <= target) return "#16a34a";
  if (value <= warn) return "#ffd329";
  return "#dc241f";
}

export function LatencyMonitorOverlay() {
  const events = useLatencyTracker();
  const [expanded, setExpanded] = useState(false);

  if (events.length === 0) return null;

  const latest = events[0];
  const ttft = latest.firstByteAt != null ? latest.firstByteAt - latest.startedAt : null;
  const ttfb =
    latest.firstChunkAt != null ? latest.firstChunkAt - latest.startedAt : null;
  const ttAudio =
    latest.firstAudioAt != null ? latest.firstAudioAt - latest.startedAt : null;
  const total = latest.completedAt != null ? latest.completedAt - latest.startedAt : null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 9999,
        fontFamily: "var(--font-figtree), monospace",
        fontSize: 10,
        background: "rgba(0,0,0,0.85)",
        color: "#fff",
        borderRadius: 8,
        padding: expanded ? 12 : "6px 10px",
        backdropFilter: "blur(8px)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        maxWidth: expanded ? 360 : 180,
        cursor: "pointer",
        userSelect: "none",
      }}
      onClick={() => setExpanded((e) => !e)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: expanded ? 8 : 0 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: "#16a34a",
            animation: "pulse 1.5s infinite",
          }}
        />
        <span style={{ fontWeight: 700, color: "#ffd329" }}>LATENCY</span>
        <span style={{ opacity: 0.7 }}>{latest.label}</span>
      </div>
      <div style={{ display: "flex", gap: 8, fontSize: 10 }}>
        <span style={{ color: budgetColor(ttft, 250, 500) }}>TTFT {fmt(ttft)}</span>
        <span style={{ color: budgetColor(ttfb, 400, 800) }}>TTFB {fmt(ttfb)}</span>
        <span style={{ color: budgetColor(ttAudio, 600, 1200) }}>TT-Audio {fmt(ttAudio)}</span>
        <span style={{ color: budgetColor(total, 2000, 5000) }}>Total {fmt(total)}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 8, borderTop: "1px solid #333", paddingTop: 8 }}>
          <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 4 }}>Recent events</div>
          {events.slice(0, 8).map((e) => {
            const eTotal = e.completedAt != null ? e.completedAt - e.startedAt : null;
            return (
              <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 9, lineHeight: 1.5 }}>
                <span style={{ opacity: 0.8, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.label}</span>
                <span style={{ color: budgetColor(eTotal, 2000, 5000) }}>{fmt(eTotal)}</span>
              </div>
            );
          })}
        </div>
      )}
      <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>
    </div>
  );
}
