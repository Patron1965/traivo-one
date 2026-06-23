/**
 * ObjectHierarchyTree — återanvändbar trädvy med samma logik och utseende som
 * ClusterTreeExplorer's trädvy (arbetsbilden). Används av Step4Inspection i
 * selektionsläge (clusterId-väljaren) och kan återanvändas på fler ställen.
 */
import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { List, type RowComponentProps } from "react-window";
import {
  ChevronRight,
  ChevronDown,
  Search,
  X,
  FoldVertical,
  UnfoldVertical,
  Loader2,
  AlertCircle,
  Building2,
  Network,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { getWorkOrderStatusBadge } from "@/lib/status-colors";

// ─── Shared types (identical to ClusterTreeExplorer) ─────────────────────────

export interface TreeNode {
  id: string;
  name: string;
  parentId: string | null;
  hierarchyLevel: string | null;
  objectType: string;
  clusterId: string | null;
  latitude: number | null;
  longitude: number | null;
  entranceLatitude: number | null;
  entranceLongitude: number | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  accessType: string | null;
  childCount: number;
  customerId: string | null;
  customerName: string | null;
  executorIds: string[];
  executorNames: string[];
  orderStatuses: string[];
  metadata: Record<string, string>;
}

interface ParsedToken {
  raw: string;
  negate: boolean;
  key?: string;
  value: string;
}

// ─── Search helpers (identical to ClusterTreeExplorer) ───────────────────────

export function parseSearch(input: string): ParsedToken[] {
  return input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tokRaw) => {
      let negate = false;
      let tok = tokRaw;
      if (tok.startsWith("-") || tok.startsWith("\u2212")) {
        negate = true;
        tok = tok.slice(1);
      } else if (tok.startsWith("+")) {
        tok = tok.slice(1);
      }
      const colon = tok.indexOf(":");
      if (colon > 0) {
        return {
          raw: tokRaw,
          negate,
          key: tok.slice(0, colon).toLowerCase(),
          value: tok.slice(colon + 1).toLowerCase(),
        };
      }
      return { raw: tokRaw, negate, value: tok.toLowerCase() };
    })
    .filter((t) => t.value.length > 0 || (t.key !== undefined && t.key.length > 0));
}

export function buildBlob(n: TreeNode): string {
  const parts: string[] = [
    n.name,
    n.objectType,
    n.hierarchyLevel ?? "",
    n.address ?? "",
    n.city ?? "",
    n.postalCode ?? "",
    n.customerName ?? "",
    n.executorNames.join(" "),
    n.orderStatuses.join(" "),
  ];
  for (const [k, v] of Object.entries(n.metadata)) {
    parts.push(k, v);
  }
  return parts.join(" ").toLowerCase();
}

export function matchToken(n: TreeNode, blob: string, t: ParsedToken): boolean {
  if (t.key) {
    const val = n.metadata[t.key];
    if (val == null) return false;
    return val.toLowerCase().includes(t.value);
  }
  return blob.includes(t.value);
}

// ─── Component ────────────────────────────────────────────────────────────────

const ROW_HEIGHT = 40;

interface ObjectHierarchyTreeProps {
  /** Selection mode: provide these to enable cluster-selection behavior (Step 4). */
  selectedClusterIds?: Set<string>;
  onToggleCluster?: (clusterId: string) => void;
  /** Map from clusterId → color hex for color dots in selection mode. */
  clusterColors?: Map<string, string>;
  /**
   * Objekt/gren-selektionsläge (ADR v3): ange dessa för att aktivera
   * objekt/gren-väljaren (Step 4). När ett objekt väljs inkluderas hela dess
   * gren (alla underobjekt) implicit. Ömsesidigt uteslutande med cluster-läget.
   */
  selectedObjectIds?: Set<string>;
  onToggleObject?: (objectId: string) => void;
  /** Height of the virtual list in pixels. Default 400. */
  height?: number;
  /** Called when a non-selection row is clicked (normal explore mode). */
  onNodeClick?: (node: TreeNode) => void;
  /**
   * Task #858: visa växlingen mellan söklägena "hela företaget" (laddar hela
   * trädet) och "endast toppnivå" (laddar bara rötter, lättare). Default av —
   * Step4Inspection visar ingen växling och laddar alltid hela trädet.
   */
  enableScopeModes?: boolean;
  /**
   * Task #1052: villkorsfilter-träffmängd (objekt-id:n som matchar steg 1:s
   * villkor). När den är satt (≠ null) dimmas objekt i de VALDA grenarna som inte
   * matchar, och deras implicita kryss släcks — så att icke-matchande objekt
   * "faller bort" visuellt. null = inget villkorsfilter aktivt (allt ingår).
   */
  conditionMatchedIds?: Set<string> | null;
}

type TreeScope = "all" | "top";

export function ObjectHierarchyTree({
  selectedClusterIds,
  onToggleCluster,
  clusterColors,
  selectedObjectIds,
  onToggleObject,
  height = 400,
  onNodeClick,
  enableScopeModes = false,
  conditionMatchedIds = null,
}: ObjectHierarchyTreeProps) {
  const selectionMode = !!selectedClusterIds && !!onToggleCluster;
  const objectSelectionMode = !!selectedObjectIds && !!onToggleObject;

  const [searchInput, setSearchInput] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // När ett filter är aktivt auto-expanderas träffvägar. collapsedOverride låter
  // användaren kollapsa enskilda grenar ÄVEN under filter (fixar sök↔kollaps-låset).
  const [collapsedOverride, setCollapsedOverride] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<TreeScope>("all");
  const topMode = enableScopeModes && scope === "top";

  const { data, isLoading, isError, refetch, isFetching } = useQuery<{ nodes: TreeNode[] }>({
    queryKey: topMode ? ["/api/clusters/tree", "top"] : ["/api/clusters/tree"],
    queryFn: async () => {
      const url = topMode ? "/api/clusters/tree?scope=top" : "/api/clusters/tree";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta objektträdet");
      return res.json();
    },
  });

  const nodes = useMemo(() => data?.nodes ?? [], [data]);

  const { nodeById, childrenByParent, roots, descendantCount } = useMemo(() => {
    const byId = new Map<string, TreeNode>();
    const byParent = new Map<string | null, TreeNode[]>();
    for (const n of nodes) byId.set(n.id, n);
    for (const n of nodes) {
      const pid = n.parentId && byId.has(n.parentId) ? n.parentId : null;
      const arr = byParent.get(pid) ?? [];
      arr.push(n);
      byParent.set(pid, arr);
    }
    Array.from(byParent.values()).forEach((arr) => {
      arr.sort((a, b) => a.name.localeCompare(b.name, "sv"));
    });
    const rootArr = byParent.get(null) ?? [];
    const descCount = new Map<string, number>();
    const computeDesc = (id: string): number => {
      if (descCount.has(id)) return descCount.get(id)!;
      const kids = byParent.get(id) ?? [];
      let total = kids.length;
      for (const k of kids) total += computeDesc(k.id);
      descCount.set(id, total);
      return total;
    };
    for (const n of nodes) computeDesc(n.id);
    return { nodeById: byId, childrenByParent: byParent, roots: rootArr, descendantCount: descCount };
  }, [nodes]);

  const blobById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) m.set(n.id, buildBlob(n));
    return m;
  }, [nodes]);

  // ADR v3 objekt/gren-läge: alla ÄTTLINGAR till valda gren-rötter inkluderas
  // implicit (de följer med automatiskt). Mängden EXKLUDERAR själva rötterna —
  // de räknas som explicit valda. Härleds via primär parent_id-kedjan i trädet.
  const implicitIncludedIds = useMemo(() => {
    const result = new Set<string>();
    if (!objectSelectionMode || !selectedObjectIds || selectedObjectIds.size === 0) {
      return result;
    }
    const stack = Array.from(selectedObjectIds);
    while (stack.length > 0) {
      const id = stack.pop()!;
      for (const kid of childrenByParent.get(id) ?? []) {
        if (!result.has(kid.id)) {
          result.add(kid.id);
          stack.push(kid.id);
        }
      }
    }
    return result;
  }, [objectSelectionMode, selectedObjectIds, childrenByParent]);

  const tokens = useMemo(() => parseSearch(searchInput), [searchInput]);

  const filterActive = tokens.length > 0;

  const matchNode = useCallback(
    (n: TreeNode): boolean => {
      if (tokens.length === 0) return true;
      const blob = blobById.get(n.id) ?? "";
      for (const t of tokens) {
        const hit = matchToken(n, blob, t);
        if (t.negate && hit) return false;
        if (!t.negate && !hit) return false;
      }
      return true;
    },
    [tokens, blobById],
  );

  const { visibleIds, matchedIds } = useMemo(() => {
    if (!filterActive) {
      const all = new Set(nodes.map((n) => n.id));
      return { visibleIds: all, matchedIds: all };
    }
    const matched = new Set<string>();
    for (const n of nodes) if (matchNode(n)) matched.add(n.id);
    const visible = new Set<string>(matched);
    Array.from(matched).forEach((id) => {
      let cur = nodeById.get(id);
      while (cur?.parentId && nodeById.has(cur.parentId) && !visible.has(cur.parentId)) {
        visible.add(cur.parentId);
        cur = nodeById.get(cur.parentId);
      }
    });
    return { visibleIds: visible, matchedIds: matched };
  }, [filterActive, nodes, matchNode, nodeById]);

  const flatRows = useMemo(() => {
    const rows: Array<{ node: TreeNode; depth: number; hasChildren: boolean; isOpen: boolean }> = [];
    const walk = (node: TreeNode, depth: number) => {
      const kids = (childrenByParent.get(node.id) ?? []).filter((c) => visibleIds.has(c.id));
      const hasChildren = kids.length > 0;
      // Under filter auto-expanderas träffvägar, men respektera grenar som
      // användaren uttryckligen kollapsat (collapsedOverride). Utan filter styr
      // expanded helt.
      const isOpen = filterActive
        ? !collapsedOverride.has(node.id)
        : expanded.has(node.id);
      rows.push({ node, depth, hasChildren, isOpen });
      if (hasChildren && isOpen) {
        for (const k of kids) walk(k, depth + 1);
      }
    };
    for (const r of roots) if (visibleIds.has(r.id)) walk(r, 0);
    return rows;
  }, [roots, childrenByParent, visibleIds, expanded, collapsedOverride, filterActive]);

  // Rensa per-gren-kollaps när filtret släpps så det inte läcker in i nästa sökning.
  useEffect(() => {
    if (!filterActive && collapsedOverride.size > 0) setCollapsedOverride(new Set());
  }, [filterActive, collapsedOverride.size]);

  const toggleNode = useCallback((id: string) => {
    if (filterActive) {
      // Under filter togglar vi collapsedOverride (default = öppet/auto-expanderat).
      setCollapsedOverride((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [filterActive]);

  const expandAll = useCallback(() => {
    if (filterActive) {
      setCollapsedOverride(new Set());
      return;
    }
    const all = new Set<string>();
    for (const n of nodes) if ((childrenByParent.get(n.id)?.length ?? 0) > 0) all.add(n.id);
    setExpanded(all);
  }, [filterActive, nodes, childrenByParent]);

  const collapseAll = useCallback(() => {
    if (filterActive) {
      const all = new Set<string>();
      for (const n of nodes) if ((childrenByParent.get(n.id)?.length ?? 0) > 0) all.add(n.id);
      setCollapsedOverride(all);
      return;
    }
    setExpanded(new Set());
  }, [filterActive, nodes, childrenByParent]);

  const TreeRow = useCallback(
    ({ index, style }: RowComponentProps) => {
      const row = flatRows[index];
      if (!row) return null;
      const { node, depth, hasChildren, isOpen } = row;
      // I toppnivå-läget är barnen inte laddade → fall tillbaka på serverns
      // direkta barn-räknare (node.childCount) så rötterna ändå visar antal.
      const desc = descendantCount.get(node.id) || node.childCount || 0;
      const isMatch = matchedIds.has(node.id);
      const clusterColor = clusterColors?.get(node.clusterId ?? "") ?? null;
      const clusterSelected = selectionMode && node.clusterId
        ? selectedClusterIds!.has(node.clusterId)
        : false;
      // Objekt/gren-läge: explicit vald gren-rot vs. implicit medföljande ättling.
      const objectSelected = objectSelectionMode ? selectedObjectIds!.has(node.id) : false;
      const objectImplicit = objectSelectionMode
        ? implicitIncludedIds.has(node.id) && !objectSelected
        : false;
      // Task #1052: villkorsfilter — objekt i vald gren som inte matchar villkoren
      // "faller bort" (dimmas + implicit kryss släcks). Endast inom selektionen.
      const conditionMiss = conditionMatchedIds != null
        && (objectSelected || objectImplicit)
        && !conditionMatchedIds.has(node.id);
      const rowHighlight = clusterSelected || objectSelected
        ? "bg-accent/40"
        : objectImplicit
          ? "bg-accent/15"
          : "";

      return (
        <div
          style={style}
          className={`flex items-center gap-1 border-b border-border/40 pr-2 hover-elevate ${
            (filterActive && !isMatch) || conditionMiss ? "opacity-60" : ""
          } ${rowHighlight}`}
          data-testid={`tree-row-${node.id}`}
        >
          <div style={{ width: depth * 16 }} className="shrink-0" />

          {/* Expand/collapse */}
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleNode(node.id)}
              className="shrink-0 h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
              data-testid={`button-toggle-${node.id}`}
              aria-label={isOpen ? "Kollapsa" : "Expandera"}
            >
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <div className="shrink-0 h-6 w-6" />
          )}

          {/* Cluster-selektion: kryssruta (legacy back-compat) */}
          {selectionMode && node.clusterId && (
            <Checkbox
              checked={clusterSelected}
              onCheckedChange={() => onToggleCluster!(node.clusterId!)}
              className="shrink-0"
              data-testid={`checkbox-cluster-node-${node.id}`}
              aria-label={`Välj kluster för ${node.name}`}
            />
          )}

          {/* Objekt/gren-selektion: kryssruta. Implicit-medföljande ättlingar
              visas ikryssade men låsta (de styrs av sin valda förälder). */}
          {objectSelectionMode && (
            <Checkbox
              checked={objectSelected || (objectImplicit && !conditionMiss)}
              disabled={objectImplicit}
              onCheckedChange={() => onToggleObject!(node.id)}
              className="shrink-0"
              data-testid={`checkbox-object-node-${node.id}`}
              aria-label={`Välj objekt/gren ${node.name}`}
            />
          )}

          {/* Cluster color indicator */}
          {clusterColor && (
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: clusterColor }}
              title={`Kluster: ${node.clusterId}`}
            />
          )}

          {/* Node content — identical layout to ClusterTreeExplorer */}
          <button
            type="button"
            onClick={() => {
              if (objectSelectionMode) {
                // Implicit-medföljande ättlingar går ej att av-/välja enskilt.
                if (!objectImplicit) onToggleObject!(node.id);
                return;
              }
              if (selectionMode && node.clusterId) {
                onToggleCluster!(node.clusterId);
                return;
              }
              onNodeClick?.(node);
            }}
            className="flex-1 min-w-0 flex items-center gap-2 text-left py-1"
            data-testid={`button-open-object-${node.id}`}
          >
            <span className="truncate text-sm font-medium">{node.name}</span>
            {objectImplicit && (
              <Badge
                variant="outline"
                className="text-xs font-normal shrink-0 text-muted-foreground"
                data-testid={`badge-inherited-${node.id}`}
              >
                via förälder
              </Badge>
            )}
            {desc > 0 && (
              <Badge
                variant="secondary"
                className="text-xs font-normal shrink-0"
                data-testid={`badge-count-${node.id}`}
              >
                {desc} underobjekt
              </Badge>
            )}
            {node.customerName && (
              <span className="text-xs text-muted-foreground truncate hidden md:inline">
                · {node.customerName}
              </span>
            )}
            {node.orderStatuses.length > 0 && (
              <Badge
                className={`${getWorkOrderStatusBadge(node.orderStatuses[0])} text-xs shrink-0 hidden lg:inline-flex`}
                variant="secondary"
              >
                {node.orderStatuses[0]}
              </Badge>
            )}
          </button>
        </div>
      );
    },
    [
      flatRows,
      descendantCount,
      matchedIds,
      filterActive,
      toggleNode,
      onNodeClick,
      selectionMode,
      selectedClusterIds,
      onToggleCluster,
      clusterColors,
      objectSelectionMode,
      selectedObjectIds,
      onToggleObject,
      implicitIncludedIds,
      conditionMatchedIds,
    ],
  );

  return (
    <div className="space-y-3">
      {/* Search bar — identical to ClusterTreeExplorer */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder='Sök & filtrera, t.ex. "+fastighet −blå" eller "kund:Kalle"'
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-10 pr-10"
          data-testid="input-tree-search"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => setSearchInput("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            data-testid="button-clear-search"
            aria-label="Rensa sök"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Task #858: söklägen — hela företaget vs endast toppnivå (prestanda) */}
      {enableScopeModes && (
        <div className="inline-flex rounded-md border border-border p-0.5 bg-muted/40" data-testid="group-tree-scope">
          <Button
            variant={scope === "all" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setScope("all")}
            className="h-7"
            data-testid="button-scope-all"
          >
            <Network className="h-4 w-4 mr-1" />
            Hela företaget
          </Button>
          <Button
            variant={scope === "top" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setScope("top")}
            className="h-7"
            data-testid="button-scope-top"
          >
            <Building2 className="h-4 w-4 mr-1" />
            Endast toppnivå
          </Button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={expandAll}
            disabled={topMode}
            data-testid="button-expand-all"
          >
            <UnfoldVertical className="h-4 w-4 mr-1" />
            Expandera alla
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={collapseAll}
            disabled={topMode}
            data-testid="button-collapse-all"
          >
            <FoldVertical className="h-4 w-4 mr-1" />
            Kollapsa alla
          </Button>
        </div>
        <Badge variant="outline" className="text-xs" data-testid="badge-match-count">
          {filterActive
            ? `${matchedIds.size} träffar`
            : topMode
              ? `${nodes.length} toppnivå`
              : `${nodes.length} objekt`}
        </Badge>
      </div>

      {/* Tree list — identical virtual list rendering as ClusterTreeExplorer */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div
              className="flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
              style={{ height: Math.min(height, 200) }}
              data-testid="loading-tree"
            >
              <Loader2 className="h-5 w-5 animate-spin" />
              Laddar objektträd…
            </div>
          ) : isError ? (
            <div
              className="flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground px-6 text-center"
              style={{ height: Math.min(height, 200) }}
              data-testid="error-tree"
            >
              <AlertCircle className="h-6 w-6 text-destructive" />
              <span>Kunde inte hämta objektträdet.</span>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-retry-tree">
                {isFetching ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                Försök igen
              </Button>
            </div>
          ) : flatRows.length === 0 ? (
            <div
              className="flex items-center justify-center text-sm text-muted-foreground"
              style={{ height: Math.min(height, 200) }}
              data-testid="empty-tree-results"
            >
              {filterActive ? "Inga objekt matchar filtret" : "Inga objekt att visa"}
            </div>
          ) : (
            <List
              style={{ height, width: "100%" }}
              rowCount={flatRows.length}
              rowHeight={ROW_HEIGHT}
              rowComponent={TreeRow}
              rowProps={{}}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
