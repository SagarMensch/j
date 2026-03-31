'use client';

import React, { useState } from 'react';
import { AdminLayout } from '@/components/admin/admin-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function SettingsPage() {
  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    trainingReminders: true,
    certExpiry: true,
    systemUpdates: false,
  });

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-muted text-sm mt-1">Configure platform settings and preferences</p>
        </div>

        {/* Organization Settings */}
        <Card title="Organization Settings">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Organization Name</label>
              <Input defaultValue="Jubilant Ingrevia" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Primary Email</label>
              <Input defaultValue="admin@jubilantingrevia.com" type="email" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Default Language</label>
              <select className="w-full bg-white border border-border rounded-lg py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="hinglish">Hinglish</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Training Settings */}
        <Card title="Training Settings">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Assessment Passing Score (%)</label>
              <Input defaultValue="70" type="number" min="0" max="100" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Certification Validity (days)</label>
              <Input defaultValue="365" type="number" min="1" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Reminder Frequency</label>
              <select className="w-full bg-white border border-border rounded-lg py-2.5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Notification Settings */}
        <Card title="Notification Settings">
          <div className="space-y-4">
            {[
              { key: 'emailAlerts', label: 'Email Alerts', desc: 'Receive important alerts via email' },
              { key: 'trainingReminders', label: 'Training Reminders', desc: 'Send reminders for pending training' },
              { key: 'certExpiry', label: 'Certification Expiry', desc: 'Alert when certifications are expiring' },
              { key: 'systemUpdates', label: 'System Updates', desc: 'Receive system update notifications' },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <p className="text-xs text-muted">{item.desc}</p>
                </div>
                <button
                  onClick={() => setNotifications((prev) => ({ ...prev, [item.key]: !prev[item.key as keyof typeof prev] }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    notifications[item.key as keyof typeof notifications] ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      notifications[item.key as keyof typeof notifications] ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Button variant="secondary">Cancel</Button>
          <Button variant="primary">Save Settings</Button>
        </div>
      </div>
    </AdminLayout>
  );
}
