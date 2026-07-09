"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL, apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { VoiceMicButton, VoiceMicSubmitPayload } from "@/components/ui/voice-mic-button";
import { useStreamingTTS } from "@/lib/useStreamingTTS";
import {
  useGuideIntelligence,
  useOperatorMode,
  useSpeculativeNextStep,
  useUniversalVoiceCommand,
  riskColor,
  riskLabel,
  timingColor,
} from "@/lib/useGuideIntelligence";

type RunGuideStep = {
  id: number;
  instruction: string;
  citation?: string;
  citationLabel?: string;
  expectedState?: string;
  riskLevel?: "low" | "medium" | "high";
  estimatedSeconds?: number;
  category?: string;
};

type RunGuideProps = {
  equipment: string;
  task: string;
  totalSteps: number;
  currentStep: number;
  prerequisites: {
    authorization: boolean;
    ppe: boolean;
    permit_isolation: boolean;
    area_safe: boolean;
  };
  steps: RunGuideStep[];
  language?: "en" | "hi" | "hing";
  onStopCondition?: () => void;
  onConfirmStep?: (stepIndex: number) => void;
  onConfirmPrerequisite?: (key: string) => void;
  onSupervisorHelp?: () => void;
  onNewGuide?: () => void;
  onStartGuide?: () => void;
  operatorName?: string;
  shift?: string;
};

type Evidence = {
  document_id?: string;
  document_code?: string;
  document_title?: string;
  revision_id?: string;
  page_start?: number;
  page_end?: number;
  content?: string;
  citation_label?: string;
  section_title?: string;
};

type OperationGuideResponse = {
  answer: string;
  mode: "run" | "learn" | "clarify" | "blocked";
  next_actions: string[];
  state: {
    phase?: string;
    mode?: string;
    equipment?: string;
    task?: string;
    step_index?: number;
    prerequisites?: Record<string, boolean>;
    stop_conditions?: string[];
    started_at?: string;
    completed_at?: string;
    completion_record_id?: string;
    handoff_id?: string;
    requires_supervisor?: boolean;
    [key: string]: unknown;
  };
  state_label: string | null;
  step_index: number | null;
  requires_supervisor: boolean;
  completion_record_id: string | null;
  confidence: number;
  latency_ms: number;
  retrieval_event_id: string | null;
  conversation_id: string | null;
  evidence: Evidence[];
  diagnostics: Record<string, unknown>;
};

const PREREQUISITES = [
  { key: "authorization", label: "Authorization confirmed", desc: "Signed permit-to-work approved by shift supervisor", icon: "shield" as const },
  { key: "ppe", label: "Required PPE verified", desc: "Helmet, goggles, gloves, safety boots, and vest inspected", icon: "helmet" as const },
  { key: "permit_isolation", label: "Permit / isolation complete", desc: "LOTO (Lock-Out Tag-Out) verified, energy sources isolated", icon: "lock" as const },
  { key: "area_safe", label: "Area clear and safe", desc: "No unauthorized personnel, spills cleared, ventilation confirmed", icon: "checkmark" as const },
];

const STEP_KEYWORDS: Record<number, string> = {
  1: "prime pump",
  2: "check suction",
  3: "fuel valve ON",
  4: "set throttle",
  5: "set choke",
  6: "engine switch ON",
  7: "pull starter",
  8: "warm up check",
  9: "final verification",
};

type GuidePhase = "landing" | "task_selection" | "prerequisite_checks" | "running" | "supervisor_handoff" | "completed" | "blocked";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function ShieldIcon({ size = 16 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M12 2L20 6V12C20 16.4 16.4 20.4 12 22C7.6 20.4 4 16.4 4 12V6L12 2Z" fill="currentColor"/><path d="M10 12L12 14L16 10" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
function HelmetIcon({ size = 16 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M4 18H20V20H4V18Z" fill="currentColor"/><path d="M12 2C8 2 4 5 4 10V14H20V10C20 5 16 2 12 2Z" fill="currentColor"/><path d="M6 14V10C6 6.5 8.7 4 12 4C15.3 4 18 6.5 18 10V14" stroke="white" strokeWidth="1.5"/></svg>);
}
function LockIcon({ size = 16 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V7C8 4.8 9.8 3 12 3C14.2 3 16 4.8 16 7V11" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="16" r="1.5" fill="white"/></svg>);
}
function CheckmarkIcon({ size = 16 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8 12L11 15L16 9" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
function WarningIcon({ size = 18 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M12 2L2 20H22L12 2Z" fill="currentColor"/><path d="M12 9V13" stroke="white" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="17" r="1" fill="white"/></svg>);
}
function ChevronDownIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
function ChevronUpIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 15L12 9L6 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
function PhoneIcon({ size = 16 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M22 16.92V19.92C22 20.48 21.56 20.93 21 20.97C20.67 21 20.34 21 20 21C10.61 21 3 13.39 3 4C3 3.66 3 3.33 3.03 3C3.07 2.44 3.52 2 4.08 2H7.08C7.56 2 7.97 2.34 8.06 2.82C8.14 3.27 8.3 3.71 8.54 4.11L6.81 5.84C6.59 6.06 6.53 6.39 6.65 6.68C7.09 7.74 7.85 8.68 8.84 9.35L10.59 7.6C10.99 7.84 11.43 8 11.88 8.06C12.36 8.15 12.7 8.56 12.7 9.04V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
function PlayIcon({ size = 16 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M5 3L19 12L5 21V3Z" fill="currentColor"/></svg>);
}
function DocumentIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="currentColor" opacity="0.2"/><path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 13H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M8 17H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>);
}
function CameraIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M23 19C23 20.1 22.1 21 21 21H3C1.9 21 1 20.1 1 19V8C1 6.9 1.9 6 3 6H7L9 4H15L17 6H21C22.1 6 23 6.9 23 8V19Z" fill="currentColor" opacity="0.2"/><path d="M23 19C23 20.1 22.1 21 21 21H3C1.9 21 1 20.1 1 19V8C1 6.9 1.9 6 3 6H7L9 4H15L17 6H21C22.1 6 23 6.9 23 8V19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="2"/></svg>);
}
function CloseIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
function VerifyIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M1 12L5 16L13 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M21 12L17 16L13 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4"/></svg>);
}
function PassIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#16a34a"/><path d="M8 12L11 15L16 9" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
function FailIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#dc2626"/><path d="M15 9L9 15M9 9L15 15" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>);
}
function UncertainIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#d97706"/><path d="M12 8V12" stroke="white" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="16" r="1" fill="white"/></svg>);
}
function NewGuideIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>);
}
function ClockIcon({ size = 14 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/><path d="M12 7V12L15 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>);
}
function EmergencyIcon({ size = 20 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M12 2L2 20H22L12 2Z" fill="#dc2626"/><path d="M12 9V14" stroke="white" strokeWidth="2.5" strokeLinecap="round"/><circle cx="12" cy="17.5" r="1.5" fill="white"/></svg>);
}
function CheckCircleIcon({ size = 48 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#16a34a" strokeWidth="2"/><path d="M8 12L11 15L16 9" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
function FlagIcon({ size = 16 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M4 22V4H12L14 8H22V18H12L10 14H4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
function FireIcon({ size = 16 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M12 22C7.58 22 4 18.42 4 14C4 9.58 8 5 12 2C16 5 20 9.58 20 14C20 18.42 16.42 22 12 22Z" fill="currentColor" opacity="0.3"/><path d="M12 22C9.24 22 7 19.76 7 17C7 13 12 8 12 8C12 8 17 13 17 17C17 19.76 14.76 22 12 22Z" fill="currentColor"/></svg>);
}
function PumpIcon() {
  return (<svg width="44" height="44" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="18" stroke="#0019a8" strokeWidth="2" opacity="0.3"/><circle cx="24" cy="24" r="12" stroke="#0019a8" strokeWidth="2"/><path d="M18 24H30M24 18V30" stroke="#0019a8" strokeWidth="2.5" strokeLinecap="round"/><circle cx="24" cy="24" r="3" fill="#0019a8"/></svg>);
}
function ValveIcon() {
  return (<svg width="44" height="44" viewBox="0 0 48 48" fill="none"><rect x="8" y="18" width="32" height="12" rx="4" stroke="#0019a8" strokeWidth="2"/><path d="M24 10V18" stroke="#0019a8" strokeWidth="2.5" strokeLinecap="round"/><circle cx="24" cy="8" r="3" stroke="#0019a8" strokeWidth="2"/><rect x="14" y="22" width="20" height="4" rx="2" fill="#0019a8" opacity="0.3"/></svg>);
}
function GaugeIcon() {
  return (<svg width="44" height="44" viewBox="0 0 48 48" fill="none"><path d="M6 32C6 18.74 14.74 8 24 8C33.26 8 42 18.74 42 32" stroke="#0019a8" strokeWidth="2" strokeLinecap="round"/><circle cx="24" cy="32" r="3" fill="#0019a8"/><path d="M24 32L34 18" stroke="#0019a8" strokeWidth="2.5" strokeLinecap="round"/><circle cx="12" cy="30" r="1.5" fill="#0019a8" opacity="0.4"/><circle cx="24" cy="14" r="1.5" fill="#0019a8" opacity="0.4"/><circle cx="36" cy="30" r="1.5" fill="#0019a8" opacity="0.4"/></svg>);
}
function MotorIcon() {
  return (<svg width="44" height="44" viewBox="0 0 48 48" fill="none"><rect x="10" y="16" width="28" height="16" rx="4" stroke="#0019a8" strokeWidth="2"/><circle cx="24" cy="24" r="5" stroke="#0019a8" strokeWidth="2"/><path d="M24 19V22M24 26V29" stroke="#0019a8" strokeWidth="1.5" strokeLinecap="round"/><rect x="38" y="20" width="6" height="8" rx="1" fill="#0019a8" opacity="0.3"/></svg>);
}
function TankIcon() {
  return (<svg width="44" height="44" viewBox="0 0 48 48" fill="none"><rect x="10" y="12" width="28" height="28" rx="6" stroke="#0019a8" strokeWidth="2"/><path d="M10 28H38" stroke="#0019a8" strokeWidth="2" opacity="0.3"/><path d="M14 24V28M20 22V28M28 20V28M34 24V28" stroke="#0019a8" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/><rect x="20" y="6" width="8" height="6" rx="2" stroke="#0019a8" strokeWidth="1.5"/></svg>);
}
function ChecklistIcon({ size = 20 }: { size?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2"/><path d="M7 8L9 10L13 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M7 14H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M7 18H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>);
}
function ArrowRightIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12H19M19 12L14 7M19 12L14 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
function SpeakerPlayIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2V15H6L11 19V5Z" fill="currentColor"/><path d="M15.54 8.46C16.48 9.4 17 10.67 17 12C17 13.33 16.48 14.6 15.54 15.54" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>);
}
function SpeakerStopIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2V15H6L11 19V5Z" fill="currentColor"/><rect x="16" y="10" width="5" height="4" rx="1" fill="currentColor"/></svg>);
}
function HistoryIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0019a8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>);
}

const EQUIPMENT_CARDS = [
  { id: "centrifugal pump", label: "Centrifugal Pump", Icon: PumpIcon, tasks: ["startup", "Prime & Start", "Routine Inspection", "Shutdown Procedure"] },
  { id: "valve", label: "Valve", Icon: ValveIcon, tasks: ["open/close", "Leak Test", "Maintenance Isolation"] },
  { id: "gauge", label: "Gauge / Instrument", Icon: GaugeIcon, tasks: ["calibration", "Reading Verification", "Alarm Test"] },
  { id: "motor", label: "Motor / Engine", Icon: MotorIcon, tasks: ["cold start", "Load Test", "Emergency Shutdown"] },
  { id: "tank", label: "Tank / Vessel", Icon: TankIcon, tasks: ["fill", "Level Check", "Drain & Clean"] },
];

function ProgressRing({ progress, size = 56, strokeWidth = 4, color = "#0019a8" }: { progress: number; size?: number; strokeWidth?: number; color?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rg-progress-ring">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.22} fontWeight="700" fill={color}>{Math.round(progress)}%</text>
    </svg>
  );
}

function StepDiagram({ equipmentName }: { equipmentName?: string }) {
  const lower = (equipmentName || "").toLowerCase();
  if (lower.includes("pump")) return <PumpIcon />;
  if (lower.includes("valve")) return <ValveIcon />;
  if (lower.includes("gauge") || lower.includes("instrument")) return <GaugeIcon />;
  if (lower.includes("motor") || lower.includes("engine")) return <MotorIcon />;
  if (lower.includes("tank") || lower.includes("vessel")) return <TankIcon />;
  return <PumpIcon />;
}

export function RunGuide({
  equipment,
  task,
  totalSteps,
  currentStep,
  prerequisites: _prerequisites,
  steps: _stepsProp,
  language: languageProp,
  onStopCondition,
  onConfirmStep: _onConfirmStep,
  onConfirmPrerequisite: _onConfirmPrerequisite,
  onSupervisorHelp,
  onNewGuide,
  onStartGuide: _onStartGuide,
  operatorName,
  shift,
}: RunGuideProps) {
  const { user, language: appLanguage } = useAuth();
  const userId = user?.id || null;

  const [phase, setPhase] = useState<GuidePhase>("landing");
  const [serverResponse, setServerResponse] = useState<OperationGuideResponse | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    observation: string;
    compliance: string;
    risks: string[];
    recommended_action: string;
  } | null>(null);
  const [lastVoiceCommand, setLastVoiceCommand] = useState<string | null>(null);
  const [stepTimers, setStepTimers] = useState<Record<number, number>>({});
  const [elapsedTotal, setElapsedTotal] = useState(0);
  const [showEmergency, setShowEmergency] = useState(false);
  const [verifiedSteps, setVerifiedSteps] = useState<Set<number>>(new Set());
  const [selectedEquipment, setSelectedEquipment] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [operatorNotes, setOperatorNotes] = useState<Record<number, string>>({});
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [notesSavedAt, setNotesSavedAt] = useState<number | null>(null);
  const streamingTts = useStreamingTTS();
  const { intelligence, updateFromServerResponse } = useGuideIntelligence();
  const { preview: nextPreview, prefetch: prefetchNext, clear: clearPreview, isPrefetching } = useSpeculativeNextStep();
  const { parse: parseVoiceCommand } = useUniversalVoiceCommand();
  const [operatorMode, setOperatorMode] = useOperatorMode();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef<GuidePhase>("landing");

  const apiLanguage = languageProp || (appLanguage === "HIN" ? "hi" : appLanguage === "HING" ? "hing" : "en");
  const statePrereqs = useMemo(
    () => serverResponse?.state?.prerequisites || {},
    [serverResponse?.state?.prerequisites],
  );
  const prereqBool = useCallback((k: string) => Boolean(statePrereqs[k]), [statePrereqs]);
  const completedPrechecks = PREREQUISITES.filter((p) => prereqBool(p.key)).length;
  const totalPrechecks = PREREQUISITES.length;
  const allPrechecksComplete = completedPrechecks === totalPrechecks;
  const liveEquipment = serverResponse?.state?.equipment || equipment || "equipment";
  const liveTask = serverResponse?.state?.task || task || "task";
  const liveStepIndex = serverResponse?.step_index || currentStep || 0;
  const progressPercent = totalSteps > 0 ? Math.round((liveStepIndex / totalSteps) * 100) : 0;
const currentInstruction = serverResponse?.answer || "";
  const isTtsPlaying = streamingTts.state === "loading" || streamingTts.state === "playing";

  const ttsLanguage = apiLanguage === "hi" || apiLanguage === "hing" ? "hi-IN" : "en-IN";
  const instructionTts = useCallback(
    (text: string) => streamingTts.play(text, ttsLanguage, "suhani"),
    [streamingTts, ttsLanguage],
  );

  useEffect(() => {
    if (!serverResponse?.answer || phase !== "running") return;
    streamingTts.stop();
    const answer = serverResponse.answer;
    const timeout = window.setTimeout(() => {
      instructionTts(answer);
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [serverResponse?.answer, phase, streamingTts, instructionTts]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!serverResponse) return;
    const nextPhase = (serverResponse.state.phase as GuidePhase) || "landing";
    setPhase(nextPhase);
    if (serverResponse.conversation_id) {
      setConversationId(serverResponse.conversation_id);
    }
  }, [serverResponse]);

  useEffect(() => {
    if (!userId) return;
    if (phase !== "running") {
      clearPreview();
      return;
    }
    if (!serverResponse?.state?.equipment) return;
    if (operatorMode === "novice" || operatorMode === "standard") {
      const hint = `${serverResponse.state.equipment} step ${liveStepIndex + 1}`;
      void prefetchNext(userId, conversationId, hint, apiLanguage);
    }
  }, [phase, liveStepIndex, serverResponse, userId, conversationId, apiLanguage, operatorMode, prefetchNext, clearPreview]);

  useEffect(() => {
    if (phase === "running" && liveStepIndex > 0) {
      if (!timerRef.current) {
        timerRef.current = setInterval(() => {
          setElapsedTotal((t) => t + 1);
          setStepTimers((prev) => {
            const next = { ...prev };
            next[liveStepIndex] = (next[liveStepIndex] || 0) + 1;
            return next;
          });
        }, 1000);
      }
    }
    if (phase === "completed" && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current && phaseRef.current !== "running") {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [phase, liveStepIndex]);

  const callGuide = useCallback(
    async (query: string, intentOverride?: "run" | "learn") => {
      if (!userId) {
        setError("You must be signed in to use the run guide.");
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const body: Record<string, unknown> = {
          query,
          language: apiLanguage,
          role: "operator",
          user_id: userId,
          chat_scope: "guided",
        };
        if (conversationId) body.conversation_id = conversationId;
        if (intentOverride) body.intent = intentOverride;

        const res = (await apiClient.post("/api/operation-guide", body)) as OperationGuideResponse;
        setServerResponse(res);
        updateFromServerResponse(res);
        if (res.conversation_id) setConversationId(res.conversation_id);
        if (res.state?.prerequisites) {
          setOperatorNotes((prev) => ({ ...prev }));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to reach run guide backend";
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [apiLanguage, conversationId, updateFromServerResponse, userId],
  );

  const handleStartGuide = useCallback(async () => {
    if (!selectedEquipment || !selectedTask) return;
    const query = `${selectedTask} ${selectedEquipment}`;
    await callGuide(query, "run");
  }, [callGuide, selectedEquipment, selectedTask]);

  const handleNextAction = useCallback(
    async (action: string) => {
      await callGuide(action);
    },
    [callGuide],
  );

  const handleConfirmStep = useCallback(
    async (stepNum: number) => {
      setVerifiedSteps((prev) => new Set(prev).add(stepNum));
      await callGuide(`Step ${stepNum} clear`);
    },
    [callGuide],
  );

  const handleConfirmPrerequisite = useCallback(
    async (key: string) => {
      const labelMap: Record<string, string> = {
        authorization: "authorization confirmed",
        ppe: "PPE verified",
        permit_isolation: "permit and isolation complete",
        area_safe: "area clear and safe",
      };
      await callGuide(labelMap[key] || `${key} OK`);
    },
    [callGuide],
  );

  const handleStopCondition = useCallback(async () => {
    onStopCondition?.();
    await callGuide("stop guide");
  }, [callGuide, onStopCondition]);

  const handleSupervisorHelp = useCallback(async () => {
    onSupervisorHelp?.();
    await callGuide("supervisor help");
  }, [callGuide, onSupervisorHelp]);

  const handleAllChecksClear = useCallback(async () => {
    await callGuide("all checks clear");
  }, [callGuide]);

  const handleNewGuide = useCallback(() => {
    setServerResponse(null);
    setConversationId(null);
    setSelectedEquipment(null);
    setSelectedTask(null);
    setVerifiedSteps(new Set());
    setStepTimers({});
    setElapsedTotal(0);
    setOperatorNotes({});
    setNoteDraft("");
    setNotesSavedAt(null);
    setVerificationResult(null);
    setImageFile(null);
    setImagePreview(null);
    setError(null);
    setPhase("landing");
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    onNewGuide?.();
  }, [onNewGuide]);

  const handleVerifyImage = useCallback(async () => {
    if (!imageFile) return;
    setIsVerifying(true);
    setVerificationResult(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error("Could not read file"));
        r.readAsDataURL(imageFile);
      });
      const base64 = dataUrl.split(",")[1] || "";
      const res = await fetch(`${API_BASE_URL}/api/operation-guide/verify-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          image_base64: base64,
          mime_type: imageFile.type || "image/jpeg",
          checkpoint_instruction: serverResponse?.answer || liveEquipment,
          stop_conditions: serverResponse?.state?.stop_conditions || [],
          conversation_id: conversationId,
        }),
      });
      const data = await res.json();
      setVerificationResult(data);
      if (data.compliance === "pass") {
        setVerifiedSteps((prev) => new Set(prev).add(liveStepIndex));
      }
    } catch {
      setVerificationResult({
        observation: "Verification failed. Proceed with manual check.",
        compliance: "uncertain",
        risks: [],
        recommended_action: "Continue with manual verification.",
      });
    } finally {
      setIsVerifying(false);
    }
  }, [imageFile, serverResponse, liveEquipment, liveStepIndex, conversationId]);

  const handleSaveNote = useCallback(
    async (stepNum: number) => {
      const note = noteDraft.trim();
      if (!note || !userId) return;
      const updated = { ...operatorNotes, [stepNum]: note };
      setOperatorNotes(updated);
      setNoteDraft("");
      setNotesSavedAt(Date.now());
      try {
        await apiClient.post("/api/operation-guide", {
          query: `note step ${stepNum}: ${note}`,
          language: apiLanguage,
          role: "operator",
          user_id: userId,
          conversation_id: conversationId,
          chat_scope: "guided",
          intent: "run",
        });
      } catch {
        // Note is kept locally; backend may not support free-text notes.
      }
    },
    [noteDraft, operatorNotes, userId, apiLanguage, conversationId],
  );

  const handleRunGuideVoice = useCallback(
    async (payload: VoiceMicSubmitPayload) => {
      const text = payload.text.trim();
      if (!text) return;
      setLastVoiceCommand(text);
      const lower = text.toLowerCase();
      if (lower.includes("emergency") || lower.includes("fire") || lower.includes("explosion")) {
        setShowEmergency(true);
        return;
      }
      if (lower.includes("supervisor") || lower.includes("need help") || lower.includes("escalate")) {
        void handleSupervisorHelp();
        return;
      }
      if (lower.includes("stop") || lower.includes("abort") || lower.includes("cancel")) {
        void handleStopCondition();
        return;
      }
      if (lower.includes("all clear") || lower.includes("all checks") || lower.includes("sab clear")) {
        void handleAllChecksClear();
        return;
      }
      const prereqAliases: Record<string, string[]> = {
        authorization: ["authorization", "authorised", "authorized", "permit signed", "approval"],
        ppe: ["ppe", "helmet", "gloves", "goggles", "shoes", "boots", "vest"],
        permit_isolation: ["permit", "isolation", "loto", "lockout", "tagout"],
        area_safe: ["area clear", "area safe", "no people", "clear area", "safe area"],
      };
      for (const [key, aliases] of Object.entries(prereqAliases)) {
        if (aliases.some((alias) => lower.includes(alias))) {
          if (!prereqBool(key)) void handleConfirmPrerequisite(key);
          return;
        }
      }
      const stepMatch = lower.match(/(?:step\s*|#\s*|number\s*)(\d{1,2})\b/);
      if (stepMatch) {
        const stepNumber = Number(stepMatch[1]);
        if (stepNumber >= 1 && stepNumber <= totalSteps) {
          void handleConfirmStep(stepNumber);
          return;
        }
      }
      if (lower.includes("next step") || lower.includes("step clear") || lower.includes("step done") || lower.includes("done")) {
        void handleConfirmStep(liveStepIndex);
        return;
      }

      if (!userId) return;
      const parsed = await parseVoiceCommand(text, userId, apiLanguage);
      if (!parsed) return;
      switch (parsed.intent) {
        case "step_clear":
          void handleConfirmStep(liveStepIndex);
          break;
        case "skip_step":
          void handleConfirmStep(liveStepIndex);
          break;
        case "verify_step":
        case "show_evidence":
          setShowSources(true);
          break;
        case "stop":
          void handleStopCondition();
          break;
        case "supervisor":
          void handleSupervisorHelp();
          break;
        case "all_clear":
          void handleAllChecksClear();
          break;
        case "show_risk":
        case "show_timing":
        case "recall_last":
          break;
        case "query":
        case "unknown":
        default:
          break;
      }
    },
    [
      handleAllChecksClear,
      handleConfirmPrerequisite,
      handleConfirmStep,
      handleStopCondition,
      handleSupervisorHelp,
      liveStepIndex,
      parseVoiceCommand,
      prereqBool,
      totalSteps,
      userId,
      apiLanguage,
    ],
  );

  const renderLanding = () => (
    <div className="rg-landing">
      <div className="rg-landing-hero">
        <div className="rg-hero-accent" />
        <div className="rg-landing-badge">
          <ShieldIcon size={14} />
          <span>Operational Run Guide</span>
        </div>
        <h2 className="rg-landing-title">Start a Procedure</h2>
        <p className="rg-landing-subtitle">Select equipment and task to begin a guided, step-by-step safe operation walkthrough.</p>
        {operatorName && (
          <p className="rg-landing-operator">
            Operator: <strong>{operatorName}</strong>
            {shift ? ` — ${shift} shift` : ""}
          </p>
        )}
      </div>
      <div className="rg-equipment-grid">
        {EQUIPMENT_CARDS.map((card) => (
          <button
            key={card.id}
            className={`rg-eq-card ${selectedEquipment === card.id ? "rg-eq-card-selected" : ""}`}
            onClick={() => setSelectedEquipment(selectedEquipment === card.id ? null : card.id)}
          >
            <div className="rg-eq-icon">
              <card.Icon />
            </div>
            <span className="rg-eq-label">{card.label}</span>
          </button>
        ))}
      </div>
      {selectedEquipment && (
        <div className="rg-task-list">
          <div className="rg-task-list-header">
            <ChecklistIcon size={16} />
            <span>Available Tasks</span>
          </div>
          {EQUIPMENT_CARDS.find((c) => c.id === selectedEquipment)?.tasks.map((t) => (
            <button
              key={t}
              className={`rg-task-btn ${selectedTask === t ? "rg-task-btn-selected" : ""}`}
              onClick={() => setSelectedTask(t)}
            >
              <ArrowRightIcon />
              {t}
            </button>
          ))}
        </div>
      )}
      {selectedEquipment && selectedTask && (
        <button
          className="rg-btn rg-btn-primary rg-btn-start"
          onClick={() => void handleStartGuide()}
          disabled={isLoading}
        >
          <PlayIcon size={16} /> {isLoading ? "Starting..." : "Begin Run Guide"}
        </button>
      )}
      {!selectedEquipment && (
        <div className="rg-landing-hint">
          <span className="rg-hint-dot" />
          Select equipment above to see available tasks
        </div>
      )}
      <div className="rg-landing-footer">
        <div className="rg-landing-stat">
          <FireIcon size={14} />
          <span>
            Emergency?{" "}
            <button className="rg-link-danger" onClick={() => setShowEmergency(true)}>
              Press here
            </button>
          </span>
        </div>
      </div>
    </div>
  );

  const renderPrecheck = () => {
    const missing = PREREQUISITES.filter((p) => !prereqBool(p.key));
    return (
      <div className="rg-precheck">
        <div className="rg-precheck-header">
          <ProgressRing
            progress={(completedPrechecks / totalPrechecks) * 100}
            size={64}
            color={allPrechecksComplete ? "#16a34a" : "#ea580c"}
          />
          <div className="rg-precheck-title-area">
            <h3 className="rg-precheck-title">Safety Pre-Checks</h3>
            <p className="rg-precheck-subtitle">
              {completedPrechecks}/{totalPrechecks} completed — {allPrechecksComplete ? "All clear!" : "Confirm each item before proceeding"}
            </p>
          </div>
        </div>
        {serverResponse?.answer && (
          <div className="rg-server-prompt">
            <DocumentIcon />
            <span>{serverResponse.answer}</span>
          </div>
        )}
        <div className="rg-prereq-list">
          {PREREQUISITES.map((prereq, idx) => {
            const confirmed = prereqBool(prereq.key);
            const IconComponent =
              prereq.icon === "shield"
                ? ShieldIcon
                : prereq.icon === "helmet"
                  ? HelmetIcon
                  : prereq.icon === "lock"
                    ? LockIcon
                    : CheckmarkIcon;
            return (
              <div
                key={prereq.key}
                className={`rg-prereq ${confirmed ? "rg-prereq-done" : ""}`}
                style={{ animationDelay: `${idx * 80}ms` }}
              >
                <div className={`rg-prereq-check ${confirmed ? "rg-prereq-check-done" : ""}`}>
                  {confirmed ? <CheckmarkIcon /> : <IconComponent />}
                </div>
                <div className="rg-prereq-info">
                  <span className="rg-prereq-label">{prereq.label}</span>
                  <span className="rg-prereq-desc">{prereq.desc}</span>
                </div>
                {!confirmed && (
                  <button
                    className="rg-prereq-btn"
                    onClick={() => void handleConfirmPrerequisite(prereq.key)}
                    disabled={isLoading}
                  >
                    Confirm
                  </button>
                )}
                {confirmed && (
                  <span className="rg-prereq-badge">
                    <CheckmarkIcon size={12} /> Done
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="rg-actions">
          {missing.length > 0 && (
            <button
              className="rg-btn rg-btn-secondary"
              onClick={() => void handleAllChecksClear()}
              disabled={isLoading}
            >
              All checks clear
            </button>
          )}
          {serverResponse?.next_actions?.map((a, i) => (
            <button
              key={i}
              className="rg-btn rg-btn-new"
              onClick={() => void handleNextAction(a)}
              disabled={isLoading}
            >
              <ArrowRightIcon />
              {a}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderProcedure = () => {
    const stopConditions = serverResponse?.state?.stop_conditions || [];
    const evidence = serverResponse?.evidence || [];
    const topEvidence = evidence[0];
    return (
      <div className="rg-procedure">
        <div className="rg-progress">
          <div className="rg-progress-header">
            <div className="rg-progress-info">
              <span className="rg-progress-label">
                {liveEquipment} / {liveTask}
              </span>
              <span className="rg-progress-step">
                Step {liveStepIndex > 0 ? liveStepIndex : 0} of {totalSteps}
              </span>
            </div>
            <div className="rg-progress-meta">
              <div className="rg-timer">
                <ClockIcon size={12} /> {formatDuration(elapsedTotal)}
              </div>
              <button className="rg-btn rg-btn-emergency-sm" onClick={() => setShowEmergency(true)}>
                <EmergencyIcon size={14} /> SOS
              </button>
            </div>
          </div>
          <div className="rg-progress-actions">
            <VoiceMicButton
              scope="guided"
              language="auto"
              onSubmit={handleRunGuideVoice}
              size="sm"
              variant="pill"
              label="Voice"
            />
            {onNewGuide && (
              <button className="rg-btn rg-btn-new" onClick={handleNewGuide}>
                <NewGuideIcon /> New Guide
              </button>
            )}
          </div>
          <div className="rg-progress-track">
            <div className="rg-progress-fill" style={{ width: `${progressPercent}%` }} />
            <div className="rg-progress-steps-labels">
              {Array.from({ length: totalSteps }, (_, i) => {
                const s = i + 1;
                const done = s < liveStepIndex;
                const cur = s === liveStepIndex;
                return (
                  <div
                    key={s}
                    className={`rg-pip ${done ? "rg-pip-done" : ""} ${cur ? "rg-pip-current" : ""}`}
                    style={{ left: `${(s / totalSteps) * 100}%` }}
                  />
                );
              })}
            </div>
          </div>
          {lastVoiceCommand && (
            <div className="rg-voice-command">
              <span className="rg-voice-command-label">Last command</span>
              <span className="rg-voice-command-text">{lastVoiceCommand}</span>
            </div>
          )}
        </div>

        <div className="rg-section">
          <div className="rg-section-header">
            <div className="rg-section-icon rg-section-icon-active">
              <PlayIcon />
            </div>
            <span className="rg-section-title">Live Checkpoint</span>
            <div className="rg-section-stats">
              {intelligence.risk && (
                <span
                  className="rg-risk-pill"
                  style={{ background: riskColor(intelligence.risk.score) }}
                  title={`Risk factors: ${intelligence.risk.factors.join(", ") || "none"}`}
                >
                  {riskLabel(intelligence.risk.level)}
                </span>
              )}
              {intelligence.stepTiming && (
                <span
                  className="rg-timing-pill"
                  style={{ borderColor: timingColor(intelligence.stepTiming.status), color: timingColor(intelligence.stepTiming.status) }}
                  title={intelligence.stepTiming.help_hint || `Expected ${intelligence.stepTiming.expected_seconds}s, on step for ${intelligence.stepTiming.on_step_seconds}s`}
                >
                  {intelligence.stepTiming.status === "on_track" ? "On track" : intelligence.stepTiming.status === "fast" ? "Moving fast" : intelligence.stepTiming.status === "slow" ? "Slow" : "Stalled"}
                </span>
              )}
              <span className="rg-stat">{verifiedSteps.size} verified</span>
              <span className="rg-stat-sep">/</span>
              <span className="rg-stat">{totalSteps} total</span>
            </div>
          </div>

          <div className="rg-intelligence-bar">
            <div className="rg-operator-mode">
              <span className="rg-intel-label">Mode</span>
              <select
                className="rg-mode-select"
                value={operatorMode}
                onChange={(e) => setOperatorMode(e.target.value as any)}
                aria-label="Operator experience mode"
              >
                <option value="novice">New operator</option>
                <option value="standard">Standard</option>
                <option value="senior">Senior</option>
                <option value="expert">Expert</option>
              </select>
            </div>
            {nextPreview && operatorMode !== "expert" && (
              <div className="rg-preview-next" title="Pre-fetched next step">
                <span className="rg-intel-label">Next</span>
                <span className="rg-preview-step">Step {nextPreview.next_step_index}</span>
                <span className="rg-preview-text">{nextPreview.preview_text.slice(0, 90)}…</span>
                {isPrefetching && <span className="rg-preview-loading" />}
              </div>
            )}
          </div>

          <div className="rg-step-current-card">
            <div className="rg-step-diagram-row">
              <div className="rg-step-diagram">
                <StepDiagram equipmentName={liveEquipment} />
              </div>
              <div className="rg-step-instruction-area">
                <div className="rg-step-heading">
                  <span className="rg-step-number">Checkpoint {liveStepIndex}</span>
                  <span className="rg-step-name">
                    {STEP_KEYWORDS[liveStepIndex] || `Step ${liveStepIndex}`}
                  </span>
                </div>
                <p className="rg-step-instruction">
                  {serverResponse?.answer || "Awaiting checkpoint..."}
                </p>
                {currentInstruction.trim() && (
                  <button
                    type="button"
                    className={`rg-btn-tts ${isTtsPlaying ? "rg-btn-tts-active" : ""}`}
                    onClick={isTtsPlaying ? streamingTts.stop : () => instructionTts(currentInstruction)}
                    aria-label={isTtsPlaying ? "Stop reading aloud" : "Read aloud"}
                  >
                    {isTtsPlaying ? <SpeakerStopIcon /> : <SpeakerPlayIcon />}
                    <span>{isTtsPlaying ? "Stop" : "Read aloud"}</span>
                  </button>
                )}
                {topEvidence?.citation_label && (
                  <div className="rg-expected-state">
                    <DocumentIcon />
                    <span>Source: {topEvidence.citation_label}</span>
                  </div>
                )}
              </div>
            </div>

            {stopConditions.length > 0 && (
              <div className="rg-safety-warning">
                <div className="rg-safety-icon">
                  <WarningIcon />
                </div>
                <div className="rg-safety-text">
                  <strong>Stop immediately if any of these apply:</strong>
                  <ul className="rg-stop-list">
                    {stopConditions.slice(0, 4).map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {intelligence.proceduralMemory.length > 0 && (
              <div className="rg-memory-banner" role="note">
                <HistoryIcon />
                <div className="rg-memory-text">
                  <strong>You've run this before.</strong>{" "}
                  Last {intelligence.proceduralMemory.length} run{intelligence.proceduralMemory.length === 1 ? "" : "s"}:{" "}
                  {intelligence.proceduralMemory
                    .slice(0, 3)
                    .map((m) => `${m.status || "completed"}${m.completed_at ? ` ${new Date(m.completed_at).toLocaleDateString()}` : ""}`)
                    .join(" • ")}
                </div>
              </div>
            )}

            {evidence.length > 0 && (
              <>
                <button className="rg-source-toggle" onClick={() => setShowSources(!showSources)}>
                  <DocumentIcon />
                  <span>Source evidence ({evidence.length} chunks)</span>
                  {showSources ? <ChevronUpIcon /> : <ChevronDownIcon />}
                </button>
                {showSources && (
                  <div className="rg-source-content">
                    {evidence.slice(0, 3).map((ev, i) => (
                      <div key={i} className="rg-source-chunk">
                        <div className="rg-source-chunk-label">
                          {ev.citation_label || `${ev.document_code || "doc"} p.${ev.page_start ?? "?"}`}
                        </div>
                        <div className="rg-source-chunk-text">
                          {(ev.content || "").slice(0, 280)}
                          {(ev.content || "").length > 280 ? "..." : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="rg-step-timer-live">
              <ClockIcon size={12} />
              <span>
                {formatDuration(stepTimers[liveStepIndex] || 0)} on this step
              </span>
            </div>

            <div className="rg-camera-section">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="rg-file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setImageFile(file);
                    const r = new FileReader();
                    r.onload = (ev) => setImagePreview(ev.target?.result as string);
                    r.readAsDataURL(file);
                    setVerificationResult(null);
                  }
                }}
              />
              {!imagePreview && (
                <button className="rg-btn rg-btn-camera" onClick={() => fileInputRef.current?.click()}>
                  <CameraIcon /> Take Photo to Verify
                </button>
              )}
              {imagePreview && (
                <div className="rg-image-preview">
                  <div className="rg-image-header">
                    <span className="rg-image-label">Equipment Photo</span>
                    <button
                      className="rg-image-remove"
                      onClick={() => {
                        setImagePreview(null);
                        setImageFile(null);
                        setVerificationResult(null);
                      }}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="Equipment" className="rg-image" />
                  {!verificationResult && !isVerifying && (
                    <button
                      className="rg-btn rg-btn-verify"
                      onClick={() => void handleVerifyImage()}
                      disabled={isVerifying}
                    >
                      <VerifyIcon /> Verify with AI (Nemotron VL)
                    </button>
                  )}
                  {isVerifying && (
                    <div className="rg-verifying">
                      <div className="rg-spinner" />
                      <span>Analyzing equipment condition with NVIDIA Nemotron VL...</span>
                    </div>
                  )}
                  {verificationResult && (
                    <div className={`rg-verification rg-verification-${verificationResult.compliance}`}>
                      <div className="rg-verification-header">
                        <div className="rg-verification-status">
                          {verificationResult.compliance === "pass" && <PassIcon />}
                          {verificationResult.compliance === "fail" && <FailIcon />}
                          {verificationResult.compliance === "uncertain" && <UncertainIcon />}
                          <span className="rg-verification-label">
                            {verificationResult.compliance === "pass" && "Equipment appears ready"}
                            {verificationResult.compliance === "fail" && "Issues detected"}
                            {verificationResult.compliance === "uncertain" && "Could not determine"}
                          </span>
                        </div>
                      </div>
                      <p className="rg-verification-observation">{verificationResult.observation}</p>
                      {verificationResult.risks.length > 0 && (
                        <div className="rg-verification-risks">
                          <span className="rg-risks-label">Risks identified:</span>
                          {verificationResult.risks.map((risk, i) => (
                            <div key={i} className="rg-risk-item">
                              <WarningIcon size={14} />
                              {risk}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="rg-verification-action">
                        <span className="rg-action-label">Recommended:</span>{" "}
                        {verificationResult.recommended_action}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="rg-notes-section">
              <div className="rg-notes-header">
                <span className="rg-notes-label">Operator note for step {liveStepIndex}</span>
                {operatorNotes[liveStepIndex] && (
                  <span className="rg-notes-saved">Saved: {operatorNotes[liveStepIndex]}</span>
                )}
              </div>
              <div className="rg-notes-input-row">
                <input
                  className="rg-notes-input"
                  placeholder="Add observation, deviation, or anomaly..."
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSaveNote(liveStepIndex);
                    }
                  }}
                />
                <button
                  className="rg-btn rg-btn-secondary"
                  onClick={() => void handleSaveNote(liveStepIndex)}
                  disabled={!noteDraft.trim() || isLoading}
                >
                  Save note
                </button>
              </div>
              {notesSavedAt && (
                <div className="rg-notes-toast">Note saved at {new Date(notesSavedAt).toLocaleTimeString()}</div>
              )}
            </div>

            <div className="rg-actions">
              <button
                className="rg-btn rg-btn-confirm"
                onClick={() => void handleConfirmStep(liveStepIndex)}
                disabled={isLoading}
              >
                <CheckmarkIcon /> Confirm Step
              </button>
              <button className="rg-btn rg-btn-stop" onClick={() => void handleStopCondition()} disabled={isLoading}>
                <WarningIcon /> Stop
              </button>
              <button
                className="rg-btn rg-btn-help"
                onClick={() => void handleSupervisorHelp()}
                disabled={isLoading}
              >
                <PhoneIcon /> Supervisor
              </button>
            </div>

            {serverResponse?.next_actions && serverResponse.next_actions.length > 0 && (
              <div className="rg-next-actions">
                <div className="rg-next-actions-label">Suggested actions from server:</div>
                <div className="rg-next-actions-row">
                  {serverResponse.next_actions.map((a, i) => (
                    <button
                      key={i}
                      className="rg-btn rg-btn-new"
                      onClick={() => void handleNextAction(a)}
                      disabled={isLoading}
                    >
                      <ArrowRightIcon /> {a}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderCompleted = () => (
    <div className="rg-complete">
      <div className="rg-complete-card">
        <div className="rg-complete-accent" />
        <div className="rg-complete-icon">
          <CheckCircleIcon size={56} />
        </div>
        <h2 className="rg-complete-title">Procedure Complete</h2>
        <p className="rg-complete-subtitle">
          {liveEquipment} — {liveTask}
        </p>
        <div className="rg-complete-stats">
          <div className="rg-stat-card">
            <span className="rg-stat-value">{totalSteps}</span>
            <span className="rg-stat-label">Steps Completed</span>
          </div>
          <div className="rg-stat-card">
            <span className="rg-stat-value">{formatDuration(elapsedTotal)}</span>
            <span className="rg-stat-label">Total Duration</span>
          </div>
          <div className="rg-stat-card">
            <span className="rg-stat-value">{verifiedSteps.size}</span>
            <span className="rg-stat-label">AI Verified</span>
          </div>
        </div>
        <div className="rg-complete-detail">
          <div className="rg-detail-row">
            <span>Operator</span>
            <strong>{operatorName || user?.name || "Current user"}</strong>
          </div>
          <div className="rg-detail-row">
            <span>Shift</span>
            <strong>{shift || "N/A"}</strong>
          </div>
          <div className="rg-detail-row">
            <span>Equipment</span>
            <strong>{liveEquipment}</strong>
          </div>
          <div className="rg-detail-row">
            <span>Task</span>
            <strong>{liveTask}</strong>
          </div>
          <div className="rg-detail-row">
            <span>Completed</span>
            <strong>{serverResponse?.state?.completed_at
              ? new Date(serverResponse.state.completed_at).toLocaleString()
              : new Date().toLocaleString()}</strong>
          </div>
          {serverResponse?.completion_record_id && (
            <div className="rg-detail-row rg-detail-row-record">
              <span>Run Record</span>
              <strong>{serverResponse.completion_record_id}</strong>
            </div>
          )}
          {Object.keys(operatorNotes).length > 0 && (
            <div className="rg-detail-notes">
              <strong>Operator Notes:</strong>
              <ul>
                {Object.entries(operatorNotes).map(([step, note]) => (
                  <li key={step}>Step {step}: {note}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="rg-complete-actions">
          {onNewGuide && (
            <button className="rg-btn rg-btn-primary" onClick={handleNewGuide}>
              <NewGuideIcon /> New Guide
            </button>
          )}
          <button
            className="rg-btn rg-btn-secondary"
            onClick={() => setPhase("landing")}
          >
            <FlagIcon size={14} /> Back to Home
          </button>
        </div>
      </div>
    </div>
  );

  const renderHandoff = () => (
    <div className="rg-handoff">
      <div className="rg-handoff-card">
        <div className="rg-handoff-icon">
          <PhoneIcon size={32} />
        </div>
        <h2 className="rg-handoff-title">Supervisor Handoff Initiated</h2>
        <p className="rg-handoff-subtitle">
          A supervisor has been notified{serverResponse?.state?.handoff_id
            ? ` (handoff #${String(serverResponse.state.handoff_id).slice(0, 8)})`
            : ""}.
        </p>
        {serverResponse?.answer && (
          <div className="rg-server-prompt">
            <DocumentIcon />
            <span>{serverResponse.answer}</span>
          </div>
        )}
        {serverResponse?.next_actions && serverResponse.next_actions.length > 0 && (
          <div className="rg-actions">
            {serverResponse.next_actions.map((a, i) => (
              <button
                key={i}
                className="rg-btn rg-btn-primary"
                onClick={() => void handleNextAction(a)}
                disabled={isLoading}
              >
                <ArrowRightIcon /> {a}
              </button>
            ))}
          </div>
        )}
        <div className="rg-actions">
          {onNewGuide && (
            <button className="rg-btn rg-btn-secondary" onClick={handleNewGuide}>
              <NewGuideIcon /> New Guide
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const renderBlocked = () => (
    <div className="rg-blocked">
      <div className="rg-blocked-card">
        <div className="rg-blocked-icon">
          <WarningIcon size={40} />
        </div>
        <h2 className="rg-blocked-title">Guide Blocked</h2>
        <p className="rg-blocked-subtitle">The run guide cannot continue.</p>
        {serverResponse?.answer && (
          <div className="rg-server-prompt">
            <DocumentIcon />
            <span>{serverResponse.answer}</span>
          </div>
        )}
        <div className="rg-actions">
          {onNewGuide && (
            <button className="rg-btn rg-btn-primary" onClick={handleNewGuide}>
              <NewGuideIcon /> Start Over
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const renderEmergency = () => (
    <div className="rg-emergency-overlay" onClick={() => setShowEmergency(false)}>
      <div className="rg-emergency-panel" onClick={(e) => e.stopPropagation()}>
        <div className="rg-emergency-header">
          <EmergencyIcon size={28} />
          <h2>Emergency Procedures</h2>
          <button className="rg-emergency-close" onClick={() => setShowEmergency(false)}>
            <CloseIcon />
          </button>
        </div>
        <div className="rg-emergency-body">
          <div className="rg-emergency-item rg-emergency-critical">
            <FireIcon size={18} />
            <div>
              <strong>Fire / Explosion</strong>
              <p>Activate fire alarm. Evacuate to assembly point. Do not re-enter until all-clear given.</p>
            </div>
          </div>
          <div className="rg-emergency-item rg-emergency-warning">
            <WarningIcon size={18} />
            <div>
              <strong>Chemical Spill</strong>
              <p>Isolate area. Use spill kit. Notify shift supervisor. Do not attempt cleanup without PPE.</p>
            </div>
          </div>
          <div className="rg-emergency-item rg-emergency-info">
            <PhoneIcon size={18} />
            <div>
              <strong>Supervisor Escalation</strong>
              <p>Contact shift supervisor immediately for any condition that deviates from approved procedure.</p>
            </div>
          </div>
          <div className="rg-emergency-item rg-emergency-info">
            <ShieldIcon size={18} />
            <div>
              <strong>Emergency Shutdown</strong>
              <p>Hit E-Stop. Isolate all energy sources. Verify zero-energy state before any intervention.</p>
            </div>
          </div>
        </div>
        <div className="rg-emergency-footer">
          <button
            className="rg-btn rg-btn-stop"
            onClick={() => {
              void handleStopCondition();
              setShowEmergency(false);
            }}
          >
            <WarningIcon /> STOP Procedure Now
          </button>
          <button
            className="rg-btn rg-btn-help"
            onClick={() => {
              void handleSupervisorHelp();
              setShowEmergency(false);
            }}
          >
            <PhoneIcon /> Call Supervisor
          </button>
        </div>
      </div>
    </div>
  );

  if (!userId) {
    return (
      <div className="rg">
        <div className="rg-empty">
          <ShieldIcon size={24} />
          <p>Sign in to start a live run guide.</p>
        </div>
        <style>{`.rg { font-family: var(--font-figtree), 'Figtree', -apple-system, BlinkMacSystemFont, sans-serif; }`}</style>
      </div>
    );
  }

  return (
    <div className="rg">
      {error && (
        <div className="rg-error">
          <WarningIcon size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {isLoading && phase !== "landing" && (
        <div className="rg-loading">
          <div className="rg-spinner" />
          <span>Contacting run guide backend...</span>
        </div>
      )}
      {phase === "landing" && renderLanding()}
      {phase === "task_selection" && renderPrecheck()}
      {phase === "prerequisite_checks" && renderPrecheck()}
      {phase === "running" && renderProcedure()}
      {phase === "supervisor_handoff" && renderHandoff()}
      {phase === "completed" && renderCompleted()}
      {phase === "blocked" && renderBlocked()}
      {showEmergency && renderEmergency()}

      <style jsx>{`
        .rg { font-family: var(--font-figtree), 'Figtree', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; flex-direction: column; gap: 16px; position: relative; }
        .rg-empty { display: flex; align-items: center; gap: 10px; padding: 20px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; color: #6b7280; font-size: 13px; }
        .rg-error { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b; font-size: 12px; }
        .rg-error button { margin-left: auto; background: transparent; border: none; color: #991b1b; font-size: 11px; cursor: pointer; text-decoration: underline; font-family: inherit; }
        .rg-loading { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; color: #0019a8; font-size: 12px; font-weight: 500; }
        .rg-spinner { width: 14px; height: 14px; border: 2px solid #bfdbfe; border-top-color: #0019a8; border-radius: 50%; animation: rg-spin 0.7s linear infinite; }
        @keyframes rg-spin { to { transform: rotate(360deg); } }
        .rg-server-prompt { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; background: #f8faff; border: 1px solid #dbeafe; border-radius: 8px; font-size: 12px; line-height: 1.6; color: #1a1a2e; margin-bottom: 12px; }
        .rg-server-prompt svg { color: #0019a8; flex-shrink: 0; margin-top: 2px; }
        .rg-stop-list { margin: 4px 0 0; padding-left: 18px; }
        .rg-stop-list li { margin: 2px 0; }

        .rg-step-current-card { background: #fafbfc; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; }
        .rg-step-heading { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
        .rg-next-actions { margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb; }
        .rg-next-actions-label { font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; display: block; }
        .rg-next-actions-row { display: flex; gap: 6px; flex-wrap: wrap; }
        .rg-source-chunk { padding: 8px 10px; background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 6px; }
        .rg-source-chunk-label { font-size: 10px; font-weight: 700; color: #0019a8; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
        .rg-source-chunk-text { font-size: 11px; line-height: 1.5; color: #4d5868; }
        .rg-notes-section { margin-top: 12px; padding: 10px 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; }
        .rg-notes-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap; gap: 4px; }
        .rg-notes-label { font-size: 11px; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 0.04em; }
        .rg-notes-saved { font-size: 10px; color: #16a34a; font-weight: 500; }
        .rg-notes-input-row { display: flex; gap: 6px; }
        .rg-notes-input { flex: 1; padding: 6px 10px; font-family: var(--font-figtree), sans-serif; font-size: 12px; color: #1a1a2e; background: #fff; border: 1px solid #fde68a; border-radius: 6px; outline: none; }
        .rg-notes-input:focus { border-color: #d97706; }
        .rg-notes-toast { font-size: 10px; color: #16a34a; margin-top: 4px; font-weight: 500; }
        .rg-detail-row-record { background: #f0fdf4; border: 1px solid #bbf7d0; }
        .rg-detail-notes { margin-top: 8px; padding: 8px 10px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; font-size: 11px; }
        .rg-detail-notes strong { display: block; margin-bottom: 4px; color: #92400e; }
        .rg-detail-notes ul { margin: 0; padding-left: 18px; }
        .rg-detail-notes li { margin: 2px 0; color: #374151; }

        .rg-handoff, .rg-blocked { display: flex; justify-content: center; padding: 20px 0; }
        .rg-handoff-card, .rg-blocked-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 32px 24px; text-align: center; max-width: 460px; width: 100%; }
        .rg-handoff-icon, .rg-blocked-icon { display: flex; justify-content: center; margin-bottom: 12px; }
        .rg-handoff-icon { color: #0019a8; }
        .rg-blocked-icon { color: #dc2626; }
        .rg-handoff-title, .rg-blocked-title { font-size: 18px; font-weight: 800; color: #000; letter-spacing: -0.02em; margin: 0 0 4px; }
        .rg-handoff-subtitle, .rg-blocked-subtitle { font-size: 12px; color: #6b7280; margin: 0 0 16px; }
        .rg-handoff .rg-actions, .rg-blocked .rg-actions { justify-content: center; }

        /* ─── LANDING ─── */
        .rg-landing { display: flex; flex-direction: column; gap: 20px; }
        .rg-landing-hero { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 28px 24px 20px; position: relative; overflow: hidden; }
        .rg-hero-accent { position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #0019a8, #00782a, #ffd329); }
        .rg-landing-badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 999px; font-size: 10px; font-weight: 700; color: #0019a8; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 12px; }
        .rg-landing-title { font-size: 22px; font-weight: 800; color: #000; letter-spacing: -0.03em; margin: 0 0 6px; line-height: 1.2; }
        .rg-landing-subtitle { font-size: 13px; color: #6b7280; margin: 0 0 8px; line-height: 1.55; letter-spacing: -0.008em; }
        .rg-landing-operator { font-size: 12px; color: #4d5868; margin: 0; }
        .rg-landing-operator strong { color: #000; }
        .rg-equipment-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px; }
        .rg-eq-card { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 8px 12px; background: #fff; border: 1.5px solid #e5e7eb; border-radius: 12px; cursor: pointer; transition: all 0.2s; font-family: var(--font-figtree), sans-serif; }
        .rg-eq-card:hover { border-color: #0019a8; background: #f8faff; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,25,168,0.08); }
        .rg-eq-card-selected { border-color: #0019a8; background: #eff6ff; box-shadow: 0 0 0 3px rgba(0,25,168,0.12); }
        .rg-eq-icon { color: #0019a8; }
        .rg-eq-label { font-size: 11px; font-weight: 600; color: #374151; letter-spacing: -0.01em; }
        .rg-eq-card-selected .rg-eq-label { color: #0019a8; }
        .rg-task-list { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px 16px; }
        .rg-task-list-header { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: #000; margin-bottom: 10px; letter-spacing: -0.01em; }
        .rg-task-btn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 14px; font-family: var(--font-figtree), sans-serif; font-size: 13px; font-weight: 500; color: #374151; background: #fafbfc; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; transition: all 0.15s; margin-bottom: 6px; text-align: left; letter-spacing: -0.005em; }
        .rg-task-btn:hover { border-color: #0019a8; color: #0019a8; background: #f8faff; }
        .rg-task-btn-selected { border-color: #0019a8; background: #eff6ff; color: #0019a8; font-weight: 600; }
        .rg-task-btn-selected svg { color: #0019a8; }
        .rg-btn-start { width: 100%; justify-content: center; padding: 12px 20px; font-size: 14px; }
        .rg-landing-hint { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #9ca3af; padding: 4px 0; letter-spacing: -0.005em; }
        .rg-hint-dot { width: 6px; height: 6px; border-radius: 50%; background: #d1d5db; flex-shrink: 0; }
        .rg-landing-footer { border-top: 1px solid #f3f4f6; padding-top: 12px; }
        .rg-landing-stat { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #6b7280; }
        .rg-link-danger { font-family: var(--font-figtree), sans-serif; font-size: 12px; font-weight: 700; color: #dc2626; background: none; border: none; cursor: pointer; text-decoration: underline; padding: 0; }

        /* ─── PRECHECK ─── */
        .rg-precheck { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 24px; position: relative; overflow: hidden; }
        .rg-precheck::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #ea580c, #ffd329, #16a34a); }
        .rg-precheck-header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
        .rg-precheck-title-area { flex: 1; }
        .rg-precheck-title { font-size: 18px; font-weight: 800; color: #000; letter-spacing: -0.02em; margin: 0 0 2px; }
        .rg-precheck-subtitle { font-size: 12px; color: #6b7280; margin: 0; letter-spacing: -0.005em; }
        .rg-prereq-list { display: flex; flex-direction: column; gap: 10px; }
        .rg-prereq { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 10px; border: 1.5px solid #e5e7eb; background: #fafbfc; transition: all 0.3s; animation: rg-fadeIn 0.4s ease both; }
        @keyframes rg-fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .rg-prereq-done { border-color: #bbf7d0; background: #f0fdf4; }
        .rg-prereq-check { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: #f3f4f6; color: #9ca3af; transition: all 0.3s; }
        .rg-prereq-check-done { background: #16a34a; color: #fff; transform: scale(1.05); }
        .rg-prereq-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .rg-prereq-label { font-size: 13px; font-weight: 600; color: #374151; letter-spacing: -0.005em; }
        .rg-prereq-desc { font-size: 11px; color: #9ca3af; line-height: 1.4; letter-spacing: -0.003em; }
        .rg-prereq-done .rg-prereq-label { color: #15803d; }
        .rg-prereq-done .rg-prereq-desc { color: #4ade80; }
        .rg-prereq-btn { padding: 6px 14px; font-family: var(--font-figtree), sans-serif; font-size: 11px; font-weight: 600; color: #0019a8; background: #fff; border: 1px solid #bfdbfe; border-radius: 6px; cursor: pointer; transition: all 0.15s; letter-spacing: -0.005em; flex-shrink: 0; }
        .rg-prereq-btn:hover { background: #eff6ff; border-color: #0019a8; }
        .rg-prereq-badge { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; font-weight: 700; color: #16a34a; letter-spacing: 0.04em; text-transform: uppercase; flex-shrink: 0; }

        /* ─── PROCEDURE ─── */
        .rg-procedure { display: flex; flex-direction: column; gap: 16px; }
        .rg-progress { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 20px; }
        .rg-progress-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
        .rg-progress-info { display: flex; flex-direction: column; gap: 2px; }
        .rg-progress-label { font-size: 12px; font-weight: 600; color: #000; letter-spacing: -0.01em; }
        .rg-progress-step { font-size: 11px; color: #6b7280; }
        .rg-progress-meta { display: flex; align-items: center; gap: 10px; }
        .rg-timer { display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: #4d5868; background: #f3f4f6; padding: 4px 8px; border-radius: 6px; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; }
        .rg-progress-actions { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
        .rg-progress-track { height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; position: relative; }
        .rg-progress-fill { height: 100%; background: linear-gradient(90deg, #0019a8, #1a3ad1); border-radius: 3px; transition: width 0.5s ease; }
        .rg-progress-steps-labels { position: absolute; inset: 0; }
        .rg-pip { position: absolute; width: 8px; height: 8px; border-radius: 50%; background: #e5e7eb; top: -1px; transform: translateX(-50%); transition: all 0.3s; }
        .rg-pip-done { background: #16a34a; }
        .rg-pip-current { background: #0019a8; box-shadow: 0 0 0 3px rgba(0,25,168,0.2); }
        .rg-voice-command { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 6px 10px; border-radius: 999px; background: #f1f5f9; border: 1px dashed #cbd5e1; font-size: 11px; color: #334155; }
        .rg-voice-command-label { text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; color: #0019a8; }
        .rg-voice-command-text { font-weight: 500; }

        .rg-section { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 20px; }
        .rg-section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
        .rg-section-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .rg-section-icon-active { background: #eff6ff; color: #0019a8; border: 1px solid #bfdbfe; }
        .rg-section-title { font-size: 14px; font-weight: 700; color: #000; letter-spacing: -0.01em; flex: 1; }
        .rg-section-stats { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #9ca3af; font-weight: 500; }
        .rg-stat { font-variant-numeric: tabular-nums; }
        .rg-stat-sep { color: #d1d5db; }

        .rg-step-diagram-row { display: flex; gap: 14px; margin: 10px 0; align-items: flex-start; }
        .rg-step-diagram { flex-shrink: 0; width: 56px; height: 56px; background: #f8faff; border: 1px solid #dbeafe; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
        .rg-step-instruction-area { flex: 1; min-width: 0; }
        .rg-step-number { font-size: 10px; font-weight: 700; color: #0019a8; text-transform: uppercase; letter-spacing: 0.06em; }
        .rg-step-name { font-size: 13px; font-weight: 700; color: #000; letter-spacing: -0.005em; }
        .rg-step-instruction { font-size: 14px; line-height: 1.65; color: #1a1a2e; letter-spacing: -0.008em; margin: 0 0 8px 0; white-space: pre-wrap; }
        .rg-expected-state { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; font-size: 11px; font-weight: 500; color: #15803d; letter-spacing: -0.005em; }
        .rg-expected-state svg { color: #16a34a; }

        .rg-safety-warning { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; margin-bottom: 12px; }
        .rg-safety-icon { color: #dc2626; flex-shrink: 0; margin-top: 1px; }
        .rg-safety-text { font-size: 12px; font-weight: 500; color: #991b1b; line-height: 1.5; letter-spacing: -0.005em; }

        .rg-source-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; font-family: var(--font-figtree), sans-serif; font-size: 11px; font-weight: 500; color: #6b7280; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; cursor: pointer; transition: all 0.15s; margin-bottom: 8px; letter-spacing: -0.005em; }
        .rg-source-toggle:hover { border-color: #0019a8; color: #0019a8; }
        .rg-source-content { font-size: 11px; color: #4d5868; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; line-height: 1.5; letter-spacing: -0.005em; }

        .rg-camera-section { margin-top: 12px; }
        .rg-file-input { display: none; }
        .rg-btn-camera { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; font-family: var(--font-figtree), sans-serif; font-size: 12px; font-weight: 600; color: #374151; background: #f9fafb; border: 1px dashed #d1d5db; border-radius: 8px; cursor: pointer; transition: all 0.15s; letter-spacing: -0.005em; }
        .rg-btn-camera:hover { border-color: #0019a8; color: #0019a8; background: #eff6ff; border-style: solid; }
        .rg-image-preview { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: #fff; }
        .rg-image-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
        .rg-image-label { font-size: 11px; font-weight: 600; color: #374151; letter-spacing: -0.005em; }
        .rg-image-remove { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; border: none; background: transparent; color: #9ca3af; cursor: pointer; transition: all 0.15s; }
        .rg-image-remove:hover { background: #fef2f2; color: #dc2626; }
        .rg-image { width: 100%; max-height: 200px; object-fit: cover; display: block; }
        .rg-btn-verify { display: flex; align-items: center; gap: 6px; width: 100%; justify-content: center; padding: 10px; font-family: var(--font-figtree), sans-serif; font-size: 12px; font-weight: 600; color: #fff; background: #0019a8; border: none; border-radius: 0 0 10px 10px; cursor: pointer; transition: all 0.15s; letter-spacing: -0.005em; }
        .rg-btn-verify:hover { background: #00137f; }
        .rg-verifying { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #eff6ff; border-top: 1px solid #e5e7eb; font-size: 12px; font-weight: 500; color: #0019a8; }
        .rg-verification { border-top: 1px solid #e5e7eb; padding: 12px; }
        .rg-verification-pass { background: #f0fdf4; border-top-color: #bbf7d0; }
        .rg-verification-fail { background: #fef2f2; border-top-color: #fecaca; }
        .rg-verification-uncertain { background: #fffbeb; border-top-color: #fde68a; }
        .rg-verification-header { margin-bottom: 8px; }
        .rg-verification-status { display: flex; align-items: center; gap: 6px; }
        .rg-verification-label { font-size: 12px; font-weight: 700; letter-spacing: -0.005em; }
        .rg-verification-pass .rg-verification-label { color: #16a34a; }
        .rg-verification-fail .rg-verification-label { color: #dc2626; }
        .rg-verification-uncertain .rg-verification-label { color: #d97706; }
        .rg-verification-observation { font-size: 12px; line-height: 1.6; color: #374151; margin: 0 0 8px 0; letter-spacing: -0.005em; }
        .rg-verification-risks { margin-bottom: 8px; }
        .rg-risks-label { font-size: 11px; font-weight: 600; color: #dc2626; display: block; margin-bottom: 4px; }
        .rg-risk-item { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #991b1b; padding: 2px 0; }
        .rg-risk-item svg { color: #dc2626; flex-shrink: 0; }
        .rg-verification-action { font-size: 11px; color: #374151; padding: 6px 8px; background: rgba(0,0,0,0.03); border-radius: 6px; }
        .rg-action-label { font-weight: 600; color: #000; }

        .rg-step-timer-live { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; background: #f3f4f6; border-radius: 4px; font-size: 10px; font-weight: 600; color: #6b7280; margin: 8px 0; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }

        .rg-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
        .rg-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; font-family: var(--font-figtree), sans-serif; font-size: 12px; font-weight: 600; border-radius: 8px; cursor: pointer; transition: all 0.15s; letter-spacing: -0.005em; border: 1px solid transparent; }
        .rg-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .rg-btn-primary { background: #0019a8; color: #fff; border-color: #0019a8; }
        .rg-btn-primary:hover:not(:disabled) { background: #00137f; }
        .rg-btn-confirm { background: #0019a8; color: #fff; border-color: #0019a8; }
        .rg-btn-confirm:hover:not(:disabled) { background: #00137f; }
        .rg-btn-stop { background: #fff; color: #dc2626; border-color: #fecaca; }
        .rg-btn-stop:hover:not(:disabled) { background: #fef2f2; border-color: #dc2626; }
        .rg-btn-help { background: #fff; color: #374151; border-color: #e5e7eb; }
        .rg-btn-help:hover:not(:disabled) { border-color: #0019a8; color: #0019a8; }
        .rg-btn-new { background: #fff; color: #374151; border-color: #e5e7eb; padding: 5px 10px; font-size: 11px; }
        .rg-btn-new:hover:not(:disabled) { border-color: #0019a8; color: #0019a8; background: #eff6ff; }
        .rg-btn-secondary { background: #fff; color: #0019a8; border-color: #bfdbfe; padding: 8px 16px; font-family: var(--font-figtree), sans-serif; font-size: 12px; font-weight: 600; border-radius: 8px; cursor: pointer; transition: all 0.15s; letter-spacing: -0.005em; }
        .rg-btn-secondary:hover:not(:disabled) { background: #eff6ff; border-color: #0019a8; }
        .rg-btn-emergency-sm { background: #fef2f2; color: #dc2626; border-color: #fecaca; padding: 4px 8px; font-size: 10px; font-weight: 800; letter-spacing: 0.06em; border-radius: 6px; }
.rg-btn-emergency-sm:hover:not(:disabled) { background: #dc2626; color: #fff; border-color: #dc2626; }

.rg-btn-tts { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; font-family: var(--font-figtree), sans-serif; font-size: 11px; font-weight: 600; color: #0019a8; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; cursor: pointer; transition: all 0.15s; letter-spacing: -0.005em; margin-top: 6px; }
.rg-btn-tts:hover { background: #dbeafe; border-color: #0019a8; }
.rg-btn-tts-active { color: #dc2626; background: #fef2f2; border-color: #fecaca; }
.rg-btn-tts-active:hover { background: #fee2e2; border-color: #dc2626; }

.rg-risk-pill { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; color: #fff; letter-spacing: 0.04em; text-transform: uppercase; }
.rg-timing-pill { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; border: 1px solid; background: #fff; letter-spacing: 0.02em; }
.rg-intelligence-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding: 6px 10px; background: linear-gradient(90deg, #f0f4ff, #fafbff); border: 1px solid #dbeafe; border-radius: 8px; font-size: 11px; }
.rg-operator-mode { display: inline-flex; align-items: center; gap: 6px; }
.rg-intel-label { text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; color: #6b7280; font-size: 9px; }
.rg-mode-select { padding: 3px 6px; font-family: var(--font-figtree), sans-serif; font-size: 11px; font-weight: 600; color: #0019a8; background: #fff; border: 1px solid #bfdbfe; border-radius: 6px; cursor: pointer; }
.rg-preview-next { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; background: #fff; border: 1px dashed #93c5fd; border-radius: 6px; max-width: 380px; overflow: hidden; }
.rg-preview-step { font-weight: 700; color: #0019a8; font-size: 10px; }
.rg-preview-text { color: #4b5563; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
.rg-preview-loading { width: 6px; height: 6px; border-radius: 3px; background: #0019a8; animation: pulse 1s infinite; }
.rg-memory-banner { display: flex; align-items: center; gap: 8px; padding: 8px 10px; margin: 8px 0; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; font-size: 11px; color: #1e3a8a; line-height: 1.5; }
.rg-memory-text strong { color: #0019a8; }

/* ─── COMPLETE ─── */
        .rg-complete { display: flex; justify-content: center; padding: 20px 0; }
        .rg-complete-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 32px 28px; text-align: center; max-width: 460px; width: 100%; position: relative; overflow: hidden; }
        .rg-complete-accent { position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #16a34a, #0019a8, #ffd329); }
        .rg-complete-icon { margin: 0 auto 12px; animation: rg-popIn 0.5s ease; }
        @keyframes rg-popIn { 0% { transform: scale(0.5); opacity: 0; } 70% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
        .rg-complete-title { font-size: 20px; font-weight: 800; color: #16a34a; letter-spacing: -0.02em; margin: 0 0 4px; }
        .rg-complete-subtitle { font-size: 13px; color: #6b7280; margin: 0 0 20px; letter-spacing: -0.005em; }
        .rg-complete-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 20px; }
        .rg-stat-card { display: flex; flex-direction: column; gap: 2px; padding: 12px 8px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; }
        .rg-stat-value { font-size: 18px; font-weight: 800; color: #000; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
        .rg-stat-label { font-size: 10px; font-weight: 600; color: #9ca3af; letter-spacing: 0.02em; text-transform: uppercase; }
        .rg-complete-detail { display: flex; flex-direction: column; gap: 6px; margin-bottom: 20px; text-align: left; }
        .rg-detail-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #fafbfc; border-radius: 6px; font-size: 12px; color: #6b7280; }
        .rg-detail-row strong { color: #000; font-weight: 600; }
        .rg-complete-actions { display: flex; gap: 8px; justify-content: center; }

        /* ─── EMERGENCY OVERLAY ─── */
        .rg-emergency-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 16px; animation: rg-fadeIn 0.2s ease; }
        .rg-emergency-panel { background: #fff; border-radius: 16px; max-width: 440px; width: 100%; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
        .rg-emergency-header { display: flex; align-items: center; gap: 10px; padding: 16px 20px; background: #dc2626; color: #fff; }
        .rg-emergency-header h2 { font-size: 16px; font-weight: 800; margin: 0; flex: 1; letter-spacing: -0.01em; }
        .rg-emergency-header svg { color: #fff; }
        .rg-emergency-close { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; border: none; background: rgba(255,255,255,0.2); color: #fff; cursor: pointer; transition: all 0.15s; }
        .rg-emergency-close:hover { background: rgba(255,255,255,0.4); }
        .rg-emergency-body { padding: 16px 20px; display: flex; flex-direction: column; gap: 10px; }
        .rg-emergency-item { display: flex; gap: 10px; padding: 12px; border-radius: 10px; border: 1px solid; }
        .rg-emergency-item svg { flex-shrink: 0; margin-top: 2px; }
        .rg-emergency-item strong { display: block; font-size: 13px; margin-bottom: 2px; letter-spacing: -0.01em; }
        .rg-emergency-item p { font-size: 12px; margin: 0; line-height: 1.5; color: #6b7280; letter-spacing: -0.005em; }
        .rg-emergency-critical { background: #fef2f2; border-color: #fecaca; color: #dc2626; }
        .rg-emergency-warning { background: #fffbeb; border-color: #fde68a; color: #d97706; }
        .rg-emergency-info { background: #eff6ff; border-color: #bfdbfe; color: #0019a8; }
        .rg-emergency-footer { display: flex; gap: 8px; padding: 14px 20px; border-top: 1px solid #e5e7eb; }
        .rg-emergency-footer .rg-btn { flex: 1; justify-content: center; }

        /* ─── PROGRESS RING ─── */
        .rg-progress-ring { display: block; }
      `}</style>
    </div>
  );
}
