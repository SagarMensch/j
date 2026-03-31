'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { OperatorLayout } from '@/components/operator/operator-layout';
import { Card } from '@/components/ui/card';
import { StepProgress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { trackEvent } from '@/lib/telemetry';
import { useAuth } from '@/lib/auth-context';

// SpeechRecognition types
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const moduleData: Record<string, {
  title: string;
  steps: { id: number; title: string; content: string; citation: string; page: number }[];
}> = {
  'mod-1': {
    title: '23.SOP. Chemical Handling',
    steps: [
      { id: 1, title: 'Maximum Container Capacity', content: 'Key Safety Rule: The maximum capacity of a chemical container that is permitted to be hand-carried around the site is **20 litres**.\n\n• Containers exceeding 20 litres must be moved using appropriate mechanical aids\n• Always use proper lifting techniques\n• Ensure containers are properly sealed before transport', citation: '23.SOP. Chemical Handling', page: 1 },
      { id: 2, title: 'Respiratory PPE Requirements', content: 'Required PPE for offloading, storing, and decanting hazardous materials:\n\n• A suitably rated respirator (NOT a dust mask)\n• Respirator must be appropriate for the specific chemical hazard\n• Regular fit testing and maintenance required\n• Dust masks are NOT acceptable for hazardous materials', citation: '23.SOP. Chemical Handling', page: 1 },
      { id: 3, title: 'Empty Container Handling', content: 'All empty chemical containers must be:\n\n• Stored in specially demarcated and labelled areas\n• Never reused for any other purpose\n• Properly decontaminated before disposal\n• Kept separate from operational containers\n• Handled according to waste management procedures', citation: '23.SOP. Chemical Handling', page: 1 },
    ],
  },
  'mod-2': {
    title: '8-2-Chemical-Sampling-SOP-20220502',
    steps: [
      { id: 1, title: 'Stream Safety Assessment', content: 'The "Rule of Ten" for wading safety:\n\n• Multiply depth (in feet) by velocity (in ft/s)\n• If the product equals or exceeds 10, the stream is too dangerous to wade\n• Example: 2 ft depth × 5 ft/s = 10 (at the limit)\n• Always use alternative sampling methods when unsafe', citation: '8-2-Chemical-Sampling-SOP-20220502', page: 1 },
      { id: 2, title: 'Sample Holding Times', content: 'Maximum holding times for preserved samples:\n\n• Dissolved metals (excluding mercury, boron, chromium VI): 6 months\n• Preserved with concentrated nitric acid\n• Proper temperature control required\n• Always check holding time before sample collection', citation: '8-2-Chemical-Sampling-SOP-20220502', page: 1 },
      { id: 3, title: 'Quality Control Blanks', content: 'Trip Blank characteristics:\n\n• Prepared at the analytical facility\n• Transported WITH the environmental samples\n• Never exposed to ambient conditions at sampling site\n• Checks for contamination during transport only\n• Different from field blanks (exposed to site conditions)', citation: '8-2-Chemical-Sampling-SOP-20220502', page: 1 },
    ],
  },
  'mod-3': {
    title: 'SOPs for Hazardous Manufacturing Processes',
    steps: [
      { id: 1, title: 'Emergency Shower Water Supply', content: 'For factories with electrolytic plating or oxidation:\n\n• Required storage tank capacity: 1500 litres\n• Must provide continuous clean water supply\n• For emergency shower and eye fountain\n• Water must be readily accessible at all times\n• Regular testing of emergency equipment required', citation: 'SOPs for hazardous manufacturing processes', page: 1 },
      { id: 2, title: 'Noise Exposure Limits', content: 'Maximum permissible sound pressure levels:\n\n• Continuous 8-hour exposure: 90 dBA\n• Higher levels require hearing protection\n• Regular monitoring required\n• Engineering controls preferred over PPE\n• Document exposure levels in safety records', citation: 'SOPs for hazardous manufacturing processes', page: 1 },
      { id: 3, title: 'Aerated Waters Protection', content: 'For manufacture of aerated waters, workers filling bottles or syphons must be provided with:\n\n• Suitable gauntlets to protect arms and hands\n• Gauntlets must be in good condition\n• Regular inspection and replacement\n• Protection from glass shards and chemical exposure', citation: 'SOPs for hazardous manufacturing processes', page: 1 },
    ],
  },
};

export default function TrainingModulePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const moduleId = params.moduleId as string;
  const module = moduleData[moduleId] || moduleData['mod-1'];
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(false);
  const [inactivityWarning, setInactivityWarning] = useState(false);
  const { language } = useAuth();

  // Get step from URL if available
  useEffect(() => {
    const stepParam = searchParams.get('step');
    if (stepParam) {
      const step = parseInt(stepParam, 10) - 1;
      if (step >= 0 && step < module.steps.length) {
        setCurrentStepIndex(step);
      }
    }
  }, [searchParams, module.steps.length]);

  const currentStep = module.steps[currentStepIndex];

  // Track step advancement
  const advanceStep = useCallback((newIndex: number) => {
    setCurrentStepIndex(newIndex);
    trackEvent('ui.training_step_advanced', {
      moduleId,
      stepNumber: newIndex + 1,
      totalSteps: module.steps.length,
    });
    if (autoPlayEnabled) {
      setTimeout(() => handleSpeak(), 500);
    }
  }, [moduleId, module.steps.length, autoPlayEnabled]);

  // Inactivity timeout (2 minutes)
  useEffect(() => {
    const inactivityTimer = setTimeout(() => {
      setInactivityWarning(true);
    }, 120000);

    const resetInactivity = () => {
      setInactivityWarning(false);
      clearTimeout(inactivityTimer);
    };

    window.addEventListener('click', resetInactivity);
    window.addEventListener('keydown', resetInactivity);

    return () => {
      clearTimeout(inactivityTimer);
      window.removeEventListener('click', resetInactivity);
      window.removeEventListener('keydown', resetInactivity);
    };
  }, []);

  const handleSpeak = useCallback(() => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(currentStep.content);
      utterance.lang = language === 'HIN' ? 'hi-IN' : language === 'HING' ? 'hi-IN' : 'en-IN';
      utterance.rate = 0.9;
      speechSynthesis.cancel();
      setIsPlaying(true);
      
      utterance.onend = () => {
        setIsPlaying(false);
      };
      
      speechSynthesis.speak(utterance);
    }
  }, [currentStep.content, language]);

  const handleStopSpeak = () => {
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
      setIsPlaying(false);
    }
  };

  // Voice command handling
  const handleVoiceCommand = () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Voice commands not supported in this browser.');
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    setIsListening(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = language === 'HIN' ? 'hi-IN' : 'en-IN';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      setIsListening(false);

      if (transcript.includes('next') || transcript.includes('aage')) {
        if (currentStepIndex < module.steps.length - 1) {
          advanceStep(currentStepIndex + 1);
        }
      } else if (transcript.includes('back') || transcript.includes('peeche') || transcript.includes('previous')) {
        if (currentStepIndex > 0) {
          advanceStep(currentStepIndex - 1);
        }
      } else if (transcript.includes('repeat') || transcript.includes('dobara') || transcript.includes('phir se')) {
        handleSpeak();
      } else if (transcript.includes('pause') || transcript.includes('ruk')) {
        handleStopSpeak();
      }
    };

    (recognition as unknown as { onerror: () => void }).onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  // Check if this is the final step
  const isLastStep = currentStepIndex === module.steps.length - 1;

  const handleComplete = () => {
    trackEvent('ui.training_module_completed', {
      moduleId,
      totalSteps: module.steps.length,
    });
    // Navigate to assessment
    window.location.href = `/operator/training/${moduleId}/assessment`;
  };

  return (
    <OperatorLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header with Progress */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Link href="/operator/training" className="text-muted hover:text-primary">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                {module.title}
              </h1>
            </div>
            <Link href={`/operator/training/${moduleId}/assessment`}>
              <Button variant="outline" size="sm">
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Assessment
              </Button>
            </Link>
          </div>
          <StepProgress currentStep={currentStepIndex} totalSteps={module.steps.length} />
        </div>

        {/* Inactivity Warning */}
        {inactivityWarning && (
          <div className="mb-4 p-4 bg-warning-light border border-warning/30 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-foreground">Session inactive for 2 minutes. Would you like to continue?</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setInactivityWarning(false)}>
                Continue
              </Button>
              <Link href="/operator/training">
                <Button variant="ghost" size="sm">Exit</Button>
              </Link>
            </div>
          </div>
        )}

        {/* Content Grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Key Learnings Summary */}
          <Card
            title="Key Learnings Summary"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            }
          >
            <ul className="space-y-3">
              {module.steps.map((step, idx) => (
                <li key={step.id} className="flex items-start gap-2 text-sm">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                    idx < currentStepIndex ? 'bg-accent text-white' :
                    idx === currentStepIndex ? 'bg-primary text-white' :
                    'bg-muted-light text-muted'
                  }`}>
                    {idx < currentStepIndex ? '✓' : idx + 1}
                  </span>
                  <span className={idx === currentStepIndex ? 'font-medium text-foreground' : 'text-muted'}>
                    {step.title}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          {/* Current Step Content */}
          <div className="lg:col-span-2">
            <Card className="!p-0">
              {/* Step Header */}
              <div className="p-4 border-b border-border bg-muted-light">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="info">
                        Step {currentStep.id} of {module.steps.length}
                      </Badge>
                      <h3 className="text-lg font-semibold text-foreground">{currentStep.title}</h3>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span>{currentStep.citation}</span>
                    <span>|</span>
                    <span>Page {currentStep.page}</span>
                  </div>
                </div>
              </div>

              {/* Step Content */}
              <div className="p-4">
                <div className="bg-muted-light rounded-lg p-4 mb-4 min-h-[200px]">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed">
                    {currentStep.content}
                  </pre>
                </div>

                {/* Voice Listening Indicator */}
                {isListening && (
                  <div className="mb-4 p-3 bg-primary/10 border border-primary/30 rounded-lg flex items-center gap-3">
                    <div className="relative">
                      <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                      </div>
                      <div className="absolute inset-0 bg-primary rounded-full animate-ping opacity-25" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Listening for voice command...</p>
                      <p className="text-xs text-muted">Say: &quot;next&quot;, &quot;back&quot;, &quot;repeat&quot;, or &quot;pause&quot;</p>
                    </div>
                  </div>
                )}

                {/* Controls */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {/* Audio Guidance Toggle */}
                    <div className="flex items-center gap-2 mr-2">
                      <span className="text-xs text-muted">Auto-play</span>
                      <button
                        onClick={() => setAutoPlayEnabled(!autoPlayEnabled)}
                        className={`relative w-10 h-5 rounded-full transition-colors ${
                          autoPlayEnabled ? 'bg-primary' : 'bg-muted-light'
                        }`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                          autoPlayEnabled ? 'translate-x-5' : ''
                        }`} />
                      </button>
                    </div>

                    <Button
                      variant={isPlaying ? 'danger' : 'secondary'}
                      onClick={isPlaying ? handleStopSpeak : handleSpeak}
                    >
                      {isPlaying ? (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                          </svg>
                          Stop
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                          </svg>
                          Speak Step
                        </>
                      )}
                    </Button>

                    {/* Voice Command Button */}
                    <Button
                      variant={isListening ? 'danger' : 'ghost'}
                      onClick={handleVoiceCommand}
                      title="Voice commands"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                      {isListening ? 'Listening...' : 'Voice Command'}
                    </Button>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button
                      variant="secondary"
                      onClick={() => advanceStep(Math.max(0, currentStepIndex - 1))}
                      disabled={currentStepIndex === 0}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      Back
                    </Button>
                    
                    {isLastStep ? (
                      <Button variant="success" onClick={handleComplete}>
                        Complete Module
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        onClick={() => advanceStep(Math.min(module.steps.length - 1, currentStepIndex + 1))}
                      >
                        Next
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </Button>
                    )}
                  </div>
                </div>

                {/* Voice Commands Help */}
                <div className="mt-4 p-3 bg-muted-light/50 rounded-lg">
                  <p className="text-xs text-muted">
                    <span className="font-medium">Voice Commands:</span> &quot;next&quot; / &quot;back&quot; / &quot;repeat&quot; / &quot;pause&quot;
                    {language !== 'ENG' && (
                      <span> | Hindi: &quot;aage&quot; / &quot;peeche&quot; / &quot;dobara&quot; / &quot;ruk&quot;</span>
                    )}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </OperatorLayout>
  );
}
