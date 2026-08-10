import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// ============================================================================
// Integrationstest för NEDSTRÖMSAVISERINGEN (`notifyDownstreamCustomers` i
// server/disruption-service.ts) mot RIKTIG DB. När ett jobb blir markant
// försenat kan planeraren (opt-in) avisera de nedströmskunder vars tidsfönster
// påverkats. disruption-triggers.test.ts täcker HUR störningen + nedströms-ETA
// byggs och persisteras; här verifieras fan-out:t — att rätt antal kunder
// kategoriseras som aviserade/hoppade/misslyckade och att ett "notify_downstream"
// -steg läggs till störningens decisionTrace.
//
// Storage är ALDRIG mockad (vi vill träffa DB:n). Endast notifikations-källorna
// mockas så att inga riktiga SMS/e-post går ut:
//   - ./eta-notification-service (triggerDownstreamEtaNotification) — styr vilket
//     resultat varje enskild kund-avisering ger, så att kategoriseringslogiken i
//     notifyDownstreamCustomers kan verifieras isolerat.
//   - ./notifications (WebSocket-fan-out) — irrelevant för persistensen.
// ============================================================================

const { triggerDownstreamEtaNotificationMock } = vi.hoisted(() => ({
  triggerDownstreamEtaNotificationMock: vi.fn(),
}));

vi.mock("../../server/notifications", () => ({
  notificationService: {
    broadcastSystemAlert: vi.fn(),
  },
}));

vi.mock("../../server/eta-notification-service", () => ({
  triggerDownstreamEtaNotification: (...args: unknown[]) =>
    triggerDownstreamEtaNotificationMock(...args),
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
import { notifyDownstreamCustomers } from "../../server/disruption-service";
import type { InsertWorkOrder, InsertDisruption } from "@shared/schema";

const storage = new DatabaseStorage();

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const TENANT = `disrupt-notify-${SUFFIX}`;

let customerId: string;
let objectId: string;
let resourceId: string;

const createdWorkOrderIds: string[] = [];
const createdDisruptionIds: string[] = [];

let woSeq = 0;
function woId(): string {
  return `wo-notify-${SUFFIX}-${woSeq++}`;
}
let disSeq = 0;
function disId(): string {
  return `dis-notify-${SUFFIX}-${disSeq++}`;
}

async function insertWorkOrder(overrides: Partial<InsertWorkOrder> & { id?: string } = {}) {
  const id = overrides.id ?? woId();
  const values: any = {
    title: overrides.title ?? "Nedströms jobb",
    estimatedDuration: overrides.estimatedDuration ?? 60,
    ...overrides,
    id,
    tenantId: TENANT,
    customerId,
    objectId,
    orderStatus: overrides.orderStatus ?? "planerad_resurs",
  };
  await db.insert(workOrders).values(values);
  createdWorkOrderIds.push(id);
  return id;
}

type DownstreamEntry = {
  workOrderId: string;
  workOrderTitle: string;
  originalStartTime: string | null;
  newEtaTime: string | null;
  delayMinutes: number;
  windowEnd: string | null;
  windowRisk: boolean;
};

async function seedDelayDisruption(downstreamEta: DownstreamEntry[]) {
  const id = disId();
  const data: InsertDisruption = {
    id,
    tenantId: TENANT,
    type: "significant_delay",
    status: "active",
    severity: "warning",
    title: "Markant försening",
    description: "Nedströmsavisering-test",
    affectedResourceId: resourceId,
    affectedWorkOrderIds: downstreamEta.map((e) => e.workOrderId),
    suggestions: [],
    decisionTrace: [],
    downstreamEta: downstreamEta as any,
  } as InsertDisruption;
  const row = await storage.createDisruption(data);
  createdDisruptionIds.push(id);
  return row;
}

describe("notifyDownstreamCustomers (integration mot riktig DB)", () => {
  beforeAll(async () => {
    await db.insert(tenants).values({ id: TENANT, name: "Disruption Notify Tenant" }).onConflictDoNothing();

    const [customer] = await db
      .insert(customers)
      .values({
        tenantId: TENANT,
        name: "Nedströmskund",
        contactPerson: "Anna Kontakt",
        email: "anna@example.com",
        phone: "+46700000000",
      })
      .returning();
    customerId = customer.id;

    const [object] = await db
      .insert(objects)
      .values({ tenantId: TENANT, customerId, name: "Nedströmsobjekt" })
      .returning();
    objectId = object.id;

    const [r] = await db
      .insert(resources)
      .values({ tenantId: TENANT, name: "Resurs Försenad", resourceType: "person", status: "active" })
      .returning();
    resourceId = r.id;
  });

  afterAll(async () => {
    if (createdDisruptionIds.length > 0) {
      await db.delete(disruptions).where(inArray(disruptions.id, createdDisruptionIds)).catch(() => {});
    }
    if (createdWorkOrderIds.length > 0) {
      await db.delete(workOrders).where(inArray(workOrders.id, createdWorkOrderIds)).catch(() => {});
    }
    await db.delete(resources).where(eq(resources.tenantId, TENANT)).catch(() => {});
    if (objectId) await db.delete(objects).where(eq(objects.id, objectId)).catch(() => {});
    if (customerId) await db.delete(customers).where(eq(customers.id, customerId)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.id, TENANT)).catch(() => {});
  });

  beforeEach(() => {
    triggerDownstreamEtaNotificationMock.mockReset();
  });

  it("aviserar varje nedströmskund med påverkat tidsfönster och loggar ett notify_downstream-steg", async () => {
    const wo1 = await insertWorkOrder({ title: "Nedströms jobb A", resourceId, scheduledStartTime: "10:00" });
    const wo2 = await insertWorkOrder({ title: "Nedströms jobb B", resourceId, scheduledStartTime: "11:00" });

    const dis = await seedDelayDisruption([
      {
        workOrderId: wo1,
        workOrderTitle: "Nedströms jobb A",
        originalStartTime: "10:00",
        newEtaTime: "11:00",
        delayMinutes: 60,
        windowEnd: null,
        windowRisk: false,
      },
      {
        workOrderId: wo2,
        workOrderTitle: "Nedströms jobb B",
        originalStartTime: "11:00",
        newEtaTime: "12:00",
        delayMinutes: 60,
        windowEnd: null,
        windowRisk: false,
      },
    ]);

    triggerDownstreamEtaNotificationMock.mockResolvedValue({
      sent: true,
      reason: "Skickad",
      customerName: "Anna Kontakt",
    });

    const result = await notifyDownstreamCustomers(TENANT, dis.id);

    expect(result.notified).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);

    // Aviseringstjänsten anropades en gång per drabbat jobb med rätt argument.
    expect(triggerDownstreamEtaNotificationMock).toHaveBeenCalledTimes(2);
    expect(triggerDownstreamEtaNotificationMock).toHaveBeenCalledWith(wo1, TENANT, "11:00", 60);
    expect(triggerDownstreamEtaNotificationMock).toHaveBeenCalledWith(wo2, TENANT, "12:00", 60);

    // Störningens decisionTrace fick ett notify_downstream-steg som persisterades.
    const row = await storage.getDisruption(TENANT, dis.id);
    const trace = row!.decisionTrace as Array<{ step: string; detail: string }>;
    const notifyStep = trace.find((t) => t.step === "notify_downstream");
    expect(notifyStep).toBeTruthy();
    expect(notifyStep!.detail).toContain("2 aviserade");
  });

  it("hoppar över jobb där delayMinutes <= 0 eller newEtaTime saknas", async () => {
    const woReal = await insertWorkOrder({ title: "Verkligt försenat", resourceId, scheduledStartTime: "09:00" });

    const dis = await seedDelayDisruption([
      // Ingen försening ⇒ filtreras bort innan aviseringstjänsten anropas.
      {
        workOrderId: "wo-no-delay",
        workOrderTitle: "Ingen försening",
        originalStartTime: "08:00",
        newEtaTime: "08:00",
        delayMinutes: 0,
        windowEnd: null,
        windowRisk: false,
      },
      // Saknar ny ETA ⇒ filtreras bort.
      {
        workOrderId: "wo-no-eta",
        workOrderTitle: "Saknar ETA",
        originalStartTime: "08:30",
        newEtaTime: null,
        delayMinutes: 30,
        windowEnd: null,
        windowRisk: false,
      },
      {
        workOrderId: woReal,
        workOrderTitle: "Verkligt försenat",
        originalStartTime: "09:00",
        newEtaTime: "09:45",
        delayMinutes: 45,
        windowEnd: null,
        windowRisk: false,
      },
    ]);

    triggerDownstreamEtaNotificationMock.mockResolvedValue({
      sent: true,
      reason: "Skickad",
      customerName: "Anna Kontakt",
    });

    const result = await notifyDownstreamCustomers(TENANT, dis.id);

    expect(result.notified).toBe(1);
    expect(triggerDownstreamEtaNotificationMock).toHaveBeenCalledTimes(1);
    expect(triggerDownstreamEtaNotificationMock).toHaveBeenCalledWith(woReal, TENANT, "09:45", 45);
  });

  it("räknar kunder som hoppade när notiser är avaktiverade eller kontaktuppgifter saknas", async () => {
    const woDisabled = await insertWorkOrder({ title: "Avaktiverat jobb", resourceId });
    const woNoContact = await insertWorkOrder({ title: "Saknar kontakt", resourceId });

    const dis = await seedDelayDisruption([
      {
        workOrderId: woDisabled,
        workOrderTitle: "Avaktiverat jobb",
        originalStartTime: "10:00",
        newEtaTime: "11:00",
        delayMinutes: 60,
        windowEnd: null,
        windowRisk: false,
      },
      {
        workOrderId: woNoContact,
        workOrderTitle: "Saknar kontakt",
        originalStartTime: "11:00",
        newEtaTime: "12:00",
        delayMinutes: 60,
        windowEnd: null,
        windowRisk: false,
      },
    ]);

    triggerDownstreamEtaNotificationMock.mockImplementation(async (workOrderId: string) => {
      if (workOrderId === woDisabled) {
        return { sent: false, reason: "ETA-notifieringar avaktiverade" };
      }
      // Kund utan kontaktuppgifter.
      return { sent: false, reason: "Inga kontaktuppgifter", customerName: "Anna Kontakt" };
    });

    const result = await notifyDownstreamCustomers(TENANT, dis.id);

    expect(result.notified).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.details.some((d) => /avaktiverade/i.test(d))).toBe(true);
    expect(result.details.some((d) => /kontaktuppgifter/i.test(d))).toBe(true);

    const row = await storage.getDisruption(TENANT, dis.id);
    const trace = row!.decisionTrace as Array<{ step: string; detail: string }>;
    const notifyStep = trace.find((t) => t.step === "notify_downstream");
    expect(notifyStep!.detail).toContain("2 hoppade");
  });

  it("räknar kunder som misslyckade när aviseringstjänsten svarar med ett oväntat fel", async () => {
    const woFail = await insertWorkOrder({ title: "Misslyckat jobb", resourceId });

    const dis = await seedDelayDisruption([
      {
        workOrderId: woFail,
        workOrderTitle: "Misslyckat jobb",
        originalStartTime: "13:00",
        newEtaTime: "14:00",
        delayMinutes: 60,
        windowEnd: null,
        windowRisk: false,
      },
    ]);

    triggerDownstreamEtaNotificationMock.mockResolvedValue({
      sent: false,
      reason: "SMS-leverantören svarade inte",
      customerName: "Anna Kontakt",
    });

    const result = await notifyDownstreamCustomers(TENANT, dis.id);

    expect(result.notified).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.details.some((d) => /misslyckades/i.test(d))).toBe(true);

    const row = await storage.getDisruption(TENANT, dis.id);
    const trace = row!.decisionTrace as Array<{ step: string; detail: string }>;
    const notifyStep = trace.find((t) => t.step === "notify_downstream");
    expect(notifyStep!.detail).toContain("1 misslyckades");
  });

  it("returnerar nollställda räknare utan att anropa aviseringstjänsten när inga jobb påverkats", async () => {
    const dis = await seedDelayDisruption([]);

    const result = await notifyDownstreamCustomers(TENANT, dis.id);

    expect(result).toEqual({
      notified: 0,
      skipped: 0,
      failed: 0,
      details: ["Inga nedströmskunder med påverkat tidsfönster att avisera"],
    });
    expect(triggerDownstreamEtaNotificationMock).not.toHaveBeenCalled();
  });

  it("kastar när störningen inte finns", async () => {
    await expect(notifyDownstreamCustomers(TENANT, `saknas-${SUFFIX}`)).rejects.toThrow();
  });
});
