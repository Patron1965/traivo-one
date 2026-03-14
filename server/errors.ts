export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
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
