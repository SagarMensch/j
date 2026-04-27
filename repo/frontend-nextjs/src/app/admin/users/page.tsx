"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/admin/admin-layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api";

type UserRow = {
  id: string;
  employee_code: string | null;
  full_name: string;
  email: string;
  role: string;
  preferred_language: string | null;
  department: string | null;
  active_certifications: number;
  mandatory_assignments: number;
  completed_assignments: number;
  mandatory_completion_rate: number;
  latest_cert_expiry: string | null;
};

function deriveStatus(user: UserRow) {
  if (user.mandatory_completion_rate >= 100 && user.active_certifications > 0) {
    return "Ready";
  }
  if (user.mandatory_assignments > 0 || user.active_certifications > 0) {
    return "In Progress";
  }
  return "Needs Setup";
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function UsersPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadUsers() {
    try {
      const response = await apiClient.get("/api/users");
      setUsers((response?.users || []) as UserRow[]);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const matchesSearch =
        user.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (user.department || "")
          .toLowerCase()
          .includes(searchQuery.toLowerCase());
      const matchesFilter =
        filterRole === "all" ||
        user.role.toLowerCase() === filterRole.toLowerCase();
      return matchesSearch && matchesFilter;
    });
  }, [filterRole, searchQuery, users]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="hero-panel p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="tfl-kicker">People Directory</p>
              <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-foreground">
                User management
              </h1>
              <p className="mt-2 text-sm text-muted">
                Live directory of operators, supervisors, and admins in the
                training system.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setIsLoading(true);
                void loadUsers();
              }}
            >
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Card className="!p-4">
            <p className="text-3xl font-bold text-primary">{users.length}</p>
            <p className="text-sm text-muted">Total Users</p>
          </Card>
          <Card className="!p-4">
            <p className="text-3xl font-bold text-accent">
              {users.filter((user) => user.role === "operator").length}
            </p>
            <p className="text-sm text-muted">Operators</p>
          </Card>
          <Card className="!p-4">
            <p className="text-3xl font-bold text-foreground">
              {users.filter((user) => deriveStatus(user) === "Ready").length}
            </p>
            <p className="text-sm text-muted">Readiness Complete</p>
          </Card>
        </div>

        <Card className="!p-0">
          <div className="p-4 border-b border-border">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <Input
                  placeholder="Search users by name, email, or department..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  icon={
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  }
                />
              </div>
              <div className="w-48">
                <Select
                  value={filterRole}
                  onChange={(event) => setFilterRole(event.target.value)}
                  options={[
                    { value: "all", label: "All Roles" },
                    { value: "operator", label: "Operator" },
                    { value: "supervisor", label: "Supervisor" },
                    { value: "admin", label: "Admin" },
                  ]}
                />
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-muted">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p>Loading users...</p>
            </div>
          ) : error ? (
            <div className="py-6 text-center">
              <p className="text-danger font-medium">{error}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="tfl-table">
                <thead>
                  <tr className="bg-muted-light">
                    <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                      Name
                    </th>
                    <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                      Email
                    </th>
                    <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                      Role
                    </th>
                    <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                      Department
                    </th>
                    <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                      Completion
                    </th>
                    <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                      Certifications
                    </th>
                    <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                      Latest Expiry
                    </th>
                    <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredUsers.map((user) => {
                    const status = deriveStatus(user);
                    return (
                      <tr
                        key={user.id}
                        className="hover:bg-muted-light/50 transition-colors"
                      >
                        <td className="px-4 py-3 text-sm font-medium text-foreground">
                          <div>
                            <p>{user.full_name}</p>
                            <p className="text-xs text-muted">
                              {user.employee_code || "No employee code"}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted">
                          {user.email}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {user.role}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted">
                          {user.department || "Unassigned"}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {Math.round(user.mandatory_completion_rate || 0)}%
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {user.active_certifications}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted">
                          {formatDate(user.latest_cert_expiry)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={
                              status === "Ready"
                                ? "success"
                                : status === "In Progress"
                                  ? "warning"
                                  : "default"
                            }
                          >
                            {status}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && !error && filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-muted">
              No users found matching your filters.
            </div>
          ) : null}
        </Card>
      </div>
    </AdminLayout>
  );
}
