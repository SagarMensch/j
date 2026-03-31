'use client';

import React, { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/admin/admin-layout';
import { Card, KpiCard } from '@/components/ui/card';
import { DonutChart, BarChart, LineChart } from '@/components/ui/charts';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/input';
import { trackEvent } from '@/lib/telemetry';
import { useAuth } from '@/lib/auth-context';

const departmentData = [
  { label: 'Production', values: [45, 30, 17], colors: ['#2d5a8a', '#22c55e', '#eab308'], percentage: 92 },
  { label: 'Quality', values: [40, 25, 20], colors: ['#2d5a8a', '#22c55e', '#eab308'], percentage: 85 },
  { label: 'Logistics', values: [35, 25, 18], colors: ['#2d5a8a', '#22c55e', '#eab308'], percentage: 78 },
];

const trainingTrend = [
  { month: 'Jan', value: 20 },
  { month: 'Feb', value: 40 },
  { month: 'Mar', value: 38 },
  { month: 'Apr', value: 60 },
  { month: 'May', value: 70 },
  { month: 'Jun', value: 94 },
];

const operators = [
  { id: 1, name: 'Aarav Sharma', role: 'Operator', department: 'Production', status: 'Ready' },
  { id: 2, name: 'Priya Patel', role: 'Supervisor', department: 'Quality', status: 'In-Progress' },
  { id: 3, name: 'Vikram Singh', role: 'Technician', department: 'Logistics', status: 'Expired' },
  { id: 4, name: 'Sneha Gupta', role: 'Operator', department: 'Production', status: 'Ready' },
  { id: 5, name: 'Rahul Verma', role: 'Operator', department: 'Quality', status: 'In-Progress' },
  { id: 6, name: 'Ananya Singh', role: 'Technician', department: 'Logistics', status: 'Ready' },
];

const statusColors: Record<string, 'success' | 'warning' | 'danger'> = {
  'Ready': 'success',
  'In-Progress': 'warning',
  'Expired': 'danger',
};

export default function AdminAnalytics() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const { user } = useAuth();

  useEffect(() => {
    trackEvent('ui.admin_readiness_opened', { scope: 'full', role: user?.role });
  }, [user?.role]);

  const filteredOperators = operators.filter((op) => {
    const matchesSearch = op.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      op.department.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === 'all' || op.status.toLowerCase() === filterStatus.toLowerCase();
    return matchesSearch && matchesFilter;
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Page Title */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin Readiness Analytics</h1>
          <p className="text-muted text-sm mt-1">Monitor operational readiness, compliance and certification status</p>
        </div>

        {/* Top Cards Row */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Operational Readiness Score */}
          <Card title="Operational Readiness Score" className="flex items-center justify-center py-6">
            <DonutChart value={87} label="Good" size={180} />
          </Card>

          {/* Department-wide SOP Compliance */}
          <Card title="Department-wide SOP Compliance">
            <BarChart data={departmentData} />
          </Card>

          {/* Training Completion Rates */}
          <Card title="Training Completion Rates">
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl font-bold text-primary">94%</span>
              <Badge variant="success">+12% from last month</Badge>
            </div>
            <LineChart data={trainingTrend} height={120} />
          </Card>
        </div>

        {/* Operator Certification Status */}
        <Card
          title="Operator Certification Status"
          className="!p-0"
        >
          <div className="p-4 border-b border-border">
            <div className="flex flex-col sm:flex-row gap-4 justify-between">
              <div className="flex-1 max-w-md">
                <Input
                  placeholder="Search operators..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  icon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  }
                />
              </div>
              <div className="w-48">
                <Select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  options={[
                    { value: 'all', label: 'All Status' },
                    { value: 'ready', label: 'Ready' },
                    { value: 'in-progress', label: 'In Progress' },
                    { value: 'expired', label: 'Expired' },
                  ]}
                />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-muted-light">
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Name</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Role</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Department</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredOperators.map((operator) => (
                  <tr key={operator.id} className="hover:bg-muted-light/50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{operator.name}</td>
                    <td className="px-4 py-3 text-sm text-muted">{operator.role}</td>
                    <td className="px-4 py-3 text-sm text-muted">{operator.department}</td>
                    <td className="px-4 py-3">
                      <Badge variant={statusColors[operator.status]}>{operator.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredOperators.length === 0 && (
            <div className="text-center py-8 text-muted">
              No operators found matching your criteria.
            </div>
          )}
        </Card>
      </div>
    </AdminLayout>
  );
}
