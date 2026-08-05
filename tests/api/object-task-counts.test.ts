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
import { inArray, eq } from "drizzle-orm";

// Task #1426: batchade uppgiftsräknare för objektlistan —
// GET /api/objects/task-counts?ids=... Summerar work_orders + assignments per
// objekt (ej soft-deletade), tenant-scopat. Vaktar:
//  - korrekt summa (WO + assignments), objekt utan uppgifter utelämnas
//  - soft-deletade rader räknas inte
//  - cross-tenant-id:n i ids-listan läcker aldrig räknare
//  - tom ids-param ger tomt objekt

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `otc-${Date.now()}`;
const TENANT_A = `${NS}-tenant-a`;
const TENANT_B = `${NS}-tenant-b`;
const USER_A = `${NS}-user-a`;
const USER_B = `${NS}-user-b`;

let customerA = "";
let customerB = "";
let objWithTasks = "";
let objWithoutTasks = "";
let objDeletedTasks = "";
let objectB = "";

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

  await storage.ensureTenant(TENANT_A, { name: "Task-counts Tenant A" });
  await storage.ensureTenant(TENANT_B, { name: "Task-counts Tenant B" });

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

  objWithTasks = (await storage.createObject({ tenantId: TENANT_A, name: `${NS} Med uppgifter`, objectType: "fastighet", status: "active" } as any)).id;
  objWithoutTasks = (await storage.createObject({ tenantId: TENANT_A, name: `${NS} Utan uppgifter`, objectType: "fastighet", status: "active" } as any)).id;
  objDeletedTasks = (await storage.createObject({ tenantId: TENANT_A, name: `${NS} Raderade uppgifter`, objectType: "fastighet", status: "active" } as any)).id;
  objectB = (await storage.createObject({ tenantId: TENANT_B, name: `${NS} Objekt B`, objectType: "fastighet", status: "active" } as any)).id;

  // objWithTasks: 2 work orders + 3 assignments = 5.
  await db.insert(workOrders).values([
    { tenantId: TENANT_A, customerId: customerA, objectId: objWithTasks, title: `${NS} WO 1` },
    { tenantId: TENANT_A, customerId: customerA, objectId: objWithTasks, title: `${NS} WO 2` },
  ]);
  await db.insert(assignments).values(
    Array.from({ length: 3 }, (_, i) => ({
      tenantId: TENANT_A,
      customerId: customerA,
      objectId: objWithTasks,
      title: `${NS} Uppgift ${i}`,
      status: "not_planned",
    })),
  );

  // objDeletedTasks: enbart soft-deletade rader → ska inte synas alls.
  const del = new Date();
  await db.insert(workOrders).values({ tenantId: TENANT_A, customerId: customerA, objectId: objDeletedTasks, title: `${NS} WO del`, deletedAt: del });
  await db.insert(assignments).values({ tenantId: TENANT_A, customerId: customerA, objectId: objDeletedTasks, title: `${NS} Uppgift del`, status: "not_planned", deletedAt: del });

  // Tenant B: en order på sitt objekt.
  await db.insert(workOrders).values({ tenantId: TENANT_B, customerId: customerB, objectId: objectB, title: `${NS} WO B` });
}, 60000);

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

describe("GET /api/objects/task-counts (Task #1426)", () => {
  it("summerar work orders + assignments per objekt och utelämnar noll-objekt", async () => {
    const ids = [objWithTasks, objWithoutTasks, objDeletedTasks].join(",");
    const { status, body } = await req(`/api/objects/task-counts?ids=${ids}`, USER_A);
    expect(status).toBe(200);
    expect(body[objWithTasks]).toBe(5);
    expect(body[objWithoutTasks]).toBeUndefined();
    // Soft-deletade uppgifter räknas inte.
    expect(body[objDeletedTasks]).toBeUndefined();
  });

  it("läcker aldrig räknare för andra tenanters objekt-id:n", async () => {
    const { status, body } = await req(`/api/objects/task-counts?ids=${objectB}`, USER_A);
    expect(status).toBe(200);
    expect(body).toEqual({});
    // Rätt tenant ser sitt eget.
    const own = await req(`/api/objects/task-counts?ids=${objectB}`, USER_B);
    expect(own.status).toBe(200);
    expect(own.body[objectB]).toBe(1);
  });

  it("tom ids-param ger tomt svar (och matchar inte /:id-routen)", async () => {
    const { status, body } = await req(`/api/objects/task-counts?ids=`, USER_A);
    expect(status).toBe(200);
    expect(body).toEqual({});
  });
});
