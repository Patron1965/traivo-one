import { useState, useMemo, useEffect, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Clock, Car, ArrowRight, Route, GripVertical, Loader2, Key, Keyboard, Users, DoorOpen, BarChart3, MapPinned, Package, PackageSearch } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format, startOfDay, endOfDay, addDays, startOfWeek, endOfWeek } from "date-fns";
import { sv } from "date-fns/locale";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useObjectsByIds } from "@/hooks/useObjectSearch";
import { useMapConfig } from "@/hooks/use-map-config";
import type { Resource, WorkOrderWithObject, ServiceObject } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const createNumberedIcon = (number: number, color: string, stackCount?: number) => {
  const badge = stackCount && stackCount > 1
    ? `<div style="
        position: absolute;
        top: -6px;
        right: -8px;
        background-color: #ef4444;
        color: white;
        border-radius: 50%;
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        font-weight: bold;
        border: 1.5px solid white;
        box-shadow: 0 1px 2px rgba(0,0,0,0.3);
      ">${stackCount}</div>`
    : "";
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      position: relative;
      background-color: ${color};
      color: white;
      border-radius: 50%;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 12px;
      border: 2px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    ">${number}${badge}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
};

const createEntranceIcon = () => {
  return L.divIcon({
    className: "entrance-marker",
    html: `<div style="
      background-color: #22c55e;
      color: white;
      border-radius: 4px;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    "><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z"/></svg></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
};

const getSetupTimeColor = (minutes: number) => {
  if (minutes < 10) return "#22c55e";
  if (minutes < 20) return "#f97316";
  return "#ef4444";
};

const getAccessTypeColor = (accessType: string) => {
  switch (accessType) {
    case "open": return "#22c55e"; // green
    case "code": return "#3b82f6"; // blue
    case "key": return "#f97316"; // orange
    case "meeting": return "#a855f7"; // purple
    default: return "#6b7280"; // gray
  }
};

const accessTypeLabels: Record<string, { label: string; icon: typeof Key }> = {
  open: { label: "Öppen", icon: DoorOpen },
  code: { label: "Kod", icon: Keyboard },
  key: { label: "Nyckel", icon: Key },
  meeting: { label: "Möte", icon: Users },
};

interface MapFitBoundsProps {
  positions: [number, number][];
}

function MapFitBounds({ positions }: MapFitBoundsProps) {
  const map = useMap();
  
  useEffect(() => {
    if (positions.length > 0) {
      const bounds = L.latLngBounds(positions.map(p => L.latLng(p[0], p[1])));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [map, positions.length]);
  
  return null;
}

interface RouteMapProps {
  onNavigate?: (jobId: string) => void;
  initialDate?: string;
}

interface RouteData {
  distance: number; // km
  duration: number; // minutes
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString | null;
}

type ColorMode = "setupTime" | "accessType";

export function RouteMap({ onNavigate, initialDate }: RouteMapProps) {
  const mapConfig = useMapConfig();
  const [selectedResource, setSelectedResource] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    if (initialDate) {
      const parts = initialDate.split("-");
      return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
    return new Date();
  });
  useEffect(() => {
    if (initialDate) {
      const parts = initialDate.split("-");
      setSelectedDate(new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
    }
  }, [initialDate]);

  const [viewMode, setViewMode] = useState<"day" | "week">("day");
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>("accessType");
  const [showAccessCodes, setShowAccessCodes] = useState(false);
  const { toast } = useToast();

  const { data: resources = [], isLoading: resourcesLoading } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const activeResource = selectedResource || (resources.length > 0 ? resources[0].id : "");

  const getDateRange = () => {
    if (viewMode === "week") {
      return {
        start: startOfWeek(selectedDate, { weekStartsOn: 1 }),
        end: endOfWeek(selectedDate, { weekStartsOn: 1 }),
      };
    }
    return {
      start: startOfDay(selectedDate),
      end: endOfDay(selectedDate),
    };
  };

  const { start: periodStart, end: periodEnd } = getDateRange();

  const queryStartDate = format(periodStart, "yyyy-MM-dd");
  const queryEndDate = format(periodEnd, "yyyy-MM-dd");

  const { data: workOrders = [], isLoading: workOrdersLoading } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders", queryStartDate, queryEndDate],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders?startDate=${queryStartDate}&endDate=${queryEndDate}&includeUnscheduled=false`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch work orders");
      return res.json();
    },
  });

  // Hämta endast objekt som visas i aktuell period
  const displayJobObjectIds = useMemo(() => {
    return workOrders
      .filter(wo => {
        if (!wo.scheduledDate || wo.resourceId !== activeResource) return false;
        const scheduled = new Date(wo.scheduledDate);
        return scheduled >= periodStart && scheduled <= periodEnd;
      })
      .map(wo => wo.objectId)
      .filter(Boolean);
  }, [workOrders, activeResource, periodStart, periodEnd]);

  const { data: objects = [] } = useObjectsByIds(displayJobObjectIds);
  
  const objectMap = useMemo(() => new Map(objects.map(o => [o.id, o])), [objects]);

  const displayJobs = workOrders.filter(wo => {
    if (!wo.scheduledDate || wo.resourceId !== activeResource) return false;
    const scheduled = new Date(wo.scheduledDate);
    return scheduled >= periodStart && scheduled <= periodEnd;
  }).sort((a, b) => {
    const dateA = new Date(a.scheduledDate || 0);
    const dateB = new Date(b.scheduledDate || 0);
    if (dateA.getTime() !== dateB.getTime()) {
      return dateA.getTime() - dateB.getTime();
    }
    const timeA = a.scheduledStartTime || "00:00";
    const timeB = b.scheduledStartTime || "00:00";
    return timeA.localeCompare(timeB);
  });

  const getJobPositions = (jobs: WorkOrderWithObject[]) => {
    return jobs
      .map(job => {
        const obj = objectMap.get(job.objectId);
        if (obj?.latitude && obj?.longitude) {
          return [obj.latitude, obj.longitude] as [number, number];
        }
        return null;
      })
      .filter((p): p is [number, number] => p !== null);
  };

  const fetchRoute = async (positions: [number, number][]): Promise<RouteData | null> => {
    if (positions.length < 2) return null;
    
    try {
      const coordinates = positions.map(([lat, lon]) => [lon, lat]);
      
      const response = await fetch("/api/routes/directions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates }),
        credentials: "include",
      });
      if (!response.ok) return null;
      const data = await response.json();
      
      if (data && data.features && data.features.length > 0) {
        const feature = data.features[0];
        const props = feature.properties || {};
        return {
          distance: (props.distance || 0) / 1000,
          duration: Math.round((props.time || 0) / 60),
          geometry: feature.geometry as GeoJSON.LineString | GeoJSON.MultiLineString,
        };
      }
      return null;
    } catch (error) {
      console.error("Failed to fetch route:", error);
      toast({
        title: "Kunde inte beräkna rutt",
        description: "Ruttberäkning misslyckades. Visar uppskattade tider.",
        variant: "destructive",
      });
      return null;
    }
  };

  const routePositions = useMemo(() => getJobPositions(displayJobs), [displayJobs, objectMap]);
  const positionsKey = routePositions.map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join("|");

  const addressCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of displayJobs) {
      const obj = objectMap.get(job.objectId);
      if (obj?.latitude && obj?.longitude) {
        const key = `${obj.latitude.toFixed(4)},${obj.longitude.toFixed(4)}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return counts;
  }, [displayJobs, objectMap]);

  useEffect(() => {
    if (routePositions.length >= 2) {
      setIsLoadingRoute(true);
      fetchRoute(routePositions).then(data => {
        setRouteData(data);
        setIsLoadingRoute(false);
      }).catch(() => {
        setRouteData(null);
        setIsLoadingRoute(false);
      });
    } else {
      setRouteData(null);
    }
  }, [positionsKey]);

  const calculateDistance = (positions: [number, number][]) => {
    // Use route data if available, otherwise fallback to Haversine
    if (routeData) return routeData.distance;
    
    if (positions.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < positions.length - 1; i++) {
      const [lat1, lon1] = positions[i];
      const [lat2, lon2] = positions[i + 1];
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      total += R * c;
    }
    return total;
  };

  const calculateSetupTime = (jobs: WorkOrderWithObject[]) => {
    let total = 0;
    let prevAccessType: string | null = null;
    
    for (const job of jobs) {
      const obj = objectMap.get(job.objectId);
      const accessType = obj?.accessType || "open";
      const baseSetupTime = obj?.avgSetupTime || 0;
      
      if (prevAccessType === accessType && accessType !== "open") {
        total += Math.round(baseSetupTime * 0.5);
      } else {
        total += baseSetupTime;
      }
      prevAccessType = accessType;
    }
    return total;
  };

  const jobPositions = routePositions;

  const totalSetupTime = calculateSetupTime(displayJobs);
  const totalWorkTime = displayJobs.reduce((sum, job) => sum + (job.estimatedDuration || 0), 0);
  const totalDistance = routeData?.distance ?? calculateDistance(jobPositions);
  const estimatedDriveTime = routeData?.duration ?? Math.round(totalDistance * 2);

  const accessTypeGroups = useMemo(() => {
    const groups: Record<string, number> = {};
    displayJobs.forEach(job => {
      const obj = objectMap.get(job.objectId);
      const accessType = obj?.accessType || "open";
      groups[accessType] = (groups[accessType] || 0) + 1;
    });
    return groups;
  }, [displayJobs, objectMap]);

  const totalDayTime = totalWorkTime + totalSetupTime + estimatedDriveTime;
  const efficiencyPercent = totalDayTime > 0 ? Math.round((totalWorkTime / totalDayTime) * 100) : 0;

  const isLoading = resourcesLoading || workOrdersLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const defaultCenter: [number, number] = jobPositions.length > 0 
    ? jobPositions[0] 
    : [59.196, 17.626];

  return (
    <div className="flex flex-col lg:flex-row gap-4" style={{ minHeight: "calc(100vh - 180px)" }}>
      <div className="w-full lg:w-[280px] shrink-0 flex flex-col gap-3 lg:overflow-y-auto lg:max-h-[calc(100vh-200px)]">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Ruttstatistik
              </CardTitle>
              <Select value={activeResource} onValueChange={setSelectedResource}>
                <SelectTrigger className="w-[160px]" data-testid="select-resource">
                  <SelectValue placeholder="Välj tekniker" />
                </SelectTrigger>
                <SelectContent>
                  {resources.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex border rounded-md">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant={viewMode === "day" ? "default" : "ghost"}
                      size="sm"
                      className="rounded-r-none"
                      onClick={() => setViewMode("day")}
                      data-testid="button-view-day"
                    >
                      Dag
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Visa en dag</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant={viewMode === "week" ? "default" : "ghost"}
                      size="sm"
                      className="rounded-l-none"
                      onClick={() => setViewMode("week")}
                      data-testid="button-view-week"
                    >
                      Vecka
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Visa hela veckan</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setSelectedDate(addDays(selectedDate, viewMode === "week" ? -7 : -1))}
                    data-testid="button-prev-period"
                  >
                    Föregående
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Föregående {viewMode === "week" ? "vecka" : "dag"}</TooltipContent>
              </Tooltip>
              <span className="text-sm font-medium flex-1 text-center">
                {viewMode === "week" 
                  ? `v${format(selectedDate, "w", { locale: sv })} (${format(periodStart, "d/M")} - ${format(periodEnd, "d/M")})`
                  : format(selectedDate, "EEEE d/M", { locale: sv })
                }
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setSelectedDate(addDays(selectedDate, viewMode === "week" ? 7 : 1))}
                    data-testid="button-next-period"
                  >
                    Nästa
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Nästa {viewMode === "week" ? "vecka" : "dag"}</TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="p-2 bg-muted rounded-md hover-elevate cursor-help">
                    <div className="text-lg font-semibold">{displayJobs.length}</div>
                    <div className="text-[10px] text-muted-foreground">Jobb</div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Antal schemalagda jobb</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="p-2 bg-muted rounded-md hover-elevate cursor-help">
                    <div className="text-lg font-semibold">{totalDistance.toFixed(1)}</div>
                    <div className="text-[10px] text-muted-foreground">km</div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Total körsträcka</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="p-2 bg-muted rounded-md hover-elevate cursor-help">
                    <div className="text-lg font-semibold flex items-center justify-center gap-1">
                      {isLoadingRoute ? <Loader2 className="h-4 w-4 animate-spin" /> : estimatedDriveTime}
                    </div>
                    <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                      {routeData ? <MapPinned className="h-3 w-3" /> : null}
                      min kör
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>{routeData ? "Körtid beräknad via Geoapify" : "Uppskattad körtid"}</TooltipContent>
              </Tooltip>
            </div>

          </CardContent>
        </Card>

        <Card className="flex-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Route className="h-4 w-4" />
              Jobbordning
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {displayJobs.length === 0 ? (
              <div className="p-6 text-center space-y-3">
                <PackageSearch className="h-8 w-8 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">
                  Inga jobb schemalagda för {viewMode === "week" 
                    ? `vecka ${format(selectedDate, "w", { locale: sv })}`
                    : format(selectedDate, "d MMMM", { locale: sv })
                  }
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/order-stock">
                    <Package className="h-4 w-4 mr-2" />
                    Gå till Orderstock
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="divide-y">
                {displayJobs.map((job, index) => {
                  const obj = objectMap.get(job.objectId);
                  const setupTime = obj?.avgSetupTime || 0;
                  const accessType = obj?.accessType || "open";
                  const hasCoords = obj?.latitude && obj?.longitude;
                  const prevJob = index > 0 ? displayJobs[index - 1] : null;
                  const prevObj = prevJob ? objectMap.get(prevJob.objectId) : null;
                  const sameAccessAsPrev = prevObj?.accessType === accessType && accessType !== "open";
                  const effectiveSetupTime = sameAccessAsPrev ? Math.round(setupTime * 0.5) : setupTime;
                  const AccessIcon = accessTypeLabels[accessType]?.icon || DoorOpen;

                  return (
                    <div key={job.id}>
                      <div 
                        className="p-3 flex items-start gap-3 cursor-pointer hover-elevate"
                        onClick={() => { onNavigate?.(job.id); }}
                        data-testid={`route-job-${job.id}`}
                      >
                        <div className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                          <div 
                            className="flex h-6 w-6 items-center justify-center rounded-full text-white text-xs font-medium"
                            style={{ backgroundColor: getSetupTimeColor(effectiveSetupTime) }}
                          >
                            {index + 1}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{job.title}</div>
                          <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                            {job.objectName || "Okänt objekt"}
                            {(() => {
                              const o = objectMap.get(job.objectId);
                              if (!o?.latitude || !o?.longitude) return null;
                              const k = `${o.latitude.toFixed(4)},${o.longitude.toFixed(4)}`;
                              const cnt = addressCounts.get(k) || 1;
                              if (cnt <= 1) return null;
                              return (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400 no-default-hover-elevate">
                                  {cnt} ordrar
                                </Badge>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                            {job.scheduledStartTime && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {job.scheduledStartTime}
                              </span>
                            )}
                            <span>{job.estimatedDuration || 0} min</span>
                            <span className="flex items-center gap-1">
                              <AccessIcon className="h-3 w-3" />
                              {accessTypeLabels[accessType]?.label || accessType}
                            </span>
                            {!hasCoords && (
                              <Badge variant="outline" className="text-[10px] text-orange-600 no-default-hover-elevate">
                                Saknar koordinater
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <SetupTimeBadge minutes={effectiveSetupTime} />
                          {sameAccessAsPrev && (
                            <span className="text-[9px] text-green-600 dark:text-green-400">-50%</span>
                          )}
                        </div>
                      </div>
                      {index < displayJobs.length - 1 && (
                        <div className="flex items-center justify-center gap-2 py-1.5 text-xs text-muted-foreground bg-muted/50">
                          <Car className="h-3 w-3" />
                          <ArrowRight className="h-3 w-3" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1 overflow-hidden">
        <CardContent className="p-0 h-full relative">
          <MapContainer
            center={defaultCenter}
            zoom={13}
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution={mapConfig.attribution}
              url={mapConfig.tileUrl}
            />
            
            {jobPositions.length > 0 && <MapFitBounds positions={jobPositions} />}
            
            {routeData?.geometry && routeData.geometry.coordinates ? (
              <>
                {routeData.geometry.type === "MultiLineString" ? (
                  (routeData.geometry as GeoJSON.MultiLineString).coordinates.map((line, i) => (
                    <Polyline
                      key={`route-line-${i}`}
                      positions={line.map(([lon, lat]) => [lat, lon] as [number, number])}
                      color="#3b82f6"
                      weight={4}
                      opacity={0.8}
                    />
                  ))
                ) : (
                  <Polyline 
                    positions={(routeData.geometry as GeoJSON.LineString).coordinates.map(([lon, lat]) => [lat, lon] as [number, number])}
                    color="#3b82f6"
                    weight={4}
                    opacity={0.8}
                  />
                )}
                {routePositions.map((pos, i) => {
                  const allCoords = routeData.geometry.type === "MultiLineString"
                    ? (routeData.geometry as GeoJSON.MultiLineString).coordinates.flat()
                    : (routeData.geometry as GeoJSON.LineString).coordinates;
                  let nearest = allCoords[0];
                  let minDist = Infinity;
                  for (const c of allCoords) {
                    const d = (c[0] - pos[1]) ** 2 + (c[1] - pos[0]) ** 2;
                    if (d < minDist) { minDist = d; nearest = c; }
                  }
                  if (minDist < 0.00001) return null;
                  return (
                    <Polyline
                      key={`connector-${i}`}
                      positions={[pos, [nearest[1], nearest[0]] as [number, number]]}
                      color="#3b82f6"
                      weight={2}
                      opacity={0.5}
                      dashArray="4, 4"
                    />
                  );
                })}
              </>
            ) : jobPositions.length > 1 && (
              <Polyline 
                positions={jobPositions} 
                color="#3b82f6"
                weight={3}
                opacity={0.7}
                dashArray="10, 10"
              />
            )}
            
            {displayJobs.map((job, index) => {
              const obj = objectMap.get(job.objectId);
              if (!obj?.latitude || !obj?.longitude) return null;
              
              const setupTime = obj?.avgSetupTime || 0;
              const accessType = obj?.accessType || "open";
              const markerColor = colorMode === "accessType" 
                ? getAccessTypeColor(accessType) 
                : getSetupTimeColor(setupTime);
              
              const totalContainers = (obj.containerCount || 0) + 
                (obj.containerCountK2 || 0) + 
                (obj.containerCountK3 || 0) + 
                (obj.containerCountK4 || 0);

              const addrKey = `${obj.latitude.toFixed(4)},${obj.longitude.toFixed(4)}`;
              const stackCount = addressCounts.get(addrKey) || 1;
              
              return (
                <Fragment key={job.id}>
                  <Marker
                    position={[obj.latitude, obj.longitude]}
                    icon={createNumberedIcon(index + 1, markerColor, stackCount)}
                    eventHandlers={{
                      click: () => onNavigate?.(job.id),
                    }}
                  >
                    <Popup>
                      <div className="p-1 min-w-[220px] max-w-[320px]">
                        {(() => {
                          const colocatedJobs = stackCount > 1
                            ? displayJobs.filter(j => {
                                const o = objectMap.get(j.objectId);
                                if (!o?.latitude || !o?.longitude) return false;
                                return `${o.latitude.toFixed(4)},${o.longitude.toFixed(4)}` === addrKey;
                              })
                            : [job];

                          return (
                            <>
                              <div className="text-sm text-gray-600">{obj.address}</div>
                              {stackCount > 1 && (
                                <div className="mt-1 mb-1 px-1.5 py-0.5 bg-red-50 text-red-700 rounded text-xs font-medium inline-block">
                                  {stackCount} ordrar på denna adress
                                </div>
                              )}

                              {colocatedJobs.map((cj, ci) => {
                                const co = objectMap.get(cj.objectId);
                                const cSetup = co?.avgSetupTime || 0;
                                const cAccess = co?.accessType || "open";
                                const cContainers = (co?.containerCount || 0) +
                                  (co?.containerCountK2 || 0) +
                                  (co?.containerCountK3 || 0) +
                                  (co?.containerCountK4 || 0);
                                const cIdx = displayJobs.indexOf(cj);

                                return (
                                  <div key={cj.id} className={`${ci > 0 ? "mt-2 pt-2 border-t border-gray-200" : "mt-1"}`}>
                                    <div className="font-medium text-base flex items-center gap-2">
                                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-white text-[10px] font-bold shrink-0">
                                        {cIdx + 1}
                                      </span>
                                      {cj.title}
                                    </div>
                                    <div className="text-sm text-gray-600">{co?.name || cj.objectName}</div>

                                    <div className="mt-1 space-y-0.5 text-sm">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium">Tillgång:</span>
                                        <span>{accessTypeLabels[cAccess]?.label || cAccess}</span>
                                        {showAccessCodes && co?.accessCode && (
                                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded text-xs font-mono">
                                            {co.accessCode}
                                          </span>
                                        )}
                                        {showAccessCodes && co?.keyNumber && (
                                          <span className="px-1.5 py-0.5 bg-orange-100 text-orange-800 rounded text-xs font-mono">
                                            Nyckel: {co.keyNumber}
                                          </span>
                                        )}
                                      </div>
                                      <div><span className="font-medium">Arbetstid:</span> {cj.estimatedDuration} min</div>
                                      {cContainers > 0 && (
                                        <div>
                                          <span className="font-medium">Objekt:</span>{" "}
                                          {co?.containerCount ? `K1: ${co.containerCount}` : ""}
                                          {co?.containerCountK2 ? ` K2: ${co.containerCountK2}` : ""}
                                          {co?.containerCountK3 ? ` K3: ${co.containerCountK3}` : ""}
                                          {co?.containerCountK4 ? ` K4: ${co.containerCountK4}` : ""}
                                          <span className="text-gray-500 ml-1">({cContainers} st)</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </>
                          );
                        })()}
                      </div>
                    </Popup>
                  </Marker>
                  {(obj as any).entranceLatitude && (obj as any).entranceLongitude && (
                    <Marker
                      position={[(obj as any).entranceLatitude, (obj as any).entranceLongitude]}
                      icon={createEntranceIcon()}
                    >
                      <Popup>
                        <div className="p-1">
                          <div className="font-medium text-sm">Entré — {obj.name}</div>
                          {(obj as any).addressDescriptor && (
                            <div className="text-xs text-gray-600 mt-1">{(obj as any).addressDescriptor}</div>
                          )}
                        </div>
                      </Popup>
                    </Marker>
                  )}
                </Fragment>
              );
            })}
          </MapContainer>
          
        </CardContent>
      </Card>
    </div>
  );
}

function SetupTimeBadge({ minutes }: { minutes: number }) {
  const color = minutes < 10 ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : 
                minutes < 20 ? "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" : 
                "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
  
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] shrink-0 ${color}`}>
      {minutes}m
    </span>
  );
}
