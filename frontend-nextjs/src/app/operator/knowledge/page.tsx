'use client';

import React, { useState, useRef, useEffect } from 'react';
import { OperatorLayout } from '@/components/operator/operator-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { trackEvent } from '@/lib/telemetry';

interface Citation {
  code: string;
  section: string;
  page: number;
  confidence: number;
  revision: string;
  effectiveDate: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  citations?: Citation[];
  confidence?: number;
}

const sampleMessages: Message[] = [
  {
    id: '1',
    role: 'user',
    content: 'Centrifuge restart procedure kya hai, after emergency shutdown?',
    timestamp: '10:34 AM',
  },
  {
    id: '2',
    role: 'assistant',
    content: 'Restart procedure ke liye, sabse pehle safety checks verify karein. SOP-CHEM-042, Section 3.1 follow karein.',
    timestamp: '10:34 AM',
    confidence: 94,
    citations: [{ 
      code: 'SOP-CHEM-042', 
      section: 'Section 3.1', 
      page: 12,
      confidence: 94,
      revision: 'R3',
      effectiveDate: 'Oct 8, 2024'
    }],
  },
  {
    id: '3',
    role: 'user',
    content: 'Okay, aur cooling system ka status?',
    timestamp: '10:35 AM',
  },
  {
    id: '4',
    role: 'assistant',
    content: 'Cooling system ko stabilize hone mein 10-15 minutes lagenge. Aap SOP-CHEM-042, Section 3.4 check kar sakte hain.',
    timestamp: '10:35 AM',
    confidence: 89,
    citations: [{ 
      code: 'SOP-CHEM-042', 
      section: 'Section 3.4', 
      page: 15,
      confidence: 89,
      revision: 'R3',
      effectiveDate: 'Oct 8, 2024'
    }],
  },
];

const documentContent = `
3.1 RESTART AFTER EMERGENCY SHUTDOWN

Before initiating restart sequence, confirm all safety interlocks are cleared. Visually inspect the bowl for obstructions.
Proceed with low-speed rotation test (Section 3.2) before full operation.

3.3 COOLING SYSTEM STABILIZATION

3.4 COOLING SYSTEM STABILIZATION

The cooling system requires 10-15 minutes to stabilize after emergency shutdown. Follow these steps:

• Monitor temperature gauge readings
• Verify coolant flow rates are within normal range
• Check for any visible leaks or anomalies
• Confirm all valves are in correct positions

Once stabilized, you may proceed with normal operations.
`.trim();

export default function KnowledgeBasePage() {
  const [messages, setMessages] = useState<Message[]>(sampleMessages);
  const [inputValue, setInputValue] = useState('');
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { language } = useAuth();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 90) return 'bg-accent';
    if (confidence >= 70) return 'bg-warning';
    return 'bg-danger';
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 90) return 'High Confidence';
    if (confidence >= 70) return 'Medium Confidence';
    return 'Low Confidence';
  };

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    trackEvent('ui.query_submitted', { query: inputValue, language });

    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, newMessage]);
    setInputValue('');
    setIsTyping(true);

    // Simulate AI response
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Main aapki query process kar raha hoon. Kripya thoda intezaar karein. Aap document viewer mein relevant section dekh sakte hain.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        confidence: 87,
        citations: [{ 
          code: 'SOP-CHEM-042', 
          section: 'Section 3.1', 
          page: 12,
          confidence: 87,
          revision: 'R3',
          effectiveDate: 'Oct 8, 2024'
        }],
      };
      setMessages((prev) => [...prev, aiResponse]);
      setIsTyping(false);
    }, 1500);
  };

  const handleCitationClick = (citation: Citation) => {
    setSelectedCitation(citation);
    trackEvent('ui.citation_opened', { 
      documentCode: citation.code, 
      section: citation.section,
      page: citation.page 
    });
  };

  return (
    <OperatorLayout>
      <div className="h-[calc(100vh-180px)]">
        {/* Page Header */}
        <div className="bg-white border-b border-border px-4 py-3 mb-4 rounded-lg shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <h1 className="text-lg font-semibold text-foreground">
                Jubilant Ingrevia | Query Assistant & Document Viewer
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="info" size="sm">
                Evidence-Grounded Mode
              </Badge>
              <button className="p-2 text-muted hover:text-primary transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid lg:grid-cols-2 gap-4 h-[calc(100%-60px)]">
          {/* AI Chat Assistant */}
          <div className="bg-white rounded-lg shadow-sm border border-border flex flex-col">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-foreground">AI Chat Assistant</h2>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] ${
                      message.role === 'user'
                        ? 'bg-primary text-white rounded-2xl rounded-br-md'
                        : 'bg-muted-light text-foreground rounded-2xl rounded-bl-md'
                    } px-4 py-3`}
                  >
                    {message.role === 'user' ? (
                      <div>
                        <p className="text-sm">User: &quot;{message.content}&quot;</p>
                        <p className="text-xs opacity-70 mt-1">{message.timestamp}</p>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs">
                            AI
                          </div>
                          <span className="font-medium text-sm">AI</span>
                          {message.confidence !== undefined && (
                            <div className="flex items-center gap-1 ml-auto">
                              <div className={`w-2 h-2 rounded-full ${getConfidenceColor(message.confidence)}`} />
                              <span className="text-xs text-muted">{message.confidence}%</span>
                            </div>
                          )}
                        </div>
                        <p className="text-sm">&quot;{message.content}&quot;</p>
                        
                        {/* Confidence Indicator Bar */}
                        {message.confidence !== undefined && (
                          <div className="mt-2 mb-2">
                            <div className="flex items-center justify-between text-xs text-muted mb-1">
                              <span>{getConfidenceLabel(message.confidence)}</span>
                              <span>{message.confidence}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
                              <div 
                                className={`h-full ${getConfidenceColor(message.confidence)} transition-all`}
                                style={{ width: `${message.confidence}%` }}
                              />
                            </div>
                          </div>
                        )}
                        
                        {/* Citations */}
                        {message.citations && message.citations.length > 0 && (
                          <div className="space-y-2 mt-2">
                            <p className="text-xs text-muted">Source Evidence:</p>
                            <div className="flex flex-wrap gap-1">
                              {message.citations.map((citation, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => handleCitationClick(citation)}
                                  className="inline-flex items-center gap-1 text-xs bg-primary/20 text-primary px-2 py-1 rounded hover:bg-primary/30 transition-colors"
                                >
                                  <span>[{citation.code}]</span>
                                  <span className="text-primary/70">{citation.revision}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <p className="text-xs text-muted mt-1">{message.timestamp}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {/* Typing Indicator */}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-muted-light text-foreground rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs">
                        AI
                      </div>
                      <span className="text-sm text-muted">Processing...</span>
                      <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Unsupported Query Notice */}
            <div className="px-4 py-2 bg-warning-light/50 border-t border-warning/20">
              <p className="text-xs text-muted flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Only queries from approved documents are answered. Unanswered queries are logged.
              </p>
            </div>

            {/* Input */}
            <div className="p-4 border-t border-border">
              <div className="flex gap-2">
                <Input
                  placeholder="Apna sawaal yahan type karein..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  className="flex-1"
                />
                <Button variant="primary" onClick={handleSendMessage}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </Button>
              </div>
            </div>
          </div>

          {/* Document Viewer */}
          <div className="bg-white rounded-lg shadow-sm border border-border flex flex-col">
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-foreground">
                    Document Viewer: SOP-CHEM-042 - Centrifuge Operations
                  </h2>
                  {/* Revision Metadata Badge */}
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="info" size="sm">
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Revision R3 (Latest)
                    </Badge>
                    <span className="text-xs text-muted">Effective: Oct 8, 2024</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="p-1.5 text-muted hover:text-primary transition-colors" title="Download">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                  <button className="p-1.5 text-muted hover:text-primary transition-colors" title="Print">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Toolbar */}
              <div className="flex items-center gap-2 mt-3 bg-muted-light rounded-lg p-2">
                <button className="p-1 text-muted hover:text-primary">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                </button>
                <button className="p-1 text-muted hover:text-primary">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14v6m-3-3h6M6 10h2a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2zm10 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2zM6 20h2a2 2 0 002-2v-2a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2z" />
                  </svg>
                </button>
                <div className="w-px h-4 bg-border mx-1" />
                <button className="p-1 text-muted hover:text-primary">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-sm px-2">1</span>
                <span className="text-sm text-muted">of 1</span>
                <button className="p-1 text-muted hover:text-primary">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <div className="w-px h-4 bg-border mx-1" />
                <button className="p-1 text-muted hover:text-primary">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
                <Input
                  placeholder="Search..."
                  className="w-32 h-7 text-xs"
                />
              </div>
            </div>

            {/* Document Content */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="prose prose-sm max-w-none">
                {documentContent.split('\n').map((line, idx) => {
                  const isHighlighted = selectedCitation?.section && line.includes(selectedCitation.section.split(' ')[0]);
                  const isSectionHeader = /^\d+\.\d+/.test(line);

                  if (isSectionHeader) {
                    return (
                      <h3
                        key={idx}
                        className={`text-base font-semibold text-foreground mt-4 mb-2 p-2 rounded ${
                          isHighlighted ? 'bg-warning-light' : ''
                        }`}
                      >
                        {line}
                      </h3>
                    );
                  }

                  if (line.startsWith('•')) {
                    return (
                      <li key={idx} className="ml-4 text-sm text-foreground py-0.5">
                        {line.replace('• ', '')}
                      </li>
                    );
                  }

                  if (line.trim() === '') {
                    return <div key={idx} className="h-2" />;
                  }

                  return (
                    <p
                      key={idx}
                      className={`text-sm text-foreground leading-relaxed py-1 ${
                        isHighlighted ? 'bg-warning-light p-2 rounded' : ''
                      }`}
                    >
                      {line}
                    </p>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </OperatorLayout>
  );
}
