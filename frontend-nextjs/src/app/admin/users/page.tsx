'use client';

import React, { useState } from 'react';
import { AdminLayout } from '@/components/admin/admin-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const users = [
  { id: 1, name: 'Aarav Sharma', email: 'aarav.s@jubilant.com', role: 'Operator', department: 'Production', status: 'Active', certifications: 5 },
  { id: 2, name: 'Priya Patel', email: 'priya.p@jubilant.com', role: 'Supervisor', department: 'Quality', status: 'Active', certifications: 8 },
  { id: 3, name: 'Vikram Singh', email: 'vikram.s@jubilant.com', role: 'Technician', department: 'Logistics', status: 'Active', certifications: 3 },
  { id: 4, name: 'Sneha Gupta', email: 'sneha.g@jubilant.com', role: 'Operator', department: 'Production', status: 'Active', certifications: 6 },
  { id: 5, name: 'Rahul Verma', email: 'rahul.v@jubilant.com', role: 'Operator', department: 'Quality', status: 'Inactive', certifications: 2 },
  { id: 6, name: 'Ananya Singh', email: 'ananya.s@jubilant.com', role: 'Technician', department: 'Logistics', status: 'Active', certifications: 4 },
];

export default function UsersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('all');

  const filteredUsers = users.filter((user) => {
    const matchesSearch = user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterRole === 'all' || user.role.toLowerCase() === filterRole.toLowerCase();
    return matchesSearch && matchesFilter;
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">User Management</h1>
            <p className="text-muted text-sm mt-1">Manage operators, supervisors, and technicians</p>
          </div>
          <Button variant="primary">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add New User
          </Button>
        </div>

        <Card className="!p-0">
          <div className="p-4 border-b border-border">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <Input
                  placeholder="Search users by name or email..."
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
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  options={[
                    { value: 'all', label: 'All Roles' },
                    { value: 'operator', label: 'Operator' },
                    { value: 'supervisor', label: 'Supervisor' },
                    { value: 'technician', label: 'Technician' },
                  ]}
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-muted-light">
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Name</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Email</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Role</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Department</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Certs</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Status</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-muted-light/50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{user.name}</td>
                    <td className="px-4 py-3 text-sm text-muted">{user.email}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{user.role}</td>
                    <td className="px-4 py-3 text-sm text-muted">{user.department}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{user.certifications}</td>
                    <td className="px-4 py-3">
                      <Badge variant={user.status === 'Active' ? 'success' : 'default'}>{user.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button className="p-1 text-muted hover:text-primary transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button className="p-1 text-muted hover:text-danger transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AdminLayout>
  );
}
