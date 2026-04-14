// Telemetry utility for UI audit events
// These stubs will be connected to actual backend telemetry service

export type TelemetryEvent =
  | "ui.query_submitted"
  | "ui.citation_opened"
  | "ui.viewer_highlight_opened"
  | "ui.training_assignments_opened"
  | "ui.training_module_opened"
  | "ui.training_step_translated"
  | "ui.training_step_spoken"
  | "ui.training_step_advanced"
  | "ui.training_module_completed"
  | "ui.assessment_opened"
  | "ui.assessment_started"
  | "ui.assessment_submitted"
  | "ui.readiness_filter_applied"
  | "ui.admin_readiness_opened";

export interface TelemetryPayload {
  user_id: string;
  role: "operator" | "admin" | "supervisor";
  language: string;
  session_id: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export function trackEvent(
  event: TelemetryEvent,
  metadata?: Record<string, unknown>,
) {
  const payload: TelemetryPayload = {
    user_id: getStoredUserId(),
    role: getStoredRole(),
    language: getStoredLanguage(),
    session_id: getSessionId(),
    timestamp: new Date().toISOString(),
    metadata,
  };

  // Log in development
  if (process.env.NODE_ENV === "development") {
    console.log(`[Telemetry] ${event}`, payload);
  }

  // TODO: Send to telemetry backend
  // await fetch('/api/telemetry', { method: 'POST', body: JSON.stringify({ event, ...payload }) });
}

function getStoredUserId(): string {
  if (typeof window === "undefined") return "server";
  return localStorage.getItem("user_id") || "anonymous";
}

function getStoredRole(): "operator" | "admin" | "supervisor" {
  if (typeof window === "undefined") return "operator";
  return (
    (localStorage.getItem("user_role") as
      | "operator"
      | "admin"
      | "supervisor") || "operator"
  );
}

function getStoredLanguage(): string {
  if (typeof window === "undefined") return "ENG";
  return localStorage.getItem("language") || "ENG";
}

function getSessionId(): string {
  if (typeof window === "undefined") return "server-session";
  let sessionId = sessionStorage.getItem("session_id");
  if (!sessionId) {
    sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem("session_id", sessionId);
  }
  return sessionId;
}
