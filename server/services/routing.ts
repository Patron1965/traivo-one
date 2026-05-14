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
import { createHash } from "crypto";
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

// =============================================================================
// Shared TTL+LRU cache for routing-resultat (Task #457)
//
// Tidigare hade `route-optimizer.ts` en lokal 1h-cache enbart för waypoint-
// summeringar. Genom att flytta cachen hit delas träffar mellan webb-planeraren
// (`/api/route-geometry`, `/api/routes/directions`), mobilen
// (`/api/mobile/travel-times`) och VRP-optimeringen — vilket sparar
// Geoapify-kvot och snabbar upp veckoplaneraren. Träff/miss loggas via
// `trackApiUsage` så effekten kan följas i `api_usage_logs`.
// =============================================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const ROUTE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 timme
const ROUTE_CACHE_MAX_SIZE = 500;
const routeCache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | null {
  const entry = routeCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    routeCache.delete(key);
    return null;
  }
  // Förnya LRU-position
  routeCache.delete(key);
  routeCache.set(key, entry);
  return entry.value as T;
}

function cacheSet<T>(key: string, value: T): void {
  if (routeCache.size >= ROUTE_CACHE_MAX_SIZE) {
    const oldestKey = routeCache.keys().next().value;
    if (oldestKey !== undefined) routeCache.delete(oldestKey);
  }
  routeCache.set(key, { value, expiresAt: Date.now() + ROUTE_CACHE_TTL_MS });
}

function waypointsCacheKey(
  waypoints: Waypoint[],
  mode: string,
  details: string | undefined,
  variant: string,
): string {
  // ~11m precision räcker — samma rundning som tidigare lokala cachen.
  const wp = waypoints
    .map((w) => `${w.lat.toFixed(4)},${w.lng.toFixed(4)}`)
    .join("|");
  return `${variant}:${mode}:${details ?? ""}:${wp}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

function plannerCacheKey(body: Record<string, unknown>): string {
  // Stabil nyckelordning så att semantiskt identiska bodies ger samma hash.
  const json = stableStringify(body);
  return `planner:${createHash("sha1").update(json).digest("hex")}`;
}

function logCacheEvent(
  method: string,
  endpoint: string,
  cacheHit: boolean,
  extraMetadata: Record<string, unknown> = {},
): void {
  // Fire-and-forget; trackApiUsage swallow:ar fel internt.
  void trackApiUsage({
    service: "geoapify",
    method,
    endpoint,
    units: 0,
    statusCode: 200,
    durationMs: 0,
    metadata: { cacheHit, ...extraMetadata },
  });
}

/**
 * Test/debug-helper — rensa hela routing-cachen.
 */
export function clearRoutingCache(): void {
  routeCache.clear();
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

  const mode = options.mode ?? "drive";
  const cacheKey = waypointsCacheKey(waypoints, mode, options.details, "routing");
  const cached = cacheGet<any>(cacheKey);
  if (cached !== null) {
    logCacheEvent("routing", "/v1/routing", true);
    return cached;
  }

  const wp = waypoints.map((w) => `${w.lat},${w.lng}`).join("|");
  const params = new URLSearchParams({
    waypoints: wp,
    mode,
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

  void trackApiUsage({
    service: "geoapify",
    method: "routing",
    endpoint: "/v1/routing",
    units: 1,
    statusCode: response.status,
    durationMs: Date.now() - startTime,
    metadata: { cacheHit: false },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("[routing] Geoapify routing error:", response.status, errorText);
    return null;
  }

  const data = await response.json();
  cacheSet(cacheKey, data);
  return data;
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

  const mode = options.mode ?? "drive";
  const cacheKey = waypointsCacheKey(waypoints, mode, options.details, "routing");
  const cached = cacheGet<any>(cacheKey);
  if (cached !== null) {
    logCacheEvent("routing", "/v1/routing", true);
    return { ok: true, data: cached };
  }

  const wp = waypoints.map((w) => `${w.lat},${w.lng}`).join("|");
  const params = new URLSearchParams({
    waypoints: wp,
    mode,
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

  void trackApiUsage({
    service: "geoapify",
    method: "routing",
    endpoint: "/v1/routing",
    units: 1,
    statusCode: response.status,
    durationMs: Date.now() - startTime,
    metadata: { cacheHit: false },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("[routing] Geoapify routing error:", response.status, errorText);
    return { ok: false, status: response.status, error: errorText || "Routing failed" };
  }

  try {
    const data = await response.json();
    cacheSet(cacheKey, data);
    return { ok: true, data };
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

  const requestBody = { mode: body.mode ?? "drive", ...body };
  const cacheKey = plannerCacheKey(requestBody);
  const cached = cacheGet<any>(cacheKey);
  if (cached !== null) {
    logCacheEvent("route-planner", "/v1/routeplanner", true);
    return { ok: true, data: cached };
  }

  const startTime = Date.now();
  let response: Response;
  try {
    response = await fetch(`${GEOAPIFY_ROUTE_PLANNER_URL}?apiKey=${GEOAPIFY_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    console.error("[routing] Geoapify route planner fetch failed:", error);
    return { ok: false, status: 502, error: "Route planner request failed" };
  }

  void trackApiUsage({
    service: "geoapify",
    method: "route-planner",
    endpoint: "/v1/routeplanner",
    units: 1,
    statusCode: response.status,
    durationMs: Date.now() - startTime,
    metadata: { cacheHit: false },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("[routing] Geoapify route planner error:", response.status, errorText);
    return { ok: false, status: response.status, error: errorText || "Route planner failed" };
  }

  const data = await response.json();
  cacheSet(cacheKey, data);
  return { ok: true, data };
}

// =============================================================================
// Map tile config
// =============================================================================

export interface MapTileConfig {
  tileUrl: string;
  attribution: string;
  maxZoom: number;
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
      maxZoom: 20,
    };
  }
  return {
    tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  };
}
