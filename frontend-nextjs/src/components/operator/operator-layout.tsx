'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Logo } from '@/components/ui/logo';
import { useAuth } from '@/lib/auth-context';
import { Badge } from '@/components/ui/badge';

interface NavItem {
  label: string;
  href: string;
  icon: string;
}

const navItems: NavItem[] = [
  { label: 'Information Lookup', href: '/operator', icon: '🔍' },
  { label: 'Training & Enablement', href: '/operator/training', icon: '📚' },
  { label: 'Assessments', href: '/operator/assessments', icon: '✅' },
];

const notifications = [
  { id: 1, type: 'training', title: 'Training Due Soon', message: 'Reactor Safety Protocols due in 5 days', time: '2 hours ago', unread: true },
  { id: 2, type: 'alert', title: 'Safety Alert', message: 'New PPE requirements for Reactor Section', time: '5 hours ago', unread: true },
  { id: 3, type: 'certification', title: 'Certification Renewal', message: 'Chemical Handling certification expires in 30 days', time: '1 day ago', unread: false },
];

export function OperatorLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, language, setLanguage } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const unreadCount = notifications.filter(n => n.unread).length;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (isMounted && user && user.role !== 'operator') {
      router.push('/admin');
    }
  }, [user, isMounted, router]);

  if (!isMounted || !user) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <header className="bg-primary text-white shadow-lg sticky top-0 z-50 h-16">
          <div className="max-w-7xl mx-auto px-4 h-full flex items-center">
            <div className="w-32 h-8 bg-white/20 rounded animate-pulse" />
          </div>
        </header>
        <main className="flex-1 bg-background" />
      </div>
    );
  }

  // Show nothing while redirect happens for wrong role
  if (user.role !== 'operator') {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="bg-primary text-white shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link href="/operator">
              <Logo variant="white" size="md" />
            </Link>

            {/* Navigation - 3 Tabs per Profile UI Mapping Matrix */}
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href || 
                  (item.href === '/operator' && pathname === '/operator');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-2
                      ${isActive 
                        ? 'bg-white/20 text-white' 
                        : 'text-white/80 hover:text-white hover:bg-white/10'
                      }`}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            {/* Right side - Language, Notifications & User */}
            <div className="flex items-center gap-4">
              {/* Language Selector */}
              <div className="flex items-center gap-1 bg-white/10 rounded-lg px-2 py-1">
                {['ENG', 'HIN', 'HING'].map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setLanguage(lang)}
                    className={`px-2 py-1 text-xs font-medium rounded transition-colors
                      ${language === lang 
                        ? 'bg-white text-primary' 
                        : 'text-white/80 hover:text-white'
                      }`}
                  >
                    {lang}
                  </button>
                ))}
              </div>

              {/* Notification Center */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowNotifications(!showNotifications);
                    setShowProfileMenu(false);
                  }}
                  className="relative p-2 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-danger rounded-full text-xs flex items-center justify-center font-medium">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {/* Notification Dropdown */}
                {showNotifications && (
                  <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-lg shadow-lg border border-border overflow-hidden">
                    <div className="p-3 border-b border-border bg-muted-light">
                      <h3 className="font-semibold text-foreground">Notifications</h3>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.map((notification) => (
                        <div
                          key={notification.id}
                          className={`p-3 border-b border-border last:border-0 hover:bg-muted-light/50 transition-colors cursor-pointer ${
                            notification.unread ? 'bg-primary/5' : ''
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                              notification.type === 'alert' ? 'bg-danger-light text-danger' :
                              notification.type === 'training' ? 'bg-warning-light text-warning' :
                              'bg-accent-light text-accent'
                            }`}>
                              {notification.type === 'alert' ? (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                              ) : notification.type === 'training' ? (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground">{notification.title}</p>
                              <p className="text-xs text-muted mt-0.5">{notification.message}</p>
                              <p className="text-xs text-muted mt-1">{notification.time}</p>
                            </div>
                            {notification.unread && (
                              <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="p-2 border-t border-border">
                      <button className="w-full text-center text-sm text-primary hover:text-primary-dark font-medium py-1">
                        View All Notifications
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* User Profile */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowProfileMenu(!showProfileMenu);
                    setShowNotifications(false);
                  }}
                  className="flex items-center gap-2 hover:bg-white/10 rounded-lg px-2 py-1 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                    <span className="text-sm font-medium">
                      {user?.name?.charAt(0) || 'U'}
                    </span>
                  </div>
                  <div className="hidden sm:block text-left">
                    <p className="text-sm font-medium">Welcome,</p>
                    <p className="text-xs text-white/80">{user?.name || 'User'}</p>
                  </div>
                  <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Profile Dropdown */}
                {showProfileMenu && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-lg shadow-lg border border-border overflow-hidden">
                    <div className="p-3 border-b border-border bg-muted-light">
                      <p className="font-medium text-foreground">{user?.name}</p>
                      <p className="text-xs text-muted">{user?.email}</p>
                      <Badge variant="info" size="sm" className="mt-1">{user?.role}</Badge>
                    </div>
                    <div className="p-1">
                      <button className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted-light rounded transition-colors">
                        Profile Settings
                      </button>
                      <button className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted-light rounded transition-colors">
                        My Certifications
                      </button>
                      <button className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted-light rounded transition-colors">
                        Help & Support
                      </button>
                      <hr className="my-1" />
                      <button className="w-full text-left px-3 py-2 text-sm text-danger hover:bg-danger-light rounded transition-colors">
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-border py-4">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <p className="text-sm text-muted">
            © 2024 Jubilant Ingrevia. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-sm text-muted">
            <span>Profile: Operator</span>
            <span>|</span>
            <span>Information Lookup</span>
            <span>•</span>
            <span>Training</span>
            <span>•</span>
            <span>Assessments</span>
          </div>
        </div>
      </footer>

      {/* Mobile Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-border shadow-lg z-50">
        <div className="flex justify-around py-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center px-3 py-1 text-xs
                  ${isActive ? 'text-primary' : 'text-muted'}`}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="truncate w-20 text-center">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
