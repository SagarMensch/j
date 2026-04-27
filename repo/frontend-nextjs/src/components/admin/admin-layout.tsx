"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { AppLanguage, useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";
import {
  AnalyticsBarsIcon,
  DashboardBlocksIcon,
  DocumentStackIcon,
  LookupNodesIcon,
  NotificationGridIcon,
  SettingsMatrixIcon,
  UsersClusterIcon,
} from "@/components/ui/icons";

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

interface NavItem {
  key: "dashboard" | "analytics" | "graph" | "users" | "documents" | "settings";
  href: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { key: "dashboard", href: "/admin", icon: <DashboardBlocksIcon /> },
  { key: "analytics", href: "/admin/analytics", icon: <AnalyticsBarsIcon /> },
  { key: "graph", href: "/admin/graph", icon: <LookupNodesIcon /> },
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
      graph: "Knowledge Graph",
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
      graph: "Knowledge Graph",
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
      graph: "Knowledge Graph",
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
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<BackendNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);

  const unreadCount = notifications.filter((item) => !item.is_read).length;

  useEffect(() => {
    if (user === null) return;
    if (user.role !== "admin") {
      router.push("/operator/dashboard");
    }
  }, [router, user]);

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
      // Keep UI stable if marking read fails.
    }
  };

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
        <div className="mx-auto max-w-[1580px] px-3 py-2 md:px-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2.5">
              <Link href="/admin" className="shrink-0">
                <Logo variant="full" size="sm" />
              </Link>
              <div className="hidden h-8 w-px bg-border lg:block" />
              <div className="hidden lg:block">
                <p className="tfl-kicker">{COPY[language].adminTag}</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
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
              <div className="hidden items-center gap-2 rounded-full border border-border bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted sm:inline-flex">
                <span className="h-2.5 w-2.5 rounded-full bg-accent" />
                {COPY[language].monitoring}
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
                  }}
                  className="relative inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-border bg-white text-muted transition-colors hover:border-primary/20 hover:text-primary"
                >
                  <NotificationGridIcon className="h-4 w-4" />
                  {unreadCount > 0 ? (
                    <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                      {unreadCount}
                    </span>
                  ) : null}
                </button>

                {showNotifications ? (
                  <div className="absolute right-0 top-full z-20 mt-2 w-96 rounded-[14px] border border-border bg-white shadow-[0px_18px_44px_rgba(0,25,168,0.12)]">
                    <div className="border-b border-border px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                          Safety and system alerts
                        </p>
                        {unreadCount > 0 ? (
                          <span className="rounded-full bg-danger-light px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-danger">
                            {unreadCount} new
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {notificationsLoading ? (
                        <div className="px-4 py-5 text-sm text-muted">
                          Loading alerts...
                        </div>
                      ) : notifications.length === 0 ? (
                        <div className="px-4 py-5 text-sm text-muted">
                          No alerts yet.
                        </div>
                      ) : (
                        notifications.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => {
                              setShowNotifications(false);
                              if (item.cta_url) {
                                router.push(item.cta_url);
                              }
                            }}
                            className="block w-full border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted-light last:border-b-0"
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
                                <p className="text-sm font-semibold text-foreground">
                                  {item.title}
                                </p>
                                <p className="mt-1 text-xs text-muted">
                                  {item.message}
                                </p>
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
              <Link
                href="/admin/settings"
                className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-border bg-white text-muted transition-colors hover:border-primary/20 hover:text-primary"
              >
                <SettingsMatrixIcon className="h-4 w-4" />
              </Link>
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

          <nav className="mt-2 flex flex-wrap gap-2">
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
