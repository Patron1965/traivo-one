import { QueryClient, QueryFunction, QueryCache, MutationCache } from "@tanstack/react-query";
import { goToLogin } from "@/lib/auth-utils";

export const API_VERSION_PREFIX = "/api/v1";

export function versionedUrl(url: string): string {
  if (url.startsWith("/api/") && !url.startsWith("/api/v1/")) {
    return url.replace("/api/", `${API_VERSION_PREFIX}/`);
  }
  if (url === "/api") {
    return API_VERSION_PREFIX;
  }
  return url;
}

/**
 * Standardiserade felkoder från backend (`server/errors.ts`). Frontend kan
 * mappa dessa till specifika UI-beteenden (redirect vid ERR_UNAUTHORIZED,
 * visa fält-fel vid ERR_VALIDATION etc).
 */
export type ApiErrorCode =
  | "ERR_BAD_REQUEST"
  | "ERR_VALIDATION"
  | "ERR_UNAUTHORIZED"
  | "ERR_FORBIDDEN"
  | "ERR_NOT_FOUND"
  | "ERR_CONFLICT"
  | "ERR_RATE_LIMITED"
  | "ERR_INTERNAL"
  | "ERR_UNAVAILABLE";

/**
 * Strukturerat fel från API:t. Kastas av `apiRequest` och `getQueryFn` när
 * servern svarar med non-2xx. `code`/`details`/`requestId` finns med när
 * servern returnerar den nya strukturerade payloaden, annars fallback till
 * ERR_INTERNAL + status-baserad gissning.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: ApiErrorCode;
  public readonly details?: unknown;
  public readonly requestId?: string;

  constructor(
    message: string,
    status: number,
    code: ApiErrorCode = "ERR_INTERNAL",
    details?: unknown,
    requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400: return "ERR_BAD_REQUEST";
    case 401: return "ERR_UNAUTHORIZED";
    case 403: return "ERR_FORBIDDEN";
    case 404: return "ERR_NOT_FOUND";
    case 409: return "ERR_CONFLICT";
    case 429: return "ERR_RATE_LIMITED";
    case 503: return "ERR_UNAVAILABLE";
    default: return "ERR_INTERNAL";
  }
}

interface StructuredErrorBody {
  error?: string;
  code?: ApiErrorCode;
  message?: string;
  details?: unknown;
  requestId?: string;
}

async function throwIfResNotOk(res: Response): Promise<void> {
  if (res.ok) return;

  const text = await res.text();
  let message = `${res.status}: ${res.statusText}`;
  let code: ApiErrorCode = codeForStatus(res.status);
  let details: unknown;
  let requestId: string | undefined =
    res.headers.get("x-request-id") ?? undefined;

  if (text) {
    try {
      const json = JSON.parse(text) as StructuredErrorBody;
      if (typeof json.message === "string" && json.message.length > 0) {
        message = json.message;
      } else if (typeof json.error === "string" && json.error.length > 0) {
        message = json.error;
      }
      if (json.code) code = json.code;
      if (json.details !== undefined) {
        details = json.details;
        // Bakåtkompatibilitet: tidigare API:t hade fältfel i `details` som
        // array av {field, message}. Visa dem i meddelandet om servern inte
        // redan gjort det.
        if (
          Array.isArray(json.details) &&
          !json.message &&
          (!json.error || json.error === `${res.status}: ${res.statusText}`)
        ) {
          const fieldErrors = (json.details as Array<{ field?: string; message?: string }>)
            .filter((d) => d && typeof d === "object")
            .map((d) => `${d.field ?? "?"}: ${d.message ?? ""}`)
            .join(", ");
          if (fieldErrors) message = fieldErrors;
        }
      }
      if (typeof json.requestId === "string") requestId = json.requestId;
    } catch {
      // Icke-JSON-svar. Detta händer t.ex. när servern startar om och Replits
      // edge svarar med rå text ("Internal Server Error") — då vill vi INTE
      // visa rå engelsk text eller en kryptisk JSON.parse-fel-sträng för
      // användaren. Visa ett begripligt svenskt meddelande för 5xx, annars
      // en trimmad variant av texten.
      const trimmed = text.trim();
      if (res.status >= 500) {
        message =
          "Servern är tillfälligt otillgänglig. Försök igen om en liten stund.";
      } else if (trimmed) {
        message = trimmed.slice(0, 200);
      }
    }
  }

  throw new ApiError(message, res.status, code, details, requestId);
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(versionedUrl(url), {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  try {
    await throwIfResNotOk(res);
  } catch (err) {
    // Global 401-hantering även för imperativa anrop (t.ex. WS-tokenhämtning)
    // som inte går via QueryCache/MutationCache.
    handleGlobalAuthError(err);
    throw err;
  }
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const rawUrl = queryKey.join("/") as string;
    const res = await fetch(versionedUrl(rawUrl), {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

// ---------------------------------------------------------------------------
// Global 401-hantering: när sessionen gått ut ska användaren ledas till
// inloggningen istället för att appen fastnar i ett tyst fruset felläge.
// Portal-/publika ytor har egen autentisering (egna inloggningssidor) och
// ska INTE skickas till Replit-inloggningen.
// ---------------------------------------------------------------------------
const SESSION_EXEMPT_PATH_PREFIXES = [
  "/portal",
  "/report/",
  "/feedback/",
  "/metadata-form/",
];

function isSessionExemptPath(): boolean {
  if (typeof window === "undefined") return true;
  const p = window.location.pathname;
  // OBS: "/portal-messages" är en intern (Replit Auth-skyddad) sida — undanta
  // den inte trots att den delar "/portal"-prefixet.
  if (p.startsWith("/portal-messages")) return false;
  return SESSION_EXEMPT_PATH_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix));
}

let sessionRedirectTriggered = false;

function handleGlobalAuthError(error: unknown) {
  if (sessionRedirectTriggered) return;
  if (!(error instanceof ApiError) || error.status !== 401) return;
  if (isSessionExemptPath()) return;
  sessionRedirectTriggered = true;
  goToLogin(window.location.pathname + window.location.search);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleGlobalAuthError,
  }),
  mutationCache: new MutationCache({
    onError: handleGlobalAuthError,
  }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// ---------------------------------------------------------------------------
// Fokus-återhämtning: all query-data cachas för evigt (staleTime: Infinity)
// och skärmarna förlitar sig på realtidshändelser för uppdatering. Har fliken
// varit dold en längre stund (websocket kan ha dött / händelser missats)
// hämtas aktiva queries om när användaren kommer tillbaka — en måttlig
// engångs-refetch, inte kontinuerlig polling.
// ---------------------------------------------------------------------------
const HIDDEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
let lastHiddenAt: number | null = null;

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      lastHiddenAt = Date.now();
    } else if (document.visibilityState === "visible") {
      if (lastHiddenAt !== null && Date.now() - lastHiddenAt >= HIDDEN_REFRESH_THRESHOLD_MS) {
        queryClient.invalidateQueries({ refetchType: "active" });
      }
      lastHiddenAt = null;
    }
  });
}

/**
 * Anropas när en realtidsanslutning ÅTERupprättats efter ett avbrott —
 * händelser kan ha missats under avbrottet, så aktiva queries hämtas om
 * för att skärmen ska komma ikapp.
 */
export function refetchActiveQueriesAfterReconnect() {
  queryClient.invalidateQueries({ refetchType: "active" });
}
