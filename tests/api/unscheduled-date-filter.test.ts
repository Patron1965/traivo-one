import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import {
  workOrders,
  customers,
  objects,
  tenants,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { DatabaseStorage } from "../../server/storage";

const storage = new DatabaseStorage();

let TEST_TENANT: string;
let createdTenant = false;
let customerId: string;
let objectId: string;
const createdWorkOrderIds: string[] = [];

async function insertWO(opts: {
  title: string;
  desiredDeliveryStart?: Date | null;
  desiredDeliveryEnd?: Date | null;
  plannedWindowEnd?: Date | null;
  createdAt?: Date;
}): Promise<string> {
  const [wo] = await db
    .insert(workOrders)
    .values({
      tenantId: TEST_TENANT,
      customerId,
      objectId,
      title: opts.title,
      orderStatus: "skapad",
      desiredDeliveryStart: opts.desiredDeliveryStart ?? null,
      desiredDeliveryEnd: opts.desiredDeliveryEnd ?? null,
      plannedWindowEnd: opts.plannedWindowEnd ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  createdWorkOrderIds.push(wo.id);
  return wo.id;
}

describe("getUnscheduledWorkOrdersPaginated — datumfilter", () => {
  beforeAll(async () => {
    const tenantId = `datefilter-test-${Date.now()}`;
    const [tenant] = await db
      .insert(tenants)
      .values({ id: tenantId, name: "Date Filter Test Tenant" })
      .onConflictDoNothing()
      .returning();
    TEST_TENANT = tenant?.id ?? tenantId;
    createdTenant = !!tenant;

    const [customer] = await db
      .insert(customers)
      .values({ tenantId: TEST_TENANT, name: "Datefilter Testkund" })
      .returning();
    customerId = customer.id;

    const [object] = await db
      .insert(objects)
      .values({
        tenantId: TEST_TENANT,
        customerId,
        name: "Datefilter Testobjekt",
        objectType: "fastighet",
      })
      .returning();
    objectId = object.id;

    // Order INNANFÖR önskat-datum-fönstret (maj 2026)
    await insertWO({
      title: "Inom önskat",
      desiredDeliveryStart: new Date("2026-05-10T08:00:00Z"),
      desiredDeliveryEnd: new Date("2026-05-12T17:00:00Z"),
    });
    // Order UTANFÖR önskat-datum-fönstret (jul 2026)
    await insertWO({
      title: "Utanför önskat",
      desiredDeliveryStart: new Date("2026-07-15T08:00:00Z"),
      desiredDeliveryEnd: new Date("2026-07-16T17:00:00Z"),
    });
    // Order utan desired_delivery (saknar fält)
    await insertWO({
      title: "Saknar önskat",
      desiredDeliveryStart: null,
      desiredDeliveryEnd: null,
    });
    // Order med deadline (planned_window_end) i maj 2026
    await insertWO({
      title: "Deadline maj",
      plannedWindowEnd: new Date("2026-05-20T17:00:00Z"),
    });
    // Order med deadline långt senare
    await insertWO({
      title: "Deadline jul",
      plannedWindowEnd: new Date("2026-07-20T17:00:00Z"),
    });
  });

  afterAll(async () => {
    if (createdWorkOrderIds.length > 0) {
      await db.delete(workOrders).where(inArray(workOrders.id, createdWorkOrderIds));
    }
    await db.delete(objects).where(eq(objects.id, objectId));
    await db.delete(customers).where(eq(customers.id, customerId));
    if (createdTenant) {
      await db.delete(tenants).where(eq(tenants.id, TEST_TENANT));
    }
  });

  it("filtrerar på desired_delivery (overlap) och räknar saknade fält", async () => {
    const result = await storage.getUnscheduledWorkOrdersPaginated(
      TEST_TENANT,
      50,
      0,
      undefined,
      { field: "desired", from: "2026-05-01", to: "2026-05-31" }
    );

    const titles = result.workOrders.map((w) => w.title);
    expect(titles).toContain("Inom önskat");
    expect(titles).not.toContain("Utanför önskat");
    expect(titles).not.toContain("Saknar önskat");
    expect(titles).not.toContain("Deadline maj");
    expect(result.total).toBe(1);
    // Tre rader saknar desired_delivery_start: "Saknar önskat", "Deadline maj", "Deadline jul"
    expect(result.missingDateFieldCount).toBe(3);
  });

  it("filtrerar på deadline (planned_window_end) och räknar saknade fält", async () => {
    const result = await storage.getUnscheduledWorkOrdersPaginated(
      TEST_TENANT,
      50,
      0,
      undefined,
      { field: "deadline", from: "2026-05-01", to: "2026-05-31" }
    );

    const titles = result.workOrders.map((w) => w.title);
    expect(titles).toContain("Deadline maj");
    expect(titles).not.toContain("Deadline jul");
    expect(titles).not.toContain("Inom önskat");
    expect(result.total).toBe(1);
    // Tre rader saknar planned_window_end: "Inom önskat", "Utanför önskat", "Saknar önskat"
    expect(result.missingDateFieldCount).toBe(3);
  });

  it("returnerar alla utan filter (baseline)", async () => {
    const result = await storage.getUnscheduledWorkOrdersPaginated(
      TEST_TENANT,
      50,
      0,
      undefined,
      undefined
    );
    const titles = result.workOrders.map((w) => w.title);
    expect(titles).toContain("Inom önskat");
    expect(titles).toContain("Utanför önskat");
    expect(titles).toContain("Saknar önskat");
    expect(titles).toContain("Deadline maj");
    expect(titles).toContain("Deadline jul");
    expect(result.total).toBe(5);
    expect(result.missingDateFieldCount).toBeUndefined();
  });

  it("filtrerar på desired med endast 'from' (öppen ände uppåt)", async () => {
    const result = await storage.getUnscheduledWorkOrdersPaginated(
      TEST_TENANT,
      50,
      0,
      undefined,
      { field: "desired", from: "2026-06-01" }
    );
    const titles = result.workOrders.map((w) => w.title);
    expect(titles).toContain("Utanför önskat");
    expect(titles).not.toContain("Inom önskat");
    expect(titles).not.toContain("Saknar önskat");
    expect(result.total).toBe(1);
  });

  it("filtrerar på desired med endast 'to' (öppen ände nedåt)", async () => {
    const result = await storage.getUnscheduledWorkOrdersPaginated(
      TEST_TENANT,
      50,
      0,
      undefined,
      { field: "desired", to: "2026-06-30" }
    );
    const titles = result.workOrders.map((w) => w.title);
    expect(titles).toContain("Inom önskat");
    expect(titles).not.toContain("Utanför önskat");
    expect(titles).not.toContain("Saknar önskat");
    expect(result.total).toBe(1);
  });

  it("filtrerar på created_at och returnerar inget för framtida intervall", async () => {
    const result = await storage.getUnscheduledWorkOrdersPaginated(
      TEST_TENANT,
      50,
      0,
      undefined,
      { field: "created", from: "2099-01-01", to: "2099-12-31" }
    );
    expect(result.total).toBe(0);
    // Inget missingDateFieldCount för created (created_at är aldrig null)
    expect(result.missingDateFieldCount).toBeUndefined();
  });
});
