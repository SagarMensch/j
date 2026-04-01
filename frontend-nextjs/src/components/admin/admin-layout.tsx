"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import {
  AnalyticsBarsIcon,
  DashboardBlocksIcon,
  DocumentStackIcon,
  NotificationGridIcon,
  SettingsMatrixIcon,
  UsersClusterIcon,
} from "@/components/ui/icons";

interface NavItem {
  key: "dashboard" | "analytics" | "users" | "documents" | "settings";
  href: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { key: "dashboard", href: "/admin", icon: <DashboardBlocksIcon /> },
  { key: "analytics", href: "/admin/analytics", icon: <AnalyticsBarsIcon /> },
  { key: "users", href: "/admin/users", icon: <UsersClusterIcon /> },
  { key: "documents", href: "/admin/documents", icon: <DocumentStackIcon /> },
  { key: "settings", href: "/admin/settings", icon: <SettingsMatrixIcon /> },
];

const COPY: Record<
  AppLanguage,
  {
    adminTag: string;
    monitoring: string;
    signOut: string;
    nav: Record<NavItem["key"], string>;
  }
> = {
  ENG: {
    adminTag: "Admin Command",
    monitoring: "Monitoring Live",
    signOut: "Sign Out",
    nav: {
      dashboard: "Dashboard",
      analytics: "Analytics",
      users: "Users",
      documents: "Documents",
      settings: "Settings",
    },
  },
  HIN: {
    adminTag: "Admin Command",
    monitoring: "Monitoring Live",
    signOut: "Sign Out",
    nav: {
      dashboard: "Dashboard",
      analytics: "Analytics",
      users: "Users",
      documents: "Documents",
      settings: "Settings",
    },
  },
  HING: {
    adminTag: "Admin Command",
    monitoring: "Monitoring Live",
    signOut: "Sign Out",
    nav: {
      dashboard: "Dashboard",
      analytics: "Analytics",
      users: "Users",
      documents: "Documents",
      settings: "Settings",
    },
  },
};

function currentSectionLabel(pathname: string | null, language: AppLanguage) {
  const match = navItems.find(
    (item) =>
      pathname === item.href ||
      (item.href !== "/admin" && pathname?.startsWith(item.href)),
  );
  return match ? COPY[language].nav[match.key] : COPY[language].nav.dashboard;
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, language, setLanguage } = useAuth();

  useEffect(() => {
    if (user === null) return;
    if (user.role !== "admin") {
      router.push("/operator");
    }
  }, [router, user]);

  if (!user) {
    return (
      <div className="app-shell min-h-screen">
        <div className="mx-auto flex min-h-screen max-w-[1580px] items-center justify-center px-3 md:px-4">
          <div className="tfl-panel w-full max-w-md px-8 py-10 text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm font-medium text-muted">
              Loading admin workspace...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (user.role !== "admin") {
    return null;
  }

  return (
    <div className="app-shell min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/90 bg-[rgba(248,251,254,0.92)] backdrop-blur">
        <div className="mx-auto max-w-[1580px] px-3 py-3 md:px-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3.5">
              <Link href="/admin" className="shrink-0">
                <Logo variant="full" size="sm" />
              </Link>
              <div className="hidden h-10 w-px bg-border lg:block" />
              <div className="hidden lg:block">
                <p className="tfl-kicker">{COPY[language].adminTag}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {currentSectionLabel(pathname, language)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="inline-flex items-center rounded-full border border-border bg-white p-1">
                {(["ENG", "HIN", "HING"] as AppLanguage[]).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setLanguage(lang)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                      language === lang
                        ? "bg-primary text-white"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {lang}
                  </button>
                ))}
              </div>
              <div className="hidden items-center gap-2 rounded-full border border-border bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted sm:inline-flex">
                <span className="h-2.5 w-2.5 rounded-full bg-accent" />
                {COPY[language].monitoring}
              </div>
              <button className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-border bg-white text-muted transition-colors hover:border-primary/20 hover:text-primary">
                <NotificationGridIcon className="h-4 w-4" />
              </button>
              <button className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-border bg-white text-muted transition-colors hover:border-primary/20 hover:text-primary">
                <SettingsMatrixIcon className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  logout();
                  router.push("/");
                }}
                className="inline-flex items-center rounded-[10px] border border-border bg-white px-3 py-2 text-[0.82rem] font-semibold text-foreground transition-colors hover:border-danger/20 hover:text-danger"
              >
                {COPY[language].signOut}
              </button>
            </div>
          </div>

          <nav className="mt-3 flex flex-wrap gap-2">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/admin" && pathname?.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`tfl-tab ${isActive ? "tfl-tab-active" : ""}`}
                >
                  <span className={isActive ? "text-primary" : "text-muted"}>
                    {item.icon}
                  </span>
                  <span>{COPY[language].nav[item.key]}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-[1580px] px-3 py-5 md:px-4">
        {children}
      </main>
    </div>
  );
}
