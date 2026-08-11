import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerWorkOrderRoutes } from "../../server/routes/workOrderRoutes";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
import { errorHandler } from "../../server/middleware/errorHandler";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import {
  users,
  userTenantRoles,
  customers,
  objects,
  workOrders,
  assignments,
  slotTimes,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

// Task #1545: regressionstester för GET /api/work-orders/:id/motor-forslag.
// Endpointen visar motorns leveransförslag på uppgiftskortet via
// sourceAssignmentId → slot_times. Kontraktet:
//   * vald slot vinner över lägre rank
//   * plannerDecision='avvisad' och icke-tidsmotor-slots exkluderas
//   * order utan sourceAssignmentId ⇒ forslag=null (aldrig fabricerat)
//   * cross-tenant ⇒ 404 (existens läcker inte)
//   * avbruten (soft-deleted) order ⇒ 200 med forslag (inte 404)
// Appen monteras bakom samma tenant-middleware som prod med stubbad auth
// (x-test-user-id) — samma mönster som cross-tenant-isolation.test.ts.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `mf-${Date.now()}`;
const TENANT_A = `${NS}-tenant-a`;
const TENANT_B = `${NS}-tenant-b`;
const USER_A = `${NS}-user-a`;
const USER_B = `${NS}-user-b`;

let customerA = "";
let objectA = "";
let assignmentA = "";
let assignmentCancelled = "";
let woWithAssignment = "";
let woWithoutAssignment = "";
let woCancelled = "";

const W = (iso: string) => new Date(iso);

async function req(path: string, userId: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "x-test-user-id": userId },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function makeSlot(partial: Record<string, unknown>) {
  await db.insert(slotTimes).values({
    tenantId: TENANT_A,
    assignmentId: assignmentA,
    windowStart: W("2026-09-01T08:00:00.000Z"),
    windowEnd: W("2026-09-01T10:00:00.000Z"),
    slotType: "onskad",
    status: "forslag",
    rank: 0,
    source: "tidsmotor",
    ...partial,
  } as any);
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
  await registerWorkOrderRoutes(app);
  app.use(errorHandler);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await storage.ensureTenant(TENANT_A, { name: "MF Tenant A" });
  await storage.ensureTenant(TENANT_B, { name: "MF Tenant B" });

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
  const [oA] = await db.insert(objects).values({ tenantId: TENANT_A, name: `${NS} Objekt A` }).returning();
  objectA = oA.id;

  const [asg] = await db.insert(assignments).values({
    tenantId: TENANT_A,
    objectId: objectA,
    customerId: customerA,
    title: `${NS} Assignment`,
  }).returning();
  assignmentA = asg.id;

  // Unikt index (tenant, source_assignment_id) — avbruten WO behöver egen assignment.
  const [asg2] = await db.insert(assignments).values({
    tenantId: TENANT_A,
    objectId: objectA,
    customerId: customerA,
    title: `${NS} Assignment (avbruten)`,
  }).returning();
  assignmentCancelled = asg2.id;

  const [w1] = await db.insert(workOrders).values({
    tenantId: TENANT_A, customerId: customerA, objectId: objectA,
    title: `${NS} WO med assignment`, sourceAssignmentId: assignmentA,
  } as any).returning();
  woWithAssignment = w1.id;

  const [w2] = await db.insert(workOrders).values({
    tenantId: TENANT_A, customerId: customerA, objectId: objectA,
    title: `${NS} WO utan assignment`,
  } as any).returning();
  woWithoutAssignment = w2.id;

  const [w3] = await db.insert(workOrders).values({
    tenantId: TENANT_A, customerId: customerA, objectId: objectA,
    title: `${NS} WO avbruten`, sourceAssignmentId: assignmentCancelled,
    deletedAt: new Date(),
  } as any).returning();
  woCancelled = w3.id;
});

afterAll(async () => {
  await db.delete(slotTimes).where(eq(slotTimes.tenantId, TENANT_A));
  await db.delete(workOrders).where(inArray(workOrders.id, [woWithAssignment, woWithoutAssignment, woCancelled].filter(Boolean)));
  await db.delete(assignments).where(eq(assignments.tenantId, TENANT_A));
  await db.delete(objects).where(eq(objects.tenantId, TENANT_A));
  await db.delete(customers).where(eq(customers.tenantId, TENANT_A));
  await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [USER_A, USER_B]));
  await db.delete(users).where(inArray(users.id, [USER_A, USER_B]));
  process.env.NODE_ENV = originalNodeEnv;
  await new Promise<void>((r) => server?.close(() => r()));
});

async function clearSlots() {
  await db.delete(slotTimes).where(eq(slotTimes.tenantId, TENANT_A));
}

describe("GET /api/work-orders/:id/motor-forslag (Task #1545)", () => {
  it("returnerar bästa rank när ingen slot är vald", async () => {
    await clearSlots();
    await makeSlot({ rank: 1, windowStart: W("2026-09-02T08:00:00.000Z"), windowEnd: W("2026-09-02T10:00:00.000Z") });
    await makeSlot({ rank: 0 });
    const r = await req(`/api/work-orders/${woWithAssignment}/motor-forslag`, USER_A);
    expect(r.status).toBe(200);
    expect(r.body.forslag).toBeTruthy();
    expect(new Date(r.body.forslag.windowStart).toISOString()).toBe("2026-09-01T08:00:00.000Z");
    expect(r.body.forslag.status).toBe("forslag");
  });

  it("vald slot vinner över lägre rank", async () => {
    await clearSlots();
    await makeSlot({ rank: 0, status: "forslag" });
    await makeSlot({
      rank: 5,
      status: "vald",
      windowStart: W("2026-09-10T08:00:00.000Z"),
      windowEnd: W("2026-09-10T10:00:00.000Z"),
    });
    const r = await req(`/api/work-orders/${woWithAssignment}/motor-forslag`, USER_A);
    expect(r.status).toBe(200);
    expect(r.body.forslag.status).toBe("vald");
    expect(new Date(r.body.forslag.windowStart).toISOString()).toBe("2026-09-10T08:00:00.000Z");
  });

  it("exkluderar avvisade slots (plannerDecision='avvisad')", async () => {
    await clearSlots();
    await makeSlot({ rank: 0, status: "vald", plannerDecision: "avvisad" });
    await makeSlot({
      rank: 1,
      windowStart: W("2026-09-03T08:00:00.000Z"),
      windowEnd: W("2026-09-03T10:00:00.000Z"),
    });
    const r = await req(`/api/work-orders/${woWithAssignment}/motor-forslag`, USER_A);
    expect(r.status).toBe(200);
    expect(new Date(r.body.forslag.windowStart).toISOString()).toBe("2026-09-03T08:00:00.000Z");
  });

  it("exkluderar icke-tidsmotor-slots", async () => {
    await clearSlots();
    await makeSlot({ rank: 0, status: "vald", source: "manuell" });
    const r = await req(`/api/work-orders/${woWithAssignment}/motor-forslag`, USER_A);
    expect(r.status).toBe(200);
    expect(r.body.forslag).toBeNull();
  });

  it("order utan sourceAssignmentId ⇒ forslag=null", async () => {
    await clearSlots();
    await makeSlot({ rank: 0, status: "vald" });
    const r = await req(`/api/work-orders/${woWithoutAssignment}/motor-forslag`, USER_A);
    expect(r.status).toBe(200);
    expect(r.body.forslag).toBeNull();
  });

  it("cross-tenant-anrop ⇒ 404 (existens läcker inte)", async () => {
    const r = await req(`/api/work-orders/${woWithAssignment}/motor-forslag`, USER_B);
    expect(r.status).toBe(404);
  });

  it("avbruten (soft-deleted) order ⇒ 200 med forslag", async () => {
    await clearSlots();
    await makeSlot({ rank: 0, status: "vald", assignmentId: assignmentCancelled });
    const r = await req(`/api/work-orders/${woCancelled}/motor-forslag`, USER_A);
    expect(r.status).toBe(200);
    expect(r.body.forslag).toBeTruthy();
    expect(r.body.forslag.status).toBe("vald");
  });
});
