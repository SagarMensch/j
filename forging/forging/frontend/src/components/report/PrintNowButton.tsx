"use client";

export function PrintNowButton() {
  return (
    <button
      className="rounded-full bg-primary px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-primary/90"
      onClick={() => window.print()}
      type="button"
    >
      Save as PDF
    </button>
  );
}
