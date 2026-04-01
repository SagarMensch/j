"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { AppLanguage, UserRole, useAuth } from "@/lib/auth-context";
import { RoleAdminIcon, RoleOperatorIcon } from "@/components/ui/icons";

const GeometryMosaicCanvas = dynamic(
  () =>
    import("@/components/landing/geometry-mosaic-canvas").then(
      (mod) => mod.GeometryMosaicCanvas,
    ),
  { ssr: false },
);

type LandingCopy = {
  title: string;
  operatorTitle: string;
  adminTitle: string;
  helper: string;
};

const COPY: Record<AppLanguage, LandingCopy> = {
  ENG: {
    title: "Operational intelligence",
    operatorTitle: "Operator Workspace",
    adminTitle: "Admin Workspace",
    helper:
      "Choose a workspace to begin shift guidance, training, and control.",
  },
  HIN: {
    title: "Operational Intelligence",
    operatorTitle: "Operator Workspace",
    adminTitle: "Admin Workspace",
    helper:
      "Shift guidance, training, aur control ke liye workspace choose karein.",
  },
  HING: {
    title: "Operational intelligence",
    operatorTitle: "Operator Workspace",
    adminTitle: "Admin Workspace",
    helper:
      "Shift guidance, training, aur control ke liye workspace choose karo.",
  },
};

export default function Home() {
  const router = useRouter();
  const { login, language, setLanguage } = useAuth();
  const copy = COPY[language];

  const handleRoleSelect = (role: UserRole) => {
    login(role);
    router.push(role === "operator" ? "/operator" : "/admin");
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#29a9ef_0%,#1f9fe6_100%)]">
      <div className="absolute inset-0 opacity-90">
        <GeometryMosaicCanvas />
      </div>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-8%] top-[10%] h-[30rem] w-[30rem] rounded-full border-[18px] border-[rgba(255,255,255,0.38)] border-r-transparent border-b-transparent" />
        <div className="absolute right-[4%] top-[12%] h-[20rem] w-[20rem] rounded-full border-[10px] border-[rgba(255,255,255,0.34)]" />
        <div className="absolute left-[8%] top-[48%] h-2 w-[18rem] rounded-full bg-[rgba(255,255,255,0.88)]" />
        <div className="absolute left-[28%] top-[48%] h-2 w-[11rem] rounded-full bg-[rgba(0,25,168,0.95)]" />
        <div className="absolute left-[58%] top-[48%] h-2 w-[9rem] rounded-full bg-[rgba(255,211,41,0.95)]" />
        <div className="absolute left-[18%] top-[70%] h-1.5 w-[13rem] rounded-full bg-[rgba(255,255,255,0.88)]" />
        <div className="absolute right-[16%] top-[64%] h-1.5 w-[14rem] rounded-full bg-[rgba(255,255,255,0.7)]" />
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.14),rgba(31,159,230,0.12)_45%,rgba(31,159,230,0.3)_100%)]" />

      <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
        <section className="w-full max-w-[920px] rounded-[28px] border border-[#d3dbe6] bg-[rgba(255,255,255,0.82)] p-5 shadow-[0_24px_60px_rgba(0,25,168,0.12)] backdrop-blur-xl md:p-7">
          <div className="grid gap-5 lg:grid-cols-[1.12fr_0.88fr]">
            <div className="rounded-[22px] border border-[rgba(255,255,255,0.46)] bg-[linear-gradient(180deg,rgba(255,255,255,0.94)_0%,rgba(245,249,253,0.94)_100%)] p-5">
              <div className="flex flex-col items-start">
                <div className="w-fit rounded-[18px] border border-border bg-[rgba(255,255,255,0.94)] p-3 shadow-[0_10px_28px_rgba(0,25,168,0.06)]">
                  <Logo variant="full" size="sm" withBackdrop={false} />
                </div>
                <div className="mt-4 w-[9rem] max-w-full">
                  <div className="tfl-strip" />
                </div>
              </div>
              <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                Plant Assistant
              </p>
              <h1 className="mt-2 max-w-xl text-[1.55rem] font-semibold leading-[1.05] tracking-[-0.02em] text-foreground md:text-[1.9rem]">
                {copy.title}
              </h1>
              <p className="mt-4 max-w-lg text-sm leading-6 text-muted">
                {copy.helper}
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[16px] border border-border bg-white px-3 py-3">
                  <div className="mb-2 h-1.5 w-12 rounded-full bg-primary" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                    Live SOP
                  </p>
                </div>
                <div className="rounded-[16px] border border-border bg-white px-3 py-3">
                  <div className="mb-2 h-1.5 w-12 rounded-full bg-accent" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                    Guided Training
                  </p>
                </div>
                <div className="rounded-[16px] border border-border bg-white px-3 py-3">
                  <div className="mb-2 h-1.5 w-12 rounded-full bg-warning" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                    Readiness Control
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[22px] border border-border bg-white p-5 shadow-[0_12px_32px_rgba(0,25,168,0.06)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                Choose Language
              </p>
              <div className="mt-3 inline-flex items-center rounded-full border border-border bg-[#f7fafc] p-1">
                {(["ENG", "HIN", "HING"] as AppLanguage[]).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setLanguage(lang)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-[0.12em] transition-colors ${
                      language === lang
                        ? "bg-primary text-white"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {lang}
                  </button>
                ))}
              </div>

              <div className="mt-6 space-y-3">
                <button
                  onClick={() => handleRoleSelect("operator")}
                  className="group w-full rounded-[18px] border border-border bg-[linear-gradient(180deg,#ffffff_0%,#f7fafc_100%)] px-4 py-4 text-left transition-colors hover:border-primary/20 hover:bg-white"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 inline-flex h-11 w-11 items-center justify-center rounded-[14px] border border-border bg-[#f2f7fc] text-primary">
                      <RoleOperatorIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 h-1.5 w-14 rounded-full bg-primary" />
                      <p className="text-base font-semibold text-foreground">
                        {copy.operatorTitle}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        Shift command, SOP lookup, training, quiz, and reports.
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => handleRoleSelect("admin")}
                  className="group w-full rounded-[18px] border border-border bg-[linear-gradient(180deg,#ffffff_0%,#f7fafc_100%)] px-4 py-4 text-left transition-colors hover:border-accent/20 hover:bg-white"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 inline-flex h-11 w-11 items-center justify-center rounded-[14px] border border-border bg-[#f2f7fc] text-accent">
                      <RoleAdminIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 h-1.5 w-14 rounded-full bg-accent" />
                      <p className="text-base font-semibold text-foreground">
                        {copy.adminTitle}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        Documents, readiness analytics, users, and platform
                        control.
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
