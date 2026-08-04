import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import { tenants, customers, objects, orderConcepts, assignments, workOrders, workOrderLines } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { storage } from "../../server/storage";

// Task #1369: uppgiftens ursprung (source_type + order_concept_id) är oföränderligt
// efter skapandet. DB-integrationstest mot dev-DB: verifierar att
// storage.updateWorkOrder/updateAssignment ALDRIG kan ändra/fabricera
// provenance-fälten, oavsett vilken route/sync-väg som skickar in payloaden.

let TENANT: string;
let customerId: string;
let objectId: string;
let conceptId: string;
const createdWoIds: string[] = [];
const createdAssignmentIds: string[] = [];

beforeAll(async () => {
  TENANT = `ts1369-${Date.now()}`;
  await db.insert(tenants).values({ id: TENANT, name: "TaskSource Test Tenant" });
  const [c] = await db.insert(customers).values({ tenantId: TENANT, name: "TS Kund" }).returning();
  customerId = c.id;
  const [o] = await db.insert(objects).values({ tenantId: TENANT, name: "TS Objekt", customerId }).returning();
  objectId = o.id;
  const [oc] = await db.insert(orderConcepts).values({ tenantId: TENANT, name: "TS Koncept", customerId, scenario: "avrop", scheduleType: "once" }).returning();
  conceptId = oc.id;
});

afterAll(async () => {
  if (createdWoIds.length) {
    await db.delete(workOrderLines).where(inArray(workOrderLines.workOrderId, createdWoIds));
    await db.delete(workOrders).where(inArray(workOrders.id, createdWoIds));
  }
  if (createdAssignmentIds.length) await db.delete(assignments).where(inArray(assignments.id, createdAssignmentIds));
  await db.delete(orderConcepts).where(eq(orderConcepts.tenantId, TENANT));
  await db.delete(objects).where(eq(objects.tenantId, TENANT));
  await db.delete(customers).where(eq(customers.tenantId, TENANT));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
});

describe("task-source DB-immutability (Task #1369)", () => {
  it("createWorkOrder persisterar källtyp; updateWorkOrder kan aldrig ändra/fabricera den", async () => {
    const wo = await storage.createWorkOrder({
      tenantId: TENANT,
      customerId,
      objectId,
      title: "TS WO",
      sourceType: "snabborder",
    } as any);
    createdWoIds.push(wo.id);
    expect(wo.sourceType).toBe("snabborder");
    expect(wo.orderConceptId).toBeNull();

    const after = await storage.updateWorkOrder(wo.id, {
      title: "TS WO uppdaterad",
      sourceType: "orderkoncept",
      orderConceptId: conceptId,
    } as any);
    expect(after?.title).toBe("TS WO uppdaterad");
    expect(after?.sourceType).toBe("snabborder");
    expect(after?.orderConceptId).toBeNull();
  });

  it("legacy-WO utan stämpel förblir NULL (Okänd) — ingen fabricering via update", async () => {
    const wo = await storage.createWorkOrder({ tenantId: TENANT, customerId, objectId, title: "TS legacy WO" } as any);
    createdWoIds.push(wo.id);
    expect(wo.sourceType).toBeNull();

    const after = await storage.updateWorkOrder(wo.id, { sourceType: "import" } as any);
    expect(after?.sourceType).toBeNull();
  });

  it("createAssignment persisterar källtyp; updateAssignment kan aldrig ändra den", async () => {
    const a = await storage.createAssignment({
      tenantId: TENANT,
      orderConceptId: conceptId,
      objectId,
      customerId,
      title: "TS Assignment",
      status: "not_planned",
      sourceType: "orderkoncept",
    } as any);
    createdAssignmentIds.push(a.id);
    expect(a.sourceType).toBe("orderkoncept");
    expect(a.orderConceptId).toBe(conceptId);

    const after = await storage.updateAssignment(a.id, TENANT, {
      title: "TS Assignment uppdaterad",
      sourceType: "snabborder",
      orderConceptId: null,
    } as any);
    expect(after?.title).toBe("TS Assignment uppdaterad");
    expect(after?.sourceType).toBe("orderkoncept");
    expect(after?.orderConceptId).toBe(conceptId);
  });
});
