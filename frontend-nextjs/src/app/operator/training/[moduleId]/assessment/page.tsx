'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { OperatorLayout } from '@/components/operator/operator-layout';
import { Card } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Question {
  id: string;
  order: number;
  text: string;
  citation: string;
  page: number;
  options: { id: string; text: string }[];
  correctAnswer: string;
}

const assessmentData: Record<string, {
  title: string;
  moduleTitle: string;
  questions: Question[];
}> = {
  'mod-1': {
    title: 'Chemical Handling Assessment',
    moduleTitle: '23.SOP. Chemical Handling',
    questions: [
      {
        id: 'q1',
        order: 1,
        text: 'What is the maximum capacity of a chemical container that is permitted to be hand-carried around the site?',
        citation: '23.SOP. Chemical Handling',
        page: 1,
        options: [
          { id: 'A', text: '5 litres' },
          { id: 'B', text: '10 litres' },
          { id: 'C', text: '20 litres' },
          { id: 'D', text: '50 litres' },
        ],
        correctAnswer: 'C',
      },
      {
        id: 'q2',
        order: 2,
        text: 'Which of the following is specifically noted as the required respiratory Personal Protective Equipment (PPE) for offloading, storing, and decanting hazardous materials?',
        citation: '23.SOP. Chemical Handling',
        page: 1,
        options: [
          { id: 'A', text: 'A surgical mask' },
          { id: 'B', text: 'A dust mask' },
          { id: 'C', text: 'A suitably rated respirator (not a dust mask)' },
          { id: 'D', text: 'A self-contained breathing apparatus (SCBA)' },
        ],
        correctAnswer: 'C',
      },
      {
        id: 'q3',
        order: 3,
        text: 'What action must be taken for all empty chemical containers?',
        citation: '23.SOP. Chemical Handling',
        page: 1,
        options: [
          { id: 'A', text: 'They must be washed and reused for drinking water.' },
          { id: 'B', text: 'They must be stored in specially demarcated and labelled areas.' },
          { id: 'C', text: 'They must be crushed and thrown in standard waste bins.' },
          { id: 'D', text: 'They must be returned to the supervisor immediately.' },
        ],
        correctAnswer: 'B',
      },
    ],
  },
  'mod-2': {
    title: 'Chemical Sampling Assessment',
    moduleTitle: '8-2-Chemical-Sampling-SOP-20220502',
    questions: [
      {
        id: 'q1',
        order: 1,
        text: 'When evaluating stream safety for wading during chemical sampling, the "rule of ten" states that a stream is too dangerous to wade if the depth (in feet) multiplied by the velocity (in ft/s) equals or exceeds what number?',
        citation: '8-2-Chemical-Sampling-SOP-20220502',
        page: 1,
        options: [
          { id: 'A', text: '5' },
          { id: 'B', text: '10' },
          { id: 'C', text: '15' },
          { id: 'D', text: '20' },
        ],
        correctAnswer: 'B',
      },
      {
        id: 'q2',
        order: 2,
        text: 'What is the maximum holding time for a dissolved metals sample (excluding mercury, boron, and chromium VI) that has been preserved with concentrated nitric acid?',
        citation: '8-2-Chemical-Sampling-SOP-20220502',
        page: 1,
        options: [
          { id: 'A', text: '7 days' },
          { id: 'B', text: '14 days' },
          { id: 'C', text: '28 days' },
          { id: 'D', text: '6 months' },
        ],
        correctAnswer: 'D',
      },
      {
        id: 'q3',
        order: 3,
        text: 'Which type of Quality Control (QC) blank is prepared at the analytical facility, transported with the environmental samples, and never exposed directly to ambient environmental conditions at the sampling site?',
        citation: '8-2-Chemical-Sampling-SOP-20220502',
        page: 1,
        options: [
          { id: 'A', text: 'Field blank' },
          { id: 'B', text: 'Trip blank' },
          { id: 'C', text: 'Reagent blank' },
          { id: 'D', text: 'Equipment blank' },
        ],
        correctAnswer: 'B',
      },
    ],
  },
  'mod-3': {
    title: 'Hazardous Manufacturing Safety Assessment',
    moduleTitle: 'SOPs for safe operations on hazardous and dangerous manufacturing processes',
    questions: [
      {
        id: 'q1',
        order: 1,
        text: 'In factories carrying out electrolytic plating or oxidation, what is the required capacity of the storage tank that must be provided to ensure a continuous clean water supply for the emergency shower and eye fountain?',
        citation: 'SOPs for hazardous manufacturing processes',
        page: 1,
        options: [
          { id: 'A', text: '500 litres' },
          { id: 'B', text: '1000 litres' },
          { id: 'C', text: '1500 litres' },
          { id: 'D', text: '2000 litres' },
        ],
        correctAnswer: 'C',
      },
      {
        id: 'q2',
        order: 2,
        text: 'According to the SOP for operations involving high noise levels, what is the maximum permissible sound pressure level for a continuous 8-hour exposure?',
        citation: 'SOPs for hazardous manufacturing processes',
        page: 1,
        options: [
          { id: 'A', text: '85 dBA' },
          { id: 'B', text: '90 dBA' },
          { id: 'C', text: '95 dBA' },
          { id: 'D', text: '100 dBA' },
        ],
        correctAnswer: 'B',
      },
      {
        id: 'q3',
        order: 3,
        text: 'For the manufacture of aerated waters, what specific protective gear must be provided to protect the arms and hands of workers engaged in filling bottles or syphons?',
        citation: 'SOPs for hazardous manufacturing processes',
        page: 1,
        options: [
          { id: 'A', text: 'Suitable gauntlets' },
          { id: 'B', text: 'Chemical safety goggles' },
          { id: 'C', text: 'Loose fitting rubber gloves' },
          { id: 'D', text: 'Waterproof aprons' },
        ],
        correctAnswer: 'A',
      },
    ],
  },
};

export default function AssessmentPage() {
  const params = useParams();
  const router = useRouter();
  const moduleId = params.moduleId as string;
  const assessment = assessmentData[moduleId] || assessmentData['mod-1'];
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [showResult, setShowResult] = useState(false);
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutes

  const currentQuestion = assessment.questions[currentQuestionIndex];
  const totalQuestions = assessment.questions.length;

  useEffect(() => {
    if (showResult) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 0) {
          clearInterval(timer);
          handleSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [showResult]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAnswerSelect = (questionId: string, optionId: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
  };

  const handleNext = () => {
    if (currentQuestionIndex < totalQuestions - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex((prev) => prev - 1);
    }
  };

  const handleSubmit = () => {
    setShowResult(true);
  };

  const answeredCount = Object.keys(answers).length;

  if (showResult) {
    const correctCount = assessment.questions.filter(q => answers[q.id] === q.correctAnswer).length;
    const score = Math.round((correctCount / totalQuestions) * 100);
    const passed = score >= 70;

    return (
      <OperatorLayout>
        <div className="max-w-2xl mx-auto px-4 py-12">
          <Card className="text-center">
            <div className="py-8">
              <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-6 ${
                passed ? 'bg-accent-light' : 'bg-danger-light'
              }`}>
                {passed ? (
                  <svg className="w-10 h-10 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-10 h-10 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
              </div>

              <h2 className="text-2xl font-bold text-foreground mb-2">
                {passed ? 'Congratulations!' : 'Keep Learning'}
              </h2>
              <p className="text-muted mb-6">
                {passed
                  ? 'You have successfully completed the assessment.'
                  : 'You need 70% to pass. Review the module and try again.'}
              </p>

              <div className="bg-muted-light rounded-lg p-6 mb-6">
                <div className="text-4xl font-bold text-foreground mb-2">{score}%</div>
                <p className="text-sm text-muted">
                  {correctCount} of {totalQuestions} questions answered correctly
                </p>
              </div>

              <Badge
                variant={passed ? 'success' : 'danger'}
                size="md"
                className="mb-6"
              >
                {passed ? 'Certified' : 'Not Certified'}
              </Badge>

              <div className="flex justify-center gap-4">
                <Link href="/operator/training">
                  <Button variant="secondary">Back to Training</Button>
                </Link>
                {!passed && (
                  <Button variant="primary" onClick={() => {
                    setCurrentQuestionIndex(0);
                    setAnswers({});
                    setShowResult(false);
                    setTimeLeft(300);
                  }}>
                    Retry Assessment
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>
      </OperatorLayout>
    );
  }

  return (
    <OperatorLayout>
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href={`/operator/training/${moduleId}`} className="text-muted hover:text-primary">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-foreground">{assessment.moduleTitle}</h1>
              <p className="text-sm text-muted">Knowledge Assessment</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Badge variant="info">
              Question {currentQuestionIndex + 1} of {totalQuestions}
            </Badge>
            <div className="flex items-center gap-2 text-muted">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className={`font-mono font-medium ${timeLeft < 60 ? 'text-danger' : ''}`}>
                {formatTime(timeLeft)}
              </span>
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="mb-6">
          <ProgressBar
            value={currentQuestionIndex + 1}
            max={totalQuestions}
            showLabel={false}
            color="bg-primary"
            height="h-2"
          />
        </div>

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
              <li className="flex items-start gap-2 text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                <span>Always wear appropriate PPE</span>
              </li>
              <li className="flex items-start gap-2 text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                <span>Understand safety data sheets (SDS)</span>
              </li>
              <li className="flex items-start gap-2 text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                <span>Follow proper storage protocols</span>
              </li>
              <li className="flex items-start gap-2 text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                <span>Report spills immediately</span>
              </li>
              <li className="flex items-start gap-2 text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                <span>Attend annual safety training</span>
              </li>
            </ul>
          </Card>

          {/* Question Card */}
          <div className="lg:col-span-2">
            <Card className="!p-0">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <Badge variant="info">Question {currentQuestion.order} of {totalQuestions}</Badge>
                  <div className="text-sm text-muted">
                    {currentQuestion.citation} | Page {currentQuestion.page}
                  </div>
                </div>

                <h2 className="text-lg font-medium text-foreground mb-6">
                  {currentQuestion.text}
                </h2>

                <div className="space-y-3 mb-8">
                  {currentQuestion.options.map((option) => (
                    <label
                      key={option.id}
                      className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                        ${answers[currentQuestion.id] === option.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50 hover:bg-muted-light/50'
                        }`}
                    >
                      <input
                        type="radio"
                        name={currentQuestion.id}
                        value={option.id}
                        checked={answers[currentQuestion.id] === option.id}
                        onChange={() => handleAnswerSelect(currentQuestion.id, option.id)}
                        className="w-4 h-4 text-primary focus:ring-primary"
                      />
                      <span className="font-medium text-foreground">{option.id}.</span>
                      <span className="text-sm text-foreground">{option.text}</span>
                    </label>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <Button
                    variant="secondary"
                    onClick={handlePrevious}
                    disabled={currentQuestionIndex === 0}
                  >
                    Previous
                  </Button>

                  <div className="flex items-center gap-3">
                    {currentQuestionIndex === totalQuestions - 1 ? (
                      <Button
                        variant="success"
                        onClick={handleSubmit}
                        disabled={answeredCount < totalQuestions}
                      >
                        Submit for Certification
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        onClick={handleNext}
                      >
                        Next Question
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </OperatorLayout>
  );
}
