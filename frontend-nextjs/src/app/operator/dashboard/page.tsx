"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OperatorLayout } from "@/components/operator/operator-layout";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";
import { trackEvent } from "@/lib/telemetry";

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: { results: { transcript: string }[][] }) => void) | null;
  start: () => void;
  stop: () => void;
};

type DashboardAssignment = {
  assignment_id: string;
  module_id: string;
  module_title: string;
  criticality: string | null;
  total_steps: number | null;
  is_mandatory: boolean;
  status: "assigned" | "in_progress" | "completed";
  progress_percent: number;
  current_step: number | null;
  due_at: string | null;
  completed_at: string | null;
  assessment_id: string | null;
};

type DashboardPayload = {
  user: {
    id: string;
    full_name: string;
    role: string;
    department: string | null;
  };
  stats: {
    mandatory_total: number;
    mandatory_completed: number;
    mandatory_completion_rate: number;
    in_progress: number;
    overdue: number;
  };
  mandatory_training: DashboardAssignment[];
  recent_sops: {
    code: string;
    title: string;
    document_type: string;
    revision_id: string;
    revision_label: string;
    page_count: number;
    updated_at: string | null;
  }[];
  safety_alerts: {
    document_code: string;
    document_title: string;
    chunk_id: string;
    page_start: number | null;
    citation_label: string | null;
    alert_text: string;
    severity: string;
  }[];
};

type ReportsPayload = {
  stats: {
    active_certifications: number;
    assessment_attempts: number;
    average_score: number;
    expiring_soon: number;
  };
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
      status: string;
    } | null;
  }[];
  summary: {
    total: number;
    pending_appeals: number;
  };
};

const RECENT_SEARCHES_KEY = "operator_recent_searches";

type DashboardCopy = {
  loadingHome: string;
  noDueDate: string;
  dueToday: string;
  daysOverdue: (days: number) => string;
  daysLeft: (days: number) => string;
  greeting: {
    morning: { label: string; prompts: string[] };
    afternoon: { label: string; prompts: string[] };
    evening: { label: string; prompts: string[] };
    night: { label: string; prompts: string[] };
  };
  shiftStatus: string;
  liveNow: string;
  departmentFallback: string;
  activeNowLine: (department: string, dateLabel: string, timeLabel: string) => string;
  commandHubTitle: string;
  commandHubTag: string;
  assistantTitle: string;
  assistantBody: string;
  readerTitle: string;
  readerBody: (latestLabel?: string | null) => string;
  reviewTitle: string;
  reviewBody: string;
  searchPlaceholder: string;
  voiceInputTitle: string;
  voiceListeningTitle: string;
  searchButton: string;
  recentLabel: string;
  priorityTask: string;
  noPriorityTask: string;
  noPriorityBody: string;
  stepLabel: (current: number, total: number, dueText: string) => string;
  resumeTask: string;
  openTraining: string;
  focusTitle: string;
  focusBody: string;
  metricMandatoryCompletion: string;
  metricAverageAssessment: string;
  metricApprovedSops: string;
  metricActiveCertifications: string;
  trainingFlow: string;
  mandatoryModules: string;
  percentComplete: (value: number) => string;
  noMandatoryTraining: string;
  stepCount: (current: number, total: number, dueText: string) => string;
  urgent: string;
  liveSignals: string;
  safetyAndReview: string;
  liveCount: (count: number) => string;
  safetyAlerts: string;
  openCount: (count: number) => string;
  noSafetyAlerts: string;
  guardrailReview: string;
  pendingAppeals: (count: number) => string;
  noGuardrailReviews: string;
  reviewRequest: string;
  noAppealSubmitted: string;
  appealStatus: (status: string) => string;
  approvedDocuments: string;
  recentSops: string;
  openLatest: string;
  noApprovedDocuments: string;
  updatedLabel: (dateLabel: string) => string;
};

const COPY: Record<AppLanguage, DashboardCopy> = {
  ENG: {
    loadingHome: "Loading home...",
    noDueDate: "No due date",
    dueToday: "Due today",
    daysOverdue: (days) => `${days} day${days === 1 ? "" : "s"} overdue`,
    daysLeft: (days) => `${days} day${days === 1 ? "" : "s"} left`,
    greeting: {
      morning: {
        label: "Good morning",
        prompts: ["Start steady", "Check the first task", "Ready for the shift"],
      },
      afternoon: {
        label: "Good afternoon",
        prompts: ["Keep work moving", "Focus on the next task", "Stay on top of the queue"],
      },
      evening: {
        label: "Good evening",
        prompts: ["Close the shift strong", "Review what is pending", "Keep the line safe"],
      },
      night: {
        label: "Good night",
        prompts: ["Watch the live queue", "Keep handover clean", "Check the critical items"],
      },
    },
    shiftStatus: "Shift status",
    liveNow: "Live now",
    departmentFallback: "Operations",
    activeNowLine: (department, dateLabel, timeLabel) =>
      `${department} is active on ${dateLabel} at ${timeLabel}.`,
    commandHubTitle: "Command Hub",
    commandHubTag: "Quick actions",
    assistantTitle: "Assistant",
    assistantBody: "Open chat, SOP search, and live help.",
    readerTitle: "Reader",
    readerBody: (latestLabel) => latestLabel || "Open the latest approved document.",
    reviewTitle: "Review queue",
    reviewBody: "Open reports, incidents, and appeals.",
    searchPlaceholder: "Search SOPs or ask a question...",
    voiceInputTitle: "Voice input",
    voiceListeningTitle: "Listening... Click to stop",
    searchButton: "Search",
    recentLabel: "Recent",
    priorityTask: "Priority task",
    noPriorityTask: "Open the next assigned task",
    noPriorityBody: "No task is in progress. Open training to continue the next assigned item.",
    stepLabel: (current, total, dueText) => `Step ${current} of ${total}. ${dueText}.`,
    resumeTask: "Resume task",
    openTraining: "Open training",
    focusTitle: "Today's focus",
    focusBody: "See what needs attention first.",
    metricMandatoryCompletion: "Mandatory completion",
    metricAverageAssessment: "Average assessment",
    metricApprovedSops: "Approved SOPs",
    metricActiveCertifications: "Active certifications",
    trainingFlow: "Training flow",
    mandatoryModules: "Mandatory modules",
    percentComplete: (value) => `${value}% complete`,
    noMandatoryTraining: "No pending mandatory training.",
    stepCount: (current, total, dueText) => `${current}/${total} steps | ${dueText}`,
    urgent: "Urgent",
    liveSignals: "Live signals",
    safetyAndReview: "Safety and review",
    liveCount: (count) => `${count} live`,
    safetyAlerts: "Safety alerts",
    openCount: (count) => `${count} open`,
    noSafetyAlerts: "No active safety alerts.",
    guardrailReview: "Guardrail review",
    pendingAppeals: (count) => `${count} pending appeals`,
    noGuardrailReviews: "No guardrail reviews waiting.",
    reviewRequest: "Review request",
    noAppealSubmitted: "No appeal submitted",
    appealStatus: (status) => `Appeal ${status}`,
    approvedDocuments: "Approved documents",
    recentSops: "Recent SOPs",
    openLatest: "Open latest",
    noApprovedDocuments: "No approved documents available.",
    updatedLabel: (dateLabel) => `Updated ${dateLabel}`,
  },
  HIN: {
    loadingHome: "होम लोड हो रहा है...",
    noDueDate: "कोई तारीख नहीं",
    dueToday: "आज जमा करना है",
    daysOverdue: (days) => `${days} दिन लेट`,
    daysLeft: (days) => `${days} दिन बाकी`,
    greeting: {
      morning: {
        label: "सुप्रभात",
        prompts: ["शिफ्ट की शुरुआत करें", "पहला काम देखें", "आज की तैयारी पूरी है"],
      },
      afternoon: {
        label: "नमस्कार",
        prompts: ["काम चालू रखें", "अगले काम पर ध्यान दें", "कतार पर नजर रखें"],
      },
      evening: {
        label: "शुभ संध्या",
        prompts: ["शिफ्ट मजबूत रखें", "बाकी काम देख लें", "काम सुरक्षित रखें"],
      },
      night: {
        label: "शुभ रात्रि",
        prompts: ["लाइव कतार देखें", "हैंडओवर साफ रखें", "जरूरी काम पहले देखें"],
      },
    },
    shiftStatus: "शिफ्ट स्थिति",
    liveNow: "अभी चालू",
    departmentFallback: "ऑपरेशन",
    activeNowLine: (department, dateLabel, timeLabel) =>
      `${department} ${dateLabel} को ${timeLabel} पर चालू है।`,
    commandHubTitle: "कमान्ड हब",
    commandHubTag: "जल्दी काम",
    assistantTitle: "सहायक",
    assistantBody: "चैट, SOP खोज और मदद खोलें।",
    readerTitle: "रीडर",
    readerBody: (latestLabel) => latestLabel || "नया अनुमोदित दस्तावेज खोलें।",
    reviewTitle: "रिव्यू कतार",
    reviewBody: "रिपोर्ट, घटना और अपील देखें।",
    searchPlaceholder: "SOP खोजें या सवाल पूछें...",
    voiceInputTitle: "आवाज से पूछें",
    voiceListeningTitle: "सुन रहा है... रोकने के लिए दबाएं",
    searchButton: "खोजें",
    recentLabel: "हाल के",
    priorityTask: "अगला जरूरी काम",
    noPriorityTask: "अगला दिया गया काम खोलें",
    noPriorityBody: "अभी कोई काम चालू नहीं है। अगला काम जारी रखने के लिए ट्रेनिंग खोलें।",
    stepLabel: (current, total, dueText) => `स्टेप ${current} / ${total}. ${dueText}.`,
    resumeTask: "काम जारी रखें",
    openTraining: "ट्रेनिंग खोलें",
    focusTitle: "आज क्या देखना है",
    focusBody: "पहले जरूरी चीजें देखें।",
    metricMandatoryCompletion: "जरूरी ट्रेनिंग पूरी",
    metricAverageAssessment: "औसत स्कोर",
    metricApprovedSops: "अनुमोदित SOP",
    metricActiveCertifications: "चालू सर्टिफिकेट",
    trainingFlow: "ट्रेनिंग फ्लो",
    mandatoryModules: "जरूरी मॉड्यूल",
    percentComplete: (value) => `${value}% पूरा`,
    noMandatoryTraining: "कोई जरूरी ट्रेनिंग बाकी नहीं है।",
    stepCount: (current, total, dueText) => `${current}/${total} स्टेप | ${dueText}`,
    urgent: "जरूरी",
    liveSignals: "लाइव संकेत",
    safetyAndReview: "सुरक्षा और रिव्यू",
    liveCount: (count) => `${count} चालू`,
    safetyAlerts: "सुरक्षा अलर्ट",
    openCount: (count) => `${count} खुले`,
    noSafetyAlerts: "कोई सक्रिय सुरक्षा अलर्ट नहीं है।",
    guardrailReview: "गार्डरेल रिव्यू",
    pendingAppeals: (count) => `${count} अपील बाकी`,
    noGuardrailReviews: "कोई गार्डरेल रिव्यू बाकी नहीं है।",
    reviewRequest: "रिव्यू अनुरोध",
    noAppealSubmitted: "कोई अपील नहीं दी गई",
    appealStatus: (status) => `अपील ${status}`,
    approvedDocuments: "अनुमोदित दस्तावेज",
    recentSops: "हाल के SOP",
    openLatest: "नया खोलें",
    noApprovedDocuments: "कोई अनुमोदित दस्तावेज उपलब्ध नहीं है।",
    updatedLabel: (dateLabel) => `अपडेट ${dateLabel}`,
  },
  HING: {
    loadingHome: "Home load ho raha hai...",
    noDueDate: "Due date nahi hai",
    dueToday: "Aaj due hai",
    daysOverdue: (days) => `${days} din late`,
    daysLeft: (days) => `${days} din baki`,
    greeting: {
      morning: {
        label: "Good morning",
        prompts: ["Shift start karo", "Pehla kaam dekho", "Aaj ke liye ready ho"],
      },
      afternoon: {
        label: "Good afternoon",
        prompts: ["Kaam flow me rakho", "Next task par dhyan do", "Queue check karte raho"],
      },
      evening: {
        label: "Good evening",
        prompts: ["Shift strong rakho", "Pending kaam dekh lo", "Kaam safe rakho"],
      },
      night: {
        label: "Good night",
        prompts: ["Live queue dekho", "Handover clean rakho", "Critical kaam check karo"],
      },
    },
    shiftStatus: "Shift status",
    liveNow: "Live",
    departmentFallback: "Operations",
    activeNowLine: (department, dateLabel, timeLabel) =>
      `${department} ${dateLabel} ko ${timeLabel} par live hai.`,
    commandHubTitle: "Command Hub",
    commandHubTag: "Quick actions",
    assistantTitle: "Assistant",
    assistantBody: "Chat, SOP search, aur help kholo.",
    readerTitle: "Reader",
    readerBody: (latestLabel) => latestLabel || "Latest approved document kholo.",
    reviewTitle: "Review queue",
    reviewBody: "Reports, incidents, aur appeals kholo.",
    searchPlaceholder: "SOP search karo ya question pucho...",
    voiceInputTitle: "Voice input",
    voiceListeningTitle: "Listening... rokne ke liye click karo",
    searchButton: "Search",
    recentLabel: "Recent",
    priorityTask: "Priority task",
    noPriorityTask: "Next assigned task kholo",
    noPriorityBody: "Abhi koi task in progress nahi hai. Next item ke liye training kholo.",
    stepLabel: (current, total, dueText) => `Step ${current} of ${total}. ${dueText}.`,
    resumeTask: "Task resume karo",
    openTraining: "Training kholo",
    focusTitle: "Aaj ka focus",
    focusBody: "Sabse pehle kya dekhna hai.",
    metricMandatoryCompletion: "Mandatory complete",
    metricAverageAssessment: "Average score",
    metricApprovedSops: "Approved SOPs",
    metricActiveCertifications: "Active certs",
    trainingFlow: "Training flow",
    mandatoryModules: "Mandatory modules",
    percentComplete: (value) => `${value}% complete`,
    noMandatoryTraining: "Koi mandatory training pending nahi hai.",
    stepCount: (current, total, dueText) => `${current}/${total} steps | ${dueText}`,
    urgent: "Urgent",
    liveSignals: "Live signals",
    safetyAndReview: "Safety aur review",
    liveCount: (count) => `${count} live`,
    safetyAlerts: "Safety alerts",
    openCount: (count) => `${count} open`,
    noSafetyAlerts: "Koi active safety alert nahi hai.",
    guardrailReview: "Guardrail review",
    pendingAppeals: (count) => `${count} appeals pending`,
    noGuardrailReviews: "Koi guardrail review wait nahi kar raha.",
    reviewRequest: "Review request",
    noAppealSubmitted: "Koi appeal submit nahi hui",
    appealStatus: (status) => `Appeal ${status}`,
    approvedDocuments: "Approved documents",
    recentSops: "Recent SOPs",
    openLatest: "Latest kholo",
    noApprovedDocuments: "Koi approved document available nahi hai.",
    updatedLabel: (dateLabel) => `Updated ${dateLabel}`,
  },
};

function localeForLanguage(language: AppLanguage) {
  return language === "ENG" ? "en-IN" : "hi-IN";
}

function formatDate(value: string | null, copy: DashboardCopy, language: AppLanguage) {
  if (!value) return copy.noDueDate;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return copy.noDueDate;
  return date.toLocaleDateString(localeForLanguage(language), {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeDue(
  value: string | null,
  copy: DashboardCopy,
) {
  if (!value) return copy.noDueDate;
  const dueAt = new Date(value);
  if (Number.isNaN(dueAt.getTime())) return copy.noDueDate;
  const diffDays = Math.ceil(
    (dueAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) return copy.daysOverdue(Math.abs(diffDays));
  if (diffDays === 0) return copy.dueToday;
  return copy.daysLeft(diffDays);
}

function severityVariant(value: string) {
  if (value === "critical" || value === "high") return "danger";
  if (value === "medium") return "warning";
  return "default";
}

function getTimeOfDayGreeting(date: Date, language: AppLanguage) {
  const hour = date.getHours();
  const languageCopy = COPY[language];
  if (hour < 12) {
    return languageCopy.greeting.morning;
  }
  if (hour < 17) {
    return languageCopy.greeting.afternoon;
  }
  if (hour < 21) {
    return languageCopy.greeting.evening;
  }
  return languageCopy.greeting.night;
}

function getGreetingPrompt(date: Date, prompts: string[]) {
  const daySeed = Math.floor(date.getTime() / (1000 * 60 * 60 * 24));
  return prompts[daySeed % prompts.length] || prompts[0] || "";
}

export default function OperatorDashboard() {
  const router = useRouter();
  const { user, language } = useAuth();
  const copy = COPY[language];
  const [searchQuery, setSearchQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [reports, setReports] = useState<ReportsPayload | null>(null);
  const [guardrail, setGuardrail] = useState<GuardrailIncidentPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      setRecentSearches(Array.isArray(parsed) ? parsed.slice(0, 4) : []);
    } catch {
      setRecentSearches([]);
    }
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem("user_id", user.id);
      localStorage.setItem("user_role", user.role);
      localStorage.setItem("language", language);
    }
  }, [user, language]);

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function loadDashboard() {
      try {
        const [dashboardResponse, reportsResponse, guardrailResponse] =
          await Promise.all([
            apiClient.get(`/api/dashboard/summary?user_id=${user.id}`),
            apiClient.get(`/api/users/${user.id}/reports`),
            apiClient.get(`/api/guardrail/incidents?user_id=${user.id}&limit=5`),
          ]);
        if (cancelled) return;
        setDashboard(dashboardResponse as DashboardPayload);
        setReports(reportsResponse as ReportsPayload);
        setGuardrail(guardrailResponse as GuardrailIncidentPayload);
        setError("");
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load operator home.",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleSearch = () => {
    const normalized = searchQuery.trim();
    if (!normalized) return;

    trackEvent("ui.query_submitted", { query: normalized });
    setRecentSearches((prev) => {
      const next = [normalized, ...prev.filter((item) => item !== normalized)].slice(0, 4);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      }
      return next;
    });
    router.push(`/operator?q=${encodeURIComponent(normalized)}`);
  };

  const handleVoiceInput = () => {
    if (
      !("webkitSpeechRecognition" in window) &&
      !("SpeechRecognition" in window)
    ) {
      alert(
        copy.voiceInputTitle === "आवाज से पूछें"
          ? "इस ब्राउज़र में आवाज से पूछना नहीं चलता। Chrome या Edge इस्तेमाल करें।"
          : copy.voiceInputTitle === "Voice input"
            ? "Voice input is not supported in your browser. Please use Chrome or Edge."
            : "Is browser me voice input support nahi hai. Chrome ya Edge use karo.",
      );
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (
        window as Window & {
          SpeechRecognition?: new () => BrowserSpeechRecognition;
          webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
        }
      ).SpeechRecognition ||
      (
        window as Window & {
          SpeechRecognition?: new () => BrowserSpeechRecognition;
          webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
        }
      ).webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = false;
    recognitionRef.current.interimResults = false;
    recognitionRef.current.lang =
      language === "HIN" ? "hi-IN" : language === "HING" ? "hi-IN" : "en-IN";

    recognitionRef.current.onstart = () => setIsListening(true);
    recognitionRef.current.onend = () => setIsListening(false);
    recognitionRef.current.onresult = (event: {
      results: { transcript: string }[][];
    }) => {
      const transcript = event.results[0][0].transcript;
      setSearchQuery(transcript);
      setIsListening(false);
    };

    recognitionRef.current.start();
  };

  const featuredAssignment = useMemo(() => {
    return (
      dashboard?.mandatory_training.find((item) => item.status === "in_progress") ||
      dashboard?.mandatory_training.find((item) => item.status === "assigned") ||
      null
    );
  }, [dashboard?.mandatory_training]);

  const incompleteMandatory = useMemo(
    () =>
      (dashboard?.mandatory_training || [])
        .filter((item) => item.is_mandatory && item.status !== "completed")
        .slice(0, 4),
    [dashboard?.mandatory_training],
  );

  const latestSop = dashboard?.recent_sops[0] || null;
  const safetyPreview = (dashboard?.safety_alerts || []).slice(0, 2);
  const guardrailPreview = (guardrail?.incidents || []).slice(0, 2);
  const totalSignals =
    (dashboard?.safety_alerts.length || 0) + (guardrail?.summary.total || 0);

  const greetingNow = useMemo(() => new Date(), []);
  const greetingProfile = useMemo(
    () => getTimeOfDayGreeting(greetingNow, language),
    [greetingNow, language],
  );
  const greetingPrompt = useMemo(
    () => getGreetingPrompt(greetingNow, greetingProfile.prompts),
    [greetingNow, greetingProfile.prompts],
  );
  const greetingName = dashboard?.user.full_name || user?.name || "Operator";
  const currentTimeLabel = useMemo(
    () =>
      greetingNow.toLocaleTimeString(localeForLanguage(language), {
        hour: "numeric",
        minute: "2-digit",
      }),
    [greetingNow, language],
  );
  const currentDateLabel = useMemo(
    () =>
      greetingNow.toLocaleDateString(localeForLanguage(language), {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    [greetingNow, language],
  );

  return (
    <OperatorLayout>
      <div className="mx-auto max-w-[1520px] px-4 py-6 space-y-6">
        {isLoading ? (
          <Card>
            <div className="py-12 text-center text-muted">
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <p>{copy.loadingHome}</p>
            </div>
          </Card>
        ) : error ? (
          <Card>
            <div className="py-6 text-center">
              <p className="font-medium text-danger">{error}</p>
            </div>
          </Card>
        ) : dashboard ? (
          <>
            <div className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,#fbfcfe_0%,#f3f6fa_100%)] px-6 py-7 shadow-[0_18px_44px_rgba(0,25,168,0.06)]">
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute right-[-6%] top-[-10%] h-72 w-72 rounded-full border border-primary/8" />
                <div className="absolute right-[6%] top-[18%] h-44 w-44 rounded-full border border-warning/15" />
              </div>

              <div className="relative z-10 mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-3xl">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">
                    {copy.shiftStatus}
                  </p>
                  <h1 className="mt-2 text-[2.7rem] font-extrabold tracking-[-0.04em] text-foreground">
                    {greetingProfile.label}, <span className="text-primary">{greetingName}</span>
                  </h1>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
                    {greetingPrompt}.{" "}
                    {copy.activeNowLine(
                      dashboard.user.department || copy.departmentFallback,
                      currentDateLabel,
                      currentTimeLabel,
                    )}
                  </p>
                </div>
                <Badge variant="success" size="sm" className="h-fit rounded-full px-4 py-2">
                  {copy.liveNow}
                </Badge>
              </div>

              <div className="relative z-10 grid gap-6 lg:grid-cols-[1.55fr_0.82fr]">
                <div className="rounded-[28px] bg-white px-6 py-6 shadow-[0_40px_60px_-15px_rgba(0,13,110,0.06)]">
                  <div className="mb-8 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold tracking-[-0.03em] text-foreground">
                        {copy.commandHubTitle}
                      </h2>
                      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                        {copy.commandHubTag}
                      </p>
                    </div>
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-[14px] bg-primary/6 text-primary">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M7 4v16M17 4v16M4 17h16" />
                      </svg>
                    </span>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <button
                      onClick={() => router.push("/operator")}
                      className="rounded-[22px] bg-[#f3f5f8] px-5 py-5 text-left transition-colors hover:bg-[#eceff4]"
                    >
                      <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-[14px] bg-white text-primary shadow-sm">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l4 4m0 0l-4-4m4 4V11m-8 8a7 7 0 110-14 7 7 0 010 14z" />
                        </svg>
                      </div>
                      <p className="text-base font-semibold text-foreground">{copy.assistantTitle}</p>
                      <p className="mt-2 text-xs leading-5 text-muted">{copy.assistantBody}</p>
                    </button>

                    <button
                      onClick={() =>
                        latestSop
                          ? router.push(`/operator/reader/${latestSop.revision_id}?page=1`)
                          : router.push("/operator")
                      }
                      className="rounded-[22px] bg-[#f3f5f8] px-5 py-5 text-left transition-colors hover:bg-[#eceff4]"
                    >
                      <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-[14px] bg-white text-primary shadow-sm">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586A1 1 0 0113.293 3.293l4.414 4.414A1 1 0 0118 8.414V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <p className="text-base font-semibold text-foreground">{copy.readerTitle}</p>
                      <p className="mt-2 text-xs leading-5 text-muted">
                        {copy.readerBody(
                          latestSop
                            ? `${latestSop.code} | ${latestSop.revision_label}`
                            : null,
                        )}
                      </p>
                    </button>

                    <button
                      onClick={() => router.push("/operator/reports?tab=guardrails")}
                      className="rounded-[22px] bg-[#f3f5f8] px-5 py-5 text-left transition-colors hover:bg-[#eceff4]"
                    >
                      <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-[14px] bg-white text-primary shadow-sm">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-6m3 6V7m3 10v-3m3 7H6a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <p className="text-base font-semibold text-foreground">{copy.reviewTitle}</p>
                      <p className="mt-2 text-xs leading-5 text-muted">{copy.reviewBody}</p>
                    </button>
                  </div>

                  <div className="mt-6 rounded-[20px] bg-[#f7f9fc] px-4 py-4">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          placeholder={copy.searchPlaceholder}
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                          className="w-full rounded-[16px] border border-white bg-white px-4 py-3 pr-12 text-foreground placeholder-muted shadow-sm focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/15"
                        />
                        <button
                          onClick={handleVoiceInput}
                          className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-[12px] p-2 transition-all ${
                            isListening
                              ? "bg-danger text-white animate-pulse"
                              : "text-muted hover:bg-primary/8 hover:text-primary"
                          }`}
                          title={
                            isListening
                              ? copy.voiceListeningTitle
                              : copy.voiceInputTitle
                          }
                        >
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          </svg>
                        </button>
                      </div>
                      <Button variant="primary" onClick={handleSearch} className="rounded-full px-6">
                        {copy.searchButton}
                      </Button>
                    </div>

                    {recentSearches.length > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                          {copy.recentLabel}
                        </span>
                        {recentSearches.map((search, idx) => (
                          <button
                            key={`${search}-${idx}`}
                            onClick={() => setSearchQuery(search)}
                            className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:text-primary"
                          >
                            {search}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-col justify-between rounded-[28px] bg-[linear-gradient(180deg,#0019a8_0%,#000d6e_100%)] px-6 py-6 text-white shadow-[0_26px_54px_rgba(0,25,168,0.24)]">
                  <div>
                    <div className="mb-8 flex items-center justify-between">
                      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/65">
                        {copy.priorityTask}
                      </span>
                      <svg className="h-5 w-5 text-white/75" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h2 className="max-w-xs text-[2rem] font-extrabold leading-[1.05] tracking-[-0.04em]">
                      {featuredAssignment ? featuredAssignment.module_title : copy.noPriorityTask}
                    </h2>
                    <p className="mt-4 text-sm leading-6 text-white/72">
                      {featuredAssignment
                        ? copy.stepLabel(
                            featuredAssignment.current_step || 1,
                            featuredAssignment.total_steps || 0,
                            formatRelativeDue(featuredAssignment.due_at, copy),
                          )
                        : copy.noPriorityBody}
                    </p>
                  </div>

                  <Button
                    variant="secondary"
                    onClick={() =>
                      router.push(
                        featuredAssignment
                          ? `/operator/training/${featuredAssignment.module_id}`
                          : "/operator/training",
                      )
                    }
                    className="mt-8 rounded-full bg-white text-primary hover:bg-[#dfe6ff]"
                  >
                    {featuredAssignment ? copy.resumeTask : copy.openTraining}
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[0.72fr_1.28fr]">
              <div className="rounded-[28px] bg-white px-6 py-6 shadow-[0_16px_34px_rgba(0,25,168,0.05)]">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#795900]">
                  {copy.focusTitle}
                </p>
                <p className="mt-5 text-xl leading-tight text-foreground">
                  {copy.focusBody}
                </p>
                <div className="mt-6 h-px w-20 bg-[#795900]" />
              </div>

              <div className="relative overflow-hidden rounded-[28px] bg-white px-6 py-6 shadow-[0_16px_34px_rgba(0,25,168,0.05)]">
                <div className="pointer-events-none absolute inset-0 opacity-[0.08]">
                  <div className="absolute left-[23%] top-0 h-full w-px bg-primary" />
                  <div className="absolute left-[52%] top-0 h-full w-px bg-primary" />
                  <div className="absolute left-[78%] top-0 h-full w-px bg-primary" />
                  <div className="absolute left-0 top-1/2 h-px w-full bg-primary" />
                </div>
                <div className="relative grid grid-cols-2 gap-6 md:grid-cols-4">
                  <div>
                    <p className="font-mono text-3xl font-bold text-primary">
                      {dashboard.stats.mandatory_completion_rate}%
                    </p>
                    <p className="mt-2 text-xs text-muted">{copy.metricMandatoryCompletion}</p>
                  </div>
                  <div>
                    <p className="font-mono text-3xl font-bold text-primary">
                      {Math.round(reports?.stats.average_score || 0)}%
                    </p>
                    <p className="mt-2 text-xs text-muted">{copy.metricAverageAssessment}</p>
                  </div>
                  <div>
                    <p className="font-mono text-3xl font-bold text-primary">
                      {dashboard.recent_sops.length}
                    </p>
                    <p className="mt-2 text-xs text-muted">{copy.metricApprovedSops}</p>
                  </div>
                  <div>
                    <p className="font-mono text-3xl font-bold text-primary">
                      {reports?.stats.active_certifications || 0}
                    </p>
                    <p className="mt-2 text-xs text-muted">{copy.metricActiveCertifications}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-[28px] bg-[#f3f4f5] p-6 shadow-[0_16px_34px_rgba(0,25,168,0.05)]">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                      {copy.trainingFlow}
                    </p>
                    <h3 className="mt-2 text-xl font-bold tracking-[-0.03em] text-foreground">
                      {copy.mandatoryModules}
                    </h3>
                  </div>
                  <span className="text-sm font-semibold text-primary">
                    {copy.percentComplete(dashboard.stats.mandatory_completion_rate)}
                  </span>
                </div>
                <div className="space-y-3">
                  {incompleteMandatory.length === 0 ? (
                    <div className="rounded-[22px] bg-white px-5 py-5 text-sm text-muted shadow-sm">
                      {copy.noMandatoryTraining}
                    </div>
                  ) : (
                    incompleteMandatory.slice(0, 3).map((item) => (
                      <Link key={item.assignment_id} href={`/operator/training/${item.module_id}`}>
                        <div className="rounded-[22px] bg-white px-5 py-5 shadow-sm transition-transform hover:-translate-y-0.5">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-base font-semibold text-foreground">
                                {item.module_title}
                              </p>
                              <p className="mt-1 text-xs text-muted">
                                {copy.stepCount(
                                  item.current_step || 1,
                                  item.total_steps || 0,
                                  formatRelativeDue(item.due_at, copy),
                                )}
                              </p>
                            </div>
                            {(item.criticality?.toLowerCase() === "high" ||
                              formatRelativeDue(item.due_at, copy).includes("लेट") ||
                              formatRelativeDue(item.due_at, copy).includes("late") ||
                              formatRelativeDue(item.due_at, copy).includes("overdue")) ? (
                              <Badge variant="danger" size="sm">
                                {copy.urgent}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-4 flex items-center gap-4">
                            <ProgressBar
                              value={Number(item.progress_percent || 0)}
                              showLabel={false}
                              color="bg-primary"
                              height="h-1.5"
                              className="flex-1"
                            />
                            <span className="font-mono text-[11px] text-muted">
                              {Math.round(Number(item.progress_percent || 0))}%
                            </span>
                          </div>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-[28px] bg-[#f3f4f5] p-6 shadow-[0_16px_34px_rgba(0,25,168,0.05)]">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                      {copy.liveSignals}
                    </p>
                    <h3 className="mt-2 text-xl font-bold tracking-[-0.03em] text-foreground">
                      {copy.safetyAndReview}
                    </h3>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted shadow-sm">
                    {copy.liveCount(totalSignals)}
                  </span>
                </div>
                <div className="grid gap-4">
                  <div className="rounded-[22px] bg-white px-5 py-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <p className="text-sm font-semibold text-foreground">{copy.safetyAlerts}</p>
                      <span className="text-xs text-muted">{copy.openCount(dashboard.safety_alerts.length)}</span>
                    </div>
                    {safetyPreview.length === 0 ? (
                      <p className="text-sm text-muted">{copy.noSafetyAlerts}</p>
                    ) : (
                      <div className="space-y-3">
                        {safetyPreview.map((alert) => (
                          <div key={alert.chunk_id} className="rounded-[16px] bg-[#f7f9fc] px-4 py-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-foreground">{alert.document_title}</p>
                              <Badge variant={severityVariant(alert.severity) as "danger" | "warning" | "default"} size="sm">
                                {alert.severity}
                              </Badge>
                            </div>
                            <p className="mt-2 text-xs leading-5 text-muted">
                              {alert.alert_text}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-[22px] bg-white px-5 py-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <p className="text-sm font-semibold text-foreground">{copy.guardrailReview}</p>
                      <span className="text-xs text-muted">
                        {copy.pendingAppeals(guardrail?.summary.pending_appeals || 0)}
                      </span>
                    </div>
                    {guardrailPreview.length === 0 ? (
                      <p className="text-sm text-muted">{copy.noGuardrailReviews}</p>
                    ) : (
                      <div className="space-y-3">
                        {guardrailPreview.map((incident) => (
                          <div key={incident.incident_id} className="rounded-[16px] bg-[#f7f9fc] px-4 py-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-foreground">
                                {incident.query_excerpt || copy.reviewRequest}
                              </p>
                              <Badge variant={incident.severity === "high" ? "danger" : "warning"} size="sm">
                                {incident.severity}
                              </Badge>
                            </div>
                            <p className="mt-2 text-xs text-muted">
                              {incident.appeal
                                ? copy.appealStatus(incident.appeal.status)
                                : copy.noAppealSubmitted}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] bg-white px-6 py-6 shadow-[0_16px_34px_rgba(0,25,168,0.05)]">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                    {copy.approvedDocuments}
                  </p>
                  <h3 className="mt-2 text-xl font-bold tracking-[-0.03em] text-foreground">
                    {copy.recentSops}
                  </h3>
                </div>
                {latestSop ? (
                  <button
                    onClick={() => router.push(`/operator/reader/${latestSop.revision_id}?page=1`)}
                    className="rounded-full bg-primary/8 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-primary transition-colors hover:bg-primary/12"
                  >
                    {copy.openLatest}
                  </button>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {dashboard.recent_sops.length === 0 ? (
                  <div className="rounded-[22px] bg-[#f3f4f5] px-5 py-5 text-sm text-muted">
                    {copy.noApprovedDocuments}
                  </div>
                ) : (
                  dashboard.recent_sops.slice(0, 4).map((sop) => (
                    <Link
                      key={sop.revision_id}
                      href={`/operator/reader/${sop.revision_id}?page=1`}
                      className="rounded-[22px] bg-[#f3f4f5] px-5 py-5 transition-colors hover:bg-[#eceff4]"
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span className="rounded-full bg-white px-2.5 py-1 font-mono text-[11px] font-semibold text-primary shadow-sm">
                          {sop.code}
                        </span>
                        <span className="text-xs text-muted">{sop.revision_label}</span>
                      </div>
                      <p className="text-base font-semibold text-foreground">{sop.title}</p>
                      <p className="mt-2 text-xs text-muted">
                        {copy.updatedLabel(formatDate(sop.updated_at, copy, language))}
                      </p>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </OperatorLayout>
  );
}
