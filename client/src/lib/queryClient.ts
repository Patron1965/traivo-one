import { QueryClient, QueryFunction } from "@tanstack/react-query";

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
      message = text;
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

  await throwIfResNotOk(res);
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

export const queryClient = new QueryClient({
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
