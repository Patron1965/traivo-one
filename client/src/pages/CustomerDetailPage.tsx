import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
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
  ExternalLink, Repeat, Receipt, GitBranch, Info,
} from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMapConfig } from "@/hooks/use-map-config";
import { BatchGeoMapFitter } from "@/components/ObjectsMapView";
import type { Customer, ServiceObject } from "@shared/schema";

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

const HIERARCHY_LEVELS: Record<string, { label: string; icon: typeof Building2; color: string }> = {
  koncern: { label: "Koncern", icon: Building2, color: "text-purple-600 dark:text-purple-400" },
  brf: { label: "BRF", icon: Users, color: "text-blue-600 dark:text-blue-400" },
  fastighet: { label: "Fastighet", icon: Home, color: "text-green-600 dark:text-green-400" },
  rum: { label: "Rum", icon: Container, color: "text-yellow-600 dark:text-yellow-400" },
  karl: { label: "Objekt", icon: Trash2, color: "text-orange-600 dark:text-orange-400" },
};

const MAP_MARKER_LIMIT = 500;

interface TreeNode { object: ServiceObject; children: TreeNode[] }

interface ClusterGroup {
  id: string | null;
  name: string;
  color: string | null;
  roots: TreeNode[];
}

function buildSubtree(list: ServiceObject[]): TreeNode[] {
  const childrenMap = new Map<string, ServiceObject[]>();
  const subsetIds = new Set(list.map((o) => o.id));
  for (const o of list) {
    if (o.parentId && subsetIds.has(o.parentId)) {
      const arr = childrenMap.get(o.parentId) || [];
      arr.push(o);
      childrenMap.set(o.parentId, arr);
    }
  }
  const roots = list.filter((o) => !o.parentId || !subsetIds.has(o.parentId));
  function build(o: ServiceObject): TreeNode {
    const ch = (childrenMap.get(o.id) || []).map(build);
    ch.sort((a, b) => a.object.name.localeCompare(b.object.name, "sv"));
    return { object: o, children: ch };
  }
  const tree = roots.map(build);
  tree.sort((a, b) => a.object.name.localeCompare(b.object.name, "sv"));
  return tree;
}

function groupByCluster(
  objects: ServiceObject[],
  clusters: CustomerStatsCluster[],
): ClusterGroup[] {
  const byCluster = new Map<string, ServiceObject[]>();
  const orphans: ServiceObject[] = [];
  for (const o of objects) {
    if (o.clusterId) {
      const arr = byCluster.get(o.clusterId) || [];
      arr.push(o);
      byCluster.set(o.clusterId, arr);
    } else {
      orphans.push(o);
    }
  }
  const groups: ClusterGroup[] = clusters
    .filter((c) => byCluster.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, color: c.color, roots: buildSubtree(byCluster.get(c.id)!) }));
  for (const [cid, list] of byCluster) {
    if (!groups.find((g) => g.id === cid)) {
      groups.push({ id: cid, name: "Kluster", color: null, roots: buildSubtree(list) });
    }
  }
  if (orphans.length > 0) {
    groups.push({ id: null, name: "Övriga objekt (utan kluster)", color: null, roots: buildSubtree(orphans) });
  }
  return groups;
}

interface InheritedSignals {
  inherited: boolean;
  fields: string[];
}

function getInheritedSignals(o: ServiceObject): InheritedSignals {
  const obj = o as unknown as Record<string, unknown>;
  const fields: string[] = [];
  if (obj.accessInfoInherited) fields.push("Åtkomstinfo");
  if (obj.pricingRulesInherited) fields.push("Prisregler");
  if (obj.serviceConfigInherited) fields.push("Servicekonfiguration");
  return { inherited: fields.length > 0, fields };
}

function TreeRow({
  node,
  level,
  selectedId,
  onSelect,
}: {
  node: TreeNode;
  level: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(level < 1);
  const hasChildren = node.children.length > 0;
  const info = HIERARCHY_LEVELS[node.object.hierarchyLevel || "fastighet"] || HIERARCHY_LEVELS.fastighet;
  const Icon = info.icon;
  const inh = getInheritedSignals(node.object);
  const isSelected = selectedId === node.object.id;
  return (
    <div className="select-none">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div
          className={`flex items-center gap-2 py-1.5 px-2 rounded-md hover-elevate cursor-pointer ${isSelected ? "bg-primary/10 ring-1 ring-primary/40" : ""}`}
          style={{ paddingLeft: `${level * 18 + 8}px` }}
          onClick={() => onSelect(isSelected ? null : node.object.id)}
          data-testid={`tree-row-${node.object.id}`}
        >
          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 p-0"
                onClick={(e) => e.stopPropagation()}
              >
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
          ) : (
            <div className="w-5" />
          )}
          <Icon className={`h-4 w-4 ${info.color}`} />
          <Link
            href={`/objects/${node.object.id}`}
            className="text-sm font-medium flex-1 truncate hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {node.object.name}
          </Link>
          {inh.inherited && (
            <Tooltip>
              <TooltipTrigger asChild>
                <GitBranch className="h-3 w-3 text-blue-500" data-testid={`inherited-${node.object.id}`} />
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs font-medium">Ärvda värden:</p>
                <ul className="text-xs text-muted-foreground">
                  {inh.fields.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </TooltipContent>
            </Tooltip>
          )}
          <Badge variant="outline" className="text-[10px]">{info.label}</Badge>
          {node.object.address && (
            <span className="text-xs text-muted-foreground truncate max-w-[180px] hidden sm:inline">
              {node.object.address}
            </span>
          )}
          {hasChildren && (
            <Badge variant="secondary" className="text-[10px]">{node.children.length}</Badge>
          )}
        </div>
        {hasChildren && (
          <CollapsibleContent>
            {node.children.map((c) => (
              <TreeRow key={c.object.id} node={c} level={level + 1} selectedId={selectedId} onSelect={onSelect} />
            ))}
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  );
}

function makeIcon(level: string, isSelected: boolean) {
  const colors: Record<string, string> = {
    koncern: "#9333ea", brf: "#3b82f6", fastighet: "#22c55e", rum: "#eab308", karl: "#f97316",
  };
  const color = colors[level] || "#6b7280";
  const size = isSelected ? 26 : 18;
  const ring = isSelected ? "border:3px solid #f59e0b;" : "border:2px solid white;";
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="background-color:${color};width:${size}px;height:${size}px;border-radius:50%;${ring}box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function FlyToObject({ object }: { object: ServiceObject | null }) {
  const map = useMap();
  if (object && object.latitude && object.longitude) {
    map.flyTo([object.latitude, object.longitude], Math.max(map.getZoom(), 14), { duration: 0.6 });
  }
  return null;
}

function formatSek(value: number): string {
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(value);
}

export default function CustomerDetailPage() {
  const [, params] = useRoute("/customers/:id");
  const customerId = params?.id;
  const mapConfig = useMapConfig();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const customerQuery = useQuery<Customer>({
    queryKey: ["/api/customers", customerId],
    enabled: !!customerId,
  });
  const objectsQuery = useQuery<ServiceObject[]>({
    queryKey: ["/api/customers", customerId, "objects"],
    queryFn: async () => {
      const r = await fetch(`/api/customers/${customerId}/objects`, { credentials: "include" });
      if (!r.ok) throw new Error("Kunde inte hämta objekt");
      return r.json();
    },
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

  const clusterGroups = useMemo(
    () => groupByCluster(objectsQuery.data || [], statsQuery.data?.clusters || []),
    [objectsQuery.data, statsQuery.data?.clusters],
  );
  const mapObjects = useMemo(
    () => (objectsQuery.data || []).filter((o) => o.latitude && o.longitude),
    [objectsQuery.data],
  );
  const visibleMarkers = useMemo(
    () => mapObjects.slice(0, MAP_MARKER_LIMIT),
    [mapObjects],
  );
  const selectedObject = useMemo(
    () => (objectsQuery.data || []).find((o) => o.id === selectedId) || null,
    [objectsQuery.data, selectedId],
  );
  const clustersWithGeo = useMemo(
    () => (statsQuery.data?.clusters || []).filter((c) => c.centerLatitude && c.centerLongitude),
    [statsQuery.data?.clusters],
  );

  if (!customerId) return null;
  if (customerQuery.isError) {
    return <QueryErrorState onRetry={() => customerQuery.refetch()} />;
  }

  const customer = customerQuery.data;
  const stats = statsQuery.data;
  const isLoading = customerQuery.isLoading || statsQuery.isLoading;

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
            description={customer.customerNumber ? `Kundnummer: ${customer.customerNumber}` : undefined}
            icon={Building2}
          />

          <div className="flex flex-wrap gap-2">
            <Link href={`/objects?customerId=${customer.id}`}>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid="link-customer-objects">
                <Package className="h-3.5 w-3.5" /> Visa objekt
              </Button>
            </Link>
            <Link href={`/planner?customerId=${customer.id}`}>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid="link-customer-orders">
                <ClipboardList className="h-3.5 w-3.5" /> Orderhistorik
              </Button>
            </Link>
            {customer.fortnoxCustomerId && (
              <Link href={`/fortnox?customerId=${customer.fortnoxCustomerId}`}>
                <Button variant="outline" size="sm" className="gap-1.5" data-testid="link-fortnox">
                  <ExternalLink className="h-3.5 w-3.5" /> Fortnox-kund {customer.fortnoxCustomerId}
                </Button>
              </Link>
            )}
          </div>

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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">Kontakt</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
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
                {!customer.contactPerson && !customer.email && !customer.phone && !customer.address && (
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
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!stats || stats.clusters.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center" data-testid="text-empty-clusters">
                    Inga kluster där denna kund är rotkund ännu.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {stats.clusters.map((cl) => (
                      <Link key={cl.id} href={`/clusters/${cl.id}`}>
                        <div
                          className="flex items-center gap-2 p-3 rounded-md border hover-elevate cursor-pointer"
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
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="tree">
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
                <CardContent className="p-3 space-y-4">
                  {stats && Object.keys(stats.objectsByLevel || {}).length > 0 && (
                    <div className="flex flex-wrap gap-2 pb-2 border-b" data-testid="section-objects-by-level">
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
                    </div>
                  )}
                  {objectsQuery.isLoading ? (
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
                      {clusterGroups.map((g) => (
                        <div key={g.id ?? "no-cluster"} className="border rounded-md" data-testid={`group-cluster-${g.id ?? "none"}`}>
                          <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                            <Layers className="h-4 w-4 text-muted-foreground" />
                            {g.id ? (
                              <Link href={`/clusters/${g.id}`} className="text-sm font-semibold hover:underline flex items-center gap-1.5">
                                {g.color && (
                                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                                )}
                                {g.name}
                              </Link>
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
                                key={n.object.id}
                                node={n}
                                level={0}
                                selectedId={selectedId}
                                onSelect={setSelectedId}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="map">
              <Card>
                <CardContent className="p-0 overflow-hidden rounded-md">
                  {objectsQuery.isLoading ? (
                    <Skeleton className="h-[500px] w-full" />
                  ) : mapObjects.length === 0 && clustersWithGeo.length === 0 ? (
                    <div className="h-[500px] flex flex-col items-center justify-center text-muted-foreground text-sm gap-2" data-testid="text-empty-map">
                      <MapIcon className="h-8 w-8 opacity-40" />
                      Inga objekt med koordinater att visa.
                    </div>
                  ) : (
                    <div className="h-[500px] relative">
                      {mapObjects.length > MAP_MARKER_LIMIT && (
                        <div className="absolute top-2 right-2 z-[1000] bg-background/95 border rounded-md px-2 py-1 text-xs flex items-center gap-1.5 shadow" data-testid="text-marker-limit">
                          <Info className="h-3 w-3" />
                          Visar {MAP_MARKER_LIMIT} av {mapObjects.length} objekt — använd filtrerad objektlista för full vy
                        </div>
                      )}
                      <MapContainer
                        center={
                          clustersWithGeo[0]
                            ? [clustersWithGeo[0].centerLatitude!, clustersWithGeo[0].centerLongitude!]
                            : [visibleMarkers[0]?.latitude ?? 59.3, visibleMarkers[0]?.longitude ?? 18.07]
                        }
                        zoom={11}
                        style={{ height: "100%", width: "100%" }}
                        scrollWheelZoom
                      >
                        <TileLayer url={mapConfig.tileUrl} attribution={mapConfig.attribution} />
                        {visibleMarkers.length > 0 && <BatchGeoMapFitter objects={visibleMarkers} />}
                        <FlyToObject object={selectedObject} />
                        {clustersWithGeo.map((cl) => (
                          <Circle
                            key={`circle-${cl.id}`}
                            center={[cl.centerLatitude!, cl.centerLongitude!]}
                            radius={(cl.radiusKm || 5) * 1000}
                            pathOptions={{
                              color: cl.color || "#3b82f6",
                              fillColor: cl.color || "#3b82f6",
                              fillOpacity: 0.08,
                              weight: 2,
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
                        ))}
                        {visibleMarkers.map((o) => (
                          <Marker
                            key={o.id}
                            position={[o.latitude!, o.longitude!]}
                            icon={makeIcon(o.hierarchyLevel || "fastighet", o.id === selectedId)}
                            eventHandlers={{
                              click: () => setSelectedId(o.id === selectedId ? null : o.id),
                            }}
                          >
                            <Popup>
                              <div className="space-y-1">
                                <div className="font-medium">{o.name}</div>
                                {o.address && <div className="text-xs">{o.address}</div>}
                                <Link href={`/objects/${o.id}`} className="text-xs text-primary hover:underline">
                                  Öppna objekt →
                                </Link>
                              </div>
                            </Popup>
                          </Marker>
                        ))}
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
