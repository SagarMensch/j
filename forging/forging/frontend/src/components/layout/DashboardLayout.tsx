"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

// Routes that should render full-width WITHOUT the sidebar shell
const PUBLIC_ROUTES = ["/", "/login"];

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname();

  // Landing page and login page: full-width, no sidebar
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const isPrintRoute = pathname.includes("/report/print");

  if (isPublicRoute || isPrintRoute) {
    return <main className="min-h-full">{children}</main>;
  }

  // All profile routes: sidebar shell layout
  return (
    <div className="flex h-full min-h-screen">
      {/* Dark sidebar — 256px fixed */}
      <Sidebar />

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden pl-64">
        <main className="flex-1 overflow-y-auto bg-[#f6f5f8]">
          {children}
        </main>
      </div>
    </div>
  );
}
