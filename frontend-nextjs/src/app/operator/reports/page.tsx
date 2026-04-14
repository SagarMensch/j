"use client";

import React, { useEffect, useState } from "react";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";

type ReportsPayload = {
  stats: {
    active_certifications: number;
    assessment_attempts: number;
    average_score: number;
    expiring_soon: number;
  };
  certifications: {
    certification_id: string;
    module_title: string;
    status: string;
    issued_at: string | null;
    expires_at: string | null;
    latest_score: number | null;
  }[];
  assessment_attempts: {
    attempt_id: string;
    attempt_number: number;
    score: number | null;
    status: string;
    started_at: string | null;
    completed_at: string | null;
    assessment_title: string;
    module_title: string;
  }[];
};

type GuardrailIncidentPayload = {
  incidents: {
    incident_id: string;
    category: string | null;
    reason: string | null;
    severity: string;
    channel: string | null;
    query_excerpt: string | null;
    created_at: string | null;
    appeal: {
      appeal_id: string;
      appeal_text: string;
      status: string;
      resolution_notes: string | null;
      created_at: string | null;
      reviewed_at: string | null;
      reviewed_by_name: string | null;
    } | null;
  }[];
  summary: {
    total: number;
    pending_appeals: number;
  };
};

type ReportsCopy = {
  noDate: string;
  kicker: string;
  title: string;
  subtitle: string;
  loading: string;
  activeCertifications: string;
  averageScore: string;
  assessmentAttempts: string;
  expiringSoon: string;
  certificationsTab: string;
  assessmentHistoryTab: string;
  guardrailReviewTab: string;
  module: string;
  status: string;
  issued: string;
  expires: string;
  latestScore: string;
  noCertifications: string;
  noAssessmentAttempts: string;
  attemptLabel: (value: number, date: string) => string;
  incidentsLabel: (value: number) => string;
  pendingAppealsLabel: (value: number) => string;
  noGuardrailIncidents: string;
  noExcerpt: string;
  reasonLabel: string;
  reviewedBy: (name: string) => string;
  resolutionLabel: string;
  requestReview: string;
  requestReviewHint: string;
  appealPlaceholder: string;
  submitting: string;
  submitAppeal: string;
  appealLabel: (status: string) => string;
};

const COPY: Record<AppLanguage, ReportsCopy> = {
  ENG: {
    noDate: "-",
    kicker: "My records",
    title: "Reports",
    subtitle: "Your certifications, attempts, and review requests.",
    loading: "Loading reports...",
    activeCertifications: "Active certifications",
    averageScore: "Average score",
    assessmentAttempts: "Assessment attempts",
    expiringSoon: "Expiring soon",
    certificationsTab: "Certifications",
    assessmentHistoryTab: "Assessment history",
    guardrailReviewTab: "Guardrail review",
    module: "Module",
    status: "Status",
    issued: "Issued",
    expires: "Expires",
    latestScore: "Latest score",
    noCertifications: "No certifications recorded yet.",
    noAssessmentAttempts: "No assessment attempts recorded yet.",
    attemptLabel: (value, date) => `Attempt ${value} | Completed ${date}`,
    incidentsLabel: (value) => `${value} incidents`,
    pendingAppealsLabel: (value) => `${value} pending appeals`,
    noGuardrailIncidents: "No guardrail incidents recorded for your account.",
    noExcerpt: "No excerpt recorded.",
    reasonLabel: "Reason",
    reviewedBy: (name) => `Reviewed by ${name}`,
    resolutionLabel: "Resolution",
    requestReview: "Request review",
    requestReviewHint: "If this was a valid work question, explain the context for admin review.",
    appealPlaceholder: "Explain why this request should be reviewed.",
    submitting: "Submitting...",
    submitAppeal: "Submit appeal",
    appealLabel: (status) => `Appeal ${status}`,
  },
  HIN: {
    noDate: "-",
    kicker: "मेरे रिकॉर्ड",
    title: "रिपोर्ट",
    subtitle: "आपके सर्टिफिकेट, कोशिशें और रिव्यू अनुरोध।",
    loading: "रिपोर्ट लोड हो रही है...",
    activeCertifications: "चालू सर्टिफिकेट",
    averageScore: "औसत स्कोर",
    assessmentAttempts: "जांच कोशिशें",
    expiringSoon: "जल्द खत्म",
    certificationsTab: "सर्टिफिकेट",
    assessmentHistoryTab: "जांच इतिहास",
    guardrailReviewTab: "गार्डरेल रिव्यू",
    module: "मॉड्यूल",
    status: "स्थिति",
    issued: "जारी",
    expires: "समाप्त",
    latestScore: "नया स्कोर",
    noCertifications: "अभी कोई सर्टिफिकेट दर्ज नहीं है।",
    noAssessmentAttempts: "अभी कोई जांच कोशिश दर्ज नहीं है।",
    attemptLabel: (value, date) => `कोशिश ${value} | पूरा ${date}`,
    incidentsLabel: (value) => `${value} घटनाएं`,
    pendingAppealsLabel: (value) => `${value} अपील बाकी`,
    noGuardrailIncidents: "आपके खाते के लिए कोई गार्डरेल घटना दर्ज नहीं है।",
    noExcerpt: "कोई अंश दर्ज नहीं है।",
    reasonLabel: "कारण",
    reviewedBy: (name) => `रिव्यू किया: ${name}`,
    resolutionLabel: "फैसला",
    requestReview: "रिव्यू मांगें",
    requestReviewHint: "अगर यह सही काम का सवाल था, तो एडमिन रिव्यू के लिए कारण लिखें।",
    appealPlaceholder: "बताएं कि इस अनुरोध का रिव्यू क्यों होना चाहिए।",
    submitting: "भेजा जा रहा है...",
    submitAppeal: "अपील भेजें",
    appealLabel: (status) => `अपील ${status}`,
  },
  HING: {
    noDate: "-",
    kicker: "Mere records",
    title: "Reports",
    subtitle: "Aapke certs, attempts, aur review requests.",
    loading: "Reports load ho rahi hain...",
    activeCertifications: "Active certs",
    averageScore: "Average score",
    assessmentAttempts: "Assessment attempts",
    expiringSoon: "Jaldi expire",
    certificationsTab: "Certifications",
    assessmentHistoryTab: "Assessment history",
    guardrailReviewTab: "Guardrail review",
    module: "Module",
    status: "Status",
    issued: "Issued",
    expires: "Expires",
    latestScore: "Latest score",
    noCertifications: "Abhi koi certification record nahi hai.",
    noAssessmentAttempts: "Abhi koi assessment attempt record nahi hai.",
    attemptLabel: (value, date) => `Attempt ${value} | Completed ${date}`,
    incidentsLabel: (value) => `${value} incidents`,
    pendingAppealsLabel: (value) => `${value} appeals pending`,
    noGuardrailIncidents: "Aapke account ke liye koi guardrail incident record nahi hai.",
    noExcerpt: "Koi excerpt record nahi hai.",
    reasonLabel: "Reason",
    reviewedBy: (name) => `Reviewed by ${name}`,
    resolutionLabel: "Resolution",
    requestReview: "Review maango",
    requestReviewHint: "Agar yeh valid work question tha, to admin review ke liye context likho.",
    appealPlaceholder: "Likho ki is request ka review kyon hona chahiye.",
    submitting: "Submit ho raha hai...",
    submitAppeal: "Appeal submit karo",
    appealLabel: (status) => `Appeal ${status}`,
  },
};

function formatDate(value: string | null, language: AppLanguage, copy: ReportsCopy) {
  if (!value) return copy.noDate;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return copy.noDate;
  return date.toLocaleDateString(language === "ENG" ? "en-IN" : "hi-IN", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ReportsPage() {
  const { user, language } = useAuth();
  const copy = COPY[language];
  const [activeTab, setActiveTab] = useState<"certifications" | "assessments" | "guardrails">(
    "certifications",
  );
  const [payload, setPayload] = useState<ReportsPayload | null>(null);
  const [guardrailPayload, setGuardrailPayload] = useState<GuardrailIncidentPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [appealDrafts, setAppealDrafts] = useState<Record<string, string>>({});
  const [submittingAppealId, setSubmittingAppealId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (requestedTab === "guardrails") {
      setActiveTab("guardrails");
      return;
    }
    if (requestedTab === "assessments") {
      setActiveTab("assessments");
      return;
    }
    if (requestedTab === "certifications") {
      setActiveTab("certifications");
    }
  }, []);

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function loadReports() {
      try {
        const [response, guardrailResponse] = await Promise.all([
          apiClient.get(`/api/users/${user.id}/reports`),
          apiClient.get(`/api/guardrail/incidents?user_id=${user.id}&limit=20`),
        ]);
        if (!isMounted) return;
        setPayload(response as ReportsPayload);
        setGuardrailPayload(guardrailResponse as GuardrailIncidentPayload);
        setError("");
      } catch (err) {
        if (!isMounted) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load operator reports.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadReports();
    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  const submitAppeal = async (incidentId: string) => {
    if (!user?.id) return;
    const appealText = (appealDrafts[incidentId] || "").trim();
    if (appealText.length < 10) return;

    setSubmittingAppealId(incidentId);
    try {
      await apiClient.post(`/api/guardrail/incidents/${incidentId}/appeal`, {
        user_id: user.id,
        appeal_text: appealText,
      });
      const refreshed = (await apiClient.get(
        `/api/guardrail/incidents?user_id=${user.id}&limit=20`,
      )) as GuardrailIncidentPayload;
      setGuardrailPayload(refreshed);
      setAppealDrafts((prev) => ({ ...prev, [incidentId]: "" }));
    } catch (err) {
      setError(
         err instanceof Error ? err.message : "Failed to submit appeal.",
      );
    } finally {
      setSubmittingAppealId(null);
    }
  };

  return (
    <OperatorLayout>
      <div className="mx-auto max-w-[1520px] px-4 py-8 space-y-6">
        <div className="hero-panel p-6">
          <p className="tfl-kicker">{copy.kicker}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-foreground">{copy.title}</h1>
          <p className="mt-2 text-sm text-muted">
            {copy.subtitle}
          </p>
        </div>

        {isLoading ? (
          <Card>
            <div className="py-12 text-center text-muted">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p>{copy.loading}</p>
            </div>
          </Card>
        ) : error ? (
          <Card>
            <div className="py-6 text-center">
              <p className="text-danger font-medium">{error}</p>
            </div>
          </Card>
        ) : payload ? (
          <>
            <div className="grid sm:grid-cols-4 gap-4">
              <Card>
                <div className="text-center">
                  <p className="text-3xl font-bold text-accent">
                    {payload.stats.active_certifications}
                  </p>
                  <p className="text-sm text-muted">{copy.activeCertifications}</p>
                </div>
              </Card>
              <Card>
                <div className="text-center">
                  <p className="text-3xl font-bold text-primary">
                    {Math.round(payload.stats.average_score || 0)}%
                  </p>
                  <p className="text-sm text-muted">{copy.averageScore}</p>
                </div>
              </Card>
              <Card>
                <div className="text-center">
                  <p className="text-3xl font-bold text-foreground">
                    {payload.stats.assessment_attempts}
                  </p>
                  <p className="text-sm text-muted">{copy.assessmentAttempts}</p>
                </div>
              </Card>
              <Card>
                <div className="text-center">
                  <p className="text-3xl font-bold text-warning">
                    {payload.stats.expiring_soon}
                  </p>
                  <p className="text-sm text-muted">{copy.expiringSoon}</p>
                </div>
              </Card>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveTab("certifications")}
                className={`tfl-tab ${activeTab === "certifications" ? "tfl-tab-active" : ""}`}
              >
                {copy.certificationsTab}
              </button>
              <button
                onClick={() => setActiveTab("assessments")}
                className={`tfl-tab ${activeTab === "assessments" ? "tfl-tab-active" : ""}`}
              >
                {copy.assessmentHistoryTab}
              </button>
              <button
                onClick={() => setActiveTab("guardrails")}
                className={`tfl-tab ${activeTab === "guardrails" ? "tfl-tab-active" : ""}`}
              >
                {copy.guardrailReviewTab}
              </button>
            </div>

            {activeTab === "certifications" ? (
              <Card className="!p-0">
                <div className="overflow-x-auto">
                  <table className="tfl-table">
                    <thead>
                      <tr className="bg-muted-light">
                        <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                          {copy.module}
                        </th>
                        <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                          {copy.status}
                        </th>
                        <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                          {copy.issued}
                        </th>
                        <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                          {copy.expires}
                        </th>
                        <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                          {copy.latestScore}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {payload.certifications.map((cert) => (
                        <tr
                          key={cert.certification_id}
                          className="hover:bg-muted-light/50 transition-colors"
                        >
                          <td className="px-4 py-3 text-sm font-medium text-foreground">
                            {cert.module_title}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant={
                                cert.status === "active"
                                  ? "success"
                                  : cert.status === "expired"
                                    ? "danger"
                                    : "warning"
                              }
                            >
                              {cert.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-muted">
                            {formatDate(cert.issued_at, language, copy)}
                          </td>
                          <td className="px-4 py-3 text-sm text-muted">
                            {formatDate(cert.expires_at, language, copy)}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-primary">
                            {cert.latest_score !== null
                              ? `${Math.round(cert.latest_score)}%`
                              : "-"}
                          </td>
                        </tr>
                      ))}
                      {payload.certifications.length === 0 ? (
                        <tr>
                          <td
                            className="px-4 py-6 text-sm text-muted text-center"
                            colSpan={5}
                          >
                            {copy.noCertifications}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : activeTab === "assessments" ? (
              <Card className="!p-0">
                <div className="divide-y divide-border">
                  {payload.assessment_attempts.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted">
                      {copy.noAssessmentAttempts}
                    </div>
                  ) : (
                    payload.assessment_attempts.map((attempt) => (
                      <div
                        key={attempt.attempt_id}
                        className="p-4 flex items-center justify-between gap-4"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {attempt.assessment_title}
                          </p>
                          <p className="text-xs text-muted">
                            {attempt.module_title}
                          </p>
                          <p className="text-xs text-muted mt-1">
                            {copy.attemptLabel(
                              attempt.attempt_number,
                              formatDate(attempt.completed_at, language, copy),
                            )}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-primary">
                            {attempt.score !== null
                              ? `${Math.round(attempt.score)}%`
                              : "-"}
                          </p>
                          <Badge
                            variant={
                              attempt.status === "completed"
                                ? "success"
                                : "warning"
                            }
                            size="sm"
                          >
                            {attempt.status}
                          </Badge>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            ) : (
              <Card className="!p-0">
                <div className="border-b border-border bg-muted-light px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning">
                      {copy.incidentsLabel(guardrailPayload?.summary.total || 0)}
                    </Badge>
                    <Badge variant="info">
                      {copy.pendingAppealsLabel(
                        guardrailPayload?.summary.pending_appeals || 0,
                      )}
                    </Badge>
                  </div>
                </div>
                <div className="divide-y divide-border">
                  {(guardrailPayload?.incidents || []).length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted">
                      {copy.noGuardrailIncidents}
                    </div>
                  ) : (
                    (guardrailPayload?.incidents || []).map((incident) => (
                      <div key={incident.incident_id} className="p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              incident.severity === "high" ? "danger" : "warning"
                            }
                          >
                            {incident.severity}
                          </Badge>
                          <Badge variant="default">
                            {incident.category || "guardrail"}
                          </Badge>
                          <span className="text-xs text-muted">
                            {formatDate(incident.created_at, language, copy)}
                          </span>
                        </div>
                        <p className="mt-3 text-sm text-foreground">
                          {incident.query_excerpt || copy.noExcerpt}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {copy.reasonLabel}: {(incident.reason || "policy").replaceAll("_", " ")}
                        </p>

                        {incident.appeal ? (
                          <div className="mt-4 rounded-[12px] border border-border bg-[#f7faff] px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="info">
                                {copy.appealLabel(incident.appeal.status)}
                              </Badge>
                              {incident.appeal.reviewed_by_name ? (
                                <span className="text-xs text-muted">
                                  {copy.reviewedBy(incident.appeal.reviewed_by_name)}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-2 text-sm text-foreground">
                              {incident.appeal.appeal_text}
                            </p>
                            {incident.appeal.resolution_notes ? (
                              <p className="mt-2 text-xs text-muted">
                                {copy.resolutionLabel}: {incident.appeal.resolution_notes}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <div className="mt-4 rounded-[12px] border border-border bg-white px-4 py-4">
                            <p className="text-sm font-medium text-foreground">
                              {copy.requestReview}
                            </p>
                            <p className="mt-1 text-xs text-muted">
                              {copy.requestReviewHint}
                            </p>
                            <textarea
                              value={appealDrafts[incident.incident_id] || ""}
                              onChange={(event) =>
                                setAppealDrafts((prev) => ({
                                  ...prev,
                                  [incident.incident_id]: event.target.value,
                                }))
                              }
                              placeholder={copy.appealPlaceholder}
                              className="mt-3 min-h-[96px] w-full rounded-[10px] border border-border bg-white px-3 py-3 text-sm text-foreground placeholder-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/15"
                            />
                            <div className="mt-3 flex justify-end">
                              <Button
                                variant="primary"
                                onClick={() => void submitAppeal(incident.incident_id)}
                                disabled={submittingAppealId === incident.incident_id}
                              >
                                {submittingAppealId === incident.incident_id
                                  ? copy.submitting
                                  : copy.submitAppeal}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </Card>
            )}
          </>
        ) : null}
      </div>
    </OperatorLayout>
  );
}
