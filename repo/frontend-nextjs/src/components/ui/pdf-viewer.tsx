"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

interface PdfViewerProps {
  pdfUrl: string;
  currentPage: number;
  fallbackImageUrl?: string | null;
  onLoadError?: () => void;
}

export const PdfViewer = React.memo(function PdfViewer({ pdfUrl, currentPage, fallbackImageUrl, onLoadError }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.5);
  const [rotation, setRotation] = useState(0);
  const [fitMode, setFitMode] = useState<"width" | "page" | "none">("width");
  const [numPages, setNumPages] = useState(0);
  const [showPencil, setShowPencil] = useState(false);
  const [pencilColor, setPencilColor] = useState("#0019a8");
  const [pencilSize, setPencilSize] = useState(2);
  const [isDrawing, setIsDrawing] = useState(false);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  const PENCIL_COLORS = [
    { name: "Blue", value: "#0019a8" },
    { name: "Red", value: "#dc241f" },
    { name: "Black", value: "#000000" },
    { name: "Green", value: "#16a34a" },
    { name: "Orange", value: "#ea580c" },
    { name: "Purple", value: "#7c3aed" },
  ];

  useEffect(() => {
    if (!pdfUrl) { setLoading(false); return; }
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    setLoading(true);
    setError(null);
    setPdfDoc(null);

    const loadPdf = async () => {
      try {
        const response = await fetch(pdfUrl);
        if (!cancelled && !response.ok) throw new Error(`PDF fetch failed: ${response.status}`);
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("pdf") && !contentType.includes("application/octet-stream") && !pdfUrl.endsWith(".pdf")) {
          throw new Error("Not a valid PDF");
        }
        const arrayBuffer = await response.arrayBuffer();
        if (cancelled) return;
        loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const doc = await loadingTask.promise;
        if (!cancelled) { setPdfDoc(doc); setNumPages(doc.numPages); }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "PDF could not be loaded";
          setError(msg);
          if (onLoadError) onLoadError();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadPdf();
    return () => { cancelled = true; loadingTask?.destroy().catch(() => {}); };
  }, [pdfUrl, onLoadError]);

  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return;
    let renderCancelled = false;
    try {
      const safePage = Math.min(Math.max(1, currentPage), pdfDoc.numPages);
      const page = await pdfDoc.getPage(safePage);
      if (renderCancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const containerWidth = containerRef.current?.clientWidth ?? 800;
      const baseViewport = page.getViewport({ scale: 1, rotation: rotation });
      let effectiveScale = scale;
      if (fitMode === "width") {
        effectiveScale = containerWidth / baseViewport.width;
      } else if (fitMode === "page") {
        const containerHeight = (containerRef.current?.clientHeight ?? 600) - 8;
        effectiveScale = Math.min(containerWidth / baseViewport.width, containerHeight / baseViewport.height);
      } else {
        effectiveScale = Math.min(scale, containerWidth / baseViewport.width);
      }

      const viewport = page.getViewport({ scale: effectiveScale, rotation });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch {
      // silent
    }
    return () => { renderCancelled = true; };
  }, [pdfDoc, currentPage, scale, rotation, fitMode]);

  useEffect(() => {
    const cleanup = renderPage();
    return () => { cleanup?.then?.(fn => fn?.()); };
  }, [renderPage]);

  useEffect(() => {
    if (!showPencil || !canvasRef.current || !drawCanvasRef.current) return;
    const canvas = canvasRef.current;
    const drawCanvas = drawCanvasRef.current;
    drawCanvas.width = canvas.width;
    drawCanvas.height = canvas.height;
    drawCanvas.style.width = canvas.offsetWidth + "px";
    drawCanvas.style.height = canvas.offsetHeight + "px";
  }, [showPencil, scale, rotation, fitMode, currentPage]);

  const getDrawPos = (e: React.MouseEvent | React.TouchEvent) => {
    const drawCanvas = drawCanvasRef.current;
    if (!drawCanvas) return { x: 0, y: 0 };
    const rect = drawCanvas.getBoundingClientRect();
    const scaleX = drawCanvas.width / rect.width;
    const scaleY = drawCanvas.height / rect.height;
    if ("touches" in e) {
      const touch = e.touches[0] || e.changedTouches[0];
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!showPencil) return;
    e.preventDefault();
    setIsDrawing(true);
    lastPosRef.current = getDrawPos(e);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !showPencil || !drawCanvasRef.current) return;
    e.preventDefault();
    const ctx = drawCanvasRef.current.getContext("2d");
    if (!ctx) return;
    const pos = getDrawPos(e);
    const last = lastPosRef.current;
    if (last) {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = pencilColor;
      ctx.lineWidth = pencilSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    lastPosRef.current = pos;
  };

  const endDraw = () => {
    setIsDrawing(false);
    lastPosRef.current = null;
  };

  const clearDraw = () => {
    const drawCanvas = drawCanvasRef.current;
    if (!drawCanvas) return;
    const ctx = drawCanvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  };

  const zoomIn = () => setScale(prev => Math.min(prev + 0.25, ZOOM_MAX));
  const zoomOut = () => setScale(prev => Math.max(prev - 0.25, ZOOM_MIN));
  const zoomReset = () => { setScale(1.5); setFitMode("none"); };
  const rotateLeft = () => setRotation(prev => (prev - 90 + 360) % 360);
  const rotateRight = () => setRotation(prev => (prev + 90) % 360);

  const zoomPercent = Math.round((fitMode !== "none" ? scale : scale) * 100);

  if (!pdfUrl) {
    if (fallbackImageUrl) {
      return (
        <div className="overflow-hidden rounded-[12px] border border-border bg-white">
    {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={fallbackImageUrl} alt={`Page ${currentPage}`} className="block h-auto w-full" />
        </div>
      );
    }
    return <div className="flex h-full items-center justify-center text-sm text-muted">No PDF available</div>;
  }

  if (error && !fallbackImageUrl) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted">
        <div className="inline-flex items-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading PDF…
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <div className="pdf-tb-group">
          <button onClick={zoomOut} className="pdf-tb-btn" title="Zoom Out">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 12H19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
          </button>
          <span className="pdf-tb-zoom">{zoomPercent}%</span>
          <button onClick={zoomIn} className="pdf-tb-btn" title="Zoom In">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="pdf-tb-sep" />

        <div className="pdf-tb-group">
          <button onClick={() => setFitMode(fitMode === "width" ? "none" : "width")} className={`pdf-tb-btn ${fitMode === "width" ? "pdf-tb-active" : ""}`} title="Fit to Width">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 6H21M3 18H21M8 6V4M16 6V4M8 18V20M16 18V20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
          <button onClick={() => setFitMode(fitMode === "page" ? "none" : "page")} className={`pdf-tb-btn ${fitMode === "page" ? "pdf-tb-active" : ""}`} title="Fit to Page">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M8 8H16M8 12H16M8 16H12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
          <button onClick={zoomReset} className="pdf-tb-btn" title="Reset Zoom">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 4V8H8M20 20V16H16M20.49 9A9 9 0 0 0 5.64 5.64L4 8M20 16L18.36 18.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        <div className="pdf-tb-sep" />

        <div className="pdf-tb-group">
          <button onClick={rotateLeft} className="pdf-tb-btn" title="Rotate Left">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M2.5 2V8H8.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 13A9 9 0 1 0 6 6L2.5 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button onClick={rotateRight} className="pdf-tb-btn" title="Rotate Right">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M21.5 2V8H15.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M21 13A9 9 0 1 1 18 6L21.5 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        <div className="pdf-tb-sep" />

        <div className="pdf-tb-group">
          <button onClick={() => { setShowPencil(!showPencil); if (showPencil) clearDraw(); }} className={`pdf-tb-btn ${showPencil ? "pdf-tb-active" : ""}`} title="Annotate">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M17 3L21 7L7.5 20.5L3 21L3.5 16.5L17 3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 6L18 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>

        {showPencil && (
          <>
            <div className="pdf-tb-sep" />
            <div className="pdf-tb-group pdf-tb-colors">
              {PENCIL_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setPencilColor(c.value)}
                  className={`pdf-color-dot ${pencilColor === c.value ? "pdf-color-active" : ""}`}
                  style={{ background: c.value }}
                  title={c.name}
                />
              ))}
            </div>
            <div className="pdf-tb-sep" />
            <div className="pdf-tb-group">
              {[1, 2, 4].map((s) => (
                <button
                  key={s}
                  onClick={() => setPencilSize(s)}
                  className={`pdf-tb-btn pdf-size-btn ${pencilSize === s ? "pdf-tb-active" : ""}`}
                  title={`Size ${s}`}
                >
                  <span className="pdf-size-dot" style={{ width: s * 2 + 2, height: s * 2 + 2, background: pencilColor }} />
                </button>
              ))}
              <button onClick={clearDraw} className="pdf-tb-btn" title="Clear Annotations">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 6H21M8 6V4H16V6M19 6V20C19 21.1 18.1 22 17 22H7C5.9 22 5 21.1 5 20V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              </button>
            </div>
          </>
        )}

        <div className="pdf-tb-spacer" />

        <div className="pdf-tb-group">
          <span className="pdf-tb-info">p. {currentPage}{numPages > 0 ? ` / ${numPages}` : ""}</span>
        </div>
      </div>

      <div ref={containerRef} className="pdf-canvas-wrap">
        <div className="pdf-canvas-inner">
          <canvas ref={canvasRef} className="pdf-canvas" />
          {showPencil && (
            <canvas
              ref={drawCanvasRef}
              className="pdf-draw-canvas"
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />
          )}
        </div>
      </div>

      <style jsx>{`
        .pdf-viewer {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #3b3f44;
          border-radius: 12px;
          overflow: hidden;
        }
        .pdf-toolbar {
          display: flex;
          align-items: center;
          gap: 4px;
          height: 40px;
          padding: 0 10px;
          background: #2d3136;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          flex-shrink: 0;
        }
        .pdf-tb-group {
          display: flex;
          align-items: center;
          gap: 2px;
        }
        .pdf-tb-colors {
          gap: 4px;
          padding: 0 4px;
        }
        .pdf-tb-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 6px;
          border: none;
          background: transparent;
          color: #d1d5db;
          cursor: pointer;
          transition: all 0.12s;
        }
        .pdf-tb-btn:hover {
          background: rgba(255,255,255,0.1);
          color: #fff;
        }
        .pdf-tb-active {
          background: rgba(0,25,168,0.4) !important;
          color: #fff !important;
        }
        .pdf-tb-zoom {
          font-family: 'Figtree', sans-serif;
          font-size: 11px;
          font-weight: 600;
          color: #d1d5db;
          min-width: 38px;
          text-align: center;
          letter-spacing: -0.01em;
          user-select: none;
        }
        .pdf-tb-sep {
          width: 1px;
          height: 20px;
          background: rgba(255,255,255,0.1);
          margin: 0 4px;
          flex-shrink: 0;
        }
        .pdf-tb-spacer {
          flex: 1;
        }
        .pdf-tb-info {
          font-family: 'Figtree', sans-serif;
          font-size: 11px;
          font-weight: 500;
          color: #9ca3af;
          letter-spacing: -0.005em;
        }
        .pdf-color-dot {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: 2px solid transparent;
          cursor: pointer;
          transition: all 0.12s;
          padding: 0;
        }
        .pdf-color-dot:hover {
          transform: scale(1.2);
        }
        .pdf-color-active {
          border-color: #fff;
          box-shadow: 0 0 0 2px rgba(255,255,255,0.3);
        }
        .pdf-size-btn {
          width: 28px !important;
        }
        .pdf-size-dot {
          display: block;
          border-radius: 50%;
        }
        .pdf-canvas-wrap {
          flex: 1;
          overflow: auto;
          display: flex;
          justify-content: center;
          padding: 16px;
        }
        .pdf-canvas-inner {
          position: relative;
          display: inline-block;
          box-shadow: 0 2px 12px rgba(0,0,0,0.3);
        }
        .pdf-canvas {
          display: block;
          background: #fff;
        }
        .pdf-draw-canvas {
          position: absolute;
          top: 0;
          left: 0;
          cursor: crosshair;
          touch-action: none;
        }
      `}</style>
    </div>
  );
});
