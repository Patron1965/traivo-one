import { describe, it, expect, vi, beforeEach } from "vitest";

// Storage mockas helt så att orchestratorn kan köras utan DB. De rena hjälparna
// (parseStreetAddress m.fl.) rör aldrig storage; mocken påverkar bara
// runTimeGeoEngine-testet längst ned.
const storageMocks = vi.hoisted(() => ({
  getAssignments: vi.fn(),
  getAssignmentArticlesForAssignments: vi.fn(),
  getArticles: vi.fn(),
  resolveDeliveryPreferences: vi.fn(),
  getTenantGroupingRadiusMeters: vi.fn(),
  clearEngineSlotTimes: vi.fn(),
  createSlotTimes: vi.fn(),
}));

vi.mock("../../server/storage", () => ({ storage: storageMocks }));

import {
  parseStreetAddress,
  parseHHMM,
  toDateKey,
  computeSlotCandidates,
  groupTasks,
  summarizeGroup,
  runTimeGeoEngine,
  type GroupableTask,
  type SlotType,
} from "../../server/services/time-geo-engine";
import type { FrozenTimeRulePackage } from "@shared/delivery-restrictions";

// ---------------------------------------------------------------------------
// parseStreetAddress — sidesmedvetenhet (udda/jämnt husnummer)
// ---------------------------------------------------------------------------
describe("parseStreetAddress", () => {
  it("plockar ut gatunamn, husnummer och jämn sida", () => {
    expect(parseStreetAddress("Storgatan 12, 11122 Stockholm")).toEqual({
      street: "storgatan",
      houseNumber: 12,
      parity: "even",
    });
  });

  it("hanterar husnummer-suffix (12B) och udda sida", () => {
    expect(parseStreetAddress("Storgatan 13B")).toEqual({
      street: "storgatan",
      houseNumber: 13,
      parity: "odd",
    });
  });

  it("normaliserar versaler/mellanslag så samma gata grupperas ihop", () => {
    const a = parseStreetAddress("Norra  Vägen 4");
    const b = parseStreetAddress("norra vägen 6");
    expect(a.street).toBe("norra vägen");
    expect(b.street).toBe("norra vägen");
    expect(a.parity).toBe("even");
    expect(b.parity).toBe("even");
  });

  it("returnerar null-sida när husnummer saknas", () => {
    expect(parseStreetAddress("Torget")).toEqual({
      street: "torget",
      houseNumber: null,
      parity: null,
    });
  });

  it("tål tom/null-adress", () => {
    expect(parseStreetAddress(null)).toEqual({ street: null, houseNumber: null, parity: null });
    expect(parseStreetAddress("")).toEqual({ street: null, houseNumber: null, parity: null });
  });
});

describe("parseHHMM", () => {
  it("parsar giltig tid", () => {
    expect(parseHHMM("08:30")).toBe(510);
    expect(parseHHMM("00:00")).toBe(0);
  });
  it("avvisar ogiltigt format", () => {
    expect(parseHHMM("24:00")).toBeNull();
    expect(parseHHMM("8:5")).toBeNull();
    expect(parseHHMM(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeSlotCandidates — viktning av parallella tidsvillkor
// ---------------------------------------------------------------------------
describe("computeSlotCandidates", () => {
  const periodStart = new Date(2026, 0, 5); // måndag 2026-01-05
  const periodEnd = new Date(2026, 0, 11); // söndag 2026-01-11

  it("ger minst en slot även utan några tidsvillkor (fallback)", () => {
    const cands = computeSlotCandidates({
      periodStart,
      periodEnd,
      desiredWindows: [],
      blockedHours: [],
      blockedDates: [],
      frozenRules: null,
      anchorDate: periodStart,
      plannedWindowStart: null,
      plannedWindowEnd: null,
      maxCandidates: 5,
    });
    expect(cands.length).toBeGreaterThanOrEqual(1);
    expect(cands[0].slotType).toBe("onskad");
  });

  it("låter kundönskad tid (onskad) väga tyngst över krävd/fördelaktig", () => {
    const frozen: FrozenTimeRulePackage = {
      hard: [{ description: "Krävd", weekdays: [1], timeFrom: "09:00", timeTo: "11:00", polarity: "positive", weight: 1 }],
      soft: [{ description: "Fördelaktig", weekdays: [1], timeFrom: "13:00", timeTo: "15:00", polarity: "positive", weight: 1 }],
    };
    const cands = computeSlotCandidates({
      periodStart,
      periodEnd,
      desiredWindows: [{ weekday: 1, start: "08:00", end: "10:00" }], // måndag
      blockedHours: [],
      blockedDates: [],
      frozenRules: frozen,
      anchorDate: periodStart,
      plannedWindowStart: null,
      plannedWindowEnd: null,
      maxCandidates: 10,
    });
    expect(cands[0].slotType).toBe("onskad");
    // Alla tre typerna ska finnas representerade.
    const types = new Set(cands.map((c) => c.slotType));
    expect(types.has("onskad")).toBe(true);
    expect(types.has("kravd")).toBe(true);
    expect(types.has("fordelaktig")).toBe(true);
  });

  it("utesluter kandidater som krockar med hård negativ regel", () => {
    const frozen: FrozenTimeRulePackage = {
      hard: [{ description: "Undvik", weekdays: [1], timeFrom: "08:00", timeTo: "10:00", polarity: "negative", weight: 1 }],
      soft: [],
    };
    const cands = computeSlotCandidates({
      periodStart,
      periodEnd,
      desiredWindows: [{ weekday: 1, start: "08:00", end: "10:00" }],
      blockedHours: [],
      blockedDates: [],
      frozenRules: frozen,
      anchorDate: periodStart,
      plannedWindowStart: null,
      plannedWindowEnd: null,
      maxCandidates: 10,
    });
    // Måndag 08–10 ska aldrig dyka upp (krockar med hård negativ).
    const mondayMorning = cands.find(
      (c) => c.windowStart.getDay() === 1 && c.windowStart.getHours() === 8,
    );
    expect(mondayMorning).toBeUndefined();
  });

  it("utesluter blockerade datum helt", () => {
    const cands = computeSlotCandidates({
      periodStart,
      periodEnd,
      desiredWindows: [{ weekday: 1, start: "08:00", end: "10:00" }],
      blockedHours: [],
      blockedDates: [toDateKey(periodStart)], // blockera måndagen
      frozenRules: null,
      anchorDate: periodStart,
      plannedWindowStart: null,
      plannedWindowEnd: null,
      maxCandidates: 10,
    });
    const onMonday = cands.find((c) => toDateKey(c.windowStart) === toDateKey(periodStart));
    expect(onMonday).toBeUndefined();
  });

  it("föredrar dagen närmast ankardatumet (dags-straff)", () => {
    // Önskat fönster varje måndag; ankare = första måndagen. Den första måndagen
    // ska ranka högre än måndagen veckan efter.
    const widerEnd = new Date(2026, 0, 18); // två måndagar i horisonten
    const cands = computeSlotCandidates({
      periodStart,
      periodEnd: widerEnd,
      desiredWindows: [{ weekday: 1, start: "08:00", end: "10:00" }],
      blockedHours: [],
      blockedDates: [],
      frozenRules: null,
      anchorDate: periodStart,
      plannedWindowStart: null,
      plannedWindowEnd: null,
      maxCandidates: 10,
    });
    expect(toDateKey(cands[0].windowStart)).toBe(toDateKey(periodStart));
  });
});

// ---------------------------------------------------------------------------
// groupTasks — sidesmedveten geo-gruppering + fallback + standalone
// ---------------------------------------------------------------------------
function task(partial: Partial<GroupableTask>): GroupableTask {
  return {
    assignmentId: "a",
    executionCode: "tvatt",
    timeKey: "2026-01-05|480-600",
    address: null,
    latitude: null,
    longitude: null,
    valueOre: 0,
    costOre: 0,
    durationMinutes: 30,
    slotType: "onskad" as SlotType,
    windowStart: new Date(2026, 0, 5, 8, 0),
    windowEnd: new Date(2026, 0, 5, 10, 0),
    ...partial,
  };
}

describe("groupTasks", () => {
  it("grupperar samma gata + samma sida, men separerar udda/jämnt", () => {
    const tasks = [
      task({ assignmentId: "1", address: "Storgatan 2" }),
      task({ assignmentId: "2", address: "Storgatan 4" }),
      task({ assignmentId: "3", address: "Storgatan 3" }), // andra sidan
    ];
    const groups = groupTasks(tasks, 150);
    const even = groups.find((g) => g.members.some((m) => m.assignmentId === "1"));
    const odd = groups.find((g) => g.members.some((m) => m.assignmentId === "3"));
    expect(even?.members.map((m) => m.assignmentId).sort()).toEqual(["1", "2"]);
    expect(odd?.members.map((m) => m.assignmentId)).toEqual(["3"]);
    expect(even?.groupingBasis).toBe("address");
  });

  it("separerar grupper med olika utförandekod", () => {
    const tasks = [
      task({ assignmentId: "1", address: "Storgatan 2", executionCode: "tvatt" }),
      task({ assignmentId: "2", address: "Storgatan 4", executionCode: "sug" }),
    ];
    const groups = groupTasks(tasks, 150);
    expect(groups.length).toBe(2);
  });

  it("faller tillbaka på position inom radien när gatuadress saknas", () => {
    const tasks = [
      task({ assignmentId: "1", latitude: 59.3293, longitude: 18.0686 }),
      task({ assignmentId: "2", latitude: 59.3294, longitude: 18.0687 }), // ~13 m
      task({ assignmentId: "3", latitude: 59.4000, longitude: 18.2000 }), // långt bort
    ];
    const groups = groupTasks(tasks, 150);
    const near = groups.find((g) => g.members.some((m) => m.assignmentId === "1"));
    expect(near?.members.map((m) => m.assignmentId).sort()).toEqual(["1", "2"]);
    expect(near?.groupingBasis).toBe("geo");
    const far = groups.find((g) => g.members.some((m) => m.assignmentId === "3"));
    expect(far?.members.length).toBe(1);
  });

  it("gör fristående uppgift när varken adress eller position finns", () => {
    const groups = groupTasks([task({ assignmentId: "1" })], 150);
    expect(groups.length).toBe(1);
    expect(groups[0].groupingBasis).toBe("standalone");
    expect(groups[0].members.length).toBe(1);
  });
});

describe("summarizeGroup", () => {
  it("summerar ordervärde, kostnad och produktionstid", () => {
    const groups = groupTasks(
      [
        task({ assignmentId: "1", address: "Storgatan 2", valueOre: 10000, costOre: 4000, durationMinutes: 30 }),
        task({ assignmentId: "2", address: "Storgatan 4", valueOre: 25000, costOre: 9000, durationMinutes: 45 }),
      ],
      150,
    );
    const sum = summarizeGroup(groups[0]);
    expect(sum.summedValueOre).toBe(35000);
    expect(sum.summedCostOre).toBe(13000);
    expect(sum.summedDurationMinutes).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// runTimeGeoEngine — full motor-flöde (storage mockad)
// ---------------------------------------------------------------------------
function assignment(partial: Record<string, unknown>) {
  return {
    id: "a",
    objectId: "o",
    address: null,
    latitude: null,
    longitude: null,
    cachedValue: 0,
    cachedCost: 0,
    estimatedDuration: 30,
    frozenTimeRules: null,
    scheduledDate: null,
    plannedWindowStart: null,
    plannedWindowEnd: null,
    ...partial,
  };
}

describe("runTimeGeoEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.getAssignmentArticlesForAssignments.mockResolvedValue([]);
    storageMocks.getArticles.mockResolvedValue([]);
    storageMocks.getTenantGroupingRadiusMeters.mockResolvedValue(150);
    storageMocks.clearEngineSlotTimes.mockResolvedValue(undefined);
    storageMocks.createSlotTimes.mockImplementation(async (rows: unknown[]) => rows.length);
  });

  it("kraschar inte när en uppgift saknar giltig slot, fortsätter med övriga", async () => {
    // Period: idag → imorgon (lokal midnatt).
    const periodStart = new Date();
    periodStart.setHours(0, 0, 0, 0);
    const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);
    const blockedKeys = [toDateKey(periodStart), toDateKey(periodEnd)];

    storageMocks.getAssignments.mockResolvedValue([
      assignment({ id: "blocked", objectId: "o-blocked", address: "Storgatan 2" }),
      assignment({ id: "ok", objectId: "o-ok", address: "Storgatan 4", cachedValue: 5000 }),
    ]);
    // o-blocked: alla dagar i perioden blockerade → 0 kandidater (oschemaläggbar).
    // o-ok: inga begränsningar → fallback-standardfönster.
    storageMocks.resolveDeliveryPreferences.mockImplementation(async (objectId: string) => ({
      effective: {
        weeklyWindows: [],
        blockedHours: [],
        blockedDates: objectId === "o-blocked" ? blockedKeys : [],
      },
    }));

    const result = await runTimeGeoEngine("t1", { periodStart, periodEnd });

    expect(result.unschedulableAssignments).toBe(1);
    expect(result.processedAssignments).toBe(1); // bara "ok"
    expect(result.taskSlots).toBe(1);
    expect(result.slotsCreated).toBe(1);
    expect(result.clumpGroups).toBe(0);

    // Endast den schemaläggbara uppgiften persisteras.
    const writtenRows = storageMocks.createSlotTimes.mock.calls[0][0] as Array<{ assignmentId: string | null }>;
    expect(writtenRows.length).toBe(1);
    expect(writtenRows[0].assignmentId).toBe("ok");
  });

  it("returnerar tomt resultat utan att skriva när inga oplanerade uppgifter finns", async () => {
    storageMocks.getAssignments.mockResolvedValue([]);
    const periodStart = new Date();
    periodStart.setHours(0, 0, 0, 0);
    const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);

    const result = await runTimeGeoEngine("t1", { periodStart, periodEnd });

    expect(result.processedAssignments).toBe(0);
    expect(result.unschedulableAssignments).toBe(0);
    expect(result.slotsCreated).toBe(0);
    expect(storageMocks.createSlotTimes).not.toHaveBeenCalled();
  });
});
