import { describe, it, expect, vi } from "vitest";

// engine-results.ts importerar ../db (kastar utan DATABASE_URL) och ../storage.
// Den rena assembleEngineResults rör ingendera — mocka bort så regressionstestet
// blir hermetiskt (samma mönster som tests/api/time-geo-engine.test.ts).
vi.mock("../../server/db", () => ({ db: {}, pool: {} }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import {
  assembleEngineResults,
  type AssignmentContext,
} from "../../server/services/engine-results";
import { ENGINE_SOURCE } from "../../server/services/time-geo-engine";
import type { SlotTime } from "@shared/schema";
import {
  formatSuggestedTime,
  formatFlexibility,
  weekNumberLabel,
  type EngineTaskResult,
} from "@/lib/engine-results";

// ---------------------------------------------------------------------------
// Fabriker — bygger exakt den slot_times-radform motorn skriver (#1037/#1038):
//   * uppgifts-rader: assignmentId satt, en per kandidat (rank), status vald/forslag
//   * klump-rader: assignmentId=null, assignmentGroupKey satt, metadata.kind="clump"
// ---------------------------------------------------------------------------
let seq = 0;
function slot(partial: Partial<SlotTime>): SlotTime {
  seq += 1;
  return {
    id: `slot-${seq}`,
    tenantId: "t1",
    assignmentId: null,
    assignmentGroupKey: null,
    windowStart: new Date("2026-01-06T08:00:00.000Z"),
    windowEnd: new Date("2026-01-06T10:00:00.000Z"),
    slotType: "onskad",
    status: "forslag",
    rank: 0,
    score: null,
    source: ENGINE_SOURCE,
    metadata: {},
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    ...partial,
  } as SlotTime;
}

function ctx(partial: Partial<AssignmentContext>): AssignmentContext {
  return {
    title: null,
    objectId: null,
    objectName: null,
    customerId: null,
    customerName: null,
    address: null,
    ...partial,
  };
}

const ISO_TUE_0800 = new Date("2026-01-06T08:00:00.000Z").toISOString();
const ISO_TUE_NEXT = new Date("2026-01-13T08:00:00.000Z").toISOString();

describe("assembleEngineResults — läsmodell (Task #1042)", () => {
  it("monterar en klumpuppgift med medlemmar + en fristående uppgift", () => {
    const slots: SlotTime[] = [
      // Klumpmedlem c1: vald (rank 0) + alternativ (rank 1).
      slot({
        assignmentId: "c1",
        assignmentGroupKey: "G1",
        windowStart: new Date("2026-01-06T08:00:00.000Z"),
        windowEnd: new Date("2026-01-06T09:00:00.000Z"),
        slotType: "kravd",
        status: "vald",
        rank: 0,
        score: 92,
        metadata: {
          reason: "Krävd tisdag 09–11",
          executionCode: "spolning",
          valueOre: 120000,
          costOre: 40000,
          durationMinutes: 60,
        },
      }),
      slot({
        assignmentId: "c1",
        windowStart: new Date("2026-01-13T08:00:00.000Z"),
        windowEnd: new Date("2026-01-13T09:00:00.000Z"),
        slotType: "kravd",
        status: "forslag",
        rank: 1,
        score: 70,
        metadata: { executionCode: "spolning", valueOre: 120000, costOre: 40000, durationMinutes: 60 },
      }),
      // Klumpmedlem c2.
      slot({
        assignmentId: "c2",
        assignmentGroupKey: "G1",
        windowStart: new Date("2026-01-06T08:00:00.000Z"),
        windowEnd: new Date("2026-01-06T09:00:00.000Z"),
        slotType: "kravd",
        status: "vald",
        rank: 0,
        score: 88,
        metadata: { executionCode: "spolning", valueOre: 80000, costOre: 30000, durationMinutes: 60 },
      }),
      slot({
        assignmentId: "c2",
        windowStart: new Date("2026-01-13T08:00:00.000Z"),
        windowEnd: new Date("2026-01-13T09:00:00.000Z"),
        slotType: "kravd",
        status: "forslag",
        rank: 1,
        metadata: { executionCode: "spolning", valueOre: 80000, costOre: 30000, durationMinutes: 60 },
      }),
      // Klump-rad (grupp-nivå, ingen assignmentId).
      slot({
        assignmentId: null,
        assignmentGroupKey: "G1",
        windowStart: new Date("2026-01-06T08:00:00.000Z"),
        windowEnd: new Date("2026-01-06T11:00:00.000Z"),
        slotType: "kravd",
        status: "vald",
        rank: 0,
        metadata: {
          kind: "clump",
          executionCode: "spolning",
          groupingBasis: "address",
          memberCount: 2,
          memberAssignmentIds: ["c1", "c2"],
          summedValueOre: 200000,
          summedCostOre: 70000,
          summedDurationMinutes: 120,
        },
      }),
      // Fristående uppgift s1.
      slot({
        assignmentId: "s1",
        windowStart: new Date("2026-01-08T13:00:00.000Z"),
        windowEnd: new Date("2026-01-08T13:45:00.000Z"),
        slotType: "kravd",
        status: "vald",
        rank: 0,
        metadata: { executionCode: "sopning", valueOre: 50000, costOre: 20000, durationMinutes: 45 },
      }),
      slot({
        assignmentId: "s1",
        windowStart: new Date("2026-01-15T13:00:00.000Z"),
        windowEnd: new Date("2026-01-15T13:45:00.000Z"),
        slotType: "kravd",
        status: "forslag",
        rank: 1,
        metadata: { executionCode: "sopning", valueOre: 50000, costOre: 20000, durationMinutes: 45 },
      }),
    ];

    const context = new Map<string, AssignmentContext>([
      ["c1", ctx({ title: "Spola c1", objectName: "Objekt A", customerName: "Kund X", address: "Storgatan 2" })],
      ["c2", ctx({ title: "Spola c2", objectName: "Objekt B", address: "Storgatan 4" })],
      ["s1", ctx({ title: "Sopa s1", objectName: "Objekt C", address: "Annan gata 7" })],
    ]);

    const res = assembleEngineResults(slots, context);

    expect(res.hasResults).toBe(true);
    expect(res.summary.taskCount).toBe(3);
    expect(res.summary.clumpCount).toBe(1);
    expect(res.summary.standaloneCount).toBe(1);
    expect(res.summary.valueOre).toBe(250000);
    expect(res.summary.costOre).toBe(90000);
    expect(res.summary.durationMinutes).toBe(165);

    // Klump.
    expect(res.clumps).toHaveLength(1);
    const clump = res.clumps[0];
    expect(clump.groupKey).toBe("G1");
    expect(clump.memberCount).toBe(2);
    expect(clump.groupingBasis).toBe("address");
    expect(clump.executionCode).toBe("spolning");
    expect(clump.summedValueOre).toBe(200000);
    expect(clump.windowStart).toBe(ISO_TUE_0800);
    // Adress härleds ur första medlem med adress.
    expect(clump.address).toBe("Storgatan 2");
    expect(clump.members.map((m) => m.assignmentId)).toEqual(["c1", "c2"]);
    // Medlemmarna är berikade med uppgiftskontext.
    expect(clump.members[0].objectName).toBe("Objekt A");
    expect(clump.members[0].customerName).toBe("Kund X");

    // Fristående.
    expect(res.standalone).toHaveLength(1);
    const s = res.standalone[0];
    expect(s.assignmentId).toBe("s1");
    expect(s.executionCode).toBe("sopning");
    expect(s.valueOre).toBe(50000);

    // Vald/alternativ + kandidatordning per uppgift.
    const c1 = clump.members.find((m) => m.assignmentId === "c1")!;
    expect(c1.chosen?.status).toBe("vald");
    expect(c1.chosen?.slotType).toBe("kravd");
    expect(c1.chosen?.windowStart).toBe(ISO_TUE_0800);
    expect(c1.chosen?.reason).toBe("Krävd tisdag 09–11");
    expect(c1.alternative?.status).toBe("forslag");
    expect(c1.alternative?.windowStart).toBe(ISO_TUE_NEXT);
    expect(c1.candidates.map((cand) => cand.rank)).toEqual([0, 1]);
  });

  it("väljer status=vald som chosen även när den inte har rank 0 (kapacitets-skift)", () => {
    const slots: SlotTime[] = [
      slot({ assignmentId: "x1", status: "forslag", rank: 0, slotType: "onskad" }),
      slot({ assignmentId: "x1", status: "forslag", rank: 1, slotType: "onskad" }),
      slot({
        assignmentId: "x1",
        status: "vald",
        rank: 2,
        slotType: "onskad",
        metadata: { executionCode: "spolning", valueOre: 1000 },
      }),
    ];
    const res = assembleEngineResults(slots, new Map());
    const task = res.standalone[0];
    expect(task.chosen?.status).toBe("vald");
    expect(task.chosen?.rank).toBe(2);
    // Alternativ = första förslaget i rank-ordning.
    expect(task.alternative?.rank).toBe(0);
    expect(task.candidates.map((c) => c.rank)).toEqual([0, 1, 2]);
    expect(task.executionCode).toBe("spolning");
  });

  it("returnerar tomt resultat utan rader", () => {
    const res = assembleEngineResults([], new Map());
    expect(res.hasResults).toBe(false);
    expect(res.clumps).toEqual([]);
    expect(res.standalone).toEqual([]);
    expect(res.summary.taskCount).toBe(0);
    expect(res.lastRunAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Klient-formaterare (kolumnerna "Föreslagen tid" + "Flexibilitet")
// ---------------------------------------------------------------------------
describe("engine-results formaterare (Task #1042)", () => {
  // Lokala konstruktorer → round-trip via toISOString bevarar lokal veckodag/vecka,
  // oberoende av testkörningens tidszon.
  const tue = (h = 9) => new Date(2026, 0, 6, h, 0).toISOString(); // tis v.2
  const wed = (h = 9) => new Date(2026, 0, 7, h, 0).toISOString(); // ons v.2
  const nextTue = (h = 9) => new Date(2026, 0, 13, h, 0).toISOString(); // tis v.3

  it("weekNumberLabel ger ISO-vecka", () => {
    expect(weekNumberLabel(tue())).toBe("v.2");
    expect(weekNumberLabel(nextTue())).toBe("v.3");
    expect(weekNumberLabel(null)).toBeNull();
  });

  it("formatSuggestedTime: samma dag", () => {
    expect(formatSuggestedTime(tue(8), tue(10))).toBe("v.2 tis");
  });

  it("formatSuggestedTime: spann samma vecka listar veckodagar", () => {
    expect(formatSuggestedTime(tue(8), wed(10))).toBe("v.2 tis+ons");
  });

  it("formatSuggestedTime: spann över veckor", () => {
    expect(formatSuggestedTime(tue(8), nextTue(10))).toBe("v.2 tis–v.3 tis");
  });

  it("formatSuggestedTime: saknad start → streck", () => {
    expect(formatSuggestedTime(null)).toBe("–");
  });

  it("formatFlexibility: vecka ur näst bästa förslag, annars streck", () => {
    const base: EngineTaskResult = {
      assignmentId: "a",
      title: null,
      objectId: null,
      objectName: null,
      customerId: null,
      customerName: null,
      address: null,
      executionCode: "spolning",
      valueOre: 0,
      costOre: 0,
      durationMinutes: 0,
      groupKey: null,
      chosen: null,
      alternative: {
        windowStart: nextTue(),
        windowEnd: nextTue(10),
        slotType: "kravd",
        status: "forslag",
        rank: 1,
        score: null,
        reason: null,
      },
      candidates: [],
    };
    expect(formatFlexibility(base)).toBe("v.3");
    expect(formatFlexibility({ ...base, alternative: null })).toBe("–");
  });
});
