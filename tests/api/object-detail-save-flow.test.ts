import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerObjectRoutes } from "../../server/routes/objectRoutes";
import { registerCustomerRoutes } from "../../server/routes/customerRoutes";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
import { errorHandler } from "../../server/middleware/errorHandler";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import {
  tenants,
  users,
  userTenantRoles,
  customers,
  objects,
  objectPayers,
  objectParents,
} from "@shared/schema";
import { inArray } from "drizzle-orm";

// Task #1134: integrationstest för redigera-och-spara-flödet i den nya
// en-sidiga Objektöversikten (ObjectDetailPage, #1128). e2e/runTest blockeras av
// extern Replit-OAuth-consent (memory `testing-replit-auth-blocked.md`), så
// spara-vägen verifieras här på riktigt mot dev-DB:n genom att montera de
// RIKTIGA routrarna (skapa via POST /api/objects, spara via PATCH
// /api/objects/:id, läs tillbaka via GET /api/objects/:id/resolved) bakom samma
// tenant-middleware som i prod. Samma mönster som object-move-copy.test.ts:
// stubbad auth (x-test-user-id → req.user.claims.sub) + NODE_ENV=production.
// Alla rader använder unika värden (NS-prefix) och städas i afterAll.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `odsf-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;
let customerId = "";

async function req(
  method: string,
  path: string,
  opts: { userId?: string | null; body?: unknown } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.userId) headers["x-test-user-id"] = opts.userId;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

beforeAll(async () => {
  originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  const app = express();
  app.use(express.json());
  app.use((reqIn: any, _res, next) => {
    const uid = reqIn.headers["x-test-user-id"];
    if (uid) reqIn.user = { claims: { sub: String(uid) } };
    next();
  });
  app.use("/api", requireTenantWithFallback);
  await registerObjectRoutes(app);
  await registerCustomerRoutes(app);
  app.use(errorHandler);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await storage.ensureTenant(TENANT, { name: "ObjectDetail Save-Flow Test" });
  const c = await storage.createCustomer({
    tenantId: TENANT,
    name: `${NS} Kund`,
    customerNumber: `${NS}-K`,
  });
  customerId = c.id;
  await db
    .insert(users)
    .values([{ id: ADMIN, email: `${ADMIN}@test.local` }])
    .onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values([{ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN }])
    .onConflictDoNothing();
}, 30000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  try {
    await db.delete(objectParents).where(inArray(objectParents.tenantId, [TENANT]));
    await db.delete(objectPayers).where(inArray(objectPayers.tenantId, [TENANT]));
    await db.delete(objects).where(inArray(objects.tenantId, [TENANT]));
    await db.delete(customers).where(inArray(customers.tenantId, [TENANT]));
    await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [ADMIN]));
    await db.delete(users).where(inArray(users.id, [ADMIN]));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT]));
  } catch (err) {
    console.warn("Cleanup (object-detail-save-flow.test) ofullständig:", err);
  }
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("ObjectDetailPage spara-flöde — POST/PATCH /api/objects mot dev-DB", () => {
  let objectId = "";

  it("skapar ett objekt (POST /api/objects) med unika värden", async () => {
    const res = await req("POST", "/api/objects", {
      userId: ADMIN,
      body: {
        name: `${NS} Originalnamn`,
        customerId,
        objectType: "karl",
        objectLevel: 1,
        status: "active",
        address: `${NS} Gamla gatan 1`,
        city: "Gammelstad",
        postalCode: "11111",
      },
    });
    expect(res.status).toBe(201);
    expect(res.body?.id).toBeTruthy();
    expect(res.body?.name).toBe(`${NS} Originalnamn`);
    objectId = res.body.id;
  });

  it("sparar redigerade fält (PATCH /api/objects/:id)", async () => {
    const res = await req("PATCH", `/api/objects/${objectId}`, {
      userId: ADMIN,
      body: {
        name: `${NS} Nytt namn`,
        address: `${NS} Nya vägen 42`,
        city: "Nystad",
        postalCode: "22222",
        notes: `${NS} sparad anteckning`,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body?.name).toBe(`${NS} Nytt namn`);
    expect(res.body?.address).toBe(`${NS} Nya vägen 42`);
    expect(res.body?.city).toBe("Nystad");
  });

  it("läser tillbaka de sparade värdena (GET /api/objects/:id/resolved)", async () => {
    const res = await req("GET", `/api/objects/${objectId}/resolved`, { userId: ADMIN });
    expect(res.status).toBe(200);
    expect(res.body?.name).toBe(`${NS} Nytt namn`);
    expect(res.body?.address).toBe(`${NS} Nya vägen 42`);
    expect(res.body?.city).toBe("Nystad");
    expect(res.body?.postalCode).toBe("22222");
    expect(res.body?.notes).toBe(`${NS} sparad anteckning`);
  });

  it("verifierar att ändringen faktiskt persisterats i DB", async () => {
    const persisted = await storage.getObject(objectId);
    expect(persisted?.name).toBe(`${NS} Nytt namn`);
    expect(persisted?.address).toBe(`${NS} Nya vägen 42`);
    expect(persisted?.tenantId).toBe(TENANT);
  });

  it("avvisar spara på objekt i annan tenant (404, ingen läcka)", async () => {
    const res = await req("PATCH", `/api/objects/${objectId}`, {
      userId: null,
      body: { name: `${NS} Otillåtet` },
    });
    expect(res.status).not.toBe(200);
    const persisted = await storage.getObject(objectId);
    expect(persisted?.name).toBe(`${NS} Nytt namn`);
  });
});
