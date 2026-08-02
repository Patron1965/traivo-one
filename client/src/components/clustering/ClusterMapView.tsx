/**
 * Kartvy — aktiv kartvy med planerarläge och utförarläge (Task #1286).
 * Planerarläge: ruttklumpar som cirklar + stoppklumpar som punktmarkörer,
 *   rektangelurval, snabbtilldelning till team+vecka, veckotidslinje.
 * Utförarläge: dagstidslinje, dagsuppgifter per team, markerade klumpar,
 *   markerade klumpar lysmarkerade för vald dag.
 */
import { useState, useCallback, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Circle, CircleMarker, Popup, Rectangle, useMapEvents, useMap } from "react-leaflet";
import type * as L from "leaflet";
import {
  CalendarDays,
  Loader2,
  Info,
  Route as RouteIcon,
  Square,
  Users,
  X,
} from "lucide-react";
import { getISOWeek, getYear, format } from "date-fns";
import { sv as svLocale } from "date-fns/locale";
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
import { Badge } from "@/components/ui/badge";
import { ClusterWeekSlider } from "./ClusterWeekSlider";
import { ClusterSidePanel, type ClusterRef } from "./ClusterSidePanel";
import { TeamLiveMarkers, TeamDayPanel, useTeamLivePositions, useTeamTrails, TeamTrailPolylines } from "./TeamLiveLayer";
import { MapTimeline } from "./MapTimeline";
import { RapidAssignDialog } from "./RapidAssignDialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import type { Team } from "@shared/schema";
import type { GridResponse } from "@/lib/rough-planning";

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

/**
 * Härleder Leaflet path-options baserat på klump-status och urval.
 * Status-visuell kodning:
 *   auto      → normal fyllt (baspalett)
 *   confirmed → kraftigare kant, lägre fyllning (utfärdad/bekräftad)
 *   locked    → tjock kant, hög fyllning (låst/skyddad)
 *   field     → markerad för utförarläge (teal highlight)
 *   selected  → kartmarkeringsfärg (djupblå)
 */
function clusterRoutePathOptions(
  executionCode: string | null,
  status: string,
  isSelected: boolean,
  isFieldMatch: boolean,
): {
  color: string;
  fillColor: string;
  fillOpacity: number;
  weight: number;
} {
  const base = codeColor(executionCode);
  if (isSelected) {
    return { color: "#1B4B6B", fillColor: "#1B4B6B44", fillOpacity: 0.45, weight: 3 };
  }
  if (isFieldMatch) {
    return { color: "#4A9B9B", fillColor: "#4A9B9B55", fillOpacity: 0.6, weight: 3 };
  }
  switch (status) {
    case "confirmed":
      return { color: base.stroke, fillColor: base.fill, fillOpacity: 0.2, weight: 2.5 };
    case "locked":
      return { color: base.stroke, fillColor: base.stroke + "99", fillOpacity: 0.55, weight: 3.5 };
    default:
      return { color: base.stroke, fillColor: base.fill, fillOpacity: 0.35, weight: 2 };
  }
}

function clusterStopPathOptions(
  executionCode: string | null,
  status: string,
  isSelected: boolean,
  isFieldMatch: boolean,
): {
  color: string;
  fillColor: string;
  fillOpacity: number;
  weight: number;
} {
  const base = codeColor(executionCode);
  if (isSelected) {
    return { color: "#1B4B6B", fillColor: "#1B4B6B", fillOpacity: 0.9, weight: 3 };
  }
  if (isFieldMatch) {
    return { color: "#4A9B9B", fillColor: "#4A9B9B", fillOpacity: 0.9, weight: 3 };
  }
  switch (status) {
    case "confirmed":
      return { color: base.stroke, fillColor: base.stroke, fillOpacity: 0.4, weight: 2.5 };
    case "locked":
      return { color: base.stroke, fillColor: base.stroke, fillOpacity: 1.0, weight: 3.5 };
    default:
      return { color: base.stroke, fillColor: base.stroke, fillOpacity: 0.8, weight: 2 };
  }
}

const PRECISION_LABEL: Record<string, string> = {
  high: "Hög",
  medium: "Medel",
  low: "Låg",
};

const STATUS_LABEL: Record<string, string> = {
  auto: "Auto",
  confirmed: "Bekräftad",
  locked: "Låst",
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
  fieldRouteClusterIds,
  fieldStopClusterIds,
  isFieldMode,
}: {
  routeClusters: RouteClusterMapItem[];
  stopClusters: StopClusterMapItem[];
  onOpenCluster: (ref: ClusterRef) => void;
  drawMode: boolean;
  selectionBounds: [LatLngTuple, LatLngTuple] | null;
  onBoundsSelected: (bounds: [LatLngTuple, LatLngTuple] | null) => void;
  selectedMapIds: Set<string>;
  fieldRouteClusterIds: Set<string>;
  fieldStopClusterIds: Set<string>;
  isFieldMode: boolean;
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
        const isSelected = selectedMapIds.has(c.id);
        const isFieldMatch = fieldRouteClusterIds.has(c.id);
        const pathOptions = clusterRoutePathOptions(c.executionCode, c.status, isSelected, isFieldMatch);
        const radiusM = (c.radiusKilometers ?? 40) * 1000;
        const dimmed = isFieldMode && !isFieldMatch && !isSelected;
        return (
          <Circle
            key={c.id}
            center={[c.centerLatitude, c.centerLongitude]}
            radius={radiusM}
            pathOptions={{
              ...pathOptions,
              fillOpacity: dimmed ? pathOptions.fillOpacity * 0.25 : pathOptions.fillOpacity,
              opacity: dimmed ? 0.3 : 1,
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
                <div className="flex items-center gap-1 mt-0.5">
                  {c.executionCode && (
                    <span className="text-xs text-muted-foreground">{c.executionCode}</span>
                  )}
                  {c.status !== "auto" && (
                    <span className="text-xs text-muted-foreground">
                      · {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  )}
                </div>
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
        const isSelected = selectedMapIds.has(c.id);
        const isFieldMatch = fieldStopClusterIds.has(c.id);
        const pathOptions = clusterStopPathOptions(c.executionCode, c.status, isSelected, isFieldMatch);
        const radius = isSelected ? 11 : isFieldMatch ? 10 : 8;
        const dimmed = isFieldMode && !isFieldMatch && !isSelected;
        return (
          <CircleMarker
            key={c.id}
            center={[c.latitude, c.longitude]}
            radius={radius}
            pathOptions={{
              ...pathOptions,
              fillOpacity: dimmed ? pathOptions.fillOpacity * 0.2 : pathOptions.fillOpacity,
              opacity: dimmed ? 0.3 : 1,
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
                <div className="flex items-center gap-1 mt-0.5">
                  {c.executionCode && (
                    <span className="text-xs text-muted-foreground">{c.executionCode}</span>
                  )}
                  {c.status !== "auto" && (
                    <span className="text-xs text-muted-foreground">
                      · {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{c.memberCount} uppg.</div>
                {isFieldMatch && (
                  <div className="text-xs font-medium" style={{ color: "#4A9B9B" }}>
                    Schemalagd idag
                  </div>
                )}
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

function MapLegend({ codes, mapMode }: { codes: string[]; mapMode: "planera" | "utfor" }) {
  const items = codes.length > 0 ? codes : ["(ingen kod)"];
  return (
    <div className="absolute bottom-4 left-4 z-[1000] rounded-lg border border-border bg-card/95 p-2 text-xs shadow-sm backdrop-blur-sm max-w-[160px]">
      <div className="font-medium mb-1 flex items-center gap-1">
        <Info className="h-3 w-3" />
        Utförandekod
      </div>
      {items.slice(0, 6).map((code) => {
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
      {mapMode === "utfor" && (
        <div className="mt-1.5 pt-1 border-t border-border flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-full border-2"
            style={{ backgroundColor: "#4A9B9B55", borderColor: "#4A9B9B" }}
          />
          <span className="text-muted-foreground">Dagsuppgift</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Massåtgärdsrad (karta)
// ============================================================================

function MapMassBar({
  selectedIds,
  onOpen,
  onClear,
  onAssign,
  mapMode,
}: {
  selectedIds: string[];
  onOpen: () => void;
  onClear: () => void;
  onAssign: () => void;
  mapMode: "planera" | "utfor";
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
      {mapMode === "planera" && (
        <Button
          size="sm"
          variant="default"
          onClick={onAssign}
          data-testid="button-map-assign"
        >
          <Users className="h-3.5 w-3.5" />
          Tilldela
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onClear} data-testid="button-map-clear-selection">
        <X className="h-4 w-4" /> Rensa
      </Button>
    </div>
  );
}

// ============================================================================
// Lägestoggle (Planera / Utför)
// ============================================================================

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "planera" | "utfor";
  onChange: (m: "planera" | "utfor") => void;
}) {
  return (
    <div
      className="flex rounded-lg border border-border bg-muted p-0.5 gap-0.5"
      data-testid="toggle-map-mode"
    >
      <Button
        size="sm"
        variant={mode === "planera" ? "default" : "ghost"}
        className="h-7 px-3 text-xs"
        onClick={() => onChange("planera")}
        data-testid="button-map-mode-planera"
      >
        <CalendarDays className="h-3.5 w-3.5" />
        Planera
      </Button>
      <Button
        size="sm"
        variant={mode === "utfor" ? "default" : "ghost"}
        className="h-7 px-3 text-xs"
        onClick={() => onChange("utfor")}
        data-testid="button-map-mode-utfor"
      >
        <Users className="h-3.5 w-3.5" />
        Utför
      </Button>
    </div>
  );
}

// ============================================================================
// Exporterat ClusterMapView
// ============================================================================

interface ClusterMapViewProps {
  focusCluster?: ClusterRef | null;
  /** Delad vecko-/dagkälla (lyft till GrovplaneringPage, Task: synk karta ↔ rutnät). */
  weekRef: Date;
  onWeekChange: (d: Date) => void;
  selectedDay: Date;
  onDayChange: (d: Date) => void;
}

export function ClusterMapView({
  focusCluster,
  weekRef,
  onWeekChange: setWeekRef,
  selectedDay,
  onDayChange: setSelectedDay,
}: ClusterMapViewProps) {
  const { user: currentUser } = useAuth() as { user?: { role?: string | null } };
  const isPlanner = ["owner", "admin", "planner"].includes(currentUser?.role ?? "");
  const [mapMode, setMapMode] = useState<"planera" | "utfor">(() => {
    try {
      return (localStorage.getItem("grovplanering.mapMode") as "planera" | "utfor") ?? (isPlanner ? "planera" : "utfor");
    } catch {
      return isPlanner ? "planera" : "utfor";
    }
  });
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [executionCodeFilter, setExecutionCodeFilter] = useState<string>("all");
  const [fieldTeamId, setFieldTeamId] = useState<string>("all");
  const [openCluster, setOpenCluster] = useState<ClusterRef | null>(focusCluster ?? null);
  const [drawMode, setDrawMode] = useState(false);
  const [selectionBounds, setSelectionBounds] = useState<[LatLngTuple, LatLngTuple] | null>(null);
  const [selectedMapIds, setSelectedMapIds] = useState<Set<string>>(new Set());
  const [rapidAssignOpen, setRapidAssignOpen] = useState(false);
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  // Task #1298: toggle för dagens färdväg (breadcrumb-spår) per team
  const [showTrails, setShowTrails] = useState(false);

  const handleModeChange = (m: "planera" | "utfor") => {
    setMapMode(m);
    try { localStorage.setItem("grovplanering.mapMode", m); } catch { /* ignore */ }
    setSelectedMapIds(new Set());
    setSelectionBounds(null);
    setDrawMode(false);
  };

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

  const teamsQuery = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  const teams = teamsQuery.data ?? [];
  const routeClusters = routeQuery.data ?? [];
  const stopClusters = stopQuery.data ?? [];
  const isLoading = routeQuery.isLoading || stopQuery.isLoading;

  // Utförarläge: hämta dagsuppgifter för valt team + dag
  const dayStr = format(selectedDay, "yyyy-MM-dd");
  const { data: dayGridData, isFetching: dayGridFetching } = useQuery<GridResponse>({
    queryKey: ["/api/rough-planning/grid", "utfor-day", dayStr, fieldTeamId],
    queryFn: async () => {
      const p = new URLSearchParams({ groupBy: "ingen", limit: "200", offset: "0", from: dayStr, to: dayStr });
      if (fieldTeamId !== "all") p.set("teamIds", fieldTeamId);
      return (await apiRequest("GET", `/api/rough-planning/grid?${p}`)).json();
    },
    enabled: mapMode === "utfor",
  });

  // Task #1292: live-positioner per team (WebSocket, ingen polling)
  const liveTeams = useTeamLivePositions(mapMode === "utfor");

  // Task #1298: dagens färdväg per team (hämtas bara när toggeln är på;
  // nytt datum ⇒ ny query-nyckel ⇒ linjen rensas automatiskt vid dagbyte)
  const trailsQuery = useTeamTrails(mapMode === "utfor" && showTrails, dayStr);
  const teamTrails = useMemo(() => {
    const all = trailsQuery.data ?? [];
    return fieldTeamId === "all" ? all : all.filter((t) => t.teamId === fieldTeamId);
  }, [trailsQuery.data, fieldTeamId]);
  const openTeam = openTeamId
    ? liveTeams.find((t) => t.teamId === openTeamId) ?? null
    : null;

  const fieldTasks = useMemo(
    () => (dayGridData?.groups ?? []).flatMap((g) => g.tasks),
    [dayGridData],
  );

  const fieldStopClusterIds = useMemo(
    () => new Set(fieldTasks.map((t) => t.stopClusterId).filter(Boolean) as string[]),
    [fieldTasks],
  );

  const fieldRouteClusterIds = useMemo(
    () => new Set(fieldTasks.map((t) => t.routeClusterId).filter(Boolean) as string[]),
    [fieldTasks],
  );

  const allCodes = Array.from(
    new Set([
      ...routeClusters.map((c) => c.executionCode).filter(Boolean),
      ...stopClusters.map((c) => c.executionCode).filter(Boolean),
    ] as string[]),
  );

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

  const selectedRouteClusterIds = selectedIdList.filter((id) =>
    routeClusters.some((c) => c.id === id),
  );
  const selectedStopClusterIds = selectedIdList.filter((id) =>
    stopClusters.some((c) => c.id === id),
  );
  const estimatedTasks =
    routeClusters.filter((c) => selectedRouteClusterIds.includes(c.id)).reduce((s, c) => s + c.taskCount, 0) +
    stopClusters.filter((c) => selectedStopClusterIds.includes(c.id)).reduce((s, c) => s + c.memberCount, 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Kontrollrad */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Lägestoggle */}
          <ModeToggle mode={mapMode} onChange={handleModeChange} />

          {/* Veckoväljare — visas alltid */}
          <span className="text-sm text-muted-foreground">Vecka:</span>
          <ClusterWeekSlider
            weekRef={weekRef}
            onChange={(d) => { setWeekRef(d); }}
            disabled={routeQuery.isFetching}
          />

          {/* Utförarläge: teamväljare */}
          {mapMode === "utfor" && teams.length > 0 && (
            <Select value={fieldTeamId} onValueChange={setFieldTeamId}>
              <SelectTrigger className="h-8 w-[150px]" data-testid="select-field-team">
                <SelectValue placeholder="Alla team" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla team</SelectItem>
                {teams
                  .filter((t) => t.status === "active")
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: t.color ?? undefined }}
                        />
                        {t.name}
                      </span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}

          {/* Utförarläge: toggle för dagens färdväg (Task #1298) */}
          {mapMode === "utfor" && (
            <Button
              size="sm"
              variant={showTrails ? "default" : "outline"}
              onClick={() => setShowTrails((v) => !v)}
              data-testid="button-toggle-team-trails"
            >
              <RouteIcon className="h-4 w-4" />
              Färdväg
              {showTrails && trailsQuery.isFetching && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
            </Button>
          )}

          {/* Planerarläge: statusfilter */}
          {mapMode === "planera" && (
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
          )}

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
          {(isLoading || dayGridFetching) && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground">
            {routeClusters.length} ruttförslag · {stopClusters.length} stoppklumpar
          </span>
          {mapMode === "planera" && (
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
          )}
        </div>
      </div>

      {/* Utförarläge: dagöversikt */}
      {mapMode === "utfor" && (
        <div
          className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm"
          data-testid="bar-field-day-summary"
        >
          <span className="text-muted-foreground text-xs capitalize">
            {format(selectedDay, "EEEE d MMMM", { locale: svLocale })}
          </span>
          <Badge variant="secondary" data-testid="badge-field-task-count">
            {fieldTasks.length} uppgifter
          </Badge>
          {fieldStopClusterIds.size > 0 && (
            <Badge variant="outline" style={{ color: "#4A9B9B", borderColor: "#4A9B9B" }}>
              {fieldStopClusterIds.size} stopp
            </Badge>
          )}
          {fieldTasks.length === 0 && !dayGridFetching && (
            <span className="text-muted-foreground text-xs">Inga schemalagda uppgifter för vald dag.</span>
          )}
        </div>
      )}

      {/* Massåtgärd om urval */}
      {selectedIdList.length > 0 && (
        <MapMassBar
          selectedIds={selectedIdList}
          mapMode={mapMode}
          onOpen={() => { if (firstSelected) setOpenCluster(firstSelected); }}
          onClear={() => { setSelectionBounds(null); setSelectedMapIds(new Set()); }}
          onAssign={() => setRapidAssignOpen(true)}
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
            fieldRouteClusterIds={fieldRouteClusterIds}
            fieldStopClusterIds={fieldStopClusterIds}
            isFieldMode={mapMode === "utfor"}
          />
          {mapMode === "utfor" && showTrails && (
            <TeamTrailPolylines trails={teamTrails} />
          )}
          {mapMode === "utfor" && (
            <TeamLiveMarkers
              teams={
                fieldTeamId === "all"
                  ? liveTeams
                  : liveTeams.filter((t) => t.teamId === fieldTeamId)
              }
              onOpenTeam={setOpenTeamId}
            />
          )}
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
        <MapLegend codes={allCodes} mapMode={mapMode} />

        {/* Tidslinje overlay */}
        <MapTimeline
          mode={mapMode}
          weekRef={weekRef}
          onWeekChange={setWeekRef}
          selectedDay={selectedDay}
          onDayChange={(d) => {
            setSelectedDay(d);
            setWeekRef(d);
          }}
        />
      </div>

      <ClusterSidePanel cluster={openCluster} onClose={() => setOpenCluster(null)} />

      {/* Task #1292: teamets dagschema vid klick på live-markör */}
      <TeamDayPanel team={openTeam} day={selectedDay} onClose={() => setOpenTeamId(null)} />

      {/* Snabbtilldela klumpar */}
      <RapidAssignDialog
        open={rapidAssignOpen}
        onOpenChange={setRapidAssignOpen}
        routeClusterIds={selectedRouteClusterIds}
        stopClusterIds={selectedStopClusterIds}
        estimatedTasks={estimatedTasks}
        teams={teams}
        weekRef={weekRef}
      />
    </div>
  );
}
