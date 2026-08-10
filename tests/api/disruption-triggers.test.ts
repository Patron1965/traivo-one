import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// ============================================================================
// Integrationstest för disruption-DETEKTERINGENS trigger-entrypoints mot RIKTIG
// DB. disruption-persistence.test.ts täcker storage-round-trips och
// disruption-service.test.ts täcker ren kaskad-matematik mot mockad storage.
// Här körs trigger*-funktionerna mot riktiga resurser + work orders så att en
// regression i HUR en upptäckt störning byggs och persisteras fångas:
//   - triggerResourceUnavailable
//   - triggerEmergencyJob
//   - triggerSignificantDelay (med work-order-/kaskad-skrivning)
//   - triggerEarlyCompletion
//   - applySuggestion med icke-tomma åtgärder (reassign + reschedule m. datumflytt)
//
// Storage är ALDRIG mockad (vi vill träffa DB:n). Endast notifikations-bron
// (WebSocket-fan-out) och SLA-motorn mockas: notifikationer har inget med
// persistensen att göra, och SLA-omräkningen spioneras på för att verifiera att
// applySuggestion faktiskt triggar den vid datumflytt utan att köra den tunga
// riktiga beräkningen.
// ============================================================================

const { computeTenantSlaRiskMock } = vi.hoisted(() => ({
  computeTenantSlaRiskMock: vi.fn(async () => ({ snapshots: [], transitions: [] })),
}));

vi.mock("../../server/notifications", () => ({
  notificationService: {
    broadcastSystemAlert: vi.fn(),
  },
}));

vi.mock("../../server/services/sla-risk-engine", () => ({
  computeTenantSlaRisk: (...args: unknown[]) => computeTenantSlaRiskMock(...args),
}));

import { db } from "../../server/db";
import {
  tenants,
  customers,
  objects,
  resources,
  workOrders,
  disruptions,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { DatabaseStorage } from "../../server/storage";
import {
  triggerResourceUnavailable,
  triggerEmergencyJob,
  triggerSignificantDelay,
  triggerEarlyCompletion,
  applySuggestion,
} from "../../server/disruption-service";
import type { InsertWorkOrder } from "@shared/schema";

const storage = new DatabaseStorage();

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const TENANT = `disrupt-trig-${SUFFIX}`;

// Koordinater i Göteborgsområdet — resurser och jobb ligger nära varandra (< 20 km)
// så avstånds-/närhetsscoringen i triggrarna ger förslag.
const BASE_LAT = 57.7089;
const BASE_LNG = 11.9746;

let customerId: string;
let objectId: string;

// Resurser
let resPrimary: string; // resursen som blir otillgänglig / försenad
let resAltA: string; // tillgänglig ersättare A
let resAltB: string; // tillgänglig ersättare B

const createdWorkOrderIds: string[] = [];

let idSeq = 0;
function woId(): string {
  return `wo-trig-${SUFFIX}-${idSeq++}`;
}

async function insertWorkOrder(overrides: Partial<InsertWorkOrder> & { id?: string } = {}) {
  const id = overrides.id ?? woId();
  const values: any = {
    id,
    tenantId: TENANT,
    customerId,
    objectId,
    title: overrides.title ?? "Testorder",
    orderStatus: overrides.orderStatus ?? "planerad_resurs",
    estimatedDuration: overrides.estimatedDuration ?? 60,
    ...overrides,
    id,
    tenantId: TENANT,
    customerId,
  };
  await db.insert(workOrders).values(values);
  createdWorkOrderIds.push(id);
  return id;
}

describe("Disruption-triggers (integration mot riktig DB)", () => {
  beforeAll(async () => {
    await db.insert(tenants).values({ id: TENANT, name: "Disruption Trigger Tenant" }).onConflictDoNothing();

    const [customer] = await db
      .insert(customers)
      .values({ tenantId: TENANT, name: "Trigger Testkund" })
      .returning();
    customerId = customer.id;

    const [object] = await db
      .insert(objects)
      .values({ tenantId: TENANT, customerId, name: "Trigger Testobjekt" })
      .returning();
    objectId = object.id;

    const [r1] = await db
      .insert(resources)
      .values({
        tenantId: TENANT,
        name: "Resurs Primär",
        resourceType: "person",
        status: "active",
        homeLatitude: BASE_LAT,
        homeLongitude: BASE_LNG,
      })
      .returning();
    resPrimary = r1.id;

    const [r2] = await db
      .insert(resources)
      .values({
        tenantId: TENANT,
        name: "Resurs Alt A",
        resourceType: "person",
        status: "active",
        homeLatitude: BASE_LAT + 0.01,
        homeLongitude: BASE_LNG + 0.01,
      })
      .returning();
    resAltA = r2.id;

    const [r3] = await db
      .insert(resources)
      .values({
        tenantId: TENANT,
        name: "Resurs Alt B",
        resourceType: "person",
        status: "active",
        homeLatitude: BASE_LAT + 0.02,
        homeLongitude: BASE_LNG + 0.02,
      })
      .returning();
    resAltB = r3.id;
  });

  afterAll(async () => {
    await db.delete(disruptions).where(eq(disruptions.tenantId, TENANT)).catch(() => {});
    if (createdWorkOrderIds.length > 0) {
      await db.delete(workOrders).where(inArray(workOrders.id, createdWorkOrderIds)).catch(() => {});
    }
    await db.delete(resources).where(eq(resources.tenantId, TENANT)).catch(() => {});
    if (objectId) await db.delete(objects).where(eq(objects.id, objectId)).catch(() => {});
    if (customerId) await db.delete(customers).where(eq(customers.id, customerId)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.id, TENANT)).catch(() => {});
  });

  // --------------------------------------------------------------------------
  // triggerResourceUnavailable
  // --------------------------------------------------------------------------
  describe("triggerResourceUnavailable", () => {
    it("bygger och persisterar en resource_unavailable-störning med omdisponeringsförslag", async () => {
      const inThreeDays = new Date(Date.now() + 3 * 86_400_000);
      // Två framtida, ej avslutade jobb på primärresursen ⇒ påverkas.
      const aff1 = await insertWorkOrder({
        title: "Berört jobb 1",
        resourceId: resPrimary,
        scheduledDate: inThreeDays,
        scheduledStartTime: "08:00",
        orderStatus: "planerad_resurs",
        taskLatitude: BASE_LAT,
        taskLongitude: BASE_LNG,
      });
      const aff2 = await insertWorkOrder({
        title: "Berört jobb 2",
        resourceId: resPrimary,
        scheduledDate: inThreeDays,
        scheduledStartTime: "10:00",
        orderStatus: "planerad_resurs",
      });
      // Avslutat jobb på samma resurs ⇒ ska INTE påverkas.
      await insertWorkOrder({
        title: "Avslutat jobb",
        resourceId: resPrimary,
        scheduledDate: inThreeDays,
        orderStatus: "utford",
      });

      const event = await triggerResourceUnavailable(TENANT, resPrimary, "Resurs Primär", "Sjukanmälan");

      expect(event.type).toBe("resource_unavailable");
      expect(event.severity).toBe("warning"); // 2 berörda jobb (≤ 3) ⇒ warning
      expect(event.affectedResourceId).toBe(resPrimary);
      expect(event.affectedWorkOrderIds).toEqual(expect.arrayContaining([aff1, aff2]));
      expect(event.affectedWorkOrderIds).toHaveLength(2);
      expect(event.suggestions.length).toBeGreaterThan(0);
      // Alla förslag är omdisponeringar till en av de tillgängliga ersättarna.
      for (const s of event.suggestions) {
        expect(s.actions.length).toBe(2); // ett per berört jobb
        expect(s.actions.every(a => a.type === "reassign")).toBe(true);
        expect(s.actions.every(a => a.targetResourceId !== resPrimary)).toBe(true);
        expect([resAltA, resAltB]).toContain(s.actions[0].targetResourceId);
      }

      // Persisterad rad matchar event:et.
      const row = await storage.getDisruption(TENANT, event.id);
      expect(row).toBeTruthy();
      expect(row!.type).toBe("resource_unavailable");
      expect(row!.severity).toBe("warning");
      expect(row!.status).toBe("active");
      expect(row!.affectedResourceId).toBe(resPrimary);
      expect(row!.affectedWorkOrderIds as string[]).toEqual(expect.arrayContaining([aff1, aff2]));
      expect((row!.suggestions as unknown[]).length).toBe(event.suggestions.length);
    });
  });

  // --------------------------------------------------------------------------
  // triggerEmergencyJob
  // --------------------------------------------------------------------------
  describe("triggerEmergencyJob", () => {
    it("bygger och persisterar en kritisk emergency_job-störning med närmaste resurs", async () => {
      const emergencyWoId = `emergency-${SUFFIX}`;
      const event = await triggerEmergencyJob(
        TENANT,
        emergencyWoId,
        "Akut tömning",
        BASE_LAT,
        BASE_LNG,
      );

      expect(event.type).toBe("emergency_job");
      expect(event.severity).toBe("critical");
      expect(event.affectedWorkOrderIds).toEqual([emergencyWoId]);
      expect(event.suggestions.length).toBeGreaterThan(0);
      // Förslagen sätter in akutjobbet hos en resurs idag.
      const first = event.suggestions[0];
      expect(first.actions[0].type).toBe("insert");
      expect(first.actions[0].workOrderId).toBe(emergencyWoId);
      expect(first.actions[0].targetResourceId).toBeTruthy();
      expect(first.actions[0].scheduledDate).toBeTruthy();

      const row = await storage.getDisruption(TENANT, event.id);
      expect(row).toBeTruthy();
      expect(row!.type).toBe("emergency_job");
      expect(row!.severity).toBe("critical");
      expect(row!.affectedWorkOrderIds as string[]).toEqual([emergencyWoId]);
      expect((row!.suggestions as unknown[]).length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // triggerSignificantDelay
  // --------------------------------------------------------------------------
  describe("triggerSignificantDelay", () => {
    it("returnerar null när förseningen är under tröskeln (ratio < 1.5)", async () => {
      const result = await triggerSignificantDelay(
        TENANT,
        "saknad-wo",
        "Litet jobb",
        resAltA,
        "Resurs Alt A",
        60,
        60, // ratio 1.0 ⇒ ingen störning
      );
      expect(result).toBeNull();
    });

    it("bygger nedströms-ETA-kaskad och persisterar en significant_delay-störning", async () => {
      // Egen resurs så att dagssekvensen bara innehåller dessa två jobb.
      const [rDelay] = await db
        .insert(resources)
        .values({
          tenantId: TENANT,
          name: "Resurs Delay",
          resourceType: "person",
          status: "active",
          homeLatitude: BASE_LAT,
          homeLongitude: BASE_LNG,
        })
        .returning();

      const day = new Date();
      const delayedId = await insertWorkOrder({
        title: "Försenat jobb",
        resourceId: rDelay.id,
        scheduledDate: day,
        scheduledStartTime: "08:00",
        estimatedDuration: 60,
        orderStatus: "pagaende",
      });
      const downstreamId = await insertWorkOrder({
        title: "Nedströms jobb",
        resourceId: rDelay.id,
        scheduledDate: day,
        scheduledStartTime: "10:00",
        estimatedDuration: 60,
        orderStatus: "planerad_resurs",
      });

      const event = await triggerSignificantDelay(
        TENANT,
        delayedId,
        "Försenat jobb",
        rDelay.id,
        "Resurs Delay",
        60, // estimated
        180, // actual ⇒ ratio 3.0, +120 min försening
      );

      expect(event).not.toBeNull();
      expect(event!.type).toBe("significant_delay");
      expect(event!.severity).toBe("critical"); // ratio > 2.0
      expect(event!.affectedResourceId).toBe(rDelay.id);
      expect(event!.affectedWorkOrderIds).toEqual(expect.arrayContaining([delayedId, downstreamId]));

      // Nedströms-kaskaden räknades ut för det resterande jobbet.
      expect(event!.downstreamEta).toBeTruthy();
      const eta = event!.downstreamEta!.find(e => e.workOrderId === downstreamId);
      expect(eta).toBeTruthy();
      expect(eta!.originalStartTime).toBe("10:00");
      // Nedströms-jobbet är första (och enda) resterande jobbet i kaskaden ⇒ får
      // hela förseningen: 10:00 + 120 min = 12:00.
      expect(eta!.newEtaTime).toBe("12:00");
      expect(eta!.delayMinutes).toBe(120);

      // Förslag att skjuta fram resterande jobb finns och skriver nya starttider.
      const adjust = event!.suggestions.find(s => s.id === "sug-delay-adjust");
      expect(adjust).toBeTruthy();
      expect(adjust!.actions.length).toBe(1);
      expect(adjust!.actions[0].type).toBe("reschedule");
      expect(adjust!.actions[0].workOrderId).toBe(downstreamId);
      expect(adjust!.actions[0].scheduledStartTime).toBe("12:00");

      // Persisterad rad bär kaskaden.
      const row = await storage.getDisruption(TENANT, event!.id);
      expect(row).toBeTruthy();
      expect(row!.type).toBe("significant_delay");
      expect(row!.severity).toBe("critical");
      expect((row!.downstreamEta as unknown[]).length).toBe(event!.downstreamEta!.length);
    });
  });

  // --------------------------------------------------------------------------
  // triggerEarlyCompletion
  // --------------------------------------------------------------------------
  describe("triggerEarlyCompletion", () => {
    it("returnerar null när det lediga tidsfönstret är för litet (< 45 min)", async () => {
      const result = await triggerEarlyCompletion(TENANT, resAltB, "Resurs Alt B", 30);
      expect(result).toBeNull();
    });

    it("bygger och persisterar en early_completion-störning med närliggande oplanerade jobb", async () => {
      // Oplanerat jobb (ingen resurs) nära resAltB:s hemposition, kort nog för slacken.
      const nearbyId = await insertWorkOrder({
        title: "Oplanerat närjobb",
        resourceId: null,
        scheduledDate: null,
        estimatedDuration: 60,
        orderStatus: "skapad",
        taskLatitude: BASE_LAT + 0.021,
        taskLongitude: BASE_LNG + 0.021,
      });

      const event = await triggerEarlyCompletion(TENANT, resAltB, "Resurs Alt B", 120);

      expect(event).not.toBeNull();
      expect(event!.type).toBe("early_completion");
      expect(event!.severity).toBe("info");
      expect(event!.affectedResourceId).toBe(resAltB);
      expect(event!.affectedWorkOrderIds).toContain(nearbyId);
      expect(event!.suggestions.length).toBeGreaterThan(0);
      const sug = event!.suggestions[0];
      expect(sug.actions[0].type).toBe("insert");
      expect(sug.actions[0].targetResourceId).toBe(resAltB);

      const row = await storage.getDisruption(TENANT, event!.id);
      expect(row).toBeTruthy();
      expect(row!.type).toBe("early_completion");
      expect(row!.severity).toBe("info");
      expect(row!.affectedWorkOrderIds as string[]).toContain(nearbyId);
    });
  });

  // --------------------------------------------------------------------------
  // applySuggestion med icke-tomma åtgärder (mot riktig DB)
  // --------------------------------------------------------------------------
  describe("applySuggestion (reassign + reschedule med datumflytt)", () => {
    it("reschedule med scheduledDate flyttar jobbet i DB och triggar SLA-omräkning", async () => {
      computeTenantSlaRiskMock.mockClear();

      const today = new Date();
      const moveId = await insertWorkOrder({
        title: "Jobb att omplanera",
        resourceId: resPrimary,
        scheduledDate: today,
        scheduledStartTime: "08:00",
        orderStatus: "planerad_resurs",
      });

      const tomorrowStr = new Date(Date.now() + 86_400_000).toISOString().split("T")[0];
      const dis = await storage.createDisruption({
        id: `dis-move-${SUFFIX}`,
        tenantId: TENANT,
        type: "significant_delay",
        status: "active",
        severity: "warning",
        title: "Datumflytt-test",
        description: "applySuggestion med datumflytt",
        affectedResourceId: resPrimary,
        affectedWorkOrderIds: [moveId],
        suggestions: [
          {
            id: "sug-move",
            label: "Flytta till imorgon",
            description: "Reschedule med datumflytt",
            score: 70,
            actions: [
              {
                type: "reschedule",
                workOrderId: moveId,
                workOrderTitle: "Jobb att omplanera",
                targetResourceId: resPrimary,
                targetResourceName: "Resurs Primär",
                scheduledDate: tomorrowStr,
                scheduledStartTime: "09:00",
              },
            ],
          },
        ],
        decisionTrace: [],
        downstreamEta: null,
      });

      const result = await applySuggestion(TENANT, dis.id, "sug-move");

      expect(result.applied).toBe(1);
      // Datumflytt ⇒ SLA-risk räknas om för tenanten.
      expect(computeTenantSlaRiskMock).toHaveBeenCalledTimes(1);
      expect(computeTenantSlaRiskMock).toHaveBeenCalledWith(TENANT);

      // Jobbet faktiskt flyttat i DB.
      const [wo] = await db
        .select({ scheduledDate: workOrders.scheduledDate, scheduledStartTime: workOrders.scheduledStartTime })
        .from(workOrders)
        .where(eq(workOrders.id, moveId));
      expect(wo.scheduledStartTime).toBe("09:00");
      expect(wo.scheduledDate).toBeTruthy();
      expect(wo.scheduledDate!.toISOString().split("T")[0]).toBe(tomorrowStr);

      // Störningen markerad som löst med 'applied'-spår.
      const row = await storage.getDisruption(TENANT, dis.id);
      expect(row!.status).toBe("resolved");
      const trace = row!.decisionTrace as Array<{ step: string }>;
      expect(trace.some(t => t.step === "applied")).toBe(true);
    });

    it("reassign flyttar jobbet till en annan resurs i DB", async () => {
      computeTenantSlaRiskMock.mockClear();

      const today = new Date();
      const reassignId = await insertWorkOrder({
        title: "Jobb att omdisponera",
        resourceId: resPrimary,
        scheduledDate: today,
        orderStatus: "planerad_resurs",
      });

      const dis = await storage.createDisruption({
        id: `dis-reassign-${SUFFIX}`,
        tenantId: TENANT,
        type: "resource_unavailable",
        status: "active",
        severity: "warning",
        title: "Reassign-test",
        description: "applySuggestion reassign",
        affectedResourceId: resPrimary,
        affectedWorkOrderIds: [reassignId],
        suggestions: [
          {
            id: "sug-reassign",
            label: "Flytta till Alt A",
            description: "Reassign utan datumflytt",
            score: 70,
            actions: [
              {
                type: "reassign",
                workOrderId: reassignId,
                workOrderTitle: "Jobb att omdisponera",
                targetResourceId: resAltA,
                targetResourceName: "Resurs Alt A",
              },
            ],
          },
        ],
        decisionTrace: [],
        downstreamEta: null,
      });

      const result = await applySuggestion(TENANT, dis.id, "sug-reassign");

      expect(result.applied).toBe(1);
      // Ingen scheduledDate i åtgärden ⇒ ingen SLA-omräkning.
      expect(computeTenantSlaRiskMock).not.toHaveBeenCalled();

      const [wo] = await db
        .select({ resourceId: workOrders.resourceId, orderStatus: workOrders.orderStatus })
        .from(workOrders)
        .where(eq(workOrders.id, reassignId));
      expect(wo.resourceId).toBe(resAltA);
      expect(wo.orderStatus).toBe("planerad_resurs");

      const row = await storage.getDisruption(TENANT, dis.id);
      expect(row!.status).toBe("resolved");
    });

    it("avvisar åtgärd mot en order som tillhör en annan tenant (defense-in-depth)", async () => {
      computeTenantSlaRiskMock.mockClear();

      // Skapa en order i en ANNAN tenant.
      const otherTenant = `disrupt-trig-other-${SUFFIX}`;
      await db.insert(tenants).values({ id: otherTenant, name: "Other Tenant" }).onConflictDoNothing();
      const [otherCustomer] = await db
        .insert(customers)
        .values({ tenantId: otherTenant, name: "Other Kund" })
        .returning();
      const [otherWo] = await db
        .insert(workOrders)
        .values({
          id: `wo-other-${SUFFIX}`,
          tenantId: otherTenant,
          customerId: otherCustomer.id,
          title: "Främmande jobb",
          orderStatus: "planerad_resurs",
        })
        .returning();

      const dis = await storage.createDisruption({
        id: `dis-cross-${SUFFIX}`,
        tenantId: TENANT,
        type: "resource_unavailable",
        status: "active",
        severity: "warning",
        title: "Cross-tenant-test",
        description: "applySuggestion mot främmande order",
        affectedResourceId: resPrimary,
        affectedWorkOrderIds: [otherWo.id],
        suggestions: [
          {
            id: "sug-cross",
            label: "Flytta främmande jobb",
            description: "Ska avvisas",
            score: 50,
            actions: [
              {
                type: "reassign",
                workOrderId: otherWo.id,
                workOrderTitle: "Främmande jobb",
                targetResourceId: resAltA,
                targetResourceName: "Resurs Alt A",
              },
            ],
          },
        ],
        decisionTrace: [],
        downstreamEta: null,
      });

      const result = await applySuggestion(TENANT, dis.id, "sug-cross");

      expect(result.applied).toBe(0);
      expect(result.details.some(d => d.includes("tillhör inte denna tenant"))).toBe(true);
      expect(computeTenantSlaRiskMock).not.toHaveBeenCalled();

      // Den främmande ordern är orörd.
      const [wo] = await db
        .select({ resourceId: workOrders.resourceId })
        .from(workOrders)
        .where(eq(workOrders.id, otherWo.id));
      expect(wo.resourceId).toBeNull();

      // Städa upp den andra tenanten.
      await db.delete(disruptions).where(eq(disruptions.id, dis.id)).catch(() => {});
      await db.delete(workOrders).where(eq(workOrders.id, otherWo.id)).catch(() => {});
      await db.delete(customers).where(eq(customers.id, otherCustomer.id)).catch(() => {});
      await db.delete(tenants).where(eq(tenants.id, otherTenant)).catch(() => {});
    });
  });
});
