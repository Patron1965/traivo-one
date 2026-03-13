import { describe, it, expect, beforeAll } from "vitest";
import { storage } from "../../server/storage";
import { apiGet, apiPost, apiDelete, randomId } from "./helpers";
import type { InsertObject } from "@shared/schema";

const TENANT_ID = "default-tenant";

describe("SlotPreference — favorable/unfavorable slots", () => {
  let customerId: string;
  let objectId1: string;
  let objectId2: string;

  beforeAll(async () => {
    const customer = await storage.createCustomer({
      tenantId: TENANT_ID,
      name: `SlotPref Test Kund ${randomId()}`,
      customerNumber: randomId(),
    });
    customerId = customer.id;

    const obj1 = await storage.createObject({
      tenantId: TENANT_ID,
      customerId,
      name: `SlotObj1 ${randomId()}`,
      objectNumber: randomId(),
      objectType: "container",
      objectLevel: 2,
    } as InsertObject);
    objectId1 = obj1.id;

    const obj2 = await storage.createObject({
      tenantId: TENANT_ID,
      customerId,
      name: `SlotObj2 ${randomId()}`,
      objectNumber: randomId(),
      objectType: "container",
      objectLevel: 2,
    } as InsertObject);
    objectId2 = obj2.id;
  });

  it("should create a favorable slot with reason", async () => {
    const slot = await storage.createObjectTimeRestriction({
      tenantId: TENANT_ID,
      objectId: objectId1,
      restrictionType: "time_window",
      description: "Test favorable",
      weekdays: [1, 3, 5],
      startTime: "08:00",
      endTime: "12:00",
      isBlockingAllDay: false,
      preference: "favorable",
      reason: "Bästa tömningsdag",
    });
    expect(slot.id).toBeTruthy();
    expect(slot.preference).toBe("favorable");
    expect(slot.reason).toBe("Bästa tömningsdag");
    expect(slot.weekdays).toEqual([1, 3, 5]);
  });

  it("should create an unfavorable slot with reason", async () => {
    const slot = await storage.createObjectTimeRestriction({
      tenantId: TENANT_ID,
      objectId: objectId1,
      restrictionType: "parking_ban",
      description: "P-förbud",
      weekdays: [2, 4],
      startTime: "07:00",
      endTime: "09:00",
      isBlockingAllDay: false,
      preference: "unfavorable",
      reason: "P-förbud gäller",
    });
    expect(slot.id).toBeTruthy();
    expect(slot.preference).toBe("unfavorable");
    expect(slot.reason).toBe("P-förbud gäller");
  });

  it("should default preference to unfavorable when not specified", async () => {
    const slot = await storage.createObjectTimeRestriction({
      tenantId: TENANT_ID,
      objectId: objectId1,
      restrictionType: "quiet_hours",
      weekdays: [0],
      isBlockingAllDay: true,
    });
    expect(slot.preference).toBe("unfavorable");
    expect(slot.reason).toBeNull();
  });

  it("should list slots per object with preference field", async () => {
    const slots = await storage.getObjectTimeRestrictions(objectId1);
    expect(slots.length).toBeGreaterThanOrEqual(3);
    const favorable = slots.filter(s => s.preference === "favorable");
    const unfavorable = slots.filter(s => s.preference === "unfavorable");
    expect(favorable.length).toBeGreaterThanOrEqual(1);
    expect(unfavorable.length).toBeGreaterThanOrEqual(2);
  });

  it("should update preference and reason via patch", async () => {
    const slot = await storage.createObjectTimeRestriction({
      tenantId: TENANT_ID,
      objectId: objectId2,
      restrictionType: "time_window",
      weekdays: [1],
      preference: "unfavorable",
      reason: "Old reason",
    });

    const updated = await storage.updateObjectTimeRestriction(slot.id, TENANT_ID, {
      preference: "favorable",
      reason: "New favorable reason",
    });
    expect(updated).toBeTruthy();
    expect(updated!.preference).toBe("favorable");
    expect(updated!.reason).toBe("New favorable reason");
  });

  it("should aggregate slots across multiple objects", async () => {
    await storage.createObjectTimeRestriction({
      tenantId: TENANT_ID,
      objectId: objectId2,
      restrictionType: "time_window",
      weekdays: [3],
      preference: "favorable",
      reason: "Obj2 bra tid",
    });

    const allSlots = await storage.getObjectTimeRestrictionsByObjectIds(
      TENANT_ID,
      [objectId1, objectId2]
    );
    const obj1Slots = allSlots.filter(s => s.objectId === objectId1);
    const obj2Slots = allSlots.filter(s => s.objectId === objectId2);
    expect(obj1Slots.length).toBeGreaterThanOrEqual(1);
    expect(obj2Slots.length).toBeGreaterThanOrEqual(1);
    expect(allSlots.length).toBe(obj1Slots.length + obj2Slots.length);
  });

  it("should require auth for aggregate endpoint", async () => {
    const res = await apiGet(`/api/slot-preferences/aggregate?objectIds=${objectId1},${objectId2}`);
    expect(res.status).toBe(401);
  });

  it("should require auth for POST time-restrictions via API", async () => {
    const res = await apiPost(`/api/objects/${objectId1}/time-restrictions`, {
      restrictionType: "time_window",
      weekdays: [5],
      startTime: "14:00",
      endTime: "16:00",
      preference: "favorable",
      reason: "API test bra tid",
    });
    expect(res.status).toBe(401);
  });

  it("should require auth for GET aggregate via API", async () => {
    const res = await apiGet(`/api/slot-preferences/aggregate?objectIds=${objectId1}`);
    expect(res.status).toBe(401);
  });

  it("should delete a slot", async () => {
    const slot = await storage.createObjectTimeRestriction({
      tenantId: TENANT_ID,
      objectId: objectId2,
      restrictionType: "time_window",
      weekdays: [6],
      preference: "unfavorable",
      reason: "To be deleted",
    });

    await storage.deleteObjectTimeRestriction(slot.id, TENANT_ID);
    const remaining = await storage.getObjectTimeRestrictions(objectId2);
    const found = remaining.find(s => s.id === slot.id);
    expect(found).toBeUndefined();
  });
});
