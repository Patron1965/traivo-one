import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { MapPin, Clock, Car, Zap, ArrowRight, Route, Navigation, GripVertical, Loader2, Key, Keyboard, Users, DoorOpen, TrendingDown, BarChart3, MapPinned, Send, CheckCircle } from "lucide-react";
import { format, startOfDay, endOfDay, addDays, startOfWeek, endOfWeek } from "date-fns";
import { sv } from "date-fns/locale";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, GeoJSON } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Resource, WorkOrder, ServiceObject } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  
  if (positions.length > 0) {
    const bounds = L.latLngBounds(positions.map(p => L.latLng(p[0], p[1])));
    map.fitBounds(bounds, { padding: [50, 50] });
  }
  
  return null;
}

interface RouteMapProps {
  onOptimize?: () => void;
  onNavigate?: (jobId: string) => void;
}

interface RouteData {
  distance: number; // km
  duration: number; // minutes
  geometry: GeoJSON.LineString | null;
}

export function RouteMap({ onOptimize, onNavigate }: RouteMapProps) {
  const [selectedResource, setSelectedResource] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<"day" | "week">("day");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizedJobs, setOptimizedJobs] = useState<WorkOrder[] | null>(null);
  const [highlightedJob, setHighlightedJob] = useState<string | null>(null);
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const { toast } = useToast();

  const { data: resources = [], isLoading: resourcesLoading } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: workOrders = [], isLoading: workOrdersLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: objects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

  const objectMap = new Map(objects.map(o => [o.id, o]));

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

  const originalJobs = workOrders.filter(wo => {
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

  const displayJobs = optimizedJobs || originalJobs;

  const getJobPositions = (jobs: WorkOrder[]) => {
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
  const isOptimized = optimizedJobs !== null;
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
  }, [jobsKey, isOptimized]);

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

  const calculateSetupTime = (jobs: WorkOrder[]) => {
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

  const jobPositions = getJobPositions(displayJobs);
  const originalPositions = getJobPositions(originalJobs);

  const totalSetupTime = calculateSetupTime(displayJobs);
  const originalSetupTime = calculateSetupTime(originalJobs);
  const totalWorkTime = displayJobs.reduce((sum, job) => sum + (job.estimatedDuration || 0), 0);
  const totalDistance = routeData?.distance ?? calculateDistance(jobPositions);
  const originalDistance = calculateDistance(originalPositions);
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

  const optimizeByAccessType = (jobs: WorkOrder[]): WorkOrder[] => {
    const jobsWithAccess = jobs.map(job => {
      const obj = objectMap.get(job.objectId);
      return { job, accessType: obj?.accessType || "open", obj };
    });

    const accessOrder = ["open", "code", "key", "meeting"];
    
    jobsWithAccess.sort((a, b) => {
      const orderA = accessOrder.indexOf(a.accessType);
      const orderB = accessOrder.indexOf(b.accessType);
      if (orderA !== orderB) return orderA - orderB;
      
      if (a.obj?.latitude && a.obj?.longitude && b.obj?.latitude && b.obj?.longitude) {
        return a.obj.latitude - b.obj.latitude;
      }
      return 0;
    });

    return jobsWithAccess.map(j => j.job);
  };

  const handleOptimize = async () => {
    setIsOptimizing(true);
    await new Promise(resolve => setTimeout(resolve, 800));
    
    const optimized = optimizeByAccessType(originalJobs);
    setOptimizedJobs(optimized);
    setIsOptimizing(false);
    onOptimize?.();
  };

  const handleResetOptimization = () => {
    setOptimizedJobs(null);
    setIsSent(false);
  };

  const handleSendToDriver = async () => {
    if (!optimizedJobs || !activeResource) return;
    
    setIsSending(true);
    try {
      const selectedResourceData = resources.find(r => r.id === activeResource);
      
      // Update each work order with new scheduled start times based on optimized order
      let currentTime = new Date(selectedDate);
      currentTime.setHours(7, 0, 0, 0); // Start at 07:00
      
      for (let i = 0; i < optimizedJobs.length; i++) {
        const job = optimizedJobs[i];
        const startTime = `${currentTime.getHours().toString().padStart(2, '0')}:${currentTime.getMinutes().toString().padStart(2, '0')}`;
        
        await apiRequest("PATCH", `/api/work-orders/${job.id}`, {
          scheduledStartTime: startTime,
          resourceId: activeResource,
        });
        
        // Add job duration + estimated travel time for next job
        const jobDuration = job.estimatedDuration || 30;
        const obj = objectMap.get(job.objectId);
        const setupTime = obj?.avgSetupTime || 10;
        currentTime = new Date(currentTime.getTime() + (jobDuration + setupTime + 10) * 60000);
      }
      
      // Invalidate work orders cache
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      
      setIsSent(true);
      toast({
        title: "Rutt skickad",
        description: `Optimerad rutt har skickats till ${selectedResourceData?.name || "chauffören"}`,
      });
    } catch (error) {
      console.error("Failed to send route:", error);
      toast({
        title: "Kunde inte skicka rutt",
        description: "Något gick fel vid uppdatering av jobben.",
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

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

  const savedSetupTime = optimizedJobs ? originalSetupTime - totalSetupTime : 0;
  const savedDistance = optimizedJobs ? originalDistance - totalDistance : 0;

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
              <Select value={activeResource} onValueChange={(v) => { setSelectedResource(v); setOptimizedJobs(null); }}>
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
                <Button 
                  variant={viewMode === "day" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-r-none"
                  onClick={() => { setViewMode("day"); setOptimizedJobs(null); }}
                  data-testid="button-view-day"
                >
                  Dag
                </Button>
                <Button 
                  variant={viewMode === "week" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-l-none"
                  onClick={() => { setViewMode("week"); setOptimizedJobs(null); }}
                  data-testid="button-view-week"
                >
                  Vecka
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => { setSelectedDate(addDays(selectedDate, viewMode === "week" ? -7 : -1)); setOptimizedJobs(null); }}
                data-testid="button-prev-period"
              >
                Föregående
              </Button>
              <span className="text-sm font-medium flex-1 text-center">
                {viewMode === "week" 
                  ? `v${format(selectedDate, "w", { locale: sv })} (${format(periodStart, "d/M")} - ${format(periodEnd, "d/M")})`
                  : format(selectedDate, "EEEE d/M", { locale: sv })
                }
              </span>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => { setSelectedDate(addDays(selectedDate, viewMode === "week" ? 7 : 1)); setOptimizedJobs(null); }}
                data-testid="button-next-period"
              >
                Nästa
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="p-2 bg-muted rounded-md">
                <div className="text-lg font-semibold">{displayJobs.length}</div>
                <div className="text-[10px] text-muted-foreground">Jobb</div>
              </div>
              <div className="p-2 bg-muted rounded-md">
                <div className="text-lg font-semibold">{totalDistance.toFixed(1)}</div>
                <div className="text-[10px] text-muted-foreground">km</div>
              </div>
              <div className="p-2 bg-muted rounded-md">
                <div className="text-lg font-semibold flex items-center gap-1">
                  {isLoadingRoute ? <Loader2 className="h-4 w-4 animate-spin" /> : estimatedDriveTime}
                </div>
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  {routeData ? <MapPinned className="h-3 w-3" /> : null}
                  min kör
                </div>
              </div>
              <div className="p-2 bg-muted rounded-md">
                <div className="text-lg font-semibold">{totalSetupTime}</div>
                <div className="text-[10px] text-muted-foreground">min ställ</div>
              </div>
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
                    <Badge key={type} variant="secondary" className="text-xs gap-1">
                      <Icon className="h-3 w-3" />
                      {config.label}: {count}
                    </Badge>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2">
              <Button 
                className="flex-1" 
                onClick={handleOptimize}
                disabled={isOptimizing || displayJobs.length === 0 || optimizedJobs !== null}
                data-testid="button-optimize-route"
              >
                {isOptimizing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Optimerar...
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 mr-2" />
                    Optimera rutt
                  </>
                )}
              </Button>
              {optimizedJobs && (
                <Button variant="outline" onClick={handleResetOptimization} data-testid="button-reset-optimization">
                  Återställ
                </Button>
              )}
            </div>

            {optimizedJobs && (
              <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-md">
                <div className="text-sm font-medium text-green-700 dark:text-green-300 mb-2 flex items-center gap-2">
                  {isSent ? <CheckCircle className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {isSent ? "Rutt skickad" : "Optimering genomförd"}
                </div>
                <div className="space-y-1 text-xs text-green-600 dark:text-green-400">
                  <div className="flex justify-between">
                    <span>Sparad ställtid:</span>
                    <span className="font-medium">{savedSetupTime} min</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Kortare sträcka:</span>
                    <span className="font-medium">{savedDistance.toFixed(1)} km</span>
                  </div>
                </div>
                <p className="text-[10px] text-green-600 dark:text-green-400 mt-2">
                  Rutten har optimerats för effektivare körning
                </p>
                
                {!isSent && (
                  <Button 
                    className="w-full mt-3" 
                    onClick={handleSendToDriver}
                    disabled={isSending}
                    data-testid="button-send-to-driver"
                  >
                    {isSending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Skickar...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        Skicka till {resources.find(r => r.id === activeResource)?.name || "chaufför"}
                      </>
                    )}
                  </Button>
                )}
                
                {isSent && (
                  <div className="flex items-center justify-center gap-2 mt-3 text-sm text-green-700 dark:text-green-300">
                    <CheckCircle className="h-4 w-4" />
                    Rutten har uppdaterats i systemet
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex-1 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Route className="h-4 w-4" />
              Jobbordning {optimizedJobs && <Badge variant="secondary" className="text-[10px]">Optimerad</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {displayJobs.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Inga jobb schemalagda för {viewMode === "week" 
                  ? `vecka ${format(selectedDate, "w", { locale: sv })}`
                  : format(selectedDate, "d MMMM", { locale: sv })
                }
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
                        className={`p-3 flex items-start gap-3 hover-elevate cursor-pointer transition-colors ${highlightedJob === job.id ? "bg-primary/10" : ""}`}
                        onClick={() => { onNavigate?.(job.id); }}
                        onMouseEnter={() => setHighlightedJob(job.id)}
                        onMouseLeave={() => setHighlightedJob(null)}
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
                          <div className="text-xs text-muted-foreground truncate">{obj?.name || "Okänt objekt"}</div>
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
                              <Badge variant="outline" className="text-[10px] text-orange-600">
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
            
            {routeData?.geometry ? (
              <GeoJSON 
                key={jobsKey + (optimizedJobs ? "-optimized" : "")}
                data={{
                  type: "Feature",
                  properties: {},
                  geometry: routeData.geometry,
                } as GeoJSON.Feature}
                style={{
                  color: optimizedJobs ? "#22c55e" : "#3b82f6",
                  weight: 4,
                  opacity: 0.8,
                }}
              />
            ) : jobPositions.length > 1 && (
              <Polyline 
                positions={jobPositions} 
                color={optimizedJobs ? "#22c55e" : "#3b82f6"} 
                weight={3}
                opacity={0.7}
                dashArray="10, 10"
              />
            )}
            
            {displayJobs.map((job, index) => {
              const obj = objectMap.get(job.objectId);
              if (!obj?.latitude || !obj?.longitude) return null;
              
              const setupTime = obj?.avgSetupTime || 0;
              const isHighlighted = highlightedJob === job.id;
              
              return (
                <Marker
                  key={job.id}
                  position={[obj.latitude, obj.longitude]}
                  icon={createNumberedIcon(index + 1, isHighlighted ? "#3b82f6" : getSetupTimeColor(setupTime))}
                  eventHandlers={{
                    click: () => onNavigate?.(job.id),
                    mouseover: () => setHighlightedJob(job.id),
                    mouseout: () => setHighlightedJob(null),
                  }}
                >
                  <Popup>
                    <div className="p-1">
                      <div className="font-medium">{job.title}</div>
                      <div className="text-sm text-gray-600">{obj.name}</div>
                      <div className="text-sm text-gray-600">{obj.address}</div>
                      <div className="text-sm mt-1">
                        <span className="font-medium">Tillgång:</span> {accessTypeLabels[obj.accessType || "open"]?.label}
                      </div>
                      <div className="text-sm">
                        <span className="font-medium">Ställtid:</span> {setupTime} min
                      </div>
                      <div className="text-sm">
                        <span className="font-medium">Arbetstid:</span> {job.estimatedDuration} min
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
          
          <div className="absolute bottom-4 right-4 bg-background/90 backdrop-blur-sm rounded-md shadow-md p-3 space-y-1.5 z-[1000]">
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
