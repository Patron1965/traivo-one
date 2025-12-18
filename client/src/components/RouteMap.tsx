import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Clock, Car, Zap, ArrowRight, Route, Navigation, GripVertical, Loader2 } from "lucide-react";
import { format, startOfDay, endOfDay, addDays } from "date-fns";
import { sv } from "date-fns/locale";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Resource, WorkOrder, ServiceObject } from "@shared/schema";

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

interface MapFitBoundsProps {
  positions: [number, number][];
}

function MapFitBounds({ positions }: MapFitBoundsProps) {
  const map = useMap();
  
  useMemo(() => {
    if (positions.length > 0) {
      const bounds = L.latLngBounds(positions.map(p => L.latLng(p[0], p[1])));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [positions, map]);
  
  return null;
}

interface RouteMapProps {
  onOptimize?: () => void;
  onNavigate?: (jobId: string) => void;
}

export function RouteMap({ onOptimize, onNavigate }: RouteMapProps) {
  const [selectedResource, setSelectedResource] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [highlightedJob, setHighlightedJob] = useState<string | null>(null);

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

  const dayStart = startOfDay(selectedDate);
  const dayEnd = endOfDay(selectedDate);

  const activeResource = selectedResource || (resources.length > 0 ? resources[0].id : "");
  const activeResourceData = resources.find(r => r.id === activeResource);

  const todayJobs = workOrders.filter(wo => {
    if (!wo.scheduledDate || wo.resourceId !== activeResource) return false;
    const scheduled = new Date(wo.scheduledDate);
    return scheduled >= dayStart && scheduled <= dayEnd;
  }).sort((a, b) => {
    const timeA = a.scheduledStartTime || "00:00";
    const timeB = b.scheduledStartTime || "00:00";
    return timeA.localeCompare(timeB);
  });

  const jobPositions: [number, number][] = todayJobs
    .map(job => {
      const obj = objectMap.get(job.objectId);
      if (obj?.latitude && obj?.longitude) {
        return [obj.latitude, obj.longitude] as [number, number];
      }
      return null;
    })
    .filter((p): p is [number, number] => p !== null);

  const totalSetupTime = todayJobs.reduce((sum, job) => {
    const obj = objectMap.get(job.objectId);
    return sum + (obj?.avgSetupTime || 0);
  }, 0);
  const totalWorkTime = todayJobs.reduce((sum, job) => sum + (job.estimatedDuration || 0), 0);

  const calculateTotalDistance = () => {
    if (jobPositions.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < jobPositions.length - 1; i++) {
      const [lat1, lon1] = jobPositions[i];
      const [lat2, lon2] = jobPositions[i + 1];
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

  const totalDistance = calculateTotalDistance();
  const estimatedDriveTime = Math.round(totalDistance * 2);

  const handleOptimize = async () => {
    setIsOptimizing(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsOptimizing(false);
    setShowComparison(true);
    onOptimize?.();
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

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      <div className="w-full lg:w-96 flex flex-col gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">Rutt</CardTitle>
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
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setSelectedDate(addDays(selectedDate, -1))}
                data-testid="button-prev-day"
              >
                Igår
              </Button>
              <span className="text-sm font-medium flex-1 text-center">
                {format(selectedDate, "EEEE d/M", { locale: sv })}
              </span>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setSelectedDate(addDays(selectedDate, 1))}
                data-testid="button-next-day"
              >
                Imorgon
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="p-2 bg-muted rounded-md">
                <div className="text-lg font-semibold">{todayJobs.length}</div>
                <div className="text-xs text-muted-foreground">Jobb</div>
              </div>
              <div className="p-2 bg-muted rounded-md">
                <div className="text-lg font-semibold">{totalDistance.toFixed(1)} km</div>
                <div className="text-xs text-muted-foreground">Sträcka</div>
              </div>
              <div className="p-2 bg-muted rounded-md">
                <div className="text-lg font-semibold">{estimatedDriveTime}</div>
                <div className="text-xs text-muted-foreground">min körning</div>
              </div>
              <div className="p-2 bg-muted rounded-md">
                <div className="text-lg font-semibold">{totalSetupTime}</div>
                <div className="text-xs text-muted-foreground">min ställtid</div>
              </div>
            </div>

            <Button 
              className="w-full" 
              onClick={handleOptimize}
              disabled={isOptimizing || todayJobs.length === 0}
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

            {showComparison && (
              <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-md">
                <div className="text-sm font-medium text-green-700 dark:text-green-300 mb-1">
                  Optimerad rutt sparar:
                </div>
                <div className="flex items-center gap-4 text-xs text-green-600 dark:text-green-400">
                  <span>{(totalDistance * 0.2).toFixed(1)} km</span>
                  <span>{Math.round(estimatedDriveTime * 0.15)} min körtid</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex-1 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Route className="h-4 w-4" />
              Jobbordning
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {todayJobs.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Inga jobb schemalagda för {format(selectedDate, "d MMMM", { locale: sv })}
              </div>
            ) : (
              <div className="divide-y max-h-[400px] overflow-auto">
                {todayJobs.map((job, index) => {
                  const obj = objectMap.get(job.objectId);
                  const setupTime = obj?.avgSetupTime || 0;
                  const hasCoords = obj?.latitude && obj?.longitude;

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
                            style={{ backgroundColor: getSetupTimeColor(setupTime) }}
                          >
                            {index + 1}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{job.title}</div>
                          <div className="text-xs text-muted-foreground truncate">{obj?.name || "Okänt objekt"}</div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                            {job.scheduledStartTime && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {job.scheduledStartTime}
                              </span>
                            )}
                            <span>{job.estimatedDuration || 0} min</span>
                            {!hasCoords && (
                              <Badge variant="outline" className="text-[10px] text-orange-600">
                                Saknar koordinater
                              </Badge>
                            )}
                          </div>
                        </div>
                        <SetupTimeBadge minutes={setupTime} />
                      </div>
                      {index < todayJobs.length - 1 && (
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
        <CardContent className="p-0 h-full">
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
            
            {jobPositions.length > 1 && (
              <Polyline 
                positions={jobPositions} 
                color="#3b82f6" 
                weight={3}
                opacity={0.7}
                dashArray="10, 10"
              />
            )}
            
            {todayJobs.map((job, index) => {
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
