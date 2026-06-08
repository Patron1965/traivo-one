import { useMemo } from "react";
import { Marker, Popup, Polyline } from "react-leaflet";
import { MapPin, Spline } from "lucide-react";
import { BaseMap, MapFitBounds, numberedDivIcon } from "@/components/ui/map";
import { useRouteGeometry } from "@/hooks/useRouteGeometry";

/** En numrerad jobb-pin på dagsrutten. */
export interface RouteMapJob {
  id: string;
  lat: number;
  lng: number;
  /** Visningsnamn i popup. */
  label: string;
  locationName?: string | null;
  /** Förformaterad starttid, t.ex. "08:00". */
  timeLabel?: string | null;
}

/** En inställelse-/återrese-linje (från/till). */
export interface RouteMapCommute {
  id: string;
  positions: [number, number][];
}

/** Löser ett tema-token (HSL-trippel i index.css) till en css-färgsträng. */
function themeColor(varName: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v ? `hsl(${v})` : fallback;
}

const MAP_CENTER_FALLBACK: [number, number] = [62.3908, 17.3069]; // Sundsvall

interface RouteDayMapProps {
  jobs: RouteMapJob[];
  commutes?: RouteMapCommute[];
  selectedJobId?: string | null;
  onSelectJob?: (id: string) => void;
  /** Karthöjd i px. */
  height?: number;
  showLegend?: boolean;
  emptyLabel?: string;
  testId?: string;
}

/**
 * Delad dagsrutt-karta: numrerade jobb-pins, vägbaserad ruttgeometri via
 * `/api/route-geometry` (faller tyst tillbaka på raka linjer) och valfria
 * inställelse-/återrese-linjer. Används av veckoschemat och Dashboard så att
 * kart-/geometrilogiken aldrig dupliceras.
 */
export function RouteDayMap({
  jobs,
  commutes = [],
  selectedJobId = null,
  onSelectJob,
  height = 360,
  showLegend = true,
  emptyLabel = "Inga koordinater för vald dag.",
  testId = "map-day-route",
}: RouteDayMapProps) {
  const jobPoints = useMemo(
    () => jobs.map((t) => [t.lat, t.lng] as [number, number]),
    [jobs],
  );
  const waypoints = useMemo(
    () => jobs.map((t) => ({ lat: t.lat, lng: t.lng })),
    [jobs],
  );

  // Vägbaserad ruttgeometri via den delade hooken. Faller tyst tillbaka på raka
  // linjer (t.ex. om Geoapify-nyckel saknas → 500) med samma kontrakt som alla
  // andra kartvyer.
  const {
    coordinates: routeLine,
    isFallback: usingFallbackRoute,
    hasRoadGeometry: hasGeometry,
  } = useRouteGeometry(waypoints);

  const allPositions = useMemo<[number, number][]>(
    () => [...jobPoints, ...commutes.flatMap((c) => c.positions)],
    [jobPoints, commutes],
  );

  const routeColor = themeColor("--chart-1", "#1B4B6B");
  const estColor = themeColor("--chart-3", "#7DBFB0");
  const commuteColor = themeColor("--chart-4", "#6B7C8C");
  const pinColor = themeColor("--primary", "#1B4B6B");

  if (jobPoints.length === 0 && commutes.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-border bg-muted/20 text-sm text-muted-foreground"
        style={{ height }}
        data-testid={`${testId}-empty`}
      >
        <span className="flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          {emptyLabel}
        </span>
      </div>
    );
  }

  const center = jobPoints[0] ?? allPositions[0] ?? MAP_CENTER_FALLBACK;

  return (
    <div className="space-y-2">
      <div
        className="overflow-hidden rounded-md border border-border"
        style={{ height }}
        data-testid={testId}
      >
        <BaseMap center={center} zoom={11}>
          <MapFitBounds positions={allPositions} />
          {commutes.map((c) => (
            <Polyline
              key={`commute-${c.id}`}
              positions={c.positions}
              pathOptions={{ color: commuteColor, weight: 3, opacity: 0.8, dashArray: "8,6" }}
            />
          ))}
          {routeLine.length > 1 && (
            <Polyline
              positions={routeLine}
              pathOptions={{
                color: hasGeometry ? routeColor : estColor,
                weight: hasGeometry ? 4 : 3,
                opacity: 0.85,
              }}
            />
          )}
          {jobs.map((t, i) => {
            const selected = selectedJobId === t.id;
            const icon = numberedDivIcon({
              number: i + 1,
              color: pinColor,
              size: selected ? 34 : 26,
            });
            return (
              <Marker
                key={t.id}
                position={[t.lat, t.lng]}
                icon={icon}
                eventHandlers={onSelectJob ? { click: () => onSelectJob(t.id) } : undefined}
              >
                <Popup>
                  <div className="space-y-0.5 text-xs">
                    <div className="font-semibold">
                      {i + 1}. {t.label}
                    </div>
                    {t.locationName && <div className="text-muted-foreground">{t.locationName}</div>}
                    {t.timeLabel && <div className="tabular-nums">{t.timeLabel}</div>}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </BaseMap>
      </div>
      {usingFallbackRoute && (
        <div
          className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning"
          role="status"
          data-testid={`${testId}-fallback-indicator`}
        >
          <Spline className="h-3.5 w-3.5 shrink-0" />
          <span>Ungefärlig rutt (vägdata ej tillgänglig) — avstånd och restid är uppskattade fågelvägslinjer.</span>
        </div>
      )}
      {showLegend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid={`${testId}-legend`}>
          <span className="flex items-center gap-1.5">
            <span className={`h-0.5 w-5 rounded-full ${usingFallbackRoute ? "bg-chart-3" : "bg-chart-1"}`} />
            {usingFallbackRoute ? "Rutt (ungefärlig)" : "Rutt (planerad)"}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 rounded-full bg-chart-3" />
            Restid mellan jobb
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-5 border-t-2 border-dashed border-chart-4" />
            Inställelse / återresa
          </span>
        </div>
      )}
    </div>
  );
}
