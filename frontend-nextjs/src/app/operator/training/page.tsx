'use client';

import React from 'react';
import Link from 'next/link';
import { OperatorLayout } from '@/components/operator/operator-layout';
import { Card } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const trainingModules = [
  {
    id: 'mod-1',
    title: '23.SOP. Chemical Handling',
    status: 'not-started',
    progress: 0,
    steps: 3,
    dueDate: 'Mar 31, 2026',
    hasAssessment: true,
  },
  {
    id: 'mod-2',
    title: '8-2-Chemical-Sampling-SOP-20220502',
    status: 'not-started',
    progress: 0,
    steps: 3,
    dueDate: 'Mar 31, 2026',
    hasAssessment: true,
  },
  {
    id: 'mod-3',
    title: 'SOPs for hazardous and dangerous manufacturing processes',
    status: 'not-started',
    progress: 0,
    steps: 3,
    dueDate: 'Mar 31, 2026',
    hasAssessment: true,
  },
];

const statusBadge: Record<string, { variant: 'success' | 'warning' | 'default'; label: string }> = {
  'completed': { variant: 'success', label: 'Completed' },
  'in-progress': { variant: 'warning', label: 'In Progress' },
  'not-started': { variant: 'default', label: 'Not Started' },
};

export default function TrainingPage() {
  return (
    <OperatorLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary to-primary-light rounded-xl p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold mb-1">📚 Training & Enablement</h1>
              <p className="text-white/80">Step-by-step guided training modules derived from operational procedures</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-white/70">Overall Progress</p>
              <p className="text-2xl font-bold">40%</p>
            </div>
          </div>
        </div>

        {/* Info Cards */}
        <div className="grid sm:grid-cols-3 gap-4">
          <Card className="!p-4">
            <div className="text-center">
              <span className="text-2xl">🆕</span>
              <p className="text-sm font-medium text-foreground mt-1">New Onboarding</p>
              <p className="text-xs text-muted">Self-paced learning</p>
            </div>
          </Card>
          <Card className="!p-4">
            <div className="text-center">
              <span className="text-2xl">🔄</span>
              <p className="text-sm font-medium text-foreground mt-1">Refresher Training</p>
              <p className="text-xs text-muted">For experienced staff</p>
            </div>
          </Card>
          <Card className="!p-4">
            <div className="text-center">
              <span className="text-2xl">🎙️</span>
              <p className="text-sm font-medium text-foreground mt-1">Voice Guidance</p>
              <p className="text-xs text-muted">Hands-free mode</p>
            </div>
          </Card>
        </div>

        {/* Module List */}
        <div className="grid gap-4">
          {trainingModules.map((module) => {
            const status = statusBadge[module.status];
            return (
              <Card key={module.id} className="!p-0">
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-foreground">{module.title}</h3>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted mb-4">
                        <span>{module.steps} steps</span>
                        <span>•</span>
                        <span>Due: {module.dueDate}</span>
                      </div>
                      <ProgressBar
                        value={module.progress}
                        showLabel={false}
                        color={module.progress === 100 ? 'bg-accent' : module.progress > 0 ? 'bg-primary' : 'bg-muted-light'}
                        height="h-2.5"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Link href={`/operator/training/${module.id}`}>
                        <Button variant="primary" size="sm">
                          {module.status === 'completed' ? 'Review' : module.status === 'in-progress' ? 'Continue' : 'Start'}
                        </Button>
                      </Link>
                      {module.hasAssessment && module.status === 'completed' && (
                        <Link href={`/operator/training/${module.id}/assessment`}>
                          <Button variant="outline" size="sm">
                            Assessment
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </OperatorLayout>
  );
}
