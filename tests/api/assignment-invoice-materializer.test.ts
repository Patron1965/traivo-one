import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import {
  tenants,
  customers,
  objects,
  orderConcepts,
  assignments,
  workOrders,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { storage } from "../../server/storage";
import { materializeCompletedAssignmentForInvoice } from "../../server/services/assignment-invoice-materializer";

// Task #1124: Bryggan utförd uppgift → fakturerbar work_order.
// DB-integrationstest mot dev-DB. Verifierar kärnacceptansen:
//   - en utförd avrops-uppgift materialiseras till EXAKT EN länkad WO med frusna
//     huvudreferenser + fast-pris-flagga + utförd/klar-status + kö-state pending,
//   - re-anrop är en no-op (idempotent: unikt index + invoicedAt),
//   - tenant-isolering: fel tenant materialiserar aldrig och skapar ingen WO,
//   - icke-fakturerbar uppgift (exceptionStatus) utförs men fryses/köas aldrig.

let TENANT: string;
let OTHER_TENANT: string;
let customerId: string;
let objectId: string;
let conceptId: string;

async function createAssignment(opts: {
  tenantId?: string;
  isFixedPrice?: boolean;
  exceptionStatus?: string | null;
} = {}): Promise<string> {
  const [a] = await db
    .insert(assignments)
    .values({
      tenantId: opts.tenantId ?? TENANT,
      orderConceptId: conceptId,
      objectId,
      customerId,
      title: "Avropsuppgift #1124",
      billingMethod: "call_off",
      isFixedPrice: opts.isFixedPrice ?? true,
      exceptionStatus: opts.exceptionStatus ?? null,
      status: "completed",
      completedAt: new Date(),
    })
    .returning();
  return a.id;
}

beforeAll(async () => {
  const stamp = `aim-${Date.now()}`;
  TENANT = `${stamp}-t`;
  OTHER_TENANT = `${stamp}-other`;
  await db
    .insert(tenants)
    .values([
      { id: TENANT, name: "AIM Test Tenant" },
      { id: OTHER_TENANT, name: "AIM Other Tenant" },
    ])
    .onConflictDoNothing();

  const [customer] = await db
    .insert(customers)
    .values({ tenantId: TENANT, name: "AIM Testkund" })
    .returning();
  customerId = customer.id;

  const [object] = await db
    .insert(objects)
    .values({ tenantId: TENANT, customerId, name: "AIM Objekt" })
    .returning();
  objectId = object.id;

  // HARDCODED huvudreferenser så frysningen kan verifieras utan metadata-setup.
  const [concept] = await db
    .insert(orderConcepts)
    .values({
      tenantId: TENANT,
      name: "Avropskoncept 1124",
      scenario: "avrop",
      ourReference: "Vår Ref AB",
      customerReference: "Kundens Ref",
    })
    .returning();
  conceptId = concept.id;
}, 30000);

afterAll(async () => {
  for (const t of [TENANT, OTHER_TENANT]) {
    if (!t) continue;
    await db.delete(workOrders).where(eq(workOrders.tenantId, t));
    await db.delete(assignments).where(eq(assignments.tenantId, t));
    await db.delete(orderConcepts).where(eq(orderConcepts.tenantId, t));
    await db.delete(objects).where(eq(objects.tenantId, t));
    await db.delete(customers).where(eq(customers.tenantId, t));
    await db.delete(tenants).where(eq(tenants.id, t));
  }
}, 30000);

async function woForAssignment(tenantId: string, assignmentId: string) {
  return db
    .select()
    .from(workOrders)
    .where(
      and(eq(workOrders.tenantId, tenantId), eq(workOrders.sourceAssignmentId, assignmentId)),
    );
}

describe("materializeCompletedAssignmentForInvoice", () => {
  it("materialiserar en utförd avrops-uppgift till EXAKT EN fakturerbar WO med frusna referenser", async () => {
    const assignmentId = await createAssignment({ isFixedPrice: true });

    const res = await materializeCompletedAssignmentForInvoice(TENANT, assignmentId);
    expect(res.status).toBe("created");

    const wos = await woForAssignment(TENANT, assignmentId);
    expect(wos).toHaveLength(1);
    const wo = wos[0];

    // Koppling + ursprung
    expect(wo.orderConceptId).toBe(conceptId);
    expect(wo.invoiceSourceType).toBe("assignment");
    expect(wo.creationMethod).toBe("assignment_invoice");
    // Status: utförd + klar
    expect(wo.orderStatus).toBe("utford");
    expect(wo.executionStatus).toBe("completed");
    // Fast-pris-flaggan följde med uppgiften
    expect(wo.frozenIsFixedPrice).toBe(true);
    // Frusna huvudreferenser (HARDCODED)
    expect(wo.frozenOurReference).toBe("Vår Ref AB");
    expect(wo.frozenOurDesignation).toBe("Avropskoncept 1124");
    expect(wo.frozenCustomerReference).toBe("Kundens Ref");
    // Pris fryst (freezeWorkOrder) + i fakturakön (immediate → pending)
    expect(wo.frozenAt).not.toBeNull();
    expect(wo.invoiceQueueState).toBe("pending");

    // Uppgiften stämplad fakturerad
    const a = await storage.getAssignment(assignmentId);
    expect(a?.invoicedAt).not.toBeNull();
  });

  it("är idempotent: re-anrop skapar ingen dubblett-WO", async () => {
    const assignmentId = await createAssignment();

    const first = await materializeCompletedAssignmentForInvoice(TENANT, assignmentId);
    expect(first.status).toBe("created");

    const second = await materializeCompletedAssignmentForInvoice(TENANT, assignmentId);
    expect(second.status).toBe("exists");

    const wos = await woForAssignment(TENANT, assignmentId);
    expect(wos).toHaveLength(1);
  });

  it("tenant-isolering: fel tenant materialiserar aldrig och skapar ingen WO", async () => {
    const assignmentId = await createAssignment();

    const res = await materializeCompletedAssignmentForInvoice(OTHER_TENANT, assignmentId);
    expect(res.status).toBe("skipped");

    const wosOther = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.tenantId, OTHER_TENANT));
    expect(wosOther).toHaveLength(0);
  });

  it("icke-fakturerbar uppgift (exceptionStatus) utförs men fryses/köas aldrig", async () => {
    const assignmentId = await createAssignment({ exceptionStatus: "ej_fakturerbar" });

    const res = await materializeCompletedAssignmentForInvoice(TENANT, assignmentId);
    expect(res.status).toBe("skipped");

    // WO:n projiceras (jobbet är verkligt) men hamnar aldrig i fakturakön.
    const wos = await woForAssignment(TENANT, assignmentId);
    expect(wos).toHaveLength(1);
    expect(wos[0].invoiceQueueState).toBeNull();

    // Uppgiften är utförd men aldrig fakturerad.
    const a = await storage.getAssignment(assignmentId);
    expect(a?.invoicedAt).toBeNull();
    expect(a?.status).toBe("completed");
  });
});
