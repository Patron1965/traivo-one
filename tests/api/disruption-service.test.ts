import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeDownstreamCascade,
  pickAlternativeDay,
  type CascadeOrder,
} from "../../server/disruption-service";

// ============================================================================
// computeDownstreamCascade — ren kaskad-matematik (luckabsorption + windowRisk)
// ============================================================================
function makeOrder(overrides: Partial<CascadeOrder> = {}): CascadeOrder {
  return {
    id: overrides.id ?? "wo-1",
    title: overrides.title ?? "Order",
    scheduledStartTime: "scheduledStartTime" in overrides ? overrides.scheduledStartTime! : "08:00",
    estimatedDuration: overrides.estimatedDuration ?? 60,
    windowEndMin: "windowEndMin" in overrides ? overrides.windowEndMin! : null,
  };
}

describe("computeDownstreamCascade", () => {
  it("skjuter fram första uppgiften med hela förseningen", () => {
    const orders = [makeOrder({ id: "a", scheduledStartTime: "08:00", estimatedDuration: 60 })];
    const result = computeDownstreamCascade(orders, 30);
    expect(result).toHaveLength(1);
    expect(result[0].newEtaTime).toBe("08:30");
    expect(result[0].delayMinutes).toBe(30);
    expect(result[0].originalStartTime).toBe("08:00");
  });

  it("absorberar en lucka mellan uppgifter (lucka > försening ⇒ ingen knuff)", () => {
    // a: 08:00–09:00 (+60 försening ⇒ 09:00–10:00). b startar 11:00 med 120 min
    // lucka efter a:s nya slut (10:00) ⇒ b kan behålla sin ursprungstid.
    const orders = [
      makeOrder({ id: "a", scheduledStartTime: "08:00", estimatedDuration: 60 }),
      makeOrder({ id: "b", scheduledStartTime: "11:00", estimatedDuration: 60 }),
    ];
    const result = computeDownstreamCascade(orders, 60);
    const b = result.find(e => e.workOrderId === "b")!;
    expect(b.newEtaTime).toBe("11:00");
    expect(b.delayMinutes).toBe(0);
  });

  it("absorberar en del av förseningen när luckan är mindre än förseningen", () => {
    // a: 08:00–09:00 (+90 ⇒ 09:30–10:30). b startar 09:30, lucka 30 min mellan
    // a-slut (09:00) och b-start (09:30) absorberar 30 av 90 min ⇒ b knuffas 60 min.
    const orders = [
      makeOrder({ id: "a", scheduledStartTime: "08:00", estimatedDuration: 60 }),
      makeOrder({ id: "b", scheduledStartTime: "09:30", estimatedDuration: 60 }),
    ];
    const result = computeDownstreamCascade(orders, 90);
    const b = result.find(e => e.workOrderId === "b")!;
    // a:s nya slut = 08:00 + 90 + 60 = 10:30 ⇒ b kan inte starta före 10:30.
    expect(b.newEtaTime).toBe("10:30");
    expect(b.delayMinutes).toBe(60); // 10:30 − 09:30
  });

  it("flaggar windowRisk när ny ankomst hamnar efter önskat fönster", () => {
    const orders = [
      makeOrder({ id: "a", scheduledStartTime: "14:00", estimatedDuration: 60, windowEndMin: 15 * 60 }),
    ];
    const result = computeDownstreamCascade(orders, 90); // 14:00 + 90 = 15:30 > 15:00
    expect(result[0].windowRisk).toBe(true);
    expect(result[0].windowEnd).toBe("15:00");
    expect(result[0].riskReason).toContain("efter önskat fönster");
  });

  it("flaggar INTE windowRisk när ny ankomst ryms inom fönstret", () => {
    const orders = [
      makeOrder({ id: "a", scheduledStartTime: "14:00", estimatedDuration: 60, windowEndMin: 16 * 60 }),
    ];
    const result = computeDownstreamCascade(orders, 30); // 14:30 < 16:00
    expect(result[0].windowRisk).toBe(false);
    expect(result[0].riskReason).toBeUndefined();
  });

  it("flaggar windowRisk vid dygnsgräns (skjuts efter arbetsdagens slut)", () => {
    const orders = [
      makeOrder({ id: "a", scheduledStartTime: "23:30", estimatedDuration: 60, windowEndMin: null }),
    ];
    const result = computeDownstreamCascade(orders, 60); // 23:30 + 60 = 24:30 ⇒ >= 1440
    expect(result[0].windowRisk).toBe(true);
    expect(result[0].riskReason).toBe("Skjuts till efter arbetsdagens slut");
    // newEtaTime klamras inom dygnet för visning (1470 min ⇒ wrap till 00:30)
    expect(result[0].newEtaTime).toBe("00:30");
  });

  it("placerar uppgifter utan starttid sist med null-tider men ärvd försening", () => {
    const orders = [
      makeOrder({ id: "a", scheduledStartTime: "08:00", estimatedDuration: 60 }),
      makeOrder({ id: "b", scheduledStartTime: null, estimatedDuration: 60, windowEndMin: 10 * 60 }),
    ];
    const result = computeDownstreamCascade(orders, 45);
    const b = result.find(e => e.workOrderId === "b")!;
    expect(b.originalStartTime).toBeNull();
    expect(b.newEtaTime).toBeNull();
    expect(b.delayMinutes).toBe(45);
    expect(b.windowRisk).toBe(false);
    expect(b.windowEnd).toBe("10:00");
  });

  it("sorterar uppgifter på starttid oavsett indata-ordning", () => {
    const orders = [
      makeOrder({ id: "late", scheduledStartTime: "10:00", estimatedDuration: 60 }),
      makeOrder({ id: "early", scheduledStartTime: "08:00", estimatedDuration: 60 }),
    ];
    const result = computeDownstreamCascade(orders, 30);
    // Första posten (med start) ska vara den tidigaste (08:00) och få hela förseningen.
    expect(result[0].workOrderId).toBe("early");
    expect(result[0].newEtaTime).toBe("08:30");
  });
});

// ============================================================================
// pickAlternativeDay — dag-val (samma vecka, minst belastad, ingen helg/nästa vecka)
// ============================================================================
describe("pickAlternativeDay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function freezeTo(dateStr: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${dateStr}T09:00:00`));
  }

  it("väljer minst belastad vardag senare samma vecka", () => {
    // Onsdag 2026-06-10 ⇒ kvarvarande vardagar = tor 11, fre 12.
    freezeTo("2026-06-10");
    const load = new Map<string, number>([
      ["2026-06-11", 300], // torsdag, hög belastning
      ["2026-06-12", 60], // fredag, lägst belastning
    ]);
    const choice = pickAlternativeDay(load);
    expect(choice).not.toBeNull();
    expect(choice!.dayString).toBe("2026-06-12");
    expect(choice!.weekday).toBe("fredag");
    expect(choice!.loadMinutes).toBe(60);
    expect(choice!.sameWeek).toBe(true);
  });

  it("hoppar över helgen (lör/sön ingår aldrig)", () => {
    // Fredag 2026-06-12 ⇒ inga vardagar kvar denna ISO-vecka (lör/sön exkluderas).
    freezeTo("2026-06-12");
    const choice = pickAlternativeDay(new Map());
    expect(choice).toBeNull();
  });

  it("faller ALDRIG tillbaka på nästa vecka", () => {
    // Lördag 2026-06-13 ⇒ enda återstående dag denna ISO-vecka är söndag (helg).
    freezeTo("2026-06-13");
    const choice = pickAlternativeDay(new Map());
    expect(choice).toBeNull();
  });

  it("behandlar dag utan känd belastning som 0 min och kan välja den", () => {
    // Måndag 2026-06-08 ⇒ kvarvarande vardagar tis–fre.
    freezeTo("2026-06-08");
    const load = new Map<string, number>([
      ["2026-06-09", 120], // tisdag
      ["2026-06-10", 120], // onsdag
      // torsdag/fredag saknas ⇒ 0 min ⇒ ska väljas (tidigast av de tomma)
    ]);
    const choice = pickAlternativeDay(load);
    expect(choice!.dayString).toBe("2026-06-11"); // torsdag, först bland 0-belastning
    expect(choice!.loadMinutes).toBe(0);
  });
});

// ============================================================================
// applySuggestion — tenant-säkerhet + SLA-omräkning vid datumflytt
// ============================================================================
const { storageMock, computeTenantSlaRiskMock, disruptionStore } = vi.hoisted(() => {
  // In-memory backing store som simulerar den persistenta disruptions-tabellen,
  // så att triggerSignificantDelay → applySuggestion-flödet kan läsa tillbaka
  // störningen (precis som mot DB:n i prod).
  const disruptionStore: any[] = [];
  return {
    disruptionStore,
    storageMock: {
      getWorkOrders: vi.fn(),
      getWorkOrder: vi.fn(),
      getResource: vi.fn(),
      getResources: vi.fn(),
      updateWorkOrder: vi.fn(),
      createDisruption: vi.fn(async (data: any) => {
        const row = { ...data, createdAt: data.createdAt ?? new Date() };
        disruptionStore.push(row);
        return row;
      }),
      getDisruptions: vi.fn(async (tenantId: string, opts?: { includeResolved?: boolean }) =>
        disruptionStore.filter(d => d.tenantId === tenantId && (opts?.includeResolved ? true : d.status === "active")),
      ),
      getDisruption: vi.fn(async (tenantId: string, id: string) =>
        disruptionStore.find(d => d.tenantId === tenantId && d.id === id),
      ),
      updateDisruption: vi.fn(async (tenantId: string, id: string, patch: any) => {
        const row = disruptionStore.find(d => d.tenantId === tenantId && d.id === id);
        if (!row) return undefined;
        Object.assign(row, patch);
        return row;
      }),
    },
    computeTenantSlaRiskMock: vi.fn(),
  };
});

vi.mock("../../server/storage", () => ({
  storage: storageMock,
}));

vi.mock("../../server/notifications", () => ({
  notificationService: {
    broadcastSystemAlert: vi.fn(),
  },
}));

vi.mock("../../server/services/sla-risk-engine", () => ({
  computeTenantSlaRisk: (...args: unknown[]) => computeTenantSlaRiskMock(...args),
}));

vi.mock("../../server/distance-matrix-service", () => ({
  haversineDistanceKm: () => 0,
}));

const TENANT_A = "tenant-a";
const RESOURCE = "res-1";

/**
 * Skapar en aktiv significant_delay-störning i tenant A genom att köra
 * triggerSignificantDelay mot mockad storage. Returnerar event-id + tjänsten.
 */
async function seedDelayDisruption() {
  const svc = await import("../../server/disruption-service");
  // wo-1 = försenade jobbet (08:00), wo-2 = nedströms jobb (10:00) med snäv
  // fönster-risk så att alternativfönster-förslaget (med datumflytt) skapas.
  const today = new Date();
  const orders = [
    {
      id: "wo-1",
      title: "Försenat jobb",
      tenantId: TENANT_A,
      resourceId: RESOURCE,
      scheduledDate: today,
      scheduledStartTime: "08:00",
      estimatedDuration: 60,
      orderStatus: "pagaende",
      plannedWindowEnd: null,
      desiredDeliveryEnd: null,
    },
    {
      id: "wo-2",
      title: "Nedströms jobb",
      tenantId: TENANT_A,
      resourceId: RESOURCE,
      scheduledDate: today,
      scheduledStartTime: "10:00",
      estimatedDuration: 60,
      orderStatus: "planerad_resurs",
      // Snävt fönster-slut (kl 10:00) ⇒ kaskaden orsakar windowRisk.
      plannedWindowEnd: new Date(new Date(today).setHours(10, 0, 0, 0)),
      desiredDeliveryEnd: null,
    },
  ];
  storageMock.getWorkOrders.mockResolvedValue(orders);
  const event = await svc.triggerSignificantDelay(
    TENANT_A,
    "wo-1",
    "Försenat jobb",
    RESOURCE,
    "Resurs Ett",
    60, // estimated
    180, // actual ⇒ ratio 3.0, delay 120 min
  );
  return { svc, event };
}

describe("applySuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disruptionStore.length = 0;
    // Frys till onsdag så pickAlternativeDay hittar en alternativdag (datumflytt).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T09:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("avvisar order som tillhör en annan tenant (defense-in-depth)", async () => {
    const { svc, event } = await seedDelayDisruption();
    expect(event).not.toBeNull();

    // getWorkOrder returnerar en order som tillhör en ANNAN tenant.
    storageMock.getWorkOrder.mockResolvedValue({
      id: "wo-2",
      tenantId: "tenant-b",
      resourceId: RESOURCE,
    });

    const adjust = event!.suggestions.find(s => s.id === "sug-delay-adjust")!;
    const result = await svc.applySuggestion(TENANT_A, event!.id, adjust.id);

    expect(result.applied).toBe(0);
    expect(result.details.some(d => d.includes("tillhör inte denna tenant"))).toBe(true);
    // Ingen skrivning får ske mot främmande tenant-order.
    expect(storageMock.getWorkOrder).toHaveBeenCalled();
    expect(computeTenantSlaRiskMock).not.toHaveBeenCalled();
  });

  it("räknar om SLA-risk när ett förslag flyttar order till annan dag", async () => {
    const { svc, event } = await seedDelayDisruption();
    expect(event).not.toBeNull();

    // Order tillhör rätt tenant ⇒ uppdatering tillåts.
    storageMock.getWorkOrder.mockImplementation(async (id: string) => ({
      id,
      tenantId: TENANT_A,
      resourceId: RESOURCE,
    }));

    // Alternativfönster-förslaget innehåller en reschedule MED scheduledDate (datumflytt).
    const altWindow = event!.suggestions.find(s => s.id === "sug-delay-alt-window");
    expect(altWindow).toBeDefined();
    expect(altWindow!.actions.some(a => !!a.scheduledDate)).toBe(true);

    const result = await svc.applySuggestion(TENANT_A, event!.id, altWindow!.id);

    expect(result.applied).toBeGreaterThan(0);
    expect(computeTenantSlaRiskMock).toHaveBeenCalledWith(TENANT_A);
    expect(result.details.some(d => d.includes("SLA-risk omräknad"))).toBe(true);
  });

  it("hoppar över SLA-omräkning när inga datum flyttas (endast starttider)", async () => {
    const { svc, event } = await seedDelayDisruption();
    storageMock.getWorkOrder.mockImplementation(async (id: string) => ({
      id,
      tenantId: TENANT_A,
      resourceId: RESOURCE,
    }));

    // sug-delay-adjust skriver bara nya starttider (inget scheduledDate) ⇒ ingen SLA-omräkning.
    const adjust = event!.suggestions.find(s => s.id === "sug-delay-adjust")!;
    expect(adjust.actions.every(a => !a.scheduledDate)).toBe(true);

    const result = await svc.applySuggestion(TENANT_A, event!.id, adjust.id);
    expect(result.applied).toBeGreaterThan(0);
    expect(computeTenantSlaRiskMock).not.toHaveBeenCalled();
  });

  it("kastar fel när störningen inte finns för tenanten", async () => {
    const svc = await import("../../server/disruption-service");
    await expect(svc.applySuggestion("okänd-tenant", "dis-x", "sug-y")).rejects.toThrow();
  });
});
