"use client";

import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

// Configure PDF.js worker from CDN to avoid Next.js worker complications
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface PdfViewerProps {
  pdfUrl: string;
  currentPage: number;
  /** Fallback image URL to show if PDF cannot be loaded */
  fallbackImageUrl?: string | null;
  /** Callback triggered if the PDF fails to load (e.g. 404 or invalid) */
  onLoadError?: () => void;
}

export function PdfViewer({ pdfUrl, currentPage, fallbackImageUrl, onLoadError }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale] = useState(1.5);
  const [pdfLoadFailed, setPdfLoadFailed] = useState(false);

  useEffect(() => {
    if (!pdfUrl) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;

    setLoading(true);
    setError(null);
    setPdfLoadFailed(false);
    setPdfDoc(null);

    const loadPdf = async () => {
      try {
        // Fetch manually to handle 404s and Content-Type cleanly without pdf.js throwing unhandled console errors
        const response = await fetch(pdfUrl);
        if (!cancelled && !response.ok) {
          throw new Error(`PDF fetch failed with status ${response.status}`);
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("pdf") && !contentType.includes("application/octet-stream") && !pdfUrl.endsWith(".pdf")) {
           throw new Error("URL did not return a valid PDF document");
        }

        const arrayBuffer = await response.arrayBuffer();
        if (cancelled) return;

        loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const doc = await loadingTask.promise;
        
        if (!cancelled) {
          setPdfDoc(doc);
          setPdfLoadFailed(false);
        }
      } catch (err) {
        if (!cancelled) {
          setPdfLoadFailed(true);
          const msg = err instanceof Error ? err.message : "PDF could not be loaded";
          setError(msg);
          if (onLoadError) {
            onLoadError();
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadPdf();

    return () => {
      cancelled = true;
      loadingTask?.destroy().catch(() => {});
    };
  }, [pdfUrl]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let renderTaskCancelled = false;

    const renderPage = async () => {
      try {
        const safePage = Math.min(Math.max(1, currentPage), pdfDoc.numPages);
        const page = await pdfDoc.getPage(safePage);
        if (renderTaskCancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext("2d");
        if (!context) return;

        const containerWidth = containerRef.current?.clientWidth ?? 800;
        const baseViewport = page.getViewport({ scale: 1 });
        const responsiveScale = Math.min(
          scale,
          containerWidth / baseViewport.width,
        );

        const viewport = page.getViewport({ scale: responsiveScale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: context,
          viewport,
        }).promise;
      } catch (err) {
        if (!renderTaskCancelled) {
          // silently ignore page render errors so it doesn't blow up the overlay
        }
      }
    };

    void renderPage();
    return () => {
      renderTaskCancelled = true;
    };
  }, [pdfDoc, currentPage, scale]);

  if (!pdfUrl) {
    if (fallbackImageUrl) {
      return (
        <div className="overflow-hidden rounded-[12px] border border-border bg-white">
          <img src={fallbackImageUrl} alt={`Page ${currentPage}`} className="block h-auto w-full" />
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        No PDF available
      </div>
    );
  }

  if (pdfLoadFailed) {
    if (fallbackImageUrl) {
      return (
        <div className="overflow-hidden rounded-[12px] border border-border bg-white">
          <img src={fallbackImageUrl} alt={`Page ${currentPage} (fallback)`} className="block h-auto w-full" />
        </div>
      );
    }
    // Return null to allow parent components to fallback to rendering text if neither PDF nor image is available
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
    <div ref={containerRef} className="overflow-auto bg-[#525659] p-2 flex flex-col items-center">
      <div className="shadow-md">
        <canvas ref={canvasRef} className="block bg-white" style={{ maxWidth: "100%", height: "auto" }} />
      </div>
    </div>
  );
}