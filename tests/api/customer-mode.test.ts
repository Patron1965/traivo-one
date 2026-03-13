import { describe, it, expect, beforeAll } from "vitest";
import { storage } from "../../server/storage";
import { randomId } from "./helpers";
import type { InsertObject } from "@shared/schema";

const TENANT_ID = "default-tenant";

describe("CustomerMode — HARDCODED / FROM_METADATA", () => {
  let customer1Id: string;
  let customer2Id: string;
  let objectWithCust1: string;
  let objectWithCust2: string;

  beforeAll(async () => {
    const customer1 = await storage.createCustomer({
      tenantId: TENANT_ID,
      name: `CustMode1 ${randomId()}`,
      customerNumber: randomId(),
    });
    customer1Id = customer1.id;

    const customer2 = await storage.createCustomer({
      tenantId: TENANT_ID,
      name: `CustMode2 ${randomId()}`,
      customerNumber: randomId(),
    });
    customer2Id = customer2.id;

    const obj1 = await storage.createObject({
      tenantId: TENANT_ID,
      customerId: customer1Id,
      name: `ObjCust1 ${randomId()}`,
      objectNumber: randomId(),
      objectType: "container",
      objectLevel: 2,
    } as InsertObject);
    objectWithCust1 = obj1.id;

    const obj2 = await storage.createObject({
      tenantId: TENANT_ID,
      customerId: customer2Id,
      name: `ObjCust2 ${randomId()}`,
      objectNumber: randomId(),
      objectType: "container",
      objectLevel: 2,
    } as InsertObject);
    objectWithCust2 = obj2.id;
  });

  describe("Schema defaults", () => {
    it("should default customerMode to HARDCODED on new order concept", async () => {
      const concept = await storage.createOrderConcept({
        tenantId: TENANT_ID,
        name: `Default Mode ${randomId()}`,
        scenario: "avrop",
        scheduleType: "once",
        status: "draft",
      });
      expect(concept.customerMode).toBe("HARDCODED");
    });

    it("should persist HARDCODED mode with customerId", async () => {
      const concept = await storage.createOrderConcept({
        tenantId: TENANT_ID,
        name: `Hardcoded ${randomId()}`,
        scenario: "avrop",
        scheduleType: "once",
        status: "draft",
        customerMode: "HARDCODED",
        customerId: customer1Id,
      });
      expect(concept.customerMode).toBe("HARDCODED");
      expect(concept.customerId).toBe(customer1Id);
    });

    it("should persist FROM_METADATA mode without customerId", async () => {
      const concept = await storage.createOrderConcept({
        tenantId: TENANT_ID,
        name: `FromMeta ${randomId()}`,
        scenario: "avrop",
        scheduleType: "once",
        status: "draft",
        customerMode: "FROM_METADATA",
      });
      expect(concept.customerMode).toBe("FROM_METADATA");
      expect(concept.customerId).toBeNull();
    });
  });

  describe("Update customerMode", () => {
    it("should update customerMode from HARDCODED to FROM_METADATA", async () => {
      const concept = await storage.createOrderConcept({
        tenantId: TENANT_ID,
        name: `UpdateMode ${randomId()}`,
        scenario: "avrop",
        scheduleType: "once",
        status: "draft",
        customerMode: "HARDCODED",
        customerId: customer1Id,
      });
      expect(concept.customerMode).toBe("HARDCODED");

      const updated = await storage.updateOrderConcept(concept.id, TENANT_ID, {
        customerMode: "FROM_METADATA",
        customerId: null,
      });
      expect(updated!.customerMode).toBe("FROM_METADATA");
      expect(updated!.customerId).toBeNull();
    });

    it("should update customerMode from FROM_METADATA to HARDCODED", async () => {
      const concept = await storage.createOrderConcept({
        tenantId: TENANT_ID,
        name: `RevertMode ${randomId()}`,
        scenario: "avrop",
        scheduleType: "once",
        status: "draft",
        customerMode: "FROM_METADATA",
      });

      const updated = await storage.updateOrderConcept(concept.id, TENANT_ID, {
        customerMode: "HARDCODED",
        customerId: customer1Id,
      });
      expect(updated!.customerMode).toBe("HARDCODED");
      expect(updated!.customerId).toBe(customer1Id);
    });
  });

  describe("check-customer-metadata logic", () => {
    it("should recognize objects with valid customer references", async () => {
      const objects = await storage.getObjectsByIds(TENANT_ID, [objectWithCust1, objectWithCust2]);
      const customers = await storage.getCustomers(TENANT_ID);
      const validCustomerIds = new Set(customers.map(c => c.id));

      const withCustomer = objects.filter(o => o.customerId && validCustomerIds.has(o.customerId));
      expect(withCustomer.length).toBe(2);
    });

    it("should identify objects with different customers", async () => {
      const objects = await storage.getObjectsByIds(TENANT_ID, [objectWithCust1, objectWithCust2]);
      const customerIds = new Set(objects.map(o => o.customerId));
      expect(customerIds.size).toBe(2);
      expect(customerIds.has(customer1Id)).toBe(true);
      expect(customerIds.has(customer2Id)).toBe(true);
    });
  });

  describe("Order concept with FROM_METADATA workflow", () => {
    it("should create concept with FROM_METADATA and resolve per-object customers", async () => {
      const concept = await storage.createOrderConcept({
        tenantId: TENANT_ID,
        name: `MetaWorkflow ${randomId()}`,
        scenario: "avrop",
        scheduleType: "once",
        status: "draft",
        customerMode: "FROM_METADATA",
      });

      expect(concept.customerMode).toBe("FROM_METADATA");
      expect(concept.customerId).toBeNull();

      const objects = await storage.getObjectsByIds(TENANT_ID, [objectWithCust1, objectWithCust2]);
      const distinctCustomers = new Set(objects.map(o => o.customerId));
      expect(distinctCustomers.size).toBe(2);
    });

    it("should create concept with HARDCODED and a single customer", async () => {
      const concept = await storage.createOrderConcept({
        tenantId: TENANT_ID,
        name: `HardcodedWorkflow ${randomId()}`,
        scenario: "avrop",
        scheduleType: "once",
        status: "draft",
        customerMode: "HARDCODED",
        customerId: customer1Id,
      });

      expect(concept.customerMode).toBe("HARDCODED");
      expect(concept.customerId).toBe(customer1Id);
    });
  });
});
