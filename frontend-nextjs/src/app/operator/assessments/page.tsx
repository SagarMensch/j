'use client';

import React from 'react';
import Link from 'next/link';
import { OperatorLayout } from '@/components/operator/operator-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/progress';
import { useAuth } from '@/lib/auth-context';

// Simulated data - would come from GET /api/assessments/{assessment_id}?user_id={operator_id}
const assessments = [
  { 
    id: 'asm-1', 
    moduleId: 'mod-1', 
    title: 'Chemical Handling Assessment', 
    subtitle: '23.SOP. Chemical Handling',
    status: 'available', 
    score: null, 
    date: null,
    questions: 3,
    passingScore: 70
  },
  { 
    id: 'asm-2', 
    moduleId: 'mod-2', 
    title: 'Chemical Sampling Assessment', 
    subtitle: '8-2-Chemical-Sampling-SOP-20220502',
    status: 'available', 
    score: null, 
    date: null,
    questions: 3,
    passingScore: 70
  },
  { 
    id: 'asm-3', 
    moduleId: 'mod-3', 
    title: 'Hazardous Manufacturing Safety Assessment', 
    subtitle: 'SOPs for hazardous and dangerous manufacturing processes',
    status: 'available', 
    score: null, 
    date: null,
    questions: 3,
    passingScore: 70
  },
];

export default function AssessmentsPage() {
  const { user } = useAuth();

  const passedCount = assessments.filter(a => a.status === 'passed').length;
  const availableCount = assessments.filter(a => a.status === 'available').length;

  return (
    <OperatorLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Page Header */}
        <div className="bg-gradient-to-r from-primary to-primary-light rounded-xl p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold mb-1">✅ Assessments</h1>
              <p className="text-white/80">Post-training quizzes and assessments to demonstrate understanding and readiness</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-white/70">Operator</p>
              <p className="font-semibold">{user?.name || 'User'}</p>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid sm:grid-cols-3 gap-4">
          <Card className="!p-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{passedCount}</p>
                <p className="text-sm text-muted">Passed</p>
              </div>
            </div>
          </Card>
          <Card className="!p-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{availableCount}</p>
                <p className="text-sm text-muted">Available</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Assessments List */}
        <div className="space-y-4">
          {assessments.map((assessment) => (
            <Card key={assessment.id} className="!p-0">
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-foreground">{assessment.title}</h3>
                      <Badge variant="info">Available</Badge>
                    </div>
                    {assessment.subtitle && (
                      <p className="text-sm text-muted mb-2">{assessment.subtitle}</p>
                    )}
                    
                    <div className="flex items-center gap-6 text-sm text-muted">
                      <span>{assessment.questions} questions</span>
                      <span>•</span>
                      <span>Passing score: {assessment.passingScore}%</span>
                      {assessment.score && (
                        <>
                          <span>•</span>
                          <span className="text-accent font-semibold">Your score: {assessment.score}%</span>
                        </>
                      )}
                      {assessment.date && (
                        <>
                          <span>•</span>
                          <span>Completed: {assessment.date}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Link href={`/operator/training/${assessment.moduleId}/assessment`}>
                      <Button variant="primary">
                        Take Assessment
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Readiness Verification Info */}
        <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-medium text-foreground">Readiness Verification</p>
              <p className="text-sm text-muted">Complete training modules before taking assessments. Passing assessments earns certifications for plant operations.</p>
            </div>
          </div>
        </div>

        {/* API Reference */}
        <Card className="!bg-muted-light">
          <div className="text-xs font-mono space-y-1">
            <p className="font-semibold text-foreground">API Endpoints:</p>
            <p className="text-muted">• GET /api/assessments/&#123;assessment_id&#125;?user_id={user?.id}</p>
            <p className="text-muted">• POST /api/assessments/&#123;assessment_id&#125;/submit</p>
          </div>
        </Card>
      </div>
    </OperatorLayout>
  );
}
