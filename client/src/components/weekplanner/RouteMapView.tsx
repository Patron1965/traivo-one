import { memo, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Coffee, Loader2, LocateFixed, Send, Truck } from "lucide-react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, WorkOrderWithObject, Customer } from "@shared/schema";
import { calculateTravelTime, haversineDistance } from "./types";
import { SortableRouteItem } from "./DndComponents";
import { useMapConfig } from "@/hooks/use-map-config";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function MapFitBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [bounds, map]);
  return null;
}

export interface VRPBreakStop {
  orderId: string;
  arrivalSeconds: number;
  durationMinutes: number;
  location: { lat: number; lng: number };
}

interface RouteMapViewProps {
  currentDate: Date;
  resources: Resource[];
  routeViewResourceId: string | null;
  setRouteViewResourceId: (v: string | null) => void;
  routeJobs: WorkOrderWithObject[];
  routeJobOrder: string[];
  customerMap: Map<string, Customer>;
  isOptimizing: boolean;
  selectedJob: string | null;
  onJobClick: (jobId: string) => void;
  onSortEnd: (oldIndex: number, newIndex: number) => void;
  onOptimizeRoute: () => void;
  onSendSchedule: (resource: Resource) => void;
  vrpBreaks?: VRPBreakStop[];
}

export const RouteMapView = memo(function RouteMapView(props: RouteMapViewProps) {
  const {
    currentDate, resources, routeViewResourceId, setRouteViewResourceId,
    routeJobs, routeJobOrder, customerMap, isOptimizing,
    selectedJob, onJobClick, onSortEnd, onOptimizeRoute, onSendSchedule,
    vrpBreaks,
  } = props;

  const mapConfig = useMapConfig();

  const orderedJobs = useMemo(() => {
    if (routeJobOrder.length === 0) return routeJobs;
    const jobIds = new Set(routeJobs.map(j => j.id));
    const orderCoversAll = routeJobOrder.length === routeJobs.length && routeJobOrder.every(id => jobIds.has(id));
    if (!orderCoversAll) return routeJobs;
    const jobMap = new Map(routeJobs.map(j => [j.id, j]));
    return routeJobOrder.map(id => jobMap.get(id)).filter((j): j is WorkOrderWithObject => !!j);
  }, [routeJobs, routeJobOrder]);

  const mapBounds = useMemo(() => {
    const points = orderedJobs
      .filter(j => j.taskLatitude && j.taskLongitude)
      .map(j => [j.taskLatitude!, j.taskLongitude!] as [number, number]);
    if (points.length === 0) return null;
    return L.latLngBounds(points);
  }, [orderedJobs]);

  const routePolyline = useMemo(() => {
    return orderedJobs
      .filter(j => j.taskLatitude && j.taskLongitude)
      .map(j => [j.taskLatitude!, j.taskLongitude!] as [number, number]);
  }, [orderedJobs]);

  const routeStats = useMemo(() => {
    let totalMinutes = 0;
    let totalKm = 0;
    for (let i = 0; i < orderedJobs.length - 1; i++) {
      const a = orderedJobs[i];
      const b = orderedJobs[i + 1];
      if (a.taskLatitude && a.taskLongitude && b.taskLatitude && b.taskLongitude) {
        const dist = haversineDistance(a.taskLatitude, a.taskLongitude, b.taskLatitude, b.taskLongitude);
        totalKm += dist;
        totalMinutes += calculateTravelTime(a.taskLatitude, a.taskLongitude, b.taskLatitude, b.taskLongitude);
      }
    }
    const totalWorkMinutes = orderedJobs.reduce((sum, j) => sum + (j.estimatedDuration || 0), 0);
    const breakMinutes = (vrpBreaks || []).reduce((sum, b) => sum + (b.durationMinutes || 0), 0);
    return { totalMinutes, totalKm: Math.round(totalKm), totalWorkMinutes, stops: orderedJobs.length, breakMinutes };
  }, [orderedJobs, vrpBreaks]);

  const selectedResource = resources.find(r => r.id === routeViewResourceId);

  return (
    <div className="flex-1 flex">
      <div className="w-[340px] border-r flex flex-col">
        <div className="p-3 border-b space-y-3">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Rutt</span>
            <Badge variant="secondary" className="text-xs">{format(currentDate, "d MMM", { locale: sv })}</Badge>
          </div>
          <Select value={routeViewResourceId || ""} onValueChange={(v) => setRouteViewResourceId(v || null)}>
            <SelectTrigger className="w-full h-9" data-testid="select-route-resource">
              <SelectValue placeholder="Välj resurs" />
            </SelectTrigger>
            <SelectContent>
              {resources.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {routeViewResourceId && (
            <>
              <div className="grid grid-cols-2 gap-2" data-testid="route-stats">
                <Card className="p-2 text-center">
                  <div className="text-lg font-bold">{routeStats.stops}</div>
                  <div className="text-[10px] text-muted-foreground">Stopp</div>
                </Card>
                <Card className="p-2 text-center">
                  <div className="text-lg font-bold">{routeStats.totalKm}</div>
                  <div className="text-[10px] text-muted-foreground">km totalt</div>
                </Card>
                <Card className="p-2 text-center">
                  <div className="text-lg font-bold">{Math.round(routeStats.totalMinutes)}</div>
                  <div className="text-[10px] text-muted-foreground">min restid</div>
                </Card>
                <Card className="p-2 text-center">
                  <div className="text-lg font-bold">{(routeStats.totalWorkMinutes / 60).toFixed(1)}</div>
                  <div className="text-[10px] text-muted-foreground">h arbete</div>
                </Card>
                {routeStats.breakMinutes > 0 && (
                  <Card className="p-2 text-center col-span-2 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800" data-testid="route-break-stat">
                    <div className="flex items-center justify-center gap-1">
                      <Coffee className="h-3.5 w-3.5 text-amber-600" />
                      <span className="text-sm font-bold">{routeStats.breakMinutes} min rast</span>
                    </div>
                  </Card>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={onOptimizeRoute}
                  disabled={isOptimizing || orderedJobs.length < 2}
                  data-testid="button-optimize-route"
                >
                  {isOptimizing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5 mr-1" />}
                  Optimera rutt
                </Button>
                {selectedResource && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onSendSchedule(selectedResource)}
                        data-testid="button-send-route-schedule"
                      >
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Skicka schema</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </>
          )}
        </div>
        <ScrollArea className="flex-1 p-2">
          <SortableContext items={orderedJobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1" data-testid="route-stop-list">
              {orderedJobs.map((job, index) => {
                const customer = customerMap.get(job.customerId);
                let travelToNext: number | undefined;
                if (index < orderedJobs.length - 1) {
                  const next = orderedJobs[index + 1];
                  if (job.taskLatitude && job.taskLongitude && next.taskLatitude && next.taskLongitude) {
                    travelToNext = calculateTravelTime(job.taskLatitude, job.taskLongitude, next.taskLatitude, next.taskLongitude);
                  }
                }
                const breakAfter = (vrpBreaks || []).find(b => {
                  if (!b.arrivalSeconds) return false;
                  const jobArrival = job.scheduledStartTime ? parseFloat(job.scheduledStartTime.split(":")[0]) * 3600 + parseFloat(job.scheduledStartTime.split(":")[1] || "0") * 60 : 0;
                  const nextJob = index < orderedJobs.length - 1 ? orderedJobs[index + 1] : null;
                  const nextArrival = nextJob?.scheduledStartTime ? parseFloat(nextJob.scheduledStartTime.split(":")[0]) * 3600 + parseFloat(nextJob.scheduledStartTime.split(":")[1] || "0") * 60 : 999999;
                  return b.arrivalSeconds >= jobArrival && b.arrivalSeconds < nextArrival;
                });
                return (
                  <div key={job.id}>
                    <SortableRouteItem
                      job={job}
                      index={index}
                      totalCount={orderedJobs.length}
                      customer={customer}
                      travelToNext={travelToNext}
                      isSelected={selectedJob === job.id}
                      onSelect={onJobClick}
                    />
                    {breakAfter && (
                      <div className="flex items-center gap-2 px-3 py-1.5 mx-1 my-0.5 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800" data-testid="route-break-indicator">
                        <Coffee className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                          Rast {breakAfter.durationMinutes} min
                          {breakAfter.arrivalSeconds > 0 && ` (${Math.floor(breakAfter.arrivalSeconds / 3600).toString().padStart(2,"0")}:${Math.floor((breakAfter.arrivalSeconds % 3600) / 60).toString().padStart(2,"0")})`}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
              {orderedJobs.length === 0 && routeViewResourceId && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  Inga schemalagda jobb för denna resurs idag
                </div>
              )}
              {!routeViewResourceId && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  Välj en resurs för att visa rutten
                </div>
              )}
            </div>
          </SortableContext>
        </ScrollArea>
      </div>
      <div className="flex-1 relative">
        <MapContainer
          center={[59.33, 18.07]}
          zoom={10}
          className="h-full w-full"
          style={{ zIndex: 1 }}
        >
          <TileLayer
            attribution={mapConfig.attribution}
            url={mapConfig.tileUrl}
          />
          {mapBounds && <MapFitBounds bounds={mapBounds} />}
          {routePolyline.length > 1 && (
            <Polyline positions={routePolyline} color="#3B82F6" weight={3} opacity={0.7} />
          )}
          {orderedJobs.map((job, index) => {
            if (!job.taskLatitude || !job.taskLongitude) return null;
            const isFirst = index === 0;
            const isLast = index === orderedJobs.length - 1;
            const color = isFirst ? "#22C55E" : isLast ? "#EF4444" : "#3B82F6";
            const icon = L.divIcon({
              className: "custom-div-icon",
              html: `<div style="background:${color};color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.3)">${index + 1}</div>`,
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            });
            return (
              <Marker key={job.id} position={[job.taskLatitude, job.taskLongitude]} icon={icon}>
                <Popup>
                  <div className="min-w-[200px]">
                    <div className="font-medium">{job.title}</div>
                    <div className="text-sm text-gray-500">{job.objectName}</div>
                    {job.taskAddress && <div className="text-sm text-gray-500">{job.taskAddress}</div>}
                    <div className="flex gap-2 mt-1">
                      <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                        {((job.estimatedDuration || 0) / 60).toFixed(1)}h
                      </span>
                      {job.scheduledStartTime && (
                        <span className="text-xs bg-blue-100 px-1.5 py-0.5 rounded">
                          {job.scheduledStartTime}
                        </span>
                      )}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
          {(vrpBreaks || []).map((brk) => {
            if (!brk.location.lat || !brk.location.lng) return null;
            const breakTime = brk.arrivalSeconds ? `${Math.floor(brk.arrivalSeconds / 3600).toString().padStart(2,"0")}:${Math.floor((brk.arrivalSeconds % 3600) / 60).toString().padStart(2,"0")}` : "";
            const breakIcon = L.divIcon({
              className: "custom-div-icon",
              html: `<div style="background:#F59E0B;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.3)">☕</div>`,
              iconSize: [28, 28],
              iconAnchor: [14, 14],
            });
            return (
              <Marker key={brk.orderId} position={[brk.location.lat, brk.location.lng]} icon={breakIcon}>
                <Popup>
                  <div className="min-w-[150px]">
                    <div className="font-medium flex items-center gap-1">☕ Rast</div>
                    <div className="text-sm text-gray-500">{brk.durationMinutes} min</div>
                    {breakTime && <div className="text-xs bg-amber-100 px-1.5 py-0.5 rounded mt-1 inline-block">{breakTime}</div>}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
});
