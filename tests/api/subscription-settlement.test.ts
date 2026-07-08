import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import {
  tenants,
  customers,
  objects,
  orderConcepts,
  articles,
  fortnoxMappings,
  workOrders,
  workOrderLines,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../../server/storage";
import { applySubscriptionSettlement } from "../../server/services/assignment-invoice-materializer";

// Task #1187 — kvittning av abonnemangstäckt uppgift. DB-integrationstest mot dev-DB.
// Verifierar kärnacceptansen för applySubscriptionSettlement:
//   - en täckt WO med positivt netto får EN negativ kvittningsrad (på kvittnings-
//     artikeln) som nettar WO:n till 0 + markeras subscriptionCovered,
//   - re-anrop är idempotent (matchar befintlig negativ rad PÅ kvittningsartikeln),
//   - fail-closed: koncept utan kvittningsartikel blockeras (settled:false + reason),
//   - fail-closed: kvittningsartikel utan Fortnox-koppling blockeras.

let TENANT: string;
let customerId: string;
let objectId: string;
let chargeArticleId: string;
let settlementArticleId: string;
let unmappedArticleId: string;
let conceptWithSettlement: string;
let conceptNoSettlement: string;
let conceptUnmapped: string;

async function woWithCharge(conceptId: string, priceOre: number) {
  const wo = await storage.createWorkOrder({
    tenantId: TENANT,
    customerId,
    objectId,
    title: "Abonnemangs-WO #1187",
    orderConceptId: conceptId,
  });
  await storage.createWorkOrderLine({
    tenantId: TENANT,
    workOrderId: wo.id,
    articleId: chargeArticleId,
    quantity: 1,
    resolvedPrice: priceOre,
    resolvedCost: 0,
    resolvedProductionMinutes: 0,
    description: "Tömning",
  });
  const full = await storage.getWorkOrder(wo.id);
  return full!;
}

beforeAll(async () => {
  const stamp = `sett-${Date.now()}`;
  TENANT = `${stamp}-t`;
  await db.insert(tenants).values({ id: TENANT, name: "Settlement Test Tenant" }).onConflictDoNothing();

  const [customer] = await db
    .insert(customers)
    .values({ tenantId: TENANT, name: "Settlement Testkund" })
    .returning();
  customerId = customer.id;

  const [object] = await db
    .insert(objects)
    .values({ tenantId: TENANT, customerId, name: "Settlement Objekt", objectType: "fastighet" })
    .returning();
  objectId = object.id;

  const [charge] = await db
    .insert(articles)
    .values({ tenantId: TENANT, articleNumber: "CH-1", name: "Tömningsartikel" })
    .returning();
  chargeArticleId = charge.id;

  const [settle] = await db
    .insert(articles)
    .values({ tenantId: TENANT, articleNumber: "KV-1", name: "Kvittningsartikel" })
    .returning();
  settlementArticleId = settle.id;

  const [unmapped] = await db
    .insert(articles)
    .values({ tenantId: TENANT, articleNumber: "KV-2", name: "Okopplad kvittningsartikel" })
    .returning();
  unmappedArticleId = unmapped.id;

  // Endast kvittningsartikeln (KV-1) har en Fortnox-koppling.
  await storage.createFortnoxMapping({
    tenantId: TENANT,
    entityType: "article",
    unicornId: settlementArticleId,
    fortnoxId: "FX-KV-1",
  });

  const [c1] = await db
    .insert(orderConcepts)
    .values({
      tenantId: TENANT,
      name: "Abonnemang med kvittning",
      scenario: "abonnemang",
      settlementArticleId,
    })
    .returning();
  conceptWithSettlement = c1.id;

  const [c2] = await db
    .insert(orderConcepts)
    .values({
      tenantId: TENANT,
      name: "Abonnemang utan kvittningsartikel",
      scenario: "abonnemang",
    })
    .returning();
  conceptNoSettlement = c2.id;

  const [c3] = await db
    .insert(orderConcepts)
    .values({
      tenantId: TENANT,
      name: "Abonnemang med okopplad kvittningsartikel",
      scenario: "abonnemang",
      settlementArticleId: unmappedArticleId,
    })
    .returning();
  conceptUnmapped = c3.id;
}, 30000);

afterAll(async () => {
  if (!TENANT) return;
  await db.delete(workOrderLines).where(eq(workOrderLines.tenantId, TENANT));
  await db.delete(workOrders).where(eq(workOrders.tenantId, TENANT));
  await db.delete(fortnoxMappings).where(eq(fortnoxMappings.tenantId, TENANT));
  await db.delete(orderConcepts).where(eq(orderConcepts.tenantId, TENANT));
  await db.delete(articles).where(eq(articles.tenantId, TENANT));
  await db.delete(objects).where(eq(objects.tenantId, TENANT));
  await db.delete(customers).where(eq(customers.tenantId, TENANT));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
}, 30000);

describe("applySubscriptionSettlement", () => {
  it("injicerar EN negativ kvittningsrad som nettar WO:n till 0 + markerar täckt", async () => {
    const wo = await woWithCharge(conceptWithSettlement, 25000);

    const res = await applySubscriptionSettlement(wo, TENANT, new Date());
    expect(res.settled).toBe(true);

    const lines = await storage.getWorkOrderLines(wo.id);
    // Ursprunglig debiteringsrad + en negativ kvittningsrad.
    expect(lines).toHaveLength(2);
    const net = lines.reduce(
      (s, l) => s + Number(l.resolvedPrice ?? 0) * Number(l.quantity ?? 1),
      0,
    );
    expect(net).toBe(0);
    const settlementLine = lines.find((l) => l.articleId === settlementArticleId);
    expect(settlementLine).toBeDefined();
    expect(Number(settlementLine!.resolvedPrice)).toBe(-25000);

    const reloaded = await storage.getWorkOrder(wo.id);
    expect(reloaded?.subscriptionCovered).toBe(true);
    expect(reloaded?.subscriptionCoveredAt).not.toBeNull();
    expect(reloaded?.invoiceBlockedReason).toBeNull();
  });

  it("är idempotent: re-anrop lägger ingen andra kvittningsrad", async () => {
    const wo = await woWithCharge(conceptWithSettlement, 18000);

    const first = await applySubscriptionSettlement(wo, TENANT, new Date());
    expect(first.settled).toBe(true);
    const second = await applySubscriptionSettlement(wo, TENANT, new Date());
    expect(second.settled).toBe(true);

    const lines = await storage.getWorkOrderLines(wo.id);
    expect(lines).toHaveLength(2);
    const negatives = lines.filter((l) => Number(l.resolvedPrice ?? 0) < 0);
    expect(negatives).toHaveLength(1);
  });

  it("fail-closed: koncept utan kvittningsartikel blockeras (ingen negativ rad)", async () => {
    const wo = await woWithCharge(conceptNoSettlement, 12000);

    const res = await applySubscriptionSettlement(wo, TENANT, new Date());
    expect(res.settled).toBe(false);
    expect(res.reason).toBe("no_settlement_article");

    const lines = await storage.getWorkOrderLines(wo.id);
    expect(lines).toHaveLength(1); // ingen kvittningsrad injicerad
    const reloaded = await storage.getWorkOrder(wo.id);
    // WO:n markeras täckt direkt (guards skyddar) men blockeras från fakturakö.
    expect(reloaded?.subscriptionCovered).toBe(true);
    expect(reloaded?.invoiceBlockedReason).toBe("abonnemang_saknar_kvittningsartikel");
  });

  it("fail-closed: kvittningsartikel utan Fortnox-koppling blockeras", async () => {
    const wo = await woWithCharge(conceptUnmapped, 9000);

    const res = await applySubscriptionSettlement(wo, TENANT, new Date());
    expect(res.settled).toBe(false);
    expect(res.reason).toBe("settlement_article_unmapped");

    const lines = await storage.getWorkOrderLines(wo.id);
    expect(lines).toHaveLength(1);
    const reloaded = await storage.getWorkOrder(wo.id);
    expect(reloaded?.invoiceBlockedReason).toBe("kvittningsartikel_saknar_fortnox_koppling");
  });
});
