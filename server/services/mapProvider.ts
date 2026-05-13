/**
 * Map Provider Abstraction (Task #471, Fas 0).
 *
 * Syfte: definiera ETT gränssnitt för rutt/geokod/kart-tile/VRP så att
 * Geoapify+OSRM+OR-Tools senare kan bytas mot Google (Routes API,
 * Geocoding API, Maps JS, Route Optimization API) genom att flippa en env-flagga
 * och lägga till en `GoogleMapProvider`-implementation.
 *
 * Status: Inga callers använder denna abstraktion ännu — den ligger här som
 * arkitektoniskt scaffolding tills Google-godkännande är på plats. När det
 * sker:
 *   1. Skapa `server/services/googleMapProvider.ts` (implements MapProvider)
 *   2. Sätt `MAP_PROVIDER=google` i prod
 *   3. Migrera callers (route-handlers, optimization-job-runner,
 *      distance-matrix-service) till att använda `getMapProvider()` istället
 *      för direkt-importer.
 *
 * Tills dess: `getMapProvider()` returnerar alltid `GeoapifyMapProvider`
 * som delegerar till befintliga `services/routing.ts` + `google-geocoding.ts`
 * (felaktigt namngiven — innehåller Geoapify/Nominatim) + `osrm-client.ts`.
 *
 * Se `.local/tasks/google-services-migration.md` för migrationsplanen.
 */

import {
  fetchGeoapifyRoute,
  fetchGeoapifyRouteWithStatus,
  getRouteSummary,
  getRouteGeometry,
  callRoutePlanner,
  getMapTileConfig,
  isGeoapifyRoutingAvailable,
  type Waypoint,
  type RouteSummary,
  type MapTileConfig,
  type RoutePlannerResult,
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

export interface ProviderVRPRequest {
  jobs: unknown;
  agents: unknown;
  mode?: string;
  [key: string]: unknown;
}

export type ProviderVRPResult = RoutePlannerResult;
export type ProviderRouteFetchResult = RouteFetchResult;
export type ProviderRoutingOptions = RoutingFetchOptions;

export interface MapProvider {
  /** Provider-namn för loggning + observability. */
  readonly name: "geoapify" | "google";

  // ---- Routing ----
  isRoutingAvailable(): boolean;
  routeSummary(waypoints: Waypoint[]): Promise<ProviderRouteSummary | null>;
  routeGeometry(waypoints: Waypoint[]): Promise<ProviderRouteGeometry | null>;
  /**
   * Strukturerad routing-variant som bevarar HTTP-status. Används av routes
   * som vill forwarda providerns felkod till klienten (t.ex. POST
   * /api/routes/directions).
   */
  routeWithStatus(
    waypoints: Waypoint[],
    options?: ProviderRoutingOptions,
  ): Promise<ProviderRouteFetchResult>;

  // ---- VRP / Route Planner ----
  optimizeRoutes(req: ProviderVRPRequest): Promise<ProviderVRPResult>;

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
    const summary: RouteSummary | null = await getRouteSummary(waypoints);
    if (!summary) return null;
    return {
      distanceKm: summary.distanceKm,
      durationMinutes: summary.durationMinutes,
    };
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

  async optimizeRoutes(req: ProviderVRPRequest): Promise<ProviderVRPResult> {
    return callRoutePlanner(req);
  }

  isGeocodingAvailable(): boolean {
    return isGoogleGeocodingAvailable();
  }

  async geocode(address: string, tenantId?: string): Promise<GeocodingResult | null> {
    return geocodeAddress(address, tenantId);
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
// Factory — env-styrd, default geoapify. När GoogleMapProvider implementeras
// (Fas 2 av Task #471) lägg till case "google" här.
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
      // Fas 2: ersätt med `new GoogleMapProvider()` när implementationen finns.
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
