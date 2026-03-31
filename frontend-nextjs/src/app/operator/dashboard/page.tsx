'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { OperatorLayout } from '@/components/operator/operator-layout';
import { Card, KpiCard } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { trackEvent } from '@/lib/telemetry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionType = any;

const myStats = {
  completedTraining: 8,
  pendingTraining: 4,
  certifications: 6,
  assessmentScore: 87,
};

const mandatoryTraining = [
  { id: 'mod-2', module: 'Reactor Safety Protocols', dueDate: 'Oct 15, 2024', daysLeft: 5, progress: 60 },
  { id: 'mod-3', module: 'Emergency Response Procedures', dueDate: 'Nov 1, 2024', daysLeft: 21, progress: 0 },
  { id: 'mod-4', module: 'Quality Control Standards', dueDate: 'Nov 21, 2024', daysLeft: 41, progress: 0 },
];

const recentSOPs = [
  { code: 'SOP-CHEM-042', title: 'Centrifuge Operations', lastUpdated: 'Oct 8, 2024', revision: 'R3' },
  { code: 'SOP-REACT-101', title: 'Reactor Startup Procedures', lastUpdated: 'Oct 5, 2024', revision: 'R2' },
  { code: 'SOP-SAF-015', title: 'Emergency Shutdown Protocol', lastUpdated: 'Oct 1, 2024', revision: 'R4' },
];

const safetyAlerts = [
  { id: 1, title: 'Chemical Spill Response Update', priority: 'high', date: 'Oct 10, 2024', department: 'Production' },
  { id: 2, title: 'New PPE Requirements - Reactor Section', priority: 'high', date: 'Oct 9, 2024', department: 'All' },
  { id: 3, title: 'Scheduled Maintenance - Cooling System', priority: 'medium', date: 'Oct 8, 2024', department: 'Logistics' },
];

const sessionResume = {
  moduleName: 'Reactor Safety Protocols',
  stepNumber: 3,
  totalSteps: 8,
  lastAccessed: '2 hours ago',
};

export default function OperatorDashboard() {
  const router = useRouter();
  const { user, language } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([
    'Centrifuge restart procedure',
    'PPE requirements for reactor',
    'Emergency shutdown steps',
  ]);
  const recognitionRef = useRef<SpeechRecognitionType | null>(null);

  useEffect(() => {
    // Store user info for telemetry
    if (user) {
      localStorage.setItem('user_id', user.id);
      localStorage.setItem('user_role', user.role);
      localStorage.setItem('language', language);
    }
  }, [user, language]);

  const handleSearch = () => {
    if (!searchQuery.trim()) return;
    
    trackEvent('ui.query_submitted', { query: searchQuery });
    
    // Add to recent searches
    setRecentSearches(prev => [searchQuery, ...prev.slice(0, 2)]);
    
    // Navigate to knowledge base with query
    router.push(`/operator/knowledge?q=${encodeURIComponent(searchQuery)}`);
  };

  const handleVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Voice input is not supported in your browser. Please use Chrome or Edge.');
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = false;
    recognitionRef.current.interimResults = false;
    recognitionRef.current.lang = language === 'HIN' ? 'hi-IN' : language === 'HING' ? 'hi-IN' : 'en-IN';

    recognitionRef.current.onstart = () => setIsListening(true);
    recognitionRef.current.onend = () => setIsListening(false);
    recognitionRef.current.onresult = (event: SpeechRecognitionType) => {
      const transcript = event.results[0][0].transcript;
      setSearchQuery(transcript);
      setIsListening(false);
    };

    recognitionRef.current.start();
  };

  return (
    <OperatorLayout>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* AI Search / Voice Command Bar */}
        <Card className="!p-0 overflow-hidden">
          <div className="p-4 bg-gradient-to-r from-primary/5 to-primary/10">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <h2 className="text-lg font-semibold text-foreground">AI Command Center</h2>
            </div>
            
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder="Ask about SOPs, procedures, or say 'Hey Assistant'..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="w-full px-4 py-3 pr-12 rounded-lg border border-border bg-white text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <button
                  onClick={handleVoiceInput}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all ${
                    isListening 
                      ? 'bg-danger text-white animate-pulse' 
                      : 'text-muted hover:text-primary hover:bg-primary/10'
                  }`}
                  title={isListening ? 'Listening... Click to stop' : 'Voice input'}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </button>
              </div>
              <Button variant="primary" onClick={handleSearch} className="px-6">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </Button>
            </div>

            {/* Recent searches */}
            {recentSearches.length > 0 && (
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <span className="text-xs text-muted">Recent:</span>
                {recentSearches.map((search, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSearchQuery(search)}
                    className="text-xs px-2 py-1 bg-white/60 hover:bg-white rounded-full text-muted hover:text-primary transition-colors"
                  >
                    {search}
                  </button>
                ))}
              </div>
            )}

            {isListening && (
              <div className="flex items-center gap-2 mt-3 text-sm text-danger">
                <div className="w-2 h-2 bg-danger rounded-full animate-pulse" />
                Listening... Speak your question now
              </div>
            )}
          </div>
        </Card>

        {/* Session Resume */}
        {sessionResume && (
          <Card className="!p-0 overflow-hidden border-primary/30 bg-primary/5">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
                  <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Resume Training</p>
                  <p className="text-sm text-muted">{sessionResume.moduleName} - Step {sessionResume.stepNumber} of {sessionResume.totalSteps}</p>
                  <p className="text-xs text-muted">Last accessed: {sessionResume.lastAccessed}</p>
                </div>
              </div>
              <Link href={`/operator/training/mod-2?step=${sessionResume.stepNumber}`}>
                <Button variant="primary" size="sm">Continue</Button>
              </Link>
            </div>
          </Card>
        )}

        {/* Stats Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Completed Training"
            value={myStats.completedTraining}
            subtitle="Modules finished"
            color="text-accent"
          />
          <KpiCard
            title="Pending Training"
            value={myStats.pendingTraining}
            subtitle="Due this month"
            color="text-warning"
          />
          <KpiCard
            title="Certifications"
            value={myStats.certifications}
            subtitle="Active certifications"
            color="text-primary"
          />
          <KpiCard
            title="Avg. Score"
            value={`${myStats.assessmentScore}%`}
            subtitle="Across all assessments"
            color="text-primary"
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* My Mandatory Training */}
          <Card title="My Mandatory Training" className="lg:col-span-2">
            <div className="space-y-3">
              {mandatoryTraining.map((item, idx) => (
                <Link key={idx} href={`/operator/training/${item.id}`}>
                  <div className="flex items-center justify-between p-3 bg-muted-light/50 hover:bg-muted-light rounded-lg transition-colors cursor-pointer">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium text-foreground">{item.module}</p>
                        {item.daysLeft <= 7 && (
                          <Badge variant="danger" size="sm">Urgent</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <ProgressBar value={item.progress} showLabel={false} color="bg-primary" height="h-1.5" className="flex-1 max-w-[100px]" />
                        <span className="text-xs text-muted">{item.progress}%</span>
                      </div>
                    </div>
                    <div className="text-right ml-4">
                      <p className="text-xs text-muted">Due: {item.dueDate}</p>
                      <p className={`text-xs font-medium ${item.daysLeft <= 7 ? 'text-danger' : 'text-muted'}`}>
                        {item.daysLeft} days left
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            <Link href="/operator/training" className="block mt-4">
              <Button variant="ghost" size="sm" className="w-full">
                View All Training
              </Button>
            </Link>
          </Card>

          {/* Safety Alerts */}
          <Card title="Safety Alerts" className="!border-l-4 !border-l-danger">
            <div className="space-y-3">
              {safetyAlerts.map((alert) => (
                <div key={alert.id} className="p-3 border border-border rounded-lg hover:border-primary/50 transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <Badge variant={alert.priority === 'high' ? 'danger' : 'warning'} size="sm">
                      {alert.priority === 'high' ? 'High Priority' : 'Medium'}
                    </Badge>
                    <span className="text-xs text-muted">{alert.date}</span>
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">{alert.title}</p>
                  <p className="text-xs text-muted">Department: {alert.department}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Recent SOPs */}
        <Card title="Recent SOPs">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentSOPs.map((sop, idx) => (
              <Link key={idx} href={`/operator/knowledge?sop=${sop.code}`}>
                <div className="p-4 border border-border rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">{sop.code}</span>
                    <Badge variant="default" size="sm">{sop.revision}</Badge>
                  </div>
                  <h4 className="text-sm font-medium text-foreground mb-1">{sop.title}</h4>
                  <p className="text-xs text-muted">Updated: {sop.lastUpdated}</p>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </OperatorLayout>
  );
}
