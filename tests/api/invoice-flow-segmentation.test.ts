import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import {
  tenants,
  customers,
  objects,
  workOrders,
  customerInvoices,
  invoiceRecipients,
  invoiceConsolidationPolicies,
  metadataKatalog,
  metadataVarden,
} from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  getInvoiceFlowConfig,
  setInvoiceFlowConfig,
  computeBillingSegmentForObject,
  computeBillingSegmentsForSubtree,
  buildSegmentKey,
  EMPTY_SEGMENT,
  DEFAULT_BREAK_FIELD_NAME,
  DEFAULT_GROUPING_FIELD_NAME,
  type InvoiceFlowConfig,
} from "../../server/services/invoice-flow-segmentation";
import {
  markWorkOrderReadyForInvoice,
  runConsolidationForTenant,
} from "../../server/services/invoice-consolidation";

// Task #970 — Metadatastyrd fakturaflödeslogik.
// Verifierar: (1) config round-trip + default-semantik, (2) segment-beräkning
// (lokal brytpunkt UP-walk + ärvd gruppering nearest-wins), (3) frys vid
// ready-time, (4) konsolidering grupperar per fryst segment (NULL = dagens
// beteende). Kör mot riktig dev-DB; städar upp allt i afterAll.

const BREAK_FIELD = "Fakturastopp";
const GROUP_FIELD = "Förvaltare";

const CONFIG: InvoiceFlowConfig = {
  enabled: true,
  breakFieldName: BREAK_FIELD,
  groupingFieldName: GROUP_FIELD,
};

let TENANT: string;
let customerId: string;
let recipientId: string;
let breakKatId: string;
let groupKatId: string;

// Objektträd:
//   root  (Förvaltare="Alpha")
//    ├── a  (ärver Alpha)
//    │    └── a1 (Förvaltare="Beta")
//    └── b  (Fakturastopp=Ja, ärver Alpha)
//         └── b1 (ärver brytnod b + Alpha)
let rootId: string;
let aId: string;
let a1Id: string;
let bId: string;
let b1Id: string;

const createdWoIds: string[] = [];

async function insertObject(name: string, parentId: string | null): Promise<string> {
  const [o] = await db
    .insert(objects)
    .values({
      tenantId: TENANT,
      customerId,
      name,
      objectType: "fastighet",
      parentId: parentId ?? null,
    })
    .returning();
  return o.id;
}

async function setBreak(objektId: string, value: boolean) {
  await db.insert(metadataVarden).values({
    tenantId: TENANT,
    objektId,
    metadataKatalogId: breakKatId,
    vardeBoolean: value,
  });
}

async function setGroup(objektId: string, value: string) {
  await db.insert(metadataVarden).values({
    tenantId: TENANT,
    objektId,
    metadataKatalogId: groupKatId,
    vardeString: value,
  });
}

async function insertHeldWo(opts: {
  segmentKey: string | null;
  breakObjectId?: string | null;
  groupingValue?: string | null;
  cachedValue?: number;
  frozenUnitPrice?: number | null;
  frozenQuantity?: number | null;
  objectId?: string | null;
}): Promise<string> {
  const now = new Date();
  const [wo] = await db
    .insert(workOrders)
    .values({
      tenantId: TENANT,
      customerId,
      objectId: opts.objectId ?? rootId,
      title: `Flow WO ${Math.random().toString(36).slice(2, 8)}`,
      orderStatus: "skapad",
      cachedValue: opts.cachedValue ?? 0,
      frozenUnitPrice: opts.frozenUnitPrice ?? null,
      frozenQuantity: opts.frozenQuantity ?? null,
      frozenInvoiceRecipientId: recipientId,
      invoiceQueueState: "held",
      invoiceReadyAt: now,
      invoiceHeldUntil: new Date(now.getTime() - 60_000),
      billingSegmentKey: opts.segmentKey,
      billingBreakObjectId: opts.breakObjectId ?? null,
      billingGroupingFieldName: opts.segmentKey ? GROUP_FIELD : null,
      billingGroupingValue: opts.groupingValue ?? null,
    })
    .returning();
  createdWoIds.push(wo.id);
  return wo.id;
}

beforeAll(async () => {
  const tenantId = `invflow-${Date.now()}`;
  const [tenant] = await db
    .insert(tenants)
    .values({ id: tenantId, name: "InvoiceFlow Test Tenant" })
    .onConflictDoNothing()
    .returning();
  TENANT = tenant?.id ?? tenantId;

  const [customer] = await db
    .insert(customers)
    .values({ tenantId: TENANT, name: "Flow Testkund" })
    .returning();
  customerId = customer.id;

  const [recipient] = await db
    .insert(invoiceRecipients)
    .values({
      tenantId: TENANT,
      customerId,
      level: "central",
      recipientName: "Flow Mottagare",
    })
    .returning();
  recipientId = recipient.id;

  const [breakKat] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: BREAK_FIELD, datatyp: "boolean", beteckning: "FSTOP" })
    .returning();
  breakKatId = breakKat.id;

  const [groupKat] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: GROUP_FIELD, datatyp: "string", beteckning: "FORV" })
    .returning();
  groupKatId = groupKat.id;

  rootId = await insertObject("root", null);
  aId = await insertObject("a", rootId);
  a1Id = await insertObject("a1", aId);
  bId = await insertObject("b", rootId);
  b1Id = await insertObject("b1", bId);

  await setGroup(rootId, "Alpha");
  await setGroup(a1Id, "Beta");
  await setBreak(bId, true);

  // Aktivera flödet på denna tenant (markReady-frysningen läser denna config).
  await setInvoiceFlowConfig(TENANT, {
    enabled: true,
    breakFieldName: BREAK_FIELD,
    groupingFieldName: GROUP_FIELD,
  });
});

afterAll(async () => {
  if (!TENANT) return;
  await db.delete(metadataVarden).where(eq(metadataVarden.tenantId, TENANT));
  await db.delete(customerInvoices).where(eq(customerInvoices.tenantId, TENANT));
  await db.delete(workOrders).where(eq(workOrders.tenantId, TENANT));
  await db
    .delete(invoiceConsolidationPolicies)
    .where(eq(invoiceConsolidationPolicies.tenantId, TENANT));
  await db.delete(invoiceRecipients).where(eq(invoiceRecipients.tenantId, TENANT));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT));
  await db.delete(objects).where(eq(objects.tenantId, TENANT));
  await db.delete(customers).where(eq(customers.tenantId, TENANT));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
});

describe("Task #970 — invoiceFlow config", () => {
  it("default-semantik: saknad config ⇒ avstängd + default-fältnamn", async () => {
    const tmpId = `invflow-def-${Date.now()}`;
    await db.insert(tenants).values({ id: tmpId, name: "Flow Default" }).onConflictDoNothing();
    try {
      const cfg = await getInvoiceFlowConfig(tmpId);
      expect(cfg.enabled).toBe(false);
      expect(cfg.breakFieldName).toBe(DEFAULT_BREAK_FIELD_NAME);
      expect(cfg.groupingFieldName).toBe(DEFAULT_GROUPING_FIELD_NAME);
    } finally {
      await db.delete(tenants).where(eq(tenants.id, tmpId));
    }
  });

  it("round-trip + explicit null grupperingsfält ⇒ gruppering avstängd", async () => {
    const tmpId = `invflow-rt-${Date.now()}`;
    await db.insert(tenants).values({ id: tmpId, name: "Flow RT" }).onConflictDoNothing();
    try {
      const saved = await setInvoiceFlowConfig(tmpId, {
        enabled: true,
        breakFieldName: "MinBryt",
        groupingFieldName: "MinGrupp",
      });
      expect(saved).toEqual({ enabled: true, breakFieldName: "MinBryt", groupingFieldName: "MinGrupp" });

      const withoutGroup = await setInvoiceFlowConfig(tmpId, { groupingFieldName: null });
      expect(withoutGroup.groupingFieldName).toBeNull();
      expect(withoutGroup.enabled).toBe(true);
      expect(withoutGroup.breakFieldName).toBe("MinBryt");
    } finally {
      await db.delete(tenants).where(eq(tenants.id, tmpId));
    }
  });
});

describe("Task #970 — computeBillingSegmentForObject (UP-walk)", () => {
  it("avstängt flöde ⇒ EMPTY_SEGMENT", async () => {
    const seg = await computeBillingSegmentForObject(TENANT, b1Id, {
      ...CONFIG,
      enabled: false,
    });
    expect(seg).toEqual(EMPTY_SEGMENT);
    expect(seg.segmentKey).toBeNull();
  });

  it("root: ingen brytpunkt, egen gruppering Alpha", async () => {
    const seg = await computeBillingSegmentForObject(TENANT, rootId, CONFIG);
    expect(seg.breakObjectId).toBeNull();
    expect(seg.groupingValue).toBe("Alpha");
    expect(seg.segmentKey).toBe(buildSegmentKey(null, "Alpha"));
  });

  it("a (syskon till b): ärver gruppering Alpha men ÄRVER INTE brytpunkten (lokal)", async () => {
    const seg = await computeBillingSegmentForObject(TENANT, aId, CONFIG);
    expect(seg.breakObjectId).toBeNull();
    expect(seg.groupingValue).toBe("Alpha");
  });

  it("a1: eget grupperingsvärde Beta vinner över ärvt Alpha", async () => {
    const seg = await computeBillingSegmentForObject(TENANT, a1Id, CONFIG);
    expect(seg.breakObjectId).toBeNull();
    expect(seg.groupingValue).toBe("Beta");
    expect(seg.segmentKey).toBe(buildSegmentKey(null, "Beta"));
  });

  it("b: egen brytpunkt + ärvd gruppering Alpha", async () => {
    const seg = await computeBillingSegmentForObject(TENANT, bId, CONFIG);
    expect(seg.breakObjectId).toBe(bId);
    expect(seg.groupingValue).toBe("Alpha");
    expect(seg.segmentKey).toBe(buildSegmentKey(bId, "Alpha"));
  });

  it("b1: ärver närmaste brytnod b uppåt + gruppering Alpha", async () => {
    const seg = await computeBillingSegmentForObject(TENANT, b1Id, CONFIG);
    expect(seg.breakObjectId).toBe(bId);
    expect(seg.groupingValue).toBe("Alpha");
    expect(seg.segmentKey).toBe(buildSegmentKey(bId, "Alpha"));
  });
});

describe("Task #970 — computeBillingSegmentsForSubtree (DOWN, preview)", () => {
  it("avstängt flöde ⇒ tom karta", async () => {
    const map = await computeBillingSegmentsForSubtree(TENANT, rootId, { ...CONFIG, enabled: false });
    expect(map.size).toBe(0);
  });

  it("alla 5 noder får segment matchande UP-beräkningen", async () => {
    const map = await computeBillingSegmentsForSubtree(TENANT, rootId, CONFIG);
    expect(map.size).toBe(5);
    expect(map.get(rootId)?.segmentKey).toBe(buildSegmentKey(null, "Alpha"));
    expect(map.get(aId)?.segmentKey).toBe(buildSegmentKey(null, "Alpha"));
    expect(map.get(a1Id)?.groupingValue).toBe("Beta");
    expect(map.get(bId)?.breakObjectId).toBe(bId);
    expect(map.get(b1Id)?.breakObjectId).toBe(bId);
    expect(map.get(b1Id)?.groupingValue).toBe("Alpha");
  });
});

describe("Task #970 — markWorkOrderReadyForInvoice fryser segment (held)", () => {
  it("held-gren med aktiverat flöde fryser segment-kolumnerna", async () => {
    // Månadspolicy på kunden ⇒ WO hamnar i 'held' (inte 'immediate').
    await db.insert(invoiceConsolidationPolicies).values({
      tenantId: TENANT,
      customerId,
      period: "monthly",
      periodAnchor: 1,
    });

    const [wo] = await db
      .insert(workOrders)
      .values({
        tenantId: TENANT,
        customerId,
        objectId: bId,
        title: "Freeze WO",
        orderStatus: "skapad",
        cachedValue: 1000,
      })
      .returning();
    createdWoIds.push(wo.id);

    const res = await markWorkOrderReadyForInvoice(wo.id, TENANT);
    expect(res.state).toBe("held");

    const [frozen] = await db
      .select({
        segmentKey: workOrders.billingSegmentKey,
        breakObjectId: workOrders.billingBreakObjectId,
        groupingValue: workOrders.billingGroupingValue,
      })
      .from(workOrders)
      .where(eq(workOrders.id, wo.id));
    expect(frozen.breakObjectId).toBe(bId);
    expect(frozen.groupingValue).toBe("Alpha");
    expect(frozen.segmentKey).toBe(buildSegmentKey(bId, "Alpha"));
  });
});

describe("Task #970 — runConsolidationForTenant grupperar per fryst segment", () => {
  it("NULL-segment slås ihop (dagens beteende); olika segment ⇒ separata fakturor; frozen-pris bevaras", async () => {
    // Rensa ev. WOs från freeze-testet så denna körning är deterministisk.
    await db.delete(workOrders).where(eq(workOrders.tenantId, TENANT));
    createdWoIds.length = 0;
    await db.delete(customerInvoices).where(eq(customerInvoices.tenantId, TENANT));

    const alphaKey = buildSegmentKey(null, "Alpha"); // b:-|g:Alpha
    const breakKey = buildSegmentKey(bId, "Alpha"); // b:<b>|g:Alpha

    // 2x NULL-segment (back-compat, slås ihop) — 5000 + 3000 = 8000
    await insertHeldWo({ segmentKey: null, cachedValue: 5000 });
    await insertHeldWo({ segmentKey: null, cachedValue: 3000 });
    // 2x Alpha-segment med frozen-pris (10000 öre * 2 = 20000) + 1000 = 21000
    await insertHeldWo({ segmentKey: alphaKey, groupingValue: "Alpha", frozenUnitPrice: 10000, frozenQuantity: 2 });
    await insertHeldWo({ segmentKey: alphaKey, groupingValue: "Alpha", cachedValue: 1000 });
    // 1x brytsegment ⇒ egen faktura — 2000
    await insertHeldWo({ segmentKey: breakKey, breakObjectId: bId, groupingValue: "Alpha", cachedValue: 2000 });

    const result = await runConsolidationForTenant(TENANT, { force: true });
    expect(result.invoicesCreated).toBe(3);
    expect(result.workOrdersConsolidated).toBe(5);

    const invoices = await db
      .select()
      .from(customerInvoices)
      .where(and(eq(customerInvoices.tenantId, TENANT), eq(customerInvoices.state, "consolidated")));
    expect(invoices.length).toBe(3);

    const byKey = new Map(invoices.map((inv) => [inv.billingSegmentKey ?? "__null__", inv]));

    const nullInv = byKey.get("__null__");
    expect(nullInv).toBeDefined();
    expect(Number(nullInv!.totalAmount)).toBe(8000);
    expect(nullInv!.workOrderIds?.length).toBe(2);

    const alphaInv = byKey.get(alphaKey!);
    expect(alphaInv).toBeDefined();
    expect(Number(alphaInv!.totalAmount)).toBe(21000);
    expect(alphaInv!.billingGroupingValue).toBe("Alpha");
    expect(alphaInv!.billingBreakObjectId).toBeNull();

    const breakInv = byKey.get(breakKey!);
    expect(breakInv).toBeDefined();
    expect(Number(breakInv!.totalAmount)).toBe(2000);
    expect(breakInv!.billingBreakObjectId).toBe(bId);

    // Alla fakturor pekar på frusen mottagare (recipient-invarianten oförändrad).
    for (const inv of invoices) {
      expect(inv.invoiceRecipientId).toBe(recipientId);
      expect(inv.customerId).toBe(customerId);
    }

    // Alla held-WOs flippade till consolidated.
    const wos = await db
      .select({ id: workOrders.id, state: workOrders.invoiceQueueState })
      .from(workOrders)
      .where(eq(workOrders.tenantId, TENANT));
    expect(wos.length).toBe(5);
    for (const w of wos) expect(w.state).toBe("consolidated");

    // T006: Fortnox-konsoliderad export läser customer_invoices-grupper. Våra
    // additiva segment-kolumner får inte bryta exportens förutsättningar:
    // state="consolidated", fortnoxInvoiceId=NULL och minst en kopplad WO.
    for (const inv of invoices) {
      expect(inv.state).toBe("consolidated");
      expect(inv.fortnoxInvoiceId).toBeNull();
      expect((inv.workOrderIds ?? []).length).toBeGreaterThan(0);
    }
  });

});
