/**
 * Kartvy — ruttklumpar som cirklar + stoppklumpar som punktmarkörer.
 * Används som "Karta"-fliken i GrovplaneringPage.
 */
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Circle, CircleMarker, Popup } from "react-leaflet";
import { Loader2, Info } from "lucide-react";
import { getISOWeek, getYear } from "date-fns";
import { BaseMap, MapFitBounds } from "@/components/ui/map";
import { apiRequest } from "@/lib/queryClient";
import { ClusterWeekSlider } from "./ClusterWeekSlider";
import { ClusterSidePanel, type ClusterRef } from "./ClusterSidePanel";
import { cn } from "@/lib/utils";

// ============================================================================
// Typer
// ============================================================================

interface RouteClusterMapItem {
  id: string;
  displayName: string;
  status: string;
  executionCode: string | null;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusKilometers: number | null;
  calculatedWorkMinutes: number | null;
  taskCount: number;
  period: string | null;
}

interface StopClusterMapItem {
  id: string;
  displayName: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  memberCount: number;
}

// ============================================================================
// Färgkonstanter per status
// ============================================================================

const STATUS_COLOR: Record<string, { fill: string; stroke: string }> = {
  active: { fill: "#4A9B9B33", stroke: "#4A9B9B" },
  auto: { fill: "#4A9B9B33", stroke: "#4A9B9B" },
  confirmed: { fill: "#7DBFB033", stroke: "#7DBFB0" },
  locked: { fill: "#1B4B6B33", stroke: "#1B4B6B" },
  dissolved: { fill: "#6B7C8C22", stroke: "#6B7C8C" },
};

function clusterColor(status: string) {
  return STATUS_COLOR[status] ?? STATUS_COLOR.active;
}

// ============================================================================
// Hjälpfunktioner
// ============================================================================

function formatMinutes(min: number | null | undefined): string {
  if (min == null) return "–";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// ============================================================================
// Karta-inner (måste vara inuti MapContainer context)
// ============================================================================

function MapContent({
  routeClusters,
  stopClusters,
  onOpenCluster,
}: {
  routeClusters: RouteClusterMapItem[];
  stopClusters: StopClusterMapItem[];
  onOpenCluster: (ref: ClusterRef) => void;
}) {
  // Samla alla koordinater för auto-fit
  const positions: [number, number][] = [
    ...routeClusters
      .filter((c) => c.centerLatitude != null && c.centerLongitude != null)
      .map((c) => [c.centerLatitude!, c.centerLongitude!] as [number, number]),
    ...stopClusters
      .filter((c) => c.latitude != null && c.longitude != null)
      .map((c) => [c.latitude!, c.longitude!] as [number, number]),
  ];

  return (
    <>
      {positions.length > 0 && <MapFitBounds positions={positions} padding={[60, 60]} />}

      {/* Ruttklumpar: cirklar */}
      {routeClusters.map((c) => {
        if (c.centerLatitude == null || c.centerLongitude == null) return null;
        const color = clusterColor(c.status);
        const radiusM = (c.radiusKilometers ?? 40) * 1000;
        return (
          <Circle
            key={c.id}
            center={[c.centerLatitude, c.centerLongitude]}
            radius={radiusM}
            pathOptions={{
              color: color.stroke,
              fillColor: color.fill,
              fillOpacity: 0.35,
              weight: 2,
            }}
            eventHandlers={{ click: () => onOpenCluster({ type: "route", id: c.id }) }}
          >
            <Popup>
              <div className="text-sm min-w-[160px]">
                <div className="font-semibold">{c.displayName}</div>
                {c.period && (
                  <div className="text-xs text-muted-foreground">{c.period}</div>
                )}
                <div className="mt-1 text-xs">
                  {c.taskCount} uppg. · {formatMinutes(c.calculatedWorkMinutes)}
                </div>
                <button
                  className="mt-1 text-xs underline"
                  onClick={() => onOpenCluster({ type: "route", id: c.id })}
                >
                  Öppna panel
                </button>
              </div>
            </Popup>
          </Circle>
        );
      })}

      {/* Stoppklumpar: punkt-markörer */}
      {stopClusters.map((c) => {
        if (c.latitude == null || c.longitude == null) return null;
        const color = clusterColor(c.status);
        return (
          <CircleMarker
            key={c.id}
            center={[c.latitude, c.longitude]}
            radius={8}
            pathOptions={{
              color: color.stroke,
              fillColor: color.stroke,
              fillOpacity: 0.8,
              weight: 2,
            }}
            eventHandlers={{ click: () => onOpenCluster({ type: "stop", id: c.id }) }}
          >
            <Popup>
              <div className="text-sm min-w-[140px]">
                <div className="font-semibold">{c.displayName}</div>
                <div className="text-xs text-muted-foreground">{c.memberCount} uppg.</div>
                <button
                  className="mt-1 text-xs underline"
                  onClick={() => onOpenCluster({ type: "stop", id: c.id })}
                >
                  Öppna panel
                </button>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

// ============================================================================
// Kartlegend
// ============================================================================

function MapLegend() {
  return (
    <div className="absolute bottom-4 left-4 z-[1000] rounded-lg border border-border bg-card/95 p-2 text-xs shadow-sm backdrop-blur-sm">
      <div className="font-medium mb-1 flex items-center gap-1">
        <Info className="h-3 w-3" />
        Statusfärger
      </div>
      {[
        { status: "active", label: "Aktiv" },
        { status: "confirmed", label: "Bekräftad" },
        { status: "locked", label: "Låst" },
      ].map(({ status, label }) => {
        const color = clusterColor(status);
        return (
          <div key={status} className="flex items-center gap-1.5 mt-0.5">
            <span
              className="inline-block h-3 w-3 rounded-full border-2"
              style={{ backgroundColor: color.fill, borderColor: color.stroke }}
            />
            <span className="text-muted-foreground">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Exporterat ClusterMapView
// ============================================================================

export function ClusterMapView() {
  const [weekRef, setWeekRef] = useState(() => new Date());
  const [openCluster, setOpenCluster] = useState<ClusterRef | null>(null);

  const weekNum = getISOWeek(weekRef);

  const routeQuery = useQuery<RouteClusterMapItem[]>({
    queryKey: ["/api/clustering/route-clusters", "map", weekNum, getYear(weekRef)],
    queryFn: async () => {
      const params = new URLSearchParams({ week: String(weekNum) });
      return (await apiRequest("GET", `/api/clustering/route-clusters?${params}`)).json();
    },
  });

  const stopQuery = useQuery<StopClusterMapItem[]>({
    queryKey: ["/api/clustering/stop-clusters", "map"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/clustering/stop-clusters")).json(),
  });

  const routeClusters = routeQuery.data ?? [];
  const stopClusters = stopQuery.data ?? [];
  const isLoading = routeQuery.isLoading || stopQuery.isLoading;

  // Beräkna kartcentrum (medelvärde av routecluster centroider)
  const coordClusters = routeClusters.filter(
    (c) => c.centerLatitude != null && c.centerLongitude != null,
  );
  const defaultCenter: [number, number] =
    coordClusters.length > 0
      ? [
          coordClusters.reduce((s, c) => s + c.centerLatitude!, 0) /
            coordClusters.length,
          coordClusters.reduce((s, c) => s + c.centerLongitude!, 0) /
            coordClusters.length,
        ]
      : [59.33, 18.07]; // Stockholm fallback

  return (
    <div className="flex flex-col gap-3">
      {/* Kontroller ovanpå kartan */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Visa vecka:</span>
          <ClusterWeekSlider
            weekRef={weekRef}
            onChange={setWeekRef}
            disabled={routeQuery.isFetching}
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isLoading && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          <span>
            {routeClusters.length} ruttklumpar · {stopClusters.length} stoppklumpar
          </span>
        </div>
      </div>

      {/* Karta */}
      <div
        className="relative rounded-lg border border-border overflow-hidden"
        style={{ height: "520px" }}
        data-testid="container-cluster-map"
      >
        <BaseMap
          center={defaultCenter}
          zoom={9}
          style={{ height: "100%", width: "100%" }}
        >
          <MapContent
            routeClusters={routeClusters}
            stopClusters={stopClusters}
            onOpenCluster={setOpenCluster}
          />
        </BaseMap>
        <MapLegend />
      </div>

      {/* Side panel */}
      <ClusterSidePanel cluster={openCluster} onClose={() => setOpenCluster(null)} />
    </div>
  );
}
