import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError, type AppErrorCode } from "../errors";
import { logger } from "../logger";

/**
 * Strukturerad fel-payload som returneras till alla klienter.
 *
 * Bakåtkompatibilitet: `error` är fortfarande en sträng (befintlig kod i
 * `client/src/lib/queryClient.ts` läser detta fält). Nytt: `code`, `message`,
 * `details` och `requestId` exponeras alltid så frontend kan agera på
 * specifika felkoder (t.ex. redirect vid ERR_UNAUTHORIZED).
 */
export interface ErrorResponse {
  error: string;
  code: AppErrorCode;
  message: string;
  details?: unknown;
  requestId?: string;
}

interface NormalizedError {
  status: number;
  code: AppErrorCode;
  message: string;
  details?: unknown;
}

function statusFromUnknown(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { status?: unknown; statusCode?: unknown };
  if (typeof e.status === "number") return e.status;
  if (typeof e.statusCode === "number") return e.statusCode;
  return undefined;
}

function normalizeError(err: unknown): NormalizedError {
  if (err instanceof AppError) {
    return {
      status: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
    };
  }

  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({
      field: e.path.join(".") || "unknown",
      message: e.message,
    }));
    const summary = details.map((d) => `${d.field}: ${d.message}`).join(", ");
    return {
      status: 400,
      code: "ERR_VALIDATION",
      message: `Valideringsfel: ${summary}`,
      details,
    };
  }

  const status = statusFromUnknown(err) ?? 500;
  const message =
    err instanceof Error ? err.message : "Ett oväntat serverfel uppstod";
  const code: AppErrorCode =
    status === 400 ? "ERR_BAD_REQUEST" :
    status === 401 ? "ERR_UNAUTHORIZED" :
    status === 403 ? "ERR_FORBIDDEN" :
    status === 404 ? "ERR_NOT_FOUND" :
    status === 409 ? "ERR_CONFLICT" :
    status === 429 ? "ERR_RATE_LIMITED" :
    status === 503 ? "ERR_UNAVAILABLE" :
    "ERR_INTERNAL";
  return { status, code, message };
}

/**
 * Global error middleware. Måste registreras SIST i Express-kedjan, efter
 * alla routes. Loggar med req.log (Pino child med requestId) när tillgängligt,
 * annars med root-loggern.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  const { status, code, message, details } = normalizeError(err);

  // Logga server-fel (5xx) som error, klient-fel (4xx) som warn för att inte
  // spamma error-kanalen med förväntade valideringsfel.
  const reqLog = req.log ?? logger;
  const logPayload = {
    status,
    code,
    err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
    route: req.path,
    method: req.method,
    tenantId: req.tenantId,
    requestId: req.requestId,
  };
  if (status >= 500) {
    reqLog.error(logPayload, `request error ${status} ${code}`);
  } else {
    reqLog.warn(logPayload, `request error ${status} ${code}`);
  }

  const body: ErrorResponse = {
    error: message,
    code,
    message,
    requestId: req.requestId,
  };
  if (details !== undefined) body.details = details;

  res.status(status).json(body);
}
