import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { MapPin, Clock, Car, ArrowRight, Route, GripVertical, Loader2, Key, Keyboard, Users, DoorOpen, BarChart3, MapPinned, Sparkles, Package, Eye, EyeOff, Palette, PackageSearch } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format, startOfDay, endOfDay, addDays, startOfWeek, endOfWeek } from "date-fns";
import { sv } from "date-fns/locale";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useObjectsByIds } from "@/hooks/useObjectSearch";
import type { Resource, WorkOrderWithObject, ServiceObject } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const createNumberedIcon = (number: number, color: string) => {
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
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
    ">${number}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
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
}

interface RouteData {
  distance: number; // km
  duration: number; // minutes
  geometry: GeoJSON.LineString | null;
}

type ColorMode = "setupTime" | "accessType";

export function RouteMap({ onNavigate }: RouteMapProps) {
  const [selectedResource, setSelectedResource] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<"day" | "week">("day");
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>("accessType");
  const [showAccessCodes, setShowAccessCodes] = useState(false);
  const { toast } = useToast();

  const { data: resources = [], isLoading: resourcesLoading } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: workOrders = [], isLoading: workOrdersLoading } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders"],
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

  const fetchRouteFromORS = async (positions: [number, number][]): Promise<RouteData | null> => {
    if (positions.length < 2) return null;
    
    try {
      // ORS expects [lon, lat] format, we have [lat, lon]
      const coordinates = positions.map(([lat, lon]) => [lon, lat]);
      
      const response = await apiRequest("POST", "/api/routes/directions", { coordinates });
      const data = await response.json();
      
      if (data && data.features && data.features.length > 0) {
        const feature = data.features[0];
        const props = feature.properties?.summary || {};
        return {
          distance: (props.distance || 0) / 1000, // meters to km
          duration: Math.round((props.duration || 0) / 60), // seconds to minutes
          geometry: feature.geometry as GeoJSON.LineString,
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

  // Fetch route when jobs or their order changes
  const jobsKey = displayJobs.map(j => j.id).join(",");
  useEffect(() => {
    const positions = getJobPositions(displayJobs);
    if (positions.length >= 2) {
      setIsLoadingRoute(true);
      fetchRouteFromORS(positions).then(data => {
        setRouteData(data);
        setIsLoadingRoute(false);
      });
    } else {
      setRouteData(null);
    }
  }, [jobsKey]);

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

  const jobPositions = useMemo(() => getJobPositions(displayJobs), [displayJobs, objectMap]);

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
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      <div className="w-full lg:w-[420px] flex flex-col gap-4 overflow-auto">
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
            <div className="grid grid-cols-4 gap-2 text-center">
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
                <TooltipContent>{routeData ? "Körtid beräknad via OpenRouteService" : "Uppskattad körtid"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="p-2 bg-muted rounded-md hover-elevate cursor-help">
                    <div className="text-lg font-semibold">{totalSetupTime}</div>
                    <div className="text-[10px] text-muted-foreground">min ställ</div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Total ställtid inkl. reducering vid samma tillgångstyp</TooltipContent>
              </Tooltip>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Effektivitet (arbete / total tid)</span>
                <span className="font-medium">{efficiencyPercent}%</span>
              </div>
              <Progress value={efficiencyPercent} className="h-2" />
              <div className="flex gap-2 text-[10px] text-muted-foreground justify-center">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  Arbete {totalWorkTime}m
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                  Ställtid {totalSetupTime}m
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                  Körning {estimatedDriveTime}m
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium">Tillgångstyper</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(accessTypeGroups).map(([type, count]) => {
                  const config = accessTypeLabels[type] || { label: type, icon: DoorOpen };
                  const Icon = config.icon;
                  return (
                    <Badge key={type} variant="secondary" className="text-xs gap-1 no-default-hover-elevate">
                      <Icon className="h-3 w-3" />
                      {config.label}: {count}
                    </Badge>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    size="sm" 
                    variant={colorMode === "accessType" ? "default" : "outline"}
                    onClick={() => setColorMode("accessType")}
                    data-testid="button-color-access"
                  >
                    <Palette className="h-3 w-3 mr-1" />
                    Tillgång
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Färglägg efter tillgångstyp</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    size="sm" 
                    variant={colorMode === "setupTime" ? "default" : "outline"}
                    onClick={() => setColorMode("setupTime")}
                    data-testid="button-color-setup"
                  >
                    <Clock className="h-3 w-3 mr-1" />
                    Ställtid
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Färglägg efter ställtid</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    size="sm" 
                    variant={showAccessCodes ? "default" : "outline"}
                    onClick={() => setShowAccessCodes(!showAccessCodes)}
                    data-testid="button-toggle-codes"
                  >
                    {showAccessCodes ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}
                    Koder
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{showAccessCodes ? "Dölj portkoder" : "Visa portkoder på kartan"}</TooltipContent>
              </Tooltip>
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  className="w-full" 
                  variant="outline"
                  asChild
                  data-testid="button-go-to-optimization"
                >
                  <Link href="/optimization">
                    <Sparkles className="h-4 w-4 mr-2" />
                    Inför Optimering
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Förbered data och konfiguration inför ruttoptimering</TooltipContent>
            </Tooltip>
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
              <div className="divide-y max-h-[350px] overflow-auto">
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
                          <div className="text-xs text-muted-foreground truncate">{job.objectName || "Okänt objekt"}</div>
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

      <Card className="flex-1 min-h-[400px] overflow-hidden">
        <CardContent className="p-0 h-full relative">
          <MapContainer
            center={defaultCenter}
            zoom={13}
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            
            {jobPositions.length > 0 && <MapFitBounds positions={jobPositions} />}
            
            {routeData?.geometry && routeData.geometry.coordinates ? (
              <Polyline 
                positions={routeData.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])}
                color="#3b82f6"
                weight={4}
                opacity={0.8}
              />
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
              
              return (
                <Marker
                  key={job.id}
                  position={[obj.latitude, obj.longitude]}
                  icon={createNumberedIcon(index + 1, markerColor)}
                  eventHandlers={{
                    click: () => onNavigate?.(job.id),
                  }}
                >
                  <Popup>
                    <div className="p-1 min-w-[200px]">
                      <div className="font-medium text-base">{job.title}</div>
                      <div className="text-sm text-gray-600">{obj.name}</div>
                      <div className="text-sm text-gray-600">{obj.address}</div>
                      
                      <div className="mt-2 pt-2 border-t border-gray-200 space-y-1">
                        <div className="text-sm flex items-center gap-2">
                          <span className="font-medium">Tillgång:</span>
                          <span className="flex items-center gap-1">
                            {accessTypeLabels[accessType]?.label || accessType}
                            {showAccessCodes && obj.accessCode && (
                              <span className="ml-1 px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded text-xs font-mono">
                                {obj.accessCode}
                              </span>
                            )}
                            {showAccessCodes && obj.keyNumber && (
                              <span className="ml-1 px-1.5 py-0.5 bg-orange-100 text-orange-800 rounded text-xs font-mono">
                                Nyckel: {obj.keyNumber}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="text-sm">
                          <span className="font-medium">Ställtid:</span> {setupTime} min
                        </div>
                        <div className="text-sm">
                          <span className="font-medium">Arbetstid:</span> {job.estimatedDuration} min
                        </div>
                        
                        {totalContainers > 0 && (
                          <div className="text-sm pt-1 border-t border-gray-200 mt-1">
                            <span className="font-medium">Kärl:</span>{" "}
                            {obj.containerCount ? `K1: ${obj.containerCount}` : ""}
                            {obj.containerCountK2 ? ` K2: ${obj.containerCountK2}` : ""}
                            {obj.containerCountK3 ? ` K3: ${obj.containerCountK3}` : ""}
                            {obj.containerCountK4 ? ` K4: ${obj.containerCountK4}` : ""}
                            <span className="text-gray-500 ml-1">({totalContainers} st)</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
          
          <div className="absolute bottom-4 right-4 bg-background/90 backdrop-blur-sm rounded-md shadow-md p-3 space-y-1.5 z-[1000]">
            {colorMode === "setupTime" ? (
              <>
                <div className="text-xs font-medium">Ställtid</div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-3 h-3 rounded-full bg-green-500"></span>
                  <span>&lt;10 min</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-3 h-3 rounded-full bg-orange-500"></span>
                  <span>10-20 min</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-3 h-3 rounded-full bg-red-500"></span>
                  <span>&gt;20 min</span>
                </div>
              </>
            ) : (
              <>
                <div className="text-xs font-medium">Tillgångstyp</div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-3 h-3 rounded-full bg-green-500"></span>
                  <span>Öppen</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                  <span>Kod</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-3 h-3 rounded-full bg-orange-500"></span>
                  <span>Nyckel</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-3 h-3 rounded-full bg-purple-500"></span>
                  <span>Möte</span>
                </div>
              </>
            )}
          </div>
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
