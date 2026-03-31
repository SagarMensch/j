'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/ui/logo';
import { useAuth, UserRole } from '@/lib/auth-context';

export default function Home() {
  const router = useRouter();
  const { login } = useAuth();

  const handleRoleSelect = (role: UserRole) => {
    login(role);
    if (role === 'operator') {
      router.push('/operator');
    } else {
      router.push('/admin');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-primary/5 via-background to-primary/10">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Logo variant="full" size="lg" />
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Welcome to Jubilant Ingrevia
          </h1>
          <p className="text-muted">
            AI-powered Information Assistant and Training Engine
          </p>
        </div>

        {/* Role Selection Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground text-center mb-6">
            Select Your Profile
          </h2>

          <div className="space-y-4">
            {/* Operator/Employee */}
            <button
              onClick={() => handleRoleSelect('operator')}
              className="w-full p-4 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all text-left group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Operator</h3>
                  <p className="text-sm text-muted">Information lookup, training, and assessments</p>
                </div>
                <svg className="w-5 h-5 text-muted ml-auto group-hover:text-primary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>

            {/* Admin */}
            <button
              onClick={() => handleRoleSelect('admin')}
              className="w-full p-4 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all text-left group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                  <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Admin</h3>
                  <p className="text-sm text-muted">Workforce readiness, reporting, and compliance oversight</p>
                </div>
                <svg className="w-5 h-5 text-muted ml-auto group-hover:text-primary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-6 text-sm text-muted">
          <p>© 2024 Jubilant Ingrevia. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
