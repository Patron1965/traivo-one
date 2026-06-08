import { useQueries, useQuery } from "@tanstack/react-query";

/**
 * Delad ruttgeometri-hämtning för alla kartvyer.
 *
 * Tidigare hämtade fyra kartvyer (RouteDayMap, RouteMapView, OptimizedRouteMap,
 * MonitorPopoutPage) `/api/route-geometry` och hanterade fallback till raka
 * fågelvägslinjer var för sig — med subtilt olika logik (en vy saknade t.o.m.
 * fallback helt). Den här hooken centraliserar kontraktet så att alla kartor
 * beter sig lika: fetch + cache + fallback-beslut på ett ställe.
 *
 * Fallback = vi försökte hämta vägbaserad geometri (>= 2 waypoints) men fick
 * ingen tillbaka (t.ex. saknad Geoapify-nyckel → 500, routing-tjänst nere →
 * 502). Då ritas raka linjer mellan stoppen i stället för en tom karta, och
 * `isFallback` signalerar att rutten är ungefärlig så vyn kan visa en indikator.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteGeometryResult {
  /** Polylinjen att rita: vägbaserad geometri om den finns, annars raka linjer. */
  coordinates: [number, number][];
  /** Sant när vi ritar raka fallback-linjer (försökte men fick ingen vägdata). */
  isFallback: boolean;
  /** Sant medan geometri-anropet pågår. */
  isLoading: boolean;
  /** Sant endast när riktig vägbaserad geometri används (för linjestil). */
  hasRoadGeometry: boolean;
}

export interface RouteGeometryInput {
  /** Stabil nyckel per rutt (t.ex. resource-id eller "legacy"). */
  id: string;
  waypoints: LatLng[];
}

export interface RouteGeometriesResult {
  /** Resultat per rutt-id. */
  byId: Map<string, RouteGeometryResult>;
  /** Sant medan minst en rutt fortfarande hämtas. */
  isLoading: boolean;
  /** Sant när minst en rutt föll tillbaka på raka linjer. */
  isFallback: boolean;
}

const ROUTE_GEOMETRY_STALE_TIME = 5 * 60 * 1000;
const MAX_WAYPOINTS = 25;

/** Routing behöver minst två punkter för att ge en väg. */
function isRoutable(waypoints: LatLng[]): boolean {
  return waypoints.length >= 2;
}

/** Stabil cache-nyckel av koordinaterna (ordningen spelar roll för rutten). */
function geometryKey(waypoints: LatLng[]): string {
  return waypoints
    .map((w) => `${w.lat.toFixed(5)},${w.lng.toFixed(5)}`)
    .join("|");
}

/**
 * Hämtar vägbaserad geometri från servern. Returnerar [] vid alla fel
 * (HTTP-fel, nätverksfel, tomt svar) så att anroparen kan falla tillbaka på
 * raka linjer utan att skilja på felorsaker.
 */
async function fetchRoadGeometry(
  waypoints: LatLng[],
): Promise<[number, number][]> {
  try {
    const response = await fetch("/api/route-geometry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        waypoints: waypoints
          .slice(0, MAX_WAYPOINTS)
          .map((w) => ({ lat: w.lat, lng: w.lng })),
      }),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data?.coordinates as [number, number][]) ?? [];
  } catch {
    return [];
  }
}

/** Bygger det enhetliga resultatet från råa waypoints + ev. vägdata. */
function buildResult(
  waypoints: LatLng[],
  road: [number, number][],
  isLoading: boolean,
): RouteGeometryResult {
  const straightLine = waypoints.map((w) => [w.lat, w.lng] as [number, number]);
  const hasRoadGeometry = road.length > 1;
  const coordinates = hasRoadGeometry ? road : straightLine;
  const isFallback = isRoutable(waypoints) && !hasRoadGeometry && !isLoading;
  return { coordinates, isFallback, isLoading, hasRoadGeometry };
}

/** Hämtar vägbaserad ruttgeometri för EN rutt med raklinjs-fallback. */
export function useRouteGeometry(waypoints: LatLng[]): RouteGeometryResult {
  const attempted = isRoutable(waypoints);
  const { data = [], isLoading } = useQuery<[number, number][]>({
    queryKey: ["/api/route-geometry", geometryKey(waypoints)],
    enabled: attempted,
    retry: false,
    staleTime: ROUTE_GEOMETRY_STALE_TIME,
    queryFn: () => fetchRoadGeometry(waypoints),
  });
  return buildResult(waypoints, data, attempted && isLoading);
}

/**
 * Hämtar vägbaserad ruttgeometri för FLERA rutter samtidigt (t.ex. en per
 * resurs/fordon) med samma fallback-kontrakt som `useRouteGeometry`.
 */
export function useRouteGeometries(
  routes: RouteGeometryInput[],
): RouteGeometriesResult {
  const results = useQueries({
    queries: routes.map((route) => ({
      queryKey: ["/api/route-geometry", geometryKey(route.waypoints)],
      enabled: isRoutable(route.waypoints),
      retry: false,
      staleTime: ROUTE_GEOMETRY_STALE_TIME,
      queryFn: () => fetchRoadGeometry(route.waypoints),
    })),
  });

  const byId = new Map<string, RouteGeometryResult>();
  let isLoading = false;
  let isFallback = false;

  routes.forEach((route, index) => {
    const query = results[index];
    const attempted = isRoutable(route.waypoints);
    const loading = attempted && query.isLoading;
    const result = buildResult(
      route.waypoints,
      (query.data as [number, number][] | undefined) ?? [],
      loading,
    );
    byId.set(route.id, result);
    if (result.isLoading) isLoading = true;
    if (result.isFallback) isFallback = true;
  });

  return { byId, isLoading, isFallback };
}
