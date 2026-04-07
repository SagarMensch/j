"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  AnalysisHistoryItem,
  AnalysisResponse,
  PrecheckCheckResult,
  PrecheckPageResult,
  PrecheckResponse,
  PrecheckStatus,
} from "@/lib/api-types";
import {
  formatDocumentType,
  formatDateTime,
  formatMs,
  formatPercent,
  formatProvider,
  formatVerdict,
  verdictTone,
} from "@/lib/format";
import { getBrowserApiBaseUrl } from "@/lib/api";

type UploadConsoleProps = {
  initialRecentUploads: AnalysisHistoryItem[];
};

export function UploadConsole({ initialRecentUploads }: UploadConsoleProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("auto");
  const [submitterId, setSubmitterId] = useState("manual-review");
  const [tenantId, setTenantId] = useState("default-tenant");
  const [activePanel, setActivePanel] = useState<"precheck" | "submission">(
    "precheck",
  );
  const [precheckResult, setPrecheckResult] = useState<PrecheckResponse | null>(
    null,
  );
  const [isPrechecking, setIsPrechecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptedFormats = useMemo(
    () => ".pdf,.png,.jpg,.jpeg,.bmp,.tif,.tiff,.webp",
    [],
  );

  async function handleSubmit() {
    if (!selectedFile) {
      setError("Choose a document before submitting.");
      return;
    }
    if (!precheckResult) {
      setError("Run the precheck before starting the full review.");
      setActivePanel("precheck");
      return;
    }
    if (!precheckResult.can_proceed) {
      setError("Precheck blocked this upload. Fix the file quality before review.");
      setActivePanel("precheck");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", selectedFile);
    if (documentType !== "auto") {
      formData.append("document_type", documentType);
    }
    formData.append("submitter_id", submitterId);
    formData.append("tenant_id", tenantId);

    try {
      const response = await fetch(`${getBrowserApiBaseUrl()}/api/v1/analyze`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || "Upload failed.");
      }

      const analysis = (await response.json()) as AnalysisResponse;
      router.push(`/submitter/my-submissions/${analysis.analysis_id}`);
      router.refresh();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePrecheck() {
    if (!selectedFile) {
      setError("Choose a document before running precheck.");
      return;
    }

    setIsPrechecking(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const response = await fetch(`${getBrowserApiBaseUrl()}/api/v1/precheck`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || "Precheck failed.");
      }

      const result = (await response.json()) as PrecheckResponse;
      setPrecheckResult(result);
      setActivePanel("submission");
    } catch (precheckError) {
      setPrecheckResult(null);
      setError(
        precheckError instanceof Error
          ? precheckError.message
          : "Precheck failed.",
      );
    } finally {
      setIsPrechecking(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background-light text-text-main">
      <header className="border-b border-border-color bg-white px-6 py-6 shadow-subtle lg:px-10">
        <div className="flex flex-col gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">
              Submitter Workspace
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">
              Upload a Document
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-medium text-muted">
              Add a file to begin review and create a new case.
            </p>
          </div>
        </div>
      </header>

      <main className="grid flex-1 gap-8 p-6 lg:grid-cols-[minmax(0,1.35fr)_420px] lg:p-8">
        <section className="rounded-[28px] border border-border-color bg-white p-6 shadow-subtle lg:p-8">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <button
              className="group relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-[28px] border-2 border-dashed border-border-color bg-surface px-8 text-center transition-colors hover:border-primary/40"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(33,9,170,0.08),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(0,130,59,0.08),transparent_35%)]" />
              <div className="relative z-10 flex max-w-lg flex-col items-center">
                <div className="mb-6 flex size-24 items-center justify-center rounded-full bg-white text-primary shadow-subtle transition-transform group-hover:scale-105">
                  <span className="material-symbols-outlined text-5xl">
                    upload_file
                  </span>
                </div>
                <h2 className="text-2xl font-bold tracking-tight">
                  Drag in a document or select one from your device
                </h2>
                <p className="mt-3 text-sm font-medium text-muted">
                  Your file will be reviewed and added to your case history.
                </p>
                <div className="mt-8 flex items-center gap-3 rounded-full bg-primary px-6 py-3 text-sm font-bold text-white">
                  <span>Select File</span>
                  <span className="material-symbols-outlined text-lg">
                    arrow_forward
                  </span>
                </div>
                <p className="mt-4 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                  PDF, JPEG, PNG, TIFF, BMP, WEBP
                </p>
              </div>
            </button>

            <div className="rounded-[28px] border border-border-color bg-background-light p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold">Submission Controls</h3>
                <div className="inline-flex rounded-full border border-border-color bg-white p-1 text-xs font-bold">
                  <button
                    className={`rounded-full px-3 py-1.5 transition-colors ${
                      activePanel === "precheck"
                        ? "bg-primary text-white"
                        : "text-muted"
                    }`}
                    onClick={() => setActivePanel("precheck")}
                    type="button"
                  >
                    Precheck
                  </button>
                  <button
                    className={`rounded-full px-3 py-1.5 transition-colors ${
                      activePanel === "submission"
                        ? "bg-primary text-white"
                        : "text-muted"
                    }`}
                    onClick={() => setActivePanel("submission")}
                    type="button"
                  >
                    Review
                  </button>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-muted">
                    Selected File
                  </label>
                  <div className="rounded-2xl border border-border-color bg-white px-4 py-3 text-sm font-medium">
                    {selectedFile ? selectedFile.name : "No file chosen"}
                  </div>
                </div>

                {activePanel === "precheck" ? (
                  <>
                    <div className="rounded-2xl border border-border-color bg-white px-4 py-3 text-xs font-medium text-muted">
                      Run the quality gate first. The upload will only move to
                      full forensic review after the file passes or clears with
                      warnings.
                    </div>

                    {precheckResult ? (
                      <div
                        className={`rounded-3xl border px-4 py-4 ${precheckTone(precheckResult.overall_status).panel}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.18em]">
                              Precheck Result
                            </p>
                            <h4 className="mt-1 text-lg font-bold">
                              {precheckTone(precheckResult.overall_status).label}
                            </h4>
                          </div>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-bold ${precheckTone(precheckResult.overall_status).chip}`}
                          >
                            {precheckResult.overall_status}
                          </span>
                        </div>
                        <p className="mt-3 text-sm font-medium">
                          {precheckResult.summary}
                        </p>
                        <div className="mt-4 grid gap-3 text-xs font-medium sm:grid-cols-3">
                          <div className="rounded-2xl bg-white/70 px-3 py-2">
                            {precheckResult.page_count} page
                            {precheckResult.page_count === 1 ? "" : "s"}
                          </div>
                          <div className="rounded-2xl bg-white/70 px-3 py-2">
                            {precheckResult.warning_check_count} warnings
                          </div>
                          <div className="rounded-2xl bg-white/70 px-3 py-2">
                            {precheckResult.blocking_check_count} blocking checks
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-dashed border-border-color bg-white px-4 py-5 text-sm font-medium text-muted">
                        No precheck has been run for this file yet.
                      </div>
                    )}

                    <button
                      className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isPrechecking || !selectedFile}
                      onClick={handlePrecheck}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-lg">
                        {isPrechecking ? "hourglass_top" : "frame_inspect"}
                      </span>
                      <span>
                        {isPrechecking ? "Running precheck" : "Run precheck"}
                      </span>
                    </button>

                    {precheckResult ? (
                      <div className="space-y-3">
                        {precheckResult.checks.map((check) => (
                          <PrecheckCard
                            check={check}
                            key={`${check.key}-${check.page_index ?? "document"}`}
                          />
                        ))}
                        {precheckResult.pages.map((page) => (
                          <div
                            className="rounded-3xl border border-border-color bg-white p-4"
                            key={page.page_index}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-bold">
                                  Page {page.page_index}
                                </p>
                                <p className="text-xs font-medium text-muted">
                                  {page.width} x {page.height}
                                </p>
                              </div>
                              <span
                                className={`rounded-full px-3 py-1 text-xs font-bold ${precheckTone(page.status).chip}`}
                              >
                                {page.status}
                              </span>
                            </div>
                            <div className="mt-4 space-y-3">
                              {page.checks.map((check) => (
                                <PrecheckCard
                                  check={check}
                                  key={`${page.page_index}-${check.key}`}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-muted">
                        Document Type
                      </label>
                      <select
                        className="w-full rounded-2xl border border-border-color bg-white px-4 py-3 text-sm font-medium outline-none transition-colors focus:border-primary"
                        onChange={(event) => setDocumentType(event.target.value)}
                        value={documentType}
                      >
                        <option value="auto">Auto-detect</option>
                        <option value="invoice">Invoice</option>
                        <option value="receipt">Receipt</option>
                        <option value="bank_statement">Bank Statement</option>
                        <option value="legal_filing">Legal Filing</option>
                        <option value="affidavit">Affidavit</option>
                        <option value="agreement">Agreement</option>
                        <option value="certificate">Certificate</option>
                        <option value="id_document">ID Document</option>
                        <option value="payslip">Payslip</option>
                        <option value="medical_record">Medical Record</option>
                        <option value="other">Other</option>
                      </select>
                    </div>

                    <div className="rounded-2xl border border-border-color bg-white px-4 py-3 text-xs font-medium text-muted">
                      Auto-detect picks the faster text route for the document.
                      Use a fixed type only if you want to override it.
                    </div>

                    {precheckResult ? (
                      <div
                        className={`rounded-2xl border px-4 py-3 text-sm font-medium ${precheckTone(precheckResult.overall_status).panel}`}
                      >
                        {precheckResult.summary}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-accent-amber/20 bg-accent-amber/10 px-4 py-3 text-sm font-medium text-[#5B4A00]">
                        Run the precheck before starting the full review.
                      </div>
                    )}

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-muted">
                        Submitter Id
                      </label>
                      <input
                        className="w-full rounded-2xl border border-border-color bg-white px-4 py-3 text-sm font-medium outline-none transition-colors focus:border-primary"
                        onChange={(event) => setSubmitterId(event.target.value)}
                        value={submitterId}
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-muted">
                        Tenant Id
                      </label>
                      <input
                        className="w-full rounded-2xl border border-border-color bg-white px-4 py-3 text-sm font-medium outline-none transition-colors focus:border-primary"
                        onChange={(event) => setTenantId(event.target.value)}
                        value={tenantId}
                      />
                    </div>
                  </>
                )}

                {error ? (
                  <div className="rounded-2xl border border-accent-red/20 bg-accent-red/10 px-4 py-3 text-sm font-medium text-accent-red">
                    {error}
                  </div>
                ) : null}

                <button
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={
                    isSubmitting ||
                    !selectedFile ||
                    !precheckResult ||
                    !precheckResult.can_proceed
                  }
                  onClick={handleSubmit}
                  type="button"
                >
                  <span className="material-symbols-outlined text-lg">
                    {isSubmitting ? "hourglass_top" : "play_arrow"}
                  </span>
                  <span>
                    {isSubmitting
                      ? "Reviewing document"
                      : "Start review"}
                  </span>
                </button>

                <button
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-border-color bg-white px-6 py-3 text-sm font-bold text-text-main transition-colors hover:bg-surface"
                  onClick={() => setActivePanel("precheck")}
                  type="button"
                >
                  <span className="material-symbols-outlined text-lg">
                    frame_inspect
                  </span>
                  <span>Open precheck</span>
                </button>
              </div>
            </div>
          </div>

          <input
            accept={acceptedFormats}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setSelectedFile(file);
              setPrecheckResult(null);
              setActivePanel("precheck");
              setError(null);
            }}
            ref={fileInputRef}
            type="file"
          />
        </section>

        <aside className="rounded-[28px] border border-border-color bg-white p-6 shadow-subtle">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                Recent Documents
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight">
                Submission History
              </h2>
            </div>
            <Link
              className="text-sm font-bold text-primary hover:underline"
              href="/submitter/my-submissions"
            >
              My Submissions
            </Link>
          </div>

          <div className="mt-6 space-y-3">
            {initialRecentUploads.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border-color bg-surface px-5 py-8 text-center text-sm font-medium text-muted">
                No submissions yet. Your first completed review will appear
                here.
              </div>
            ) : (
              initialRecentUploads.map((item) => {
                const tone = verdictTone(item.verdict);

                return (
                  <div
                    className="rounded-[24px] border border-border-color bg-background-light px-5 py-4"
                    key={item.analysis_id}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`mt-1 size-3 rounded-full ${tone.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate text-base font-bold">
                              {item.filename}
                            </p>
                            <p className="mt-1 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                              {item.analysis_id}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${tone.chip}`}
                          >
                            {formatVerdict(item.verdict)}
                          </span>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-medium text-muted">
                          <span>
                            {formatDocumentType(item.document_type)} via{" "}
                            {formatProvider(item.document_provider)}
                          </span>
                          <span>{formatPercent(item.forensic_risk_score)} risk level</span>
                          <span>{item.tampered_region_count} marked areas</span>
                          <span>{item.ocr_anomaly_count} text issues</span>
                          <span>{formatMs(item.processing_time_ms)}</span>
                          <span>{formatDateTime(item.created_at)}</span>
                        </div>
                        <Link
                          className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
                          href={`/submitter/my-submissions/${item.analysis_id}`}
                        >
                          <span>Open analysis</span>
                          <span className="material-symbols-outlined text-base">
                            arrow_forward
                          </span>
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

function PrecheckCard({ check }: { check: PrecheckCheckResult }) {
  const tone = precheckTone(check.status);

  return (
    <div className={`rounded-2xl border px-4 py-3 ${tone.panel}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">{check.label}</p>
          <p className="mt-1 text-xs font-medium">{check.message}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${tone.chip}`}>
          {check.status}
        </span>
      </div>
      {check.value ? (
        <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-muted">
          {check.value}
        </p>
      ) : null}
    </div>
  );
}

function precheckTone(status: PrecheckStatus) {
  if (status === "BLOCK") {
    return {
      label: "Blocked",
      chip: "bg-accent-red text-white",
      panel: "border-accent-red/20 bg-accent-red/10 text-accent-red",
    };
  }
  if (status === "WARN") {
    return {
      label: "Passed With Warnings",
      chip: "bg-accent-amber text-[#121212]",
      panel: "border-accent-amber/20 bg-accent-amber/10 text-[#5B4A00]",
    };
  }
  return {
    label: "Ready For Review",
    chip: "bg-accent-green text-white",
    panel: "border-accent-green/20 bg-accent-green/10 text-accent-green",
  };
}
