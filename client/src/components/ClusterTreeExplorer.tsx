import { useState, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { List, type RowComponentProps } from "react-window";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  Search,
  X,
  List as ListIcon,
  Map as MapIcon,
  FoldVertical,
  UnfoldVertical,
  FilePlus2,
  Loader2,
  MapPin,
  Building2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QueryState } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { useMapConfig } from "@/hooks/use-map-config";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getWorkOrderStatusBadge } from "@/lib/status-colors";

interface TreeNode {
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

const ROW_HEIGHT = 40;

function parseSearch(input: string): ParsedToken[] {
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

function buildBlob(n: TreeNode): string {
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

function matchToken(n: TreeNode, blob: string, t: ParsedToken): boolean {
  if (t.key) {
    const val = n.metadata[t.key];
    if (val == null) return false;
    return val.toLowerCase().includes(t.value);
  }
  return blob.includes(t.value);
}

function MapBounds({ positions }: { positions: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 0) {
      map.fitBounds(L.latLngBounds(positions), { padding: [40, 40], maxZoom: 14 });
    } else {
      map.setView([59.3293, 18.0686], 10);
    }
  }, [map, positions]);
  return null;
}

const dotIcon = L.divIcon({
  className: "cluster-tree-marker",
  html: `<div style="width:14px;height:14px;border-radius:50%;background:hsl(var(--primary));border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

export function ClusterTreeExplorer() {
  const { toast } = useToast();
  const mapConfig = useMapConfig();
  const [, navigate] = useLocation();
  const [searchInput, setSearchInput] = useState("");
  const [customerFilter, setCustomerFilter] = useState<string>("all");
  const [executorFilter, setExecutorFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [subView, setSubView] = useState<"tree" | "map">("tree");
  const [quickOrderOpen, setQuickOrderOpen] = useState(false);
  const [orderTitle, setOrderTitle] = useState("");
  const [orderType, setOrderType] = useState("service");
  const [orderPriority, setOrderPriority] = useState("normal");

  const { data, isLoading, isError, error, refetch } = useQuery<{ nodes: TreeNode[] }>({
    queryKey: ["/api/clusters/tree"],
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

  const tokens = useMemo(() => parseSearch(searchInput), [searchInput]);

  const filterActive =
    tokens.length > 0 ||
    customerFilter !== "all" ||
    executorFilter !== "all" ||
    statusFilter !== "all";

  const customerOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) if (n.customerId && n.customerName) m.set(n.customerId, n.customerName);
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], "sv"));
  }, [nodes]);

  const executorOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) n.executorIds.forEach((id, i) => m.set(id, n.executorNames[i] ?? id));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], "sv"));
  }, [nodes]);

  const statusOptions = useMemo(() => {
    const s = new Set<string>();
    for (const n of nodes) n.orderStatuses.forEach((st) => s.add(st));
    return Array.from(s).sort();
  }, [nodes]);

  const matchNode = useCallback(
    (n: TreeNode): boolean => {
      if (customerFilter !== "all" && n.customerId !== customerFilter) return false;
      if (executorFilter !== "all" && !n.executorIds.includes(executorFilter)) return false;
      if (statusFilter !== "all" && !n.orderStatuses.includes(statusFilter)) return false;
      if (tokens.length > 0) {
        const blob = blobById.get(n.id) ?? "";
        for (const t of tokens) {
          const hit = matchToken(n, blob, t);
          if (t.negate && hit) return false;
          if (!t.negate && !hit) return false;
        }
      }
      return true;
    },
    [tokens, customerFilter, executorFilter, statusFilter, blobById],
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
      const isOpen = filterActive ? true : expanded.has(node.id);
      rows.push({ node, depth, hasChildren, isOpen });
      if (hasChildren && isOpen) {
        for (const k of kids) walk(k, depth + 1);
      }
    };
    for (const r of roots) if (visibleIds.has(r.id)) walk(r, 0);
    return rows;
  }, [roots, childrenByParent, visibleIds, expanded, filterActive]);

  const mapPositions = useMemo(() => {
    const result: TreeNode[] = [];
    for (const n of nodes) {
      if (n.latitude != null && n.longitude != null && matchedIds.has(n.id)) result.push(n);
    }
    return result;
  }, [nodes, matchedIds]);

  const eligibleForOrder = useMemo(
    () => nodes.filter((n) => matchedIds.has(n.id) && n.customerId),
    [nodes, matchedIds],
  );

  const toggleNode = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set<string>();
    for (const n of nodes) if ((childrenByParent.get(n.id)?.length ?? 0) > 0) all.add(n.id);
    setExpanded(all);
  }, [nodes, childrenByParent]);

  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setCustomerFilter("all");
    setExecutorFilter("all");
    setStatusFilter("all");
  }, []);

  const openDetail = useCallback((node: TreeNode) => {
    navigate(`/objects/${node.id}`);
  }, [navigate]);

  const quickOrderMutation = useMutation({
    mutationFn: async (payload: { objectIds: string[]; title: string; orderType: string; priority: string }) => {
      const res = await apiRequest("POST", "/api/work-orders/quick-bulk", payload);
      return res.json() as Promise<{ created: number; skipped: { objectId: string; reason: string }[] }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clusters/tree"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      const skippedNote = result.skipped.length > 0 ? ` ${result.skipped.length} hoppades över (saknar kund).` : "";
      toast({
        title: "Snabborder skapad",
        description: `${result.created} arbetsorder(s) skapade.${skippedNote}`,
      });
      setQuickOrderOpen(false);
      setOrderTitle("");
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte skapa snabborder", description: err.message, variant: "destructive" });
    },
  });

  const submitQuickOrder = () => {
    if (!orderTitle.trim() || eligibleForOrder.length === 0) return;
    quickOrderMutation.mutate({
      objectIds: eligibleForOrder.map((n) => n.id),
      title: orderTitle.trim(),
      orderType,
      priority: orderPriority,
    });
  };

  const TreeRow = useCallback(
    ({ index, style }: RowComponentProps) => {
      const row = flatRows[index];
      if (!row) return null;
      const { node, depth, hasChildren, isOpen } = row;
      const desc = descendantCount.get(node.id) ?? 0;
      const isMatch = matchedIds.has(node.id);
      return (
        <div
          style={style}
          className={`flex items-center gap-1 border-b border-border/40 pr-2 hover-elevate ${
            filterActive && !isMatch ? "opacity-60" : ""
          }`}
          data-testid={`tree-row-${node.id}`}
        >
          <div style={{ width: depth * 16 }} className="shrink-0" />
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
          <button
            type="button"
            onClick={() => openDetail(node)}
            className="flex-1 min-w-0 flex items-center gap-2 text-left py-1"
            data-testid={`button-open-object-${node.id}`}
          >
            <span className="truncate text-sm font-medium">{node.name}</span>
            {desc > 0 && (
              <Badge variant="secondary" className="text-xs font-normal shrink-0" data-testid={`badge-count-${node.id}`}>
                {desc}
              </Badge>
            )}
            {node.hierarchyLevel && (
              <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">{node.hierarchyLevel}</span>
            )}
            {node.customerName && (
              <span className="text-xs text-muted-foreground truncate hidden md:inline">· {node.customerName}</span>
            )}
            {node.orderStatuses.length > 0 && (
              <Badge className={`${getWorkOrderStatusBadge(node.orderStatuses[0])} text-xs shrink-0 hidden lg:inline-flex`} variant="secondary">
                {node.orderStatuses[0]}
              </Badge>
            )}
          </button>
        </div>
      );
    },
    [flatRows, descendantCount, matchedIds, filterActive, toggleNode, openDetail],
  );

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder='Sök & filtrera, t.ex. "+matavfallskärl −blå" eller "bovärd:Kalle"'
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

        <div className="flex flex-wrap items-center gap-2">
          <Select value={customerFilter} onValueChange={setCustomerFilter}>
            <SelectTrigger className="w-[180px] h-9" data-testid="select-filter-customer">
              <SelectValue placeholder="Kund" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla kunder</SelectItem>
              {customerOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={executorFilter} onValueChange={setExecutorFilter}>
            <SelectTrigger className="w-[180px] h-9" data-testid="select-filter-executor">
              <SelectValue placeholder="Utförare" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla utförare</SelectItem>
              {executorOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[170px] h-9" data-testid="select-filter-status">
              <SelectValue placeholder="Orderstatus" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla orderstatus</SelectItem>
              {statusOptions.map((st) => (
                <SelectItem key={st} value={st}>{st}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {filterActive && (
            <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
              <X className="h-4 w-4 mr-1" />
              Rensa filter
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Tabs value={subView} onValueChange={(v) => setSubView(v as "tree" | "map")}>
              <TabsList>
                <TabsTrigger value="tree" data-testid="subtab-tree">
                  <ListIcon className="h-4 w-4 mr-1" />
                  Träd
                </TabsTrigger>
                <TabsTrigger value="map" data-testid="subtab-map">
                  <MapIcon className="h-4 w-4 mr-1" />
                  Karta
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {subView === "tree" && (
              <>
                <Button variant="outline" size="sm" onClick={expandAll} disabled={filterActive} data-testid="button-expand-all">
                  <UnfoldVertical className="h-4 w-4 mr-1" />
                  Expandera alla
                </Button>
                <Button variant="outline" size="sm" onClick={collapseAll} disabled={filterActive} data-testid="button-collapse-all">
                  <FoldVertical className="h-4 w-4 mr-1" />
                  Kollapsa alla
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs" data-testid="badge-match-count">
              {filterActive ? `${matchedIds.size} träffar` : `${nodes.length} objekt`}
            </Badge>
            <Button
              size="sm"
              onClick={() => setQuickOrderOpen(true)}
              disabled={eligibleForOrder.length === 0}
              data-testid="button-quick-order"
            >
              <FilePlus2 className="h-4 w-4 mr-1" />
              Skapa snabborder
            </Button>
          </div>
        </div>
      </div>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        isEmpty={!isLoading && !isError && nodes.length === 0}
        error={(error as Error | null) ?? null}
        onRetry={() => refetch()}
        loadingVariant="skeleton-rows"
        skeletonRows={8}
        emptyTitle="Inga objekt ännu"
        emptyDescription="Objekt visas här när de importeras eller skapas."
      >
        {subView === "tree" ? (
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {flatRows.length === 0 ? (
                <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height: 200 }} data-testid="empty-tree-results">
                  Inga objekt matchar filtret
                </div>
              ) : (
                <List
                  style={{ height: 560, width: "100%" }}
                  rowCount={flatRows.length}
                  rowHeight={ROW_HEIGHT}
                  rowComponent={TreeRow}
                  rowProps={{}}
                />
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <CardContent className="p-0 h-[560px]">
              <MapContainer
                center={[59.3293, 18.0686]}
                zoom={10}
                style={{ height: "100%", width: "100%" }}
                scrollWheelZoom={true}
              >
                <TileLayer attribution={mapConfig.attribution} url={mapConfig.tileUrl} />
                <MapBounds positions={mapPositions.map((n) => [n.latitude!, n.longitude!] as [number, number])} />
                {mapPositions.map((n) => (
                  <Marker
                    key={n.id}
                    position={[n.latitude!, n.longitude!]}
                    icon={dotIcon}
                    eventHandlers={{ click: () => openDetail(n) }}
                  >
                    <Popup>
                      <div className="min-w-[180px]">
                        <p className="font-semibold text-sm">{n.name}</p>
                        {n.address && <p className="text-xs text-muted-foreground">{n.address}</p>}
                        {n.customerName && (
                          <p className="text-xs flex items-center gap-1 mt-1">
                            <Building2 className="h-3 w-3" /> {n.customerName}
                          </p>
                        )}
                        <Button size="sm" className="mt-2 w-full" onClick={() => openDetail(n)} data-testid={`button-map-open-${n.id}`}>
                          Öppna objekt
                        </Button>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </CardContent>
          </Card>
        )}
        {subView === "map" && mapPositions.length === 0 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1" data-testid="text-no-geo">
            <MapPin className="h-3 w-3" /> Inga objekt med koordinater i aktuellt urval.
          </p>
        )}
      </QueryState>

      <Dialog open={quickOrderOpen} onOpenChange={setQuickOrderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Skapa snabborder</DialogTitle>
            <DialogDescription>
              Skapar en arbetsorder per objekt i det aktuella urvalet som har en primär kund.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm" data-testid="text-order-eligible">
              <span className="font-medium">{eligibleForOrder.length}</span> objekt får en order.
              {matchedIds.size - eligibleForOrder.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}({matchedIds.size - eligibleForOrder.length} saknar kund och hoppas över.)
                </span>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Titel</label>
              <Input
                value={orderTitle}
                onChange={(e) => setOrderTitle(e.target.value)}
                placeholder="t.ex. Tömning matavfall"
                data-testid="input-order-title"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Ordertyp</label>
                <Select value={orderType} onValueChange={setOrderType}>
                  <SelectTrigger data-testid="select-order-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="service">Service</SelectItem>
                    <SelectItem value="tomning">Tömning</SelectItem>
                    <SelectItem value="leverans">Leverans</SelectItem>
                    <SelectItem value="hamtning">Hämtning</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Prioritet</label>
                <Select value={orderPriority} onValueChange={setOrderPriority}>
                  <SelectTrigger data-testid="select-order-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Låg</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">Hög</SelectItem>
                    <SelectItem value="urgent">Akut</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickOrderOpen(false)}>
              Avbryt
            </Button>
            <Button
              onClick={submitQuickOrder}
              disabled={!orderTitle.trim() || eligibleForOrder.length === 0 || quickOrderMutation.isPending}
              data-testid="button-submit-quick-order"
            >
              {quickOrderMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Skapa {eligibleForOrder.length} order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
