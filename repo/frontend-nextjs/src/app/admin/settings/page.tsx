"use client";

import React, { useEffect, useState } from "react";
import { AdminLayout } from "@/components/admin/admin-layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { apiClient } from "@/lib/api";

type AdminSettings = {
  organization_name: string;
  primary_email: string;
  default_language: string;
  assessment_passing_score: number;
  certification_validity_days: number;
  reminder_frequency: string;
  notifications: {
    emailAlerts: boolean;
    trainingReminders: boolean;
    certExpiry: boolean;
    systemUpdates: boolean;
  };
};

const DEFAULT_SETTINGS: AdminSettings = {
  organization_name: "Jubilant Ingrevia",
  primary_email: "admin@jubilantingrevia.com",
  default_language: "en",
  assessment_passing_score: 70,
  certification_validity_days: 365,
  reminder_frequency: "weekly",
  notifications: {
    emailAlerts: true,
    trainingReminders: true,
    certExpiry: true,
    systemUpdates: false,
  },
};

export default function SettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<AdminSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function loadSettings() {
      try {
        const response = await apiClient.get(
          `/api/admin/settings?user_id=${user.id}`,
        );
        if (!isMounted) return;
        setSettings({ ...DEFAULT_SETTINGS, ...(response?.settings || {}) });
        setError("");
      } catch (err) {
        if (!isMounted) return;
        setError(
          err instanceof Error ? err.message : "Failed to load admin settings.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadSettings();
    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  async function handleSave() {
    if (!user?.id) return;

    setIsSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await apiClient.post("/api/admin/settings", {
        user_id: user.id,
        settings,
      });
      setSettings({ ...DEFAULT_SETTINGS, ...(response?.settings || settings) });
      setMessage("Settings saved successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="space-y-6 max-w-3xl">
          <Card>
            <div className="py-12 text-center text-muted">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p>Loading settings...</p>
            </div>
          </Card>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-3xl">
        <div className="hero-panel p-6">
          <p className="tfl-kicker">Platform Control</p>
          <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-foreground">
            Settings
          </h1>
          <p className="mt-2 text-sm text-muted">
            Configure platform-wide defaults used by the demo environment.
          </p>
        </div>

        {error ? (
          <div className="rounded-lg border border-danger/20 bg-danger-light p-3 text-sm text-danger">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-lg border border-accent/20 bg-accent-light p-3 text-sm text-accent">
            {message}
          </div>
        ) : null}

        <Card title="Organization Settings">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Organization Name
              </label>
              <Input
                value={settings.organization_name}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    organization_name: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Primary Email
              </label>
              <Input
                value={settings.primary_email}
                type="email"
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    primary_email: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Default Language
              </label>
              <select
                className="w-full bg-white border border-border rounded-lg py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={settings.default_language}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    default_language: event.target.value,
                  }))
                }
              >
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="hinglish">Hinglish</option>
              </select>
            </div>
          </div>
        </Card>

        <Card title="Training Settings">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Assessment Passing Score (%)
              </label>
              <Input
                value={String(settings.assessment_passing_score)}
                type="number"
                min="0"
                max="100"
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    assessment_passing_score: Number(event.target.value || 0),
                  }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Certification Validity (days)
              </label>
              <Input
                value={String(settings.certification_validity_days)}
                type="number"
                min="1"
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    certification_validity_days: Number(
                      event.target.value || 0,
                    ),
                  }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Reminder Frequency
              </label>
              <select
                className="w-full bg-white border border-border rounded-lg py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={settings.reminder_frequency}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    reminder_frequency: event.target.value,
                  }))
                }
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
              </select>
            </div>
          </div>
        </Card>

        <Card title="Notification Settings">
          <div className="space-y-4">
            {[
              {
                key: "emailAlerts",
                label: "Email Alerts",
                desc: "Receive important alerts via email",
              },
              {
                key: "trainingReminders",
                label: "Training Reminders",
                desc: "Send reminders for pending training",
              },
              {
                key: "certExpiry",
                label: "Certification Expiry",
                desc: "Alert when certifications are expiring",
              },
              {
                key: "systemUpdates",
                label: "System Updates",
                desc: "Receive system update notifications",
              },
            ].map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between py-2"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {item.label}
                  </p>
                  <p className="text-xs text-muted">{item.desc}</p>
                </div>
                <button
                  onClick={() =>
                    setSettings((current) => ({
                      ...current,
                      notifications: {
                        ...current.notifications,
                        [item.key]:
                          !current.notifications[
                            item.key as keyof AdminSettings["notifications"]
                          ],
                      },
                    }))
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.notifications[
                      item.key as keyof AdminSettings["notifications"]
                    ]
                      ? "bg-primary"
                      : "bg-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.notifications[
                        item.key as keyof AdminSettings["notifications"]
                      ]
                        ? "translate-x-6"
                        : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setSettings(DEFAULT_SETTINGS);
              setMessage("");
              setError("");
            }}
          >
            Reset Defaults
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}
