import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import {
  tenants,
  customers,
  teams,
  geographicDistricts,
  workOrders,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../../server/storage";
import { randomId } from "./helpers";

const WEEK = "2026-W24";
const OTHER_WEEK = "2026-W25";

let tenantA: string;
let tenantB: string;
let customerA: string;
let customerB: string;
let team1: string;
let team2: string;
let inactiveTeam: string;
let teamTenantB: string;
let district1: string;
let district2: string;

type WoOverrides = {
  tenantId: string;
  customerId: string;
  teamId?: string | null;
  districtId?: string | null;
  estimatedDuration?: number | null;
  cachedValue?: number | null;
  orderStatus?: string;
  roughPlannedWeek?: string | null;
  deletedAt?: Date | null;
};

async function insertWo(o: WoOverrides): Promise<string> {
  const [wo] = await db
    .insert(workOrders)
    .values({
      tenantId: o.tenantId,
      customerId: o.customerId,
      title: `WO ${randomId()}`,
      teamId: o.teamId ?? null,
      districtId: o.districtId ?? null,
      estimatedDuration: o.estimatedDuration ?? null,
      cachedValue: o.cachedValue ?? 0,
      orderStatus: o.orderStatus ?? "skapad",
      roughPlannedWeek: o.roughPlannedWeek ?? null,
      deletedAt: o.deletedAt ?? null,
    })
    .returning();
  return wo.id;
}

describe("Grovplanering - aggregat (getRoughPlanningSummary / getUnplannedRoughWorkOrders)", () => {
  beforeAll(async () => {
    const [tA] = await db.insert(tenants).values({ name: `Rough-A ${randomId()}` }).returning();
    const [tB] = await db.insert(tenants).values({ name: `Rough-B ${randomId()}` }).returning();
    tenantA = tA.id;
    tenantB = tB.id;

    const [cA] = await db
      .insert(customers)
      .values({ tenantId: tenantA, name: `Kund A ${randomId()}`, customerNumber: randomId() })
      .returning();
    const [cB] = await db
      .insert(customers)
      .values({ tenantId: tenantB, name: `Kund B ${randomId()}`, customerNumber: randomId() })
      .returning();
    customerA = cA.id;
    customerB = cB.id;

    const [t1] = await db
      .insert(teams)
      .values({ tenantId: tenantA, name: "Team 1", status: "active", productionHoursTarget: 28 })
      .returning();
    const [t2] = await db
      .insert(teams)
      .values({ tenantId: tenantA, name: "Team 2", status: "active", productionHoursTarget: 10 })
      .returning();
    const [tInactive] = await db
      .insert(teams)
      .values({ tenantId: tenantA, name: "Inaktivt", status: "inactive", productionHoursTarget: 100 })
      .returning();
    const [tB1] = await db
      .insert(teams)
      .values({ tenantId: tenantB, name: "Team B", status: "active", productionHoursTarget: 50 })
      .returning();
    team1 = t1.id;
    team2 = t2.id;
    inactiveTeam = tInactive.id;
    teamTenantB = tB1.id;

    const [d1] = await db
      .insert(geographicDistricts)
      .values({ tenantId: tenantA, name: "Distrikt 1" })
      .returning();
    const [d2] = await db
      .insert(geographicDistricts)
      .values({ tenantId: tenantA, name: "Distrikt 2" })
      .returning();
    district1 = d1.id;
    district2 = d2.id;

    // --- Rough-planerade WO i WEEK (tenant A) ---
    // WO1: team1, district1, 60 min (1h), 10000 öre, skapad
    await insertWo({ tenantId: tenantA, customerId: customerA, teamId: team1, districtId: district1, estimatedDuration: 60, cachedValue: 10000, orderStatus: "skapad", roughPlannedWeek: WEEK });
    // WO2: team1, district1, 120 min (2h), 20000 öre, planerad_pre
    await insertWo({ tenantId: tenantA, customerId: customerA, teamId: team1, districtId: district1, estimatedDuration: 120, cachedValue: 20000, orderStatus: "planerad_pre", roughPlannedWeek: WEEK });
    // WO3: team2, district2, 30 min (0.5h), 5000 öre, skapad
    await insertWo({ tenantId: tenantA, customerId: customerA, teamId: team2, districtId: district2, estimatedDuration: 30, cachedValue: 5000, orderStatus: "skapad", roughPlannedWeek: WEEK });
    // WO4: inget team, district2, 90 min (1.5h), 0 öre, skapad
    await insertWo({ tenantId: tenantA, customerId: customerA, teamId: null, districtId: district2, estimatedDuration: 90, cachedValue: 0, orderStatus: "skapad", roughPlannedWeek: WEEK });

    // Exkluderingar för summary
    // Annan vecka
    await insertWo({ tenantId: tenantA, customerId: customerA, teamId: team1, districtId: district1, estimatedDuration: 600, cachedValue: 999999, orderStatus: "skapad", roughPlannedWeek: OTHER_WEEK });
    // Soft-deleted i WEEK
    await insertWo({ tenantId: tenantA, customerId: customerA, teamId: team1, districtId: district1, estimatedDuration: 600, cachedValue: 999999, orderStatus: "skapad", roughPlannedWeek: WEEK, deletedAt: new Date() });
    // Cross-tenant: tenant B i WEEK
    await insertWo({ tenantId: tenantB, customerId: customerB, teamId: teamTenantB, districtId: null, estimatedDuration: 600, cachedValue: 999999, orderStatus: "skapad", roughPlannedWeek: WEEK });

    // --- Oplanerade WO (roughPlannedWeek = NULL) för tenant A ---
    await insertWo({ tenantId: tenantA, customerId: customerA, orderStatus: "skapad", roughPlannedWeek: null }); // included
    await insertWo({ tenantId: tenantA, customerId: customerA, orderStatus: "planerad_pre", roughPlannedWeek: null }); // included
    await insertWo({ tenantId: tenantA, customerId: customerA, orderStatus: "utford", roughPlannedWeek: null }); // terminal -> exkluderad
    await insertWo({ tenantId: tenantA, customerId: customerA, orderStatus: "fakturerad", roughPlannedWeek: null }); // terminal
    await insertWo({ tenantId: tenantA, customerId: customerA, orderStatus: "omojlig", roughPlannedWeek: null }); // terminal
    await insertWo({ tenantId: tenantA, customerId: customerA, orderStatus: "avbruten", roughPlannedWeek: null }); // terminal
    await insertWo({ tenantId: tenantA, customerId: customerA, orderStatus: "skapad", roughPlannedWeek: null, deletedAt: new Date() }); // soft-deleted
    // Cross-tenant oplanerad
    await insertWo({ tenantId: tenantB, customerId: customerB, orderStatus: "skapad", roughPlannedWeek: null });
  });

  afterAll(async () => {
    await db.delete(workOrders).where(eq(workOrders.tenantId, tenantA)).catch(() => {});
    await db.delete(workOrders).where(eq(workOrders.tenantId, tenantB)).catch(() => {});
    await db.delete(geographicDistricts).where(eq(geographicDistricts.tenantId, tenantA)).catch(() => {});
    await db.delete(teams).where(eq(teams.tenantId, tenantA)).catch(() => {});
    await db.delete(teams).where(eq(teams.tenantId, tenantB)).catch(() => {});
    await db.delete(customers).where(eq(customers.tenantId, tenantA)).catch(() => {});
    await db.delete(customers).where(eq(customers.tenantId, tenantB)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.id, tenantA)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.id, tenantB)).catch(() => {});
  });

  describe("getRoughPlanningSummary - per-team-aggregat", () => {
    it("summerar count/demandHours/valueOre korrekt per team", async () => {
      const summary = await storage.getRoughPlanningSummary(tenantA, WEEK);

      const byTeam = new Map(summary.byTeam.map((r) => [r.teamId, r]));
      expect(byTeam.get(team1)).toEqual({ teamId: team1, count: 2, demandHours: 3, valueOre: 30000 });
      expect(byTeam.get(team2)).toEqual({ teamId: team2, count: 1, demandHours: 0.5, valueOre: 5000 });
      // WO utan team grupperas under teamId = null
      expect(byTeam.get(null)).toEqual({ teamId: null, count: 1, demandHours: 1.5, valueOre: 0 });
      expect(summary.byTeam).toHaveLength(3);
    });
  });

  describe("getRoughPlanningSummary - per-distrikt-aggregat", () => {
    it("summerar count/demandHours/valueOre korrekt per distrikt", async () => {
      const summary = await storage.getRoughPlanningSummary(tenantA, WEEK);

      const byDistrict = new Map(summary.byDistrict.map((r) => [r.districtId, r]));
      expect(byDistrict.get(district1)).toEqual({ districtId: district1, count: 2, demandHours: 3, valueOre: 30000 });
      expect(byDistrict.get(district2)).toEqual({ districtId: district2, count: 2, demandHours: 2, valueOre: 5000 });
      expect(summary.byDistrict).toHaveLength(2);
    });
  });

  describe("getRoughPlanningSummary - statusfördelning", () => {
    it("räknar antal per orderStatus", async () => {
      const summary = await storage.getRoughPlanningSummary(tenantA, WEEK);

      const statusMap = new Map(summary.statusCounts.map((r) => [r.status, r.count]));
      expect(statusMap.get("skapad")).toBe(3);
      expect(statusMap.get("planerad_pre")).toBe(1);
      expect(summary.statusCounts).toHaveLength(2);
    });
  });

  describe("getRoughPlanningSummary - totals + kapacitet", () => {
    it("totals summerar alla rough-planerade WO i veckan", async () => {
      const summary = await storage.getRoughPlanningSummary(tenantA, WEEK);

      expect(summary.week).toBe(WEEK);
      expect(summary.districtId).toBeNull();
      expect(summary.totals.count).toBe(4);
      expect(summary.totals.valueOre).toBe(35000);
      expect(summary.totals.demandHours).toBe(5);
    });

    it("capacityHours = SUM(productionHoursTarget) för enbart aktiva team", async () => {
      const summary = await storage.getRoughPlanningSummary(tenantA, WEEK);
      // team1 (28) + team2 (10) = 38; inaktivt team (100) räknas EJ
      expect(summary.totals.capacityHours).toBe(38);
    });
  });

  describe("getRoughPlanningSummary - districtId-filter", () => {
    it("begränsar aggregat till valt distrikt men inte kapaciteten", async () => {
      const summary = await storage.getRoughPlanningSummary(tenantA, WEEK, district1);

      expect(summary.districtId).toBe(district1);
      expect(summary.totals.count).toBe(2);
      expect(summary.totals.valueOre).toBe(30000);
      expect(summary.totals.demandHours).toBe(3);
      // Endast distrikt 1 representerat
      expect(summary.byDistrict).toHaveLength(1);
      expect(summary.byDistrict[0].districtId).toBe(district1);
      // Endast team1 har WO i distrikt 1
      expect(summary.byTeam).toHaveLength(1);
      expect(summary.byTeam[0].teamId).toBe(team1);
      // Kapaciteten är tenant-bred, inte distrikt-filtrerad
      expect(summary.totals.capacityHours).toBe(38);
    });
  });

  describe("getRoughPlanningSummary - tenant-isolering", () => {
    it("läcker inte data mellan tenants", async () => {
      const summary = await storage.getRoughPlanningSummary(tenantB, WEEK);

      // Tenant B har 1 rough-planerad WO utan team/distrikt
      expect(summary.totals.count).toBe(1);
      expect(summary.totals.valueOre).toBe(999999);
      // Endast tenant B:s aktiva team (50h)
      expect(summary.totals.capacityHours).toBe(50);
      // Inga tenant A team/distrikt
      const teamIds = summary.byTeam.map((r) => r.teamId);
      expect(teamIds).not.toContain(team1);
      expect(teamIds).not.toContain(team2);
    });
  });

  describe("getUnplannedRoughWorkOrders", () => {
    it("returnerar endast icke-terminala, ej rough-planerade WO för rätt tenant", async () => {
      const result = await storage.getUnplannedRoughWorkOrders(tenantA, 100, 0);

      // U1 (skapad) + U2 (planerad_pre) = 2. Terminala, rough-planerade,
      // soft-deletade och cross-tenant exkluderas.
      expect(result.total).toBe(2);
      expect(result.workOrders).toHaveLength(2);

      const statuses = result.workOrders.map((wo) => wo.orderStatus).sort();
      expect(statuses).toEqual(["planerad_pre", "skapad"]);

      for (const wo of result.workOrders) {
        expect(wo.tenantId).toBe(tenantA);
        expect(wo.roughPlannedWeek).toBeNull();
        expect(["utford", "fakturerad", "omojlig", "avbruten"]).not.toContain(wo.orderStatus);
      }
    });

    it("respekterar tenant-scoping", async () => {
      const result = await storage.getUnplannedRoughWorkOrders(tenantB, 100, 0);
      expect(result.total).toBe(1);
      expect(result.workOrders.every((wo) => wo.tenantId === tenantB)).toBe(true);
    });

    it("paginering begränsar resultatet men inte total", async () => {
      const result = await storage.getUnplannedRoughWorkOrders(tenantA, 1, 0);
      expect(result.total).toBe(2);
      expect(result.workOrders).toHaveLength(1);
    });
  });
});
