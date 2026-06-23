import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import { tenants, customers, objects, assignments, slotTimes } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getEngineResults } from "../../server/services/engine-results";
import { ENGINE_SOURCE } from "../../server/services/time-geo-engine";
import { randomId } from "./helpers";

// ============================================================================
// Tids- & geografimotorns resultat-läsmodell (getEngineResults) — integration mot
// riktig DB. Verifierar att motorns SKRIVNA slot_times-rader (#1037/#1038) monteras
// korrekt till klump- + fristående-vyn (#1039) som Grovplaneringens "Motorns
// förslag"-flik renderar:
//   - Klumpuppgift med summerade storheter + medlemmar + härledd adress.
//   - Fristående uppgift (utan klumpnyckel).
//   - "Föreslagen tid" = den valda slottens fönster.
//   - "Flexibilitet/deadline" = alternative = lägst-rankade status=forslag (även
//     när motorn valt en senare kandidat via kapacitets-om-passning, chosen.rank>0).
// ============================================================================

let tenantA: string;
let tenantB: string;
let customerA: string;
let objClumpEven1: string;
let objClumpEven2: string;
let objStandalone: string;
let aClump1: string;
let aClump2: string;
let aStandalone: string;
let aOtherTenant: string;

const GROUP_KEY = "ec:tvatt||time:day1|480-600||addr:storgatan#even";

// Fasta fönster (deterministiska) — motorn skriver Date-objekt; vi speglar det.
const W_DAY1_0800 = new Date("2026-06-29T08:00:00.000Z"); // måndag-morgon
const W_DAY1_1000 = new Date("2026-06-29T10:00:00.000Z");
const W_DAY2_0800 = new Date("2026-06-30T08:00:00.000Z"); // alternativ (tidigare rank)
const W_DAY2_1000 = new Date("2026-06-30T10:00:00.000Z");

describe("getEngineResults — läsmodell mot riktig motor-output", () => {
  beforeAll(async () => {
    const [tA] = await db.insert(tenants).values({ name: `Engine-A ${randomId()}` }).returning();
    const [tB] = await db.insert(tenants).values({ name: `Engine-B ${randomId()}` }).returning();
    tenantA = tA.id;
    tenantB = tB.id;

    const [cA] = await db
      .insert(customers)
      .values({ tenantId: tenantA, name: `Kund A ${randomId()}`, customerNumber: randomId() })
      .returning();
    customerA = cA.id;

    const [o1] = await db
      .insert(objects)
      .values({ tenantId: tenantA, name: "Objekt Storgatan 2" })
      .returning();
    const [o2] = await db
      .insert(objects)
      .values({ tenantId: tenantA, name: "Objekt Storgatan 4" })
      .returning();
    const [o3] = await db
      .insert(objects)
      .values({ tenantId: tenantA, name: "Objekt Fristående" })
      .returning();
    objClumpEven1 = o1.id;
    objClumpEven2 = o2.id;
    objStandalone = o3.id;

    const [a1] = await db
      .insert(assignments)
      .values({
        tenantId: tenantA,
        objectId: objClumpEven1,
        customerId: customerA,
        title: "Tvätt Storgatan 2",
        address: "Storgatan 2, 11122 Stockholm",
        status: "not_planned",
      })
      .returning();
    const [a2] = await db
      .insert(assignments)
      .values({
        tenantId: tenantA,
        objectId: objClumpEven2,
        customerId: customerA,
        title: "Tvätt Storgatan 4",
        address: "Storgatan 4, 11122 Stockholm",
        status: "not_planned",
      })
      .returning();
    const [a3] = await db
      .insert(assignments)
      .values({
        tenantId: tenantA,
        objectId: objStandalone,
        customerId: customerA,
        title: "Fristående uppgift",
        address: null,
        status: "not_planned",
      })
      .returning();
    aClump1 = a1.id;
    aClump2 = a2.id;
    aStandalone = a3.id;

    // Cross-tenant assignment (ska aldrig läcka in i tenant A:s resultat).
    const [aOther] = await db
      .insert(assignments)
      .values({
        tenantId: tenantB,
        objectId: objStandalone, // återanvänd id räcker — vi läser aldrig tenant B
        customerId: null,
        title: "Annan tenant",
        status: "not_planned",
      })
      .returning();
    aOtherTenant = aOther.id;

    // --- slot_times: spegla EXAKT vad runTimeGeoEngine skriver ---
    await db.insert(slotTimes).values([
      // aClump1: motorn valde rank 1 (kapacitets-om-passning), rank 0 blev förslag.
      // Endast den VALDA raden bär gruppnyckeln.
      {
        tenantId: tenantA,
        assignmentId: aClump1,
        assignmentGroupKey: null,
        windowStart: W_DAY2_0800,
        windowEnd: W_DAY2_1000,
        slotType: "onskad",
        status: "forslag",
        rank: 0,
        score: 999.5,
        source: ENGINE_SOURCE,
        metadata: {
          reason: "Kundönskad tid 08:00–10:00",
          executionCode: "tvatt",
          valueOre: 12000,
          costOre: 5000,
          durationMinutes: 60,
        },
      },
      {
        tenantId: tenantA,
        assignmentId: aClump1,
        assignmentGroupKey: GROUP_KEY,
        windowStart: W_DAY1_0800,
        windowEnd: W_DAY1_1000,
        slotType: "onskad",
        status: "vald",
        rank: 1,
        score: 987.5,
        source: ENGINE_SOURCE,
        metadata: {
          reason: "Kundönskad tid 08:00–10:00",
          executionCode: "tvatt",
          valueOre: 12000,
          costOre: 5000,
          durationMinutes: 60,
        },
      },
      // aClump2: vald rank 0 i samma fönster → samma klump.
      {
        tenantId: tenantA,
        assignmentId: aClump2,
        assignmentGroupKey: GROUP_KEY,
        windowStart: W_DAY1_0800,
        windowEnd: W_DAY1_1000,
        slotType: "onskad",
        status: "vald",
        rank: 0,
        score: 988.0,
        source: ENGINE_SOURCE,
        metadata: {
          reason: "Kundönskad tid 08:00–10:00",
          executionCode: "tvatt",
          valueOre: 30000,
          costOre: 9000,
          durationMinutes: 45,
        },
      },
      // aStandalone: vald rank 0 + ett förslag rank 1, ingen gruppnyckel.
      {
        tenantId: tenantA,
        assignmentId: aStandalone,
        assignmentGroupKey: null,
        windowStart: W_DAY1_0800,
        windowEnd: W_DAY1_1000,
        slotType: "fordelaktig",
        status: "vald",
        rank: 0,
        score: 305.0,
        source: ENGINE_SOURCE,
        metadata: {
          reason: "Fördelaktig tidsregel",
          executionCode: "sug",
          valueOre: 7000,
          costOre: 2000,
          durationMinutes: 90,
        },
      },
      {
        tenantId: tenantA,
        assignmentId: aStandalone,
        assignmentGroupKey: null,
        windowStart: W_DAY2_0800,
        windowEnd: W_DAY2_1000,
        slotType: "fordelaktig",
        status: "forslag",
        rank: 1,
        score: 293.0,
        source: ENGINE_SOURCE,
        metadata: {
          reason: "Fördelaktig tidsregel",
          executionCode: "sug",
          valueOre: 7000,
          costOre: 2000,
          durationMinutes: 90,
        },
      },
      // Klump-rad (assignmentId NULL) — summerade storheter + medlemslista.
      {
        tenantId: tenantA,
        assignmentId: null,
        assignmentGroupKey: GROUP_KEY,
        windowStart: W_DAY1_0800,
        windowEnd: W_DAY1_1000,
        slotType: "onskad",
        status: "vald",
        rank: 0,
        score: null,
        source: ENGINE_SOURCE,
        metadata: {
          kind: "clump",
          executionCode: "tvatt",
          groupingBasis: "address",
          memberCount: 2,
          memberAssignmentIds: [aClump1, aClump2],
          summedValueOre: 42000,
          summedCostOre: 14000,
          summedDurationMinutes: 105,
        },
      },
      // Brus: en icke-motor-rad (annan source) ska ignoreras helt.
      {
        tenantId: tenantA,
        assignmentId: aStandalone,
        assignmentGroupKey: null,
        windowStart: W_DAY1_0800,
        windowEnd: W_DAY1_1000,
        slotType: "onskad",
        status: "vald",
        rank: 0,
        score: null,
        source: "manuell",
        metadata: {},
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(slotTimes).where(eq(slotTimes.tenantId, tenantA)).catch(() => {});
    await db.delete(slotTimes).where(eq(slotTimes.tenantId, tenantB)).catch(() => {});
    await db.delete(assignments).where(eq(assignments.tenantId, tenantA)).catch(() => {});
    await db.delete(assignments).where(eq(assignments.tenantId, tenantB)).catch(() => {});
    await db.delete(objects).where(eq(objects.tenantId, tenantA)).catch(() => {});
    await db.delete(customers).where(eq(customers.tenantId, tenantA)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.id, tenantA)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.id, tenantB)).catch(() => {});
  });

  it("rapporterar hasResults + korrekta summeringar", async () => {
    const res = await getEngineResults(tenantA);
    expect(res.hasResults).toBe(true);
    // 3 uppgifter (aClump1, aClump2, aStandalone) — manuell-raden räknas inte.
    expect(res.summary.taskCount).toBe(3);
    expect(res.summary.clumpCount).toBe(1);
    expect(res.summary.standaloneCount).toBe(1);
    // valueOre = 12000 + 30000 + 7000 (per uppgift, från chosen-metadata).
    expect(res.summary.valueOre).toBe(49000);
    expect(res.summary.costOre).toBe(16000);
    expect(res.summary.durationMinutes).toBe(195);
    expect(res.lastRunAt).not.toBeNull();
  });

  it("monterar klumpuppgiften med medlemmar, summor och härledd adress", async () => {
    const res = await getEngineResults(tenantA);
    expect(res.clumps).toHaveLength(1);
    const clump = res.clumps[0];
    expect(clump.groupKey).toBe(GROUP_KEY);
    expect(clump.executionCode).toBe("tvatt");
    expect(clump.groupingBasis).toBe("address");
    expect(clump.memberCount).toBe(2);
    expect(clump.summedValueOre).toBe(42000);
    expect(clump.summedCostOre).toBe(14000);
    expect(clump.summedDurationMinutes).toBe(105);
    // Adress härleds ur första medlem med adress.
    expect(clump.address).toBe("Storgatan 2, 11122 Stockholm");
    // Medlemmarna är de två klump-uppgifterna.
    expect(clump.members.map((m) => m.assignmentId).sort()).toEqual([aClump1, aClump2].sort());
    // Klump-fönstret = den valda slotten (måndag-morgon).
    expect(clump.windowStart).toBe(W_DAY1_0800.toISOString());
    expect(clump.windowEnd).toBe(W_DAY1_1000.toISOString());
  });

  it("placerar fristående uppgiften utanför klumpen med objekt-/kundkontext", async () => {
    const res = await getEngineResults(tenantA);
    expect(res.standalone).toHaveLength(1);
    const solo = res.standalone[0];
    expect(solo.assignmentId).toBe(aStandalone);
    expect(solo.groupKey).toBeNull();
    expect(solo.title).toBe("Fristående uppgift");
    expect(solo.objectName).toBe("Objekt Fristående");
    expect(solo.customerName).not.toBeNull();
    expect(solo.executionCode).toBe("sug");
  });

  it("exponerar 'Föreslagen tid' (vald slot) + 'Flexibilitet/deadline' (lägst-rankade förslag)", async () => {
    const res = await getEngineResults(tenantA);
    const a1 = res.clumps[0].members.find((m) => m.assignmentId === aClump1)!;
    expect(a1).toBeDefined();
    // Motorn valde rank 1 → "Föreslagen tid" = det fönstret.
    expect(a1.chosen).not.toBeNull();
    expect(a1.chosen!.status).toBe("vald");
    expect(a1.chosen!.rank).toBe(1);
    expect(a1.chosen!.windowStart).toBe(W_DAY1_0800.toISOString());
    expect(a1.chosen!.windowEnd).toBe(W_DAY1_1000.toISOString());
    // Flexibilitet/deadline = lägst-rankade status=forslag (rank 0 här).
    expect(a1.alternative).not.toBeNull();
    expect(a1.alternative!.status).toBe("forslag");
    expect(a1.alternative!.rank).toBe(0);
    expect(a1.alternative!.windowStart).toBe(W_DAY2_0800.toISOString());
    // Kandidatlistan är sorterad på rank (driver förklaringsdialogen).
    expect(a1.candidates.map((c) => c.rank)).toEqual([0, 1]);
    // Endast den valda raden bär gruppnyckeln.
    expect(a1.groupKey).toBe(GROUP_KEY);
  });

  it("isolerar per tenant (annan tenant ger inget)", async () => {
    const res = await getEngineResults(tenantB);
    expect(res.hasResults).toBe(false);
    expect(res.clumps).toHaveLength(0);
    expect(res.standalone).toHaveLength(0);
  });
});
