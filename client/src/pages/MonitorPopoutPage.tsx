import { useEffect, useMemo, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useQuery } from "@tanstack/react-query";
import { useMapConfig } from "@/hooks/use-map-config";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { apiRequest } from "@/lib/queryClient";
import type { Resource, WorkOrderWithObject } from "@shared/schema";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Wifi,
  WifiOff,
  Users,
  RefreshCw,
  Route,
  MapPin,
  Eye,
  EyeOff,
  X,
} from "lucide-react";

interface ActiveResource {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  status: string | null;
  lastUpdate: string | null;
}

const statusColors: Record<string, string> = {
  on_job: "#22c55e",
  traveling: "#3b82f6",
  idle: "#6b7280",
  break: "#f59e0b",
};

const statusLabels: Record<string, string> = {
  traveling: "Kör",
  on_job: "På jobb",
  idle: "Inaktiv",
  break: "Rast",
};

const ROUTE_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

const createResourceIcon = (status: string, isStale: boolean, name: string) => {
  let color = statusColors[status] || "#6b7280";
  if (isStale) color = "#9ca3af";
  const initials = name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      background-color: ${color};
      color: white;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 13px;
      border: 3px solid white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      ${isStale ? "opacity: 0.5;" : ""}
    ">${initials}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
};

const createJobIcon = (number: number, color: string) => {
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
      font-size: 11px;
      border: 2px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    ">${number}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

function MapFitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 0) {
      const bounds = L.latLngBounds(positions.map(p => L.latLng(p[0], p[1])));
      map.fitBounds(bounds, { padding: [60, 60] });
    }
  }, [map, positions.length]);
  return null;
}

interface RouteGeometry {
  resourceId: string;
  positions: [number, number][];
}

export default function MonitorPopoutPage() {
  const mapConfig = useMapConfig();
  const [wsConnected, setWsConnected] = useState(false);
  const [livePositions, setLivePositions] = useState<Map<string, ActiveResource>>(new Map());
  const [panelOpen, setPanelOpen] = useState(true);
  const [showDrivers, setShowDrivers] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showJobs, setShowJobs] = useState(true);
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set(["on_job", "traveling", "idle", "break"]));
  const [routeGeometries, setRouteGeometries] = useState<RouteGeometry[]>([]);

  const { data: resources, refetch: refetchResources } = useQuery<ActiveResource[]>({
    queryKey: ["/api/resources/active-positions"],
    refetchInterval: 15000,
  });

  const { data: allResources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: workOrders = [] } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders"],
  });

  useEffect(() => {
    if (resources) {
      setLivePositions(prev => {
        const newPositions = new Map<string, ActiveResource>();
        resources.forEach(r => {
          if (r.latitude !== null && r.longitude !== null) {
            const existing = prev.get(r.id);
            if (existing && existing.lastUpdate && r.lastUpdate) {
              if (new Date(existing.lastUpdate).getTime() > new Date(r.lastUpdate).getTime()) {
                newPositions.set(r.id, existing);
                return;
              }
            }
            newPositions.set(r.id, r);
          }
        });
        return newPositions;
      });
    }
  }, [resources]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    const connect = () => {
      try {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        ws = new WebSocket(`${protocol}//${window.location.host}/ws/notifications`);
        ws.onopen = () => setWsConnected(true);
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "position_update") {
              setLivePositions(prev => {
                const updated = new Map(prev);
                const existing = updated.get(data.resourceId);
                updated.set(data.resourceId, {
                  id: data.resourceId,
                  name: existing?.name || data.resourceName || data.resourceId,
                  latitude: data.latitude,
                  longitude: data.longitude,
                  status: data.status,
                  lastUpdate: data.timestamp,
                });
                return updated;
              });
            }
          } catch {}
        };
        ws.onclose = () => { setWsConnected(false); setTimeout(connect, 5000); };
        ws.onerror = () => setWsConnected(false);
      } catch {}
    };
    connect();
    return () => { if (ws) ws.close(); };
  }, []);

  const todaysOrders = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return workOrders.filter(wo => {
      if (!wo.scheduledDate || !wo.resourceId) return false;
      const d = new Date(wo.scheduledDate);
      return d >= today && d < tomorrow;
    });
  }, [workOrders]);

  const ordersByResource = useMemo(() => {
    const map: Record<string, WorkOrderWithObject[]> = {};
    todaysOrders.forEach(wo => {
      if (!wo.resourceId) return;
      if (!map[wo.resourceId]) map[wo.resourceId] = [];
      map[wo.resourceId].push(wo);
    });
    Object.values(map).forEach(orders => {
      orders.sort((a, b) => {
        const timeA = a.scheduledStartTime || "00:00";
        const timeB = b.scheduledStartTime || "00:00";
        return timeA.localeCompare(timeB);
      });
    });
    return map;
  }, [todaysOrders]);

  const fetchRouteGeometries = useCallback(async () => {
    const geometries: RouteGeometry[] = [];
    const resourceIds = Object.keys(ordersByResource);

    for (const resourceId of resourceIds) {
      const orders = ordersByResource[resourceId];
      const positions = orders
        .filter(o => o.taskLatitude && o.taskLongitude)
        .map(o => ({ lat: o.taskLatitude!, lng: o.taskLongitude! }));
      if (positions.length < 2) continue;

      try {
        const response = await fetch("/api/route-geometry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ waypoints: positions }),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.coordinates && data.coordinates.length > 0) {
            geometries.push({ resourceId, positions: data.coordinates });
          }
        }
      } catch {}
    }
    setRouteGeometries(geometries);
  }, [ordersByResource]);

  useEffect(() => {
    if (Object.keys(ordersByResource).length > 0 && showRoutes) {
      fetchRouteGeometries();
    }
  }, [ordersByResource, showRoutes]);

  const activeResources = useMemo(() => Array.from(livePositions.values()), [livePositions]);

  const filteredResources = useMemo(() => {
    return activeResources.filter(r => selectedStatuses.has(r.status || "idle"));
  }, [activeResources, selectedStatuses]);

  const allMapPositions = useMemo(() => {
    const positions: [number, number][] = [];
    filteredResources.forEach(r => {
      if (r.latitude && r.longitude) positions.push([r.latitude, r.longitude]);
    });
    todaysOrders.forEach(o => {
      if (o.taskLatitude && o.taskLongitude) positions.push([o.taskLatitude, o.taskLongitude]);
    });
    return positions;
  }, [filteredResources, todaysOrders]);

  const isStale = (lastUpdate: string | null) => {
    if (!lastUpdate) return true;
    return Date.now() - new Date(lastUpdate).getTime() > 10 * 60 * 1000;
  };

  const toggleStatus = (status: string) => {
    setSelectedStatuses(prev => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const resourceColorMap = useMemo(() => {
    const map = new Map<string, string>();
    allResources.forEach((r, idx) => {
      map.set(r.id, ROUTE_COLORS[idx % ROUTE_COLORS.length]);
    });
    return map;
  }, [allResources]);

  const defaultCenter: [number, number] = allMapPositions.length > 0
    ? allMapPositions[0]
    : [59.196, 17.626];

  useEffect(() => {
    document.title = "Traivo - Kartövervakning";
  }, []);

  return (
    <div className="fixed inset-0 bg-background" data-testid="page-monitor-popout">
      <MapContainer
        center={defaultCenter}
        zoom={11}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={true}
        zoomControl={true}
      >
        <TileLayer
          attribution={mapConfig.attribution}
          url={mapConfig.tileUrl}
        />

        {allMapPositions.length > 0 && <MapFitBounds positions={allMapPositions} />}

        {showDrivers && filteredResources.map(resource => {
          if (!resource.latitude || !resource.longitude) return null;
          const stale = isStale(resource.lastUpdate);
          return (
            <Marker
              key={`driver-${resource.id}`}
              position={[resource.latitude, resource.longitude]}
              icon={createResourceIcon(resource.status || "idle", stale, resource.name)}
            >
              <Popup>
                <div className="text-sm min-w-[180px]">
                  <p className="font-semibold text-base">{resource.name}</p>
                  <p className={stale ? "text-red-600" : "text-muted-foreground"}>
                    {statusLabels[resource.status || ""] || "Okänd"}
                    {stale && " (Inaktuell)"}
                  </p>
                  {resource.lastUpdate && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Senast: {format(new Date(resource.lastUpdate), "HH:mm:ss", { locale: sv })}
                    </p>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}

        {showRoutes && routeGeometries.map((rg, idx) => (
          <Polyline
            key={`route-${rg.resourceId}`}
            positions={rg.positions}
            pathOptions={{
              color: resourceColorMap.get(rg.resourceId) || ROUTE_COLORS[idx % ROUTE_COLORS.length],
              weight: 4,
              opacity: 0.7,
            }}
          />
        ))}

        {showJobs && Object.entries(ordersByResource).map(([resourceId, orders]) => {
          const color = resourceColorMap.get(resourceId) || "#3b82f6";
          return orders.map((order, idx) => {
            if (!order.taskLatitude || !order.taskLongitude) return null;
            return (
              <Marker
                key={`job-${order.id}`}
                position={[order.taskLatitude, order.taskLongitude]}
                icon={createJobIcon(idx + 1, color)}
              >
                <Popup>
                  <div className="text-xs min-w-[200px]">
                    <p className="font-semibold text-sm">{order.title}</p>
                    <p className="text-muted-foreground">{order.description?.slice(0, 60)}</p>
                    <div className="mt-1 space-y-0.5">
                      <p className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        Stopp {idx + 1}
                      </p>
                      {order.scheduledStartTime && (
                        <p>Planerad: {order.scheduledStartTime}</p>
                      )}
                      <p>Status: {order.orderStatus}</p>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          });
        })}
      </MapContainer>

      <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2">
        <div className="bg-background/90 backdrop-blur-sm rounded-lg shadow-lg px-3 py-2 flex items-center gap-3">
          <img src="/traivo-icon.png" alt="" className="h-5 w-5" onError={e => (e.currentTarget.style.display = "none")} />
          <span className="font-semibold text-sm">Kartövervakning</span>
          <div className="w-px h-4 bg-border" />
          <div className={`flex items-center gap-1 text-xs ${wsConnected ? "text-green-600" : "text-red-500"}`}>
            {wsConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {wsConnected ? "Live" : "Offline"}
          </div>
          <div className="w-px h-4 bg-border" />
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Users className="h-3 w-3" />
            {filteredResources.length} resurser
          </span>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Route className="h-3 w-3" />
            {todaysOrders.length} jobb
          </span>
        </div>
        <button
          onClick={() => refetchResources()}
          className="bg-background/90 backdrop-blur-sm rounded-lg shadow-lg p-2 hover:bg-accent transition-colors"
          data-testid="button-refresh-monitor"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="absolute top-3 right-3 z-[1000] flex items-center gap-2">
        <a
          href="/"
          className="bg-background/90 backdrop-blur-sm rounded-lg shadow-lg px-3 py-2 text-xs hover:bg-accent transition-colors flex items-center gap-1"
          data-testid="link-back-to-app"
        >
          <ExternalLink className="h-3 w-3" />
          Tillbaka till Traivo
        </a>
        <button
          onClick={() => window.close()}
          className="bg-background/90 backdrop-blur-sm rounded-lg shadow-lg p-2 hover:bg-accent transition-colors"
          data-testid="button-close-popout"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className={`absolute bottom-3 left-3 z-[1000] bg-background/90 backdrop-blur-sm rounded-lg shadow-lg transition-all ${panelOpen ? "w-72" : "w-auto"}`}>
        <button
          onClick={() => setPanelOpen(!panelOpen)}
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-accent/50 rounded-lg transition-colors"
          data-testid="button-toggle-panel"
        >
          <span>Kontroller</span>
          {panelOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>

        {panelOpen && (
          <div className="px-3 pb-3 space-y-3">
            <div className="space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lager</span>
              <div className="flex flex-col gap-1">
                {[
                  { key: "drivers", label: "Förare", icon: Users, active: showDrivers, toggle: () => setShowDrivers(!showDrivers) },
                  { key: "routes", label: "Rutter", icon: Route, active: showRoutes, toggle: () => setShowRoutes(!showRoutes) },
                  { key: "jobs", label: "Jobb", icon: MapPin, active: showJobs, toggle: () => setShowJobs(!showJobs) },
                ].map(item => (
                  <button
                    key={item.key}
                    onClick={item.toggle}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                      item.active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"
                    }`}
                    data-testid={`button-toggle-${item.key}`}
                  >
                    {item.active ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    <item.icon className="h-3 w-3" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Statusfilter</span>
              <div className="flex flex-wrap gap-1">
                {Object.entries(statusLabels).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => toggleStatus(key)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] transition-all border ${
                      selectedStatuses.has(key)
                        ? "border-current opacity-100"
                        : "border-transparent opacity-40"
                    }`}
                    style={{ color: statusColors[key] }}
                    data-testid={`button-filter-${key}`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: statusColors[key] }}
                    />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {showRoutes && allResources.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Resurser</span>
                <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
                  {allResources.map((r, idx) => {
                    const orders = ordersByResource[r.id];
                    if (!orders || orders.length === 0) return null;
                    return (
                      <div key={r.id} className="flex items-center gap-2 text-xs px-1 py-0.5">
                        <span
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{ backgroundColor: ROUTE_COLORS[idx % ROUTE_COLORS.length] }}
                        />
                        <span className="truncate flex-1">{r.name}</span>
                        <span className="text-muted-foreground">{orders.length} jobb</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
