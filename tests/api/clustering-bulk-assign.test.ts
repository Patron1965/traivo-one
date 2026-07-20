import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { db } from "../../server/db";
import {
  tenants,
  customers,
  objects,
  teams,
  workOrders,
  routeClusters,
  routeClusterMemberships,
  stopClusters,
  stopClusterMemberships,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { registerClusteringRoutes } from "../../server/routes/clusteringRoutes";
import { errorHandler } from "../../server/middleware/errorHandler";

// ============================================================================
// Integrationstest mot RIKTIG DB för POST /api/clustering/bulk-assign
// (snabbtilldelning från kartvyn). Verifierar:
//  (a) blandade rutt- + stoppklumpar → deduplicerad union av work orders
//  (b) tom lista → { updated: 0, total: 0 }
//  (c) cross-tenant: annan tenants klumpar hoppas över och annan tenants
//      WO:er uppdateras ALDRIG även om ett membership pekar på dem
//  (d) teamId + roughPlannedWeek skrivs faktiskt korrekt i DB
//  (e) removedAt-memberships och assignments-rader ignoreras
// ============================================================================

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const TENANT_A = `bulkassign-a-${SUFFIX}`;
const TENANT_B = `bulkassign-b-${SUFFIX}`;

let server: Server;
let baseUrl: string;

let customerA: string;
let objectA: string;
let customerB: string;
let objectB: string;
let teamA: string;

// Work orders tenant A
let woA1: string; // i ruttklump RA
let woA2: string; // i ruttklump RA OCH stoppklump SA (dedup-test)
let woA3: string; // i stoppklump SA
let woA4: string; // removedAt-membership i RA → ska INTE uppdateras
// Work order tenant B
let woB1: string; // membership i tenant A:s klump (förgiftad rad) + egen klump RB

let clusterRA: string; // route cluster, tenant A
let clusterSA: string; // stop cluster, tenant A
let clusterRB: string; // route cluster, tenant B

async function bulkAssign(body: unknown) {
  const res = await fetch(`${baseUrl}/api/clustering/bulk-assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function getWo(id: string) {
  const [row] = await db.select().from(workOrders).where(eq(workOrders.id, id));
  return row;
}

async function insertWo(tenantId: string, customerId: string, objectId: string, title: string) {
  const [row] = await db
    .insert(workOrders)
    .values({
      tenantId,
      customerId,
      objectId,
      title,
      orderStatus: "planerad_resurs",
      estimatedDuration: 60,
    } as any)
    .returning({ id: workOrders.id });
  return row.id;
}

beforeAll(async () => {
  // App med stubbad tenant-kontext: samma kedja som prod (tenant-mw sätter
  // req.tenantId/req.tenantRole innan requirePlanner + handlern körs).
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenantId = TENANT_A;
    req.tenantRole = "planner";
    next();
  });
  registerClusteringRoutes(app);
  app.use(errorHandler);
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db
    .insert(tenants)
    .values([
      { id: TENANT_A, name: "BulkAssign Test A" },
      { id: TENANT_B, name: "BulkAssign Test B" },
    ])
    .onConflictDoNothing();

  const [cA] = await db.insert(customers).values({ tenantId: TENANT_A, name: "Kund A" }).returning();
  customerA = cA.id;
  const [oA] = await db
    .insert(objects)
    .values({ tenantId: TENANT_A, name: "Objekt A", objectType: "fastighet" } as any)
    .returning();
  objectA = oA.id;
  const [cB] = await db.insert(customers).values({ tenantId: TENANT_B, name: "Kund B" }).returning();
  customerB = cB.id;
  const [oB] = await db
    .insert(objects)
    .values({ tenantId: TENANT_B, name: "Objekt B", objectType: "fastighet" } as any)
    .returning();
  objectB = oB.id;

  const [tA] = await db.insert(teams).values({ tenantId: TENANT_A, name: "Team A" }).returning();
  teamA = tA.id;

  woA1 = await insertWo(TENANT_A, customerA, objectA, "A1 ruttklump");
  woA2 = await insertWo(TENANT_A, customerA, objectA, "A2 rutt+stopp (dedup)");
  woA3 = await insertWo(TENANT_A, customerA, objectA, "A3 stoppklump");
  woA4 = await insertWo(TENANT_A, customerA, objectA, "A4 removed membership");
  woB1 = await insertWo(TENANT_B, customerB, objectB, "B1 annan tenant");

  const now = new Date();
  const [ra] = await db
    .insert(routeClusters)
    .values({ tenantId: TENANT_A, displayName: "RA testruttklump", status: "active" })
    .returning();
  clusterRA = ra.id;
  const [sa] = await db
    .insert(stopClusters)
    .values({ tenantId: TENANT_A, displayName: "SA teststoppklump", status: "active" })
    .returning();
  clusterSA = sa.id;
  const [rb] = await db
    .insert(routeClusters)
    .values({ tenantId: TENANT_B, displayName: "RB annan tenant", status: "active" })
    .returning();
  clusterRB = rb.id;

  await db.insert(routeClusterMemberships).values([
    { tenantId: TENANT_A, routeClusterId: clusterRA, taskId: woA1, taskTable: "work_orders", assignedAt: now },
    { tenantId: TENANT_A, routeClusterId: clusterRA, taskId: woA2, taskTable: "work_orders", assignedAt: now },
    // removedAt satt → ska ignoreras
    {
      tenantId: TENANT_A,
      routeClusterId: clusterRA,
      taskId: woA4,
      taskTable: "work_orders",
      assignedAt: now,
      removedAt: now,
      removalReason: "manual",
    },
    // assignments-rad → ska ignoreras (fel taskTable)
    { tenantId: TENANT_A, routeClusterId: clusterRA, taskId: "assignment-fake-id", taskTable: "assignments", assignedAt: now },
    // "förgiftad" rad: pekar på tenant B:s WO — tenant-predikatet i UPDATE måste skydda
    { tenantId: TENANT_A, routeClusterId: clusterRA, taskId: woB1, taskTable: "work_orders", assignedAt: now },
    // tenant B:s egen klump
    { tenantId: TENANT_B, routeClusterId: clusterRB, taskId: woB1, taskTable: "work_orders", assignedAt: now },
  ]);
  await db.insert(stopClusterMemberships).values([
    { tenantId: TENANT_A, stopClusterId: clusterSA, taskId: woA2, taskTable: "work_orders", assignedAt: now },
    { tenantId: TENANT_A, stopClusterId: clusterSA, taskId: woA3, taskTable: "work_orders", assignedAt: now },
  ]);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.delete(routeClusterMemberships).where(inArray(routeClusterMemberships.tenantId, [TENANT_A, TENANT_B]));
  await db.delete(stopClusterMemberships).where(inArray(stopClusterMemberships.tenantId, [TENANT_A, TENANT_B]));
  await db.delete(routeClusters).where(inArray(routeClusters.tenantId, [TENANT_A, TENANT_B]));
  await db.delete(stopClusters).where(inArray(stopClusters.tenantId, [TENANT_A, TENANT_B]));
  await db.delete(workOrders).where(inArray(workOrders.tenantId, [TENANT_A, TENANT_B]));
  await db.delete(teams).where(inArray(teams.tenantId, [TENANT_A, TENANT_B]));
  await db.delete(objects).where(inArray(objects.tenantId, [TENANT_A, TENANT_B]));
  await db.delete(customers).where(inArray(customers.tenantId, [TENANT_A, TENANT_B]));
  await db.delete(tenants).where(inArray(tenants.id, [TENANT_A, TENANT_B]));
});

describe("POST /api/clustering/bulk-assign (integration mot riktig DB)", () => {
  it("tom lista ger { updated: 0, total: 0 } och rör ingenting", async () => {
    const res = await bulkAssign({ routeClusterIds: [], stopClusterIds: [], teamId: teamA, week: "2026-W35" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 0, total: 0 });
    const a1 = await getWo(woA1);
    expect(a1.teamId).toBeNull();
    expect(a1.roughPlannedWeek).toBeNull();
  });

  it("ogiltigt veckoformat avvisas med 400", async () => {
    const res = await bulkAssign({ routeClusterIds: [clusterRA], teamId: teamA, week: "vecka 35" });
    expect(res.status).toBe(400);
  });

  it("klump från annan tenant hoppas över (updated 0)", async () => {
    const res = await bulkAssign({ routeClusterIds: [clusterRB], stopClusterIds: [], teamId: teamA, week: "2026-W35" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 0, total: 0 });
    const b1 = await getWo(woB1);
    expect(b1.teamId).toBeNull();
    expect(b1.roughPlannedWeek).toBeNull();
  });

  it("blandade rutt- + stoppklumpar: deduplicerad union, rätt team+vecka i DB, cross-tenant/removed/assignments orörda", async () => {
    const res = await bulkAssign({
      routeClusterIds: [clusterRA],
      stopClusterIds: [clusterSA],
      teamId: teamA,
      week: "2026-W36",
    });
    expect(res.status).toBe(200);
    // Union: A1, A2 (dedup rutt+stopp), A3 + förgiftad B1-rad räknas i total
    // men uppdateras inte → updated = 3, total = 4.
    expect(res.body.total).toBe(4);
    expect(res.body.updated).toBe(3);

    for (const id of [woA1, woA2, woA3]) {
      const row = await getWo(id);
      expect(row.teamId).toBe(teamA);
      expect(row.roughPlannedWeek).toBe("2026-W36");
    }
    // removedAt-membership → orörd
    const a4 = await getWo(woA4);
    expect(a4.teamId).toBeNull();
    expect(a4.roughPlannedWeek).toBeNull();
    // cross-tenant WO → orörd trots membership-rad i tenant A:s klump
    const b1 = await getWo(woB1);
    expect(b1.teamId).toBeNull();
    expect(b1.roughPlannedWeek).toBeNull();
  });

  it("kommentar skrivs till plannedNotes när den skickas med", async () => {
    const res = await bulkAssign({
      routeClusterIds: [],
      stopClusterIds: [clusterSA],
      teamId: teamA,
      week: "2026-W37",
      kommentar: "Snabbtilldelad från kartan",
    });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    const a3 = await getWo(woA3);
    expect(a3.roughPlannedWeek).toBe("2026-W37");
    expect((a3 as any).plannedNotes).toBe("Snabbtilldelad från kartan");
  });
});
