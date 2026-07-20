/**
 * Kartvy — ruttklumpar som cirklar + stoppklumpar som punktmarkörer.
 * Karta-flik i GrovplaneringPage. Execution_code styr cirkelfargen (ej status).
 */
import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Circle, CircleMarker, Popup, Rectangle, useMapEvents, useMap } from "react-leaflet";
import type * as L from "leaflet";
import { Loader2, Info, Square, X } from "lucide-react";
import { getISOWeek, getYear } from "date-fns";
import { BaseMap, MapFitBounds } from "@/components/ui/map";
import { apiRequest } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
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
  precisionLevel: string | null;
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
  executionCode: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  memberCount: number;
}

// ============================================================================
// Färgpalett per execution_code (deterministisk hash → Traivo-palett)
// ============================================================================

const EXECUTION_PALETTE = [
  "#4A9B9B",
  "#1B4B6B",
  "#7DBFB0",
  "#6B7C8C",
  "#2C3E50",
  "#4A8B7B",
  "#1B6B4B",
  "#9BAA5B",
];

// ---------------------------------------------------------------------------
// MapFlyTo — centrerar kartan på angivet mål (monteras inuti MapContainer)
// ---------------------------------------------------------------------------
function MapFlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo(target, Math.max(map.getZoom(), 12), { animate: true, duration: 1 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return null;
}

function codeColor(code: string | null): { fill: string; stroke: string } {
  if (!code) return { fill: "#6B7C8C33", stroke: "#6B7C8C" };
  let h = 5381;
  for (let i = 0; i < code.length; i++) h = ((h << 5) + h) ^ code.charCodeAt(i);
  const stroke = EXECUTION_PALETTE[Math.abs(h) % EXECUTION_PALETTE.length];
  return { fill: stroke + "33", stroke };
}

const PRECISION_LABEL: Record<string, string> = {
  high: "Hög",
  medium: "Medel",
  low: "Låg",
};

function formatMinutes(min: number | null | undefined): string {
  if (min == null) return "–";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// ============================================================================
// Polygon/rektangel-väljare (react-leaflet hook-komponent)
// ============================================================================

type LatLngTuple = [number, number];

function PolygonSelector({
  enabled,
  onBoundsSelected,
}: {
  enabled: boolean;
  onBoundsSelected: (bounds: [LatLngTuple, LatLngTuple] | null) => void;
}) {
  const [start, setStart] = useState<L.LatLng | null>(null);
  const [current, setCurrent] = useState<L.LatLng | null>(null);

  useMapEvents({
    mousedown(e) {
      if (!enabled) return;
      setStart(e.latlng);
      setCurrent(e.latlng);
    },
    mousemove(e) {
      if (!enabled || !start) return;
      setCurrent(e.latlng);
    },
    mouseup(e) {
      if (!enabled || !start) return;
      const end = e.latlng;
      onBoundsSelected([
        [Math.min(start.lat, end.lat), Math.min(start.lng, end.lng)],
        [Math.max(start.lat, end.lat), Math.max(start.lng, end.lng)],
      ]);
      setStart(null);
      setCurrent(null);
    },
  });

  if (!start || !current) return null;
  return (
    <Rectangle
      bounds={[
        [Math.min(start.lat, current.lat), Math.min(start.lng, current.lng)],
        [Math.max(start.lat, current.lat), Math.max(start.lng, current.lng)],
      ]}
      pathOptions={{
        color: "#4A9B9B",
        fillColor: "#4A9B9B",
        fillOpacity: 0.1,
        weight: 2,
        dashArray: "4 4",
      }}
    />
  );
}

// ============================================================================
// Kartinnehåll
// ============================================================================

function MapContent({
  routeClusters,
  stopClusters,
  onOpenCluster,
  drawMode,
  selectionBounds,
  onBoundsSelected,
  selectedMapIds,
}: {
  routeClusters: RouteClusterMapItem[];
  stopClusters: StopClusterMapItem[];
  onOpenCluster: (ref: ClusterRef) => void;
  drawMode: boolean;
  selectionBounds: [LatLngTuple, LatLngTuple] | null;
  onBoundsSelected: (bounds: [LatLngTuple, LatLngTuple] | null) => void;
  selectedMapIds: Set<string>;
}) {
  const positions: LatLngTuple[] = [
    ...routeClusters
      .filter((c) => c.centerLatitude != null && c.centerLongitude != null)
      .map((c) => [c.centerLatitude!, c.centerLongitude!] as LatLngTuple),
    ...stopClusters
      .filter((c) => c.latitude != null && c.longitude != null)
      .map((c) => [c.latitude!, c.longitude!] as LatLngTuple),
  ];

  return (
    <>
      {positions.length > 0 && <MapFitBounds positions={positions} padding={[60, 60]} />}
      <PolygonSelector enabled={drawMode} onBoundsSelected={onBoundsSelected} />

      {/* Markerat område */}
      {selectionBounds && (
        <Rectangle
          bounds={selectionBounds}
          pathOptions={{
            color: "#4A9B9B",
            fillColor: "#4A9B9B",
            fillOpacity: 0.08,
            weight: 2,
          }}
        />
      )}

      {/* Ruttklumpar: cirklar, färg = executionCode */}
      {routeClusters.map((c) => {
        if (c.centerLatitude == null || c.centerLongitude == null) return null;
        const color = codeColor(c.executionCode);
        const radiusM = (c.radiusKilometers ?? 40) * 1000;
        const isSelected = selectedMapIds.has(c.id);
        return (
          <Circle
            key={c.id}
            center={[c.centerLatitude, c.centerLongitude]}
            radius={radiusM}
            pathOptions={{
              color: isSelected ? "#1B4B6B" : color.stroke,
              fillColor: isSelected ? "#1B4B6B44" : color.fill,
              fillOpacity: isSelected ? 0.45 : 0.35,
              weight: isSelected ? 3 : 2,
            }}
            eventHandlers={{
              click: () => {
                if (!drawMode) onOpenCluster({ type: "route", id: c.id });
              },
            }}
          >
            <Popup>
              <div className="text-sm min-w-[160px]">
                <div className="font-semibold">{c.displayName}</div>
                {c.period && (
                  <div className="text-xs text-muted-foreground">{c.period}</div>
                )}
                {c.executionCode && (
                  <div className="text-xs text-muted-foreground">{c.executionCode}</div>
                )}
                <div className="mt-1 text-xs">
                  {c.taskCount} uppg. · {formatMinutes(c.calculatedWorkMinutes)}
                  {c.precisionLevel && ` · ${PRECISION_LABEL[c.precisionLevel] ?? c.precisionLevel}`}
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
        const color = codeColor(c.executionCode);
        const isSelected = selectedMapIds.has(c.id);
        return (
          <CircleMarker
            key={c.id}
            center={[c.latitude, c.longitude]}
            radius={isSelected ? 11 : 8}
            pathOptions={{
              color: isSelected ? "#1B4B6B" : color.stroke,
              fillColor: isSelected ? "#1B4B6B" : color.stroke,
              fillOpacity: 0.8,
              weight: isSelected ? 3 : 2,
            }}
            eventHandlers={{
              click: () => {
                if (!drawMode) onOpenCluster({ type: "stop", id: c.id });
              },
            }}
          >
            <Popup>
              <div className="text-sm min-w-[140px]">
                <div className="font-semibold">{c.displayName}</div>
                {c.executionCode && (
                  <div className="text-xs text-muted-foreground">{c.executionCode}</div>
                )}
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

function MapLegend({ codes }: { codes: string[] }) {
  const items = codes.length > 0 ? codes : ["(ingen kod)"];
  return (
    <div className="absolute bottom-4 left-4 z-[1000] rounded-lg border border-border bg-card/95 p-2 text-xs shadow-sm backdrop-blur-sm max-w-[160px]">
      <div className="font-medium mb-1 flex items-center gap-1">
        <Info className="h-3 w-3" />
        Utförandekod
      </div>
      {items.slice(0, 8).map((code) => {
        const color = codeColor(code === "(ingen kod)" ? null : code);
        return (
          <div key={code} className="flex items-center gap-1.5 mt-0.5">
            <span
              className="inline-block h-3 w-3 rounded-full border-2"
              style={{ backgroundColor: color.fill, borderColor: color.stroke }}
            />
            <span className="text-muted-foreground truncate">{code}</span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Massåtgärdsrad (karta)
// ============================================================================

function MapMassBar({
  selectedIds,
  type,
  onOpen,
  onClear,
}: {
  selectedIds: string[];
  type: "route" | "stop" | "mixed";
  onOpen: () => void;
  onClear: () => void;
}) {
  if (selectedIds.length === 0) return null;
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2 text-sm"
      data-testid="bar-map-mass-actions"
    >
      <span className="font-medium">
        {selectedIds.length} klumpar i valt område
      </span>
      <Button size="sm" variant="outline" onClick={onOpen} data-testid="button-map-open-first">
        Öppna panel
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear} data-testid="button-map-clear-selection">
        <X className="h-4 w-4" /> Rensa
      </Button>
    </div>
  );
}

// ============================================================================
// Exporterat ClusterMapView
// ============================================================================

export function ClusterMapView({ focusCluster }: { focusCluster?: ClusterRef | null }) {
  const [weekRef, setWeekRef] = useState(() => new Date());
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [executionCodeFilter, setExecutionCodeFilter] = useState<string>("all");
  const [openCluster, setOpenCluster] = useState<ClusterRef | null>(focusCluster ?? null);
  const [drawMode, setDrawMode] = useState(false);
  const [selectionBounds, setSelectionBounds] = useState<[LatLngTuple, LatLngTuple] | null>(null);
  const [selectedMapIds, setSelectedMapIds] = useState<Set<string>>(new Set());

  // Öppna panel automatiskt om ett kluster skickats in utifrån (från hierarki-vy).
  useEffect(() => {
    if (focusCluster != null) {
      setOpenCluster(focusCluster);
    }
  }, [focusCluster]);

  const weekNum = getISOWeek(weekRef);
  const year = getYear(weekRef);

  const routeQuery = useQuery<RouteClusterMapItem[]>({
    queryKey: ["/api/clustering/route-clusters", "map", weekNum, year, statusFilter, executionCodeFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ week: String(weekNum) });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (executionCodeFilter !== "all") params.set("executionCode", executionCodeFilter);
      return (await apiRequest("GET", `/api/clustering/route-clusters?${params}`)).json();
    },
  });

  const stopQuery = useQuery<StopClusterMapItem[]>({
    queryKey: ["/api/clustering/stop-clusters", "map", statusFilter, executionCodeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (executionCodeFilter !== "all") params.set("executionCode", executionCodeFilter);
      return (await apiRequest("GET", `/api/clustering/stop-clusters?${params}`)).json();
    },
  });

  const routeClusters = routeQuery.data ?? [];
  const stopClusters = stopQuery.data ?? [];
  const isLoading = routeQuery.isLoading || stopQuery.isLoading;

  // Collect unique execution codes for legend + filter dropdown
  const allCodes = Array.from(new Set([
    ...routeClusters.map((c) => c.executionCode).filter(Boolean),
    ...stopClusters.map((c) => c.executionCode).filter(Boolean),
  ] as string[]));

  const coordClusters = routeClusters.filter(
    (c) => c.centerLatitude != null && c.centerLongitude != null,
  );
  const defaultCenter: LatLngTuple =
    coordClusters.length > 0
      ? [
          coordClusters.reduce((s, c) => s + c.centerLatitude!, 0) / coordClusters.length,
          coordClusters.reduce((s, c) => s + c.centerLongitude!, 0) / coordClusters.length,
        ]
      : [59.33, 18.07];

  // When selection bounds change, compute which clusters fall inside
  const handleBoundsSelected = useCallback(
    (bounds: [LatLngTuple, LatLngTuple] | null) => {
      setSelectionBounds(bounds);
      if (!bounds) { setSelectedMapIds(new Set()); return; }
      const [[minLat, minLng], [maxLat, maxLng]] = bounds;
      const inBounds = new Set<string>();
      for (const c of routeClusters) {
        if (c.centerLatitude == null || c.centerLongitude == null) continue;
        if (c.centerLatitude >= minLat && c.centerLatitude <= maxLat &&
            c.centerLongitude >= minLng && c.centerLongitude <= maxLng) {
          inBounds.add(c.id);
        }
      }
      for (const c of stopClusters) {
        if (c.latitude == null || c.longitude == null) continue;
        if (c.latitude >= minLat && c.latitude <= maxLat &&
            c.longitude >= minLng && c.longitude <= maxLng) {
          inBounds.add(c.id);
        }
      }
      setSelectedMapIds(inBounds);
    },
    [routeClusters, stopClusters],
  );

  const selectedIdList = Array.from(selectedMapIds);
  const firstSelected: ClusterRef | null = selectedIdList.length > 0
    ? (routeClusters.some((c) => c.id === selectedIdList[0])
        ? { type: "route", id: selectedIdList[0] }
        : { type: "stop", id: selectedIdList[0] })
    : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Kontrollrad */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Vecka:</span>
          <ClusterWeekSlider
            weekRef={weekRef}
            onChange={setWeekRef}
            disabled={routeQuery.isFetching}
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-[130px]" data-testid="select-map-status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla statuser</SelectItem>
              <SelectItem value="active">Aktiva</SelectItem>
              <SelectItem value="confirmed">Bekräftade</SelectItem>
              <SelectItem value="locked">Låsta</SelectItem>
            </SelectContent>
          </Select>
          {allCodes.length > 0 && (
            <Select value={executionCodeFilter} onValueChange={setExecutionCodeFilter}>
              <SelectTrigger className="h-8 w-[140px]" data-testid="select-map-code">
                <SelectValue placeholder="Utförandekod" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla koder</SelectItem>
                {allCodes.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <span className="text-xs text-muted-foreground">
            {routeClusters.length} ruttklumpar · {stopClusters.length} stoppklumpar
          </span>
          <Button
            size="sm"
            variant={drawMode ? "default" : "outline"}
            onClick={() => {
              setDrawMode((v) => !v);
              if (drawMode) { setSelectionBounds(null); setSelectedMapIds(new Set()); }
            }}
            data-testid="button-map-draw-mode"
          >
            <Square className="h-4 w-4" />
            {drawMode ? "Avsluta val" : "Välj område"}
          </Button>
        </div>
      </div>

      {/* Massåtgärd om urval */}
      {selectedIdList.length > 0 && (
        <MapMassBar
          selectedIds={selectedIdList}
          type="mixed"
          onOpen={() => { if (firstSelected) setOpenCluster(firstSelected); }}
          onClear={() => { setSelectionBounds(null); setSelectedMapIds(new Set()); }}
        />
      )}

      {/* Karta */}
      <div
        className={cn(
          "relative rounded-lg border border-border overflow-hidden",
          drawMode && "cursor-crosshair",
        )}
        style={{ height: "520px" }}
        data-testid="container-cluster-map"
      >
        {routeClusters.length === 0 && stopClusters.length === 0 && !isLoading && (
          <div className="absolute inset-0 z-[500] flex flex-col items-center justify-center gap-3 bg-card/80 text-center">
            <span className="text-muted-foreground text-sm">
              Inga klumpar hittades för vald vecka / filter.
            </span>
          </div>
        )}
        <BaseMap
          center={defaultCenter}
          zoom={9}
          style={{ height: "100%", width: "100%" }}
        >
          <MapContent
            routeClusters={routeClusters}
            stopClusters={stopClusters}
            onOpenCluster={setOpenCluster}
            drawMode={drawMode}
            selectionBounds={selectionBounds}
            onBoundsSelected={handleBoundsSelected}
            selectedMapIds={selectedMapIds}
          />
          {(() => {
            if (!focusCluster) return null;
            let target: LatLngTuple | null = null;
            if (focusCluster.type === "route") {
              const rc = routeClusters.find((c) => c.id === focusCluster.id);
              if (rc?.centerLatitude != null && rc.centerLongitude != null) {
                target = [rc.centerLatitude, rc.centerLongitude];
              }
            } else {
              const sc = stopClusters.find((c) => c.id === focusCluster.id);
              if (sc?.latitude != null && sc.longitude != null) {
                target = [sc.latitude, sc.longitude];
              }
            }
            return <MapFlyTo target={target} />;
          })()}
        </BaseMap>
        <MapLegend codes={allCodes} />
      </div>

      <ClusterSidePanel cluster={openCluster} onClose={() => setOpenCluster(null)} />
    </div>
  );
}
