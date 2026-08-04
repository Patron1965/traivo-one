import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerCustomerRoutes } from "../../server/routes/customerRoutes";
import { registerWorkOrderRoutes } from "../../server/routes/workOrderRoutes";
import { registerFortnoxRoutes } from "../../server/routes/fortnoxRoutes";
import { metadataRouter } from "../../server/metadata-routes";
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
  workOrders,
  orderConcepts,
  metadataKatalog,
  metadataVarden,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

// Task #1387: bred cross-tenant attack-svit. Två tenants med varsin användare
// (admin i SIN tenant), kunder, objekt, arbetsordrar, metadata och orderkoncept.
// Användare A attackerar tenant B:s resurser via web-API:t: läs, uppdatera och
// radera ska ge 404 (aldrig 200, aldrig 403 — existens får inte läcka) eller
// tomt resultat för listor/batchar. Positiva kontroller verifierar att samma
// anrop mot egna resurser fungerar (dvs. 404:orna beror på tenant-gränsen,
// inte på trasiga fixtures).
//
// Appen monteras bakom samma tenant-middleware som i prod
// (requireTenantWithFallback) med stubbad auth (x-test-user-id) och
// NODE_ENV=production — samma mönster som object-endpoints-tenant-isolation.test.ts.
// Principer: docs/tenant-isolation.md.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `xti-${Date.now()}`;
const TENANT_A = `${NS}-tenant-a`;
const TENANT_B = `${NS}-tenant-b`;
const USER_A = `${NS}-user-a`;
const USER_B = `${NS}-user-b`;

let customerA = "";
let customerB = "";
let objectA = "";
let objectB = "";
let woA = "";
let woB = "";
let conceptA = "";
let conceptB = "";
let katalogB = "";

async function req(
  method: string,
  path: string,
  userId: string,
  body?: Record<string, unknown>,
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user-id": userId },
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsed = await res.json().catch(() => null);
  return { status: res.status, body: parsed };
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
  await registerCustomerRoutes(app);
  await registerWorkOrderRoutes(app);
  await registerFortnoxRoutes(app);
  app.use("/api/metadata", metadataRouter);
  app.use(errorHandler);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await storage.ensureTenant(TENANT_A, { name: "XTI Tenant A" });
  await storage.ensureTenant(TENANT_B, { name: "XTI Tenant B" });

  await db.insert(users).values([
    { id: USER_A, email: `${USER_A}@test.local` },
    { id: USER_B, email: `${USER_B}@test.local` },
  ]).onConflictDoNothing();
  await db.insert(userTenantRoles).values([
    { userId: USER_A, tenantId: TENANT_A, role: "admin", isActive: true, assignedBy: USER_A },
    { userId: USER_B, tenantId: TENANT_B, role: "admin", isActive: true, assignedBy: USER_B },
  ]).onConflictDoNothing();

  const [cA] = await db.insert(customers).values({ tenantId: TENANT_A, name: `${NS} Kund A` }).returning();
  const [cB] = await db.insert(customers).values({ tenantId: TENANT_B, name: `${NS} Kund B` }).returning();
  customerA = cA.id;
  customerB = cB.id;

  const [oA] = await db.insert(objects).values({ tenantId: TENANT_A, name: `${NS} Objekt A` }).returning();
  const [oB] = await db.insert(objects).values({ tenantId: TENANT_B, name: `${NS} Objekt B` }).returning();
  objectA = oA.id;
  objectB = oB.id;

  const [wA] = await db.insert(workOrders).values({
    tenantId: TENANT_A, customerId: customerA, objectId: objectA, title: `${NS} WO A`,
  }).returning();
  const [wB] = await db.insert(workOrders).values({
    tenantId: TENANT_B, customerId: customerB, objectId: objectB, title: `${NS} WO B`,
  }).returning();
  woA = wA.id;
  woB = wB.id;

  const [ocA] = await db.insert(orderConcepts).values({
    tenantId: TENANT_A, name: `${NS} Koncept A`, customerId: customerA, scenario: "avrop", scheduleType: "once",
  }).returning();
  const [ocB] = await db.insert(orderConcepts).values({
    tenantId: TENANT_B, name: `${NS} Koncept B`, customerId: customerB, scenario: "avrop", scheduleType: "once",
  }).returning();
  conceptA = ocA.id;
  conceptB = ocB.id;

  // Metadata-fält + värde i tenant B — får aldrig läsas/nås från tenant A.
  const [mk] = await db.insert(metadataKatalog).values({
    tenantId: TENANT_B, namn: `${NS}-hemligt-falt`, datatyp: "string",
  }).returning();
  katalogB = mk.id;
  await db.insert(metadataVarden).values({
    tenantId: TENANT_B, objektId: objectB, metadataKatalogId: katalogB, vardeString: "topphemligt-B",
  });
});

afterAll(async () => {
  try {
    await new Promise<void>((r) => server?.close(() => r()));
    await cleanupFixtures();
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

async function cleanupFixtures() {
  await db.delete(metadataVarden).where(inArray(metadataVarden.tenantId, [TENANT_A, TENANT_B]));
  await db.delete(metadataKatalog).where(inArray(metadataKatalog.tenantId, [TENANT_A, TENANT_B]));
  await db.delete(orderConcepts).where(inArray(orderConcepts.tenantId, [TENANT_A, TENANT_B]));
  await db.delete(workOrders).where(inArray(workOrders.tenantId, [TENANT_A, TENANT_B]));
  await db.delete(objects).where(inArray(objects.tenantId, [TENANT_A, TENANT_B]));
  await db.delete(customers).where(inArray(customers.tenantId, [TENANT_A, TENANT_B]));
  await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [USER_A, USER_B]));
  await db.delete(users).where(inArray(users.id, [USER_A, USER_B]));
  await db.delete(tenants).where(inArray(tenants.id, [TENANT_A, TENANT_B]));
}

describe("Cross-tenant-isolering — kunder", () => {
  it("positiv kontroll: A läser sin egen kund", async () => {
    const r = await req("GET", `/api/customers/${customerA}`, USER_A);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(customerA);
  });

  it("GET annan tenants kund → 404", async () => {
    const r = await req("GET", `/api/customers/${customerB}`, USER_A);
    expect(r.status).toBe(404);
  });

  it("PATCH annan tenants kund → 404, ingen ändring skriven", async () => {
    const r = await req("PATCH", `/api/customers/${customerB}`, USER_A, { name: "HACKAD" });
    expect(r.status).toBe(404);
    const [row] = await db.select().from(customers).where(eq(customers.id, customerB));
    expect(row.name).toBe(`${NS} Kund B`);
  });

  it("DELETE annan tenants kund → 404, raden kvar", async () => {
    const r = await req("DELETE", `/api/customers/${customerB}`, USER_A);
    expect(r.status).toBe(404);
    const [row] = await db.select().from(customers).where(eq(customers.id, customerB));
    expect(row.deletedAt).toBeNull();
  });

  it("kundstats/hierarki för annan tenants kund → 404", async () => {
    const stats = await req("GET", `/api/customers/${customerB}/stats`, USER_A);
    expect(stats.status).toBe(404);
    const hier = await req("GET", `/api/customers/${customerB}/hierarchy`, USER_A);
    expect(hier.status).toBe(404);
  });
});

describe("Cross-tenant-isolering — objekt", () => {
  it("positiv kontroll: A läser sitt eget objekt", async () => {
    const r = await req("GET", `/api/objects/${objectA}`, USER_A);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(objectA);
  });

  it("GET annan tenants objekt → 404", async () => {
    const r = await req("GET", `/api/objects/${objectB}`, USER_A);
    expect(r.status).toBe(404);
  });

  it("PATCH annan tenants objekt → 404, ingen ändring skriven", async () => {
    const r = await req("PATCH", `/api/objects/${objectB}`, USER_A, { name: "HACKAT OBJEKT" });
    expect(r.status).toBe(404);
    const [row] = await db.select().from(objects).where(eq(objects.id, objectB));
    expect(row.name).toBe(`${NS} Objekt B`);
  });

  it("DELETE annan tenants objekt → 404, raden kvar", async () => {
    const r = await req("DELETE", `/api/objects/${objectB}`, USER_A);
    expect(r.status).toBe(404);
    const [row] = await db.select().from(objects).where(eq(objects.id, objectB));
    expect(row).toBeDefined();
    expect(row.deletedAt).toBeNull();
  });

  it("objektlistan läcker aldrig andra tenanters objekt", async () => {
    const r = await req("GET", `/api/objects/lookup`, USER_A);
    expect(r.status).toBe(200);
    const ids = (r.body as Array<{ id: string }>).map((o) => o.id);
    expect(ids).toContain(objectA);
    expect(ids).not.toContain(objectB);
  });
});

describe("Cross-tenant-isolering — arbetsordrar", () => {
  it("positiv kontroll: A läser sin egen arbetsorder", async () => {
    const r = await req("GET", `/api/work-orders/${woA}`, USER_A);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(woA);
  });

  it("GET annan tenants arbetsorder → 404", async () => {
    const r = await req("GET", `/api/work-orders/${woB}`, USER_A);
    expect(r.status).toBe(404);
  });

  it("PATCH annan tenants arbetsorder → 404, ingen ändring skriven", async () => {
    const r = await req("PATCH", `/api/work-orders/${woB}`, USER_A, { title: "HACKAD WO" });
    expect(r.status).toBe(404);
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, woB));
    expect(row.title).toBe(`${NS} WO B`);
  });

  it("DELETE annan tenants arbetsorder → 404, raden kvar", async () => {
    const r = await req("DELETE", `/api/work-orders/${woB}`, USER_A);
    expect(r.status).toBe(404);
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, woB));
    expect(row.deletedAt).toBeNull();
  });

  it("cross-tenant-referens: PATCH egen WO med annan tenants objekt-id avvisas", async () => {
    const r = await req("PATCH", `/api/work-orders/${woA}`, USER_A, { objectId: objectB });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, woA));
    expect(row.objectId).toBe(objectA);
  });

  it("cross-tenant-referens: PATCH egen WO med annan tenants kund-id avvisas", async () => {
    const r = await req("PATCH", `/api/work-orders/${woA}`, USER_A, { customerId: customerB });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, woA));
    expect(row.customerId).toBe(customerA);
  });
});

describe("Cross-tenant-isolering — orderkoncept", () => {
  it("positiv kontroll: A läser sitt eget koncept", async () => {
    const r = await req("GET", `/api/order-concepts/${conceptA}`, USER_A);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(conceptA);
  });

  it("GET annan tenants koncept → 404", async () => {
    const r = await req("GET", `/api/order-concepts/${conceptB}`, USER_A);
    expect(r.status).toBe(404);
  });

  it("PATCH annan tenants koncept → 404, ingen ändring skriven", async () => {
    const r = await req("PATCH", `/api/order-concepts/${conceptB}`, USER_A, { name: "HACKAT KONCEPT" });
    expect(r.status).toBe(404);
    const [row] = await db.select().from(orderConcepts).where(eq(orderConcepts.id, conceptB));
    expect(row.name).toBe(`${NS} Koncept B`);
  });

  it("DELETE annan tenants koncept → 404, raden kvar", async () => {
    const r = await req("DELETE", `/api/order-concepts/${conceptB}`, USER_A);
    expect(r.status).toBe(404);
    const [row] = await db.select().from(orderConcepts).where(eq(orderConcepts.id, conceptB));
    expect(row).toBeDefined();
  });
});

describe("Cross-tenant-isolering — metadata", () => {
  it("GET metadata för annan tenants objekt → 404", async () => {
    const r = await req("GET", `/api/metadata/objects/${objectB}`, USER_A);
    expect(r.status).toBe(404);
  });

  it("values-batch med annan tenants objekt-id → tomt (inga värden läcker)", async () => {
    const r = await req("POST", `/api/metadata/objects/values-batch`, USER_A, {
      objectIds: [objectB],
      katalogIds: [katalogB],
    });
    expect(r.status).toBe(200);
    const values = r.body?.values ?? {};
    const flat = JSON.stringify(values);
    expect(flat).not.toContain("topphemligt-B");
  });

  it("katalog-listan läcker aldrig annan tenants fält", async () => {
    const r = await req("GET", `/api/metadata/types`, USER_A);
    expect(r.status).toBe(200);
    const flat = JSON.stringify(r.body);
    expect(flat).not.toContain(`${NS}-hemligt-falt`);
  });
});
