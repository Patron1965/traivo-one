/**
 * Unified Geoapify routing + map-tile service.
 *
 * All Geoapify Routing- och Route Planner-anrop, samt all generering av
 * kart-tile-URL:er, ska gå genom denna modul. Detta är systerfilen till
 * `server/services/geocoding.ts` och har samma syfte: en gemensam plats för
 * retry/cache/fail-safe-mönster, API-key-hantering och kostnadsspårning.
 *
 * Ad-hoc `fetch("https://api.geoapify.com/v1/routing...")` eller
 * `https://maps.geoapify.com/v1/tile/...` i route-handlers ska ersättas av
 * helpers härifrån (jfr Task #449 för geokodningens motsvarande konsolidering).
 */
import { trackApiUsage } from "../api-usage-tracker";

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;
const GEOAPIFY_ROUTING_URL = "https://api.geoapify.com/v1/routing";
export const GEOAPIFY_ROUTE_PLANNER_URL = "https://api.geoapify.com/v1/routeplanner";

export interface Waypoint {
  lat: number;
  lng: number;
}

export interface RoutingFetchOptions {
  mode?: string;
  details?: string;
}

export function isGeoapifyRoutingAvailable(): boolean {
  return !!GEOAPIFY_API_KEY;
}

/**
 * Lågnivå-anrop till Geoapify Routing API. Returnerar rå GeoJSON eller `null`
 * om API-nyckel saknas, för få waypoints eller om anropet misslyckas.
 * Kostnadsspårning sker via `trackApiUsage`.
 */
export async function fetchGeoapifyRoute(
  waypoints: Waypoint[],
  options: RoutingFetchOptions = {},
): Promise<any | null> {
  if (!GEOAPIFY_API_KEY || waypoints.length < 2) {
    return null;
  }

  const wp = waypoints.map((w) => `${w.lat},${w.lng}`).join("|");
  const params = new URLSearchParams({
    waypoints: wp,
    mode: options.mode ?? "drive",
    apiKey: GEOAPIFY_API_KEY,
  });
  if (options.details) {
    params.set("details", options.details);
  }

  const startTime = Date.now();
  let response: Response;
  try {
    response = await fetch(`${GEOAPIFY_ROUTING_URL}?${params.toString()}`);
  } catch (error) {
    console.error("[routing] Geoapify routing fetch failed:", error);
    return null;
  }

  trackApiUsage({
    service: "geoapify",
    method: "routing",
    endpoint: "/v1/routing",
    units: 1,
    statusCode: response.status,
    durationMs: Date.now() - startTime,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("[routing] Geoapify routing error:", response.status, errorText);
    return null;
  }

  return await response.json();
}

export interface RouteSummary {
  distanceKm: number;
  durationMinutes: number;
}

/**
 * Hämtar enkel summering (km + minuter) för en rutt mellan waypoints.
 */
export async function getRouteSummary(waypoints: Waypoint[]): Promise<RouteSummary | null> {
  const data = await fetchGeoapifyRoute(waypoints);
  const props = data?.features?.[0]?.properties;
  if (!props || props.distance == null || props.time == null) {
    return null;
  }
  return {
    distanceKm: props.distance / 1000,
    durationMinutes: props.time / 60,
  };
}

/**
 * Hämtar polyline-koordinater (lat/lng-par) för en rutt. Användbart för
 * frontend-rendering av rutten på kartan.
 */
export async function getRouteGeometry(
  waypoints: Waypoint[],
): Promise<{ coordinates: [number, number][] } | null> {
  const data = await fetchGeoapifyRoute(waypoints, { details: "route_details" });
  if (!data) return null;
  const geometry = data?.features?.[0]?.geometry;
  if (!geometry) return { coordinates: [] };

  let coords: [number, number][] = [];
  if (geometry.type === "MultiLineString") {
    coords = geometry.coordinates.flatMap((line: number[][]) =>
      line.map((c: number[]) => [c[1], c[0]] as [number, number]),
    );
  } else if (geometry.type === "LineString") {
    coords = geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]);
  }
  return { coordinates: coords };
}

export type RouteFetchResult =
  | { ok: true; data: any }
  | { ok: false; status: number; error: string };

/**
 * Strukturerad variant av `fetchGeoapifyRoute` som bevarar HTTP-statuskod.
 * Används av call-sites som tidigare forwardade Geoapifys statuskod till
 * klienten (t.ex. `POST /api/routes/directions`).
 */
export async function fetchGeoapifyRouteWithStatus(
  waypoints: Waypoint[],
  options: RoutingFetchOptions = {},
): Promise<RouteFetchResult> {
  if (!GEOAPIFY_API_KEY) {
    return { ok: false, status: 500, error: "Geoapify API-nyckel saknas" };
  }
  if (waypoints.length < 2) {
    return { ok: false, status: 400, error: "Minst 2 waypoints krävs" };
  }

  const wp = waypoints.map((w) => `${w.lat},${w.lng}`).join("|");
  const params = new URLSearchParams({
    waypoints: wp,
    mode: options.mode ?? "drive",
    apiKey: GEOAPIFY_API_KEY,
  });
  if (options.details) params.set("details", options.details);

  const startTime = Date.now();
  let response: Response;
  try {
    response = await fetch(`${GEOAPIFY_ROUTING_URL}?${params.toString()}`);
  } catch (error) {
    console.error("[routing] Geoapify routing fetch failed:", error);
    return { ok: false, status: 502, error: "Routing request failed" };
  }

  trackApiUsage({
    service: "geoapify",
    method: "routing",
    endpoint: "/v1/routing",
    units: 1,
    statusCode: response.status,
    durationMs: Date.now() - startTime,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("[routing] Geoapify routing error:", response.status, errorText);
    return { ok: false, status: response.status, error: errorText || "Routing failed" };
  }

  try {
    return { ok: true, data: await response.json() };
  } catch (error) {
    console.error("[routing] Geoapify routing JSON parse failed:", error);
    return { ok: false, status: 502, error: "Invalid routing response" };
  }
}

export type RoutePlannerResult = RouteFetchResult;

/**
 * Anrop till Geoapify Route Planner API (VRP). Returnerar typad
 * resultatdiscriminator för att kalla-kod ska kunna mappa fel till HTTP-status.
 */
export async function callRoutePlanner(body: {
  jobs: unknown;
  agents: unknown;
  mode?: string;
  [key: string]: unknown;
}): Promise<RoutePlannerResult> {
  if (!GEOAPIFY_API_KEY) {
    return { ok: false, status: 500, error: "Geoapify API-nyckel saknas" };
  }

  const startTime = Date.now();
  let response: Response;
  try {
    response = await fetch(`${GEOAPIFY_ROUTE_PLANNER_URL}?apiKey=${GEOAPIFY_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: body.mode ?? "drive", ...body }),
    });
  } catch (error) {
    console.error("[routing] Geoapify route planner fetch failed:", error);
    return { ok: false, status: 502, error: "Route planner request failed" };
  }

  trackApiUsage({
    service: "geoapify",
    method: "route-planner",
    endpoint: "/v1/routeplanner",
    units: 1,
    statusCode: response.status,
    durationMs: Date.now() - startTime,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("[routing] Geoapify route planner error:", response.status, errorText);
    return { ok: false, status: response.status, error: errorText || "Route planner failed" };
  }

  return { ok: true, data: await response.json() };
}

// =============================================================================
// Map tile config
// =============================================================================

export interface MapTileConfig {
  tileUrl: string;
  attribution: string;
}

/**
 * Returnerar tile-URL och attribution för Leaflet/MapLibre. När
 * GEOAPIFY_API_KEY finns används Geoapifys osm-bright-tiles, annars OSM som
 * fallback. Ska användas av alla server-routes som exponerar kart-config till
 * klienten (t.ex. `/api/system/map-config`).
 */
export function getMapTileConfig(): MapTileConfig {
  if (GEOAPIFY_API_KEY) {
    return {
      tileUrl: `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${GEOAPIFY_API_KEY}`,
      attribution:
        '&copy; <a href="https://www.geoapify.com/">Geoapify</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    };
  }
  return {
    tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  };
}
