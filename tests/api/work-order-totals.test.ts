import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import {
  workOrders,
  workOrderLines,
  customers,
  objects,
  articles,
  tenants,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { DatabaseStorage } from "../../server/storage";

const storage = new DatabaseStorage();

let TEST_TENANT: string;
let createdTenant = false;
let customerId: string;
let objectId: string;
let articleAId: string;
let articleBId: string;

let primaryWorkOrderId: string;
let secondaryWorkOrderId: string;

const createdWorkOrderIds: string[] = [];
const createdLineIds: string[] = [];

async function getWorkOrderTotals(id: string) {
  const [wo] = await db
    .select({
      cachedValue: workOrders.cachedValue,
      cachedCost: workOrders.cachedCost,
      cachedProductionMinutes: workOrders.cachedProductionMinutes,
    })
    .from(workOrders)
    .where(eq(workOrders.id, id));
  return wo;
}

describe("Work order totals - automatisk recalc i storage-lagret", () => {
  beforeAll(async () => {
    const tenantId = `recalc-test-${Date.now()}`;
    const [tenant] = await db
      .insert(tenants)
      .values({
        id: tenantId,
        name: "Recalc Test Tenant",
      })
      .onConflictDoNothing()
      .returning();
    TEST_TENANT = tenant?.id ?? tenantId;
    createdTenant = !!tenant;

    const [customer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        name: "Recalc Testkund",
      })
      .returning();
    customerId = customer.id;

    const [object] = await db
      .insert(objects)
      .values({
        tenantId: TEST_TENANT,
        customerId,
        name: "Recalc Testobjekt",
      })
      .returning();
    objectId = object.id;

    const [articleA] = await db
      .insert(articles)
      .values({
        tenantId: TEST_TENANT,
        articleNumber: `RECALC-A-${Date.now()}`,
        name: "Recalc Test Artikel A",
        articleType: "tjanst",
        listPrice: 500,
        cost: 200,
        productionTime: 30,
      })
      .returning();
    articleAId = articleA.id;

    const [articleB] = await db
      .insert(articles)
      .values({
        tenantId: TEST_TENANT,
        articleNumber: `RECALC-B-${Date.now()}`,
        name: "Recalc Test Artikel B",
        articleType: "tjanst",
        listPrice: 250,
        cost: 100,
        productionTime: 15,
      })
      .returning();
    articleBId = articleB.id;

    const primary = await storage.createWorkOrder({
      tenantId: TEST_TENANT,
      customerId,
      objectId,
      title: "Recalc primärorder",
    });
    primaryWorkOrderId = primary.id;
    createdWorkOrderIds.push(primary.id);

    const secondary = await storage.createWorkOrder({
      tenantId: TEST_TENANT,
      customerId,
      objectId,
      title: "Recalc sekundärorder",
    });
    secondaryWorkOrderId = secondary.id;
    createdWorkOrderIds.push(secondary.id);
  });

  afterAll(async () => {
    if (createdLineIds.length > 0) {
      await db
        .delete(workOrderLines)
        .where(inArray(workOrderLines.id, createdLineIds))
        .catch(() => {});
    }
    if (createdWorkOrderIds.length > 0) {
      await db
        .delete(workOrderLines)
        .where(inArray(workOrderLines.workOrderId, createdWorkOrderIds))
        .catch(() => {});
      await db
        .delete(workOrders)
        .where(inArray(workOrders.id, createdWorkOrderIds))
        .catch(() => {});
    }
    if (articleAId) {
      await db.delete(articles).where(eq(articles.id, articleAId)).catch(() => {});
    }
    if (articleBId) {
      await db.delete(articles).where(eq(articles.id, articleBId)).catch(() => {});
    }
    if (objectId) {
      await db.delete(objects).where(eq(objects.id, objectId)).catch(() => {});
    }
    if (customerId) {
      await db.delete(customers).where(eq(customers.id, customerId)).catch(() => {});
    }
    if (createdTenant && TEST_TENANT) {
      await db.delete(tenants).where(eq(tenants.id, TEST_TENANT)).catch(() => {});
    }
  });

  describe("createWorkOrderLine", () => {
    it("uppdaterar cachedValue/Cost/ProductionMinutes automatiskt", async () => {
      const before = await getWorkOrderTotals(primaryWorkOrderId);
      expect(before.cachedValue).toBe(0);
      expect(before.cachedCost).toBe(0);
      expect(before.cachedProductionMinutes).toBe(0);

      const line = await storage.createWorkOrderLine({
        tenantId: TEST_TENANT,
        workOrderId: primaryWorkOrderId,
        articleId: articleAId,
        quantity: 2,
        resolvedPrice: 500,
        resolvedCost: 200,
        resolvedProductionMinutes: 30,
      });
      createdLineIds.push(line.id);

      const after = await getWorkOrderTotals(primaryWorkOrderId);
      expect(after.cachedValue).toBe(1000);
      expect(after.cachedCost).toBe(400);
      expect(after.cachedProductionMinutes).toBe(60);
    });

    it("ackumulerar korrekt med flera rader på samma order", async () => {
      const line = await storage.createWorkOrderLine({
        tenantId: TEST_TENANT,
        workOrderId: primaryWorkOrderId,
        articleId: articleBId,
        quantity: 3,
        resolvedPrice: 250,
        resolvedCost: 100,
        resolvedProductionMinutes: 15,
      });
      createdLineIds.push(line.id);

      const after = await getWorkOrderTotals(primaryWorkOrderId);
      expect(after.cachedValue).toBe(1000 + 750);
      expect(after.cachedCost).toBe(400 + 300);
      expect(after.cachedProductionMinutes).toBe(60 + 45);
    });

    it("ignorerar rader markerade som isOptional i totalerna", async () => {
      const optionalLine = await storage.createWorkOrderLine({
        tenantId: TEST_TENANT,
        workOrderId: primaryWorkOrderId,
        articleId: articleAId,
        quantity: 5,
        resolvedPrice: 500,
        resolvedCost: 200,
        resolvedProductionMinutes: 30,
        isOptional: true,
      });
      createdLineIds.push(optionalLine.id);

      const after = await getWorkOrderTotals(primaryWorkOrderId);
      expect(after.cachedValue).toBe(1750);
      expect(after.cachedCost).toBe(700);
      expect(after.cachedProductionMinutes).toBe(105);
    });
  });

  describe("updateWorkOrderLine", () => {
    let updatableLineId: string;

    it("uppdaterar totaler när antal/pris ändras på en befintlig rad", async () => {
      const line = await storage.createWorkOrderLine({
        tenantId: TEST_TENANT,
        workOrderId: secondaryWorkOrderId,
        articleId: articleAId,
        quantity: 1,
        resolvedPrice: 500,
        resolvedCost: 200,
        resolvedProductionMinutes: 30,
      });
      updatableLineId = line.id;
      createdLineIds.push(line.id);

      const initial = await getWorkOrderTotals(secondaryWorkOrderId);
      expect(initial.cachedValue).toBe(500);
      expect(initial.cachedCost).toBe(200);
      expect(initial.cachedProductionMinutes).toBe(30);

      await storage.updateWorkOrderLine(updatableLineId, {
        quantity: 4,
        resolvedPrice: 600,
        resolvedCost: 250,
        resolvedProductionMinutes: 45,
      });

      const after = await getWorkOrderTotals(secondaryWorkOrderId);
      expect(after.cachedValue).toBe(2400);
      expect(after.cachedCost).toBe(1000);
      expect(after.cachedProductionMinutes).toBe(180);
    });

    it("recalculerar BÅDE gammal och ny order när workOrderId byts", async () => {
      const beforePrimary = await getWorkOrderTotals(primaryWorkOrderId);
      const beforeSecondary = await getWorkOrderTotals(secondaryWorkOrderId);

      await storage.updateWorkOrderLine(updatableLineId, {
        workOrderId: primaryWorkOrderId,
      });

      const afterPrimary = await getWorkOrderTotals(primaryWorkOrderId);
      const afterSecondary = await getWorkOrderTotals(secondaryWorkOrderId);

      expect(afterSecondary.cachedValue).toBe(0);
      expect(afterSecondary.cachedCost).toBe(0);
      expect(afterSecondary.cachedProductionMinutes).toBe(0);

      expect(afterPrimary.cachedValue).toBe(beforePrimary.cachedValue! + 2400);
      expect(afterPrimary.cachedCost).toBe(beforePrimary.cachedCost! + 1000);
      expect(afterPrimary.cachedProductionMinutes).toBe(
        beforePrimary.cachedProductionMinutes! + 180,
      );

      expect(beforeSecondary.cachedValue).toBe(2400);
    });
  });

  describe("deleteWorkOrderLine", () => {
    it("uppdaterar totaler när en rad raderas", async () => {
      const line = await storage.createWorkOrderLine({
        tenantId: TEST_TENANT,
        workOrderId: secondaryWorkOrderId,
        articleId: articleAId,
        quantity: 2,
        resolvedPrice: 500,
        resolvedCost: 200,
        resolvedProductionMinutes: 30,
      });

      const beforeDelete = await getWorkOrderTotals(secondaryWorkOrderId);
      expect(beforeDelete.cachedValue).toBe(1000);
      expect(beforeDelete.cachedCost).toBe(400);
      expect(beforeDelete.cachedProductionMinutes).toBe(60);

      await storage.deleteWorkOrderLine(line.id);

      const afterDelete = await getWorkOrderTotals(secondaryWorkOrderId);
      expect(afterDelete.cachedValue).toBe(0);
      expect(afterDelete.cachedCost).toBe(0);
      expect(afterDelete.cachedProductionMinutes).toBe(0);
    });
  });

  describe("skipRecalc:true - bulk-prestandaläge", () => {
    let bulkOrderId: string;
    const bulkLineIds: string[] = [];

    beforeAll(async () => {
      const wo = await storage.createWorkOrder({
        tenantId: TEST_TENANT,
        customerId,
        objectId,
        title: "Recalc bulkorder",
      });
      bulkOrderId = wo.id;
      createdWorkOrderIds.push(wo.id);
    });

    it("createWorkOrderLine med skipRecalc:true triggar INTE recalc", async () => {
      const before = await getWorkOrderTotals(bulkOrderId);
      expect(before.cachedValue).toBe(0);

      const line = await storage.createWorkOrderLine(
        {
          tenantId: TEST_TENANT,
          workOrderId: bulkOrderId,
          articleId: articleAId,
          quantity: 10,
          resolvedPrice: 500,
          resolvedCost: 200,
          resolvedProductionMinutes: 30,
        },
        { skipRecalc: true },
      );
      bulkLineIds.push(line.id);
      createdLineIds.push(line.id);

      const after = await getWorkOrderTotals(bulkOrderId);
      expect(after.cachedValue).toBe(0);
      expect(after.cachedCost).toBe(0);
      expect(after.cachedProductionMinutes).toBe(0);
    });

    it("updateWorkOrderLine med skipRecalc:true triggar INTE recalc", async () => {
      await storage.recalculateWorkOrderTotals(bulkOrderId);
      const baseline = await getWorkOrderTotals(bulkOrderId);
      expect(baseline.cachedValue).toBe(5000);
      expect(baseline.cachedCost).toBe(2000);
      expect(baseline.cachedProductionMinutes).toBe(300);

      await storage.updateWorkOrderLine(
        bulkLineIds[0],
        {
          quantity: 20,
          resolvedPrice: 1000,
          resolvedCost: 400,
          resolvedProductionMinutes: 60,
        },
        { skipRecalc: true },
      );

      const after = await getWorkOrderTotals(bulkOrderId);
      expect(after.cachedValue).toBe(baseline.cachedValue);
      expect(after.cachedCost).toBe(baseline.cachedCost);
      expect(after.cachedProductionMinutes).toBe(baseline.cachedProductionMinutes);

      await storage.recalculateWorkOrderTotals(bulkOrderId);
      const recalced = await getWorkOrderTotals(bulkOrderId);
      expect(recalced.cachedValue).toBe(20000);
      expect(recalced.cachedCost).toBe(8000);
      expect(recalced.cachedProductionMinutes).toBe(1200);
    });

    it("deleteWorkOrderLine med skipRecalc:true triggar INTE recalc", async () => {
      const baseline = await getWorkOrderTotals(bulkOrderId);
      expect(baseline.cachedValue).toBeGreaterThan(0);

      await storage.deleteWorkOrderLine(bulkLineIds[0], { skipRecalc: true });
      const idx = createdLineIds.indexOf(bulkLineIds[0]);
      if (idx >= 0) createdLineIds.splice(idx, 1);

      const after = await getWorkOrderTotals(bulkOrderId);
      expect(after.cachedValue).toBe(baseline.cachedValue);
      expect(after.cachedCost).toBe(baseline.cachedCost);
      expect(after.cachedProductionMinutes).toBe(baseline.cachedProductionMinutes);

      await storage.recalculateWorkOrderTotals(bulkOrderId);
      const recalced = await getWorkOrderTotals(bulkOrderId);
      expect(recalced.cachedValue).toBe(0);
      expect(recalced.cachedCost).toBe(0);
      expect(recalced.cachedProductionMinutes).toBe(0);
    });
  });
});
