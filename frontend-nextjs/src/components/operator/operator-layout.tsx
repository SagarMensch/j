"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  AssessmentShieldIcon,
  DocumentStackIcon,
  LookupNodesIcon,
  NotificationGridIcon,
  TrainingStepsIcon,
  UserBadgeIcon,
} from "@/components/ui/icons";

type NavKey = "lookup" | "training" | "assessments" | "reports";

type NavItem = {
  key: NavKey;
  href: string;
  icon: React.ReactNode;
};

type BackendNotification = {
  id: string;
  event_type: string;
  severity: string;
  title: string;
  message: string;
  cta_url?: string | null;
  status: string;
  is_read: boolean;
  created_at?: string | null;
  read_at?: string | null;
};

type LayoutCopy = {
  workspaceTag: string;
  signedInTag: string;
  notificationsTag: string;
  supportLabel: string;
  certLabel: string;
  signOutLabel: string;
  monitoringLabel: string;
  footerLabel: string;
  nav: Record<NavKey, string>;
};

const NAV_ITEMS: NavItem[] = [
  { key: "lookup", href: "/operator", icon: <LookupNodesIcon /> },
  { key: "training", href: "/operator/training", icon: <TrainingStepsIcon /> },
  {
    key: "assessments",
    href: "/operator/assessments",
    icon: <AssessmentShieldIcon />,
  },
  { key: "reports", href: "/operator/reports", icon: <DocumentStackIcon /> },
];

const COPY: Record<AppLanguage, LayoutCopy> = {
  ENG: {
    workspaceTag: "Operator Workspace",
    signedInTag: "Signed In",
    notificationsTag: "Notifications",
    supportLabel: "Help and Support",
    certLabel: "My Certifications",
    signOutLabel: "Sign Out",
    monitoringLabel: "Shift Monitoring Live",
    footerLabel: "Jubilant Ingrevia",
    nav: {
      lookup: "Command Hub",
      training: "Training",
      assessments: "Assessments",
      reports: "Reports",
    },
  },
  HIN: {
    workspaceTag: "Operator Kendra",
    signedInTag: "Login",
    notificationsTag: "Suchna",
    supportLabel: "Madad",
    certLabel: "Mere Certificate",
    signOutLabel: "Sign Out",
    monitoringLabel: "Shift Tracking Live",
    footerLabel: "Jubilant Ingrevia",
    nav: {
      lookup: "SOP Hub",
      training: "Prashikshan",
      assessments: "Pariksha",
      reports: "Report",
    },
  },
  HING: {
    workspaceTag: "Operator Workspace",
    signedInTag: "Signed In",
    notificationsTag: "Notifs",
    supportLabel: "Madad",
    certLabel: "Mere Certs",
    signOutLabel: "Sign Out",
    monitoringLabel: "Shift Live",
    footerLabel: "Jubilant Ingrevia",
    nav: {
      lookup: "SOP Hub",
      training: "Training",
      assessments: "Quiz",
      reports: "Reports",
    },
  },
};

function currentSection(pathname: string | null, language: AppLanguage) {
  if (
    pathname === "/operator" ||
    pathname?.startsWith("/operator/reader") ||
    pathname?.startsWith("/operator/knowledge")
  ) {
    return COPY[language].nav.lookup;
  }

  const selected =
    NAV_ITEMS.find(
      (item) =>
        pathname === item.href ||
        (item.href !== "/operator" && pathname?.startsWith(item.href)),
    )?.key || "lookup";
  return COPY[language].nav[selected];
}

export function OperatorLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, language, setLanguage, logout } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [notifications, setNotifications] = useState<BackendNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const copy = COPY[language];
  const unreadCount = notifications.filter((item) => !item.is_read).length;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (isMounted && user && user.role !== "operator") {
      router.push("/admin");
    }
  }, [isMounted, router, user]);

  useEffect(() => {
    if (!user?.id) {
      setNotifications([]);
      return;
    }

    let cancelled = false;

    const loadNotifications = async () => {
      setNotificationsLoading(true);
      try {
        const payload = (await apiClient.get(
          `/api/notifications?user_id=${encodeURIComponent(user.id)}&limit=20`,
        )) as { notifications?: BackendNotification[] };
        if (!cancelled) {
          setNotifications(payload.notifications || []);
        }
      } catch {
        if (!cancelled) {
          setNotifications([]);
        }
      } finally {
        if (!cancelled) {
          setNotificationsLoading(false);
        }
      }
    };

    void loadNotifications();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const headerTitle = useMemo(
    () => currentSection(pathname, language),
    [pathname, language],
  );

  const markAllNotificationsRead = async () => {
    if (!user?.id) return;
    if (!notifications.some((item) => !item.is_read)) return;

    const nowIso = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((item) =>
        item.is_read
          ? item
          : { ...item, is_read: true, status: "read", read_at: nowIso },
      ),
    );

    try {
      await apiClient.post("/api/notifications/read-all", {
        user_id: user.id,
      });
    } catch {
      // Keep local UI state stable if the endpoint is missing.
    }
  };

  if (!isMounted || !user) {
    return (
      <div className="app-shell min-h-screen">
        <div className="mx-auto flex min-h-screen max-w-[1580px] items-center justify-center px-3 md:px-4">
          <div className="tfl-panel w-full max-w-md px-8 py-10 text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm font-medium text-muted">
              Loading operator workspace...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (user.role !== "operator") {
    return null;
  }

  return (
    <div className="app-shell min-h-screen" data-language={language}>
      <header className="sticky top-0 z-40 border-b border-border/90 bg-[rgba(248,251,254,0.92)] backdrop-blur">
        <div className="mx-auto max-w-[1580px] px-3 py-3 md:px-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3.5">
              <Link href="/operator" className="shrink-0">
                <Logo variant="full" size="sm" />
              </Link>
              <div className="hidden h-10 w-px bg-border lg:block" />
              <div className="hidden lg:block">
                <p className="tfl-kicker">{copy.workspaceTag}</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {headerTitle}
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

              <div className="relative">
                <button
                  onClick={() => {
                    setShowNotifications((value) => {
                      const nextValue = !value;
                      if (nextValue) {
                        void markAllNotificationsRead();
                      }
                      return nextValue;
                    });
                    setShowProfileMenu(false);
                  }}
                  className="relative inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-border bg-white text-muted transition-colors hover:border-primary/20 hover:text-primary"
                >
                  <NotificationGridIcon className="h-4 w-4" />
                  {unreadCount > 0 ? (
                    <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">
                      {unreadCount}
                    </span>
                  ) : null}
                </button>

                {showNotifications ? (
                  <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-[14px] border border-border bg-white shadow-[0px_18px_44px_rgba(0,25,168,0.12)]">
                    <div className="border-b border-border px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                        {copy.notificationsTag}
                      </p>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notificationsLoading ? (
                        <div className="px-4 py-5 text-sm text-muted">
                          Loading...
                        </div>
                      ) : notifications.length === 0 ? (
                        <div className="px-4 py-5 text-sm text-muted">
                          No notifications.
                        </div>
                      ) : (
                        notifications.map((item) => (
                          <div
                            key={item.id}
                            className="border-b border-border px-4 py-3 last:border-b-0"
                          >
                            <div className="flex items-start gap-3">
                              <div
                                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                                  item.severity === "high"
                                    ? "bg-danger"
                                    : item.severity === "medium"
                                      ? "bg-warning"
                                      : "bg-accent"
                                }`}
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">
                                  {item.title}
                                </p>
                                <p className="mt-1 text-xs text-muted">
                                  {item.message}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="relative">
                <button
                  onClick={() => {
                    setShowProfileMenu((value) => !value);
                    setShowNotifications(false);
                  }}
                  className="inline-flex items-center gap-2 rounded-[10px] border border-border bg-white px-2.5 py-1.5 text-left transition-colors hover:border-primary/20"
                >
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#f3f7fb] text-primary">
                    <UserBadgeIcon className="h-4 w-4" />
                  </span>
                  <div className="hidden sm:block">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                      {copy.signedInTag}
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      {user.name}
                    </p>
                  </div>
                </button>

                {showProfileMenu ? (
                  <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-[14px] border border-border bg-white shadow-[0px_18px_44px_rgba(0,25,168,0.12)]">
                    <div className="border-b border-border px-4 py-3">
                      <p className="text-sm font-semibold text-foreground">
                        {user.name}
                      </p>
                      <p className="mt-1 text-xs text-muted">{user.email}</p>
                      <Badge variant="info" size="sm" className="mt-3">
                        {user.role}
                      </Badge>
                    </div>
                    <div className="p-2">
                      <button className="w-full rounded-[10px] px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted-light">
                        Profile
                      </button>
                      <button className="w-full rounded-[10px] px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted-light">
                        {copy.certLabel}
                      </button>
                      <button className="w-full rounded-[10px] px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted-light">
                        {copy.supportLabel}
                      </button>
                      <div className="my-1 border-t border-border" />
                      <button
                        onClick={() => {
                          logout();
                          router.push("/");
                        }}
                        className="w-full rounded-[10px] px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger-light"
                      >
                        {copy.signOutLabel}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.key === "lookup"
                  ? pathname === item.href ||
                    pathname?.startsWith("/operator/reader") ||
                    pathname?.startsWith("/operator/knowledge")
                  : pathname === item.href || pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`tfl-tab ${isActive ? "tfl-tab-active" : ""}`}
                >
                  <span className={isActive ? "text-primary" : "text-muted"}>
                    {item.icon}
                  </span>
                  <span>{copy.nav[item.key]}</span>
                </Link>
              );
            })}
            <div className="hidden items-center gap-2 rounded-full border border-border bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted md:inline-flex md:ml-auto">
              <span className="h-2.5 w-2.5 rounded-full bg-accent" />
              {copy.monitoringLabel}
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-[1580px] px-3 py-4 md:px-4">
        {children}
      </main>
    </div>
  );
}
