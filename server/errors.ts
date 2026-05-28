/**
 * Standardiserade error-koder för API-svar. Frontend kan mappa dessa till
 * specifika UI-beteenden (t.ex. redirect till login vid ERR_UNAUTHORIZED,
 * visa fält-fel vid ERR_VALIDATION).
 */
export type AppErrorCode =
  | "ERR_BAD_REQUEST"
  | "ERR_VALIDATION"
  | "ERR_UNAUTHORIZED"
  | "ERR_FORBIDDEN"
  | "ERR_NOT_FOUND"
  | "ERR_CONFLICT"
  | "ERR_RATE_LIMITED"
  | "ERR_INTERNAL"
  | "ERR_UNAVAILABLE";

export interface AppErrorOptions {
  code?: AppErrorCode;
  details?: unknown;
  isOperational?: boolean;
  cause?: unknown;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: AppErrorCode;
  public readonly details?: unknown;
  public readonly isOperational: boolean;
  public readonly cause?: unknown;

  constructor(
    message: string,
    statusCode: number = 500,
    options: AppErrorOptions = {},
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = options.code ?? defaultCodeForStatus(statusCode);
    this.details = options.details;
    this.isOperational = options.isOperational ?? true;
    this.cause = options.cause;
    // Bevara den faktiska underklassens prototyp så `instanceof NotFoundError`
    // (och andra subklasser) fungerar — annars sätter Object.setPrototypeOf
    // alltid prototypen till AppError.prototype.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function defaultCodeForStatus(status: number): AppErrorCode {
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

export class NotFoundError extends AppError {
  constructor(resource: string = "Resurs", details?: unknown) {
    super(`${resource} hittades inte`, 404, { code: "ERR_NOT_FOUND", details });
  }
}

export class ValidationError extends AppError {
  constructor(message: string = "Ogiltig data", details?: unknown) {
    super(message, 400, { code: "ERR_VALIDATION", details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Ej autentiserad", details?: unknown) {
    super(message, 401, { code: "ERR_UNAUTHORIZED", details });
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Åtkomst nekad", details?: unknown) {
    super(message, 403, { code: "ERR_FORBIDDEN", details });
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Resurskonflikt", details?: unknown) {
    super(message, 409, { code: "ERR_CONFLICT", details });
  }
}

/**
 * Översätter Postgres unique-constraint-fel (kod 23505) på fortnox_mappings till
 * ett tydligt svenskt meddelande. Returnerar null om felet inte är en sådan kollision.
 */
export function describeFortnoxMappingConflict(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; constraint?: string; constraint_name?: string; message?: string };
  const constraint = e.constraint || e.constraint_name || "";
  const isUniqueViolation = e.code === "23505";
  const matchesMappingIndex =
    constraint === "uq_fortnox_mappings_tenant_entity_fortnox" ||
    (typeof e.message === "string" && e.message.includes("uq_fortnox_mappings_tenant_entity_fortnox"));
  if (isUniqueViolation && matchesMappingIndex) {
    return "Fortnox-kopplingen finns redan för denna kund/objekt — importen rullades tillbaka för att förhindra dubblett.";
  }
  return null;
}
