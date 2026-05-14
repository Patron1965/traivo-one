/**
 * Google Map Tiles API — session-token-hantering (Task #478).
 *
 * Google Map Tiles API kräver ett session-token-flöde innan tile-anrop kan
 * göras. Token är giltigt i ~2 timmar och måste förnyas innan utgång. Eftersom
 * Leaflets `L.tileLayer({z}/{x}/{y})` inte kan göra POST/createSession själv
 * proxar vi tile-anropen genom servern; klienten ser aldrig API-nyckeln eller
 * session-token.
 *
 * Endpoints (Google):
 *   POST https://tile.googleapis.com/v1/createSession?key=KEY
 *   GET  https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=...&key=KEY
 *
 * Designval:
 *   - En enda process-global session återanvänds för alla klienter (tile-data
 *     är inte tenantspecifik). Förnyas proaktivt 5 min före utgång.
 *   - createSession-anropet är concurrency-safe via en in-flight Promise så att
 *     flera samtidiga tile-requests inte triggar parallella createSession-anrop.
 *   - Faller tillbaka till `null` om Google inte är konfigurerat — caller får
 *     då använda Geoapify/OSM-tiles istället.
 */
import { trackApiUsage } from "../api-usage-tracker";

const CREATE_SESSION_URL = "https://tile.googleapis.com/v1/createSession";
const TILE_BASE_URL = "https://tile.googleapis.com/v1/2dtiles";

const SESSION_REFRESH_BUFFER_MS = 5 * 60 * 1000; // förnya 5 min före utgång
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000; // fallback om expiry saknas (1 h)

interface TileSession {
  session: string;
  expiresAt: number;
  tileWidth: number;
  tileHeight: number;
  imageFormat: string;
}

interface CreateSessionResponse {
  session?: string;
  expiry?: string;
  tileWidth?: number;
  tileHeight?: number;
  imageFormat?: string;
}

let cachedSession: TileSession | null = null;
let inflight: Promise<TileSession | null> | null = null;

function getApiKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY ?? null;
}

export function isGoogleTileSessionAvailable(): boolean {
  return !!getApiKey();
}

async function createSession(): Promise<TileSession | null> {
  const key = getApiKey();
  if (!key) return null;

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(`${CREATE_SESSION_URL}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mapType: "roadmap",
        language: "sv-SE",
        region: "SE",
      }),
      signal: controller.signal,
    });
  } catch (err) {
    void trackApiUsage({
      service: "google-maps",
      method: "createSession",
      endpoint: "/v1/createSession",
      units: 1,
      statusCode: 502,
      durationMs: Date.now() - start,
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    console.warn(
      "[google-tile-session] createSession fetch failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }

  void trackApiUsage({
    service: "google-maps",
    method: "createSession",
    endpoint: "/v1/createSession",
    units: 1,
    statusCode: response.status,
    durationMs: Date.now() - start,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.warn(
      "[google-tile-session] createSession failed:",
      response.status,
      text.slice(0, 200),
    );
    return null;
  }

  let data: CreateSessionResponse;
  try {
    data = (await response.json()) as CreateSessionResponse;
  } catch {
    return null;
  }

  if (!data.session) return null;

  // Expiry returneras som unix-timestamp i sekunder (string). Faller tillbaka
  // till en konservativ TTL om fältet saknas.
  let expiresAt = Date.now() + DEFAULT_SESSION_TTL_MS;
  if (data.expiry) {
    const seconds = Number.parseInt(data.expiry, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      expiresAt = seconds * 1000;
    }
  }

  return {
    session: data.session,
    expiresAt,
    tileWidth: data.tileWidth ?? 256,
    tileHeight: data.tileHeight ?? 256,
    imageFormat: data.imageFormat ?? "png",
  };
}

/**
 * Returnerar en aktiv session — skapar/förnyar vid behov. Concurrency-safe:
 * parallella anrop delar samma in-flight Promise.
 */
export async function getActiveTileSession(): Promise<TileSession | null> {
  if (cachedSession && cachedSession.expiresAt - SESSION_REFRESH_BUFFER_MS > Date.now()) {
    return cachedSession;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const fresh = await createSession();
      if (fresh) cachedSession = fresh;
      return fresh ?? cachedSession;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Bygg tile-URL för proxyn att hämta från Google. API-nyckel och session
 * läggs till server-side.
 */
export function buildGoogleTileUrl(session: string, z: number, x: number, y: number): string | null {
  const key = getApiKey();
  if (!key) return null;
  const params = new URLSearchParams({ session, key });
  return `${TILE_BASE_URL}/${z}/${x}/${y}?${params.toString()}`;
}

/** Test-helper: rensa cache så att nästa anrop skapar ny session. */
export function _resetTileSessionCacheForTests(): void {
  cachedSession = null;
  inflight = null;
}
