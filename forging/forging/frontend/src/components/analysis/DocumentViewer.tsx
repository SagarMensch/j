"use client";

import { useMemo, useRef, useState } from "react";
import { TamperedRegion } from "@/lib/api-types";

type DocumentViewerProps = {
  imageUrl: string;
  alt: string;
  pageWidth: number;
  pageHeight: number;
  topRegion?: TamperedRegion | null;
  maxHeightClassName?: string;
};

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.2;

export function DocumentViewer({
  imageUrl,
  alt,
  pageWidth,
  pageHeight,
  topRegion,
  maxHeightClassName = "max-h-[819px]",
}: DocumentViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [panEnabled, setPanEnabled] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const zoomLabel = `${Math.round(zoom * 100)}%`;
  const canPan = panEnabled || zoom > 1;
  const viewerCursor = canPan ? "grab" : "default";
  const viewerActiveCursor =
    dragStartRef.current && canPan ? "grabbing" : viewerCursor;

  const regionStyle = useMemo(() => {
    if (!topRegion) {
      return null;
    }
    return {
      left: `${(topRegion.x / pageWidth) * 100}%`,
      top: `${(topRegion.y / pageHeight) * 100}%`,
      width: `${(topRegion.width / pageWidth) * 100}%`,
      height: `${(topRegion.height / pageHeight) * 100}%`,
    };
  }, [pageHeight, pageWidth, topRegion]);

  function adjustZoom(delta: number) {
    setZoom((current) => {
      const next = clamp(current + delta, MIN_ZOOM, MAX_ZOOM);
      if (next === 1) {
        setOffset({ x: 0, y: 0 });
      }
      return next;
    });
  }

  function resetView() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setPanEnabled(false);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!canPan) {
      return;
    }
    dragStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) {
      return;
    }
    const nextX = dragStartRef.current.originX + event.clientX - dragStartRef.current.startX;
    const nextY = dragStartRef.current.originY + event.clientY - dragStartRef.current.startY;
    setOffset({ x: nextX, y: nextY });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) {
      return;
    }
    dragStartRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <>
      <div className="w-full h-full p-8 flex items-center justify-center">
        <div
          className="relative flex max-h-full max-w-full items-center justify-center overflow-hidden"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ cursor: viewerActiveCursor, touchAction: "none" }}
        >
          <div
            className="relative overflow-hidden rounded-lg border border-border-color bg-white shadow-lg"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: dragStartRef.current ? "none" : "transform 160ms ease-out",
            }}
          >
            <img
              alt={alt}
              className={`w-auto max-w-full object-contain select-none ${maxHeightClassName}`}
              draggable={false}
              src={imageUrl}
            />
            {regionStyle ? (
              <div
                className="absolute rounded border-2 border-accent-red bg-accent-red/10 pointer-events-none"
                style={regionStyle}
              ></div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-surface p-2 rounded-full shadow-subtle border border-border-color">
        <button
          className="p-2 rounded-full hover:bg-white text-text-main transition-colors flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => adjustZoom(-ZOOM_STEP)}
          title="Zoom Out"
          type="button"
        >
          <span className="material-symbols-outlined text-xl">remove</span>
        </button>
        <span className="text-sm font-bold w-12 text-center select-none">
          {zoomLabel}
        </span>
        <button
          className="p-2 rounded-full hover:bg-white text-text-main transition-colors flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => adjustZoom(ZOOM_STEP)}
          title="Zoom In"
          type="button"
        >
          <span className="material-symbols-outlined text-xl">add</span>
        </button>
        <div className="w-px h-6 bg-border-color mx-1"></div>
        <button
          className={`p-2 rounded-full transition-colors flex items-center justify-center ${
            panEnabled ? "bg-primary text-white" : "hover:bg-white text-text-main"
          }`}
          onClick={() => setPanEnabled((current) => !current)}
          title="Pan Tool"
          type="button"
        >
          <span className="material-symbols-outlined text-xl">pan_tool</span>
        </button>
        <button
          className="p-2 rounded-full hover:bg-white text-text-main transition-colors flex items-center justify-center"
          onClick={resetView}
          title="Reset View"
          type="button"
        >
          <span className="material-symbols-outlined text-xl">fit_screen</span>
        </button>
      </div>
    </>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
