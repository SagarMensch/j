'use client';

import React, { useState } from 'react';
import { OperatorLayout } from '@/components/operator/operator-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress';

const certificationHistory = [
  { id: 1, module: 'Chemical Handling Safety', status: 'Active', issueDate: 'Aug 15, 2024', expiryDate: 'Aug 15, 2025', score: 92 },
  { id: 2, module: 'Reactor Safety Protocols', status: 'Active', issueDate: 'Jul 20, 2024', expiryDate: 'Jul 20, 2025', score: 88 },
  { id: 3, module: 'Quality Control Standards', status: 'Active', issueDate: 'Jun 10, 2024', expiryDate: 'Jun 10, 2025', score: 85 },
  { id: 4, module: 'Emergency Response', status: 'Expiring Soon', issueDate: 'Oct 10, 2023', expiryDate: 'Oct 10, 2024', score: 90 },
  { id: 5, module: 'Data Privacy Policy', status: 'Expired', issueDate: 'Jan 5, 2023', expiryDate: 'Jan 5, 2024', score: 78 },
];

const assessmentHistory = [
  { id: 1, module: 'Chemical Handling Safety', date: 'Aug 15, 2024', score: 92, passed: true },
  { id: 2, module: 'Reactor Safety Protocols', date: 'Jul 20, 2024', score: 88, passed: true },
  { id: 3, module: 'Quality Control Standards', date: 'Jun 10, 2024', score: 85, passed: true },
  { id: 4, module: 'Emergency Response', date: 'Oct 10, 2023', score: 90, passed: true },
  { id: 5, module: 'Data Privacy Policy', date: 'Jan 5, 2023', score: 65, passed: false },
];

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<'certifications' | 'assessments'>('certifications');

  return (
    <OperatorLayout>
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Page Title */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Reports</h1>
            <p className="text-muted text-sm mt-1">View your certifications and assessment history</p>
          </div>
          <Button variant="secondary">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Report
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid sm:grid-cols-3 gap-4">
          <Card>
            <div className="text-center">
              <p className="text-3xl font-bold text-accent">4</p>
              <p className="text-sm text-muted">Active Certifications</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-3xl font-bold text-primary">87%</p>
              <p className="text-sm text-muted">Average Score</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-3xl font-bold text-warning">1</p>
              <p className="text-sm text-muted">Expiring Soon</p>
            </div>
          </Card>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 border-b border-border">
          <button
            onClick={() => setActiveTab('certifications')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'certifications'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            Certifications
          </button>
          <button
            onClick={() => setActiveTab('assessments')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'assessments'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            Assessment History
          </button>
        </div>

        {/* Content */}
        {activeTab === 'certifications' ? (
          <Card className="!p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted-light">
                    <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Module</th>
                    <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Status</th>
                    <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Issue Date</th>
                    <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Expiry Date</th>
                    <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {certificationHistory.map((cert) => (
                    <tr key={cert.id} className="hover:bg-muted-light/50 transition-colors">
                      <td className="px-4 py-3 text-sm font-medium text-foreground">{cert.module}</td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            cert.status === 'Active' ? 'success' :
                            cert.status === 'Expiring Soon' ? 'warning' : 'danger'
                          }
                        >
                          {cert.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted">{cert.issueDate}</td>
                      <td className="px-4 py-3 text-sm text-muted">{cert.expiryDate}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-primary">{cert.score}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card className="!p-0">
            <div className="divide-y divide-border">
              {assessmentHistory.map((assessment) => (
                <div key={assessment.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{assessment.module}</p>
                    <p className="text-xs text-muted">{assessment.date}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className={`text-lg font-bold ${assessment.passed ? 'text-accent' : 'text-danger'}`}>
                        {assessment.score}%
                      </p>
                      <Badge variant={assessment.passed ? 'success' : 'danger'} size="sm">
                        {assessment.passed ? 'Passed' : 'Failed'}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </OperatorLayout>
  );
}
