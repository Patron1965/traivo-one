import { Fragment, useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { Link, useRoute } from "wouter";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CUSTOMER_HIERARCHY_TYPES } from "@shared/schema";
import { formatSekFromOre } from "@/lib/format";
import { Switch } from "@/components/ui/switch";
import { DeliveryPreferencesEditor } from "@/components/DeliveryPreferencesEditor";
import { PortalUsersTab } from "@/components/customer/PortalUsersTab";
import InvoiceRecipientsCard from "@/components/InvoiceRecipientsCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueryErrorState } from "@/components/ErrorBoundary";
import {
  ArrowLeft, Building2, Package, ClipboardList, Phone, Mail, MapPin,
  ChevronDown, ChevronRight, Users, Home, Container, Trash2, TreePine, Map as MapIcon,
  Repeat, Receipt, GitBranch, Hash, FileText, AlertTriangle, Loader2, Search, X, RefreshCw,
  Pyramid, DoorClosed, ArrowUp, ArrowDown, ArrowUpDown, TrendingUp, TrendingDown,
  Send, Clock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster";
import { useMapConfig } from "@/hooks/use-map-config";
import { useAuth } from "@/hooks/use-auth";
import type { Customer, DeliveryPreferences } from "@shared/schema";

interface CustomerStats {
  objectsByLevel: Record<string, number>;
  totalObjects: number;
  activeOrders: number;
  completedOrders: number;
  invoicedOrders: number;
  totalOrders: number;
  activeSubscriptions: number;
  invoicedLast12Months: number;
}

interface TreeNode {
  id: string;
  name: string;
  parentId: string | null;
  hierarchyLevel: string | null;
  address: string | null;
  hasCoords: boolean;
  childCount: number;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedText({ text, query }: { text: string | null | undefined; query: string }) {
  if (!text) return null;
  const q = query.trim();
  if (!q) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
  const lower = q.toLowerCase();
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === lower ? (
          <mark key={i} className="bg-chart-3/30 dark:bg-chart-3/40 text-inherit rounded-sm px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

interface SearchHit {
  id: string;
  name: string;
  objectNumber: string | null;
  address: string | null;
  hierarchyLevel: string | null;
  parentId: string | null;
  path: Array<{ id: string; name: string; hierarchyLevel: string | null }>;
}

interface MapPoint {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  hierarchyLevel: string | null;
}

const HIERARCHY_LEVELS: Record<string, { label: string; icon: typeof Building2; color: string; hex: string }> = {
  koncern: { label: "Koncern", icon: Pyramid, color: "text-chart-5", hex: "#2C3E50" },
  brf: { label: "BRF", icon: Building2, color: "text-chart-1", hex: "#1B4B6B" },
  fastighet: { label: "Fastighet", icon: Home, color: "text-chart-2", hex: "#4A9B9B" },
  rum: { label: "Rum", icon: DoorClosed, color: "text-chart-3", hex: "#7DBFB0" },
  karl: { label: "Kärl", icon: Trash2, color: "text-chart-4", hex: "#6B7C8C" },
  objekt: { label: "Objekt", icon: Package, color: "text-muted-foreground", hex: "#6B7C8C" },
};

interface SyncState {
  selectedObjectId: string | null;
  hoveredObjectId: string | null;
}

type TreeSortField = "name" | "level" | "children" | "address";
interface TreeSortConfig { field: TreeSortField; direction: "asc" | "desc" }

const HIERARCHY_ORDER: Record<string, number> = { koncern: 1, brf: 2, fastighet: 3, rum: 4, karl: 5, objekt: 6 };

function sortTreeNodes(nodes: TreeNode[], cfg: TreeSortConfig): TreeNode[] {
  const dir = cfg.direction === "asc" ? 1 : -1;
  const arr = [...nodes];
  arr.sort((a, b) => {
    let cmp = 0;
    switch (cfg.field) {
      case "name":
        cmp = (a.name || "").localeCompare(b.name || "", "sv", { numeric: true, sensitivity: "base" });
        break;
      case "level": {
        const ao = HIERARCHY_ORDER[a.hierarchyLevel || ""] ?? 99;
        const bo = HIERARCHY_ORDER[b.hierarchyLevel || ""] ?? 99;
        cmp = ao - bo;
        break;
      }
      case "children":
        cmp = (a.childCount ?? 0) - (b.childCount ?? 0);
        break;
      case "address":
        cmp = (a.address || "").localeCompare(b.address || "", "sv", { sensitivity: "base" });
        break;
    }
    return cmp * dir;
  });
  return arr;
}

function TreeRow({
  node,
  level,
  customerId,
  sync,
  expanded,
  onToggleExpand,
  onSelectObject,
  onHoverObject,
  sortConfig,
}: {
  node: TreeNode;
  level: number;
  customerId: string;
  sync: SyncState;
  expanded: Set<string>;
  onToggleExpand: (id: string, open: boolean) => void;
  onSelectObject: (id: string | null) => void;
  onHoverObject: (id: string | null) => void;
  sortConfig: TreeSortConfig;
}) {
  const open = expanded.has(node.id);
  const setOpen = (v: boolean) => onToggleExpand(node.id, v);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const hasChildren = (node.childCount ?? 0) > 0;
  const info = HIERARCHY_LEVELS[node.hierarchyLevel || "fastighet"] || HIERARCHY_LEVELS.fastighet;
  const Icon = info.icon;
  const isSelected = sync.selectedObjectId === node.id;
  const isHovered = sync.hoveredObjectId === node.id;

  const childrenQuery = useQuery<TreeNode[]>({
    queryKey: ["/api/customers", customerId, "objects", "tree-children", node.id],
    queryFn: async () => {
      const r = await fetch(
        `/api/customers/${encodeURIComponent(customerId)}/objects/tree-children?parentId=${encodeURIComponent(node.id)}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Kunde inte hämta barnobjekt");
      return r.json();
    },
    enabled: open && hasChildren,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isSelected]);

  return (
    <div className="select-none">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div
          className={`flex items-center gap-2 py-1.5 px-2 rounded-md hover-elevate cursor-pointer ${
            isSelected ? "bg-primary/10 ring-1 ring-primary/40" : isHovered ? "bg-muted" : ""
          }`}
          style={{ paddingLeft: `${level * 18 + 8}px` }}
          ref={rowRef}
          onClick={() => onSelectObject(isSelected ? null : node.id)}
          onMouseEnter={() => onHoverObject(node.id)}
          onMouseLeave={() => onHoverObject(null)}
          data-testid={`tree-row-${node.id}`}
        >
          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 p-0"
                onClick={(e) => e.stopPropagation()}
                data-testid={`button-toggle-${node.id}`}
              >
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
          ) : (
            <div className="w-5" />
          )}
          <Icon className={`h-4 w-4 ${info.color}`} />
          <Link
            href={`/objects/${node.id}`}
            className="text-sm font-medium flex-1 truncate hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {node.name}
          </Link>
          <Badge variant="outline" className="text-[10px]">{info.label}</Badge>
          {node.address && (
            <span className="text-xs text-muted-foreground truncate max-w-[180px] hidden sm:inline">
              {node.address}
            </span>
          )}
          {hasChildren && (
            <Badge variant="secondary" className="text-[10px]" data-testid={`badge-childcount-${node.id}`}>
              {node.childCount}
            </Badge>
          )}
        </div>
        {hasChildren && (
          <CollapsibleContent>
            {childrenQuery.isLoading && (
              <div
                className="flex items-center gap-2 py-1.5 text-xs text-muted-foreground"
                style={{ paddingLeft: `${(level + 1) * 18 + 8}px` }}
                data-testid={`loading-children-${node.id}`}
              >
                <Loader2 className="h-3 w-3 animate-spin" />
                Laddar...
              </div>
            )}
            {childrenQuery.isError && (
              <div
                className="flex items-center gap-2 py-1.5 text-xs text-destructive"
                style={{ paddingLeft: `${(level + 1) * 18 + 8}px` }}
              >
                <AlertTriangle className="h-3 w-3" />
                Kunde inte ladda barn.
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-xs px-1"
                  onClick={(e) => { e.stopPropagation(); childrenQuery.refetch(); }}
                >Försök igen</Button>
              </div>
            )}
            {sortTreeNodes(childrenQuery.data || [], sortConfig).map((c) => (
              <TreeRow
                key={c.id}
                node={c}
                level={level + 1}
                customerId={customerId}
                sync={sync}
                expanded={expanded}
                onToggleExpand={onToggleExpand}
                onSelectObject={onSelectObject}
                onHoverObject={onHoverObject}
                sortConfig={sortConfig}
              />
            ))}
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  );
}

function makeIcon(level: string | null, isSelected: boolean, isHovered: boolean) {
  const info = HIERARCHY_LEVELS[level || "fastighet"] || HIERARCHY_LEVELS.fastighet;
  const color = info.hex;
  const size = isSelected ? 28 : isHovered ? 22 : 18;
  const ring = isSelected
    ? "border:3px solid #f59e0b;"
    : isHovered
    ? "border:3px solid #fcd34d;"
    : "border:2px solid white;";
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="background-color:${color};width:${size}px;height:${size}px;border-radius:50%;${ring}box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function FlyToPoint({ point }: { point: { latitude: number; longitude: number; id: string } | null }) {
  const map = useMap();
  useEffect(() => {
    if (point) {
      map.flyTo([point.latitude, point.longitude], Math.max(map.getZoom(), 14), { duration: 0.6 });
    }
  }, [point?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function MapBoundsFitter({ points, refitKey }: { points: MapPoint[]; refitKey: string }) {
  const map = useMap();
  const fittedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (points.length === 0) return;
    if (fittedKeyRef.current === refitKey) return;
    const bounds = L.latLngBounds(points.map((p) => L.latLng(p.latitude, p.longitude)));
    map.fitBounds(bounds, { padding: [30, 30] });
    fittedKeyRef.current = refitKey;
  }, [points, map, refitKey]);
  return null;
}

function ViewportTracker({
  onChange,
}: {
  onChange: (bbox: [number, number, number, number], zoom: number) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const b = map.getBounds();
    onChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], map.getZoom());
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps
  useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      onChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], map.getZoom());
    },
    zoomend: () => {
      const b = map.getBounds();
      onChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], map.getZoom());
    },
  });
  return null;
}

interface MapAggregate {
  cellKey: string;
  latitude: number;
  longitude: number;
  count: number;
}

function makeAggregateIcon(count: number) {
  let size = 36;
  let bg = "#3b82f6";
  if (count >= 1000) {
    size = 56;
    bg = "#dc2626";
  } else if (count >= 100) {
    size = 48;
    bg = "#f59e0b";
  } else if (count >= 10) {
    size = 42;
    bg = "#10b981";
  }
  return L.divIcon({
    className: "server-cluster-marker",
    html: `<div style="background-color:${bg};color:white;width:${size}px;height:${size}px;border-radius:50%;border:3px solid rgba(255,255,255,0.9);box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px;">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function ServerClusterLayer({
  aggregates,
  onClusterClick,
}: {
  aggregates: MapAggregate[];
  onClusterClick: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  const groupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const group = L.layerGroup();
    groupRef.current = group;
    map.addLayer(group);
    return () => {
      map.removeLayer(group);
      groupRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    for (const a of aggregates) {
      const marker = L.marker([a.latitude, a.longitude], { icon: makeAggregateIcon(a.count) });
      marker.on("click", () => onClusterClick(a.latitude, a.longitude));
      group.addLayer(marker);
    }
  }, [aggregates, onClusterClick]);

  return null;
}

interface MarkerClusterLayerProps {
  points: MapPoint[];
  sync: SyncState;
  onSelectObject: (id: string | null) => void;
  onHoverObject: (id: string | null) => void;
}

interface ProfitabilityResponse {
  customerId: string;
  orderCount: number;
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
  marginPercent: number;
  monthly: Array<{
    month: string;
    revenue: number;
    cost: number;
    margin: number;
    marginPercent: number;
    orders: number;
  }>;
}

type HierarchyNode = { id: string; name: string; hierarchyType?: string | null; isReseller?: boolean };
type HierarchyResponse = {
  id: string;
  name: string;
  hierarchyType: string | null;
  isReseller: boolean;
  parent: HierarchyNode | null;
  ancestors: HierarchyNode[];
  children: HierarchyNode[];
};

const HIERARCHY_LABEL: Record<string, string> = {
  koncern: "Koncern",
  region: "Region",
  lokal: "Lokal",
};

function HierarchyTypeBadge({ type }: { type?: string | null }) {
  if (!type) return null;
  return <Badge variant="outline" className="ml-2 text-xs">{HIERARCHY_LABEL[type] ?? type}</Badge>;
}

function CustomerHierarchyTab({ customerId, isAdmin }: { customerId: string; isAdmin: boolean }) {
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useQuery<HierarchyResponse>({
    queryKey: ["/api/customers", customerId, "hierarchy"],
  });
  const candidatesQuery = useQuery<HierarchyNode[]>({
    queryKey: ["/api/customers-by-hierarchy"],
    enabled: isAdmin,
  });

  const [parentDraft, setParentDraft] = useState<string>("");
  const [typeDraft, setTypeDraft] = useState<string>("");

  useEffect(() => {
    if (data) {
      setParentDraft(data.parent?.id ?? "__none__");
      setTypeDraft(data.hierarchyType ?? "__none__");
    }
  }, [data]);

  const parentMutation = useMutation({
    mutationFn: async (parentCustomerId: string | null) => {
      return apiRequest("PUT", `/api/customers/${customerId}/parent`, { parentCustomerId });
    },
    onSuccess: () => {
      toast({ title: "Förälder uppdaterad" });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "hierarchy"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
    },
    onError: (e: Error) => toast({ title: "Kunde inte uppdatera förälder", description: e.message, variant: "destructive" }),
  });

  const typeMutation = useMutation({
    mutationFn: async (hierarchyType: string | null) => {
      return apiRequest("PATCH", `/api/customers/${customerId}`, { hierarchyType });
    },
    onSuccess: () => {
      toast({ title: "Nivå uppdaterad" });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "hierarchy"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId] });
    },
    onError: (e: Error) => toast({ title: "Kunde inte uppdatera nivå", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <Card><CardContent className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Laddar koncernstruktur…
      </CardContent></Card>
    );
  }
  if (isError || !data) {
    return (
      <Card><CardContent className="p-6 flex items-center gap-2 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4" /> Kunde inte hämta hierarki.
        <Button variant="ghost" size="sm" onClick={() => refetch()}>Försök igen</Button>
      </CardContent></Card>
    );
  }

  // Filtrera bort sig själv och egna ättlingar ur parent-kandidater (förfäder okej är de redan).
  const childIds = new Set(data.children.map((c) => c.id));
  const parentOptions = (candidatesQuery.data ?? []).filter(
    (c) => c.id !== customerId && !childIds.has(c.id),
  );

  const breadcrumb = [...data.ancestors].reverse();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Position i koncern</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {breadcrumb.length === 0 && !data.parent ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-parent">
              Fristående kund (ingen förälder).
            </p>
          ) : (
            <nav className="flex flex-wrap items-center gap-1 text-sm" data-testid="breadcrumb-hierarchy">
              {breadcrumb.map((a) => (
                <Fragment key={a.id}>
                  <Link href={`/customers/${a.id}`}>
                    <a className="text-primary hover:underline" data-testid={`link-ancestor-${a.id}`}>
                      {a.name}
                    </a>
                  </Link>
                  <HierarchyTypeBadge type={a.hierarchyType} />
                  <span className="text-muted-foreground mx-1">/</span>
                </Fragment>
              ))}
              <span className="font-medium" data-testid="text-current-customer">{data.name}</span>
              <HierarchyTypeBadge type={data.hierarchyType} />
            </nav>
          )}

          {isAdmin && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Nivå</label>
                <Select
                  value={typeDraft}
                  onValueChange={(v) => {
                    setTypeDraft(v);
                    typeMutation.mutate(v === "__none__" ? null : v);
                  }}
                >
                  <SelectTrigger data-testid="select-hierarchy-type"><SelectValue placeholder="Välj nivå" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Ingen —</SelectItem>
                    {CUSTOMER_HIERARCHY_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{HIERARCHY_LABEL[t] ?? t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Förälder</label>
                <Select
                  value={parentDraft}
                  onValueChange={(v) => {
                    setParentDraft(v);
                    parentMutation.mutate(v === "__none__" ? null : v);
                  }}
                >
                  <SelectTrigger data-testid="select-parent-customer"><SelectValue placeholder="Välj förälder" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Ingen (fristående) —</SelectItem>
                    {parentOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}{c.hierarchyType ? ` (${HIERARCHY_LABEL[c.hierarchyType] ?? c.hierarchyType})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CustomerHierarchyRollupCard customerId={customerId} />

      <Card>
        <CardHeader><CardTitle className="text-sm">Underliggande kunder ({data.children.length})</CardTitle></CardHeader>
        <CardContent>
          {data.children.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-children">Inga underliggande kunder.</p>
          ) : (
            <ul className="divide-y" data-testid="list-children">
              {data.children.map((c) => (
                <li key={c.id} className="py-2 flex items-center justify-between">
                  <div className="flex items-center">
                    <Link href={`/customers/${c.id}`}>
                      <a className="text-primary hover:underline" data-testid={`link-child-${c.id}`}>{c.name}</a>
                    </Link>
                    <HierarchyTypeBadge type={c.hierarchyType} />
                    {c.isReseller && <Badge variant="secondary" className="ml-2 text-xs">Återförsäljare</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface HierarchyStatsResponse {
  customerId: string;
  self: { objectCount: number; activeOrders: number; ordersLast30Days: number; revenueLast30Days: number };
  rollup: { objectCount: number; activeOrders: number; ordersLast30Days: number; revenueLast30Days: number };
  descendantCount: number;
  children: Array<{
    id: string;
    name: string;
    hierarchyType: string | null;
    isReseller: boolean;
    objectCount: number;
    activeOrders: number;
    ordersLast30Days: number;
    revenueLast30Days: number;
    descendantCount: number;
  }>;
}

function CustomerHierarchyRollupCard({ customerId }: { customerId: string }) {
  const { data, isLoading, isError, refetch } = useQuery<HierarchyStatsResponse>({
    queryKey: ["/api/customers", customerId, "hierarchy", "stats"],
    queryFn: async () => {
      const r = await fetch(`/api/customers/${encodeURIComponent(customerId)}/hierarchy/stats`, { credentials: "include" });
      if (!r.ok) throw new Error("Kunde inte hämta rollup");
      return r.json();
    },
  });

  if (isLoading) {
    return (
      <Card><CardContent className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Laddar rollup-statistik…
      </CardContent></Card>
    );
  }
  if (isError || !data) {
    return (
      <Card><CardContent className="p-6 flex items-center gap-2 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4" /> Kunde inte hämta rollup.
        <Button variant="ghost" size="sm" onClick={() => refetch()}>Försök igen</Button>
      </CardContent></Card>
    );
  }

  const hasChildren = data.children.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Rollup-statistik (senaste 30 dagarna)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="rollup-summary">
          <div>
            <div className="text-xs text-muted-foreground">Aktiva objekt</div>
            <div className="text-xl font-bold" data-testid="rollup-total-objects">{data.rollup.objectCount.toLocaleString()}</div>
            {hasChildren && <div className="text-xs text-muted-foreground">varav egna: {data.self.objectCount.toLocaleString()}</div>}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Aktiva ordrar</div>
            <div className="text-xl font-bold" data-testid="rollup-total-active-orders">{data.rollup.activeOrders.toLocaleString()}</div>
            {hasChildren && <div className="text-xs text-muted-foreground">varav egna: {data.self.activeOrders.toLocaleString()}</div>}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Ordrar 30d</div>
            <div className="text-xl font-bold" data-testid="rollup-total-orders-30d">{data.rollup.ordersLast30Days.toLocaleString()}</div>
            {hasChildren && <div className="text-xs text-muted-foreground">varav egna: {data.self.ordersLast30Days.toLocaleString()}</div>}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Intäkt 30d</div>
            <div className="text-xl font-bold" data-testid="rollup-total-revenue-30d">{formatSekFromOre(data.rollup.revenueLast30Days)}</div>
            {hasChildren && <div className="text-xs text-muted-foreground">varav egna: {formatSekFromOre(data.self.revenueLast30Days)}</div>}
          </div>
        </div>

        {hasChildren && (
          <div className="overflow-x-auto pt-2 border-t">
            <table className="w-full text-sm" data-testid="table-hierarchy-rollup">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 pr-3">Kund</th>
                  <th className="py-2 pr-3">Nivå</th>
                  <th className="py-2 pr-3 text-right">Ättlingar</th>
                  <th className="py-2 pr-3 text-right">Aktiva objekt</th>
                  <th className="py-2 pr-3 text-right">Aktiva ordrar</th>
                  <th className="py-2 pr-3 text-right">Ordrar 30d</th>
                  <th className="py-2 text-right">Intäkt 30d</th>
                </tr>
              </thead>
              <tbody>
                {data.children.map((c) => (
                  <tr key={c.id} className="border-b last:border-0" data-testid={`row-rollup-${c.id}`}>
                    <td className="py-1.5 pr-3">
                      <Link href={`/customers/${c.id}`}>
                        <a className="text-primary hover:underline" data-testid={`link-rollup-child-${c.id}`}>{c.name}</a>
                      </Link>
                      {c.isReseller && <Badge variant="secondary" className="ml-2 text-xs">Återförsäljare</Badge>}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">
                      {c.hierarchyType ? (HIERARCHY_LABEL[c.hierarchyType] ?? c.hierarchyType) : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-xs text-muted-foreground">{c.descendantCount}</td>
                    <td className="py-1.5 pr-3 text-right">{c.objectCount.toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-right">{c.activeOrders.toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-right">{c.ordersLast30Days.toLocaleString()}</td>
                    <td className="py-1.5 text-right font-medium">{formatSekFromOre(c.revenueLast30Days)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 font-medium bg-muted/30" data-testid="row-rollup-total">
                  <td className="py-1.5 pr-3">Totalt (inkl. egna)</td>
                  <td className="py-1.5 pr-3"></td>
                  <td className="py-1.5 pr-3 text-right text-xs">{data.descendantCount}</td>
                  <td className="py-1.5 pr-3 text-right">{data.rollup.objectCount.toLocaleString()}</td>
                  <td className="py-1.5 pr-3 text-right">{data.rollup.activeOrders.toLocaleString()}</td>
                  <td className="py-1.5 pr-3 text-right">{data.rollup.ordersLast30Days.toLocaleString()}</td>
                  <td className="py-1.5 text-right">{formatSekFromOre(data.rollup.revenueLast30Days)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CustomerProfitabilityTab({ customerId }: { customerId: string }) {
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const hierarchyQuery = useQuery<HierarchyResponse>({
    queryKey: ["/api/customers", customerId, "hierarchy"],
  });
  const hasChildren = (hierarchyQuery.data?.children.length ?? 0) > 0;

  const { data, isLoading, isError, refetch } = useQuery<ProfitabilityResponse>({
    queryKey: ["/api/customers", customerId, "profitability", { includeDescendants }],
    queryFn: async () => {
      const qs = includeDescendants ? "?includeDescendants=true" : "";
      const r = await fetch(`/api/customers/${encodeURIComponent(customerId)}/profitability${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Kunde inte hämta lönsamhet");
      return r.json();
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Laddar lönsamhet...
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> Kunde inte hämta lönsamhet.
          <Button variant="ghost" size="sm" onClick={() => refetch()}>Försök igen</Button>
        </CardContent>
      </Card>
    );
  }

  const positive = data.totalMargin >= 0;
  return (
    <div className="space-y-4">
      {hasChildren && (
        <Card>
          <CardContent className="p-3 flex items-center justify-between gap-3" data-testid="toggle-include-descendants-card">
            <div className="flex items-center gap-2 text-sm">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <span>Inkludera ättlingar i koncernen</span>
              {includeDescendants && data && (
                <Badge variant="secondary" className="text-xs">{data.orderCount.toLocaleString()} ordrar</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{includeDescendants ? "På" : "Av"}</span>
              <Switch
                checked={includeDescendants}
                onCheckedChange={setIncludeDescendants}
                data-testid="switch-include-descendants"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Card data-testid="card-customer-revenue">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Intäkt</div>
            <div className="text-xl font-bold">{(data.totalRevenue / 100).toLocaleString()} kr</div>
          </CardContent>
        </Card>
        <Card data-testid="card-customer-cost">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Kostnad</div>
            <div className="text-xl font-bold">{(data.totalCost / 100).toLocaleString()} kr</div>
          </CardContent>
        </Card>
        <Card data-testid="card-customer-margin">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Marginal</div>
            <div className={`text-xl font-bold flex items-center gap-1 ${positive ? "text-chart-2" : "text-destructive"}`}>
              {positive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              {positive ? "+" : ""}{(data.totalMargin / 100).toLocaleString()} kr
            </div>
            <div className="text-xs text-muted-foreground mt-1">{data.marginPercent}% marginal</div>
          </CardContent>
        </Card>
        <Card data-testid="card-customer-orders">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Ordrar</div>
            <div className="text-xl font-bold">{data.orderCount.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Månadstrend (senaste 12 månaderna)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.monthly.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Inga ordrar med ekonomisk data senaste året.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-customer-profitability-monthly">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-3">Månad</th>
                    <th className="py-2 pr-3 text-right">Ordrar</th>
                    <th className="py-2 pr-3 text-right">Intäkt</th>
                    <th className="py-2 pr-3 text-right">Kostnad</th>
                    <th className="py-2 pr-3 text-right">Marginal</th>
                    <th className="py-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {data.monthly.map((m) => (
                    <tr key={m.month} className="border-b last:border-0" data-testid={`row-monthly-${m.month}`}>
                      <td className="py-1.5 pr-3 font-mono text-xs">{m.month}</td>
                      <td className="py-1.5 pr-3 text-right">{m.orders}</td>
                      <td className="py-1.5 pr-3 text-right">{(m.revenue / 100).toLocaleString()} kr</td>
                      <td className="py-1.5 pr-3 text-right">{(m.cost / 100).toLocaleString()} kr</td>
                      <td className={`py-1.5 pr-3 text-right font-medium ${m.margin >= 0 ? "text-chart-2" : "text-destructive"}`}>
                        {m.margin >= 0 ? "+" : ""}{(m.margin / 100).toLocaleString()} kr
                      </td>
                      <td className="py-1.5 text-right text-xs text-muted-foreground">{m.marginPercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MarkerClusterLayer({ points, sync, onSelectObject, onHoverObject }: MarkerClusterLayerProps) {
  const map = useMap();
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);
  const markerMapRef = useRef<Map<string, L.Marker>>(new Map());

  useEffect(() => {
    const lAny = L as unknown as { markerClusterGroup: (opts?: unknown) => L.MarkerClusterGroup };
    const group = lAny.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: true,
      maxClusterRadius: 60,
    });
    groupRef.current = group;
    map.addLayer(group);
    return () => {
      map.removeLayer(group);
      groupRef.current = null;
      markerMapRef.current.clear();
    };
  }, [map]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    markerMapRef.current.clear();
    const markers: L.Marker[] = [];
    for (const p of points) {
      const marker = L.marker([p.latitude, p.longitude], {
        icon: makeIcon(p.hierarchyLevel, p.id === sync.selectedObjectId, p.id === sync.hoveredObjectId),
      });
      const popupEl = document.createElement("div");
      const nameEl = document.createElement("div");
      nameEl.style.fontWeight = "500";
      nameEl.textContent = p.name;
      popupEl.appendChild(nameEl);
      if (p.address) {
        const addrEl = document.createElement("div");
        addrEl.style.fontSize = "11px";
        addrEl.textContent = p.address;
        popupEl.appendChild(addrEl);
      }
      const linkEl = document.createElement("a");
      linkEl.setAttribute("href", `/objects/${encodeURIComponent(p.id)}`);
      linkEl.style.fontSize = "11px";
      linkEl.style.color = "#3b82f6";
      linkEl.textContent = "Öppna objekt →";
      popupEl.appendChild(linkEl);
      marker.bindPopup(popupEl);
      marker.on("click", () => onSelectObject(p.id === sync.selectedObjectId ? null : p.id));
      marker.on("mouseover", () => onHoverObject(p.id));
      marker.on("mouseout", () => onHoverObject(null));
      markers.push(marker);
      markerMapRef.current.set(p.id, marker);
    }
    group.addLayers(markers);
  }, [points]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Array.from(markerMapRef.current.entries()).forEach(([id, marker]) => {
      const p = points.find((x) => x.id === id);
      if (!p) return;
      marker.setIcon(
        makeIcon(p.hierarchyLevel, id === sync.selectedObjectId, id === sync.hoveredObjectId),
      );
    });
  }, [sync.selectedObjectId, sync.hoveredObjectId, points]);

  return null;
}

function formatSek(value: number): string {
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(value);
}

type TreeSearchInputProps = {
  onDebouncedChange: (value: string) => void;
  onClear: () => void;
};

const TreeSearchInput = memo(function TreeSearchInput({ onDebouncedChange, onClear }: TreeSearchInputProps) {
  const [value, setValue] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => onDebouncedChange(value), 250);
    return () => clearTimeout(timer);
  }, [value, onDebouncedChange]);
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Sök i hierarkin (namn, adress, objektnummer)..."
        className="pl-8 pr-8"
        data-testid="input-tree-search"
      />
      {value && (
        <button
          onClick={() => { setValue(""); onClear(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover-elevate"
          aria-label="Rensa sökning"
          data-testid="button-clear-search"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
    </div>
  );
});

function CustomerInvoiceQueueRelease({ customerId }: { customerId: string }) {
  const { toast } = useToast();
  type QueueGroup = {
    key: string;
    customerId: string | null;
    recipientId: string | null;
    totalAmount: number;
    workOrders: unknown[];
  };
  type QueueResponse = { groups: QueueGroup[]; totalWorkOrders: number };

  const queueQuery = useQuery<QueueResponse>({
    queryKey: ["/api/invoice-queue", { state: "held" }],
  });

  const customerGroups = (queueQuery.data?.groups ?? []).filter((g) => g.customerId === customerId);
  const totalHeld = customerGroups.reduce((s, g) => s + g.workOrders.length, 0);
  const totalAmount = customerGroups.reduce((s, g) => s + g.totalAmount, 0);

  const releaseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/invoice-queue/release", {
        customerId,
        reason: "Manuell släpp via kundvyn",
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Fakturor släppta",
        description: `${data.invoicesCreated ?? 0} samlingsfakturor skapade för denna kund.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-queue/consolidated"] });
    },
    onError: (err: any) => {
      toast({
        title: "Kunde inte släppa",
        description: err?.message ?? "Okänt fel",
        variant: "destructive",
      });
    },
  });

  if (queueQuery.isLoading || !totalHeld) return null;

  return (
    <Card className="mb-4 border-warning/40" data-testid="card-customer-invoice-queue">
      <CardContent className="pt-4 pb-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <Clock className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-sm">Bromsade fakturor i kö</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {totalHeld} arbetsorder väntar på konsolidering enligt mottagarens policy.
            </div>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => releaseMutation.mutate()}
          disabled={releaseMutation.isPending}
          data-testid="button-release-customer-invoices"
        >
          <Send className="h-4 w-4 mr-2" />
          Släpp fakturor nu
        </Button>
      </CardContent>
    </Card>
  );
}

export default function CustomerDetailPage() {
  const [, params] = useRoute("/customers/:id");
  const customerId = params?.id;
  const mapConfig = useMapConfig();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const [sync, setSync] = useState<SyncState>({
    selectedObjectId: null,
    hoveredObjectId: null,
  });
  const [mapBbox, setMapBbox] = useState<[number, number, number, number] | null>(null);
  const [mapZoom, setMapZoom] = useState<number>(11);
  const [mapTabActive, setMapTabActive] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<TreeSortConfig>({ field: "name", direction: "asc" });
  const toggleSort = useCallback((field: TreeSortField) => {
    setSortConfig(prev => prev.field === field
      ? { field, direction: prev.direction === "asc" ? "desc" : "asc" }
      : { field, direction: "asc" });
  }, []);
  const SortIcon = ({ field }: { field: TreeSortField }) => {
    if (sortConfig.field !== field) return <ArrowUpDown className="h-4 w-4 opacity-50 stroke-[2.25]" />;
    return sortConfig.direction === "asc"
      ? <ArrowUp className="h-4 w-4 stroke-[2.75] text-primary" />
      : <ArrowDown className="h-4 w-4 stroke-[2.75] text-primary" />;
  };
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResetKey, setSearchResetKey] = useState(0);
  const mapRef = useRef<L.Map | null>(null);

  const handleDebouncedSearch = useCallback((v: string) => setSearchQuery(v.trim()), []);
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResetKey((k) => k + 1);
  }, []);

  useEffect(() => {
    setExpanded(new Set());
    setSearchQuery("");
    setSearchResetKey((k) => k + 1);
  }, [customerId]);

  const toggleExpand = (id: string, open: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  const setSelectedObject = (id: string | null) =>
    setSync((s) => ({ ...s, selectedObjectId: id }));
  const setHoveredObject = (id: string | null) =>
    setSync((s) => ({ ...s, hoveredObjectId: id }));

  const customerQuery = useQuery<Customer>({
    queryKey: ["/api/customers", customerId],
    enabled: !!customerId,
  });

  const statsQuery = useQuery<CustomerStats>({
    queryKey: ["/api/customers", customerId, "stats"],
    queryFn: async () => {
      const r = await fetch(`/api/customers/${customerId}/stats`, { credentials: "include" });
      if (!r.ok) throw new Error("Kunde inte hämta statistik");
      return r.json();
    },
    enabled: !!customerId,
  });

  const { toast } = useToast();
  const recalculateInheritanceMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/customers/${customerId}/recalculate-inheritance`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "objects"] });
      toast({
        title: "Arv omräknat",
        description: "Alla ärvda värden har uppdaterats för kundens objekt.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Kunde inte räkna om ärvda värden",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const rootsQuery = useQuery<TreeNode[]>({
    queryKey: ["/api/customers", customerId, "objects", "tree-roots"],
    queryFn: async () => {
      const url = `/api/customers/${encodeURIComponent(customerId!)}/objects/tree-roots`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error("Kunde inte hämta hierarki");
      return r.json();
    },
    enabled: !!customerId,
    staleTime: 60_000,
  });

  const searchHitsQuery = useQuery<SearchHit[]>({
    queryKey: ["/api/customers", customerId, "objects", "search", searchQuery],
    queryFn: async () => {
      const r = await fetch(
        `/api/customers/${encodeURIComponent(customerId!)}/objects/search?q=${encodeURIComponent(searchQuery)}&limit=50`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Sökningen misslyckades");
      return r.json();
    },
    enabled: !!customerId && searchQuery.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const jumpToHit = (hit: SearchHit) => {
    const ancestorIds = hit.path
      .filter((p) => p.id !== hit.id)
      .map((p) => p.id);
    setExpanded((prev) => {
      const next = new Set(prev);
      ancestorIds.forEach((id) => next.add(id));
      return next;
    });
    setSelectedObject(hit.id);
  };

  const zoomBucket = Math.round(mapZoom);
  const coordsQueryKey = useMemo(() => {
    const bboxKey = mapBbox ? mapBbox.map((n) => n.toFixed(3)).join(",") : "all";
    return [
      "/api/customers",
      customerId,
      "objects",
      "coordinates",
      bboxKey,
      zoomBucket,
    ];
  }, [customerId, mapBbox, zoomBucket]);

  type CoordsResponse =
    | { mode: "points"; points: MapPoint[]; total: number }
    | { mode: "aggregates"; aggregates: MapAggregate[]; total: number };

  const coordsQuery = useQuery<CoordsResponse>({
    queryKey: coordsQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (mapBbox) params.set("bbox", mapBbox.join(","));
      params.set("limit", "2000");
      params.set("zoom", String(zoomBucket));
      const r = await fetch(
        `/api/customers/${encodeURIComponent(customerId!)}/objects/coordinates?${params.toString()}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Kunde inte hämta kartdata");
      return r.json();
    },
    enabled: !!customerId && mapTabActive,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const selectedPointQuery = useQuery<MapPoint | null>({
    queryKey: ["/api/customers", customerId, "objects", "point", sync.selectedObjectId],
    queryFn: async () => {
      const r = await fetch(`/api/objects/${encodeURIComponent(sync.selectedObjectId!)}`, { credentials: "include" });
      if (!r.ok) return null;
      const o = await r.json();
      if (o.latitude == null || o.longitude == null) return null;
      return {
        id: o.id,
        name: o.name,
        address: o.address ?? null,
        latitude: o.latitude,
        longitude: o.longitude,
        hierarchyLevel: o.hierarchyLevel ?? null,
      };
    },
    enabled: !!customerId && !!sync.selectedObjectId,
    staleTime: 60_000,
  });

  const roots = rootsQuery.data || [];
  const coordsData = coordsQuery.data;
  const mapPoints: MapPoint[] = coordsData?.mode === "points" ? coordsData.points : [];
  const mapAggregates: MapAggregate[] = coordsData?.mode === "aggregates" ? coordsData.aggregates : [];
  const mapTotalInView = coordsData?.total ?? 0;
  const flyTarget = selectedPointQuery.data || null;

  if (!customerId) return null;
  if (customerQuery.isError) {
    return <QueryErrorState onRetry={() => customerQuery.refetch()} />;
  }

  const customer = customerQuery.data;
  const stats = statsQuery.data;
  const isLoading = customerQuery.isLoading || statsQuery.isLoading;

  const ErrorBanner = ({ message, onRetry, testId }: { message: string; onRetry: () => void; testId: string }) => (
    <div
      className="flex items-center gap-3 p-3 rounded-md border border-destructive/40 bg-destructive/5 text-sm"
      data-testid={testId}
    >
      <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
      <span className="flex-1">{message}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>Försök igen</Button>
    </div>
  );

  const initialCenter: [number, number] = mapPoints[0]
    ? [mapPoints[0].latitude, mapPoints[0].longitude]
    : mapAggregates[0]
    ? [mapAggregates[0].latitude, mapAggregates[0].longitude]
    : [59.3, 18.07];

  const handleAggregateClick = (lat: number, lng: number) => {
    const map = mapRef.current;
    if (!map) return;
    const targetZoom = Math.min(map.getZoom() + 2, 18);
    map.flyTo([lat, lng], targetZoom, { duration: 0.5 });
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <Link href="/customers">
        <Button variant="ghost" size="sm" className="gap-2" data-testid="button-back-customers">
          <ArrowLeft className="h-4 w-4" /> Tillbaka till kunder
        </Button>
      </Link>

      {isLoading || !customer ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <>
          <PageHeader
            title={customer.name}
            description={
              [customer.customerNumber && `Kundnr: ${customer.customerNumber}`, customer.orgNumber && `Org-nr: ${customer.orgNumber}`]
                .filter(Boolean)
                .join(" · ") || undefined
            }
            icon={Building2}
          />

          <div className="flex flex-wrap gap-2">
            <Link href={`/objects?customerId=${customer.id}`}>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid="link-customer-objects">
                <Package className="h-3.5 w-3.5" /> Visa objekt
              </Button>
            </Link>
            <Link href={`/planner?customerId=${customer.id}`}>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid="link-customer-planning">
                <ClipboardList className="h-3.5 w-3.5" /> Planering
              </Button>
            </Link>
            <Link href={`/invoicing?customerId=${customer.id}`}>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid="link-customer-invoices">
                <FileText className="h-3.5 w-3.5" /> Fakturahistorik
              </Button>
            </Link>
          </div>

          {statsQuery.isError && (
            <ErrorBanner
              message="Kunde inte hämta statistik för kunden."
              onRetry={() => statsQuery.refetch()}
              testId="error-stats"
            />
          )}
          {rootsQuery.isError && (
            <ErrorBanner
              message="Kunde inte hämta hierarkin."
              onRetry={() => rootsQuery.refetch()}
              testId="error-objects"
            />
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Package className="h-3.5 w-3.5" /> Objekt
                </div>
                <div className="text-2xl font-semibold mt-1" data-testid="stat-objects">
                  {stats?.totalObjects ?? 0}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Repeat className="h-3.5 w-3.5" /> Aktiva abonnemang
                </div>
                <div className="text-2xl font-semibold mt-1" data-testid="stat-active-subscriptions">
                  {stats?.activeSubscriptions ?? 0}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <ClipboardList className="h-3.5 w-3.5" /> Aktiva ordrar
                </div>
                <div className="text-2xl font-semibold mt-1" data-testid="stat-active-orders">
                  {stats?.activeOrders ?? 0}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Receipt className="h-3.5 w-3.5" /> Fakturerat 12 mån
                </div>
                <div className="text-lg font-semibold mt-1" data-testid="stat-invoiced-12m">
                  {formatSek(stats?.invoicedLast12Months ?? 0)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Totalt ordrar</div>
                <div className="text-2xl font-semibold mt-1" data-testid="stat-total-orders">
                  {stats?.totalOrders ?? 0}
                </div>
                {stats && stats.totalOrders > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {stats.completedOrders} utf. · {stats.invoicedOrders} fakt.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {stats && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => recalculateInheritanceMutation.mutate()}
                disabled={recalculateInheritanceMutation.isPending}
                data-testid="button-recalculate-inheritance"
              >
                {recalculateInheritanceMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Räkna om arv
              </Button>
            </div>
          )}

          {stats && Object.keys(stats.objectsByLevel || {}).length > 0 && (
            <Card data-testid="card-objects-by-level">
              <CardContent className="p-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium mr-1">Objekt per nivå:</span>
                {Object.entries(stats.objectsByLevel).map(([level, count]) => {
                  const info = HIERARCHY_LEVELS[level] || HIERARCHY_LEVELS.fastighet;
                  return (
                    <Badge
                      key={level}
                      variant="outline"
                      className="gap-1.5"
                      data-testid={`badge-level-${level}`}
                    >
                      <span className={info.color}>●</span>
                      {info.label}: <span className="font-semibold">{count}</span>
                    </Badge>
                  );
                })}
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">Kontakt</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {customer.orgNumber && (
                  <div className="flex items-center gap-2" data-testid="text-org-number">
                    <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-mono">{customer.orgNumber}</span>
                  </div>
                )}
                {customer.contactPerson && (
                  <div className="flex items-center gap-2"><Users className="h-3.5 w-3.5 text-muted-foreground" />{customer.contactPerson}</div>
                )}
                {customer.email && (
                  <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" /><a href={`mailto:${customer.email}`} className="hover:underline">{customer.email}</a></div>
                )}
                {customer.phone && (
                  <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" /><a href={`tel:${customer.phone}`} className="hover:underline">{customer.phone}</a></div>
                )}
                {(customer.address || customer.city) && (
                  <div className="flex items-start gap-2"><MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5" /><span>{[customer.address, customer.postalCode, customer.city].filter(Boolean).join(", ")}</span></div>
                )}
                {(customer.invoiceAddress || customer.invoiceEmail) && (
                  <div className="pt-2 mt-2 border-t space-y-1" data-testid="section-invoice-address">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Faktureringsuppgifter</div>
                    {customer.invoiceAddress && (
                      <div className="flex items-start gap-2 text-xs">
                        <FileText className="h-3 w-3 text-muted-foreground mt-0.5" />
                        <span>{[customer.invoiceAddress, customer.invoicePostalCode, customer.invoiceCity].filter(Boolean).join(", ")}</span>
                      </div>
                    )}
                    {customer.invoiceEmail && (
                      <div className="flex items-center gap-2 text-xs">
                        <Mail className="h-3 w-3 text-muted-foreground" />
                        <a href={`mailto:${customer.invoiceEmail}`} className="hover:underline">{customer.invoiceEmail}</a>
                      </div>
                    )}
                  </div>
                )}
                {!customer.orgNumber && !customer.contactPerson && !customer.email && !customer.phone && !customer.address && (
                  <div className="text-muted-foreground text-xs">Ingen kontaktinformation registrerad</div>
                )}
                {customer.notes && (
                  <div className="pt-2 mt-2 border-t text-muted-foreground text-xs whitespace-pre-wrap">{customer.notes}</div>
                )}
              </CardContent>
            </Card>

          </div>

          {customerId && (
            <div className="mb-4">
              <InvoiceRecipientsCard customerId={customerId} canEdit={isAdmin} />
            </div>
          )}

          {customerId && isAdmin && (
            <CustomerInvoiceQueueRelease customerId={customerId} />
          )}

          <Tabs defaultValue="tree" onValueChange={(v) => setMapTabActive(v === "map")}>
            <TabsList>
              <TabsTrigger value="tree" data-testid="tab-tree">
                <TreePine className="h-4 w-4 mr-2" /> Hierarki
              </TabsTrigger>
              <TabsTrigger value="customer-hierarchy" data-testid="tab-customer-hierarchy">
                <Users className="h-4 w-4 mr-2" /> Koncernstruktur
              </TabsTrigger>
              <TabsTrigger value="map" data-testid="tab-map">
                <MapIcon className="h-4 w-4 mr-2" /> Karta
              </TabsTrigger>
              <TabsTrigger value="delivery-preferences" data-testid="tab-delivery-preferences">
                Leveranspreferenser
              </TabsTrigger>
              {isAdmin && (
                <TabsTrigger value="portal-users" data-testid="tab-portal-users">
                  <Users className="h-4 w-4 mr-2" /> Portal-användare
                </TabsTrigger>
              )}
              {isAdmin && (
                <TabsTrigger value="profitability" data-testid="tab-profitability">
                  <TrendingUp className="h-4 w-4 mr-2" /> Lönsamhet
                </TabsTrigger>
              )}
            </TabsList>

            {isAdmin && customerId && (
              <TabsContent value="portal-users">
                <PortalUsersTab customerId={customerId} />
              </TabsContent>
            )}

            {customerId && (
              <TabsContent value="customer-hierarchy">
                <CustomerHierarchyTab customerId={customerId} isAdmin={isAdmin} />
              </TabsContent>
            )}

            <TabsContent value="tree">
              <Card>
                <CardContent className="p-3 space-y-3">
                  <TreeSearchInput
                    key={searchResetKey}
                    onDebouncedChange={handleDebouncedSearch}
                    onClear={clearSearch}
                  />

                  {searchQuery && (
                    <div
                      className="border rounded-md max-h-[300px] overflow-y-auto"
                      data-testid="search-results"
                    >
                      {searchHitsQuery.isLoading ? (
                        <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Söker...
                        </div>
                      ) : searchHitsQuery.isError ? (
                        <div className="flex items-center gap-2 p-3 text-xs text-destructive">
                          <AlertTriangle className="h-3 w-3" /> Sökningen misslyckades.
                          <Button variant="ghost" size="sm" className="h-5 text-xs px-1" onClick={() => searchHitsQuery.refetch()}>Försök igen</Button>
                        </div>
                      ) : (searchHitsQuery.data || []).length === 0 ? (
                        <div className="p-3 text-xs text-muted-foreground" data-testid="text-empty-search">
                          Inga objekt matchar "{searchQuery}".
                        </div>
                      ) : (
                        <ul className="divide-y">
                          {(searchHitsQuery.data || []).map((hit) => {
                            const info = HIERARCHY_LEVELS[hit.hierarchyLevel || "fastighet"] || HIERARCHY_LEVELS.fastighet;
                            const HitIcon = info.icon;
                            const pathLabel = hit.path
                              .filter((p) => p.id !== hit.id)
                              .map((p) => p.name)
                              .join(" › ");
                            return (
                              <li key={hit.id}>
                                <button
                                  onClick={() => jumpToHit(hit)}
                                  className="w-full text-left px-3 py-2 hover-elevate flex items-start gap-2"
                                  data-testid={`search-hit-${hit.id}`}
                                >
                                  <HitIcon className={`h-4 w-4 mt-0.5 ${info.color}`} />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-sm font-medium truncate"><HighlightedText text={hit.name} query={searchQuery} /></span>
                                      <Badge variant="outline" className="text-[10px]">{info.label}</Badge>
                                      {hit.objectNumber && (
                                        <span className="text-[10px] font-mono text-muted-foreground">#<HighlightedText text={hit.objectNumber} query={searchQuery} /></span>
                                      )}
                                    </div>
                                    {pathLabel && (
                                      <div className="text-xs text-muted-foreground truncate" data-testid={`search-hit-path-${hit.id}`}>
                                        {pathLabel}
                                      </div>
                                    )}
                                    {hit.address && (
                                      <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                                        <MapPin className="h-3 w-3" /> <HighlightedText text={hit.address} query={searchQuery} />
                                      </div>
                                    )}
                                  </div>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}

                  {rootsQuery.isLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-full" />
                      ))}
                    </div>
                  ) : roots.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-8 text-center" data-testid="text-empty-tree">
                      Inga objekt registrerade på denna kund ännu.
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[600px] overflow-y-auto">
                      <div className="flex items-center gap-3 px-3 py-2 border rounded-md bg-muted/40 text-xs font-medium text-muted-foreground" data-testid="header-sort-row">
                        <span className="text-muted-foreground/70 mr-1">Sortera:</span>
                        <button onClick={() => toggleSort("name")} className="flex items-center gap-1 hover:text-foreground" data-testid="button-sort-name">
                          Namn <SortIcon field="name" />
                        </button>
                        <button onClick={() => toggleSort("level")} className="flex items-center gap-1 hover:text-foreground" data-testid="button-sort-level">
                          Nivå <SortIcon field="level" />
                        </button>
                        <button onClick={() => toggleSort("address")} className="flex items-center gap-1 hover:text-foreground" data-testid="button-sort-address">
                          Adress <SortIcon field="address" />
                        </button>
                        <button onClick={() => toggleSort("children")} className="flex items-center gap-1 hover:text-foreground ml-auto" data-testid="button-sort-children">
                          Antal barn <SortIcon field="children" />
                        </button>
                      </div>
                      <div className="border rounded-md" data-testid="group-tree-roots">
                        <div className="p-2 space-y-0.5">
                          {sortTreeNodes(roots, sortConfig).map((n) => (
                            <TreeRow
                              key={n.id}
                              node={n}
                              level={0}
                              customerId={customerId}
                              sync={sync}
                              expanded={expanded}
                              onToggleExpand={toggleExpand}
                              onSelectObject={setSelectedObject}
                              onHoverObject={setHoveredObject}
                              sortConfig={sortConfig}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="map">
              <Card>
                <CardContent className="p-0 overflow-hidden rounded-md">
                  {coordsQuery.isLoading && mapPoints.length === 0 && mapAggregates.length === 0 ? (
                    <Skeleton className="h-[500px] w-full" />
                  ) : mapPoints.length === 0 && mapAggregates.length === 0 ? (
                    <div className="h-[500px] flex flex-col items-center justify-center text-muted-foreground text-sm gap-2" data-testid="text-empty-map">
                      <MapIcon className="h-8 w-8 opacity-40" />
                      Inga objekt med koordinater att visa.
                    </div>
                  ) : (
                    <div className="h-[500px] relative">
                      {coordsQuery.isFetching && (
                        <div className="absolute top-2 right-2 z-[1000] bg-background/90 border rounded-md px-2 py-1 text-xs flex items-center gap-1.5 shadow" data-testid="map-loading-indicator">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Uppdaterar
                        </div>
                      )}
                      <div className="absolute bottom-2 left-2 z-[1000] bg-background/90 border rounded-md px-2 py-1 text-xs shadow" data-testid="map-points-count">
                        {coordsData?.mode === "aggregates"
                          ? `${mapTotalInView} objekt i vyn (${mapAggregates.length} kluster) – zooma in för detaljer`
                          : `${mapPoints.length} objekt i vyn`}
                      </div>
                      <MapContainer
                        center={initialCenter}
                        zoom={11}
                        style={{ height: "100%", width: "100%" }}
                        scrollWheelZoom
                        ref={(instance) => {
                          mapRef.current = instance ?? null;
                        }}
                      >
                        <TileLayer url={mapConfig.tileUrl} attribution={mapConfig.attribution} />
                        <MapBoundsFitter points={mapPoints} refitKey="all" />
                        <ViewportTracker
                          onChange={(bbox, zoom) => {
                            setMapBbox(bbox);
                            setMapZoom(zoom);
                          }}
                        />
                        <FlyToPoint point={flyTarget} />
                        {coordsData?.mode === "aggregates" ? (
                          <ServerClusterLayer
                            aggregates={mapAggregates}
                            onClusterClick={handleAggregateClick}
                          />
                        ) : (
                          <MarkerClusterLayer
                            points={mapPoints}
                            sync={sync}
                            onSelectObject={setSelectedObject}
                            onHoverObject={setHoveredObject}
                          />
                        )}
                      </MapContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {isAdmin && (
              <TabsContent value="profitability">
                <CustomerProfitabilityTab customerId={customer.id} />
              </TabsContent>
            )}

            <TabsContent value="delivery-preferences">
              <DeliveryPreferencesEditor
                entityKind="customer"
                entityId={customer.id}
                initial={(customer as { deliveryPreferences?: DeliveryPreferences | null }).deliveryPreferences}
                invalidateKeys={[["/api/customers", customer.id], ["/api/customers"]]}
              />
              <p className="text-xs text-muted-foreground mt-3">
                Kundens generella leveransönskemål. Leveransregler per objekt sätts på
                respektive objekt.
              </p>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
