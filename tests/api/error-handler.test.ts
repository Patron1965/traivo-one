import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ZodError, z } from "zod";
import { errorHandler, type ErrorResponse } from "../../server/middleware/errorHandler";
import {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
} from "../../server/errors";

interface MockLog {
  error: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
}

interface Harness {
  req: Request;
  res: Response;
  next: NextFunction;
  log: MockLog;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  getBody: () => ErrorResponse;
  getStatus: () => number;
}

function makeHarness(overrides: Partial<{ requestId: string; tenantId: string; headersSent: boolean }> = {}): Harness {
  const log: MockLog = { error: vi.fn(), warn: vi.fn() };
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });

  const req = {
    path: "/api/v1/things",
    method: "POST",
    log,
    requestId: overrides.requestId ?? "req-123",
    tenantId: overrides.tenantId ?? "tenant-1",
  } as unknown as Request;

  const res = {
    headersSent: overrides.headersSent ?? false,
    status,
  } as unknown as Response;

  const next = vi.fn() as unknown as NextFunction;

  return {
    req,
    res,
    next,
    log,
    status,
    json,
    getStatus: () => status.mock.calls[0][0] as number,
    getBody: () => json.mock.calls[0][0] as ErrorResponse,
  };
}

describe("errorHandler — AppError", () => {
  it("returnerar status, code, message och details från AppError", () => {
    const h = makeHarness();
    const err = new AppError("Något gick fel", 418, {
      code: "ERR_CONFLICT",
      details: { hint: "test" },
    });

    errorHandler(err, h.req, h.res, h.next);

    expect(h.getStatus()).toBe(418);
    expect(h.getBody()).toEqual({
      error: "Något gick fel",
      code: "ERR_CONFLICT",
      message: "Något gick fel",
      details: { hint: "test" },
      requestId: "req-123",
    });
  });

  it("utelämnar details-fältet helt när det är undefined", () => {
    const h = makeHarness();
    errorHandler(new AppError("Inget extra", 400), h.req, h.res, h.next);
    const body = h.getBody();
    expect("details" in body).toBe(false);
    expect(body.code).toBe("ERR_BAD_REQUEST");
  });

  it("speglar message till legacy error-fältet (bakåtkompatibilitet)", () => {
    const h = makeHarness();
    errorHandler(new AppError("Dubblerat", 409), h.req, h.res, h.next);
    const body = h.getBody();
    expect(body.error).toBe(body.message);
  });

  it.each([
    ["NotFoundError", new NotFoundError("Order"), 404, "ERR_NOT_FOUND", "Order hittades inte"],
    ["ValidationError", new ValidationError("Ogiltig"), 400, "ERR_VALIDATION", "Ogiltig"],
    ["UnauthorizedError", new UnauthorizedError("Ej inloggad"), 401, "ERR_UNAUTHORIZED", "Ej inloggad"],
    ["ForbiddenError", new ForbiddenError("Nekad"), 403, "ERR_FORBIDDEN", "Nekad"],
    ["ConflictError", new ConflictError("Krock"), 409, "ERR_CONFLICT", "Krock"],
  ] as const)("mappar subklassen %s korrekt", (_name, err, status, code, message) => {
    const h = makeHarness();
    errorHandler(err, h.req, h.res, h.next);
    expect(h.getStatus()).toBe(status);
    expect(h.getBody().code).toBe(code);
    expect(h.getBody().message).toBe(message);
  });
});

describe("errorHandler — ZodError", () => {
  it("returnerar 400 ERR_VALIDATION med strukturerade fält-details", () => {
    const h = makeHarness();
    const schema = z.object({ name: z.string(), age: z.number() });
    const parsed = schema.safeParse({ age: "inte ett tal" });
    expect(parsed.success).toBe(false);

    errorHandler((parsed as { error: ZodError }).error, h.req, h.res, h.next);

    expect(h.getStatus()).toBe(400);
    const body = h.getBody();
    expect(body.code).toBe("ERR_VALIDATION");
    expect(body.message).toMatch(/^Valideringsfel: /);
    expect(Array.isArray(body.details)).toBe(true);
    const details = body.details as Array<{ field: string; message: string }>;
    const fields = details.map((d) => d.field);
    expect(fields).toContain("name");
    expect(fields).toContain("age");
  });

  it("använder 'unknown' som fält när path är tom (rot-fel)", () => {
    const h = makeHarness();
    const err = new ZodError([
      { code: "custom", path: [], message: "rotfel" },
    ]);
    errorHandler(err, h.req, h.res, h.next);
    const details = h.getBody().details as Array<{ field: string; message: string }>;
    expect(details[0].field).toBe("unknown");
  });
});

describe("errorHandler — okänt Error och plain-objekt med status", () => {
  it("ger 500 ERR_INTERNAL för vanligt Error", () => {
    const h = makeHarness();
    errorHandler(new Error("boom"), h.req, h.res, h.next);
    expect(h.getStatus()).toBe(500);
    expect(h.getBody().code).toBe("ERR_INTERNAL");
    expect(h.getBody().message).toBe("boom");
  });

  it("ger generiskt meddelande för icke-Error som kastas", () => {
    const h = makeHarness();
    errorHandler("bara en sträng", h.req, h.res, h.next);
    expect(h.getStatus()).toBe(500);
    expect(h.getBody().message).toBe("Ett oväntat serverfel uppstod");
  });

  it("läser status från objekt med .status och mappar code", () => {
    const h = makeHarness();
    errorHandler({ status: 403, message: "nekad-objekt" }, h.req, h.res, h.next);
    expect(h.getStatus()).toBe(403);
    expect(h.getBody().code).toBe("ERR_FORBIDDEN");
  });

  it("läser status från objekt med .statusCode", () => {
    const h = makeHarness();
    errorHandler({ statusCode: 404 } as unknown, h.req, h.res, h.next);
    expect(h.getStatus()).toBe(404);
    expect(h.getBody().code).toBe("ERR_NOT_FOUND");
  });

  it.each([
    [400, "ERR_BAD_REQUEST"],
    [401, "ERR_UNAUTHORIZED"],
    [403, "ERR_FORBIDDEN"],
    [404, "ERR_NOT_FOUND"],
    [409, "ERR_CONFLICT"],
    [429, "ERR_RATE_LIMITED"],
    [503, "ERR_UNAVAILABLE"],
    [500, "ERR_INTERNAL"],
    [502, "ERR_INTERNAL"],
  ])("mappar status %i → %s för okänt fel", (status, code) => {
    const h = makeHarness();
    errorHandler({ status }, h.req, h.res, h.next);
    expect(h.getBody().code).toBe(code);
  });
});

describe("errorHandler — loggnivå", () => {
  it("loggar 5xx som error", () => {
    const h = makeHarness();
    errorHandler(new AppError("serverfel", 500), h.req, h.res, h.next);
    expect(h.log.error).toHaveBeenCalledTimes(1);
    expect(h.log.warn).not.toHaveBeenCalled();
  });

  it("loggar 4xx som warn", () => {
    const h = makeHarness();
    errorHandler(new ValidationError("klientfel"), h.req, h.res, h.next);
    expect(h.log.warn).toHaveBeenCalledTimes(1);
    expect(h.log.error).not.toHaveBeenCalled();
  });

  it("loggar 503 som error (gräns mot 5xx)", () => {
    const h = makeHarness();
    errorHandler(new AppError("nere", 503), h.req, h.res, h.next);
    expect(h.log.error).toHaveBeenCalledTimes(1);
  });
});

describe("errorHandler — headersSent och requestId", () => {
  it("gör ingenting (inkl. ingen loggning) om headers redan skickats", () => {
    const h = makeHarness({ headersSent: true });
    errorHandler(new AppError("sent", 500), h.req, h.res, h.next);
    expect(h.status).not.toHaveBeenCalled();
    expect(h.json).not.toHaveBeenCalled();
    expect(h.log.error).not.toHaveBeenCalled();
    expect(h.log.warn).not.toHaveBeenCalled();
  });

  it("propagerar requestId från req till payload", () => {
    const h = makeHarness({ requestId: "abc-789" });
    errorHandler(new AppError("x", 400), h.req, h.res, h.next);
    expect(h.getBody().requestId).toBe("abc-789");
  });
});

describe("errorHandler — payload-format (snapshot)", () => {
  it("låser den fullständiga AppError-payloaden", () => {
    const h = makeHarness();
    errorHandler(
      new ValidationError("Fältet saknas", [{ field: "namn", message: "krävs" }]),
      h.req,
      h.res,
      h.next,
    );
    expect(h.getBody()).toMatchInlineSnapshot(`
      {
        "code": "ERR_VALIDATION",
        "details": [
          {
            "field": "namn",
            "message": "krävs",
          },
        ],
        "error": "Fältet saknas",
        "message": "Fältet saknas",
        "requestId": "req-123",
      }
    `);
  });
});
