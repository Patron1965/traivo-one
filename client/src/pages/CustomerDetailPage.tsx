import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueryErrorState } from "@/components/ErrorBoundary";
import {
  ArrowLeft, Building2, Layers, Package, ClipboardList, Phone, Mail, MapPin,
  ChevronDown, ChevronRight, Users, Home, Container, Trash2, TreePine, Map as MapIcon,
  Repeat, Receipt, GitBranch, Hash, FileText, AlertTriangle, Loader2, Search, X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { MapContainer, TileLayer, Circle, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster";
import { useMapConfig } from "@/hooks/use-map-config";
import type { Customer } from "@shared/schema";

interface CustomerStatsCluster {
  id: string;
  name: string;
  color: string | null;
  status: string;
  objectCount: number;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusKm: number | null;
}

interface CustomerStats {
  objectsByLevel: Record<string, number>;
  totalObjects: number;
  activeOrders: number;
  completedOrders: number;
  invoicedOrders: number;
  totalOrders: number;
  activeSubscriptions: number;
  invoicedLast12Months: number;
  clusters: CustomerStatsCluster[];
}

interface TreeNode {
  id: string;
  name: string;
  parentId: string | null;
  clusterId: string | null;
  hierarchyLevel: string | null;
  address: string | null;
  accessInfoInherited: boolean | null;
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
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/60 text-inherit rounded-sm px-0.5">{part}</mark>
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
  clusterId: string | null;
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
  clusterId: string | null;
}

const HIERARCHY_LEVELS: Record<string, { label: string; icon: typeof Building2; color: string; hex: string }> = {
  koncern: { label: "Koncern", icon: Building2, color: "text-purple-600 dark:text-purple-400", hex: "#9333ea" },
  brf: { label: "BRF", icon: Users, color: "text-blue-600 dark:text-blue-400", hex: "#3b82f6" },
  fastighet: { label: "Fastighet", icon: Home, color: "text-green-600 dark:text-green-400", hex: "#22c55e" },
  rum: { label: "Rum", icon: Container, color: "text-yellow-600 dark:text-yellow-400", hex: "#eab308" },
  karl: { label: "Objekt", icon: Trash2, color: "text-orange-600 dark:text-orange-400", hex: "#f97316" },
};

interface ClusterGroup {
  id: string | null;
  name: string;
  color: string | null;
  roots: TreeNode[];
}

function groupRootsByCluster(
  roots: TreeNode[],
  clusters: CustomerStatsCluster[],
): ClusterGroup[] {
  const byCluster = new Map<string, TreeNode[]>();
  const orphans: TreeNode[] = [];
  for (const r of roots) {
    if (r.clusterId) {
      const arr = byCluster.get(r.clusterId) || [];
      arr.push(r);
      byCluster.set(r.clusterId, arr);
    } else {
      orphans.push(r);
    }
  }
  const groups: ClusterGroup[] = clusters
    .filter((c) => byCluster.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, color: c.color, roots: byCluster.get(c.id)! }));
  Array.from(byCluster.entries()).forEach(([cid, list]) => {
    if (!groups.find((g) => g.id === cid)) {
      groups.push({ id: cid, name: "Kluster", color: null, roots: list });
    }
  });
  if (orphans.length > 0) {
    groups.push({ id: null, name: "Övriga objekt (utan kluster)", color: null, roots: orphans });
  }
  return groups;
}

interface SyncState {
  selectedObjectId: string | null;
  selectedClusterId: string | null;
  hoveredObjectId: string | null;
  hoveredClusterId: string | null;
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
}: {
  node: TreeNode;
  level: number;
  customerId: string;
  sync: SyncState;
  expanded: Set<string>;
  onToggleExpand: (id: string, open: boolean) => void;
  onSelectObject: (id: string | null) => void;
  onHoverObject: (id: string | null) => void;
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
          {node.accessInfoInherited && (
            <Tooltip>
              <TooltipTrigger asChild>
                <GitBranch className="h-3 w-3 text-blue-500" data-testid={`inherited-${node.id}`} />
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs font-medium">Ärvda värden:</p>
                <ul className="text-xs text-muted-foreground"><li>Åtkomstinfo</li></ul>
              </TooltipContent>
            </Tooltip>
          )}
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
            {(childrenQuery.data || []).map((c) => (
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

function ViewportTracker({ onChange }: { onChange: (bbox: [number, number, number, number]) => void }) {
  const map = useMap();
  useEffect(() => {
    const b = map.getBounds();
    onChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps
  useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      onChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    },
  });
  return null;
}

interface MarkerClusterLayerProps {
  points: MapPoint[];
  sync: SyncState;
  onSelectObject: (id: string | null) => void;
  onHoverObject: (id: string | null) => void;
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

export default function CustomerDetailPage() {
  const [, params] = useRoute("/customers/:id");
  const customerId = params?.id;
  const mapConfig = useMapConfig();
  const [sync, setSync] = useState<SyncState>({
    selectedObjectId: null,
    selectedClusterId: null,
    hoveredObjectId: null,
    hoveredClusterId: null,
  });
  const [mapBbox, setMapBbox] = useState<[number, number, number, number] | null>(null);
  const [mapTabActive, setMapTabActive] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setExpanded(new Set());
    setSearchInput("");
    setSearchQuery("");
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
  const setSelectedCluster = (id: string | null) =>
    setSync((s) => ({ ...s, selectedClusterId: s.selectedClusterId === id ? null : id }));
  const setHoveredObject = (id: string | null) =>
    setSync((s) => ({ ...s, hoveredObjectId: id }));
  const setHoveredCluster = (id: string | null) =>
    setSync((s) => ({ ...s, hoveredClusterId: id }));

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

  const rootsQuery = useQuery<TreeNode[]>({
    queryKey: ["/api/customers", customerId, "objects", "tree-roots", sync.selectedClusterId ?? "all"],
    queryFn: async () => {
      const url = `/api/customers/${encodeURIComponent(customerId!)}/objects/tree-roots${
        sync.selectedClusterId ? `?clusterId=${encodeURIComponent(sync.selectedClusterId)}` : ""
      }`;
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
    if (sync.selectedClusterId) {
      setSync((s) => ({ ...s, selectedClusterId: null }));
    }
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

  const coordsQueryKey = useMemo(() => {
    const bboxKey = mapBbox ? mapBbox.map((n) => n.toFixed(3)).join(",") : "all";
    return [
      "/api/customers",
      customerId,
      "objects",
      "coordinates",
      sync.selectedClusterId ?? "all",
      bboxKey,
    ];
  }, [customerId, sync.selectedClusterId, mapBbox]);

  const coordsQuery = useQuery<MapPoint[]>({
    queryKey: coordsQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sync.selectedClusterId) params.set("clusterId", sync.selectedClusterId);
      if (mapBbox) params.set("bbox", mapBbox.join(","));
      params.set("limit", "3000");
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
        clusterId: o.clusterId ?? null,
      };
    },
    enabled: !!customerId && !!sync.selectedObjectId,
    staleTime: 60_000,
  });

  const roots = rootsQuery.data || [];
  const clusterGroups = useMemo(
    () => groupRootsByCluster(roots, statsQuery.data?.clusters || []),
    [roots, statsQuery.data?.clusters],
  );
  const mapPoints = coordsQuery.data || [];
  const clustersWithGeo = useMemo(
    () => (statsQuery.data?.clusters || []).filter((c) => c.centerLatitude && c.centerLongitude),
    [statsQuery.data?.clusters],
  );
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

  const initialCenter: [number, number] = clustersWithGeo[0]
    ? [clustersWithGeo[0].centerLatitude!, clustersWithGeo[0].centerLongitude!]
    : mapPoints[0]
    ? [mapPoints[0].latitude, mapPoints[0].longitude]
    : [59.3, 18.07];

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
                  <Layers className="h-3.5 w-3.5" /> Kluster
                </div>
                <div className="text-2xl font-semibold mt-1" data-testid="stat-clusters">
                  {stats?.clusters.length ?? 0}
                </div>
              </CardContent>
            </Card>
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

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="h-4 w-4" /> Kluster
                  {sync.selectedClusterId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 text-xs"
                      onClick={() => setSelectedCluster(sync.selectedClusterId)}
                      data-testid="button-clear-cluster-filter"
                    >
                      Rensa filter
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!stats || stats.clusters.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center" data-testid="text-empty-clusters">
                    Inga kluster där denna kund är rotkund ännu.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {stats.clusters.map((cl) => {
                      const isSelected = sync.selectedClusterId === cl.id;
                      const isHovered = sync.hoveredClusterId === cl.id;
                      return (
                        <div
                          key={cl.id}
                          onClick={() => setSelectedCluster(cl.id)}
                          onMouseEnter={() => setHoveredCluster(cl.id)}
                          onMouseLeave={() => setHoveredCluster(null)}
                          className={`flex items-center gap-2 p-3 rounded-md border hover-elevate cursor-pointer ${
                            isSelected ? "ring-2 ring-primary" : isHovered ? "bg-muted" : ""
                          }`}
                          data-testid={`card-cluster-${cl.id}`}
                        >
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: cl.color || "#3b82f6" }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{cl.name}</div>
                            <div className="text-xs text-muted-foreground">{cl.objectCount} objekt</div>
                          </div>
                          {cl.status !== "active" && (
                            <Badge variant="outline" className="text-[10px]">{cl.status}</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="tree" onValueChange={(v) => setMapTabActive(v === "map")}>
            <TabsList>
              <TabsTrigger value="tree" data-testid="tab-tree">
                <TreePine className="h-4 w-4 mr-2" /> Hierarki
              </TabsTrigger>
              <TabsTrigger value="map" data-testid="tab-map">
                <MapIcon className="h-4 w-4 mr-2" /> Karta
              </TabsTrigger>
            </TabsList>

            <TabsContent value="tree">
              <Card>
                <CardContent className="p-3 space-y-3">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Sök i hierarkin (namn, adress, objektnummer)..."
                      className="pl-8 pr-8"
                      data-testid="input-tree-search"
                    />
                    {searchInput && (
                      <button
                        onClick={() => { setSearchInput(""); setSearchQuery(""); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover-elevate"
                        aria-label="Rensa sökning"
                        data-testid="button-clear-search"
                      >
                        <X className="h-4 w-4 text-muted-foreground" />
                      </button>
                    )}
                  </div>

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
                  ) : clusterGroups.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-8 text-center" data-testid="text-empty-tree">
                      Inga objekt registrerade på denna kund ännu.
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[600px] overflow-y-auto">
                      {clusterGroups.map((g) => {
                        const isSelected = sync.selectedClusterId === g.id;
                        const isHovered = sync.hoveredClusterId === g.id;
                        return (
                          <div
                            key={g.id ?? "no-cluster"}
                            className={`border rounded-md ${isSelected ? "ring-2 ring-primary" : isHovered ? "ring-1 ring-muted-foreground/40" : ""}`}
                            data-testid={`group-cluster-${g.id ?? "none"}`}
                            onMouseEnter={() => g.id && setHoveredCluster(g.id)}
                            onMouseLeave={() => g.id && setHoveredCluster(null)}
                          >
                            <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                              <Layers className="h-4 w-4 text-muted-foreground" />
                              {g.id ? (
                                <button
                                  onClick={() => setSelectedCluster(g.id!)}
                                  className="text-sm font-semibold hover:underline flex items-center gap-1.5"
                                  data-testid={`button-select-cluster-${g.id}`}
                                >
                                  {g.color && (
                                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                                  )}
                                  {g.name}
                                </button>
                              ) : (
                                <span className="text-sm font-semibold">{g.name}</span>
                              )}
                              <Badge variant="secondary" className="text-[10px] ml-auto">
                                {g.roots.length} rot{g.roots.length === 1 ? "" : "ter"}
                              </Badge>
                            </div>
                            <div className="p-2 space-y-0.5">
                              {g.roots.map((n) => (
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
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="map">
              <Card>
                <CardContent className="p-0 overflow-hidden rounded-md">
                  {coordsQuery.isLoading && mapPoints.length === 0 ? (
                    <Skeleton className="h-[500px] w-full" />
                  ) : mapPoints.length === 0 && clustersWithGeo.length === 0 ? (
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
                        {mapPoints.length} objekt i vyn
                      </div>
                      <MapContainer
                        center={initialCenter}
                        zoom={11}
                        style={{ height: "100%", width: "100%" }}
                        scrollWheelZoom
                      >
                        <TileLayer url={mapConfig.tileUrl} attribution={mapConfig.attribution} />
                        <MapBoundsFitter points={mapPoints} refitKey={sync.selectedClusterId ?? "all"} />
                        <ViewportTracker onChange={setMapBbox} />
                        <FlyToPoint point={flyTarget} />
                        {clustersWithGeo.map((cl) => {
                          const isSelected = sync.selectedClusterId === cl.id;
                          const isHovered = sync.hoveredClusterId === cl.id;
                          const baseColor = cl.color || "#3b82f6";
                          return (
                            <Circle
                              key={`circle-${cl.id}`}
                              center={[cl.centerLatitude!, cl.centerLongitude!]}
                              radius={(cl.radiusKm || 5) * 1000}
                              pathOptions={{
                                color: isSelected ? "#f59e0b" : baseColor,
                                fillColor: baseColor,
                                fillOpacity: isSelected ? 0.18 : isHovered ? 0.14 : 0.08,
                                weight: isSelected ? 3 : isHovered ? 2.5 : 2,
                              }}
                              eventHandlers={{
                                click: () => setSelectedCluster(cl.id),
                                mouseover: () => setHoveredCluster(cl.id),
                                mouseout: () => setHoveredCluster(null),
                              }}
                            >
                              <Popup>
                                <div className="space-y-1">
                                  <div className="font-medium">{cl.name}</div>
                                  <div className="text-xs">{cl.objectCount} objekt · radie {cl.radiusKm ?? 5} km</div>
                                  <Link href={`/clusters/${cl.id}`} className="text-xs text-primary hover:underline">
                                    Öppna kluster →
                                  </Link>
                                </div>
                              </Popup>
                            </Circle>
                          );
                        })}
                        <MarkerClusterLayer
                          points={mapPoints}
                          sync={sync}
                          onSelectObject={setSelectedObject}
                          onHoverObject={setHoveredObject}
                        />
                      </MapContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
