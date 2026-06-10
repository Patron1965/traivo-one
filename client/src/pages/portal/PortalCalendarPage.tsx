import { useState, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { WorkOrderWithObject } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QueryState } from "@/components/QueryState";
import { ObjectTimeline } from "@/components/timeline/ObjectTimeline";
import {
  ArrowLeft, CalendarRange, ChevronRight, ChevronDown, Building2, Home, Package,
  Trash2, MapPin, Loader2, AlertCircle, Layers, ListTree, PanelRightClose, PanelRightOpen,
} from "lucide-react";

function getSessionToken(): string | null {
  return localStorage.getItem("portal_session");
}

function getTenant(): { id: string; name: string } | null {
  const data = localStorage.getItem("portal_tenant");
  return data ? JSON.parse(data) : null;
}

async function portalFetch(url: string) {
  const token = getSessionToken();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("portal_session");
    localStorage.removeItem("portal_customer");
    localStorage.removeItem("portal_tenant");
    window.location.href = "/portal";
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "Något gick fel");
  }
  return res.json();
}

interface ClusterNode {
  id: string;
  name: string;
  objectType?: string;
  hierarchyLevel: string;
  address?: string;
  city?: string;
  postalCode?: string;
  hasChildren: boolean;
  extraParents: number;
}

interface ChildrenResponse {
  parentId: string | null;
  nodes: ClusterNode[];
}

const hierarchyLevelLabels: Record<string, string> = {
  koncern: "Koncern",
  brf: "BRF",
  fastighet: "Fastighet",
  rum: "Rum",
  karl: "Objekt",
  omrade: "Område",
};

const hierarchyLevelIcons: Record<string, React.ReactNode> = {
  koncern: <Building2 className="h-4 w-4" />,
  brf: <Building2 className="h-4 w-4" />,
  fastighet: <Home className="h-4 w-4" />,
  rum: <Package className="h-4 w-4" />,
  karl: <Trash2 className="h-4 w-4" />,
  omrade: <MapPin className="h-4 w-4" />,
};

const hierarchyLevelColors: Record<string, string> = {
  koncern: "bg-chart-5/15 text-chart-5",
  brf: "bg-chart-1/15 text-chart-1",
  fastighet: "bg-chart-2/15 text-chart-2",
  rum: "bg-chart-4/15 text-chart-4",
  karl: "bg-destructive/15 text-destructive",
  omrade: "bg-muted text-muted-foreground",
};

function levelLabel(level: string) {
  return hierarchyLevelLabels[level] || level;
}
function levelIcon(level: string) {
  return hierarchyLevelIcons[level] || <Package className="h-4 w-4" />;
}
function levelColor(level: string) {
  return hierarchyLevelColors[level] || "bg-muted text-muted-foreground";
}

function TreeBranch({
  parentId,
  level,
  selectedId,
  onSelect,
  expanded,
  setExpanded,
  rootNodes,
}: {
  parentId: string | null;
  level: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expanded: Set<string>;
  setExpanded: (next: Set<string>) => void;
  rootNodes?: ClusterNode[];
}) {
  const enabled = parentId === null ? !rootNodes : true;
  const childrenQuery = useQuery<ChildrenResponse>({
    queryKey: ["/api/portal/clusters/children", parentId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (parentId) params.set("parentId", parentId);
      return portalFetch(`/api/portal/clusters/children?${params.toString()}`);
    },
    enabled,
  });

  const nodes = parentId === null && rootNodes ? rootNodes : (childrenQuery.data?.nodes || []);
  const isLoading = enabled && childrenQuery.isLoading;
  const isError = enabled && childrenQuery.isError;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 text-xs text-muted-foreground" data-testid={`tree-loading-${parentId || "root"}`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Laddar...
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 text-xs text-destructive">
        <AlertCircle className="h-3 w-3" />
        Kunde inte ladda
      </div>
    );
  }
  if (nodes.length === 0 && parentId === null) {
    return null;
  }

  return (
    <ul className={level === 0 ? "space-y-1" : "space-y-0.5"}>
      {nodes.map((node) => {
        const isExpanded = expanded.has(node.id);
        const isSelected = selectedId === node.id;
        return (
          <li key={node.id} data-testid={`tree-node-${node.id}`}>
            <div
              className={[
                "group flex items-center gap-1.5 py-1.5 pr-2 rounded-md cursor-pointer transition-colors",
                isSelected ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-accent",
              ].join(" ")}
              style={{ paddingLeft: `${level * 14 + 6}px` }}
              onClick={() => onSelect(node.id)}
              data-testid={`tree-select-${node.id}`}
            >
              <button
                type="button"
                className="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!node.hasChildren) return;
                  const next = new Set(expanded);
                  if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
                  setExpanded(next);
                }}
                aria-label={node.hasChildren ? (isExpanded ? "Fäll ihop" : "Expandera") : ""}
                data-testid={`tree-toggle-${node.id}`}
              >
                {node.hasChildren ? (
                  isExpanded
                    ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <span className="w-3.5 h-3.5" />
                )}
              </button>
              <div className={`shrink-0 p-1 rounded ${levelColor(node.hierarchyLevel)}`}>
                {levelIcon(node.hierarchyLevel)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium truncate" data-testid={`tree-name-${node.id}`}>
                    {node.name}
                  </span>
                  <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">
                    {levelLabel(node.hierarchyLevel)}
                  </Badge>
                  {node.extraParents > 0 && (
                    <span
                      className="inline-flex items-center gap-0.5 text-[10px] px-1.5 h-4 rounded bg-chart-4/15 text-chart-4"
                      title={`Detta objekt har ${node.extraParents + 1} föräldrar — visas under den primära`}
                      data-testid={`tree-multiparent-${node.id}`}
                    >
                      <Layers className="h-2.5 w-2.5" />
                      +{node.extraParents}
                    </span>
                  )}
                </div>
                {node.address && (
                  <div className="text-xs text-muted-foreground truncate">
                    {`${node.address}${node.postalCode ? `, ${node.postalCode}` : ""}${node.city ? ` ${node.city}` : ""}`}
                  </div>
                )}
              </div>
            </div>
            {node.hasChildren && isExpanded && (
              <div>
                <TreeBranch
                  parentId={node.id}
                  level={level + 1}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  expanded={expanded}
                  setExpanded={setExpanded}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function PortalCalendarPage() {
  const [, setLocation] = useLocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [panelOpen, setPanelOpen] = useState(true);
  const tenant = getTenant();

  const rootsQuery = useQuery<ChildrenResponse>({
    queryKey: ["/api/portal/clusters/children", null],
    queryFn: () => portalFetch(`/api/portal/clusters/children`),
    enabled: !!getSessionToken(),
  });

  const fetchTimeline = useCallback(
    (startDate: string, endDate: string): Promise<WorkOrderWithObject[]> => {
      const params = new URLSearchParams({ startDate, endDate });
      if (selectedId) params.set("objectId", selectedId);
      return portalFetch(`/api/portal/timeline?${params.toString()}`);
    },
    [selectedId],
  );

  if (!getSessionToken()) {
    setLocation("/portal");
    return null;
  }

  const rootNodes = rootsQuery.data?.nodes || [];
  const selectedNode = selectedId
    ? rootNodes.find((n) => n.id === selectedId)
    : undefined;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center gap-4">
          <Link href="/portal/dashboard">
            <Button variant="ghost" size="sm" data-testid="button-back">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Tillbaka
            </Button>
          </Link>
          <h1 className="text-lg font-semibold flex-1">{tenant?.name || "Kundportal"}</h1>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPanelOpen((v) => !v)}
            data-testid="button-toggle-panel"
            aria-label={panelOpen ? "Dölj objektträd" : "Visa objektträd"}
            title={panelOpen ? "Dölj objektträd" : "Visa objektträd"}
          >
            {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      <main className="container py-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <CalendarRange className="h-6 w-6 text-primary" />
              </div>
              Kalender
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Zooma mellan år, kvartal, månad, vecka och dag. Välj ett objekt i trädet för att
              filtrera till det objektet och dess underliggande objekt.
            </p>
          </div>
        </div>

        <div className={panelOpen ? "grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]" : "grid gap-4 grid-cols-1"}>
          {panelOpen && (
            <Card className="flex flex-col min-h-[60vh]" data-testid="object-tree-panel">
              <div className="p-3 border-b">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className={[
                    "w-full flex items-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors",
                    selectedId === null ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-accent",
                  ].join(" ")}
                  data-testid="button-select-all-objects"
                >
                  <ListTree className="h-4 w-4 text-primary" />
                  Alla objekt
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <QueryState
                  isLoading={rootsQuery.isLoading}
                  isError={rootsQuery.isError}
                  isEmpty={rootNodes.length === 0}
                  error={rootsQuery.error as { message?: string } | null}
                  onRetry={() => rootsQuery.refetch()}
                  emptyTitle="Inga objekt"
                  emptyDescription="Det finns inga registrerade objekt för ert konto."
                  loadingVariant="skeleton-rows"
                  skeletonRows={6}
                >
                  <TreeBranch
                    parentId={null}
                    level={0}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    expanded={expanded}
                    setExpanded={setExpanded}
                    rootNodes={rootNodes}
                  />
                </QueryState>
              </div>
            </Card>
          )}

          <Card className="flex flex-col min-h-[60vh] overflow-hidden" data-testid="calendar-panel">
            <div className="flex items-center gap-2 px-3 py-2 border-b text-sm">
              <CalendarRange className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-medium truncate" data-testid="text-calendar-scope">
                {selectedNode ? selectedNode.name : "Alla objekt"}
              </span>
              {selectedId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 ml-auto"
                  onClick={() => setSelectedId(null)}
                  data-testid="button-clear-object-filter"
                >
                  Rensa filter
                </Button>
              )}
            </div>
            <div className="flex-1 min-h-0">
              <ObjectTimeline
                fetchTimeline={fetchTimeline}
                queryKeyPrefix={["/api/portal/timeline", selectedId]}
                onSelectTask={(taskId) =>
                  setLocation(`/portal/dashboard?orderId=${encodeURIComponent(taskId)}`)
                }
                initialViewMode="month"
              />
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
