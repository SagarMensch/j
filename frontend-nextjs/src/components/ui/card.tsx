'use client';

import React from 'react';

interface CardProps {
  title?: string;
  icon?: React.ReactNode;
  headerColor?: string;
  children: React.ReactNode;
  className?: string;
}

export function Card({ title, icon, headerColor = 'bg-primary', children, className = '' }: CardProps) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-border overflow-hidden ${className}`}>
      {(title || icon) && (
        <div className={`${headerColor} px-4 py-3 flex items-center gap-2 text-white`}>
          {icon && <span className="text-lg">{icon}</span>}
          {title && <h3 className="font-semibold text-sm">{title}</h3>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: string;
}

export function KpiCard({ title, value, subtitle, trend, color = 'text-primary' }: KpiCardProps) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-border">
      <p className="text-muted text-sm font-medium">{title}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {subtitle && (
        <div className="flex items-center gap-1 mt-1">
          {trend === 'up' && <span className="text-accent text-xs">↑</span>}
          {trend === 'down' && <span className="text-danger text-xs">↓</span>}
          <span className="text-muted text-xs">{subtitle}</span>
        </div>
      )}
    </div>
  );
}
