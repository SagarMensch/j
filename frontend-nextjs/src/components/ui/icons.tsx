"use client";

import React from "react";

type IconProps = {
  className?: string;
};

function iconClassName(className = "") {
  return `w-5 h-5 ${className}`.trim();
}

export function DashboardBlocksIcon({ className }: IconProps) {
  return (
    <svg
      className={iconClassName(className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="3" y="3" width="7" height="7" fill="currentColor" />
      <rect x="14" y="3" width="7" height="7" fill="currentColor" />
      <rect x="3" y="14" width="7" height="7" fill="currentColor" />
      <rect x="14" y="14" width="7" height="7" fill="currentColor" />
    </svg>
  );
}

export function AnalyticsBarsIcon({ className }: IconProps) {
  return (
    <svg
      className={iconClassName(className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="12" width="3" height="8" fill="currentColor" />
      <rect x="10.5" y="8" width="3" height="12" fill="currentColor" />
      <rect x="17" y="4" width="3" height="16" fill="currentColor" />
      <line x1="3" y1="20.5" x2="21" y2="20.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function UsersClusterIcon({ className }: IconProps) {
  return (
    <svg
      className={iconClassName(className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="8" r="3" fill="currentColor" />
      <circle cx="6.5" cy="10.5" r="2.5" fill="currentColor" opacity="0.7" />
      <circle cx="17.5" cy="10.5" r="2.5" fill="currentColor" opacity="0.7" />
      <rect x="7" y="15" width="10" height="5" rx="1" fill="currentColor" />
    </svg>
  );
}

export function DocumentStackIcon({ className }: IconProps) {
  return (
    <svg
      className={iconClassName(className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="5" y="4" width="11" height="14" stroke="currentColor" strokeWidth="2" />
      <rect x="8" y="7" width="11" height="14" fill="currentColor" opacity="0.18" />
      <line x1="8" y1="9" x2="14" y2="9" stroke="currentColor" strokeWidth="2" />
      <line x1="8" y1="13" x2="14" y2="13" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function SettingsMatrixIcon({ className }: IconProps) {
  return (
    <svg
      className={iconClassName(className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="4" width="6" height="6" stroke="currentColor" strokeWidth="2" />
      <rect x="14" y="4" width="6" height="6" fill="currentColor" />
      <rect x="4" y="14" width="6" height="6" fill="currentColor" opacity="0.7" />
      <rect x="14" y="14" width="6" height="6" stroke="currentColor" strokeWidth="2" />
      <circle cx="17" cy="17" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function LookupNodesIcon({ className }: IconProps) {
  return (
    <svg
      className={iconClassName(className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="6" cy="6" r="3" fill="currentColor" />
      <circle cx="18" cy="8" r="3" fill="currentColor" />
      <circle cx="12" cy="18" r="3" fill="currentColor" />
      <line x1="7.5" y1="7" x2="16.5" y2="7.5" stroke="currentColor" strokeWidth="2" />
      <line x1="13.5" y1="16.5" x2="17" y2="9.5" stroke="currentColor" strokeWidth="2" />
      <line x1="7.5" y1="7.5" x2="11" y2="16" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function TrainingStepsIcon({ className }: IconProps) {
  return (
    <svg
      className={iconClassName(className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="5" width="4" height="4" fill="currentColor" />
      <rect x="4" y="10" width="4" height="4" fill="currentColor" opacity="0.72" />
      <rect x="4" y="15" width="4" height="4" fill="currentColor" opacity="0.45" />
      <line x1="11" y1="7" x2="20" y2="7" stroke="currentColor" strokeWidth="2" />
      <line x1="11" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="2" />
      <line x1="11" y1="17" x2="20" y2="17" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function AssessmentShieldIcon({ className }: IconProps) {
  return (
    <svg
      className={iconClassName(className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 3L18.5 5.5V11.5C18.5 15.2 16.1 18.55 12 20.5C7.9 18.55 5.5 15.2 5.5 11.5V5.5L12 3Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect x="10" y="9" width="4" height="5" fill="currentColor" />
      <rect x="8" y="11" width="8" height="2" fill="currentColor" />
    </svg>
  );
}

export function NotificationGridIcon({ className }: IconProps) {
  return (
    <svg
      className={iconClassName(className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M7 9C7 6.239 9.239 4 12 4C14.761 4 17 6.239 17 9V14L19 16V17H5V16L7 14V9Z" fill="currentColor" />
      <rect x="10" y="18" width="4" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

export function UserBadgeIcon({ className }: IconProps) {
  return (
    <svg
      className={iconClassName(className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="8" r="3.2" fill="currentColor" />
      <path d="M6 19C6 15.9 8.8 14 12 14C15.2 14 18 15.9 18 19H6Z" fill="currentColor" />
    </svg>
  );
}

export function RoleOperatorIcon({ className }: IconProps) {
  return (
    <svg
      className={iconClassName(className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="4" width="16" height="16" stroke="currentColor" strokeWidth="2" />
      <rect x="8" y="8" width="8" height="8" fill="currentColor" />
      <circle cx="18" cy="6" r="2" fill="currentColor" />
    </svg>
  );
}

export function RoleAdminIcon({ className }: IconProps) {
  return (
    <svg
      className={iconClassName(className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="10" width="16" height="4" fill="currentColor" />
      <rect x="7" y="5" width="10" height="14" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2" fill="white" />
    </svg>
  );
}

export function SearchGridIcon({ className }: IconProps) {
  return (
    <svg
      className={iconClassName(className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="4" width="10" height="10" stroke="currentColor" strokeWidth="2" />
      <rect x="15" y="15" width="5" height="5" fill="currentColor" />
      <line x1="12.5" y1="12.5" x2="18.5" y2="18.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
