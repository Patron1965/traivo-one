import { useState, useMemo, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { QueryState } from "@/components/QueryState";
import {
  ArrowLeft, MapPin, Calendar, ChevronRight, ChevronDown, Building2, Home, Package,
  Trash2, Loader2, Key, CheckCircle2, TreeDeciduous, Search, X, Layers, AlertCircle,
  Users, FileText, PanelRightClose, PanelRightOpen,
} from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

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
  accessCode?: string;
  keyNumber?: string;
  latitude?: number;
  longitude?: number;
  hasChildren: boolean;
  extraParents: number;
  matchesSearch?: boolean;
  hasMatchInSubtree?: boolean;
}

interface ChildrenResponse {
  parentId: string | null;
  nodes: ClusterNode[];
  matchAncestorIds?: string[];
  matchIds?: string[];
}

interface NodeStats {
  object: {
    id: string; name: string; hierarchyLevel: string; objectType?: string;
    address?: string; city?: string; postalCode?: string;
    accessCode?: string; keyNumber?: string; notes?: string;
    extraParents: number;
  };
  descendantsCount: number;
  countsByLevel: Record<string, number>;
  upcomingVisitsCount: number;
  openOrdersCount: number;
  openIssuesCount: number;
  lastCompletedAt: string | null;
  nextVisits: Array<{
    id: string; title: string; scheduledDate: string;
    objectId: string; objectName: string | null; orderStatus: string;
  }>;
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

function highlightMatch(text: string, query: string) {
  if (!query || query.length < 2) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-warning/30 text-foreground rounded px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function TreeBranch({
  parentId,
  level,
  query,
  selectedId,
  onSelect,
  expanded,
  setExpanded,
  rootNodes,
}: {
  parentId: string | null;
  level: number;
  query: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expanded: Set<string>;
  setExpanded: (next: Set<string>) => void;
  rootNodes?: ClusterNode[];
}) {
  const enabled = parentId === null ? !rootNodes : true;
  const childrenQuery = useQuery<ChildrenResponse>({
    queryKey: ["/api/portal/clusters/children", parentId, query],
    queryFn: () => {
      const params = new URLSearchParams();
      if (parentId) params.set("parentId", parentId);
      if (query && query.length >= 2) params.set("q", query);
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
                    {highlightMatch(node.name, query)}
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
                    {highlightMatch(`${node.address}${node.postalCode ? `, ${node.postalCode}` : ""}${node.city ? ` ${node.city}` : ""}`, query)}
                  </div>
                )}
              </div>
            </div>
            {node.hasChildren && isExpanded && (
              <div>
                <TreeBranch
                  parentId={node.id}
                  level={level + 1}
                  query={query}
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

function NodeSidePanel({ selectedId }: { selectedId: string | null }) {
  const statsQuery = useQuery<NodeStats>({
    queryKey: ["/api/portal/clusters/stats", selectedId],
    queryFn: () => portalFetch(`/api/portal/clusters/${selectedId}/stats`),
    enabled: !!selectedId,
  });

  if (!selectedId) {
    return (
      <Card className="h-full" data-testid="panel-empty">
        <CardContent className="flex flex-col items-center justify-center text-center py-16 px-4 h-full">
          <div className="p-4 rounded-full bg-primary/10 mb-3">
            <TreeDeciduous className="h-8 w-8 text-primary" />
          </div>
          <h3 className="font-semibold text-sm">Välj en nod i trädet</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            Klicka på koncern, BRF, fastighet, rum eller kärl för att se aggregerad statistik och nästa besök.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full overflow-hidden flex flex-col" data-testid={`panel-node-${selectedId}`}>
      <QueryState
        isLoading={statsQuery.isLoading}
        isError={statsQuery.isError}
        isEmpty={!statsQuery.data}
        error={statsQuery.error as any}
        onRetry={() => statsQuery.refetch()}
        emptyTitle="Ingen data"
      >
        {statsQuery.data && (
          <div className="overflow-y-auto p-4 space-y-4">
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${levelColor(statsQuery.data.object.hierarchyLevel)}`}>
                {levelIcon(statsQuery.data.object.hierarchyLevel)}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold truncate" data-testid="panel-object-name">
                  {statsQuery.data.object.name}
                </h3>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <Badge variant="secondary" className="text-[10px] py-0">
                    {levelLabel(statsQuery.data.object.hierarchyLevel)}
                  </Badge>
                  {statsQuery.data.object.extraParents > 0 && (
                    <Badge variant="outline" className="text-[10px] py-0 gap-1">
                      <Layers className="h-2.5 w-2.5" />
                      {statsQuery.data.object.extraParents + 1} föräldrar
                    </Badge>
                  )}
                </div>
                {statsQuery.data.object.address && (
                  <div className="flex items-start gap-1 text-xs text-muted-foreground mt-2">
                    <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                    <span>
                      {statsQuery.data.object.address}
                      {statsQuery.data.object.postalCode && `, ${statsQuery.data.object.postalCode}`}
                      {statsQuery.data.object.city && ` ${statsQuery.data.object.city}`}
                    </span>
                  </div>
                )}
                {(statsQuery.data.object.accessCode || statsQuery.data.object.keyNumber) && (
                  <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                    {statsQuery.data.object.accessCode && (
                      <span className="inline-flex items-center gap-1">
                        <Key className="h-3 w-3" /> {statsQuery.data.object.accessCode}
                      </span>
                    )}
                    {statsQuery.data.object.keyNumber && (
                      <span className="inline-flex items-center gap-1">
                        <Key className="h-3 w-3" /> Nyckel: {statsQuery.data.object.keyNumber}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border bg-muted/30 p-2.5" data-testid="stat-descendants">
                <div className="text-[10px] uppercase text-muted-foreground font-medium tracking-wide">Underliggande</div>
                <div className="text-xl font-bold mt-0.5">{statsQuery.data.descendantsCount}</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-2.5" data-testid="stat-upcoming">
                <div className="text-[10px] uppercase text-muted-foreground font-medium tracking-wide">Kommande besök</div>
                <div className="text-xl font-bold mt-0.5">{statsQuery.data.upcomingVisitsCount}</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-2.5" data-testid="stat-open">
                <div className="text-[10px] uppercase text-muted-foreground font-medium tracking-wide">Öppna ordrar</div>
                <div className="text-xl font-bold mt-0.5">{statsQuery.data.openOrdersCount}</div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-2.5" data-testid="stat-issues">
                <div className="text-[10px] uppercase text-muted-foreground font-medium tracking-wide">Öppna ärenden</div>
                <div className="text-xl font-bold mt-0.5">{statsQuery.data.openIssuesCount}</div>
              </div>
            </div>

            {Object.keys(statsQuery.data.countsByLevel).length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Users className="h-3 w-3" /> Per nivå
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(statsQuery.data.countsByLevel)
                    .sort((a, b) => b[1] - a[1])
                    .map(([lvl, count]) => (
                      <div
                        key={lvl}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded ${levelColor(lvl)} text-xs`}
                        data-testid={`stat-level-${lvl}`}
                      >
                        {levelIcon(lvl)}
                        <span>{levelLabel(lvl)}: <strong>{count}</strong></span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {statsQuery.data.lastCompletedAt && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="stat-last-completed">
                <CheckCircle2 className="h-3.5 w-3.5 text-chart-2" />
                Senaste utförda besök: {format(new Date(statsQuery.data.lastCompletedAt), "d MMM yyyy", { locale: sv })}
              </div>
            )}

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                <Calendar className="h-3 w-3" /> Kommande besök
              </h4>
              {statsQuery.data.nextVisits.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Inga planerade besök.</p>
              ) : (
                <ul className="space-y-1.5">
                  {statsQuery.data.nextVisits.map((v) => (
                    <li key={v.id} data-testid={`next-visit-${v.id}`}>
                      <Link
                        href={`/portal/dashboard?orderId=${encodeURIComponent(v.id)}`}
                        className="block rounded-md border bg-background p-2 text-xs hover:bg-accent hover:border-primary/40 transition-colors"
                        data-testid={`link-next-visit-${v.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">{v.title}</span>
                          <span className="text-muted-foreground shrink-0 inline-flex items-center gap-1">
                            {format(new Date(v.scheduledDate), "d MMM", { locale: sv })}
                            <ChevronRight className="h-3 w-3" />
                          </span>
                        </div>
                        {v.objectName && (
                          <div className="text-muted-foreground truncate mt-0.5">{v.objectName}</div>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {statsQuery.data.object.notes && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
                  <FileText className="h-3 w-3" /> Anteckningar
                </h4>
                <p className="text-xs text-muted-foreground whitespace-pre-line">
                  {statsQuery.data.object.notes}
                </p>
              </div>
            )}
          </div>
        )}
      </QueryState>
    </Card>
  );
}

export default function PortalClusterOverviewPage() {
  const [, setLocation] = useLocation();
  const tenant = getTenant();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState<boolean>(true);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const rootsQuery = useQuery<ChildrenResponse>({
    queryKey: ["/api/portal/clusters/children", null, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch.length >= 2) params.set("q", debouncedSearch);
      return portalFetch(`/api/portal/clusters/children?${params.toString()}`);
    },
    enabled: !!getSessionToken(),
  });

  // Vid sökning: auto-expandera HELA ancestor-kedjan för varje träff
  // (inte bara rotnivå) så djupa matchningar blir synliga direkt.
  useEffect(() => {
    if (debouncedSearch.length < 2 || !rootsQuery.data) return;
    const ancestors = rootsQuery.data.matchAncestorIds || [];
    if (ancestors.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of ancestors) next.add(id);
      return next;
    });
  }, [debouncedSearch, rootsQuery.data]);

  if (!getSessionToken()) {
    setLocation("/portal");
    return null;
  }

  const rootNodes = rootsQuery.data?.nodes || [];
  const isEmpty = !rootsQuery.isLoading && !rootsQuery.isError && rootNodes.length === 0 && debouncedSearch.length < 2;

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
            aria-label={panelOpen ? "Dölj sidopanel" : "Visa sidopanel"}
            title={panelOpen ? "Dölj sidopanel" : "Visa sidopanel"}
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
                <TreeDeciduous className="h-6 w-6 text-primary" />
              </div>
              Hierarkisk översikt
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Navigera från koncern ner till enskilda kärl. Klicka på en nod för aggregerad statistik.
            </p>
          </div>
        </div>

        {isEmpty ? (
          <Card className="bg-gradient-to-br from-muted/30 to-transparent">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 bg-primary/10 rounded-full mb-4">
                <TreeDeciduous className="h-10 w-10 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Inga objekt registrerade</h3>
              <p className="text-muted-foreground max-w-sm">
                Det finns inga registrerade platser eller objekt för ert konto ännu.
              </p>
              <Link href="/portal/dashboard">
                <Button variant="outline" className="mt-4">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Tillbaka till översikt
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className={panelOpen ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]" : "grid gap-4 grid-cols-1"}>
            <Card className="flex flex-col min-h-[60vh]">
              <div className="p-3 border-b">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Sök på namn eller adress..."
                    className="pl-8 pr-8"
                    data-testid="input-tree-search"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-accent"
                      data-testid="button-clear-search"
                    >
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <QueryState
                  isLoading={rootsQuery.isLoading}
                  isError={rootsQuery.isError}
                  isEmpty={rootNodes.length === 0}
                  error={rootsQuery.error as any}
                  onRetry={() => rootsQuery.refetch()}
                  emptyTitle={debouncedSearch.length >= 2 ? "Inga träffar" : "Inga objekt"}
                  emptyDescription={debouncedSearch.length >= 2 ? "Inget objekt matchade din sökning." : undefined}
                  loadingVariant="skeleton-rows"
                  skeletonRows={6}
                >
                  <TreeBranch
                    parentId={null}
                    level={0}
                    query={debouncedSearch.length >= 2 ? debouncedSearch : ""}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    expanded={expanded}
                    setExpanded={setExpanded}
                    rootNodes={rootNodes}
                  />
                </QueryState>
              </div>
            </Card>
            {panelOpen && (
              <div className="min-h-[60vh]" data-testid="side-panel-container">
                <NodeSidePanel selectedId={selectedId} />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
