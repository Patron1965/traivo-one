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
  objectParents,
  objectHeaderConfigs,
  objectQuickFieldConfigs,
  metadataKatalog,
} from "@shared/schema";
import { inArray } from "drizzle-orm";

// Objektvy 360 (P1): integrationstest för PER-OBJEKT snabbfälts-konfigen och dess
// nedåt-arv genom den primära förälderkedjan. Verifierar resolvern via de RIKTIGA
// GET/PUT/DELETE-routrarna bakom samma tenant-middleware som prod. Samma harness-
// mönster som object-metadata-inheritance-write.test.ts (stubbad auth via
// x-test-user-id, NODE_ENV=production). e2e blockeras av extern Replit-OAuth.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `oqfc-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;
let customerId = "";
let parentId = "";
let childId = "";
let unrelatedId = "";
let katA = "";
let katB = "";
let katC = "";

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

async function createObject(name: string): Promise<string> {
  const res = await req("POST", "/api/objects", {
    userId: ADMIN,
    body: { name, customerId, status: "active" },
  });
  expect(res.status).toBe(201);
  const id = res.body.id as string;
  // Klassificering (objekttyp) är nu metadata (Task #1486) — objectHeaderConfigs-
  // fallbacken slår upp objekttypen "karl" ur metadatat, så spegla in den.
  const { mirrorClassificationToMetadata } = await import("../../server/services/object-classification");
  await mirrorClassificationToMetadata(TENANT, id, { objectType: "karl" });
  return id;
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

  await storage.ensureTenant(TENANT, { name: "Snabbfälts-konfig Test" });
  const c = await storage.createCustomer({
    tenantId: TENANT,
    name: `${NS} Kund`,
    customerNumber: `${NS}-K`,
  });
  customerId = c.id;
  await db.insert(users).values([{ id: ADMIN, email: `${ADMIN}@test.local` }]).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values([{ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN }])
    .onConflictDoNothing();

  const kats = await db
    .insert(metadataKatalog)
    .values([
      { tenantId: TENANT, namn: `${NS}_A`, datatyp: "string" },
      { tenantId: TENANT, namn: `${NS}_B`, datatyp: "string" },
      { tenantId: TENANT, namn: `${NS}_C`, datatyp: "string" },
    ])
    .returning({ id: metadataKatalog.id });
  [katA, katB, katC] = kats.map((k) => k.id);

  parentId = await createObject(`${NS} Förälder`);
  childId = await createObject(`${NS} Barn`);
  unrelatedId = await createObject(`${NS} Orelaterad`);
  const link = await req("POST", `/api/objects/${childId}/parents`, {
    userId: ADMIN,
    body: { parentId },
  });
  expect(link.status).toBe(201);
}, 40000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  try {
    await db.delete(objectQuickFieldConfigs).where(inArray(objectQuickFieldConfigs.tenantId, [TENANT]));
    await db.delete(objectHeaderConfigs).where(inArray(objectHeaderConfigs.tenantId, [TENANT]));
    await db.delete(metadataKatalog).where(inArray(metadataKatalog.tenantId, [TENANT]));
    await db.delete(objectParents).where(inArray(objectParents.tenantId, [TENANT]));
    await db.delete(objects).where(inArray(objects.tenantId, [TENANT]));
    await db.delete(customers).where(inArray(customers.tenantId, [TENANT]));
    await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [ADMIN]));
    await db.delete(users).where(inArray(users.id, [ADMIN]));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT]));
  } catch (err) {
    console.warn("Cleanup (object-quick-field-config.test) ofullständig:", err);
  }
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("Objektvy 360 P1 — snabbfälts-konfig (arv nedåt / åsidosättning)", () => {
  it("GET utan någon konfig → tom, source=none, ingen egen åsidosättning", async () => {
    const res = await req("GET", `/api/objects/${childId}/quick-field-config`, { userId: ADMIN });
    expect(res.status).toBe(200);
    expect(res.body?.fields).toEqual([]);
    expect(res.body?.source?.level).toBe("none");
    expect(res.body?.hasOwnOverride).toBe(false);
  });

  it("PUT på FÖRÄLDER → barnet ärver konfigen nedåt (source=object=förälder)", async () => {
    const put = await req("PUT", `/api/objects/${parentId}/quick-field-config`, {
      userId: ADMIN,
      body: { field1KatalogId: katA, field2KatalogId: katB },
    });
    expect(put.status).toBe(200);
    expect(put.body?.hasOwnOverride).toBe(true);
    expect(put.body?.fields.map((f: any) => f.katalogId)).toEqual([katA, katB]);

    const child = await req("GET", `/api/objects/${childId}/quick-field-config`, { userId: ADMIN });
    expect(child.status).toBe(200);
    expect(child.body?.source).toEqual({ level: "object", objectId: parentId });
    expect(child.body?.hasOwnOverride).toBe(false);
    expect(child.body?.fields.map((f: any) => f.katalogId)).toEqual([katA, katB]);
  });

  it("PUT på BARN → närmast-vinner: barnets egen konfig åsidosätter förälderns", async () => {
    const put = await req("PUT", `/api/objects/${childId}/quick-field-config`, {
      userId: ADMIN,
      body: { field1KatalogId: katC },
    });
    expect(put.status).toBe(200);
    expect(put.body?.source).toEqual({ level: "object", objectId: childId });
    expect(put.body?.hasOwnOverride).toBe(true);
    expect(put.body?.fields.map((f: any) => f.katalogId)).toEqual([katC]);
  });

  it("tom PUT på barnet = medvetet inga snabbfält här (åsidosätter förälderns arv med tomt)", async () => {
    const put = await req("PUT", `/api/objects/${childId}/quick-field-config`, {
      userId: ADMIN,
      body: {},
    });
    expect(put.status).toBe(200);
    expect(put.body?.fields).toEqual([]);
    // En egen (tom) rad finns → source pekar på barnet, INTE föräldern.
    expect(put.body?.source).toEqual({ level: "object", objectId: childId });
    expect(put.body?.hasOwnOverride).toBe(true);
  });

  it("DELETE på barnet → åsidosättningen tas bort, barnet ärver förälderns konfig igen", async () => {
    const del = await req("DELETE", `/api/objects/${childId}/quick-field-config`, { userId: ADMIN });
    expect(del.status).toBe(200);
    expect(del.body?.hasOwnOverride).toBe(false);
    expect(del.body?.source).toEqual({ level: "object", objectId: parentId });
    expect(del.body?.fields.map((f: any) => f.katalogId)).toEqual([katA, katB]);
  });

  it("fallback: objectHeaderConfigs per objekttyp när inget objekt i kedjan har egen rad", async () => {
    // Rensa förälderns per-objekt-rad → kedjan saknar per-objekt-konfig.
    await req("DELETE", `/api/objects/${parentId}/quick-field-config`, { userId: ADMIN });
    // Sätt en tenant-omfattande objecttyp-default för "karl".
    const hdr = await req("PUT", `/api/object-header-config/karl`, {
      userId: ADMIN,
      body: { field1KatalogId: katB },
    });
    expect(hdr.status).toBe(200);

    const child = await req("GET", `/api/objects/${childId}/quick-field-config`, { userId: ADMIN });
    expect(child.status).toBe(200);
    expect(child.body?.source).toEqual({ level: "objectType", objectType: "karl" });
    expect(child.body?.fields.map((f: any) => f.katalogId)).toEqual([katB]);
  });

  // Task #1366: sista fallback — katalogfält flaggade "Visa i objektvinjett".
  it("fallback: visaIVinjett-flaggade katalogfält när varken per-objekt- eller objekttyp-konfig finns", async () => {
    // Rensa objekttyp-defaulten så kedjan är helt utan explicit konfig.
    await db.delete(objectHeaderConfigs).where(inArray(objectHeaderConfigs.tenantId, [TENANT]));
    // Flagga B och C (ordning styrs av displayNumber NULLS LAST, sortOrder, namn).
    await db
      .update(metadataKatalog)
      .set({ visaIVinjett: true, sortOrder: 2 })
      .where(inArray(metadataKatalog.id, [katC]));
    await db
      .update(metadataKatalog)
      .set({ visaIVinjett: true, sortOrder: 1 })
      .where(inArray(metadataKatalog.id, [katB]));

    const child = await req("GET", `/api/objects/${childId}/quick-field-config`, { userId: ADMIN });
    expect(child.status).toBe(200);
    expect(child.body?.source).toEqual({ level: "katalog" });
    expect(child.body?.hasOwnOverride).toBe(false);
    expect(child.body?.fields.map((f: any) => f.katalogId)).toEqual([katB, katC]);
  });

  it("explicit konfig vinner alltid över visaIVinjett-flaggan", async () => {
    const hdr = await req("PUT", `/api/object-header-config/karl`, {
      userId: ADMIN,
      body: { field1KatalogId: katA },
    });
    expect(hdr.status).toBe(200);
    const child = await req("GET", `/api/objects/${childId}/quick-field-config`, { userId: ADMIN });
    expect(child.body?.source).toEqual({ level: "objectType", objectType: "karl" });
    expect(child.body?.fields.map((f: any) => f.katalogId)).toEqual([katA]);
  });

  // Task #1366: kundlogotyp-konfig sparas och returneras på header-configen.
  it("PUT object-header-config persisterar showLogo + logoMetadataKatalogId", async () => {
    const put = await req("PUT", `/api/object-header-config/karl`, {
      userId: ADMIN,
      body: { showLogo: true, logoMetadataKatalogId: katA },
    });
    expect(put.status).toBe(200);
    expect(put.body?.showLogo).toBe(true);
    expect(put.body?.logoMetadataKatalogId).toBe(katA);

    const get = await req("GET", `/api/object-header-config/karl`, { userId: ADMIN });
    expect(get.status).toBe(200);
    expect(get.body?.showLogo).toBe(true);
    expect(get.body?.logoMetadataKatalogId).toBe(katA);
  });

  it("PUT object-header-config med logotyp-fält från annan organisation avvisas → 400", async () => {
    const res = await req("PUT", `/api/object-header-config/karl`, {
      userId: ADMIN,
      body: { showLogo: true, logoMetadataKatalogId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(400);
  });

  it("PUT med katalog-id från annan/okänd organisation avvisas → 400 (IDOR-skydd)", async () => {
    const res = await req("PUT", `/api/objects/${childId}/quick-field-config`, {
      userId: ADMIN,
      body: { field1KatalogId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(400);
  });

  it("GET på okänt objekt → 404", async () => {
    const res = await req("GET", `/api/objects/00000000-0000-0000-0000-000000000000/quick-field-config`, {
      userId: ADMIN,
    });
    expect(res.status).toBe(404);
  });
});
