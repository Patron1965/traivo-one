/**
 * OSRM (Open Source Routing Machine) Client
 *
 * Provides real road-network distances and durations via OSRM's Table API
 * (batch N×N) and Route API (single pair with geometry).
 *
 * Fallback chain: OSRM → Geoapify → Haversine
 * Configured via environment variables:
 *   OSRM_BASE_URL  – Base URL of the OSRM instance (default: public demo)
 *   OSRM_TIMEOUT   – Request timeout in ms (default: 10 000)
 *   OSRM_PROFILE   – Routing profile (default: "driving")
 *   OSRM_ENABLED   – Set to "false" to disable OSRM entirely
 */

const OSRM_BASE_URL = (process.env.OSRM_BASE_URL || "https://router.project-osrm.org").replace(/\/$/, "");
const OSRM_TIMEOUT = parseInt(process.env.OSRM_TIMEOUT || "10000", 10);
const OSRM_PROFILE = process.env.OSRM_PROFILE || "driving";
const OSRM_ENABLED = (process.env.OSRM_ENABLED ?? "true") !== "false";

const MAX_TABLE_COORDS = 100;
const MAX_CHUNK_SIZE = 50;

export interface OSRMTableResult {
  durations: number[][];
  distances: number[][];
  sources: Array<{ location: [number, number] }>;
  destinations: Array<{ location: [number, number] }>;
}

export interface OSRMRouteResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry?: string;
}

let _available: boolean | null = null;
let _lastCheck = 0;
const CHECK_INTERVAL = 60_000;
let _consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

export function isOSRMEnabled(): boolean {
  return OSRM_ENABLED;
}

export async function isOSRMAvailable(): Promise<boolean> {
  if (!OSRM_ENABLED) return false;

  if (_consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    const backoff = Math.min(_consecutiveFailures * 30_000, 300_000);
    if (Date.now() - _lastCheck < backoff) return false;
  }

  if (_available !== null && Date.now() - _lastCheck < CHECK_INTERVAL) {
    return _available;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${OSRM_BASE_URL}/nearest/v1/${OSRM_PROFILE}/18.07,59.33?number=1`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    _available = res.ok;
    if (_available) _consecutiveFailures = 0;
    else _consecutiveFailures++;
  } catch {
    _available = false;
    _consecutiveFailures++;
  }
  _lastCheck = Date.now();
  return _available;
}

export async function osrmTable(
  coordinates: Array<{ lat: number; lng: number }>,
): Promise<OSRMTableResult | null> {
  if (!OSRM_ENABLED || coordinates.length < 2) return null;

  if (coordinates.length > MAX_TABLE_COORDS) {
    console.warn(`[OSRM] Table request has ${coordinates.length} coords, exceeding limit of ${MAX_TABLE_COORDS}. Splitting.`);
    return osrmTableChunked(coordinates);
  }

  const coordStr = coordinates.map(c => `${c.lng},${c.lat}`).join(";");
  const url = `${OSRM_BASE_URL}/table/v1/${OSRM_PROFILE}/${coordStr}?annotations=distance,duration`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OSRM_TIMEOUT);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[OSRM] Table API error: ${response.status}`);
      _consecutiveFailures++;
      return null;
    }

    const data = await response.json();

    if (data.code !== "Ok") {
      console.warn(`[OSRM] Table API returned code: ${data.code}`);
      return null;
    }

    _consecutiveFailures = 0;

    const safeDurations = (data.durations as (number | null)[][]).map((row: (number | null)[]) =>
      row.map((v: number | null) => v !== null && v !== undefined ? v : NaN)
    );
    const safeDistances = (data.distances as (number | null)[][]).map((row: (number | null)[]) =>
      row.map((v: number | null) => v !== null && v !== undefined ? v : NaN)
    );

    return {
      durations: safeDurations,
      distances: safeDistances,
      sources: data.sources,
      destinations: data.destinations,
    };
  } catch (err) {
    _consecutiveFailures++;
    console.warn("[OSRM] Table API fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function osrmTableChunked(
  coordinates: Array<{ lat: number; lng: number }>,
): Promise<OSRMTableResult | null> {
  const n = coordinates.length;
  const durations: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const distances: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  const coordStr = coordinates.map(c => `${c.lng},${c.lat}`).join(";");

  for (let srcStart = 0; srcStart < n; srcStart += MAX_CHUNK_SIZE) {
    const srcEnd = Math.min(srcStart + MAX_CHUNK_SIZE, n);
    const srcIndices = Array.from({ length: srcEnd - srcStart }, (_, i) => srcStart + i);

    for (let dstStart = 0; dstStart < n; dstStart += MAX_CHUNK_SIZE) {
      const dstEnd = Math.min(dstStart + MAX_CHUNK_SIZE, n);
      const dstIndices = Array.from({ length: dstEnd - dstStart }, (_, i) => dstStart + i);

      const url = `${OSRM_BASE_URL}/table/v1/${OSRM_PROFILE}/${coordStr}?annotations=distance,duration&sources=${srcIndices.join(";")}&destinations=${dstIndices.join(";")}`;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), OSRM_TIMEOUT);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          console.warn(`[OSRM] Chunked table error: ${response.status}`);
          return null;
        }

        const data = await response.json();
        if (data.code !== "Ok") return null;

        for (let si = 0; si < srcIndices.length; si++) {
          for (let di = 0; di < dstIndices.length; di++) {
            const dur = data.durations[si][di];
            const dist = data.distances[si][di];
            durations[srcIndices[si]][dstIndices[di]] = dur !== null && dur !== undefined ? dur : NaN;
            distances[srcIndices[si]][dstIndices[di]] = dist !== null && dist !== undefined ? dist : NaN;
          }
        }
      } catch (err) {
        console.warn("[OSRM] Chunked table fetch failed:", err instanceof Error ? err.message : err);
        return null;
      }
    }
  }

  return {
    durations,
    distances,
    sources: coordinates.map(c => ({ location: [c.lng, c.lat] as [number, number] })),
    destinations: coordinates.map(c => ({ location: [c.lng, c.lat] as [number, number] })),
  };
}

export async function osrmRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  options?: { overview?: "full" | "simplified" | "false" },
): Promise<OSRMRouteResult | null> {
  if (!OSRM_ENABLED) return null;

  const overview = options?.overview ?? "false";
  const url = `${OSRM_BASE_URL}/route/v1/${OSRM_PROFILE}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=${overview}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OSRM_TIMEOUT);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      _consecutiveFailures++;
      return null;
    }

    const data = await response.json();
    if (data.code !== "Ok" || !data.routes || data.routes.length === 0) return null;

    _consecutiveFailures = 0;

    const route = data.routes[0];
    return {
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      geometry: route.geometry,
    };
  } catch (err) {
    _consecutiveFailures++;
    console.warn("[OSRM] Route API fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function osrmRouteMulti(
  coordinates: [number, number][],
  options?: { overview?: "full" | "simplified" | "false"; geometries?: "geojson" | "polyline" },
): Promise<{
  distanceMeters: number;
  durationSeconds: number;
  geometry?: any;
} | null> {
  if (!OSRM_ENABLED || coordinates.length < 2) return null;

  const overview = options?.overview ?? "full";
  const geometries = options?.geometries ?? "geojson";
  const coordStr = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const url = `${OSRM_BASE_URL}/route/v1/${OSRM_PROFILE}/${coordStr}?overview=${overview}&geometries=${geometries}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OSRM_TIMEOUT);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      _consecutiveFailures++;
      console.warn(`[OSRM] Route multi API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data.code !== "Ok" || !data.routes || data.routes.length === 0) return null;

    _consecutiveFailures = 0;
    const route = data.routes[0];
    return {
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      geometry: route.geometry,
    };
  } catch (err) {
    _consecutiveFailures++;
    console.warn("[OSRM] Route multi API fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export function getOSRMStatus(): {
  enabled: boolean;
  baseUrl: string;
  profile: string;
  available: boolean | null;
  consecutiveFailures: number;
} {
  return {
    enabled: OSRM_ENABLED,
    baseUrl: OSRM_BASE_URL,
    profile: OSRM_PROFILE,
    available: _available,
    consecutiveFailures: _consecutiveFailures,
  };
}
