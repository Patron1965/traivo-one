export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    // Bevara den faktiska underklassens prototyp så `instanceof NotFoundError`
    // (och andra subklasser) fungerar — annars sätter Object.setPrototypeOf
    // alltid prototypen till AppError.prototype.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = "Resurs") {
    super(`${resource} hittades inte`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string = "Ogiltig data") {
    super(message, 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Ej autentiserad") {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Åtkomst nekad") {
    super(message, 403);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Resurskonflikt") {
    super(message, 409);
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
