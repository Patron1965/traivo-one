import { describe, it, expect, beforeAll } from "vitest";
import { storage } from "../../server/storage";
import { getObjectSystemGeneratedMetadata } from "../../server/services/object-system-metadata";
import { randomId } from "./helpers";

// Task #1512: Objektets "Kopplade uppgifter" — servern måste leverera
// "född ur"-fälten (sourceAssignmentId, orderConceptId, orderNumber) i
// tasksHistory så att klienten kan (1) deduplicera en materialiserad
// assignment mot sin order och (2) sätta rätt käll-etikett/länk.
// Regression: getWorkOrders select-lista saknade kolumnerna → alltid null.

const TENANT = "default-tenant";

describe("tasksHistory bär född ur-fälten (Task #1512)", () => {
  let objectId: string;
  let assignmentId: string;
  let woFromAssignmentId: string;
  let woSnabborderId: string;
  let woPlainId: string;
  const snabbOrderNumber = `SO-9${Math.floor(Math.random() * 100000)}`;

  beforeAll(async () => {
    await storage.ensureTenant(TENANT, { name: "Default tenant (test)" });

    const customer = await storage.createCustomer({
      tenantId: TENANT,
      name: `LT-Kund ${randomId()}`,
    } as any);

    const obj = await storage.createObject({
      tenantId: TENANT,
      name: `LT-Objekt ${randomId()}`,
    } as any);
    objectId = obj.id;

    const assignment = await storage.createAssignment({
      tenantId: TENANT,
      objectId,
      title: `LT-Assignment ${randomId()}`,
    } as any);
    assignmentId = assignment.id;

    // Framtida scheduledDate så raderna hamnar först i getWorkOrders
    // (desc scheduledDate, limit 500) oavsett övrig testdata i databasen.
    const future = (offsetDays: number) =>
      new Date(Date.now() + (3650 + offsetDays) * 24 * 60 * 60 * 1000);

    // 1) Order materialiserad från assignment.
    const woA = await storage.createWorkOrder({
      tenantId: TENANT,
      customerId: customer.id,
      objectId,
      title: `LT-Materialiserad ${randomId()}`,
      scheduledDate: future(3),
      sourceAssignmentId: assignmentId,
    } as any);
    woFromAssignmentId = woA.id;

    // 2) Snabborder (orderNumber SO-*).
    const woB = await storage.createWorkOrder({
      tenantId: TENANT,
      customerId: customer.id,
      objectId,
      title: `LT-Snabborder ${randomId()}`,
      scheduledDate: future(2),
      orderNumber: snabbOrderNumber,
    } as any);
    woSnabborderId = woB.id;

    // 3) Vanlig order utan koncept/snabbordernummer (Uppgiftskaparen).
    const woC = await storage.createWorkOrder({
      tenantId: TENANT,
      customerId: customer.id,
      objectId,
      title: `LT-Vanlig ${randomId()}`,
      scheduledDate: future(1),
    } as any);
    woPlainId = woC.id;
  });

  it("levererar sourceAssignmentId, orderNumber och orderConceptId i tasksHistory", async () => {
    const data = await getObjectSystemGeneratedMetadata(TENANT, objectId);
    const history = data.tasksHistory;

    const materialized = history.find((t) => t.id === woFromAssignmentId);
    expect(materialized).toBeTruthy();
    expect(materialized!.sourceAssignmentId).toBe(assignmentId);
    expect(materialized!.orderConceptId).toBeNull();

    const snabb = history.find((t) => t.id === woSnabborderId);
    expect(snabb).toBeTruthy();
    expect(snabb!.orderNumber).toBe(snabbOrderNumber);
    expect(snabb!.sourceAssignmentId).toBeNull();

    const plain = history.find((t) => t.id === woPlainId);
    expect(plain).toBeTruthy();
    expect(plain!.orderNumber).toBeNull();
    expect(plain!.orderConceptId).toBeNull();
    expect(plain!.sourceAssignmentId).toBeNull();
  });

  it("assignment som materialiserats till order kan dedupliceras via sourceAssignmentId", async () => {
    const data = await getObjectSystemGeneratedMetadata(TENANT, objectId);
    const materializedIds = new Set(
      data.tasksHistory
        .map((t) => t.sourceAssignmentId)
        .filter((x): x is string => !!x),
    );
    // Klientens dedup-regel: assignmentId ska finnas i mängden → assignment-raden döljs.
    expect(materializedIds.has(assignmentId)).toBe(true);
  });
});
