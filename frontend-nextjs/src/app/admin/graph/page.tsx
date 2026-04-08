"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLayout } from "@/components/admin/admin-layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

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

type SimNode = {
  id: string;
  label: string;
  type: string;
  radius: number;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type SimEdge = {
  id: string;
  sourceIndex: number;
  targetIndex: number;
  type: string;
};

type DragState = {
  nodeId: string;
  pointerX: number;
  pointerY: number;
  moved: boolean;
};

const NODE_COLORS: Record<string, string> = {
  Platform: "#0019a8",
  Document: "#146ef5",
  DocumentRevision: "#0aa2c0",
  DocumentChunk: "#5f72ff",
  TrainingModule: "#00782a",
  TrainingStep: "#2c9b55",
  Assessment: "#a86300",
  User: "#7d2ac8",
  Department: "#364152",
  Node: "#4b5563",
};

function nodeRadiusForType(nodeType: string) {
  switch (nodeType) {
    case "Platform":
      return 20;
    case "Document":
      return 14;
    case "DocumentRevision":
      return 11;
    case "TrainingModule":
      return 12;
    case "Assessment":
      return 11;
    case "User":
      return 10;
    default:
      return 9;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

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
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const simEdgesRef = useRef<SimEdge[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);
  const hoverNodeIdRef = useRef<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const viewportRef = useRef({ width: 0, height: 0, dpr: 1 });

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    hoverNodeIdRef.current = hoverNodeId;
  }, [hoverNodeId]);

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

  useEffect(() => {
    if (!payload?.graph.nodes?.length) {
      return undefined;
    }

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      return undefined;
    }

    const initSimulation = (width: number, height: number) => {
      const sourceNodes = payload.graph.nodes;
      const sourceEdges = payload.graph.edges;
      const focusId = payload.graph.focus_node_id || payload.summary.focus_node_id;
      const centerX = width * 0.5;
      const centerY = height * 0.5;

      const simNodes: SimNode[] = sourceNodes.map((node, index) => {
        const color = NODE_COLORS[node.type] || NODE_COLORS.Node;
        const radius = nodeRadiusForType(node.type);
        if (focusId && node.id === focusId) {
          return {
            id: node.id,
            label: node.label,
            type: node.type,
            radius,
            color,
            x: centerX,
            y: centerY,
            vx: 0,
            vy: 0,
          };
        }
        const angle =
          (index / Math.max(1, sourceNodes.length)) * Math.PI * 2 +
          Math.random() * 0.45;
        const spread = Math.min(width, height) * (0.18 + Math.random() * 0.34);
        return {
          id: node.id,
          label: node.label,
          type: node.type,
          radius,
          color,
          x: centerX + Math.cos(angle) * spread,
          y: centerY + Math.sin(angle) * spread,
          vx: 0,
          vy: 0,
        };
      });

      const indexById = new Map<string, number>();
      simNodes.forEach((node, index) => {
        indexById.set(node.id, index);
      });

      const simEdges: SimEdge[] = [];
      for (const edge of sourceEdges) {
        const sourceIndex = indexById.get(edge.source);
        const targetIndex = indexById.get(edge.target);
        if (sourceIndex === undefined || targetIndex === undefined) continue;
        simEdges.push({
          id: edge.id,
          sourceIndex,
          targetIndex,
          type: edge.type,
        });
      }

      simNodesRef.current = simNodes;
      simEdgesRef.current = simEdges;
    };

    const applyCanvasSizing = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width));
      const height = clamp(
        Math.floor((typeof window !== "undefined" ? window.innerHeight : 920) - 280),
        520,
        760,
      );
      const dpr = clamp(
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
        1,
        2,
      );

      viewportRef.current = { width, height, dpr };
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      initSimulation(width, height);
    };

    const renderFrame = (timestamp: number) => {
      const { width, height, dpr } = viewportRef.current;
      const nodes = simNodesRef.current;
      const edges = simEdgesRef.current;
      if (!width || !height || !nodes.length) {
        animationFrameRef.current = requestAnimationFrame(renderFrame);
        return;
      }

      const dragState = dragRef.current;
      const kRepulsion = 5600;
      const kSpring = 0.012;
      const damping = 0.92;
      const centerPull = 0.0014;
      const minDistance = 36;
      const centerX = width * 0.5;
      const centerY = height * 0.5;

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          const distSq = dx * dx + dy * dy + 0.01;
          if (distSq < minDistance * minDistance) {
            const bump = 0.02;
            a.vx += dx * bump;
            a.vy += dy * bump;
            b.vx -= dx * bump;
            b.vy -= dy * bump;
          }
          const force = kRepulsion / distSq;
          const scale = force / Math.sqrt(distSq);
          dx *= scale;
          dy *= scale;
          a.vx += dx;
          a.vy += dy;
          b.vx -= dx;
          b.vy -= dy;
        }
      }

      for (const edge of edges) {
        const source = nodes[edge.sourceIndex];
        const target = nodes[edge.targetIndex];
        let dx = target.x - source.x;
        let dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
        const desired = 108;
        const pull = (dist - desired) * kSpring;
        dx = (dx / dist) * pull;
        dy = (dy / dist) * pull;
        source.vx += dx;
        source.vy += dy;
        target.vx -= dx;
        target.vy -= dy;
      }

      for (const node of nodes) {
        if (dragState && dragState.nodeId === node.id) {
          node.x = dragState.pointerX;
          node.y = dragState.pointerY;
          node.vx = 0;
          node.vy = 0;
          continue;
        }
        node.vx += (centerX - node.x) * centerPull;
        node.vy += (centerY - node.y) * centerPull;
        node.vx *= damping;
        node.vy *= damping;
        node.x = clamp(node.x + node.vx, 18, width - 18);
        node.y = clamp(node.y + node.vy, 18, height - 18);
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        animationFrameRef.current = requestAnimationFrame(renderFrame);
        return;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const background = ctx.createLinearGradient(0, 0, width, height);
      background.addColorStop(0, "#f9fcff");
      background.addColorStop(1, "#eef3ff");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      const aura = ctx.createRadialGradient(
        centerX,
        centerY,
        50,
        centerX,
        centerY,
        Math.max(width, height) * 0.58,
      );
      aura.addColorStop(0, "rgba(0, 25, 168, 0.12)");
      aura.addColorStop(0.35, "rgba(20, 110, 245, 0.06)");
      aura.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, width, height);

      const ringPulse = (Math.sin(timestamp * 0.0018) + 1) * 0.5;
      ctx.strokeStyle = `rgba(0, 25, 168, ${0.08 + ringPulse * 0.08})`;
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, 90 + i * 70 + ringPulse * 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      const activeNodeId = selectedNodeIdRef.current;
      const hoverId = hoverNodeIdRef.current;

      ctx.lineCap = "round";
      for (const edge of edges) {
        const source = nodes[edge.sourceIndex];
        const target = nodes[edge.targetIndex];
        const edgeActive =
          source.id === activeNodeId ||
          target.id === activeNodeId ||
          source.id === hoverId ||
          target.id === hoverId;

        ctx.strokeStyle = edgeActive
          ? "rgba(0, 120, 42, 0.58)"
          : "rgba(67, 84, 120, 0.22)";
        ctx.lineWidth = edgeActive ? 2.2 : 1.1;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }

      for (const node of nodes) {
        const isActive = node.id === activeNodeId;
        const isHover = node.id === hoverId;
        const glow = isActive ? 24 : isHover ? 17 : 10;
        const radius = node.radius + (isActive ? 3.5 : isHover ? 1.6 : 0);

        ctx.save();
        ctx.shadowBlur = glow;
        ctx.shadowColor = node.color;
        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.96)";
        ctx.lineWidth = isActive ? 2.4 : 1.5;
        ctx.stroke();
        ctx.restore();
      }

      const labelSet = new Set<string>();
      if (activeNodeId) labelSet.add(activeNodeId);
      if (hoverId) labelSet.add(hoverId);

      const prominentNodes = [...nodes]
        .sort(
          (a, b) =>
            (degreeByNodeId[b.id] || 0) - (degreeByNodeId[a.id] || 0),
        )
        .slice(0, 14);
      for (const node of prominentNodes) {
        labelSet.add(node.id);
      }

      ctx.font = "600 11px Segoe UI, system-ui, sans-serif";
      for (const nodeId of labelSet) {
        const node = nodes.find((item) => item.id === nodeId);
        if (!node) continue;
        const label = node.label.length > 38 ? `${node.label.slice(0, 35)}...` : node.label;
        const x = node.x + node.radius + 6;
        const y = node.y - node.radius - 4;
        ctx.fillStyle = "rgba(10, 18, 36, 0.88)";
        ctx.fillText(label, x, y);
      }

      animationFrameRef.current = requestAnimationFrame(renderFrame);
    };

    applyCanvasSizing();
    const resizeObserver = new ResizeObserver(() => {
      applyCanvasSizing();
    });
    resizeObserver.observe(container);

    animationFrameRef.current = requestAnimationFrame(renderFrame);

    return () => {
      resizeObserver.disconnect();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [degreeByNodeId, payload]);

  const toCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const findNodeAt = (x: number, y: number) => {
    let hit: SimNode | null = null;
    let hitDistance = 1000;
    for (const node of simNodesRef.current) {
      const dx = node.x - x;
      const dy = node.y - y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const threshold = node.radius + 9;
      if (distance <= threshold && distance < hitDistance) {
        hit = node;
        hitDistance = distance;
      }
    }
    return hit;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toCanvasPoint(event);
    if (!point) return;
    const hit = findNodeAt(point.x, point.y);
    if (!hit) return;
    dragRef.current = {
      nodeId: hit.id,
      pointerX: point.x,
      pointerY: point.y,
      moved: false,
    };
    setSelectedNodeId(hit.id);
    setHoverNodeId(hit.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toCanvasPoint(event);
    if (!point) return;
    const dragState = dragRef.current;
    if (dragState) {
      dragState.pointerX = point.x;
      dragState.pointerY = point.y;
      dragState.moved = true;
      setHoverNodeId(dragState.nodeId);
      return;
    }
    const hit = findNodeAt(point.x, point.y);
    const nextHover = hit?.id || null;
    if (nextHover !== hoverNodeIdRef.current) {
      setHoverNodeId(nextHover);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const dragState = dragRef.current;
    if (dragState && !dragState.moved) {
      setSelectedNodeId(dragState.nodeId);
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerLeave = () => {
    if (!dragRef.current) {
      setHoverNodeId(null);
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
              <Badge variant={payload?.source === "neo4j" ? "success" : "warning"}>
                {payload?.source === "neo4j"
                  ? "Neo4j Graph Live"
                  : "Fallback Graph Active"}
              </Badge>
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
            <Card title="Graph Canvas" className="!p-0">
              <div className="border-b border-border px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default">
                    {payload.summary.node_count} nodes
                  </Badge>
                  <Badge variant="default">
                    {payload.summary.edge_count} relationships
                  </Badge>
                  <Badge variant="info">
                    Status: {payload.status}
                  </Badge>
                </div>
              </div>
              <div
                ref={containerRef}
                className="relative overflow-hidden rounded-b-[18px]"
              >
                <canvas
                  ref={canvasRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onPointerLeave={handlePointerLeave}
                  className="block w-full cursor-crosshair bg-transparent"
                />
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

              <Card title="Connectivity Snapshot">
                <div className="space-y-2">
                  {Object.entries(payload.summary.node_types)
                    .slice(0, 8)
                    .map(([type, count]) => (
                      <div
                        key={type}
                        className="flex items-center justify-between rounded-[8px] border border-border bg-muted-light px-3 py-2"
                      >
                        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                          {type}
                        </span>
                        <span className="text-sm font-semibold text-foreground">
                          {count}
                        </span>
                      </div>
                    ))}
                </div>
              </Card>

              <Card title="Selected Links">
                {selectedNodeRelations.length === 0 ? (
                  <p className="text-sm text-muted">
                    No relationships to display for this node.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selectedNodeRelations.slice(0, 10).map((edge) => {
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
