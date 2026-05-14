/**
 * GoogleMapProvider — Google Maps Platform-implementation av MapProvider
 * (Task #473, Fas 1 steg 3).
 *
 * Använder:
 *   - Routes API (computeRoutes + computeRouteMatrix) för rutt/matris
 *   - Geocoding API för geokod/reverse
 *   - Places API (New) Autocomplete för adress-suggestions
 *   - Route Optimization API för VRP
 *
 * Krav:
 *   - GOOGLE_MAPS_API_KEY (server-side, restricted till Routes/Geocoding/
 *     Places/Route Optimization).
 *   - GOOGLE_CLOUD_PROJECT_ID krävs ENDAST för optimizeRoutes (Route
 *     Optimization API kräver projekt-id i URL och OAuth-token; saknas
 *     nyckel/projekt så returneras `{ ok: false }` utan att krascha).
 *
 * Designval:
 *   - Provider FIRAR INTE shadow-jämförelse själv — det görs enbart från
 *     primärprovidern (idag GeoapifyMapProvider). När MAP_PROVIDER=google blir
 *     default måste fireShadowOp-mönstret porteras hit (med samma
 *     no-recursion-skydd som finns i shadowComparison.ts).
 *   - getTileConfig() faller tillbaka på Geoapify/OSM-tiles eftersom Googles
 *     Map Tiles API kräver session-tokens och inte fungerar med Leaflets
 *     XYZ-mönster utan extra plumbing. Kart-rendering byts inte i denna fas.
 *   - Alla nätverksanrop loggas via trackApiUsage(service="google-maps") så
 *     kostnad/volym kan följas i `api_usage_logs`.
 */
import { trackApiUsage } from "../api-usage-tracker";
import { getMapTileConfig, type Waypoint, type MapTileConfig, type RouteFetchResult, type RoutingFetchOptions } from "./routing";
import type {
  AddressSuggestion,
  GeocodingResult,
  SearchDestinationsResult,
} from "../google-geocoding";
import type {
  MapProvider,
  ProviderMatrixCell,
  ProviderPairResult,
  ProviderRouteFetchResult,
  ProviderRouteGeometry,
  ProviderRouteSummary,
  ProviderSquareMatrix,
  ProviderVRPAction,
  ProviderVRPAgentPlan,
  ProviderVRPRequest,
  ProviderVRPResult,
} from "./mapProvider";

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;

const ROUTES_BASE = "https://routes.googleapis.com";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const ROUTE_OPTIMIZATION_URL = (project: string) =>
  `https://routeoptimization.googleapis.com/v1/projects/${encodeURIComponent(project)}:optimizeTours`;

function isGoogleConfigured(): boolean {
  return !!GOOGLE_API_KEY;
}

function track(
  method: string,
  endpoint: string,
  status: number,
  durationMs: number,
  units = 1,
  metadata: Record<string, unknown> = {},
): void {
  void trackApiUsage({
    service: "google-maps",
    method,
    endpoint,
    units,
    statusCode: status,
    durationMs,
    metadata,
  });
}

/**
 * Decode a Google encoded polyline into [lat, lng] pairs.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function decodePolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

function parseDurationSeconds(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    // Format like "123s"
    const m = raw.match(/^(-?\d+(?:\.\d+)?)s?$/);
    if (m) return Number.parseFloat(m[1]);
  }
  return null;
}

interface GoogleRoutesComputeResponse {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    polyline?: { encodedPolyline?: string };
  }>;
  error?: { message?: string; code?: number };
}

async function computeRoute(
  waypoints: Waypoint[],
  fieldMask: string,
): Promise<{ status: number; data: GoogleRoutesComputeResponse | null; error?: string }> {
  if (!GOOGLE_API_KEY) {
    return { status: 500, data: null, error: "GOOGLE_MAPS_API_KEY saknas" };
  }
  if (waypoints.length < 2) {
    return { status: 400, data: null, error: "Minst 2 waypoints krävs" };
  }

  const origin = waypoints[0];
  const destination = waypoints[waypoints.length - 1];
  const intermediates = waypoints.slice(1, -1);

  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    intermediates: intermediates.map((w) => ({
      location: { latLng: { latitude: w.lat, longitude: w.lng } },
    })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
  };

  const start = Date.now();
  let response: Response;
  try {
    response = await fetch(`${ROUTES_BASE}/directions/v2:computeRoutes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    track("computeRoutes", "/directions/v2:computeRoutes", 502, Date.now() - start, 1, {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 502, data: null, error: "computeRoutes fetch failed" };
  }

  const durationMs = Date.now() - start;
  track("computeRoutes", "/directions/v2:computeRoutes", response.status, durationMs, 1, {
    waypointCount: waypoints.length,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    return { status: response.status, data: null, error: errText || "Routes API error" };
  }

  try {
    const data = (await response.json()) as GoogleRoutesComputeResponse;
    return { status: 200, data };
  } catch {
    return { status: 502, data: null, error: "Invalid JSON from Routes API" };
  }
}

interface GoogleMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  status?: { code?: number; message?: string };
  condition?: string;
  distanceMeters?: number;
  duration?: string;
}

async function computeRouteMatrix(
  origins: Waypoint[],
  destinations: Waypoint[],
): Promise<GoogleMatrixElement[] | null> {
  if (!GOOGLE_API_KEY) return null;
  if (origins.length === 0 || destinations.length === 0) return [];

  const body = {
    origins: origins.map((w) => ({
      waypoint: { location: { latLng: { latitude: w.lat, longitude: w.lng } } },
    })),
    destinations: destinations.map((w) => ({
      waypoint: { location: { latLng: { latitude: w.lat, longitude: w.lng } } },
    })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
  };

  const start = Date.now();
  let response: Response;
  try {
    response = await fetch(`${ROUTES_BASE}/distanceMatrix/v2:computeRouteMatrix`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask":
          "originIndex,destinationIndex,duration,distanceMeters,status,condition",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    track("computeRouteMatrix", "/distanceMatrix/v2:computeRouteMatrix", 502, Date.now() - start, 1, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const durationMs = Date.now() - start;
  // Matrix-anrop debiteras per element (origins × destinations) — använd det som units.
  track(
    "computeRouteMatrix",
    "/distanceMatrix/v2:computeRouteMatrix",
    response.status,
    durationMs,
    origins.length * destinations.length,
    { originCount: origins.length, destinationCount: destinations.length },
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.warn("[google-map-provider] computeRouteMatrix error:", response.status, errText);
    return null;
  }

  try {
    const text = await response.text();
    // Response can be either NDJSON (stream) or a JSON array depending on size.
    const trimmed = text.trim();
    if (trimmed.startsWith("[")) {
      return JSON.parse(trimmed) as GoogleMatrixElement[];
    }
    const lines = trimmed.split("\n").filter((l) => l.trim().length > 0);
    return lines.map((l) => JSON.parse(l) as GoogleMatrixElement);
  } catch (err) {
    console.warn(
      "[google-map-provider] computeRouteMatrix parse failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

interface GoogleGeocodeResponse {
  status: string;
  results?: Array<{
    formatted_address: string;
    place_id?: string;
    geometry?: {
      location?: { lat: number; lng: number };
      location_type?: string;
    };
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  }>;
  error_message?: string;
}

function parseGeocodeResult(
  data: GoogleGeocodeResponse,
): { result: GeocodingResult; placeId?: string } | null {
  const top = data.results?.[0];
  if (!top || !top.geometry?.location) return null;

  const components = top.address_components ?? [];
  const find = (type: string) => components.find((c) => c.types.includes(type))?.long_name;

  const postalCode = find("postal_code");
  const city = find("postal_town") ?? find("locality") ?? find("administrative_area_level_2");
  const route = find("route");
  const streetNumber = find("street_number");

  return {
    placeId: top.place_id,
    result: {
      latitude: top.geometry.location.lat,
      longitude: top.geometry.location.lng,
      formattedAddress: top.formatted_address,
      postalCode,
      city,
      components: {
        streetNumber,
        route,
        locality: city,
        postalCode,
        country: find("country"),
      },
    },
  };
}

async function googleGeocode(address: string, tenantId?: string): Promise<GeocodingResult | null> {
  if (!GOOGLE_API_KEY) return null;
  const params = new URLSearchParams({
    address,
    key: GOOGLE_API_KEY,
    region: "se",
  });
  const start = Date.now();
  let response: Response;
  try {
    response = await fetch(`${GEOCODE_URL}?${params.toString()}`);
  } catch (err) {
    track("geocode", "/maps/api/geocode/json", 502, Date.now() - start, 1, {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  const durationMs = Date.now() - start;
  track("geocode", "/maps/api/geocode/json", response.status, durationMs, 1, { tenantId });

  if (!response.ok) return null;
  try {
    const data = (await response.json()) as GoogleGeocodeResponse;
    if (data.status !== "OK") return null;
    return parseGeocodeResult(data)?.result ?? null;
  } catch {
    return null;
  }
}

async function googleReverseGeocode(
  lat: number,
  lng: number,
  tenantId?: string,
): Promise<{ city?: string; postalCode?: string; address?: string } | null> {
  if (!GOOGLE_API_KEY) return null;
  const params = new URLSearchParams({
    latlng: `${lat},${lng}`,
    key: GOOGLE_API_KEY,
    language: "sv",
  });
  const start = Date.now();
  let response: Response;
  try {
    response = await fetch(`${GEOCODE_URL}?${params.toString()}`);
  } catch {
    return null;
  }
  track("reverseGeocode", "/maps/api/geocode/json", response.status, Date.now() - start, 1, {
    tenantId,
  });
  if (!response.ok) return null;
  try {
    const data = (await response.json()) as GoogleGeocodeResponse;
    if (data.status !== "OK") return null;
    const parsed = parseGeocodeResult(data);
    if (!parsed) return null;
    return {
      city: parsed.result.city,
      postalCode: parsed.result.postalCode,
      address: parsed.result.formattedAddress,
    };
  } catch {
    return null;
  }
}

interface GooglePlacesAutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
}

async function googleAutocomplete(
  query: string,
  tenantId?: string,
  limit = 5,
): Promise<AddressSuggestion[]> {
  if (!GOOGLE_API_KEY || !query.trim()) return [];

  const start = Date.now();
  let response: Response;
  try {
    response = await fetch(PLACES_AUTOCOMPLETE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
      },
      body: JSON.stringify({
        input: query,
        languageCode: "sv",
        regionCode: "SE",
        includedRegionCodes: ["SE"],
      }),
    });
  } catch (err) {
    track("autocomplete", "/v1/places:autocomplete", 502, Date.now() - start, 1, {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  track("autocomplete", "/v1/places:autocomplete", response.status, Date.now() - start, 1, {
    tenantId,
  });
  if (!response.ok) return [];

  let data: GooglePlacesAutocompleteResponse;
  try {
    data = (await response.json()) as GooglePlacesAutocompleteResponse;
  } catch {
    return [];
  }

  const predictions = data.suggestions?.slice(0, limit) ?? [];

  // Places Autocomplete (New) returnerar inte lat/lng direkt — vi måste
  // geokoda toppresultaten för att fylla i koordinater. För shadow-bruk
  // begränsar vi oss till att geokoda de första `limit` resultaten.
  const enriched: AddressSuggestion[] = [];
  for (const p of predictions) {
    const text = p.placePrediction?.text?.text;
    if (!text) continue;
    const geo = await googleGeocode(text, tenantId);
    if (!geo) continue;
    enriched.push({
      formattedAddress: geo.formattedAddress,
      address: geo.formattedAddress,
      postalCode: geo.postalCode,
      city: geo.city,
      latitude: geo.latitude,
      longitude: geo.longitude,
      placeId: p.placePrediction?.placeId,
    });
  }
  return enriched;
}

async function googleSearchDestinations(
  query: string,
  tenantId?: string,
): Promise<SearchDestinationsResult | null> {
  if (!GOOGLE_API_KEY) return null;
  const params = new URLSearchParams({
    address: query,
    key: GOOGLE_API_KEY,
    region: "se",
    language: "sv",
  });
  const start = Date.now();
  let response: Response;
  try {
    response = await fetch(`${GEOCODE_URL}?${params.toString()}`);
  } catch {
    return null;
  }
  track("searchDestinations", "/maps/api/geocode/json", response.status, Date.now() - start, 1, {
    tenantId,
  });
  if (!response.ok) return null;
  try {
    const data = (await response.json()) as GoogleGeocodeResponse;
    if (data.status !== "OK") return null;
    const parsed = parseGeocodeResult(data);
    if (!parsed) return null;
    return { ...parsed.result, placeId: parsed.placeId };
  } catch {
    return null;
  }
}

// =============================================================================
// VRP — Route Optimization API
// =============================================================================

// Geoapify-formade input-typer för VRP-requesten. Speglar `GeoapifyAgent` /
// `GeoapifyJob` + `EnrichedGeoapifyJob`/`EnrichedGeoapifyAgent` (vrp-constraints)
// — de enda call-sites som idag bygger VRP-requests. Vi typar input strikt så
// att mappningen inte använder `any`-casts och kan validera shape vid runtime.
interface GeoapifyVRPJob {
  location: [number, number];
  duration?: number;
  priority?: number;
  time_windows?: [number, number][];
  id?: string;
  description?: string;
  required_skills?: number[];
  pickup?: number[];
  delivery?: number[];
}

interface GeoapifyVRPAgent {
  start_location: [number, number];
  end_location?: [number, number];
  time_windows?: [number, number][];
  breaks?: Array<{ duration: number; time_windows?: [number, number][] }>;
  id?: string;
  description?: string;
  skills?: number[];
  capacity?: number[];
}

function isLngLatTuple(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number";
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number");
}

function isGeoapifyJob(v: unknown): v is GeoapifyVRPJob {
  if (!v || typeof v !== "object") return false;
  const obj = v as { location?: unknown };
  return isLngLatTuple(obj.location);
}

function isGeoapifyAgent(v: unknown): v is GeoapifyVRPAgent {
  if (!v || typeof v !== "object") return false;
  const obj = v as { start_location?: unknown };
  return isLngLatTuple(obj.start_location);
}

/**
 * Anchor som Geoapifys day-relativa sekund-fält (time_windows, break.time_windows)
 * konverteras emot. Default: idag 00:00 i UTC. Tester (och framtida call-sites
 * som vill köra VRP för en specifik dag) kan injicera epok-sekunder via
 * `req.globalStartTimeSeconds` så att absoluta timestamps blir deterministiska.
 */
function resolveDayAnchorSeconds(req: ProviderVRPRequest): number {
  const raw = (req as Record<string, unknown>).globalStartTimeSeconds;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  const now = new Date();
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
}

function toIsoFromAnchor(anchorSec: number, daySec: number): string {
  return new Date((anchorSec + daySec) * 1000).toISOString();
}

/**
 * Mappa Geoapifys priority (0–100, högre = viktigare) till Googles
 * `penaltyCost` som är kostnaden solver betalar om shipment hoppas över.
 * Vi använder en linjär skala 0→0, 100→100000 så att solver alltid föredrar
 * att schemalägga högprio-jobb framför lågprio-jobb när det krockar.
 */
function priorityToPenaltyCost(priority: number | undefined): number {
  if (typeof priority !== "number" || !Number.isFinite(priority)) return 1000;
  const clamped = Math.max(0, Math.min(100, priority));
  return Math.round(clamped * 1000);
}

function mapCapacityVectorToLoadLimits(capacity: number[]): Record<string, { maxLoad: string }> {
  const out: Record<string, { maxLoad: string }> = {};
  for (let i = 0; i < capacity.length; i++) {
    const v = capacity[i];
    if (!Number.isFinite(v) || v <= 0) continue;
    out[`dim${i}`] = { maxLoad: String(Math.round(v)) };
  }
  return out;
}

function mapDemandVectorToLoadDemands(demand: number[]): Record<string, { amount: string }> {
  const out: Record<string, { amount: string }> = {};
  for (let i = 0; i < demand.length; i++) {
    const v = demand[i];
    if (!Number.isFinite(v) || v <= 0) continue;
    out[`dim${i}`] = { amount: String(Math.round(v)) };
  }
  return out;
}

/**
 * Geoapifys skills är ints — agent.skills och job.required_skills indexeras
 * mot samma int-rymd. Google har inget motsvarande "skill"-koncept; istället
 * begränsar man kompatibilitet via `Shipment.allowedVehicleIndices`. Vi
 * pre-beräknar tillåtna fordon för varje shipment baserat på subset-test.
 */
function computeAllowedVehicleIndices(
  required: number[] | undefined,
  agents: GeoapifyVRPAgent[],
): number[] | undefined {
  if (!required || required.length === 0) return undefined;
  const allowed: number[] = [];
  for (let i = 0; i < agents.length; i++) {
    const skills = agents[i].skills ?? [];
    if (required.every((r) => skills.includes(r))) allowed.push(i);
  }
  return allowed;
}

interface MappedBreakRequest {
  earliestStartTime: string;
  latestStartTime: string;
  minDuration: string;
}

function mapBreaks(
  breaks: GeoapifyVRPAgent["breaks"],
  anchorSec: number,
): MappedBreakRequest[] | undefined {
  if (!breaks || breaks.length === 0) return undefined;
  const out: MappedBreakRequest[] = [];
  for (const b of breaks) {
    if (!Number.isFinite(b.duration) || b.duration <= 0) continue;
    const win = b.time_windows?.[0];
    if (!win) continue;
    const [earliestSec, latestSec] = win;
    // latestStartTime måste lämna utrymme för pausen själv inom fönstret.
    const latestStartSec = Math.max(earliestSec, latestSec - b.duration);
    out.push({
      earliestStartTime: toIsoFromAnchor(anchorSec, earliestSec),
      latestStartTime: toIsoFromAnchor(anchorSec, latestStartSec),
      minDuration: `${b.duration}s`,
    });
  }
  return out.length > 0 ? out : undefined;
}

function mapTimeWindowsToInterval(
  windows: [number, number][] | undefined,
  anchorSec: number,
): Array<{ startTime: string; endTime: string }> | undefined {
  if (!windows || windows.length === 0) return undefined;
  const out: Array<{ startTime: string; endTime: string }> = [];
  for (const [s, e] of windows) {
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    out.push({
      startTime: toIsoFromAnchor(anchorSec, s),
      endTime: toIsoFromAnchor(anchorSec, e),
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Översätt en Geoapify-formad VRP-request (möjligen berikad av
 * `vrp-constraints.ts` med tidsfönster, raster, kapacitet, skills och
 * prioritet) till Googles `optimizeTours`-format.
 *
 * Täckta fält:
 *   - jobs.location                → shipments[].deliveries[0].arrivalLocation
 *   - jobs.duration                → shipments[].deliveries[0].duration
 *   - jobs.time_windows            → shipments[].deliveries[0].timeWindows
 *   - jobs.priority                → shipments[].penaltyCost
 *   - jobs.required_skills         → shipments[].allowedVehicleIndices (subset-test)
 *   - jobs.delivery (capacity vec) → shipments[].deliveries[0].loadDemands
 *   - jobs.pickup   (capacity vec) → shipments[].pickups[0].loadDemands
 *   - agents.start/end_location    → vehicles[].start/endLocation
 *   - agents.time_windows          → vehicles[].startTimeWindows + endTimeWindows
 *   - agents.breaks                → vehicles[].breakRule.breakRequests
 *   - agents.capacity              → vehicles[].loadLimits
 *
 * Saknad/felformad data leder till fail-soft `null` så att shadow-jämförelsen
 * rapporterar fel istället för att krascha primär-pathen.
 *
 * Begränsningar (se `docs/google-vrp-mapping.md`):
 *   - Geoapifys per-agent `skills` har ingen direkt motsvarighet i Google;
 *     vi simulerar via `allowedVehicleIndices` (pre-filter, ej sant skill-set).
 *   - Geoapifys priority modelleras som penaltyCost (0..100 → 0..100000); det
 *     ger rätt prioritetsordning men inte identisk straffabsolut nivå.
 *   - Soft-prefer time windows finns inte i denna mappning; Geoapify-pathen
 *     löser det med priority-boost upstream, vilket bevaras via penaltyCost.
 */
export function tryMapVRPRequestToGoogle(req: ProviderVRPRequest): Record<string, unknown> | null {
  const rawJobs = req.jobs;
  const rawAgents = req.agents;
  if (!Array.isArray(rawJobs) || !Array.isArray(rawAgents)) return null;
  if (!rawJobs.every(isGeoapifyJob) || !rawAgents.every(isGeoapifyAgent)) return null;

  const jobs: GeoapifyVRPJob[] = rawJobs;
  const agents: GeoapifyVRPAgent[] = rawAgents;

  const anchorSec = resolveDayAnchorSeconds(req);
  // Hämta hela dagens slut från sista time_window vi ser. Om inga
  // tidsfönster finns faller vi tillbaka till 24h.
  let dayEndSec: number | null = null;
  for (const a of agents) {
    for (const w of a.time_windows ?? []) {
      if (Number.isFinite(w[1])) {
        dayEndSec = dayEndSec === null ? w[1] : Math.max(dayEndSec, w[1]);
      }
    }
  }
  for (const j of jobs) {
    for (const w of j.time_windows ?? []) {
      if (Number.isFinite(w[1])) {
        dayEndSec = dayEndSec === null ? w[1] : Math.max(dayEndSec, w[1]);
      }
    }
  }
  if (dayEndSec === null) dayEndSec = 24 * 3600;

  const shipments = jobs.map((j, idx) => {
    const [lng, lat] = j.location;
    const deliveryDemands = isNumberArray(j.delivery)
      ? mapDemandVectorToLoadDemands(j.delivery)
      : undefined;
    const pickupDemands = isNumberArray(j.pickup)
      ? mapDemandVectorToLoadDemands(j.pickup)
      : undefined;
    const timeWindows = mapTimeWindowsToInterval(j.time_windows, anchorSec);

    const delivery: Record<string, unknown> = {
      arrivalLocation: { latitude: lat, longitude: lng },
      duration: typeof j.duration === "number" ? `${j.duration}s` : "0s",
    };
    if (timeWindows) delivery.timeWindows = timeWindows;
    if (deliveryDemands && Object.keys(deliveryDemands).length > 0) {
      delivery.loadDemands = deliveryDemands;
    }

    const shipment: Record<string, unknown> = {
      label: j.id ?? `job-${idx}`,
      deliveries: [delivery],
      penaltyCost: priorityToPenaltyCost(j.priority),
    };

    if (pickupDemands && Object.keys(pickupDemands).length > 0) {
      shipment.pickups = [
        {
          arrivalLocation: { latitude: lat, longitude: lng },
          duration: "0s",
          loadDemands: pickupDemands,
        },
      ];
    }

    const allowed = computeAllowedVehicleIndices(j.required_skills, agents);
    if (allowed) shipment.allowedVehicleIndices = allowed;

    return shipment;
  });

  const vehicles = agents.map((a, idx) => {
    const start = a.start_location;
    const end = a.end_location ?? a.start_location;
    const vehicle: Record<string, unknown> = {
      label: a.id ?? `agent-${idx}`,
      startLocation: { latitude: start[1], longitude: start[0] },
      endLocation: { latitude: end[1], longitude: end[0] },
      travelMode: "DRIVING",
    };

    const startEndWindows = mapTimeWindowsToInterval(a.time_windows, anchorSec);
    if (startEndWindows) {
      vehicle.startTimeWindows = startEndWindows;
      vehicle.endTimeWindows = startEndWindows;
    }

    const breakRequests = mapBreaks(a.breaks, anchorSec);
    if (breakRequests) {
      vehicle.breakRule = { breakRequests };
    }

    if (isNumberArray(a.capacity)) {
      const loadLimits = mapCapacityVectorToLoadLimits(a.capacity);
      if (Object.keys(loadLimits).length > 0) vehicle.loadLimits = loadLimits;
    }

    return vehicle;
  });

  return {
    model: {
      shipments,
      vehicles,
      globalStartTime: toIsoFromAnchor(anchorSec, 0),
      globalEndTime: toIsoFromAnchor(anchorSec, dayEndSec),
    },
  };
}

/**
 * Hämtar OAuth-bearer-token för Route Optimization API. Använder
 * `google-auth-library`s `GoogleAuth` som plockar upp credentials från
 * GOOGLE_APPLICATION_CREDENTIALS, gcloud-default-creds eller ADC. Returnerar
 * null om ingen credential går att hitta — caller faller då tillbaka till att
 * rapportera tydligt fel istället för att krascha.
 */
async function getRouteOptimizationAuthToken(): Promise<string | null> {
  try {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    return tokenResponse?.token ?? null;
  } catch (err) {
    console.warn(
      "[google-map-provider] Route Optimization OAuth-token kunde inte hämtas:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function googleOptimizeTours(req: ProviderVRPRequest): Promise<ProviderVRPResult> {
  if (!GOOGLE_PROJECT_ID) {
    return {
      ok: false,
      status: 501,
      error: "GOOGLE_CLOUD_PROJECT_ID saknas — Route Optimization API kräver projekt-id",
    };
  }

  const mapped = tryMapVRPRequestToGoogle(req);
  if (!mapped) {
    return { ok: false, status: 400, error: "Kunde inte mappa VRP-request till Google-format" };
  }

  // Route Optimization API kräver OAuth (API-key stöds inte). Hämtar token
  // via Application Default Credentials.
  const bearer = await getRouteOptimizationAuthToken();
  if (!bearer) {
    return {
      ok: false,
      status: 501,
      error:
        "Route Optimization OAuth-token saknas — sätt GOOGLE_APPLICATION_CREDENTIALS eller använd ADC",
    };
  }

  const start = Date.now();
  let response: Response;
  try {
    response = await fetch(ROUTE_OPTIMIZATION_URL(GOOGLE_PROJECT_ID), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(mapped),
    });
  } catch (err) {
    track("optimizeTours", "/v1/projects/:optimizeTours", 502, Date.now() - start, 1, {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 502, error: "Route Optimization fetch failed" };
  }

  const durationMs = Date.now() - start;
  track("optimizeTours", "/v1/projects/:optimizeTours", response.status, durationMs, 1);

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    return { ok: false, status: response.status, error: errText || "Route Optimization error" };
  }

  try {
    const data = await response.json();
    return mapGoogleOptimizeToursResult(data);
  } catch {
    return { ok: false, status: 502, error: "Invalid Route Optimization JSON" };
  }
}

interface GoogleOptimizeToursResponse {
  routes?: Array<{
    vehicleIndex?: number;
    vehicleLabel?: string;
    vehicleStartTime?: string;
    vehicleEndTime?: string;
    visits?: Array<{
      shipmentIndex?: number;
      shipmentLabel?: string;
      startTime?: string;
      detour?: string;
      isPickup?: boolean;
      arrivalLocation?: { latitude?: number; longitude?: number };
    }>;
    breaks?: Array<{
      startTime?: string;
      duration?: string;
    }>;
    metrics?: {
      travelDistanceMeters?: number;
      totalDuration?: string;
      travelDuration?: string;
    };
    routePolyline?: { points?: string };
  }>;
  skippedShipments?: Array<{
    index?: number;
    label?: string;
    reasons?: Array<{ code?: string; exampleVehicleIndex?: number; exampleExceededCapacityType?: string }>;
  }>;
}

function isoToSeconds(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
}

export function mapGoogleOptimizeToursResult(data: GoogleOptimizeToursResponse): ProviderVRPResult {
  const routes = Array.isArray(data.routes) ? data.routes : [];
  const agentPlans: ProviderVRPAgentPlan[] = routes.map((r, idx) => {
    const startSec = isoToSeconds(r.vehicleStartTime) ?? 0;
    const visits = r.visits ?? [];
    const breaks = r.breaks ?? [];

    // Slå ihop visits + breaks i kronologisk ordning så att VRP-konsumenter
    // (route-optimizer) kan bygga rätt action-sekvens.
    type Timed = { sec: number; build: () => ProviderVRPAction };
    const timed: Timed[] = [];
    for (const v of visits) {
      const sec = isoToSeconds(v.startTime) ?? 0;
      timed.push({
        sec,
        build: () => ({
          type: "job",
          startTimeSeconds: isoToSeconds(v.startTime),
          jobIndex: v.shipmentIndex,
          jobId: v.shipmentLabel,
          location:
            typeof v.arrivalLocation?.latitude === "number" &&
            typeof v.arrivalLocation?.longitude === "number"
              ? { lat: v.arrivalLocation.latitude, lng: v.arrivalLocation.longitude }
              : undefined,
        }),
      });
    }
    for (const b of breaks) {
      const sec = isoToSeconds(b.startTime) ?? 0;
      timed.push({
        sec,
        build: () => ({
          type: "break",
          startTimeSeconds: isoToSeconds(b.startTime),
          durationSeconds: parseDurationSeconds(b.duration) ?? undefined,
        }),
      });
    }
    timed.sort((a, b) => a.sec - b.sec);

    const actions: ProviderVRPAction[] = [{ type: "start", startTimeSeconds: startSec }];
    for (const t of timed) actions.push(t.build());
    actions.push({ type: "end", startTimeSeconds: isoToSeconds(r.vehicleEndTime) });

    return {
      agentIndex: r.vehicleIndex ?? idx,
      agentId: r.vehicleLabel,
      distanceMeters: r.metrics?.travelDistanceMeters ?? 0,
      durationSeconds: parseDurationSeconds(r.metrics?.totalDuration ?? r.metrics?.travelDuration) ?? 0,
      actions,
      geometry: r.routePolyline?.points
        ? { type: "EncodedPolyline", points: r.routePolyline.points }
        : undefined,
    };
  });

  const unassignedJobIndices = (data.skippedShipments ?? [])
    .map((s) => s.index)
    .filter((i): i is number => typeof i === "number");

  // Vehicles utan visits räknas som unassigned agents (matchar Geoapifys
  // `unassignedAgents`-semantik).
  const seenVehicleIndices = new Set<number>();
  for (const r of routes) {
    if (typeof r.vehicleIndex === "number" && (r.visits?.length ?? 0) > 0) {
      seenVehicleIndices.add(r.vehicleIndex);
    }
  }
  const unassignedAgentIndices: number[] = [];
  for (const r of routes) {
    if (typeof r.vehicleIndex === "number" && !seenVehicleIndices.has(r.vehicleIndex)) {
      unassignedAgentIndices.push(r.vehicleIndex);
    }
  }

  return {
    ok: true,
    agentPlans,
    unassignedJobIndices,
    unassignedAgentIndices,
  };
}

// =============================================================================
// MapProvider implementation
// =============================================================================

export class GoogleMapProvider implements MapProvider {
  readonly name = "google" as const;

  isRoutingAvailable(): boolean {
    return isGoogleConfigured();
  }

  async routeSummary(waypoints: Waypoint[]): Promise<ProviderRouteSummary | null> {
    const res = await computeRoute(waypoints, "routes.distanceMeters,routes.duration");
    if (!res.data) return null;
    const route = res.data.routes?.[0];
    if (!route) return null;
    const durationSec = parseDurationSeconds(route.duration);
    if (route.distanceMeters == null || durationSec == null) return null;
    return {
      distanceKm: route.distanceMeters / 1000,
      durationMinutes: durationSec / 60,
    };
  }

  async routeGeometry(waypoints: Waypoint[]): Promise<ProviderRouteGeometry | null> {
    const res = await computeRoute(waypoints, "routes.polyline.encodedPolyline");
    if (!res.data) return null;
    const encoded = res.data.routes?.[0]?.polyline?.encodedPolyline;
    if (!encoded) return { coordinates: [] };
    return { coordinates: decodePolyline(encoded) };
  }

  async routeWithStatus(
    waypoints: Waypoint[],
    _options?: RoutingFetchOptions,
  ): Promise<ProviderRouteFetchResult> {
    const res = await computeRoute(
      waypoints,
      "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
    );
    if (res.data) {
      return { ok: true, data: res.data } as RouteFetchResult;
    }
    return { ok: false, status: res.status, error: res.error ?? "Routes API error" };
  }

  async routeMatrix(
    origins: Waypoint[],
    destinations: Waypoint[],
  ): Promise<Array<Array<ProviderMatrixCell | null>>> {
    const matrix: Array<Array<ProviderMatrixCell | null>> = Array.from(
      { length: origins.length },
      () => new Array(destinations.length).fill(null),
    );
    const elements = await computeRouteMatrix(origins, destinations);
    if (!elements) return matrix;

    for (const el of elements) {
      const i = el.originIndex ?? -1;
      const j = el.destinationIndex ?? -1;
      if (i < 0 || j < 0 || i >= origins.length || j >= destinations.length) continue;
      const status = el.status?.code ?? 0;
      if (status !== 0 && status !== undefined) continue;
      const durSec = parseDurationSeconds(el.duration);
      if (el.distanceMeters == null || durSec == null) continue;
      matrix[i][j] = {
        distanceKm: el.distanceMeters / 1000,
        durationMinutes: durSec / 60,
      };
    }
    return matrix;
  }

  async routePair(
    from: Waypoint,
    to: Waypoint,
    _tenantId?: string,
  ): Promise<ProviderPairResult | null> {
    const summary = await this.routeSummary([from, to]);
    if (!summary) return null;
    return {
      distanceKm: summary.distanceKm,
      durationMinutes: summary.durationMinutes,
      source: "google",
    };
  }

  async routeMatrixSquare(coords: Waypoint[]): Promise<ProviderSquareMatrix | null> {
    if (coords.length < 2) return null;
    const elements = await computeRouteMatrix(coords, coords);
    if (!elements) return null;

    const n = coords.length;
    const distanceMeters: number[][] = Array.from({ length: n }, () => new Array(n).fill(NaN));
    const durationSeconds: number[][] = Array.from({ length: n }, () => new Array(n).fill(NaN));
    for (let i = 0; i < n; i++) {
      distanceMeters[i][i] = 0;
      durationSeconds[i][i] = 0;
    }

    for (const el of elements) {
      const i = el.originIndex ?? -1;
      const j = el.destinationIndex ?? -1;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const status = el.status?.code ?? 0;
      if (status !== 0 && status !== undefined) continue;
      const durSec = parseDurationSeconds(el.duration);
      if (el.distanceMeters == null || durSec == null) continue;
      distanceMeters[i][j] = el.distanceMeters;
      durationSeconds[i][j] = durSec;
    }
    return { distanceMeters, durationSeconds, source: "google" };
  }

  async optimizeRoutes(req: ProviderVRPRequest, _tenantId?: string): Promise<ProviderVRPResult> {
    return googleOptimizeTours(req);
  }

  isGeocodingAvailable(): boolean {
    return isGoogleConfigured();
  }

  async geocode(address: string, tenantId?: string): Promise<GeocodingResult | null> {
    return googleGeocode(address, tenantId);
  }

  async reverseGeocode(
    lat: number,
    lng: number,
    tenantId?: string,
  ): Promise<{ city?: string; postalCode?: string; address?: string } | null> {
    return googleReverseGeocode(lat, lng, tenantId);
  }

  async autocomplete(
    query: string,
    tenantId?: string,
    limit?: number,
  ): Promise<AddressSuggestion[]> {
    return googleAutocomplete(query, tenantId, limit);
  }

  async searchDestinations(
    query: string,
    tenantId?: string,
  ): Promise<SearchDestinationsResult | null> {
    return googleSearchDestinations(query, tenantId);
  }

  async batchGeocode(
    addresses: Array<{ id: string; address: string }>,
    tenantId?: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, SearchDestinationsResult>> {
    const result = new Map<string, SearchDestinationsResult>();
    for (let i = 0; i < addresses.length; i++) {
      const { id, address } = addresses[i];
      const r = await googleSearchDestinations(address, tenantId);
      if (r) result.set(id, r);
      onProgress?.(i + 1, addresses.length);
    }
    return result;
  }

  getTileConfig(): MapTileConfig {
    // Google Map Tiles API kräver session-tokens och kan inte hämtas direkt
    // från klienten utan att läcka API-nyckeln. När GOOGLE_MAPS_API_KEY finns
    // returnerar vi en server-proxy-URL som handhar både createSession och
    // signering av tile-anrop (se `server/routes/kpiRoutes.ts` →
    // `/api/system/map-tiles/{z}/{x}/{y}` och `server/services/googleTileSession.ts`).
    if (isGoogleConfigured()) {
      return {
        tileUrl: "/api/system/map-tiles/{z}/{x}/{y}",
        attribution:
          '&copy; <a href="https://www.google.com/intl/en_us/help/legalnotices_maps/">Google</a>',
      };
    }
    return getMapTileConfig();
  }
}

export function isGoogleMapProviderAvailable(): boolean {
  return isGoogleConfigured();
}
