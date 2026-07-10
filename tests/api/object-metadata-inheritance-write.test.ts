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
  metadataKatalog,
  metadataVarden,
  metadataHistorik,
} from "@shared/schema";
import { inArray, eq } from "drizzle-orm";

// Objektvy 360 (P0): integrationstest för den "skottsäkra" arvs-skrivsemantiken —
// de två (och enda två) skrivvägarna på ett objekts metadata:
//   PATCH /api/objects/:id/metadata/edit-source   (ändra BEFINTLIGT värde på källan)
//   POST  /api/objects/:id/metadata/new-instance  (skapa NYTT värde på vald nivå)
// e2e/runTest blockeras av extern Replit-OAuth (memory `testing-replit-auth-blocked`),
// så vägarna verifieras här mot dev-DB:n med de RIKTIGA routrarna bakom samma
// tenant-middleware som i prod (stubbad auth: x-test-user-id → req.user.claims.sub,
// NODE_ENV=production). Samma harness-mönster som object-detail-save-flow.test.ts.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `omiw-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;
const FIELD_SINGLE = `${NS}_Kontakt`; // allowDuplicates=false → enkelvärt (arv/edit-på-källan)
const FIELD_MULTI = `${NS}_Yta`; // allowDuplicates=true → flera instanser tillåtna
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

async function createObject(name: string): Promise<string> {
  const res = await req("POST", "/api/objects", {
    userId: ADMIN,
    body: { name, customerId, objectType: "karl", objectLevel: 1, status: "active" },
  });
  expect(res.status).toBe(201);
  expect(res.body?.id).toBeTruthy();
  return res.body.id as string;
}

let parentId = "";
let childId = "";
let unrelatedId = "";
let singleKatalogId = "";

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

  await storage.ensureTenant(TENANT, { name: "Objekt-metadata arv-skriv Test" });
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

  // Katalogfält: ett enkelvärt (arv) + ett flervärt (instanser).
  const [single] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: FIELD_SINGLE, datatyp: "string", standardArvs: true, allowDuplicates: false })
    .returning({ id: metadataKatalog.id });
  singleKatalogId = single.id;
  await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: FIELD_MULTI, datatyp: "string", standardArvs: true, allowDuplicates: true });

  // Hierarki: child → parent (primär). unrelated står utanför kedjan.
  parentId = await createObject(`${NS} Förälder`);
  childId = await createObject(`${NS} Barn`);
  unrelatedId = await createObject(`${NS} Orelaterad`);
  const link = await req("POST", `/api/objects/${childId}/parents`, {
    userId: ADMIN,
    body: { parentId },
  });
  expect(link.status).toBe(201);
  const persistedChild = await storage.getObject(childId);
  expect(persistedChild?.parentId).toBe(parentId); // objects.parentId speglar primär
}, 40000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  try {
    await db.delete(metadataHistorik).where(inArray(metadataHistorik.tenantId, [TENANT]));
    await db.delete(metadataVarden).where(inArray(metadataVarden.tenantId, [TENANT]));
    await db.delete(metadataKatalog).where(inArray(metadataKatalog.tenantId, [TENANT]));
    await db.delete(objectParents).where(inArray(objectParents.tenantId, [TENANT]));
    await db.delete(objects).where(inArray(objects.tenantId, [TENANT]));
    await db.delete(customers).where(inArray(customers.tenantId, [TENANT]));
    await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [ADMIN]));
    await db.delete(users).where(inArray(users.id, [ADMIN]));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT]));
  } catch (err) {
    console.warn("Cleanup (object-metadata-inheritance-write.test) ofullständig:", err);
  }
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("Objektvy 360 P0 — arvs-skrivsemantik (edit-source / new-instance)", () => {
  let sourceVardeId = "";
  let unrelatedVardeId = "";

  it("new-instance: skapar ett enkelvärt fält på FÖRÄLDER-nivå (i kedjan) → 201, ärvs nedåt", async () => {
    const res = await req("POST", `/api/objects/${parentId}/metadata/new-instance`, {
      userId: ADMIN,
      body: { metadataTypNamn: FIELD_SINGLE, varde: "Anna 070-111 11 11", level: parentId },
    });
    expect(res.status).toBe(201);
    expect(res.body?.id).toBeTruthy();
    expect(res.body?.objektId).toBe(parentId);
    expect(res.body?.arvsNedat).toBe(true);
    sourceVardeId = res.body.id;
  });

  it("edit-source: barnet redigerar det ÄRVDA värdet på källan (föräldern) → 200 + propagerar", async () => {
    const res = await req("PATCH", `/api/objects/${childId}/metadata/edit-source`, {
      userId: ADMIN,
      body: { vardeId: sourceVardeId, varde: "Anna 070-222 22 22" },
    });
    expect(res.status).toBe(200);
    // Värdet ändrades PÅ KÄLLAN (förälder-raden) — inte en ny lokal rad på barnet.
    const [srcRow] = await db
      .select({ objektId: metadataVarden.objektId, vardeString: metadataVarden.vardeString })
      .from(metadataVarden)
      .where(eq(metadataVarden.id, sourceVardeId));
    expect(srcRow?.objektId).toBe(parentId);
    expect(srcRow?.vardeString).toBe("Anna 070-222 22 22");
  });

  it("shadow-spärr: barnet kan INTE skapa ett nytt enkelvärt värde på egen nivå (ärvs redan) → 400", async () => {
    const res = await req("POST", `/api/objects/${childId}/metadata/new-instance`, {
      userId: ADMIN,
      body: { metadataTypNamn: FIELD_SINGLE, varde: "Lokalt avvikande", level: childId },
    });
    expect(res.status).toBe(400);
    expect(String(res.body?.error ?? res.body?.message ?? "")).toMatch(/ärvs redan|källan/i);
    // Ingen lokal rad ska ha skapats på barnet.
    const shadow = await db
      .select({ id: metadataVarden.id })
      .from(metadataVarden)
      .where(eq(metadataVarden.objektId, childId));
    expect(shadow.length).toBe(0);
  });

  it("edit-source IDOR: värde som tillhör ett OBJEKT UTANFÖR kedjan avvisas → 400", async () => {
    const seed = await req("POST", `/api/objects/${unrelatedId}/metadata/new-instance`, {
      userId: ADMIN,
      body: { metadataTypNamn: FIELD_SINGLE, varde: "Orelaterat", level: unrelatedId },
    });
    expect(seed.status).toBe(201);
    unrelatedVardeId = seed.body.id;

    const res = await req("PATCH", `/api/objects/${childId}/metadata/edit-source`, {
      userId: ADMIN,
      body: { vardeId: unrelatedVardeId, varde: "Kapning" },
    });
    expect(res.status).toBe(400);
    expect(String(res.body?.error ?? res.body?.message ?? "")).toMatch(/arvskedja/i);
    // Orelaterade värdet är oförändrat.
    const [row] = await db
      .select({ vardeString: metadataVarden.vardeString })
      .from(metadataVarden)
      .where(eq(metadataVarden.id, unrelatedVardeId));
    expect(row?.vardeString).toBe("Orelaterat");
  });

  it("new-instance: nivå UTANFÖR primära kedjan avvisas → 400", async () => {
    const res = await req("POST", `/api/objects/${childId}/metadata/new-instance`, {
      userId: ADMIN,
      body: { metadataTypNamn: FIELD_MULTI, varde: "90 m²", level: unrelatedId },
    });
    expect(res.status).toBe(400);
    expect(String(res.body?.error ?? res.body?.message ?? "")).toMatch(/primära arvskedja/i);
  });

  it("new-instance: flervärt fält tillåter en instans på förälder OCH en på barn → 201 + 201", async () => {
    const atParent = await req("POST", `/api/objects/${parentId}/metadata/new-instance`, {
      userId: ADMIN,
      body: { metadataTypNamn: FIELD_MULTI, varde: "250 m²", level: parentId },
    });
    expect(atParent.status).toBe(201);

    const atChild = await req("POST", `/api/objects/${childId}/metadata/new-instance`, {
      userId: ADMIN,
      body: { metadataTypNamn: FIELD_MULTI, varde: "90 m²", level: childId },
    });
    expect(atChild.status).toBe(201);
    expect(atChild.body?.objektId).toBe(childId);
  });

  it("edit-source: okänt värde-id → 404", async () => {
    const res = await req("PATCH", `/api/objects/${childId}/metadata/edit-source`, {
      userId: ADMIN,
      body: { vardeId: "00000000-0000-0000-0000-000000000000", varde: "x" },
    });
    expect(res.status).toBe(404);
  });
});
