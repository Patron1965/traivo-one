import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import {
  tenants,
  customers,
  objects,
  articles,
  orderConcepts,
  assignments,
  assignmentArticles,
  workOrders,
  workOrderLines,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../../server/storage";
import { materializeCompletedAssignmentForInvoice } from "../../server/services/assignment-invoice-materializer";
import { propagateUppgiftspaket } from "../../server/services/uppgiftspaket";
import type { Uppgiftspaket } from "@shared/uppgift-contract";
import { chooseWoSnapshotValues, runBackfill } from "../../scripts/backfill-uppgiftspaket";

// Task #1506 — Fundament: uppgifts-ID + garanterad artikel-snapshot.
// DB-integrationstest mot dev-DB. Verifierar:
//   1) createWorkOrderWithLines fryser artikel-snapshoten (id/nr/namn/pris/
//      kostnad/produktionstid) i uppgiftspaketet från skapandeögonblicket,
//   2) en artikeländring i registret ändrar ALDRIG en redan skapad uppgifts
//      snapshot — inte ens efter paket-propagering,
//   3) assignment + artikel stämplar snapshot i assignmentens paket,
//   4) ID-kedjan: materialiserad WO bär sourceAssignmentId till sin assignment.

let TENANT: string;
let customerId: string;
let objectId: string;
let conceptId: string;
let articleId: string;

beforeAll(async () => {
  TENANT = `snap-${Date.now()}-t`;
  await db.insert(tenants).values({ id: TENANT, name: "Snapshot Test Tenant" }).onConflictDoNothing();

  const [customer] = await db
    .insert(customers)
    .values({ tenantId: TENANT, name: "Snapshot Kund" })
    .returning();
  customerId = customer.id;

  const [object] = await db
    .insert(objects)
    .values({ tenantId: TENANT, customerId, name: "Snapshot Objekt" })
    .returning();
  objectId = object.id;

  const [concept] = await db
    .insert(orderConcepts)
    .values({ tenantId: TENANT, name: "Snapshot Koncept", scenario: "avrop" })
    .returning();
  conceptId = concept.id;

  const [article] = await db
    .insert(articles)
    .values({
      tenantId: TENANT,
      articleNumber: "SNAP-100",
      name: "Snapshot-tjänst",
      productionTime: 45,
      cost: 30000,
      listPrice: 50000,
      executionCode: "tvatt",
    })
    .returning();
  articleId = article.id;
}, 30000);

afterAll(async () => {
  if (!TENANT) return;
  await db.delete(workOrderLines).where(eq(workOrderLines.tenantId, TENANT));
  await db.delete(workOrders).where(eq(workOrders.tenantId, TENANT));
  const tenantAssignments = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.tenantId, TENANT));
  for (const a of tenantAssignments) {
    await db.delete(assignmentArticles).where(eq(assignmentArticles.assignmentId, a.id));
  }
  await db.delete(assignments).where(eq(assignments.tenantId, TENANT));
  await db.delete(orderConcepts).where(eq(orderConcepts.tenantId, TENANT));
  await db.delete(articles).where(eq(articles.tenantId, TENANT));
  await db.delete(objects).where(eq(objects.tenantId, TENANT));
  await db.delete(customers).where(eq(customers.tenantId, TENANT));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
}, 30000);

async function getWoPaket(id: string): Promise<Uppgiftspaket | null> {
  const [wo] = await db
    .select({ uppgiftspaket: workOrders.uppgiftspaket })
    .from(workOrders)
    .where(eq(workOrders.id, id));
  return (wo?.uppgiftspaket as Uppgiftspaket | null) ?? null;
}

describe("uppgiftspaket artikel-snapshot (Task #1506)", () => {
  it("fryser artikelvärden vid createWorkOrderWithLines och är immun mot registeränd­ringar", async () => {
    const { workOrder } = await storage.createWorkOrderWithLines(
      {
        tenantId: TENANT,
        customerId,
        objectId,
        title: "Snapshot-WO",
        orderStatus: "skapad",
        executionStatus: "not_planned",
      },
      [
        {
          articleId,
          quantity: 2,
          resolvedPrice: 50000,
          resolvedCost: 30000,
          resolvedProductionMinutes: 45,
        },
      ],
    );

    const paket = await getWoPaket(workOrder.id);
    expect(paket).not.toBeNull();
    expect(paket!.version).toBe(2);
    expect(paket!.artikel).toMatchObject({
      artikelId: articleId,
      artikelnummer: "SNAP-100",
      namn: "Snapshot-tjänst",
      produktionstidMin: 45,
      prisOre: 50000,
      kostnadOre: 30000,
    });

    // Ändra artikeln i registret → snapshoten får INTE ändras.
    await db
      .update(articles)
      .set({ listPrice: 99900, cost: 88800, productionTime: 120, name: "Ändrad tjänst" })
      .where(eq(articles.id, articleId));

    // Kör dessutom paket-propageringen (objektändring) — snapshoten ska bevaras.
    await propagateUppgiftspaket(TENANT, [objectId]);

    const efter = await getWoPaket(workOrder.id);
    expect(efter!.artikel).toMatchObject({
      artikelId: articleId,
      artikelnummer: "SNAP-100",
      namn: "Snapshot-tjänst",
      produktionstidMin: 45,
      prisOre: 50000,
      kostnadOre: 30000,
    });

    // Återställ registret för resterande tester.
    await db
      .update(articles)
      .set({ listPrice: 50000, cost: 30000, productionTime: 45, name: "Snapshot-tjänst" })
      .where(eq(articles.id, articleId));
  }, 30000);

  it("stämplar snapshot på assignment via createAssignmentArticle", async () => {
    const assignment = await storage.createAssignment({
      tenantId: TENANT,
      orderConceptId: conceptId,
      objectId,
      customerId,
      title: "Snapshot-assignment",
      billingMethod: "call_off",
      status: "not_planned",
    });
    await storage.createAssignmentArticle({
      assignmentId: assignment.id,
      articleId,
      quantity: 1,
      unitPrice: 50000,
      unitCost: 30000,
      unitTime: 45,
    });

    const [a] = await db
      .select({ uppgiftspaket: assignments.uppgiftspaket })
      .from(assignments)
      .where(eq(assignments.id, assignment.id));
    const paket = a?.uppgiftspaket as Uppgiftspaket | null;
    expect(paket?.artikel).toMatchObject({
      artikelId: articleId,
      artikelnummer: "SNAP-100",
      prisOre: 50000,
      kostnadOre: 30000,
      produktionstidMin: 45,
    });
  }, 30000);

  it("fryst uppgift stämplas ALDRIG om av en senare orderrad", async () => {
    const { workOrder } = await storage.createWorkOrderWithLines(
      {
        tenantId: TENANT,
        customerId,
        objectId,
        title: "Fryst WO",
        orderStatus: "utford",
        executionStatus: "completed",
      },
      [
        {
          articleId,
          quantity: 1,
          resolvedPrice: 11111,
          resolvedCost: 22222,
          resolvedProductionMinutes: 10,
        },
      ],
    );
    const fore = await getWoPaket(workOrder.id);

    // Ny artikel + ny rad på den frysta WO:n → snapshoten får inte röras.
    const [annanArtikel] = await db
      .insert(articles)
      .values({ tenantId: TENANT, articleNumber: "SNAP-200", name: "Annan tjänst", listPrice: 77700 })
      .returning();
    await storage.createWorkOrderLine({
      tenantId: TENANT,
      workOrderId: workOrder.id,
      articleId: annanArtikel.id,
      quantity: 1,
      resolvedPrice: 77700,
    });

    const efter = await getWoPaket(workOrder.id);
    expect(efter?.artikel).toEqual(fore?.artikel);
  }, 30000);

  it("andra orderraden skriver inte över primär artikel-snapshot (CAS)", async () => {
    const { workOrder } = await storage.createWorkOrderWithLines(
      {
        tenantId: TENANT,
        customerId,
        objectId,
        title: "Två-raders-WO",
        orderStatus: "skapad",
        executionStatus: "not_planned",
      },
      [
        { articleId, quantity: 1, resolvedPrice: 50000, resolvedCost: 30000, resolvedProductionMinutes: 45 },
      ],
    );
    const [annanArtikel] = await db
      .insert(articles)
      .values({ tenantId: TENANT, articleNumber: "SNAP-300", name: "Sekundär tjänst", listPrice: 12300 })
      .returning();
    await storage.createWorkOrderLine({
      tenantId: TENANT,
      workOrderId: workOrder.id,
      articleId: annanArtikel.id,
      quantity: 1,
      resolvedPrice: 12300,
    });
    const paket = await getWoPaket(workOrder.id);
    expect(paket?.artikel?.artikelId).toBe(articleId);
    expect(paket?.artikel?.prisOre).toBe(50000);
  }, 30000);

  it("två SAMTIDIGA första-rader: exakt EN artikel vinner snapshoten (CAS)", async () => {
    const { workOrder } = await storage.createWorkOrderWithLines(
      {
        tenantId: TENANT,
        customerId,
        objectId,
        title: "Race-WO",
        orderStatus: "skapad",
        executionStatus: "not_planned",
      },
      [], // inga rader vid skapandet → snapshot saknas
    );
    const [artB] = await db
      .insert(articles)
      .values({ tenantId: TENANT, articleNumber: "SNAP-400", name: "Race B", listPrice: 40000 })
      .returning();

    // Två samtidiga första-rader med olika artiklar.
    await Promise.all([
      storage.createWorkOrderLine({
        tenantId: TENANT,
        workOrderId: workOrder.id,
        articleId,
        quantity: 1,
        resolvedPrice: 50000,
      }),
      storage.createWorkOrderLine({
        tenantId: TENANT,
        workOrderId: workOrder.id,
        articleId: artB.id,
        quantity: 1,
        resolvedPrice: 40000,
      }),
    ]);

    const paket = await getWoPaket(workOrder.id);
    // Exakt en av artiklarna har vunnit — och snapshoten är internt konsistent.
    expect([articleId, artB.id]).toContain(paket?.artikel?.artikelId);
    if (paket?.artikel?.artikelId === articleId) {
      expect(paket.artikel.prisOre).toBe(50000);
    } else {
      expect(paket?.artikel?.prisOre).toBe(40000);
    }
  }, 30000);

  it("backfill: fryst WO tar KANONISKA frysta värden, inte dagens orderrad", () => {
    const frozenWo = {
      orderStatus: "utford",
      executionStatus: "completed",
      invoiceQueueState: null,
      impossibleReason: null,
      frozenUnitPrice: 40000,
      frozenUnitCost: 25000,
      frozenUnitTime: 30,
    };
    // Orderraden har ÄNDRATS efter frysningen — får inte användas.
    const driftedLine = { resolvedPrice: 99900, resolvedCost: 88800, resolvedProductionMinutes: 120 };
    const frozenVals = chooseWoSnapshotValues(frozenWo, driftedLine);
    expect(frozenVals).toMatchObject({ frozen: true, prisOre: 40000, kostnadOre: 25000, produktionstidMin: 30 });

    // Fryst WO HELT utan frysta kolumner: värden förblir okända — aldrig
    // dagens (driftade) orderrad.
    const nullFrozenVals = chooseWoSnapshotValues(
      { ...frozenWo, frozenUnitPrice: null, frozenUnitCost: null, frozenUnitTime: null },
      driftedLine,
    );
    expect(nullFrozenVals).toEqual({
      frozen: true,
      prisOre: undefined,
      kostnadOre: undefined,
      produktionstidMin: undefined,
    });

    // Öppen WO tar radens resolved*-värden.
    const openVals = chooseWoSnapshotValues(
      { ...frozenWo, orderStatus: "skapad", executionStatus: "not_planned" },
      driftedLine,
    );
    expect(openVals).toMatchObject({ frozen: false, prisOre: 99900, kostnadOre: 88800, produktionstidMin: 120 });
  });

  it("backfill-omkörning rör ALDRIG en fryst rad med satt snapshot (idempotens)", async () => {
    // Fryst WO med snapshot från skapandet.
    const { workOrder } = await storage.createWorkOrderWithLines(
      {
        tenantId: TENANT,
        customerId,
        objectId,
        title: "Idempotens-WO",
        orderStatus: "utford",
        executionStatus: "completed",
      },
      [{ articleId, quantity: 1, resolvedPrice: 50000, resolvedCost: 30000, resolvedProductionMinutes: 45 }],
    );
    const fore = await getWoPaket(workOrder.id);
    expect(fore?.artikel?.artikelId).toBe(articleId);

    // Ändra artikeln i registret och kör backfillen igen.
    await db
      .update(articles)
      .set({ listPrice: 123456, name: "Register-drift" })
      .where(eq(articles.id, articleId));
    await runBackfill({ dryRun: false });

    const efter = await getWoPaket(workOrder.id);
    expect(efter).toEqual(fore); // varje fält oförändrat — inkl. tidsstämplar

    await db
      .update(articles)
      .set({ listPrice: 50000, name: "Snapshot-tjänst" })
      .where(eq(articles.id, articleId));
  }, 60000);

  it("backfill av paketlös FRYST rad läser aldrig dagens register (namn/nummer/pris)", async () => {
    // Fryst legacy-WO utan paket, med frysta kolumner satta.
    const { workOrder } = await storage.createWorkOrderWithLines(
      {
        tenantId: TENANT,
        customerId,
        objectId,
        title: "Legacy-fryst WO",
        orderStatus: "utford",
        executionStatus: "completed",
        frozenUnitPrice: 40000,
        frozenUnitCost: 25000,
        frozenUnitTime: 30,
      },
      [{ articleId, quantity: 1, resolvedPrice: 50000, resolvedCost: 30000, resolvedProductionMinutes: 45 }],
    );
    // Simulera legacy: ta bort paketet helt.
    await db.update(workOrders).set({ uppgiftspaket: null }).where(eq(workOrders.id, workOrder.id));
    // Drifta registret efter frysningen.
    await db
      .update(articles)
      .set({ articleNumber: "DRIFTAT-999", name: "Driftat namn", listPrice: 777777 })
      .where(eq(articles.id, articleId));

    await runBackfill({ dryRun: false });

    const paket = await getWoPaket(workOrder.id);
    expect(paket?.artikel?.artikelId).toBe(articleId);
    // Historiskt okända fält = null, ALDRIG dagens registervärden.
    expect(paket?.artikel?.artikelnummer).toBeNull();
    expect(paket?.artikel?.namn).toBeNull();
    // Värden uteslutande från frysta kolumner.
    expect(paket?.artikel?.prisOre).toBe(40000);
    expect(paket?.artikel?.kostnadOre).toBe(25000);
    expect(paket?.artikel?.produktionstidMin).toBe(30);

    await db
      .update(articles)
      .set({ articleNumber: "SNAP-100", name: "Snapshot-tjänst", listPrice: 50000 })
      .where(eq(articles.id, articleId));
  }, 60000);

  it("ID-kedjan: materialiserad WO bär sourceAssignmentId", async () => {
    const assignment = await storage.createAssignment({
      tenantId: TENANT,
      orderConceptId: conceptId,
      objectId,
      customerId,
      title: "Kedje-assignment",
      billingMethod: "call_off",
      status: "completed",
      completedAt: new Date(),
    });
    await storage.createAssignmentArticle({
      assignmentId: assignment.id,
      articleId,
      quantity: 1,
      unitPrice: 50000,
      unitCost: 30000,
      unitTime: 45,
    });

    const result = await materializeCompletedAssignmentForInvoice(TENANT, assignment.id);
    expect(result.workOrderId).toBeTruthy();

    const [wo] = await db
      .select({ sourceAssignmentId: workOrders.sourceAssignmentId, uppgiftspaket: workOrders.uppgiftspaket })
      .from(workOrders)
      .where(eq(workOrders.id, result.workOrderId!));
    expect(wo.sourceAssignmentId).toBe(assignment.id);
    const paket = wo.uppgiftspaket as Uppgiftspaket | null;
    expect(paket?.artikel?.artikelId).toBe(articleId);
    expect(paket?.artikel?.prisOre).toBe(50000);
  }, 30000);
});
