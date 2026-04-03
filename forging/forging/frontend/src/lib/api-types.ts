export type Verdict = "CLEAN" | "SUSPICIOUS" | "CONFIRMED_FORGERY";
export type DuplicateStatus = "NO_MATCH" | "NEAR_DUPLICATE" | "EXACT_DUPLICATE";

export interface EngineScores {
  ela_score: number;
  srm_score: number;
  noiseprint_score: number;
  dino_vit_score: number;
  ocr_anomaly_score: number;
  phash_score: number;
  segmentation_score: number;
}

export interface OCRAnomaly {
  type: string;
  description: string;
  page_index: number | null;
}

export interface DuplicateCheck {
  md5_hash: string;
  phash: string;
  duplicate_status: DuplicateStatus;
  nearest_match_analysis_id: string | null;
  hamming_distance: number | null;
}

export interface PageArtifacts {
  original_url: string;
  mask_url: string;
  overlay_url: string;
  ela_heatmap_url: string;
  srm_heatmap_url: string;
  noiseprint_heatmap_url: string;
  dino_heatmap_url: string;
  combined_heatmap_url: string;
  contours_url: string;
}

export interface TamperedRegion {
  region_id: string;
  page_index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  area_px: number;
  mean_mask_score: number;
  max_mask_score: number;
}

export interface PageResult {
  page_index: number;
  width: number;
  height: number;
  artifacts: PageArtifacts;
  tampered_regions: TamperedRegion[];
}

export interface AnalysisResponse {
  analysis_id: string;
  filename: string;
  document_type: string | null;
  submitter_id: string | null;
  page_count: number;
  device: string;
  verdict: Verdict;
  forensic_risk_score: number;
  engine_scores: EngineScores;
  ocr_anomalies: OCRAnomaly[];
  duplicate_check: DuplicateCheck;
  pages: PageResult[];
  warnings: string[];
  processing_time_ms: number;
  created_at: string;
}

export interface AnalysisHistoryItem {
  analysis_id: string;
  filename: string;
  document_type: string | null;
  submitter_id: string | null;
  page_count: number;
  verdict: Verdict;
  forensic_risk_score: number;
  duplicate_status: DuplicateStatus;
  processing_time_ms: number;
  created_at: string;
}

export interface AnalysisHistoryResponse {
  page: number;
  page_size: number;
  total: number;
  items: AnalysisHistoryItem[];
}

export interface DashboardSummaryResponse {
  total_analyses: number;
  clean_count: number;
  suspicious_count: number;
  confirmed_forgery_count: number;
  exact_duplicate_count: number;
  near_duplicate_count: number;
  total_ocr_anomalies: number;
  average_risk_score: number;
  average_processing_time_ms: number;
  engine_averages: EngineScores;
  recent_analyses: AnalysisHistoryItem[];
  flagged_analyses: AnalysisHistoryItem[];
}

export interface HealthResponse {
  status: string;
  model_loaded: boolean;
  checkpoint_exists: boolean;
  database_ready: boolean;
}

export interface ModelInfoResponse {
  checkpoint_path: string;
  selected_encoder: string | null;
  input_channels: number | null;
  checkpoint_input_channels: number | null;
  device: string;
  model_parameter_count: number | null;
  model_loaded: boolean;
  load_error: string | null;
  tried_architectures: string[];
}
