"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLayout } from "@/components/admin/admin-layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Maximize2, Minimize2 } from "lucide-react";
import { Network, Options } from "vis-network";
import { DataSet } from "vis-data";

type GraphNode = {
  id: string;
  type: string;
  label: string;
  properties: Record<string, unknown>;
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  properties?: Record<string, unknown>;
};

type GraphPayload = {
  status: string;
  source: string;
  summary: {
    node_count: number;
    edge_count: number;
    node_types: Record<string, number>;
    edge_types: Record<string, number>;
    focus_node_id: string | null;
  };
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    focus_node_id: string | null;
  };
  diagnostics: Record<string, unknown>;
};

const NODE_COLORS: Record<string, { background: string; border: string }> = {
  Platform: { background: "#eef2ff", border: "#4f46e5" }, // Indigo
  Document: { background: "#eff6ff", border: "#2563eb" }, // Blue
  DocumentRevision: { background: "#f0f9ff", border: "#0284c7" }, // Sky
  TrainingModule: { background: "#ecfdf5", border: "#059669" }, // Emerald
  Assessment: { background: "#fffbeb", border: "#d97706" }, // Amber
  User: { background: "#f5f3ff", border: "#7c3aed" }, // Violet
  Department: { background: "#f8fafc", border: "#475569" }, // Slate
  Node: { background: "#ffffff", border: "#94a3b8" }, // Default
};

function asString(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function resolveNodeRoute(node: GraphNode) {
  const props = node.properties || {};
  const id = encodeURIComponent(asString(props.id) || node.id);

  if (node.type === "Document" || node.type === "DocumentRevision") {
    return `/admin/documents?focus_id=${id}`;
  }
  if (node.type === "User") {
    return `/admin/users?focus_id=${id}`;
  }
  if (node.type === "TrainingModule" || node.type === "Assessment") {
    return `/admin/analytics?focus_id=${id}`;
  }
  return `/admin/graph?focus_id=${id}`;
}

export default function AdminGraphPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [payload, setPayload] = useState<GraphPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const networkRef = useRef<Network | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function loadGraph() {
      try {
        const response = (await apiClient.get(
          `/api/admin/graph/overview?user_id=${user.id}&max_nodes=160&max_edges=320`,
        )) as GraphPayload;
        if (!isMounted) return;
        setPayload(response);
        const defaultNodeId =
          response.graph.focus_node_id ||
          response.summary.focus_node_id ||
          response.graph.nodes[0]?.id ||
          null;
        setSelectedNodeId(defaultNodeId);
        setError("");
      } catch (err) {
        if (!isMounted) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load knowledge graph.",
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadGraph();

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const node of payload?.graph.nodes || []) {
      map.set(node.id, node);
    }
    return map;
  }, [payload?.graph.nodes]);

  const degreeByNodeId = useMemo(() => {
    const degree: Record<string, number> = {};
    for (const edge of payload?.graph.edges || []) {
      degree[edge.source] = (degree[edge.source] || 0) + 1;
      degree[edge.target] = (degree[edge.target] || 0) + 1;
    }
    return degree;
  }, [payload?.graph.edges]);

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) || null : null;
  const selectedNodeRoute = selectedNode ? resolveNodeRoute(selectedNode) : "";

  const selectedNodeRelations = useMemo(() => {
    if (!selectedNodeId) return [];
    return (payload?.graph.edges || []).filter(
      (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId,
    );
  }, [payload?.graph.edges, selectedNodeId]);

  // vis-network initialization
  useEffect(() => {
    if (!payload?.graph.nodes?.length || !containerRef.current) {
      return;
    }

    const nodesData = new DataSet(
      payload.graph.nodes.map((node) => {
        const colorSet = NODE_COLORS[node.type] || NODE_COLORS.Node;
        const degree = degreeByNodeId[node.id] || 0;
        const isCentral = node.label.toLowerCase().includes("aarav");
        
        return {
          id: node.id,
          label: node.label.length > 25 ? node.label.slice(0, 22) + "..." : node.label,
          title: `${node.label} (${node.type})`, // Tooltip
          shape: "dot",
          size: isCentral ? 35 : Math.max(12, 10 + degree * 2),
          color: {
            background: colorSet.background,
            border: colorSet.border,
            highlight: {
              background: "#ffffff",
              border: "#0f172a",
            },
            hover: {
              background: "#ffffff",
              border: "#334155",
            },
          },
          borderWidth: 2,
          font: {
            size: isCentral ? 16 : 12,
            face: "Segoe UI, sans-serif",
            color: "#0f172a",
            strokeWidth: 3,
            strokeColor: "#ffffff",
          },
          shadow: {
            enabled: true,
            color: "rgba(0,0,0,0.1)",
            size: 10,
            x: 0,
            y: 4,
          },
        };
      })
    );

    const edgesData = new DataSet(
      payload.graph.edges.map((edge) => {
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        const hoverText = sourceNode && targetNode 
            ? `${sourceNode.label}  ➡️  ${edge.type}  ➡️  ${targetNode.label}`
            : edge.type;

        return {
          id: edge.id,
          from: edge.source,
          to: edge.target,
          label: edge.type,
          title: hoverText,
          arrows: {
            to: { enabled: true, scaleFactor: 1.4, type: "arrow" }
          },
          color: {
            color: "#94a3b8",
            highlight: "#334155",
            hover: "#64748b",
          },
          font: {
            size: 11,
            color: "#475569",
            align: "middle",
            strokeWidth: 3,
            strokeColor: "#ffffff",
          },
          smooth: {
            type: "dynamic",
          },
        };
      })
    );

    const data = {
      nodes: nodesData,
      edges: edgesData,
    };

    const options: Options = {
      autoResize: true,
      physics: {
        forceAtlas2Based: {
          gravitationalConstant: -100,
          centralGravity: 0.01,
          springLength: 150,
          springConstant: 0.04,
        },
        maxVelocity: 50,
        solver: "forceAtlas2Based",
        timestep: 0.35,
        stabilization: {
          enabled: true,
          iterations: 150,
        },
      },
      interaction: {
        hover: true,
        tooltipDelay: 200,
        zoomView: true,
        dragView: true,
        dragNodes: true,
      },
    };

    const network = new Network(containerRef.current, data, options);
    networkRef.current = network;

    if (selectedNodeId) {
      network.selectNodes([selectedNodeId]);
    }

    network.on("click", (params) => {
      if (params.nodes.length > 0) {
        setSelectedNodeId(params.nodes[0] as string);
      } else {
        setSelectedNodeId(null);
      }
    });

    return () => {
      network.destroy();
    };
  }, [payload, degreeByNodeId]);

  useEffect(() => {
    if (networkRef.current && selectedNodeId) {
      const selected = networkRef.current.getSelection().nodes;
      if (!selected.includes(selectedNodeId)) {
        networkRef.current.selectNodes([selectedNodeId]);
      }
    }
  }, [selectedNodeId]);

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        if (wrapperRef.current) {
          await wrapperRef.current.requestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      }
    } catch (err) {
      console.error("Fullscreen API failed", err);
      // Fallback to CSS fullscreen
      setIsFullscreen(!isFullscreen);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="hero-panel p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="tfl-kicker">Knowledge Graph Command</p>
              <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-foreground">
                Live enterprise knowledge graph
              </h1>
              <p className="mt-2 text-sm text-muted">
                Drag, click, and traverse SOP entities, revisions, users, modules,
                and assessments as one connected system.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="info">Interactive Node Navigation</Badge>
            </div>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <div className="py-12 text-center text-muted">
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <p>Building knowledge graph workspace...</p>
            </div>
          </Card>
        ) : error ? (
          <Card>
            <div className="py-6 text-center">
              <p className="font-medium text-danger">{error}</p>
            </div>
          </Card>
        ) : payload ? (
          <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
            <Card title="Graph Canvas" className="!p-0 border-0 shadow-sm relative">
              <div 
                ref={wrapperRef} 
                className={`flex flex-col bg-white ${isFullscreen ? "h-screen w-screen" : "h-full w-full rounded-xl border border-border"}`}
              >
                <div className="border-b border-border px-4 py-3 bg-white flex justify-between items-center rounded-t-xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="default">
                      {payload.summary.node_count} nodes
                    </Badge>
                    <Badge variant="default">
                      {payload.summary.edge_count} relationships
                    </Badge>
                  </div>
                  <Button variant="outline" size="sm" onClick={toggleFullscreen}>
                    {isFullscreen ? (
                      <>
                        <Minimize2 className="mr-2 h-4 w-4" />
                        Exit Full Screen
                      </>
                    ) : (
                      <>
                        <Maximize2 className="mr-2 h-4 w-4" />
                        Full Screen
                      </>
                    )}
                  </Button>
                </div>
                <div
                  ref={containerRef}
                  className={`relative overflow-hidden bg-[#f8fafc] flex-1 ${
                    !isFullscreen ? "min-h-[600px] rounded-b-xl" : ""
                  }`}
                >
                  {/* vis-network injects canvas here */}
                </div>
              </div>
            </Card>

            <div className="space-y-6">
              <Card title="Node Inspector">
                {selectedNode ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                        Selected
                      </p>
                      <p className="mt-1 text-lg font-bold text-foreground">
                        {selectedNode.label}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant="default">{selectedNode.type}</Badge>
                        <Badge variant="info">
                          {degreeByNodeId[selectedNode.id] || 0} links
                        </Badge>
                      </div>
                    </div>
                    <Button
                      variant="primary"
                      onClick={() => router.push(selectedNodeRoute)}
                    >
                      Open Node Workspace
                    </Button>
                    <div className="rounded-[10px] border border-border bg-muted-light p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                        Properties
                      </p>
                      <div className="mt-2 space-y-1.5 text-xs text-foreground">
                        {Object.entries(selectedNode.properties || {})
                          .filter(([, value]) => value !== null && value !== "")
                          .slice(0, 9)
                          .map(([key, value]) => (
                            <p key={key}>
                              <span className="font-semibold text-muted">{key}:</span>{" "}
                              {String(value)}
                            </p>
                          ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted">
                    Select a node to inspect and navigate.
                  </p>
                )}
              </Card>

              <Card title="Selected Links">
                {selectedNodeRelations.length === 0 ? (
                  <p className="text-sm text-muted">
                    No relationships to display for this node.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {selectedNodeRelations.map((edge) => {
                      const otherId =
                        edge.source === selectedNodeId ? edge.target : edge.source;
                      const otherNode = nodeMap.get(otherId);
                      return (
                        <button
                          key={edge.id}
                          onClick={() => setSelectedNodeId(otherId)}
                          className="flex w-full items-center justify-between rounded-[8px] border border-border bg-white px-3 py-2 text-left transition-colors hover:border-primary/35 hover:bg-primary/5"
                        >
                          <span className="min-w-0 truncate text-sm font-medium text-foreground">
                            {otherNode?.label || otherId}
                          </span>
                          <span className="ml-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                            {edge.type}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>
          </div>
        ) : null}
      </div>
    </AdminLayout>
  );
}
