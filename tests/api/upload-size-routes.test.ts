import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction, Express } from "express";
import {
  MAX_FIELD_PHOTO_SIZE_BYTES,
  MAX_LOGO_SIZE_BYTES,
} from "@shared/upload-limits";
import { AppError } from "../../server/errors";

// ---------------------------------------------------------------------------
// Module mocks (hoisted)
// ---------------------------------------------------------------------------

// Test-controlled flag: confirm-routes call validateUploadedFileAndSetAcl,
// which we make throw when the supplied objectPath contains "oversize".
// This simulates the storage layer rejecting an oversize stored object.
const OVERSIZE_HINT = "oversize";

vi.mock("../../server/replit_integrations/object_storage/objectStorage", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/replit_integrations/object_storage/objectStorage")
  >("../../server/replit_integrations/object_storage/objectStorage");

  class FakeObjectStorageService {
    async getObjectEntityUploadURL(): Promise<string> {
      return "https://storage.googleapis.com/bucket/uploads/fake-id?sig=x";
    }
    normalizeObjectEntityPath(_url: string): string {
      return "/objects/uploads/fake-id";
    }
    async validateUploadedFileAndSetAcl(
      objectPath: string,
      _owner: string,
      _visibility: "public" | "private" = "private",
      maxSizeBytes: number = actual.MAX_UPLOAD_SIZE_BYTES,
    ): Promise<void> {
      if (objectPath.includes(OVERSIZE_HINT)) {
        throw new Error(
          `Uploaded file exceeds the maximum allowed size of ${maxSizeBytes} bytes. File removed.`,
        );
      }
    }
    async getObjectEntityDownloadURL(_objectPath: string): Promise<string> {
      return "https://storage.googleapis.com/bucket/uploads/fake-id?sig=download";
    }
  }

  return {
    ...actual,
    ObjectStorageService: FakeObjectStorageService,
  };
});

vi.mock("../../server/tenant-middleware", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/tenant-middleware")
  >("../../server/tenant-middleware");
  const passthrough = (_req: Request, _res: Response, next: NextFunction) => next();
  return {
    ...actual,
    requireAdmin: passthrough,
    requirePlanner: passthrough,
    requireRole: () => passthrough,
    getTenantIdWithFallback: () => "tenant-1",
  };
});

vi.mock("../../server/portal-auth", async () => {
  const actual = await vi.importActual<typeof import("../../server/portal-auth")>(
    "../../server/portal-auth",
  );
  return {
    ...actual,
    validateSession: vi.fn(async (_token: string) => ({
      valid: true,
      customerId: "cust-1",
      tenantId: "tenant-1",
      portalUserId: null,
      customer: { id: "cust-1", name: "Testkund", email: "k@example.com" },
    })),
  };
});

vi.mock("../../server/feature-flags", async () => {
  const actual = await vi.importActual<typeof import("../../server/feature-flags")>(
    "../../server/feature-flags",
  );
  return {
    ...actual,
    isModuleEnabled: vi.fn(async () => true),
  };
});

interface WorkOrderRow {
  id: string;
  tenantId: string;
  metadata: Record<string, unknown>;
}

const fakeWorkOrders = new Map<string, WorkOrderRow>();

vi.mock("../../server/storage", async () => {
  const actual = await vi.importActual<typeof import("../../server/storage")>(
    "../../server/storage",
  );
  const fake = {
    ...actual.storage,
    getWorkOrder: vi.fn(async (id: string) => fakeWorkOrders.get(id) ?? null),
    updateWorkOrder: vi.fn(
      async (id: string, _tenantId: string, patch: Record<string, unknown>) => {
        const existing = fakeWorkOrders.get(id);
        if (existing) {
          fakeWorkOrders.set(id, { ...existing, ...patch });
        }
        return existing;
      },
    ),
    getPortalUser: vi.fn(async () => null),
    resolvePortalUserScopeObjectIds: vi.fn(async () => null),
  };
  return {
    ...actual,
    storage: fake,
  };
});

// ---------------------------------------------------------------------------
// Test app harness
// ---------------------------------------------------------------------------

async function buildAppWith(register: (app: Express) => Promise<void> | void): Promise<Express> {
  const expressMod = await import("express");
  const expressFn = (expressMod as unknown as { default?: typeof import("express").default }).default
    ?? (expressMod as unknown as typeof import("express").default);
  const app = expressFn();
  app.use(expressFn.json());
  await register(app);
  // Mirror the global error middleware in server/index.ts so AppError-throwing
  // routes return their proper status code instead of bubbling to a 500.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const status = err instanceof AppError
      ? err.statusCode
      : (err as { status?: number; statusCode?: number })?.status
        ?? (err as { status?: number; statusCode?: number })?.statusCode
        ?? 500;
    const message = err instanceof Error ? err.message : "Ett oväntat serverfel uppstod";
    res.status(status).json({ error: message });
  });
  return app;
}

interface RouteResult {
  status: number;
  body: { error?: string; uploadURL?: string; objectPath?: string; success?: boolean; confirmed?: boolean } | string | null;
}

async function callRoute(
  app: Express,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<RouteResult> {
  const http = await import("http");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Could not allocate test port");
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: RouteResult["body"] = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function bodyAsObject(body: RouteResult["body"]): Record<string, unknown> {
  if (body && typeof body === "object") return body as Record<string, unknown>;
  return {};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Upload-request route guards returnerar 413 för stora filer", () => {
  beforeEach(() => {
    fakeWorkOrders.clear();
  });

  // -- mobile/customer-change-requests/upload-photo --------------------------

  it("POST /api/mobile/customer-change-requests/upload-photo > 15 MB → 413", async () => {
    const helpers = await import("../../server/routes/helpers");
    const token = "test-mobile-token-413";
    helpers.mobileTokens.set(token, {
      resourceId: "res-1",
      tenantId: "tenant-1",
      expiresAt: Date.now() + 60_000,
    });

    const { registerMiscRoutes } = await import("../../server/routes/mobile/misc");
    const app = await buildAppWith((a) => registerMiscRoutes(a));

    const res = await callRoute(
      app,
      "/api/mobile/customer-change-requests/upload-photo",
      { contentType: "image/jpeg", size: MAX_FIELD_PHOTO_SIZE_BYTES + 1 },
      { Authorization: `Bearer ${token}` },
    );

    expect(res.status).toBe(413);
    expect(bodyAsObject(res.body).error).toMatch(/för stor/i);

    helpers.mobileTokens.delete(token);
  });

  it("POST /api/mobile/customer-change-requests/upload-photo precis på gränsen → 200", async () => {
    const helpers = await import("../../server/routes/helpers");
    const token = "test-mobile-token-ok";
    helpers.mobileTokens.set(token, {
      resourceId: "res-1",
      tenantId: "tenant-1",
      expiresAt: Date.now() + 60_000,
    });

    const { registerMiscRoutes } = await import("../../server/routes/mobile/misc");
    const app = await buildAppWith((a) => registerMiscRoutes(a));

    const res = await callRoute(
      app,
      "/api/mobile/customer-change-requests/upload-photo",
      { contentType: "image/jpeg", size: MAX_FIELD_PHOTO_SIZE_BYTES },
      { Authorization: `Bearer ${token}` },
    );

    expect(res.status).toBe(200);
    expect(bodyAsObject(res.body).uploadURL).toBeTruthy();
    expect(bodyAsObject(res.body).objectPath).toBe("/objects/uploads/fake-id");

    helpers.mobileTokens.delete(token);
  });

  it("POST /api/mobile/customer-change-requests/confirm-photo med oversize-fil → 400", async () => {
    const helpers = await import("../../server/routes/helpers");
    const token = "test-mobile-token-confirm";
    helpers.mobileTokens.set(token, {
      resourceId: "res-1",
      tenantId: "tenant-1",
      expiresAt: Date.now() + 60_000,
    });

    const { registerMiscRoutes } = await import("../../server/routes/mobile/misc");
    const app = await buildAppWith((a) => registerMiscRoutes(a));

    const res = await callRoute(
      app,
      "/api/mobile/customer-change-requests/confirm-photo",
      { objectPath: `/objects/uploads/${OVERSIZE_HINT}` },
      { Authorization: `Bearer ${token}` },
    );

    // Routern fångar storage-felet och kastar ValidationError → 400.
    expect(res.status).toBe(400);
    expect(bodyAsObject(res.body).error).toMatch(/exceeds the maximum allowed size|hittades inte/i);

    helpers.mobileTokens.delete(token);
  });

  // -- system/tenant-branding/upload-logo & confirm-logo --------------------

  it("POST /api/system/tenant-branding/upload-logo > 5 MB → 413", async () => {
    const { registerKPIRoutes } = await import("../../server/routes/kpiRoutes");
    const app = await buildAppWith((a) => registerKPIRoutes(a));

    const res = await callRoute(
      app,
      "/api/system/tenant-branding/upload-logo",
      { contentType: "image/png", size: MAX_LOGO_SIZE_BYTES + 1 },
    );

    expect(res.status).toBe(413);
    expect(bodyAsObject(res.body).error).toMatch(/för stor/i);
  });

  it("POST /api/system/tenant-branding/upload-logo precis på gränsen → 200", async () => {
    const { registerKPIRoutes } = await import("../../server/routes/kpiRoutes");
    const app = await buildAppWith((a) => registerKPIRoutes(a));

    const res = await callRoute(
      app,
      "/api/system/tenant-branding/upload-logo",
      { contentType: "image/png", size: MAX_LOGO_SIZE_BYTES },
    );

    expect(res.status).toBe(200);
    expect(bodyAsObject(res.body).uploadURL).toBeTruthy();
    expect(bodyAsObject(res.body).objectPath).toBe("/objects/uploads/fake-id");
  });

  it("POST /api/system/tenant-branding/upload-logo med disallowed contentType → 400", async () => {
    // Defense-in-depth: före storlekskoll avvisas otillåten MIME-typ. Säker-
    // ställer att 413-grenen inte oavsiktligt täcker över MIME-validation.
    const { registerKPIRoutes } = await import("../../server/routes/kpiRoutes");
    const app = await buildAppWith((a) => registerKPIRoutes(a));

    const res = await callRoute(
      app,
      "/api/system/tenant-branding/upload-logo",
      { contentType: "application/x-msdownload", size: 1024 },
    );

    expect(res.status).toBe(400);
  });

  it("POST /api/system/tenant-branding/confirm-logo med oversize-fil → felstatus", async () => {
    // Till skillnad från field-photo-rutterna wrappar confirm-logo inte
    // storage-felet i en ValidationError, så bubble:n blir 500. Kontraktet
    // som testet säkerställer är ändå att rutten INTE returnerar 200 och
    // att felmeddelandet pekar tillbaka till storleksgränsen — annars
    // skulle en framtida regression som råkar släppa igenom oversize-
    // logotyper passera under radarn.
    const { registerKPIRoutes } = await import("../../server/routes/kpiRoutes");
    const app = await buildAppWith((a) => registerKPIRoutes(a));

    const res = await callRoute(
      app,
      "/api/system/tenant-branding/confirm-logo",
      { objectPath: `/objects/uploads/${OVERSIZE_HINT}` },
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).not.toBe(200);
    expect(bodyAsObject(res.body).error).toMatch(/exceeds the maximum allowed size/i);
  });

  it("POST /api/system/tenant-branding/confirm-logo skickar MAX_LOGO_SIZE_BYTES till storage", async () => {
    // Spårar exakt vilket maxSizeBytes-argument rutten skickar in. Om en
    // refaktor av misstag byter till t.ex. MAX_FIELD_PHOTO_SIZE_BYTES skulle
    // 5 MB-taket för logotyper tyst expandera till 15 MB.
    const ossModule = await import(
      "../../server/replit_integrations/object_storage/objectStorage"
    );
    const validateSpy = vi.spyOn(
      ossModule.ObjectStorageService.prototype,
      "validateUploadedFileAndSetAcl",
    );

    const { registerKPIRoutes } = await import("../../server/routes/kpiRoutes");
    const app = await buildAppWith((a) => registerKPIRoutes(a));

    const res = await callRoute(
      app,
      "/api/system/tenant-branding/confirm-logo",
      { objectPath: "/objects/uploads/logo-ok" },
    );

    expect(res.status).toBe(200);
    expect(validateSpy).toHaveBeenCalledTimes(1);
    expect(validateSpy).toHaveBeenCalledWith(
      "/objects/uploads/logo-ok",
      "tenant:tenant-1",
      "public",
      MAX_LOGO_SIZE_BYTES,
    );

    validateSpy.mockRestore();
  });

  it("POST /api/mobile/customer-change-requests/confirm-photo skickar MAX_FIELD_PHOTO_SIZE_BYTES till storage", async () => {
    // Symmetriskt argument-kontrakt-test för field-photo-confirm: säker-
    // ställer att fotorutten skickar in 15 MB-gränsen, inte tex global 50 MB.
    const helpers = await import("../../server/routes/helpers");
    const token = "test-mobile-token-confirm-arg";
    helpers.mobileTokens.set(token, {
      resourceId: "res-1",
      tenantId: "tenant-1",
      expiresAt: Date.now() + 60_000,
    });

    const ossModule = await import(
      "../../server/replit_integrations/object_storage/objectStorage"
    );
    const validateSpy = vi.spyOn(
      ossModule.ObjectStorageService.prototype,
      "validateUploadedFileAndSetAcl",
    );

    const { registerMiscRoutes } = await import("../../server/routes/mobile/misc");
    const app = await buildAppWith((a) => registerMiscRoutes(a));

    const res = await callRoute(
      app,
      "/api/mobile/customer-change-requests/confirm-photo",
      { objectPath: "/objects/uploads/photo-ok" },
      { Authorization: `Bearer ${token}` },
    );

    expect(res.status).toBeLessThan(500);
    expect(validateSpy).toHaveBeenCalled();
    const call = validateSpy.mock.calls[0];
    expect(call[0]).toBe("/objects/uploads/photo-ok");
    expect(call[3]).toBe(MAX_FIELD_PHOTO_SIZE_BYTES);

    validateSpy.mockRestore();
    helpers.mobileTokens.delete(token);
  });

  // -- portal/field/upload-photo & confirm-photo ----------------------------

  it("POST /api/portal/field/upload-photo > 15 MB → 413", async () => {
    const { registerPortalRoutes } = await import("../../server/routes/portalRoutes");
    const app = await buildAppWith((a) => registerPortalRoutes(a));

    const res = await callRoute(
      app,
      "/api/portal/field/upload-photo",
      { contentType: "image/jpeg", size: MAX_FIELD_PHOTO_SIZE_BYTES + 1 },
      { Authorization: "Bearer portal-test-token" },
    );

    expect(res.status).toBe(413);
    expect(bodyAsObject(res.body).error).toMatch(/för stor/i);
  });

  it("POST /api/portal/field/upload-photo precis på gränsen → 200", async () => {
    const { registerPortalRoutes } = await import("../../server/routes/portalRoutes");
    const app = await buildAppWith((a) => registerPortalRoutes(a));

    const res = await callRoute(
      app,
      "/api/portal/field/upload-photo",
      { contentType: "image/jpeg", size: MAX_FIELD_PHOTO_SIZE_BYTES },
      { Authorization: "Bearer portal-test-token" },
    );

    expect(res.status).toBe(200);
    expect(bodyAsObject(res.body).uploadURL).toBeTruthy();
  });

  it("POST /api/portal/field/confirm-photo med oversize-fil → 400", async () => {
    const { registerPortalRoutes } = await import("../../server/routes/portalRoutes");
    const app = await buildAppWith((a) => registerPortalRoutes(a));

    const res = await callRoute(
      app,
      "/api/portal/field/confirm-photo",
      { objectPath: `/objects/uploads/${OVERSIZE_HINT}` },
      { Authorization: "Bearer portal-test-token" },
    );

    expect(res.status).toBe(400);
    expect(bodyAsObject(res.body).error).toMatch(/exceeds the maximum allowed size/i);
  });

  // -- field-worker/tasks/:id/upload-photo & confirm-photo -------------------

  it("POST /api/field-worker/tasks/:id/upload-photo > 15 MB → 413", async () => {
    fakeWorkOrders.set("wo-1", { id: "wo-1", tenantId: "tenant-1", metadata: {} });

    const { registerExtendedRoutes } = await import("../../server/routes/extendedRoutes");
    const app = await buildAppWith((a) => registerExtendedRoutes(a));

    const res = await callRoute(
      app,
      "/api/field-worker/tasks/wo-1/upload-photo",
      { contentType: "image/jpeg", size: MAX_FIELD_PHOTO_SIZE_BYTES + 1 },
    );

    expect(res.status).toBe(413);
    expect(bodyAsObject(res.body).error).toMatch(/för stor/i);
  });

  it("POST /api/field-worker/tasks/:id/upload-photo precis på gränsen → 200", async () => {
    fakeWorkOrders.set("wo-2", { id: "wo-2", tenantId: "tenant-1", metadata: {} });

    const { registerExtendedRoutes } = await import("../../server/routes/extendedRoutes");
    const app = await buildAppWith((a) => registerExtendedRoutes(a));

    const res = await callRoute(
      app,
      "/api/field-worker/tasks/wo-2/upload-photo",
      { contentType: "image/jpeg", size: MAX_FIELD_PHOTO_SIZE_BYTES },
    );

    expect(res.status).toBe(200);
    expect(bodyAsObject(res.body).uploadURL).toBeTruthy();
  });

  it("POST /api/field-worker/tasks/:id/confirm-photo med oversize-fil → 400", async () => {
    fakeWorkOrders.set("wo-3", { id: "wo-3", tenantId: "tenant-1", metadata: {} });

    const { registerExtendedRoutes } = await import("../../server/routes/extendedRoutes");
    const app = await buildAppWith((a) => registerExtendedRoutes(a));

    const res = await callRoute(
      app,
      "/api/field-worker/tasks/wo-3/confirm-photo",
      { objectPath: `/objects/uploads/${OVERSIZE_HINT}`, category: "before" },
    );

    expect(res.status).toBe(400);
    expect(bodyAsObject(res.body).error).toMatch(/exceeds the maximum allowed size/i);
  });
});
