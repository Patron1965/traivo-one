import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ArrowLeft,
  Package,
  FileText,
  CheckCircle2,
  Receipt,
  Clock,
  MapPin,
  Users,
  RefreshCw,
  Loader2,
  Building2,
  DollarSign,
  Target,
  ChevronRight,
  ChevronDown,
  Layers,
  Map as MapIcon,
  TreePine,
  Home,
  Trash2,
  Container,
} from "lucide-react";
import { QueryErrorState } from "@/components/ErrorBoundary";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Cluster, ServiceObject, WorkOrder, Subscription } from "@shared/schema";

interface ClusterWithStats extends Cluster {
  objectCount: number;
  activeOrders: number;
  monthlyValue: number;
  avgSetupTime: number;
}

const SLA_LEVELS: Record<string, { label: string; color: string }> = {
  standard: { label: "Standard", color: "bg-muted text-muted-foreground" },
  premium: { label: "Premium", color: "bg-blue-500/20 text-blue-700 dark:text-blue-300" },
  enterprise: { label: "Enterprise", color: "bg-purple-500/20 text-purple-700 dark:text-purple-300" },
};

const ORDER_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  skapad: { label: "Skapad", color: "bg-gray-500/20 text-gray-700 dark:text-gray-300" },
  planerad_pre: { label: "Förplanerad", color: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300" },
  planerad_resurs: { label: "Resurs tilldelad", color: "bg-blue-500/20 text-blue-700 dark:text-blue-300" },
  planerad_las: { label: "Låst", color: "bg-purple-500/20 text-purple-700 dark:text-purple-300" },
  utford: { label: "Utförd", color: "bg-green-500/20 text-green-700 dark:text-green-300" },
  fakturerad: { label: "Fakturerad", color: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" },
};

const HIERARCHY_LEVELS: Record<string, { label: string; icon: typeof Building2; color: string }> = {
  koncern: { label: "Koncern", icon: Building2, color: "text-purple-600 dark:text-purple-400" },
  brf: { label: "BRF", icon: Users, color: "text-blue-600 dark:text-blue-400" },
  fastighet: { label: "Fastighet", icon: Home, color: "text-green-600 dark:text-green-400" },
  rum: { label: "Rum", icon: Container, color: "text-yellow-600 dark:text-yellow-400" },
  karl: { label: "Kärl", icon: Trash2, color: "text-orange-600 dark:text-orange-400" },
};

interface TreeNode {
  object: ServiceObject;
  children: TreeNode[];
}

function buildObjectTree(objects: ServiceObject[]): TreeNode[] {
  const objectMap = new Map<string, ServiceObject>();
  const childrenMap = new Map<string, ServiceObject[]>();
  
  objects.forEach(obj => {
    objectMap.set(obj.id, obj);
    if (obj.parentId) {
      const siblings = childrenMap.get(obj.parentId) || [];
      siblings.push(obj);
      childrenMap.set(obj.parentId, siblings);
    }
  });
  
  const rootObjects = objects.filter(obj => !obj.parentId);
  
  function buildNode(obj: ServiceObject): TreeNode {
    const children = childrenMap.get(obj.id) || [];
    return {
      object: obj,
      children: children.map(buildNode),
    };
  }
  
  return rootObjects.map(buildNode);
}

function ObjectTreeNode({ node, level = 0 }: { node: TreeNode; level?: number }) {
  const [isOpen, setIsOpen] = useState(level < 2);
  const hasChildren = node.children.length > 0;
  const hierarchyInfo = HIERARCHY_LEVELS[node.object.hierarchyLevel || "fastighet"] || HIERARCHY_LEVELS.fastighet;
  const Icon = hierarchyInfo.icon;
  
  return (
    <div className="select-none">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div 
          className="flex items-center gap-2 py-1.5 px-2 rounded-md hover-elevate cursor-pointer"
          style={{ paddingLeft: `${level * 20 + 8}px` }}
        >
          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="h-5 w-5 p-0">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </CollapsibleTrigger>
          ) : (
            <div className="w-5" />
          )}
          <Icon className={`h-4 w-4 ${hierarchyInfo.color}`} />
          <span className="text-sm font-medium flex-1 truncate">{node.object.name}</span>
          <Badge variant="outline" className="text-[10px]">
            {hierarchyInfo.label}
          </Badge>
          {node.object.address && (
            <span className="text-xs text-muted-foreground truncate max-w-[150px]">
              {node.object.address}
            </span>
          )}
        </div>
        {hasChildren && (
          <CollapsibleContent>
            {node.children.map(child => (
              <ObjectTreeNode key={child.object.id} node={child} level={level + 1} />
            ))}
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  );
}

function createHierarchyIcon(level: string) {
  const colors: Record<string, string> = {
    koncern: "#9333ea",
    brf: "#3b82f6",
    fastighet: "#22c55e",
    rum: "#eab308",
    karl: "#f97316",
  };
  const color = colors[level] || "#6b7280";
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      background-color: ${color};
      color: white;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 10px;
      border: 2px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function MapFitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  if (positions.length > 0) {
    const bounds = L.latLngBounds(positions.map(p => L.latLng(p[0], p[1])));
    map.fitBounds(bounds, { padding: [50, 50] });
  }
  return null;
}

export default function ClusterDetailPage() {
  const [, navigate] = useLocation();
  const [match, params] = useRoute("/clusters/:id");
  const clusterId = params?.id;

  const { data: cluster, isLoading: clusterLoading, error: clusterError } = useQuery<ClusterWithStats>({
    queryKey: ["/api/clusters", clusterId],
    enabled: !!clusterId,
  });

  const { data: clusterObjects = [], isLoading: objectsLoading } = useQuery<ServiceObject[]>({
    queryKey: ["/api/clusters", clusterId, "objects"],
    enabled: !!clusterId,
  });

  const { data: workOrders = [], isLoading: ordersLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/clusters", clusterId, "work-orders"],
    enabled: !!clusterId,
  });

  const { data: subscriptions = [], isLoading: subsLoading } = useQuery<Subscription[]>({
    queryKey: ["/api/clusters", clusterId, "subscriptions"],
    enabled: !!clusterId,
  });

  if (!match || !clusterId) {
    return (
      <div className="p-6">
        <QueryErrorState message="Kluster hittades inte" />
      </div>
    );
  }

  if (clusterError) {
    return (
      <div className="p-6">
        <QueryErrorState message="Kunde inte ladda kluster" />
      </div>
    );
  }

  if (clusterLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!cluster) {
    return (
      <div className="p-6">
        <QueryErrorState message="Kluster hittades inte" />
      </div>
    );
  }

  const sla = SLA_LEVELS[cluster.slaLevel || "standard"] || SLA_LEVELS.standard;

  const completedOrders = workOrders.filter((o) => o.orderStatus === "utford");
  const invoicedOrders = workOrders.filter((o) => o.orderStatus === "fakturerad");
  const activeOrders = workOrders.filter(
    (o) =>
      o.orderStatus &&
      !["utford", "fakturerad"].includes(o.orderStatus)
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/clusters")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold">{cluster.name}</h1>
            <Badge className={sla.color} variant="secondary">
              {sla.label}
            </Badge>
          </div>
          {cluster.description && (
            <p className="text-muted-foreground mt-1">{cluster.description}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-md bg-blue-500/10">
                <Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Objekt</p>
                <p className="text-2xl font-semibold">{cluster.objectCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-md bg-yellow-500/10">
                <FileText className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Aktiva ordrar</p>
                <p className="text-2xl font-semibold">{cluster.activeOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-md bg-green-500/10">
                <DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Månadsvärde</p>
                <p className="text-2xl font-semibold">
                  {cluster.monthlyValue.toLocaleString("sv-SE")} kr
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-md bg-purple-500/10">
                <Clock className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Snitt ställtid</p>
                <p className="text-2xl font-semibold">{cluster.avgSetupTime} min</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Snöret - Flödet genom klustret
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4 overflow-x-auto pb-2">
            <div className="flex flex-col items-center min-w-[120px]">
              <div className="p-4 rounded-full bg-blue-500/10 mb-2">
                <Building2 className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <p className="font-medium">{clusterObjects.length}</p>
              <p className="text-sm text-muted-foreground">Objekt</p>
            </div>

            <div className="h-px flex-1 bg-border min-w-[40px]" />

            <div className="flex flex-col items-center min-w-[120px]">
              <div className="p-4 rounded-full bg-orange-500/10 mb-2">
                <RefreshCw className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              </div>
              <p className="font-medium">{subscriptions.length}</p>
              <p className="text-sm text-muted-foreground">Abonnemang</p>
            </div>

            <div className="h-px flex-1 bg-border min-w-[40px]" />

            <div className="flex flex-col items-center min-w-[120px]">
              <div className="p-4 rounded-full bg-yellow-500/10 mb-2">
                <FileText className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
              </div>
              <p className="font-medium">{activeOrders.length}</p>
              <p className="text-sm text-muted-foreground">Aktiva ordrar</p>
            </div>

            <div className="h-px flex-1 bg-border min-w-[40px]" />

            <div className="flex flex-col items-center min-w-[120px]">
              <div className="p-4 rounded-full bg-green-500/10 mb-2">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <p className="font-medium">{completedOrders.length}</p>
              <p className="text-sm text-muted-foreground">Utförda</p>
            </div>

            <div className="h-px flex-1 bg-border min-w-[40px]" />

            <div className="flex flex-col items-center min-w-[120px]">
              <div className="p-4 rounded-full bg-emerald-500/10 mb-2">
                <Receipt className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="font-medium">{invoicedOrders.length}</p>
              <p className="text-sm text-muted-foreground">Fakturerade</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="hierarchy" className="space-y-4">
        <TabsList className="flex-wrap gap-1">
          <TabsTrigger value="hierarchy" data-testid="tab-hierarchy">
            <TreePine className="h-4 w-4 mr-1" />
            Hierarki
          </TabsTrigger>
          <TabsTrigger value="map" data-testid="tab-map">
            <MapIcon className="h-4 w-4 mr-1" />
            Karta
          </TabsTrigger>
          <TabsTrigger value="objects" data-testid="tab-objects">
            <Package className="h-4 w-4 mr-1" />
            Lista ({clusterObjects.length})
          </TabsTrigger>
          <TabsTrigger value="subscriptions" data-testid="tab-subscriptions">
            Abonnemang ({subscriptions.length})
          </TabsTrigger>
          <TabsTrigger value="orders" data-testid="tab-orders">
            Ordrar ({workOrders.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="hierarchy">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TreePine className="h-4 w-4" />
                Objekthierarki - Drill-down
              </CardTitle>
            </CardHeader>
            <CardContent>
              {objectsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : clusterObjects.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  Inga objekt i detta kluster
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 mb-4 pb-4 border-b">
                    {Object.entries(HIERARCHY_LEVELS).map(([key, info]) => {
                      const count = clusterObjects.filter(o => o.hierarchyLevel === key).length;
                      if (count === 0) return null;
                      const Icon = info.icon;
                      return (
                        <Badge key={key} variant="outline" className="gap-1">
                          <Icon className={`h-3 w-3 ${info.color}`} />
                          {info.label}: {count}
                        </Badge>
                      );
                    })}
                  </div>
                  <div className="max-h-[500px] overflow-y-auto">
                    {buildObjectTree(clusterObjects).map(node => (
                      <ObjectTreeNode key={node.object.id} node={node} />
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="map">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <MapIcon className="h-4 w-4" />
                Klusterkarta
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {objectsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="h-[500px] rounded-b-md overflow-hidden">
                  <MapContainer
                    center={[
                      cluster.centerLatitude || 59.3293,
                      cluster.centerLongitude || 18.0686
                    ]}
                    zoom={13}
                    style={{ height: "100%", width: "100%" }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {cluster.centerLatitude && cluster.centerLongitude && cluster.radiusKm && (
                      <Circle
                        center={[cluster.centerLatitude, cluster.centerLongitude]}
                        radius={cluster.radiusKm * 1000}
                        pathOptions={{
                          color: cluster.color || "#3B82F6",
                          fillColor: cluster.color || "#3B82F6",
                          fillOpacity: 0.1,
                        }}
                      />
                    )}
                    {clusterObjects
                      .filter(obj => obj.latitude && obj.longitude)
                      .map(obj => (
                        <Marker
                          key={obj.id}
                          position={[obj.latitude!, obj.longitude!]}
                          icon={createHierarchyIcon(obj.hierarchyLevel || "fastighet")}
                        >
                          <Popup>
                            <div className="text-sm">
                              <div className="font-medium">{obj.name}</div>
                              <div className="text-muted-foreground">{obj.address}</div>
                              <Badge variant="outline" className="mt-1">
                                {HIERARCHY_LEVELS[obj.hierarchyLevel || "fastighet"]?.label || "Fastighet"}
                              </Badge>
                            </div>
                          </Popup>
                        </Marker>
                      ))}
                    {(() => {
                      const positions = clusterObjects
                        .filter(obj => obj.latitude && obj.longitude)
                        .map(obj => [obj.latitude!, obj.longitude!] as [number, number]);
                      return positions.length > 0 ? <MapFitBounds positions={positions} /> : null;
                    })()}
                  </MapContainer>
                </div>
              )}
              <div className="flex flex-wrap gap-2 p-4 border-t">
                {Object.entries(HIERARCHY_LEVELS).map(([key, info]) => (
                  <div key={key} className="flex items-center gap-1 text-xs text-muted-foreground">
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{ 
                        backgroundColor: key === "koncern" ? "#9333ea" :
                                         key === "brf" ? "#3b82f6" :
                                         key === "fastighet" ? "#22c55e" :
                                         key === "rum" ? "#eab308" : "#f97316"
                      }}
                    />
                    {info.label}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="objects">
          <Card>
            <CardContent className="p-0">
              {objectsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : clusterObjects.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  Inga objekt i detta kluster
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Namn</TableHead>
                      <TableHead>Typ</TableHead>
                      <TableHead>Adress</TableHead>
                      <TableHead>Tillgång</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clusterObjects.slice(0, 20).map((obj) => (
                      <TableRow key={obj.id} data-testid={`row-object-${obj.id}`}>
                        <TableCell className="font-medium">{obj.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{obj.objectType}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {obj.address || "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{obj.accessType || "open"}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {clusterObjects.length > 20 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          ... och {clusterObjects.length - 20} till
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subscriptions">
          <Card>
            <CardContent className="p-0">
              {subsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : subscriptions.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  Inga abonnemang i detta kluster
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Namn</TableHead>
                      <TableHead>Periodicitet</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Månadsvärde</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subscriptions.map((sub) => (
                      <TableRow key={sub.id} data-testid={`row-subscription-${sub.id}`}>
                        <TableCell className="font-medium">{sub.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{sub.periodicity}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={sub.status === "active" ? "default" : "secondary"}
                          >
                            {sub.status === "active" ? "Aktiv" : sub.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {(sub.cachedMonthlyValue || 0).toLocaleString("sv-SE")} kr
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders">
          <Card>
            <CardContent className="p-0">
              {ordersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : workOrders.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  Inga ordrar i detta kluster
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Titel</TableHead>
                      <TableHead>Datum</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Värde</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workOrders.slice(0, 30).map((order) => {
                      const statusInfo =
                        ORDER_STATUS_LABELS[order.orderStatus || "skapad"] ||
                        ORDER_STATUS_LABELS.skapad;
                      return (
                        <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                          <TableCell className="font-medium">{order.title}</TableCell>
                          <TableCell>
                            {order.scheduledDate
                              ? format(new Date(order.scheduledDate), "d MMM yyyy", {
                                  locale: sv,
                                })
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <Badge className={statusInfo.color} variant="secondary">
                              {statusInfo.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {(order.cachedValue || 0).toLocaleString("sv-SE")} kr
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {workOrders.length > 30 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          ... och {workOrders.length - 30} till
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
