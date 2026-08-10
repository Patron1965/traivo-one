import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
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
  orderConcepts,
  workOrders,
  assignments,
} from "@shared/schema";
import { inArray } from "drizzle-orm";

// Task #1381: HTTP-nivå regressionsvakt för cross-tenant-isolering på
// objektsidans endpoints /api/objects/:id/work-orders och /api/objects/:id/assignments
// (Task #1370 lade tenant-predikat i joinarna resp. skrev om till direkt scopad query).
//
// Två tenants med varsitt objekt/koncept/ordrar/uppgifter:
//  - rätt tenant får sina rader inkl. sourceType/orderConceptName
//  - fel tenant får 404 på den andres objekt-id
//  - koncept-/kundnamn från fel tenant läcker aldrig in i joinarna
//  - caps: work-orders max 50, assignments max 100

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `oti-${Date.now()}`;
const TENANT_A = `${NS}-tenant-a`;
const TENANT_B = `${NS}-tenant-b`;
const USER_A = `${NS}-user-a`;
const USER_B = `${NS}-user-b`;

let customerA = "";
let customerB = "";
let objectA = "";
let objectB = "";
let conceptA = "";
let conceptB = "";

async function req(path: string, userId: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", "x-test-user-id": userId },
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
  await registerCustomerRoutes(app);
  app.use(errorHandler);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await storage.ensureTenant(TENANT_A, { name: "Isolation Test Tenant A" });
  await storage.ensureTenant(TENANT_B, { name: "Isolation Test Tenant B" });

  await db.insert(users).values([
    { id: USER_A, email: `${USER_A}@test.local` },
    { id: USER_B, email: `${USER_B}@test.local` },
  ]).onConflictDoNothing();
  await db.insert(userTenantRoles).values([
    { userId: USER_A, tenantId: TENANT_A, role: "admin", isActive: true, assignedBy: USER_A },
    { userId: USER_B, tenantId: TENANT_B, role: "admin", isActive: true, assignedBy: USER_B },
  ]).onConflictDoNothing();

  const [cA] = await db.insert(customers).values({ tenantId: TENANT_A, name: `${NS} Kund A` }).returning();
  customerA = cA.id;
  const [cB] = await db.insert(customers).values({ tenantId: TENANT_B, name: `${NS} Kund B` }).returning();
  customerB = cB.id;

  const oA = await storage.createObject({ tenantId: TENANT_A, name: `${NS} Objekt A`, status: "active" } as any);
  objectA = oA.id;
  const oB = await storage.createObject({ tenantId: TENANT_B, name: `${NS} Objekt B`, status: "active" } as any);
  objectB = oB.id;

  const [ocA] = await db.insert(orderConcepts).values({
    tenantId: TENANT_A, name: `${NS} Koncept A`, customerId: customerA, scenario: "avrop", scheduleType: "once",
  }).returning();
  conceptA = ocA.id;
  const [ocB] = await db.insert(orderConcepts).values({
    tenantId: TENANT_B, name: `${NS} Koncept B`, customerId: customerB, scenario: "avrop", scheduleType: "once",
  }).returning();
  conceptB = ocB.id;

  // Tenant A: 55 work orders på objektA (för 50-cap) — en pekar på koncept A.
  await db.insert(workOrders).values(
    Array.from({ length: 55 }, (_, i) => ({
      tenantId: TENANT_A,
      customerId: customerA,
      objectId: objectA,
      title: `${NS} WO A ${i}`,
      sourceType: "orderkoncept",
      orderConceptId: conceptA,
    })),
  );
  // Tenant B: en enda order på objektB.
  await db.insert(workOrders).values({
    tenantId: TENANT_B, customerId: customerB, objectId: objectB,
    title: `${NS} WO B`, sourceType: "orderkoncept", orderConceptId: conceptB,
  });

  // Tenant A: 105 assignments på objektA (för 100-cap), kopplade till koncept A.
  await db.insert(assignments).values(
    Array.from({ length: 105 }, (_, i) => ({
      tenantId: TENANT_A,
      customerId: customerA,
      objectId: objectA,
      orderConceptId: conceptA,
      title: `${NS} Uppgift A ${i}`,
      status: "not_planned",
      sourceType: "orderkoncept",
    })),
  );
  // Tenant B: en enda assignment på objektB.
  await db.insert(assignments).values({
    tenantId: TENANT_B, customerId: customerB, objectId: objectB, orderConceptId: conceptB,
    title: `${NS} Uppgift B`, status: "not_planned", sourceType: "orderkoncept",
  });

  // Adversariell fixtur: rader ÄGDA av tenant A som (felaktigt) pekar på
  // tenant B:s koncept. Utan tenant-predikat i joinarna skulle endpointsen
  // berika dessa med B:s koncept-/kundnamn — det är exakt läckan Task #1370
  // stängde och som testet ska vakta.
  await db.insert(workOrders).values({
    tenantId: TENANT_A, customerId: customerA, objectId: objectA,
    title: `${NS} WO A cross-ref`, sourceType: "orderkoncept", orderConceptId: conceptB,
  });
  await db.insert(assignments).values({
    tenantId: TENANT_A, customerId: customerA, objectId: objectA, orderConceptId: conceptB,
    title: `${NS} Uppgift A cross-ref`, status: "not_planned", sourceType: "orderkoncept",
  });
}, 60000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  const T = [TENANT_A, TENANT_B];
  try {
    await db.delete(assignments).where(inArray(assignments.tenantId, T));
    await db.delete(workOrders).where(inArray(workOrders.tenantId, T));
    await db.delete(orderConcepts).where(inArray(orderConcepts.tenantId, T));
    await db.delete(objects).where(inArray(objects.tenantId, T));
    await db.delete(customers).where(inArray(customers.tenantId, T));
    await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [USER_A, USER_B]));
    await db.delete(users).where(inArray(users.id, [USER_A, USER_B]));
    await db.delete(tenants).where(inArray(tenants.id, T));
  } catch (err) {
    console.warn("Cleanup (object-endpoints-tenant-isolation.test) ofullständig:", err);
  }
  process.env.NODE_ENV = originalNodeEnv;
}, 60000);

describe("GET /api/objects/:id/work-orders — tenant-isolering (Task #1381)", () => {
  it("rätt tenant får sina rader inkl. sourceType/orderConceptName, cap 50", async () => {
    const res = await req(`/api/objects/${objectA}/work-orders`, USER_A);
    expect(res.status).toBe(200);
    const rows = res.body as any[];
    expect(Array.isArray(rows)).toBe(true);
    // 56 skapade — capen är 50.
    expect(rows.length).toBe(50);
    for (const wo of rows) {
      expect(wo.tenantId).toBe(TENANT_A);
      expect(wo.objectId).toBe(objectA);
      expect(wo.sourceType).toBe("orderkoncept");
    }
    // Normal berikning: A-kopplade rader får konceptnamnet.
    const normal = rows.filter((wo: any) => wo.orderConceptId === conceptA);
    expect(normal.length).toBeGreaterThan(0);
    for (const wo of normal) expect(wo.orderConceptName).toBe(`${NS} Koncept A`);
  });

  it("adversariell rad: A-ägd order som pekar på B:s koncept berikas ALDRIG med B:s namn", async () => {
    const res = await req(`/api/objects/${objectA}/work-orders`, USER_A);
    expect(res.status).toBe(200);
    const rows = res.body as any[];
    const crossRef = rows.find((wo) => wo.title === `${NS} WO A cross-ref`);
    // Nyaste raden — ska finnas inom capen.
    expect(crossRef).toBeDefined();
    expect(crossRef.orderConceptId).toBe(conceptB);
    // Tenant-predikatet i koncept-lookupen ska stoppa berikningen.
    expect(crossRef.orderConceptName).toBeNull();
    expect(JSON.stringify(rows)).not.toContain(`${NS} Koncept B`);
  });

  it("tenant B ser bara sin egen order på sitt objekt", async () => {
    const res = await req(`/api/objects/${objectB}/work-orders`, USER_B);
    expect(res.status).toBe(200);
    const rows = res.body as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe(`${NS} WO B`);
    expect(rows[0].orderConceptName).toBe(`${NS} Koncept B`);
  });

  it("cross-tenant: fel tenants objekt ger 404 (åt båda hållen)", async () => {
    const resBA = await req(`/api/objects/${objectA}/work-orders`, USER_B);
    expect(resBA.status).toBe(404);
    const resAB = await req(`/api/objects/${objectB}/work-orders`, USER_A);
    expect(resAB.status).toBe(404);
  });
});

describe("GET /api/objects/:id/assignments — tenant-isolering (Task #1381)", () => {
  it("rätt tenant får sina rader inkl. sourceType/orderConceptName/kundnamn, cap 100", async () => {
    const res = await req(`/api/objects/${objectA}/assignments`, USER_A);
    expect(res.status).toBe(200);
    const rows = res.body as any[];
    // 106 skapade — capen är 100.
    expect(rows.length).toBe(100);
    for (const a of rows) {
      expect(a.sourceType).toBe("orderkoncept");
    }
    // Normal berikning: A-kopplade rader får koncept- och kundnamn.
    const normal = rows.filter((r: any) => r.orderConceptId === conceptA);
    expect(normal.length).toBeGreaterThan(0);
    for (const a of normal) {
      expect(a.orderConceptName).toBe(`${NS} Koncept A`);
      expect(a.customerId).toBe(customerA);
      expect(a.customerName).toBe(`${NS} Kund A`);
    }
    // Inga koncept-/kundnamn från tenant B läcker in.
    const allNames = rows.map((r) => `${r.orderConceptName}|${r.customerName}`).join(",");
    expect(allNames).not.toContain("Koncept B");
    expect(allNames).not.toContain("Kund B");
  });

  it("adversariell rad: A-ägd uppgift som pekar på B:s koncept berikas ALDRIG med B:s koncept/kund", async () => {
    const res = await req(`/api/objects/${objectA}/assignments`, USER_A);
    expect(res.status).toBe(200);
    const rows = res.body as any[];
    const crossRef = rows.find((r) => r.title === `${NS} Uppgift A cross-ref`);
    // Nyaste raden — ska finnas inom capen.
    expect(crossRef).toBeDefined();
    expect(crossRef.orderConceptId).toBe(conceptB);
    // Tenant-predikaten i join:arna ska stoppa berikningen helt.
    expect(crossRef.orderConceptName).toBeNull();
    expect(crossRef.customerId).toBeNull();
    expect(crossRef.customerName).toBeNull();
    expect(JSON.stringify(rows)).not.toContain(`${NS} Koncept B`);
    expect(JSON.stringify(rows)).not.toContain(`${NS} Kund B`);
  });

  it("tenant B ser bara sin egen uppgift med sitt koncept/kund", async () => {
    const res = await req(`/api/objects/${objectB}/assignments`, USER_B);
    expect(res.status).toBe(200);
    const rows = res.body as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe(`${NS} Uppgift B`);
    expect(rows[0].orderConceptName).toBe(`${NS} Koncept B`);
    expect(rows[0].customerName).toBe(`${NS} Kund B`);
  });

  it("cross-tenant: fel tenants objekt ger 404 (åt båda hållen)", async () => {
    const resBA = await req(`/api/objects/${objectA}/assignments`, USER_B);
    expect(resBA.status).toBe(404);
    const resAB = await req(`/api/objects/${objectB}/assignments`, USER_A);
    expect(resAB.status).toBe(404);
  });
});
