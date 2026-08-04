import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import { tenants, customers, objects, orderConcepts, workOrders, assignments } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getObjectSystemGeneratedMetadata } from "../../server/services/object-system-metadata";

// Task #1370: DB-integrationstest mot dev-DB — Systeminformation (systemInfo)
// byggs enbart av riktiga objekt-kolumner, och kopplade order/uppgifter bär
// sourceType för objektsidans tabell.

let TENANT: string;
let customerId: string;
let parentId: string;
let childId: string;
let conceptId: string;

beforeAll(async () => {
  TENANT = `ts1370-${Date.now()}`;
  await db.insert(tenants).values({ id: TENANT, name: "SysInfo Test Tenant" });
  const [c] = await db.insert(customers).values({ tenantId: TENANT, name: "SI Kund" }).returning();
  customerId = c.id;
  const [p] = await db.insert(objects).values({ tenantId: TENANT, name: "SI Förälder", objectNumber: "OBJ-P1" }).returning();
  parentId = p.id;
  const [ch] = await db.insert(objects).values({ tenantId: TENANT, name: "SI Barn", parentId, objectNumber: "OBJ-C1", importBatchId: "batch-xyz" }).returning();
  childId = ch.id;
  const [oc] = await db.insert(orderConcepts).values({ tenantId: TENANT, name: "SI Koncept", customerId, scenario: "avrop", scheduleType: "once" }).returning();
  conceptId = oc.id;
  await db.insert(workOrders).values({
    tenantId: TENANT, customerId, objectId: childId, title: "SI WO",
    sourceType: "orderkoncept", orderConceptId: conceptId,
  });
  await db.insert(assignments).values({
    tenantId: TENANT, customerId, objectId: childId, orderConceptId: conceptId,
    title: "SI Assignment", status: "not_planned", sourceType: "orderkoncept",
  });
});

afterAll(async () => {
  await db.delete(workOrders).where(eq(workOrders.tenantId, TENANT));
  await db.delete(assignments).where(eq(assignments.tenantId, TENANT));
  await db.delete(orderConcepts).where(eq(orderConcepts.tenantId, TENANT));
  await db.delete(objects).where(eq(objects.id, childId));
  await db.delete(objects).where(eq(objects.id, parentId));
  await db.delete(customers).where(eq(customers.tenantId, TENANT));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
});

describe("objektsidans systeminformation + kopplade order (Task #1370)", () => {
  it("systemInfo bygger på riktiga kolumner: id, objektnummer, förälder, barn-antal, källsystem", async () => {
    const data = await getObjectSystemGeneratedMetadata(TENANT, childId);
    expect(data.systemInfo).not.toBeNull();
    const si = data.systemInfo!;
    expect(si.internalId).toBe(childId);
    expect(si.objectNumber).toBe("OBJ-C1");
    expect(si.status).toBe("active");
    expect(si.createdAt).toBeTruthy();
    expect(si.archivedAt).toBeNull();
    expect(si.sourceSystem).toBe("Import");
    expect(si.importBatchId).toBe("batch-xyz");
    expect(si.parentId).toBe(parentId);
    expect(si.parentName).toBe("SI Förälder");
    expect(si.childCount).toBe(0);
  });

  it("förälderns systemInfo räknar underordnade och saknar förälder-relation", async () => {
    const data = await getObjectSystemGeneratedMetadata(TENANT, parentId);
    const si = data.systemInfo!;
    expect(si.childCount).toBe(1);
    expect(si.parentId).toBeNull();
    expect(si.sourceSystem).toBe("Traivo");
  });

  it("cross-tenant objekt ger systemInfo=null (tenant-scopat)", async () => {
    const data = await getObjectSystemGeneratedMetadata("annan-tenant-som-inte-finns", childId);
    expect(data.systemInfo).toBeNull();
  });

  it("kopplade order/uppgifter bär sourceType + koncept i DB (endpoint-fälten finns)", async () => {
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.tenantId, TENANT));
    expect(wo.sourceType).toBe("orderkoncept");
    expect(wo.orderConceptId).toBe(conceptId);
    const [a] = await db.select().from(assignments).where(eq(assignments.tenantId, TENANT));
    expect(a.sourceType).toBe("orderkoncept");
  });
});
