import { useEffect, useMemo, useState, useCallback } from "react";
import { Marker, Polyline, Popup, CircleMarker } from "react-leaflet";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Maximize2, Minimize2, X, AlertTriangle, Clock, MapPin } from "lucide-react";
import { BaseMap, MapFitBounds, numberedDivIcon, getRouteSegmentColor, getClusterColor, CLUSTER_COLOR_PALETTE } from "@/components/ui/map";

interface RouteStop {
  workOrderId: string;
  objectId: string;
  objectName: string;
  latitude?: number;
  longitude?: number;
  estimatedDuration: number;
}

interface VRPMapStop {
  orderId: string;
  orderTitle: string;
  sequence: number;
  location: { lat: number; lng: number };
  serviceMinutes: number;
  isBreak?: boolean;
}

interface VRPMapRoute {
  resourceId: string;
  resourceName: string;
  stops: VRPMapStop[];
  totalDistanceKm: number;
  totalDurationMinutes: number;
}

interface OptimizedRouteMapProps {
  stops?: RouteStop[];
  vrpRoutes?: VRPMapRoute[];
  resourceName?: string;
  onClose?: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  showClusters?: boolean;
}

const CLUSTER_COLORS = CLUSTER_COLOR_PALETTE;

const createNumberedIcon = (number: number, color: string) =>
  numberedDivIcon({ number, color, size: 24 });

async function fetchRouteGeometry(waypoints: { lat: number; lng: number }[]): Promise<[number, number][]> {
  try {
    const response = await fetch("/api/route-geometry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waypoints }),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.coordinates || [];
  } catch {
    return [];
  }
}

export function OptimizedRouteMap({
  stops,
  vrpRoutes,
  resourceName,
  onClose,
  expanded = false,
  onToggleExpand,
  showClusters = false,
}: OptimizedRouteMapProps) {
  const [roadGeometries, setRoadGeometries] = useState<Record<string, [number, number][]>>({});
  const [loadingGeometry, setLoadingGeometry] = useState(false);

  const vrpPositions = useMemo(() => {
    if (!vrpRoutes) return [];
    return vrpRoutes.flatMap((r) =>
      r.stops
        .filter((s) => !s.isBreak && s.location)
        .map((s) => [s.location.lat, s.location.lng] as [number, number])
    );
  }, [vrpRoutes]);

  const legacyValidStops = useMemo(() => {
    if (vrpRoutes) return [];
    return (stops || []).filter((s) => s.latitude && s.longitude);
  }, [stops, vrpRoutes]);

  const legacyPositions = useMemo(() => {
    return legacyValidStops.map((s) => [s.latitude!, s.longitude!] as [number, number]);
  }, [legacyValidStops]);

  const allPositions = vrpRoutes ? vrpPositions : legacyPositions;
  const skippedCount = stops ? stops.length - legacyValidStops.length : 0;

  const fetchAllGeometries = useCallback(async () => {
    setLoadingGeometry(true);
    const geometries: Record<string, [number, number][]> = {};

    if (vrpRoutes) {
      const promises = vrpRoutes.map(async (route) => {
        const routeStops = route.stops.filter((s) => !s.isBreak && s.location);
        if (routeStops.length < 2) return;
        const waypoints = routeStops.map((s) => ({ lat: s.location.lat, lng: s.location.lng }));
        const coords = await fetchRouteGeometry(waypoints);
        if (coords.length > 0) {
          geometries[route.resourceId] = coords;
        }
      });
      await Promise.all(promises);
    } else if (legacyValidStops.length >= 2) {
      const waypoints = legacyValidStops.map((s) => ({ lat: s.latitude!, lng: s.longitude! }));
      const coords = await fetchRouteGeometry(waypoints);
      if (coords.length > 0) {
        geometries["legacy"] = coords;
      }
    }

    setRoadGeometries(geometries);
    setLoadingGeometry(false);
  }, [vrpRoutes, legacyValidStops]);

  useEffect(() => {
    if (allPositions.length >= 2) {
      fetchAllGeometries();
    }
  }, [allPositions.length, fetchAllGeometries]);

  if (allPositions.length === 0) {
    return (
      <Card className="p-4 text-center text-sm text-muted-foreground">
        Inga stopp med koordinater att visa
      </Card>
    );
  }

  const defaultCenter = allPositions[0];

  return (
    <Card className={`overflow-hidden relative ${expanded ? "fixed inset-4 z-50" : "h-64 w-full"}`}>
      <div className="absolute top-2 right-2 z-[1000] flex gap-1">
        {onToggleExpand && (
          <Button
            size="icon"
            variant="secondary"
            className="h-7 w-7"
            onClick={onToggleExpand}
            data-testid="button-toggle-map-expand"
          >
            {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </Button>
        )}
        {onClose && (
          <Button
            size="icon"
            variant="secondary"
            className="h-7 w-7"
            onClick={onClose}
            data-testid="button-close-map"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      <div className="absolute top-2 left-2 z-[1000] flex flex-wrap gap-1">
        {loadingGeometry && (
          <Badge variant="secondary" className="text-xs animate-pulse">
            Hämtar väggeometri...
          </Badge>
        )}
        {vrpRoutes ? (
          vrpRoutes.map((route, idx) => (
            <Badge
              key={route.resourceId}
              variant="secondary"
              className="text-xs"
              style={{
                backgroundColor: `${CLUSTER_COLORS[idx % CLUSTER_COLORS.length]}20`,
                borderColor: CLUSTER_COLORS[idx % CLUSTER_COLORS.length],
                color: CLUSTER_COLORS[idx % CLUSTER_COLORS.length],
              }}
              data-testid={`badge-route-${route.resourceId}`}
            >
              {route.resourceName}: {route.stops.filter((s) => !s.isBreak).length} stopp
            </Badge>
          ))
        ) : (
          <>
            <Badge variant="secondary" className="text-xs">
              {resourceName} - {legacyValidStops.length} stopp
            </Badge>
            {skippedCount > 0 && (
              <Badge
                variant="outline"
                className="text-xs border-chart-3/50 text-chart-3 bg-background/90"
                data-testid="badge-skipped-stops"
              >
                <AlertTriangle className="h-3 w-3 mr-1 text-chart-4" />
                {skippedCount} saknar koordinater
              </Badge>
            )}
          </>
        )}
      </div>
      <BaseMap center={defaultCenter} zoom={13}>
        <MapFitBounds positions={allPositions} padding={[30, 30]} />

        {vrpRoutes
          ? vrpRoutes.map((route, routeIdx) => {
              const color = CLUSTER_COLORS[routeIdx % CLUSTER_COLORS.length];
              const routeStops = route.stops.filter((s) => !s.isBreak && s.location);
              const straightPositions = routeStops.map(
                (s) => [s.location.lat, s.location.lng] as [number, number]
              );
              const roadPositions = roadGeometries[route.resourceId];

              return (
                <span key={route.resourceId}>
                  <Polyline
                    positions={roadPositions || straightPositions}
                    pathOptions={{
                      color,
                      weight: roadPositions ? 4 : 3,
                      opacity: 0.8,
                      dashArray: roadPositions ? undefined : "8, 4",
                    }}
                  />
                  {showClusters && routeStops.length > 0 && (
                    <CircleMarker
                      center={[
                        routeStops.reduce((s, st) => s + st.location.lat, 0) / routeStops.length,
                        routeStops.reduce((s, st) => s + st.location.lng, 0) / routeStops.length,
                      ]}
                      radius={Math.max(20, routeStops.length * 5)}
                      pathOptions={{ color, fillColor: color, fillOpacity: 0.1, weight: 2, dashArray: "4, 4" }}
                    />
                  )}
                  {routeStops.map((stop, idx) => (
                    <Marker
                      key={`${route.resourceId}-${stop.orderId}-${idx}`}
                      position={[stop.location.lat, stop.location.lng]}
                      icon={createNumberedIcon(stop.sequence, color)}
                    >
                      <Popup>
                        <div className="text-xs space-y-1">
                          <div className="font-medium">{stop.orderTitle || stop.orderId}</div>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {stop.serviceMinutes} min
                          </div>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {route.resourceName}
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </span>
              );
            })
          : (
            <>
              <Polyline
                positions={roadGeometries["legacy"] || legacyPositions}
                pathOptions={{
                  color: "#3b82f6",
                  weight: roadGeometries["legacy"] ? 4 : 3,
                  opacity: 0.8,
                  dashArray: roadGeometries["legacy"] ? undefined : "8, 4",
                }}
              />
              {legacyValidStops.map((stop, idx) => (
                <Marker
                  key={stop.workOrderId}
                  position={[stop.latitude!, stop.longitude!]}
                  icon={createNumberedIcon(
                    idx + 1,
                    getRouteSegmentColor(idx, legacyValidStops.length)
                  )}
                />
              ))}
            </>
          )}
      </BaseMap>

      {vrpRoutes && (
        <div className="absolute bottom-2 left-2 z-[1000] bg-background/90 rounded-md p-2 text-xs space-y-1 max-w-[200px]" data-testid="cluster-stats">
          {vrpRoutes.map((route, idx) => (
            <div key={route.resourceId} className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: CLUSTER_COLORS[idx % CLUSTER_COLORS.length] }}
              />
              <span className="truncate">{route.resourceName}</span>
              <span className="text-muted-foreground ml-auto">{route.totalDistanceKm.toFixed(1)}km</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
