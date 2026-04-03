import { AnalysisResponse, TamperedRegion } from "@/lib/api-types";
import { formatPercent } from "@/lib/format";

export type TimelineEvent = {
  icon: string;
  title: string;
  timestamp: string;
  detail: string;
  tone: "primary" | "accent-red" | "accent-amber" | "muted";
};

export function getPrimaryPage(analysis: AnalysisResponse) {
  return analysis.pages[0] ?? null;
}

export function getTopRegion(analysis: AnalysisResponse): TamperedRegion | null {
  return analysis.pages
    .flatMap((page) => page.tampered_regions)
    .sort((left, right) => right.max_mask_score - left.max_mask_score)[0] ?? null;
}

export function buildIntegrityRows(analysis: AnalysisResponse) {
  const rows = [
    {
      label: "Segmentation Score",
      value: formatPercent(analysis.engine_scores.segmentation_score),
      tone: analysis.engine_scores.segmentation_score >= 0.85 ? "danger" : analysis.engine_scores.segmentation_score >= 0.45 ? "warning" : "clear",
    },
    {
      label: "OCR Anomaly Score",
      value: formatPercent(analysis.engine_scores.ocr_anomaly_score),
      tone: analysis.engine_scores.ocr_anomaly_score >= 0.45 ? "warning" : "clear",
    },
    {
      label: "Duplicate / pHash",
      value: formatPercent(analysis.engine_scores.phash_score),
      tone: analysis.engine_scores.phash_score >= 0.75 ? "danger" : analysis.engine_scores.phash_score >= 0.3 ? "warning" : "clear",
    },
    {
      label: "DINO / SRM Blend",
      value: formatPercent((analysis.engine_scores.dino_vit_score + analysis.engine_scores.srm_score) / 2),
      tone: analysis.engine_scores.dino_vit_score >= 0.6 ? "warning" : "clear",
    },
  ] as const;

  return rows;
}

export function buildTimelineEvents(analysis: AnalysisResponse): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      icon: "upload_file",
      title: "Document Uploaded",
      timestamp: analysis.created_at,
      detail: `${analysis.filename} entered the FastAPI ingestion pipeline.`,
      tone: "primary",
    },
    {
      icon: "psychology",
      title: "Forensic Engines Completed",
      timestamp: analysis.created_at,
      detail: `ELA, Laplacian, OCR, SRM, Noiseprint, DINO, pHash, and segmentation finished in ${analysis.processing_time_ms} ms.`,
      tone: "primary",
    },
  ];

  if (analysis.duplicate_check.duplicate_status !== "NO_MATCH") {
    events.push({
      icon: "content_copy",
      title: "Duplicate Match Raised",
      timestamp: analysis.created_at,
      detail: `${analysis.duplicate_check.duplicate_status.replaceAll("_", " ")} against ${analysis.duplicate_check.nearest_match_analysis_id ?? "a stored case"}.`,
      tone: "accent-amber",
    });
  }

  analysis.ocr_anomalies.forEach((anomaly) => {
    events.push({
      icon: "warning",
      title: anomaly.type.replaceAll("_", " "),
      timestamp: analysis.created_at,
      detail: anomaly.description,
      tone: "accent-amber",
    });
  });

  analysis.warnings.forEach((warning) => {
    events.push({
      icon: "error",
      title: "Pipeline Warning",
      timestamp: analysis.created_at,
      detail: warning,
      tone: "accent-red",
    });
  });

  events.push({
    icon: "policy",
    title: `Verdict: ${analysis.verdict.replaceAll("_", " ")}`,
    timestamp: analysis.created_at,
    detail: `Overall risk score closed at ${formatPercent(analysis.forensic_risk_score)}.`,
    tone: analysis.verdict === "CONFIRMED_FORGERY" ? "accent-red" : analysis.verdict === "SUSPICIOUS" ? "accent-amber" : "muted",
  });

  return events;
}
