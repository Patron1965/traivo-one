import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import {
  tenants,
  customers,
  objects,
  articles,
  orderConcepts,
  orderConceptArticles,
  customerInvoices,
  metadataKatalog,
  metadataVarden,
  type ServiceObject,
} from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  groupSubscriptionInvoices,
  computeConceptSubscriptionFee,
  isConceptFakturastopp,
  distributeOreEvenly,
} from "../../server/services/order-concept-subscription";
import { runDueConceptsForTenant } from "../../server/services/order-concept-auto-runner";
import { resolveConceptMatchingObjects } from "../../server/services/order-concept-targeting";
import { buildSubscriptionSegmentsPreview } from "../../server/routes/fortnoxRoutes";

// Task #1071: Tester för abonnemangsfakturornas nivå-split (Task #1067) och den
// dynamiska avgiften (Task #1057). Verifierar:
//  (1) groupSubscriptionInvoices: split per metadatavärde (fakturastopp), roll-up
//      till kundnivå för objekt utan värde, samt öre-invarianten Σ per segment ==
//      totalsumman (ingen tappad eller dubbelräknad öre).
//  (2) Utan fakturastopp degenererar grupperingen till en grupp per kund.
//  (3) Olika fakturakund per objekt (FROM_METADATA-läge) delar per kund.
//  (4) preview == execute: schemaläggaren (runDueConceptsForTenant →
//      runSubscriptionConcept) och förhandsvisningen (buildSubscriptionSegmentsPreview)
//      producerar identiska segment, eftersom båda går via groupSubscriptionInvoices.
// Kör mot riktig dev-DB; städar upp allt i afterAll.

const NS = `subs-${Date.now()}`;
const SPLIT_FIELD = "Fastighet";

// === Tenant A: ren grupperings-logik (groupSubscriptionInvoices) ===
const TENANT_A = `${NS}-a`;
let custA: string;
let katFastighetA: string;
let objA: ServiceObject; // Fastighet = "Hus 1"
let objB: ServiceObject; // Fastighet = "Hus 2"
let objC: ServiceObject; // Fastighet = "Hus 1" (samma som A)
let objD: ServiceObject; // saknar Fastighet → kundnivå

// === Tenant B: end-to-end preview == execute ===
const TENANT_B = `${NS}-b`;
let custB: string;
let katFastighetB: string;
let conceptB: typeof orderConcepts.$inferSelect;

async function setStringMeta(
  tenantId: string,
  objektId: string,
  katalogId: string,
  value: string,
) {
  await db.insert(metadataVarden).values({
    tenantId,
    objektId,
    metadataKatalogId: katalogId,
    vardeString: value,
  });
}

beforeAll(async () => {
  // --- Tenant A ---
  await db.insert(tenants).values({ id: TENANT_A, name: "Subs Test A" }).onConflictDoNothing();
  const [cA] = await db.insert(customers).values({ tenantId: TENANT_A, name: "Kund A" }).returning();
  custA = cA.id;
  const [kA] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT_A, namn: SPLIT_FIELD, datatyp: "string", beteckning: "FAST" })
    .returning();
  katFastighetA = kA.id;

  [objA] = await db
    .insert(objects)
    .values({ tenantId: TENANT_A, customerId: custA, name: "Objekt A" })
    .returning();
  [objB] = await db
    .insert(objects)
    .values({ tenantId: TENANT_A, customerId: custA, name: "Objekt B" })
    .returning();
  [objC] = await db
    .insert(objects)
    .values({ tenantId: TENANT_A, customerId: custA, name: "Objekt C" })
    .returning();
  [objD] = await db
    .insert(objects)
    .values({ tenantId: TENANT_A, customerId: custA, name: "Objekt D" })
    .returning();

  await setStringMeta(TENANT_A, objA.id, katFastighetA, "Hus 1");
  await setStringMeta(TENANT_A, objB.id, katFastighetA, "Hus 2");
  await setStringMeta(TENANT_A, objC.id, katFastighetA, "Hus 1");
  // objD: inget värde → kundnivå-roll-up.

  // --- Tenant B (end-to-end) ---
  await db.insert(tenants).values({ id: TENANT_B, name: "Subs Test B" }).onConflictDoNothing();
  const [cB] = await db.insert(customers).values({ tenantId: TENANT_B, name: "Kund B" }).returning();
  custB = cB.id;
  const [kB] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT_B, namn: SPLIT_FIELD, datatyp: "string", beteckning: "FAST" })
    .returning();
  katFastighetB = kB.id;

  const [bObj1] = await db
    .insert(objects)
    .values({ tenantId: TENANT_B, customerId: custB, name: "B-Objekt 1" })
    .returning();
  const [bObj2] = await db
    .insert(objects)
    .values({ tenantId: TENANT_B, customerId: custB, name: "B-Objekt 2" })
    .returning();
  const [bObj3] = await db
    .insert(objects)
    .values({ tenantId: TENANT_B, customerId: custB, name: "B-Objekt 3" })
    .returning();
  await setStringMeta(TENANT_B, bObj1.id, katFastighetB, "Hus 1");
  await setStringMeta(TENANT_B, bObj2.id, katFastighetB, "Hus 2");
  await setStringMeta(TENANT_B, bObj3.id, katFastighetB, "Hus 1");

  // Artikel med löpande pris (250,00 kr = 25000 öre per objekt).
  const [art] = await db
    .insert(articles)
    .values({
      tenantId: TENANT_B,
      articleNumber: `${NS}-ART`,
      name: "Abonnemangstjänst",
      articleType: "tjanst",
      listPrice: 25000,
      cost: 0,
      productionTime: 0,
    })
    .returning();

  // Abonnemangskoncept med fakturastopp på "Fastighet". HARDCODED kund (samma kund
  // hela vägen) → fakturan delas ORGANISATORISKT per fastighet. Förfallet nu.
  const now = new Date();
  const [c] = await db
    .insert(orderConcepts)
    .values({
      tenantId: TENANT_B,
      name: "Abonnemang B",
      scenario: "abonnemang",
      scheduleType: "subscription",
      invoiceModel: "subscription",
      customerMode: "HARDCODED",
      customerId: custB,
      priceModel: "running",
      billingFrequency: "monthly",
      invoiceConsolidation: "monthly",
      departmentMetadataField: SPLIT_FIELD,
      status: "active",
      nextRunDate: now,
    })
    .returning();
  conceptB = c;
  await db.insert(orderConceptArticles).values({
    orderConceptId: conceptB.id,
    articleId: art.id,
    quantity: 1,
    unitPrice: 25000,
  });
}, 30000);

afterAll(async () => {
  for (const t of [TENANT_A, TENANT_B]) {
    await db.delete(customerInvoices).where(eq(customerInvoices.tenantId, t));
    await db.delete(orderConceptArticles).where(
      inArray(
        orderConceptArticles.orderConceptId,
        db.select({ id: orderConcepts.id }).from(orderConcepts).where(eq(orderConcepts.tenantId, t)),
      ),
    );
    await db.delete(orderConcepts).where(eq(orderConcepts.tenantId, t));
    await db.delete(articles).where(eq(articles.tenantId, t));
    await db.delete(metadataVarden).where(eq(metadataVarden.tenantId, t));
    await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, t));
    await db.delete(objects).where(eq(objects.tenantId, t));
    await db.delete(customers).where(eq(customers.tenantId, t));
    await db.delete(tenants).where(eq(tenants.id, t));
  }
}, 30000);

describe("distributeOreEvenly — exakt heltals-fördelning (största-rest)", () => {
  it("jämn delning ger lika delar", () => {
    expect(distributeOreEvenly(30000, 3)).toEqual([10000, 10000, 10000]);
  });

  it("ojämn delning fördelar restören deterministiskt, Σ == total", () => {
    const out = distributeOreEvenly(10000, 3);
    expect(out).toEqual([3334, 3333, 3333]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it("count 0 → tom array", () => {
    expect(distributeOreEvenly(100, 0)).toEqual([]);
  });
});

describe("isConceptFakturastopp", () => {
  it("aktiv när konsolidering != kund/per_job OCH fält valt", () => {
    expect(
      isConceptFakturastopp({ invoiceConsolidation: "monthly", departmentMetadataField: "Fastighet" }),
    ).toBe(true);
  });

  it("inaktiv vid kundnivå-konsolidering", () => {
    expect(
      isConceptFakturastopp({ invoiceConsolidation: "customer", departmentMetadataField: "Fastighet" }),
    ).toBe(false);
    expect(
      isConceptFakturastopp({ invoiceConsolidation: "per_job", departmentMetadataField: "Fastighet" }),
    ).toBe(false);
  });

  it("inaktiv utan valt fält", () => {
    expect(isConceptFakturastopp({ invoiceConsolidation: "monthly", departmentMetadataField: "" })).toBe(
      false,
    );
  });
});

describe("groupSubscriptionInvoices — split per nivå (Task #1067)", () => {
  const conceptStopp = {
    invoiceConsolidation: "monthly",
    departmentMetadataField: SPLIT_FIELD,
  };

  it("ett segment per metadatavärde; objekt utan värde → kundnivå; öre-summa bevaras", async () => {
    const perObjectValuesOre = [10000, 20000, 30000, 40000];
    const matchingObjects = [objA, objB, objC, objD];
    const groups = await groupSubscriptionInvoices({
      tenantId: TENANT_A,
      concept: conceptStopp,
      matchingObjects,
      perObjectValuesOre,
      customerIdForObject: () => custA,
    });

    // Hus 1 (A+C), Hus 2 (B), kundnivå (D) = 3 grupper.
    expect(groups.length).toBe(3);

    const hus1 = groups.find((g) => g.groupingValue === "Hus 1");
    const hus2 = groups.find((g) => g.groupingValue === "Hus 2");
    const kundniva = groups.find((g) => g.segmentKey === null);

    expect(hus1).toBeDefined();
    expect(hus2).toBeDefined();
    expect(kundniva).toBeDefined();

    // Segmentnyckel-format: `fält=normaliserat värde` (lowercased).
    expect(hus1!.segmentKey).toBe("Fastighet=hus 1");
    expect(hus1!.groupingFieldName).toBe(SPLIT_FIELD);
    expect(hus1!.objectIds.sort()).toEqual([objA.id, objC.id].sort());
    expect(hus1!.valueOre).toBe(10000 + 30000);

    expect(hus2!.objectIds).toEqual([objB.id]);
    expect(hus2!.valueOre).toBe(20000);

    // Objekt utan värde rullar upp till kundnivå (ingen split).
    expect(kundniva!.groupingFieldName).toBe(null);
    expect(kundniva!.groupingValue).toBe(null);
    expect(kundniva!.objectIds).toEqual([objD.id]);
    expect(kundniva!.valueOre).toBe(40000);

    // Öre-invariant: Σ per segment == totalsumman (inget tappat/dubbelräknat).
    const totalOut = groups.reduce((s, g) => s + g.valueOre, 0);
    expect(totalOut).toBe(perObjectValuesOre.reduce((a, b) => a + b, 0));

    // Alla segment hör till samma kund (fakturastopp = organisatorisk split).
    expect(new Set(groups.map((g) => g.customerId))).toEqual(new Set([custA]));
  });

  it("utan fakturastopp degenererar till EN grupp per kund", async () => {
    const conceptKund = { invoiceConsolidation: "customer", departmentMetadataField: SPLIT_FIELD };
    const perObjectValuesOre = [10000, 20000, 30000, 40000];
    const groups = await groupSubscriptionInvoices({
      tenantId: TENANT_A,
      concept: conceptKund,
      matchingObjects: [objA, objB, objC, objD],
      perObjectValuesOre,
      customerIdForObject: () => custA,
    });
    expect(groups.length).toBe(1);
    expect(groups[0].segmentKey).toBe(null);
    expect(groups[0].objectIds.sort()).toEqual([objA.id, objB.id, objC.id, objD.id].sort());
    expect(groups[0].valueOre).toBe(100000);
  });

  it("olika fakturakund per objekt (FROM_METADATA) → en grupp per kund", async () => {
    const conceptKund = { invoiceConsolidation: "customer", departmentMetadataField: "" };
    const perObjectValuesOre = [10000, 20000, 30000, 40000];
    const custMap: Record<string, string> = {
      [objA.id]: "kund-1",
      [objB.id]: "kund-1",
      [objC.id]: "kund-2",
      [objD.id]: "kund-2",
    };
    const groups = await groupSubscriptionInvoices({
      tenantId: TENANT_A,
      concept: conceptKund,
      matchingObjects: [objA, objB, objC, objD],
      perObjectValuesOre,
      customerIdForObject: (id) => custMap[id],
    });
    expect(groups.length).toBe(2);
    const k1 = groups.find((g) => g.customerId === "kund-1");
    const k2 = groups.find((g) => g.customerId === "kund-2");
    expect(k1!.valueOre).toBe(30000);
    expect(k2!.valueOre).toBe(70000);
    // Öre-invariant även här.
    expect(groups.reduce((s, g) => s + g.valueOre, 0)).toBe(100000);
  });

  it("objekt vars kund inte kan härledas hoppas över (ingen NULL-grupp)", async () => {
    const groups = await groupSubscriptionInvoices({
      tenantId: TENANT_A,
      concept: { invoiceConsolidation: "customer", departmentMetadataField: "" },
      matchingObjects: [objA, objB],
      perObjectValuesOre: [10000, 20000],
      customerIdForObject: (id) => (id === objA.id ? custA : null),
    });
    expect(groups.length).toBe(1);
    expect(groups[0].customerId).toBe(custA);
    expect(groups[0].valueOre).toBe(10000);
  });
});

describe("preview == execute (Task #1067) — schemaläggare och förhandsvisning ger identiska segment", () => {
  it("runDueConceptsForTenant och buildSubscriptionSegmentsPreview matchar per segment", async () => {
    const now = new Date();

    // --- Förhandsvisning (samma härledning som /fortnox-route) ---
    const { matchingObjects } = await resolveConceptMatchingObjects(
      TENANT_B,
      conceptB as any,
      [],
      { fallbackAllObjects: true },
    );
    const fee = await computeConceptSubscriptionFee(TENANT_B, conceptB as any, { matchingObjects });
    expect(fee.canCompute).toBe(true);
    expect(fee.matchedCount).toBe(3);
    // 3 objekt × 25000 öre = 75000 öre total; perObjektsumma bevarad.
    expect(fee.perObjectValuesOre.reduce((a, b) => a + b, 0)).toBe(fee.totalValueOre);
    expect(fee.totalValueOre).toBe(75000);

    const previewSegments = await buildSubscriptionSegmentsPreview(
      TENANT_B,
      conceptB as any,
      matchingObjects,
      fee,
    );
    // Två fastigheter (Hus 1 = 2 objekt, Hus 2 = 1 objekt), inga kundnivå-rester.
    expect(previewSegments.length).toBe(2);

    // --- Exekvering (schemaläggaren skapar verkliga fakturor) ---
    const result = await runDueConceptsForTenant(TENANT_B, { now });
    expect(result.subscriptionsBilled).toBe(1);
    // En faktura per segment (Hus 1, Hus 2).
    expect(result.invoicesCreated).toBe(2);

    const invoices = await db
      .select()
      .from(customerInvoices)
      .where(eq(customerInvoices.tenantId, TENANT_B));
    expect(invoices.length).toBe(2);

    // Bygg jämförbara nycklar: segmentKey → { totalBelopp (kr), objektantal }.
    const previewByKey = new Map(
      previewSegments.map((s) => [s.segmentKey, { total: s.monthlyTotal, count: s.objectCount }]),
    );
    const executeByKey = new Map(
      invoices.map((inv) => [inv.billingSegmentKey, Number(inv.totalAmount)]),
    );

    // Samma uppsättning segmentnycklar i båda vägar.
    expect(new Set(executeByKey.keys())).toEqual(new Set(previewByKey.keys()));

    // Belopp per segment identiska (monthly ⇒ stepMonths=1 ⇒ kr == förhandsvisningens monthlyTotal).
    for (const [key, prev] of previewByKey) {
      expect(executeByKey.get(key)).toBe(prev.total);
    }

    // Summan över alla segment == total avgift (75000 öre = 750 kr), öre-invariant.
    const executeTotalKr = invoices.reduce((s, inv) => s + Number(inv.totalAmount), 0);
    expect(executeTotalKr).toBe(750);

    // Alla fakturor på SAMMA kund (fakturastopp = organisatorisk split).
    expect(new Set(invoices.map((i) => i.customerId))).toEqual(new Set([custB]));
    // Alla split-fakturor frusna med korrekt grupperingsfält.
    for (const inv of invoices) {
      expect(inv.billingGroupingFieldName).toBe(SPLIT_FIELD);
      expect(inv.billingSegmentKey).toBeTruthy();
    }
  });
});
