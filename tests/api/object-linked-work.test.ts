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
  workOrders,
  assignments,
} from "@shared/schema";
import { inArray } from "drizzle-orm";

// Task #1474: subträds-medveten uppgiftshämtning för objektöversikten —
// GET /api/objects/:id/linked-work?scope=self|subtree. Vaktar:
//  - scope=self ger bara objektets egna rader
//  - scope=subtree ger även barnens/barnbarnens rader, märkta med objectName
//  - soft-deletade rader utesluts
//  - cross-tenant objekt-id ger 404 (ingen läcka)

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `olw-${Date.now()}`;
const TENANT_A = `${NS}-tenant-a`;
const TENANT_B = `${NS}-tenant-b`;
const USER_A = `${NS}-user-a`;
const USER_B = `${NS}-user-b`;

let customerA = "";
let rootId = "";
let childId = "";
let grandchildId = "";
let objectBId = "";
let capObjectId = "";

// Task #1475: kapningskontraktet — CAP=300 per lista + truncated-flaggor.
const CAP = 300;
const SEED_COUNT = CAP + 5;

async function req(path: string, userId: string) {
  const res = await fetch(`${baseUrl}${path}`, {
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

  await storage.ensureTenant(TENANT_A, { name: "Linked-work Tenant A" });
  await storage.ensureTenant(TENANT_B, { name: "Linked-work Tenant B" });

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

  rootId = (await storage.createObject({ tenantId: TENANT_A, name: `${NS} Rot`, status: "active" } as any)).id;
  childId = (await storage.createObject({ tenantId: TENANT_A, name: `${NS} Barn`, status: "active", parentId: rootId } as any)).id;
  grandchildId = (await storage.createObject({ tenantId: TENANT_A, name: `${NS} Barnbarn`, status: "active", parentId: childId } as any)).id;
  objectBId = (await storage.createObject({ tenantId: TENANT_B, name: `${NS} Objekt B`, status: "active" } as any)).id;

  await db.insert(workOrders).values([
    { tenantId: TENANT_A, customerId: customerA, objectId: rootId, title: `${NS} WO rot` },
    { tenantId: TENANT_A, customerId: customerA, objectId: childId, title: `${NS} WO barn` },
    { tenantId: TENANT_A, customerId: customerA, objectId: grandchildId, title: `${NS} WO barnbarn` },
    { tenantId: TENANT_A, customerId: customerA, objectId: childId, title: `${NS} WO raderad`, deletedAt: new Date() },
  ]);
  await db.insert(assignments).values([
    { tenantId: TENANT_A, customerId: customerA, objectId: childId, title: `${NS} Uppgift barn`, status: "not_planned" },
    { tenantId: TENANT_A, customerId: customerA, objectId: rootId, title: `${NS} Uppgift raderad`, status: "not_planned", deletedAt: new Date() },
  ]);

  // Task #1475: eget objekt med > CAP rader per lista, med distinkta createdAt
  // så att "de 300 senaste" är deterministiskt (nr SEED_COUNT är nyast).
  capObjectId = (await storage.createObject({ tenantId: TENANT_A, name: `${NS} Kapobjekt`, status: "active" } as any)).id;
  const base = Date.parse("2026-01-01T00:00:00Z");
  const woSeed = Array.from({ length: SEED_COUNT }, (_, i) => ({
    tenantId: TENANT_A,
    customerId: customerA,
    objectId: capObjectId,
    title: `${NS} Kap-WO ${i + 1}`,
    createdAt: new Date(base + (i + 1) * 60_000),
  }));
  const asgSeed = Array.from({ length: SEED_COUNT }, (_, i) => ({
    tenantId: TENANT_A,
    customerId: customerA,
    objectId: capObjectId,
    title: `${NS} Kap-uppgift ${i + 1}`,
    status: "not_planned",
    createdAt: new Date(base + (i + 1) * 60_000),
  }));
  // Batcha insert (undvik parameter-tak för fler-rads-INSERT).
  for (let i = 0; i < woSeed.length; i += 100) {
    await db.insert(workOrders).values(woSeed.slice(i, i + 100));
  }
  for (let i = 0; i < asgSeed.length; i += 100) {
    await db.insert(assignments).values(asgSeed.slice(i, i + 100));
  }
}, 120000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  const T = [TENANT_A, TENANT_B];
  await db.delete(assignments).where(inArray(assignments.tenantId, T));
  await db.delete(workOrders).where(inArray(workOrders.tenantId, T));
  await db.delete(objects).where(inArray(objects.tenantId, T));
  await db.delete(customers).where(inArray(customers.tenantId, T));
  await db.delete(userTenantRoles).where(inArray(userTenantRoles.tenantId, T));
  await db.delete(users).where(inArray(users.id, [USER_A, USER_B]));
  await db.delete(tenants).where(inArray(tenants.id, T));
  process.env.NODE_ENV = originalNodeEnv;
}, 60000);

describe("GET /api/objects/:id/linked-work (Task #1474)", () => {
  it("scope=self ger bara objektets egna rader (och aldrig soft-deletade)", async () => {
    const { status, body } = await req(`/api/objects/${rootId}/linked-work`, USER_A);
    expect(status).toBe(200);
    expect(body.scope).toBe("self");
    expect(body.workOrders.map((w: any) => w.title)).toEqual([`${NS} WO rot`]);
    expect(body.assignments).toEqual([]);
    expect(body.truncated).toEqual({ workOrders: false, assignments: false });
  });

  it("scope=subtree ger hela grenens rader märkta med objectName", async () => {
    const { status, body } = await req(`/api/objects/${rootId}/linked-work?scope=subtree`, USER_A);
    expect(status).toBe(200);
    expect(body.scope).toBe("subtree");
    const woTitles = body.workOrders.map((w: any) => w.title).sort();
    expect(woTitles).toEqual([`${NS} WO barn`, `${NS} WO barnbarn`, `${NS} WO rot`].sort());
    const barn = body.workOrders.find((w: any) => w.title === `${NS} WO barn`);
    expect(barn.objectId).toBe(childId);
    expect(barn.objectName).toBe(`${NS} Barn`);
    expect(body.assignments).toHaveLength(1);
    expect(body.assignments[0].objectName).toBe(`${NS} Barn`);
  });

  it("mellannivå: subtree från barnet ger barn + barnbarn men inte roten", async () => {
    const { body } = await req(`/api/objects/${childId}/linked-work?scope=subtree`, USER_A);
    const titles = body.workOrders.map((w: any) => w.title).sort();
    expect(titles).toEqual([`${NS} WO barn`, `${NS} WO barnbarn`].sort());
  });

  it("kapar work_orders vid exakt 300 rader, sätter truncated.workOrders och behåller de senaste (createdAt DESC)", async () => {
    const { status, body } = await req(`/api/objects/${capObjectId}/linked-work`, USER_A);
    expect(status).toBe(200);
    expect(body.workOrders).toHaveLength(CAP);
    expect(body.truncated.workOrders).toBe(true);
    // De 300 senaste = nr SEED_COUNT ned till nr (SEED_COUNT - CAP + 1), i DESC-ordning.
    const expected = Array.from({ length: CAP }, (_, i) => `${NS} Kap-WO ${SEED_COUNT - i}`);
    expect(body.workOrders.map((w: any) => w.title)).toEqual(expected);
  });

  it("kapar assignments vid exakt 300 rader, sätter truncated.assignments och behåller de senaste (createdAt DESC)", async () => {
    const { body } = await req(`/api/objects/${capObjectId}/linked-work`, USER_A);
    expect(body.assignments).toHaveLength(CAP);
    expect(body.truncated.assignments).toBe(true);
    const expected = Array.from({ length: CAP }, (_, i) => `${NS} Kap-uppgift ${SEED_COUNT - i}`);
    expect(body.assignments.map((a: any) => a.title)).toEqual(expected);
  });

  it("cross-tenant objekt-id ger 404", async () => {
    const { status } = await req(`/api/objects/${objectBId}/linked-work`, USER_A);
    expect(status).toBe(404);
  });
});
