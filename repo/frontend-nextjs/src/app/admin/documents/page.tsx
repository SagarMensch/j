"use client";

import React, { useState, useEffect } from "react";
import { AdminLayout } from "@/components/admin/admin-layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiClient, API_BASE_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type DocumentType = {
  id: string;
  code: string;
  title: string;
  department: string;
  revision: string;
  pages: number;
  lastUpdated: string;
  status: string;
};

export default function DocumentsPage() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [documents, setDocuments] = useState<DocumentType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadCode, setUploadCode] = useState("");
  const [uploadDepartment, setUploadDepartment] = useState("operations");
  const [uploadType, setUploadType] = useState("sop");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [isPurging, setIsPurging] = useState(false);
  const [purgeMessage, setPurgeMessage] = useState("");
  const canUpload =
    Boolean(user?.id) &&
    Boolean(uploadFile) &&
    Boolean(uploadTitle.trim()) &&
    Boolean(uploadCode.trim());
  const uploadMessageTone =
    uploadMessage.toLowerCase().includes("fail") ||
    uploadMessage.toLowerCase().includes("provide") ||
    uploadMessage.toLowerCase().includes("not loaded")
      ? "text-danger"
      : "text-muted";

  useEffect(() => {
    let isMounted = true;
    async function loadDocs() {
      try {
        const response = await apiClient.get("/api/documents");
        if (isMounted && response.documents) {
          setDocuments(response.documents);
        }
      } catch (err) {
        console.error("Failed to load documents:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadDocs();
    return () => {
      isMounted = false;
    };
  }, []);

  const deriveUploadDefaults = (fileName: string) => {
    const base = fileName.replace(/\.[^.]+$/, "").trim();
    const cleanedTitle = base
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const cleanedCode = base
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);
    return {
      title: cleanedTitle,
      code: cleanedCode,
    };
  };

  const reloadDocs = async () => {
    try {
      const response = await apiClient.get("/api/documents");
      if (response.documents) {
        setDocuments(response.documents);
      }
    } catch (err) {
      console.error("Failed to refresh documents:", err);
    }
  };

  const filteredDocuments = documents.filter(
    (doc) =>
      (doc.code || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.title || "").toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleUpload = async () => {
    if (!user?.id) {
      setUploadMessage("Admin user not loaded.");
      return;
    }
    if (!uploadFile || !uploadTitle.trim() || !uploadCode.trim()) {
      setUploadMessage("Provide file, title, and code before uploading.");
      return;
    }
    setIsUploading(true);
    setUploadMessage("");
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("title", uploadTitle.trim());
      formData.append("code", uploadCode.trim());
      formData.append("admin_user_id", user.id);
      formData.append("document_type", uploadType);
      formData.append("department", uploadDepartment);

      const res = await fetch(`${API_BASE_URL}/api/admin/sop/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Upload failed (${res.status})`);
      }

      const data = await res.json();
      setUploadMessage(data.message || "Upload complete.");
      setUploadFile(null);
      setUploadTitle("");
      setUploadCode("");
      await reloadDocs();
    } catch (err: any) {
      setUploadMessage(err.message || "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const handlePurge = async () => {
    if (!user?.id) {
      setPurgeMessage("Admin user not loaded.");
      return;
    }
    const confirmed = window.confirm(
      "This will permanently delete all manuals and chunks. Continue?",
    );
    if (!confirmed) return;
    setIsPurging(true);
    setPurgeMessage("");
    try {
      const data = await apiClient.post("/api/admin/documents/purge", {
        user_id: user.id,
        confirm: true,
      });
      setPurgeMessage(
        `Purged ${data.documents_deleted || 0} documents. Neo4j: ${data.neo4j || "skipped"}`,
      );
      await reloadDocs();
    } catch (err: any) {
      setPurgeMessage(err.message || "Purge failed.");
    } finally {
      setIsPurging(false);
    }
  };

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="min-h-[50vh] flex flex-col items-center justify-center p-12 text-muted">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
          <p className="font-medium animate-pulse">
            Loading connected documents...
          </p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="hero-panel p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="tfl-kicker">Document Control</p>
              <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-foreground">
                Document management
              </h1>
              <p className="mt-2 text-sm text-muted">
                Manage SOPs, manuals, and training documents with type-coded
                release visibility.
              </p>
            </div>
            <Button variant="danger" onClick={handlePurge} disabled={isPurging}>
              {isPurging ? "Purging..." : "Purge Documents"}
            </Button>
          </div>
        </div>

        <Card className="!p-4">
          <div className="flex flex-col lg:flex-row gap-4 lg:items-end">
            <div className="flex-1 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted">Document Title</label>
                <Input
                  placeholder="Centrifuge Restart Procedure"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-muted">Document Code</label>
                <Input
                  placeholder="SOP-CHEM-042"
                  value={uploadCode}
                  onChange={(e) => setUploadCode(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-muted">Document Type</label>
                <Input
                  placeholder="sop"
                  value={uploadType}
                  onChange={(e) => setUploadType(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-muted">Department</label>
                <Input
                  placeholder="operations"
                  value={uploadDepartment}
                  onChange={(e) => setUploadDepartment(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <input
                type="file"
                accept=".pdf,.txt,.md"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setUploadFile(file);
                  if (file) {
                    const defaults = deriveUploadDefaults(file.name);
                    setUploadTitle((current) =>
                      current.trim() ? current : defaults.title,
                    );
                    setUploadCode((current) =>
                      current.trim() ? current : defaults.code,
                    );
                    setUploadMessage("");
                  }
                }}
                className="text-sm"
              />
              <p className="text-xs text-muted">
                Supported formats: PDF, TXT, MD
              </p>
              {uploadFile ? (
                <p className="text-xs text-muted">
                  Selected file: <span className="font-medium">{uploadFile.name}</span>
                </p>
              ) : null}
              <Button
                variant="primary"
                onClick={handleUpload}
                disabled={isUploading || !user?.id}
              >
                {isUploading ? "Uploading..." : "Upload Document"}
              </Button>
              {!user?.id && (
                <p className="text-xs text-danger">
                  Sign in as an admin before uploading.
                </p>
              )}
              {user?.id && !canUpload && (
                <p className="text-xs text-muted">
                  Select a file and confirm title + code, then upload.
                </p>
              )}
            </div>
          </div>
          {uploadMessage && (
            <p className={`text-xs mt-3 ${uploadMessageTone}`}>
              {uploadMessage}
            </p>
          )}
          {purgeMessage && (
            <p className="text-xs text-danger mt-1">{purgeMessage}</p>
          )}
        </Card>

        <Card className="!p-0">
          <div className="p-4 border-b border-border">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <Input
                  placeholder="Search by document code or title..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
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
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="tfl-table">
              <thead>
                <tr className="bg-muted-light">
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                    Code
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                    Title
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                    Department
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                    Revision
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                    Pages
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                    Last Updated
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredDocuments.map((doc) => (
                  <tr
                    key={doc.id}
                    className="hover:bg-muted-light/50 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm font-mono font-medium text-primary">
                      {doc.code}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">
                      {doc.title}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {doc.department}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">
                      {doc.revision}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {doc.pages}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">
                      {doc.lastUpdated}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          doc.status === "Current" ? "success" : "warning"
                        }
                      >
                        {doc.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          className="p-1 text-muted hover:text-primary transition-colors"
                          title="View"
                        >
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
                              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                            />
                          </svg>
                        </button>
                        <button
                          className="p-1 text-muted hover:text-primary transition-colors"
                          title="Edit"
                        >
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
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                            />
                          </svg>
                        </button>
                        <button
                          className="p-1 text-muted hover:text-danger transition-colors"
                          title="Delete"
                        >
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
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
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
