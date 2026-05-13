/**
 * Map Provider Abstraction (Task #471 Fas 0 + Task #472 Fas 1).
 *
 * Definierar ETT gränssnitt för rutt/geokod/kart-tile/VRP så att
 * Geoapify+OSRM+OR-Tools senare kan bytas mot Google (Routes API,
 * Geocoding API, Maps JS, Route Optimization API) genom att flippa en env-flagga
 * och lägga till en `GoogleMapProvider`-implementation.
 *
 * Status (Fas 1):
 *   - GeoapifyMapProvider är primär och täcker routing + geokod + VRP +
 *     OSRM-fallback för pair/matrix.
 *   - GoogleMapProvider är ännu inte implementerad. När den finns: lägg till
 *     case "google" i factory + sätt MAP_PROVIDER=google.
 *   - Shadow-logging (`shadowComparison.ts`) är aktiv så fort
 *     `MAP_SHADOW_SAMPLE_RATE > 0` OCH `getShadowProvider()` returnerar något.
 */

import {
  fetchGeoapifyRouteWithStatus,
  getRouteSummary,
  getRouteGeometry,
  callRoutePlanner,
  getMapTileConfig,
  isGeoapifyRoutingAvailable,
  type Waypoint,
  type RouteSummary,
  type MapTileConfig,
  type RouteFetchResult,
  type RoutingFetchOptions,
} from "./routing";
import {
  geocodeAddress,
  reverseGeocode,
  autocompleteAddress,
  searchDestinations,
  batchGeocode,
  isGoogleGeocodingAvailable,
  type GeocodingResult,
  type AddressSuggestion,
  type SearchDestinationsResult,
} from "./geocoding";
import {
  isOSRMAvailable,
  isOSRMEnabled,
  osrmRoute,
  osrmTable,
} from "../osrm-client";
import {
  fireShadowComparison,
  deltasForRouteSummary,
  deltasForGeocode,
  type ShadowOperation,
} from "./shadowComparison";

// =============================================================================
// Public types — provider-agnostiska. Får INTE läcka Geoapify/Google-specifika
// fältnamn. Adapter-implementationerna mappar sina rå-svar hit.
// =============================================================================

export interface ProviderRouteSummary {
  distanceKm: number;
  durationMinutes: number;
}

export interface ProviderRouteGeometry {
  /** [lat, lng]-par längs rutten. */
  coordinates: [number, number][];
}

export interface ProviderMatrixCell {
  distanceKm: number;
  durationMinutes: number;
}

/**
 * Provider-agnostisk single-pair rutt med källinformation. Används av
 * `distance-matrix-service` för cache-loggning.
 */
export interface ProviderPairResult {
  distanceKm: number;
  durationMinutes: number;
  /** Vilken backend som faktiskt levererade resultatet. */
  source: "osrm" | "geoapify" | "google";
}

/**
 * N×N-matris i meter/sekunder. `distanceMeters[i][j]` = NaN markerar
 * onåbara par (caller faller tillbaka till haversine).
 */
export interface ProviderSquareMatrix {
  distanceMeters: number[][];
  durationSeconds: number[][];
  source: "osrm" | "geoapify" | "google";
}

// ---- VRP DTOs (Task #472 Fas 1) -------------------------------------------
// Dessa ersätter den tidigare `RoutePlannerResult = RouteFetchResult`-aliasen
// så att route-optimizer.ts inte längre behöver känna till Geoapifys raw-form
// (`GeoapifyRoutePlannerResponse`). Provider mappar sin native respons hit.

export interface ProviderVRPRequest {
  jobs: unknown;
  agents: unknown;
  mode?: string;
  [key: string]: unknown;
}

export type ProviderVRPActionType = "start" | "end" | "job" | "break";

export interface ProviderVRPAction {
  type: ProviderVRPActionType;
  startTimeSeconds?: number;
  durationSeconds?: number;
  jobIndex?: number;
  jobId?: string;
  /** Lat/lng för stoppet (endast för job/break där det finns waypoint-data). */
  location?: { lat: number; lng: number };
}

export interface ProviderVRPAgentPlan {
  agentIndex: number;
  agentId?: string;
  distanceMeters: number;
  durationSeconds: number;
  actions: ProviderVRPAction[];
  /** Provider-specifik geometri (GeoJSON eller polyline). Caller får tolka. */
  geometry?: unknown;
}

export interface ProviderVRPResultOk {
  ok: true;
  agentPlans: ProviderVRPAgentPlan[];
  unassignedJobIndices: number[];
  unassignedAgentIndices: number[];
}

export interface ProviderVRPResultErr {
  ok: false;
  status: number;
  error: string;
}

export type ProviderVRPResult = ProviderVRPResultOk | ProviderVRPResultErr;

export type ProviderRouteFetchResult = RouteFetchResult;
export type ProviderRoutingOptions = RoutingFetchOptions;

export interface MapProvider {
  /** Provider-namn för loggning + observability. */
  readonly name: "geoapify" | "google";

  // ---- Routing ----
  isRoutingAvailable(): boolean;
  routeSummary(waypoints: Waypoint[]): Promise<ProviderRouteSummary | null>;
  routeGeometry(waypoints: Waypoint[]): Promise<ProviderRouteGeometry | null>;
  routeWithStatus(
    waypoints: Waypoint[],
    options?: ProviderRoutingOptions,
  ): Promise<ProviderRouteFetchResult>;
  /**
   * Beräknar en N×M distans/tid-matris mellan origins och destinations.
   * Returnerar `null` på celler där ruttning misslyckades.
   */
  routeMatrix(
    origins: Waypoint[],
    destinations: Waypoint[],
  ): Promise<Array<Array<ProviderMatrixCell | null>>>;
  /**
   * Single-pair rutt. För GeoapifyMapProvider: OSRM först, Geoapify som
   * fallback. Returnerar null om bägge misslyckas (caller faller då tillbaka
   * till haversine).
   */
  routePair(
    from: Waypoint,
    to: Waypoint,
    tenantId?: string,
  ): Promise<ProviderPairResult | null>;
  /**
   * Square N×N-matris (i meter/sekunder). För GeoapifyMapProvider: OSRM table
   * när tillgänglig, annars null (caller bygger pair-by-pair). Google-providern
   * får använda Routes API:s computeRouteMatrix.
   */
  routeMatrixSquare(
    coords: Waypoint[],
  ): Promise<ProviderSquareMatrix | null>;

  // ---- VRP / Route Planner ----
  optimizeRoutes(req: ProviderVRPRequest, tenantId?: string): Promise<ProviderVRPResult>;

  // ---- Geocoding ----
  isGeocodingAvailable(): boolean;
  geocode(address: string, tenantId?: string): Promise<GeocodingResult | null>;
  reverseGeocode(
    lat: number,
    lng: number,
    tenantId?: string,
  ): Promise<{ city?: string; postalCode?: string; address?: string } | null>;
  autocomplete(
    query: string,
    tenantId?: string,
    limit?: number,
  ): Promise<AddressSuggestion[]>;
  searchDestinations(
    query: string,
    tenantId?: string,
  ): Promise<SearchDestinationsResult | null>;
  batchGeocode(
    addresses: Array<{ id: string; address: string }>,
    tenantId?: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, SearchDestinationsResult>>;

  // ---- Map tiles ----
  getTileConfig(): MapTileConfig;
}

// =============================================================================
// Geoapify (current production) implementation
// =============================================================================

class GeoapifyMapProvider implements MapProvider {
  readonly name = "geoapify" as const;

  isRoutingAvailable(): boolean {
    return isGeoapifyRoutingAvailable();
  }

  async routeSummary(waypoints: Waypoint[]): Promise<ProviderRouteSummary | null> {
    const start = Date.now();
    const summary: RouteSummary | null = await getRouteSummary(waypoints);
    const result = summary
      ? { distanceKm: summary.distanceKm, durationMinutes: summary.durationMinutes }
      : null;

    fireShadowOp("route", { waypoints }, result, Date.now() - start, result !== null,
      (shadow) => shadow.routeSummary(waypoints),
      deltasForRouteSummary);

    return result;
  }

  async routeGeometry(waypoints: Waypoint[]): Promise<ProviderRouteGeometry | null> {
    const geom = await getRouteGeometry(waypoints);
    if (!geom) return null;
    return { coordinates: geom.coordinates };
  }

  async routeWithStatus(
    waypoints: Waypoint[],
    options?: ProviderRoutingOptions,
  ): Promise<ProviderRouteFetchResult> {
    return fetchGeoapifyRouteWithStatus(waypoints, options);
  }

  async routeMatrix(
    origins: Waypoint[],
    destinations: Waypoint[],
  ): Promise<Array<Array<ProviderMatrixCell | null>>> {
    const BATCH = 5;
    const matrix: Array<Array<ProviderMatrixCell | null>> = [];
    for (let i = 0; i < origins.length; i++) {
      const row: Array<ProviderMatrixCell | null> = new Array(destinations.length).fill(null);
      for (let j = 0; j < destinations.length; j += BATCH) {
        const slice = destinations.slice(j, j + BATCH);
        const results = await Promise.all(
          slice.map(async (dst) => {
            const s = await getRouteSummary([origins[i], dst]);
            return s ? { distanceKm: s.distanceKm, durationMinutes: s.durationMinutes } : null;
          }),
        );
        for (let k = 0; k < results.length; k++) row[j + k] = results[k];
      }
      matrix.push(row);
    }
    return matrix;
  }

  async routePair(
    from: Waypoint,
    to: Waypoint,
    tenantId?: string,
  ): Promise<ProviderPairResult | null> {
    const start = Date.now();
    let result: ProviderPairResult | null = null;

    if (isOSRMEnabled() && (await isOSRMAvailable())) {
      try {
        const osrmResult = await osrmRoute(
          { lat: from.lat, lng: from.lng },
          { lat: to.lat, lng: to.lng },
        );
        if (osrmResult) {
          result = {
            distanceKm: osrmResult.distanceMeters / 1000,
            durationMinutes: osrmResult.durationSeconds / 60,
            source: "osrm",
          };
        }
      } catch (err) {
        console.warn("[map-provider] OSRM pair failed:", err instanceof Error ? err.message : err);
      }
    }

    if (!result && isGeoapifyRoutingAvailable()) {
      const summary = await getRouteSummary([from, to]);
      if (summary) {
        result = {
          distanceKm: summary.distanceKm,
          durationMinutes: summary.durationMinutes,
          source: "geoapify",
        };
      }
    }

    fireShadowOp(
      "route",
      { waypoints: [from, to] },
      result,
      Date.now() - start,
      result !== null,
      (shadow) => shadow.routeSummary([from, to]),
      deltasForRouteSummary,
      tenantId,
    );

    return result;
  }

  async routeMatrixSquare(
    coords: Waypoint[],
  ): Promise<ProviderSquareMatrix | null> {
    if (coords.length < 2) return null;
    if (!isOSRMEnabled() || !(await isOSRMAvailable())) return null;

    const tableResult = await osrmTable(coords.map((c) => ({ lat: c.lat, lng: c.lng })));
    if (!tableResult || tableResult.distances.length !== coords.length) return null;

    const distanceMeters = tableResult.distances.map((row) =>
      row.map((v) => (Number.isFinite(v) ? v : NaN)),
    );
    const durationSeconds = tableResult.durations.map((row) =>
      row.map((v) => (Number.isFinite(v) ? v : NaN)),
    );

    return { distanceMeters, durationSeconds, source: "osrm" };
  }

  async optimizeRoutes(req: ProviderVRPRequest, tenantId?: string): Promise<ProviderVRPResult> {
    const start = Date.now();
    const raw = await callRoutePlanner(req);
    const result = mapGeoapifyVRPToDTO(raw);

    fireShadowOp(
      "vrp",
      req,
      summarizeVRPResultForShadow(result),
      Date.now() - start,
      result.ok,
      async (shadow) => summarizeVRPResultForShadow(await shadow.optimizeRoutes(req, tenantId)),
      deltasForVRPSummary,
      tenantId,
    );

    return result;
  }

  isGeocodingAvailable(): boolean {
    return isGoogleGeocodingAvailable();
  }

  async geocode(address: string, tenantId?: string): Promise<GeocodingResult | null> {
    const start = Date.now();
    const result = await geocodeAddress(address, tenantId);

    fireShadowOp(
      "geocode",
      { address },
      result,
      Date.now() - start,
      result !== null,
      (shadow) => shadow.geocode(address, tenantId),
      deltasForGeocode,
      tenantId,
    );

    return result;
  }

  async reverseGeocode(
    lat: number,
    lng: number,
    tenantId?: string,
  ): Promise<{ city?: string; postalCode?: string; address?: string } | null> {
    return reverseGeocode(lat, lng, tenantId);
  }

  async autocomplete(
    query: string,
    tenantId?: string,
    limit?: number,
  ): Promise<AddressSuggestion[]> {
    return autocompleteAddress(query, tenantId, limit);
  }

  async searchDestinations(
    query: string,
    tenantId?: string,
  ): Promise<SearchDestinationsResult | null> {
    return searchDestinations(query, tenantId);
  }

  async batchGeocode(
    addresses: Array<{ id: string; address: string }>,
    tenantId?: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, SearchDestinationsResult>> {
    return batchGeocode(addresses, tenantId, onProgress);
  }

  getTileConfig(): MapTileConfig {
    return getMapTileConfig();
  }
}

// =============================================================================
// Geoapify Route Planner → ProviderVRPResult mapping
// =============================================================================

interface GeoapifyAction {
  type: "start" | "end" | "job" | "break";
  start_time?: number;
  duration?: number;
  job_index?: number;
  job_id?: string;
  waypoint_index?: number;
}

interface GeoapifyWaypoint {
  original_location: [number, number];
  location: [number, number];
}

interface GeoapifyAgentPlan {
  type: "Feature";
  properties: {
    agent_index: number;
    agent_id?: string;
    distance: number;
    time: number;
    actions: GeoapifyAction[];
    waypoints: GeoapifyWaypoint[];
  };
  geometry: unknown;
}

interface GeoapifyRoutePlannerResponse {
  type: "FeatureCollection";
  properties: {
    issues?: {
      unassignedAgents?: number[];
      unassignedJobs?: number[];
    };
  };
  features: GeoapifyAgentPlan[];
}

export function mapGeoapifyVRPToDTO(raw: RouteFetchResult): ProviderVRPResult {
  if (!raw.ok) {
    return { ok: false, status: raw.status, error: raw.error };
  }
  const data = raw.data as GeoapifyRoutePlannerResponse;
  const features = Array.isArray(data?.features) ? data.features : [];

  const agentPlans: ProviderVRPAgentPlan[] = features.map((feature) => {
    const props = feature.properties;
    const waypoints = props.waypoints ?? [];
    const actions: ProviderVRPAction[] = (props.actions ?? []).map((a) => {
      const loc = a.waypoint_index !== undefined ? waypoints[a.waypoint_index]?.location : undefined;
      return {
        type: a.type,
        startTimeSeconds: a.start_time,
        durationSeconds: a.duration,
        jobIndex: a.job_index,
        jobId: a.job_id,
        location: loc ? { lat: loc[1], lng: loc[0] } : undefined,
      };
    });
    return {
      agentIndex: props.agent_index,
      agentId: props.agent_id,
      distanceMeters: props.distance ?? 0,
      durationSeconds: props.time ?? 0,
      actions,
      geometry: feature.geometry,
    };
  });

  return {
    ok: true,
    agentPlans,
    unassignedJobIndices: data.properties?.issues?.unassignedJobs ?? [],
    unassignedAgentIndices: data.properties?.issues?.unassignedAgents ?? [],
  };
}

function summarizeVRPResultForShadow(result: ProviderVRPResult): unknown {
  if (!result.ok) return { ok: false, status: result.status };
  const totalDistanceMeters = result.agentPlans.reduce((s, p) => s + (p.distanceMeters || 0), 0);
  const totalDurationSeconds = result.agentPlans.reduce((s, p) => s + (p.durationSeconds || 0), 0);
  const totalAssignedJobs = result.agentPlans.reduce(
    (s, p) => s + p.actions.filter((a) => a.type === "job").length,
    0,
  );
  return {
    ok: true,
    agentCount: result.agentPlans.length,
    totalDistanceKm: totalDistanceMeters / 1000,
    totalDurationMinutes: totalDurationSeconds / 60,
    totalAssignedJobs,
    unassignedJobs: result.unassignedJobIndices.length,
  };
}

function deltasForVRPSummary(primary: unknown, shadow: unknown): Record<string, unknown> | null {
  const p = primary as { totalDistanceKm?: number; totalDurationMinutes?: number; totalAssignedJobs?: number } | null;
  const s = shadow as { totalDistanceKm?: number; totalDurationMinutes?: number; totalAssignedJobs?: number } | null;
  if (!p || !s) return null;
  return {
    distanceKmDelta: (s.totalDistanceKm ?? 0) - (p.totalDistanceKm ?? 0),
    durationMinDelta: (s.totalDurationMinutes ?? 0) - (p.totalDurationMinutes ?? 0),
    assignedJobsDelta: (s.totalAssignedJobs ?? 0) - (p.totalAssignedJobs ?? 0),
  };
}

// =============================================================================
// Shadow helper — håller GeoapifyMapProvider-metoderna kompakta
// =============================================================================

function fireShadowOp(
  operation: ShadowOperation,
  request: unknown,
  primaryResult: unknown,
  primaryDurationMs: number,
  primaryOk: boolean,
  shadowRun: (provider: MapProvider) => Promise<unknown>,
  computeDeltas?: (primary: unknown, shadow: unknown) => Record<string, unknown> | null,
  tenantId?: string,
): void {
  fireShadowComparison({
    ctx: { operation, tenantId, request, primaryResult, primaryDurationMs, primaryOk },
    shadowRun,
    computeDeltas,
  });
}

// =============================================================================
// Factory — env-styrd, default geoapify. När GoogleMapProvider implementeras
// (Task #472, steg 3) lägg till case "google" här.
// =============================================================================

let _provider: MapProvider | null = null;

export function getMapProvider(): MapProvider {
  if (_provider) return _provider;

  const choice = (process.env.MAP_PROVIDER || "geoapify").toLowerCase();
  switch (choice) {
    case "geoapify":
      _provider = new GeoapifyMapProvider();
      break;
    case "google":
      // Steg 3 av Task #472: ersätt med `new GoogleMapProvider()` när
      // implementationen finns och Google-nycklarna är på plats.
      console.warn(
        "[map-provider] MAP_PROVIDER=google men GoogleMapProvider är ej implementerad — faller tillbaka till Geoapify.",
      );
      _provider = new GeoapifyMapProvider();
      break;
    default:
      console.warn(`[map-provider] Okänt MAP_PROVIDER="${choice}" — använder Geoapify.`);
      _provider = new GeoapifyMapProvider();
  }
  return _provider;
}

/** Test-helper: tvinga om-instansiering (t.ex. efter env-ändring i tester). */
export function _resetMapProviderForTests(): void {
  _provider = null;
}
