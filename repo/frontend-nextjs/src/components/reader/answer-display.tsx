"use client";

import React, { useState } from "react";
import { SpeakerWaveIcon, StopSquareIcon, ChevronDownIcon, ChevronUpIcon } from "@/components/ui/icons";

type CitationType = {
  chunkId: string;
  documentCode: string;
  documentTitle: string;
  revisionId: string;
  revisionLabel?: string;
  pageStart: number;
  pageEnd: number;
  sectionTitle?: string;
  lineStart?: number | null;
  lineEnd?: number | null;
};

function cleanAnswerText(text: string): string {
  if (!text) return "";
  let cleaned = text;

  // Strip internal reasoning/thinking text
  const reasoningPatterns = [
    /^The operator is asking.*?(?=\n\n|\n(?=[0-9]))/s,
    /^To provide a (?:thorough|complete|detailed) summary.*?(?=\n\n|\n(?=[0-9]))/s,
    /^I will (?:break down|provide|analyze|explain).*?(?=\n\n|\n(?=[0-9]))/s,
    /^Let me (?:think|analyze|break down).*?(?=\n\n|\n(?=[0-9]))/s,
    /^Based on (?:the|my) (?:evidence|analysis|review).*?(?=\n\n|\n(?=[0-9]))/s,
    /^The (?:question|query) (?:is asking|requires|needs).*?(?=\n\n|\n(?=[0-9]))/s,
    /^Here (?:is|are) (?:what|how|the).*?(?=\n\n)/s,
  ];
  for (const pattern of reasoningPatterns) {
    cleaned = cleaned.replace(pattern, "");
  }

  // Strip code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");

  // Strip markdown tables
  cleaned = cleaned.replace(/\|[^|\n]+\|[^|\n]+\|[^|\n]*\|/g, "");
  cleaned = cleaned.replace(/\|[^|\n]+\|[^|\n]+\|/g, "");
  cleaned = cleaned.replace(/^[\s]*\|[-:\s|]+\|[\s]*$/gm, "");

  // Strip markdown headers
  cleaned = cleaned.replace(/^#{1,6}\s*/gm, "");

  // Strip bold/italic markers
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, "$1");
  cleaned = cleaned.replace(/\*([^*]+)\*/g, "$1");
  cleaned = cleaned.replace(/__([^_]+)__/g, "$1");
  cleaned = cleaned.replace(/_([^_]+)_/g, "$1");

  // Strip markdown links
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Strip horizontal rules
  cleaned = cleaned.replace(/^[-]{3,}$/gm, "");
  cleaned = cleaned.replace(/^={3,}$/gm, "");

  // Remove document metadata artifacts
  cleaned = cleaned.replace(/\[[A-Z0-9._-]+\s*p\.\d+[^\]]*\]/gi, "");
  cleaned = cleaned.replace(/^.*(?:Prepared by|Reviewed by|Approved by|Issued by|Document (?:No|Number|Code)|Revision|Issue\s*[:#]|Effective Date|Page\s+\d+)\s*[:\-–—]?\s*.*$/gim, "");
  cleaned = cleaned.replace(/\bSOP[.\s]?[A-Z]*[.\s]?\d+\s*\|?\s*Issue\s*[:#]?\s*\d+\s*\|?\s*Revision\s*[:#]?\s*\d+/gi, "");
  cleaned = cleaned.replace(/\b(?:SOP|DOC|PROC|POL)[.\s_-]?[A-Z0-9]{2,}[.\s_-]?\d+[A-Z0-9]*\b/gi, "");
  cleaned = cleaned.replace(/^\s*Standard Operating Procedure\b\s*/gim, "");

  // Strip pipe characters
  cleaned = cleaned.replace(/\|/g, "");

  // Remove lines that are just punctuation
  cleaned = cleaned.replace(/^\s*[.\-–—,;:]\s*$/gm, "");

  // Collapse whitespace
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.split("\n").map(l => l.trim()).filter(l => l.length > 0).join("\n");
  cleaned = cleaned.replace(/^\s*[.\-–—:;,]+\s*/gm, "");

  return cleaned.trim();
}

type AnswerDisplayProps = {
  content: string;
  citations: CitationType[];
  isStreaming?: boolean;
  streamStatus?: string | null;
  onCitationClick?: (citation: CitationType) => void;
  onSpeak?: () => void;
  onHindi?: () => void;
  isPlaying?: boolean;
  isHindi?: boolean;
};

function parseAnswerBlocks(text: string, citations: CitationType[]) {
  const cleaned = cleanAnswerText(text);
  if (!cleaned) return [];

  const lines = cleaned.split("\n").filter(l => l.trim());
  const blocks: {
    type: "heading" | "numbered" | "bullet" | "paragraph";
    text: string;
    number?: string;
    citations: CitationType[];
  }[] = [];

  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped) continue;

    // Extract inline citations like [1], [2]
    const citeNums: CitationType[] = [];
    const textWithoutCites = stripped.replace(/\[(\d+)\]/g, (_, num) => {
      const idx = parseInt(num) - 1;
      if (citations[idx]) citeNums.push(citations[idx]);
      return "";
    }).trim();

    // Detect numbered items: "1." "2)" "1."
    const numberedMatch = textWithoutCites.match(/^(\d+)[\.\)]\s*(.*)/s);
    if (numberedMatch) {
      blocks.push({
        type: "numbered",
        text: numberedMatch[2].trim(),
        number: numberedMatch[1],
        citations: citeNums,
      });
      continue;
    }

    // Detect bullet items
    const bulletMatch = textWithoutCites.match(/^[-•*]\s*(.*)/s);
    if (bulletMatch) {
      blocks.push({
        type: "bullet",
        text: bulletMatch[1].trim(),
        citations: citeNums,
      });
      continue;
    }

    // Detect section headings (short, no period, title case)
    if (stripped.length < 60 && !stripped.includes(".") && /^[A-Z]/.test(stripped) && stripped === stripped.toUpperCase()) {
      blocks.push({
        type: "heading",
        text: stripped,
        citations: citeNums,
      });
      continue;
    }

    // Regular paragraph
    blocks.push({
      type: "paragraph",
      text: textWithoutCites,
      citations: citeNums,
    });
  }

  return blocks;
}

export function AnswerDisplay({
  content,
  citations,
  isStreaming,
  streamStatus,
  onCitationClick,
  onSpeak,
  onHindi,
  isPlaying,
  isHindi,
}: AnswerDisplayProps) {
  const [showSources, setShowSources] = useState(false);
  const blocks = parseAnswerBlocks(content, citations);

  if (blocks.length === 0 && !isStreaming) return null;

  return (
    <div className="ad">
      <div className="ad-body">
        {blocks.map((block, i) => {
          if (block.type === "numbered") {
            return (
              <div key={i} className="ad-item">
                <span className="ad-num">{block.number}.</span>
                <div className="ad-item-content">
                  <span className="ad-text">{block.text}</span>
                  {block.citations.length > 0 && (
                    <span className="ad-cite-inline">
                      {block.citations.map((c, ci) => (
                        <button
                          key={ci}
                          onClick={() => onCitationClick?.(c)}
                          className="ad-cite"
                          title={`${c.documentCode} p.${c.pageStart}`}
                        >
                          {c.sectionTitle || `p.${c.pageStart}`}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              </div>
            );
          }

          if (block.type === "bullet") {
            return (
              <div key={i} className="ad-item">
                <span className="ad-bullet" />
                <div className="ad-item-content">
                  <span className="ad-text">{block.text}</span>
                  {block.citations.length > 0 && (
                    <span className="ad-cite-inline">
                      {block.citations.map((c, ci) => (
                        <button
                          key={ci}
                          onClick={() => onCitationClick?.(c)}
                          className="ad-cite"
                          title={`${c.documentCode} p.${c.pageStart}`}
                        >
                          {c.sectionTitle || `p.${c.pageStart}`}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              </div>
            );
          }

          if (block.type === "heading") {
            return (
              <div key={i} className="ad-heading">
                {block.text}
              </div>
            );
          }

          return (
            <div key={i} className="ad-para">
              <span className="ad-text">{block.text}</span>
              {block.citations.length > 0 && (
                <span className="ad-cite-inline">
                  {block.citations.map((c, ci) => (
                    <button
                      key={ci}
                      onClick={() => onCitationClick?.(c)}
                      className="ad-cite"
                      title={`${c.documentCode} p.${c.pageStart}`}
                    >
                      {c.sectionTitle || `p.${c.pageStart}`}
                    </button>
                  ))}
                </span>
              )}
            </div>
          );
        })}

        {isStreaming && blocks.length === 0 && (
          <div className="ad-thinking">
            <div className="ad-thinking-dots">
              <span /><span /><span />
            </div>
            <span className="ad-thinking-text">{streamStatus || "Reviewing the document"}</span>
          </div>
        )}
        {isStreaming && blocks.length > 0 && (
          <span className="ad-cursor" />
        )}
      </div>

      {(onSpeak || onHindi || citations.length > 0) && (
        <div className="ad-footer">
          <div className="ad-actions">
            {onHindi && (
              <button onClick={onHindi} className={`ad-action ${isHindi ? "ad-action-active" : ""}`}>
                Hindi
              </button>
            )}
            {onSpeak && (
              <button onClick={onSpeak} className="ad-action" title="Listen">
                {isPlaying ? <StopSquareIcon className="h-3.5 w-3.5" /> : <SpeakerWaveIcon className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
          {citations.length > 0 && (
            <button
              onClick={() => setShowSources(!showSources)}
              className="ad-sources-btn"
            >
              {citations.length} source{citations.length > 1 ? "s" : ""}
              {showSources ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
            </button>
          )}
        </div>
      )}

      {showSources && (
        <div className="ad-sources">
          {citations.map((c, i) => (
            <button
              key={i}
              onClick={() => onCitationClick?.(c)}
              className="ad-source"
            >
              <span className="ad-source-code">{c.documentCode}</span>
              <span className="ad-source-sep">&middot;</span>
              <span className="ad-source-page">p.{c.pageStart}</span>
              {c.sectionTitle && (
                <>
                  <span className="ad-source-sep">&middot;</span>
                  <span className="ad-source-section">{c.sectionTitle}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      <style jsx>{`
        .ad {
          font-family: 'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .ad-body {
          font-size: 14px;
          line-height: 1.7;
          color: #000;
          letter-spacing: -0.011em;
          -webkit-font-smoothing: antialiased;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .ad-item {
          display: flex;
          gap: 8px;
          padding: 8px 0;
          border-bottom: 1px solid rgba(0, 0, 0, 0.04);
          align-items: flex-start;
        }
        .ad-item:last-child {
          border-bottom: none;
        }

        .ad-num {
          font-size: 13px;
          font-weight: 700;
          color: #0019a8;
          min-width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 25, 168, 0.06);
          border-radius: 6px;
          flex-shrink: 0;
          margin-top: 1px;
          letter-spacing: -0.02em;
        }

        .ad-bullet {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #0019a8;
          flex-shrink: 0;
          margin-top: 7px;
          margin-left: 3px;
        }

        .ad-item-content {
          flex: 1;
          min-width: 0;
        }

        .ad-text {
          word-break: break-word;
        }

        .ad-para {
          padding: 4px 0;
        }

        .ad-heading {
          font-size: 12px;
          font-weight: 700;
          color: #374151;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 12px 0 4px 0;
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }

        .ad-cite-inline {
          display: inline;
          margin-left: 4px;
        }

        .ad-cite {
          display: inline-flex;
          align-items: center;
          padding: 1px 6px;
          font-family: 'Figtree', sans-serif;
          font-size: 10px;
          font-weight: 600;
          color: #0019a8;
          background: rgba(0, 25, 168, 0.06);
          border: 1px solid rgba(0, 25, 168, 0.12);
          border-radius: 100px;
          cursor: pointer;
          transition: all 0.15s ease;
          vertical-align: middle;
          white-space: nowrap;
          line-height: 1.4;
        }
        .ad-cite:hover {
          background: #0019a8;
          color: #fff;
          border-color: #0019a8;
        }

        .ad-cursor {
          display: inline-block;
          width: 2px;
          height: 1.1em;
          background: #0019a8;
          margin-left: 1px;
          vertical-align: text-bottom;
          animation: ad-blink 1s step-end infinite;
        }
        @keyframes ad-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        .ad-thinking {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 14px;
          background: rgba(0, 25, 168, 0.04);
          border: 1px solid rgba(0, 25, 168, 0.08);
          border-radius: 10px;
        }
        .ad-thinking-dots {
          display: flex;
          gap: 3px;
          align-items: center;
        }
        .ad-thinking-dots span {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #0019a8;
          animation: ad-dot-pulse 1.4s ease-in-out infinite;
        }
        .ad-thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
        .ad-thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes ad-dot-pulse {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        .ad-thinking-text {
          font-size: 12px;
          font-weight: 500;
          color: #0019a8;
          letter-spacing: -0.005em;
        }

        .ad-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid rgba(0, 0, 0, 0.06);
        }
        .ad-actions {
          display: flex;
          gap: 6px;
        }
        .ad-action {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 5px 10px;
          font-family: 'Figtree', sans-serif;
          font-size: 11px;
          font-weight: 600;
          color: #6b7280;
          background: transparent;
          border: 1px solid rgba(0, 0, 0, 0.1);
          border-radius: 100px;
          cursor: pointer;
          transition: all 0.15s ease;
          letter-spacing: -0.005em;
        }
        .ad-action:hover,
        .ad-action-active {
          color: #0019a8;
          border-color: rgba(0, 25, 168, 0.25);
          background: rgba(0, 25, 168, 0.04);
        }
        .ad-sources-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 5px 10px;
          font-family: 'Figtree', sans-serif;
          font-size: 11px;
          font-weight: 600;
          color: #6b7280;
          background: transparent;
          border: 1px solid rgba(0, 0, 0, 0.1);
          border-radius: 100px;
          cursor: pointer;
          transition: all 0.15s ease;
          letter-spacing: -0.005em;
        }
        .ad-sources-btn:hover {
          color: #0019a8;
          border-color: rgba(0, 25, 168, 0.25);
        }
        .ad-sources {
          margin-top: 10px;
          padding: 10px;
          background: rgba(0, 0, 0, 0.015);
          border: 1px solid rgba(0, 0, 0, 0.06);
          border-radius: 10px;
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          animation: ad-slide 0.2s ease;
        }
        @keyframes ad-slide {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .ad-source {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          font-family: 'Figtree', sans-serif;
          font-size: 11px;
          background: #fff;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 100px;
          cursor: pointer;
          transition: all 0.15s ease;
          color: #374151;
        }
        .ad-source:hover {
          border-color: #0019a8;
          box-shadow: 0 1px 4px rgba(0, 25, 168, 0.08);
        }
        .ad-source-code {
          font-weight: 600;
          color: #000;
        }
        .ad-source-sep {
          color: #d1d5db;
        }
        .ad-source-page {
          color: #6b7280;
        }
        .ad-source-section {
          color: #9ca3af;
          font-size: 10px;
        }
      `}</style>
    </div>
  );
}
