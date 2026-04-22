import { describe, it, expect } from "vitest";
import {
  resolveGoalsToClustersPure,
  computeClusterCapacityPure,
  computeWeekDemandHours,
  generateRebalanceSuggestions,
  type GoalRow,
  type ComputedForecastResult,
} from "../../server/services/capacity-forecast-service";
import type { Cluster, Resource } from "@shared/schema";

function makeGoal(overrides: Partial<GoalRow> = {}): GoalRow {
  return {
    id: overrides.id ?? "g-1",
    customerId: null,
    objectId: null,
    clusterId: null,
    articleType: "service",
    targetCount: 52,
    year: 2026,
    sourceType: null,
    sourceId: null,
    ...overrides,
  };
}

function makeCluster(overrides: Partial<Cluster> = {}): Cluster {
  return {
    id: overrides.id ?? "c-1",
    tenantId: "t-1",
    name: overrides.name ?? "Cluster",
    postalCodes: overrides.postalCodes ?? [],
    ...overrides,
  } as Cluster;
}

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: overrides.id ?? "r-1",
    tenantId: "t-1",
    name: overrides.name ?? "Resource",
    weeklyHours: overrides.weeklyHours ?? 40,
    efficiencyFactor: overrides.efficiencyFactor ?? 1.0,
    serviceArea: overrides.serviceArea ?? [],
    ...overrides,
  } as Resource;
}

// ===== Goal → cluster fallback chain =====
describe("resolveGoalsToClustersPure", () => {
  it("assigns goal directly when clusterId is set", () => {
    const goals = [makeGoal({ id: "g1", clusterId: "C1" })];
    const out = resolveGoalsToClustersPure(goals, new Map(), new Map());
    expect(out.get("C1")?.length).toBe(1);
    expect(out.get("C1")?.[0].id).toBe("g1");
  });

  it("falls back to object → cluster mapping when no clusterId", () => {
    const goals = [makeGoal({ id: "g2", objectId: "O1" })];
    const objectMap = new Map<string, string | null>([["O1", "C2"]]);
    const out = resolveGoalsToClustersPure(goals, objectMap, new Map());
    expect(out.get("C2")?.[0].id).toBe("g2");
  });

  it("ignores goal when object exists but has no cluster", () => {
    const goals = [makeGoal({ id: "g3", objectId: "O1" })];
    const objectMap = new Map<string, string | null>([["O1", null]]);
    const out = resolveGoalsToClustersPure(goals, objectMap, new Map());
    expect(out.size).toBe(0);
  });

  it("splits customer-level goal evenly across customer's clusters", () => {
    const goals = [makeGoal({ id: "g4", customerId: "Cust1", targetCount: 100 })];
    const custMap = new Map<string, string[]>([["Cust1", ["C1", "C2", "C3", "C4"]]]);
    const out = resolveGoalsToClustersPure(goals, new Map(), custMap);
    expect(out.size).toBe(4);
    for (const cid of ["C1", "C2", "C3", "C4"]) {
      expect(out.get(cid)?.[0].targetCount).toBe(25);
    }
  });

  it("drops customer-level goal when customer has no clusters", () => {
    const goals = [makeGoal({ id: "g5", customerId: "CustX" })];
    const out = resolveGoalsToClustersPure(goals, new Map(), new Map());
    expect(out.size).toBe(0);
  });

  it("prefers explicit clusterId over object/customer fallbacks", () => {
    const goals = [
      makeGoal({ id: "g6", clusterId: "CLUSTER", objectId: "O1", customerId: "Cust1" }),
    ];
    const objMap = new Map<string, string | null>([["O1", "OTHER"]]);
    const custMap = new Map<string, string[]>([["Cust1", ["X", "Y"]]]);
    const out = resolveGoalsToClustersPure(goals, objMap, custMap);
    expect(out.size).toBe(1);
    expect(out.get("CLUSTER")?.length).toBe(1);
  });
});

// ===== Capacity computation =====
describe("computeClusterCapacityPure", () => {
  it("sums weekly hours × efficiency for resources whose service area overlaps the cluster", () => {
    const cluster = makeCluster({ id: "C1", postalCodes: ["12345", "12346"] });
    const r1 = makeResource({ id: "r1", weeklyHours: 40, efficiencyFactor: 1.0, serviceArea: ["12345"] });
    const r2 = makeResource({ id: "r2", weeklyHours: 30, efficiencyFactor: 0.5, serviceArea: ["12346", "99999"] });
    const r3 = makeResource({ id: "r3", weeklyHours: 40, efficiencyFactor: 1.0, serviceArea: ["00000"] });

    const out = computeClusterCapacityPure([cluster], [r1, r2, r3]);
    expect(out.get("C1")).toBeCloseTo(40 + 15, 5);
  });

  it("uses default 40h × 1.0 when fields are nullish", () => {
    const cluster = makeCluster({ id: "C1", postalCodes: ["12345"] });
    const r = makeResource({
      id: "r1",
      weeklyHours: null as unknown as number,
      efficiencyFactor: null as unknown as number,
      serviceArea: ["12345"],
    });
    const out = computeClusterCapacityPure([cluster], [r]);
    expect(out.get("C1")).toBe(40);
  });

  it("falls back to equal share of all resource hours when no overlap matches", () => {
    const c1 = makeCluster({ id: "C1", postalCodes: ["A"] });
    const c2 = makeCluster({ id: "C2", postalCodes: ["B"] });
    const r1 = makeResource({ weeklyHours: 40, efficiencyFactor: 1.0, serviceArea: ["Z"] });
    const r2 = makeResource({ weeklyHours: 40, efficiencyFactor: 0.5, serviceArea: ["Y"] });
    // No overlaps anywhere → both clusters get total/2 = (40 + 20) / 2 = 30
    const out = computeClusterCapacityPure([c1, c2], [r1, r2]);
    expect(out.get("C1")).toBeCloseTo(30, 5);
    expect(out.get("C2")).toBeCloseTo(30, 5);
  });

  it("applies fallback per-cluster when only some clusters lack overlap", () => {
    const c1 = makeCluster({ id: "C1", postalCodes: ["A"] });
    const c2 = makeCluster({ id: "C2", postalCodes: ["NOMATCH"] });
    const r1 = makeResource({ weeklyHours: 40, efficiencyFactor: 1.0, serviceArea: ["A"] });
    const r2 = makeResource({ weeklyHours: 20, efficiencyFactor: 1.0, serviceArea: ["A"] });
    const out = computeClusterCapacityPure([c1, c2], [r1, r2]);
    expect(out.get("C1")).toBe(60);
    // C2 has no overlap → fallback = total / numClusters = 60 / 2 = 30
    expect(out.get("C2")).toBe(30);
  });

  it("returns empty map when there are no clusters", () => {
    const out = computeClusterCapacityPure([], [makeResource()]);
    expect(out.size).toBe(0);
  });

  it("treats an empty cluster postalCodes list as no overlap", () => {
    const c1 = makeCluster({ id: "C1", postalCodes: [] });
    const r = makeResource({ weeklyHours: 40, efficiencyFactor: 1.0, serviceArea: ["A"] });
    // No overlap → fallback total / 1 = 40
    const out = computeClusterCapacityPure([c1], [r]);
    expect(out.get("C1")).toBe(40);
  });
});

// ===== Demand computation =====
describe("computeWeekDemandHours", () => {
  // Pick a Monday in spring (March), 2026-03-02
  const springMonday = new Date(Date.UTC(2026, 2, 2));
  const winterMonday = new Date(Date.UTC(2026, 0, 5));

  it("ignores goals from other years", () => {
    const goals = [makeGoal({ year: 2025, targetCount: 52, articleType: "service" })];
    const avg = new Map<string, number>([["service", 60]]);
    const subs = new Map<string, string | null>();
    expect(computeWeekDemandHours(goals, springMonday, avg, subs)).toBe(0);
  });

  it("uses default minutes when article-time average is missing", () => {
    const goals = [makeGoal({ targetCount: 52, articleType: "unknown_type" })];
    const avg = new Map<string, number>();
    const subs = new Map<string, string | null>();
    // 52 / 52 * 30 / 60 = 0.5 hours
    expect(computeWeekDemandHours(goals, springMonday, avg, subs)).toBeCloseTo(0.5, 5);
  });

  it("uses article-time average when available", () => {
    const goals = [makeGoal({ targetCount: 52, articleType: "service" })];
    const avg = new Map<string, number>([["service", 90]]);
    const subs = new Map<string, string | null>();
    // 1 unit/week * 90min = 1.5h
    expect(computeWeekDemandHours(goals, springMonday, avg, subs)).toBeCloseTo(1.5, 5);
  });

  it("treats year as 52 weeks for all_year season", () => {
    const goals = [makeGoal({
      targetCount: 104,
      sourceType: "subscription",
      sourceId: "sub-1",
    })];
    const avg = new Map<string, number>([["service", 60]]);
    const subs = new Map<string, string | null>([["sub-1", "all_year"]]);
    // 104 / 52 = 2 units/week * 60min = 2h
    expect(computeWeekDemandHours(goals, springMonday, avg, subs)).toBeCloseTo(2, 5);
  });

  it("returns zero for weeks outside the subscription season", () => {
    const goals = [makeGoal({
      targetCount: 13,
      sourceType: "subscription",
      sourceId: "sub-1",
    })];
    const avg = new Map<string, number>([["service", 60]]);
    const subs = new Map<string, string | null>([["sub-1", "summer"]]);
    // springMonday is in March → not summer
    expect(computeWeekDemandHours(goals, springMonday, avg, subs)).toBe(0);
  });

  it("concentrates target across in-season weeks only", () => {
    const goals = [makeGoal({
      targetCount: 13,
      sourceType: "subscription",
      sourceId: "sub-1",
    })];
    const avg = new Map<string, number>([["service", 60]]);
    const subs = new Map<string, string | null>([["sub-1", "summer"]]);
    // Pick a summer week (July)
    const julyMonday = new Date(Date.UTC(2026, 6, 6));
    // summer = 3 months → ~13 in-season weeks → 1 unit/week → 1h
    const result = computeWeekDemandHours(goals, julyMonday, avg, subs);
    expect(result).toBeGreaterThan(0.9);
    expect(result).toBeLessThan(1.1);
  });

  it("ignores winter season for a winter week and not for a spring week", () => {
    const goals = [makeGoal({
      targetCount: 12,
      sourceType: "subscription",
      sourceId: "sub-1",
    })];
    const avg = new Map<string, number>([["service", 60]]);
    const subs = new Map<string, string | null>([["sub-1", "winter"]]);

    expect(computeWeekDemandHours(goals, winterMonday, avg, subs)).toBeGreaterThan(0);
    expect(computeWeekDemandHours(goals, springMonday, avg, subs)).toBe(0);
  });

  it("sums demand across multiple goals", () => {
    const goals = [
      makeGoal({ id: "g1", targetCount: 52, articleType: "a" }),
      makeGoal({ id: "g2", targetCount: 52, articleType: "b" }),
    ];
    const avg = new Map<string, number>([["a", 60], ["b", 30]]);
    const subs = new Map<string, string | null>();
    // 1.0h + 0.5h = 1.5h
    expect(computeWeekDemandHours(goals, springMonday, avg, subs)).toBeCloseTo(1.5, 5);
  });
});

// ===== Rebalance heuristic =====
function makeForecast(
  weeks: { weekStart: string; gapByCluster: Record<string, number> }[],
  clusterNames: Record<string, string>,
): ComputedForecastResult {
  const clusterIds = Object.keys(clusterNames);
  const clusters = clusterIds.map(id => ({
    clusterId: id,
    clusterName: clusterNames[id],
    weeks: weeks.map(w => ({
      weekStart: w.weekStart,
      demandHours: 0,
      capacityHours: 0,
      gapHours: w.gapByCluster[id] ?? 0,
      weatherMultiplier: 1.0,
    })),
    totalDemand: 0,
    totalCapacity: 0,
    totalGap: 0,
  }));
  return { clusters, computedAt: new Date() };
}

describe("generateRebalanceSuggestions", () => {
  it("returns no suggestions for fewer than two clusters", () => {
    const forecast = makeForecast(
      [{ weekStart: "2026-04-06T00:00:00.000Z", gapByCluster: { A: 10 } }],
      { A: "A" },
    );
    expect(generateRebalanceSuggestions(forecast)).toEqual([]);
  });

  it("returns no suggestions when there is no shortage", () => {
    const forecast = makeForecast(
      [{ weekStart: "2026-04-06T00:00:00.000Z", gapByCluster: { A: 0, B: -10 } }],
      { A: "A", B: "B" },
    );
    expect(generateRebalanceSuggestions(forecast)).toEqual([]);
  });

  it("pairs the top understaffed cluster with the top overstaffed cluster", () => {
    const forecast = makeForecast(
      [{
        weekStart: "2026-04-06T00:00:00.000Z",
        gapByCluster: { A: 20, B: -25, C: 5 },
      }],
      { A: "Alpha", B: "Beta", C: "Gamma" },
    );
    const out = generateRebalanceSuggestions(forecast);
    expect(out.length).toBeGreaterThan(0);
    // Largest shortage is A (20) so it pairs with the largest surplus B
    expect(out[0].fromClusterId).toBe("B");
    expect(out[0].toClusterId).toBe("A");
    expect(out[0].hours).toBeCloseTo(20, 5);
  });

  it("merges consecutive weeks with the same from→to pair into one suggestion", () => {
    const forecast = makeForecast(
      [
        { weekStart: "2026-04-06T00:00:00.000Z", gapByCluster: { A: 40, B: -40 } },
        { weekStart: "2026-04-13T00:00:00.000Z", gapByCluster: { A: 40, B: -40 } },
      ],
      { A: "Alpha", B: "Beta" },
    );
    const out = generateRebalanceSuggestions(forecast);
    expect(out.length).toBe(1);
    expect(out[0].fromClusterId).toBe("B");
    expect(out[0].toClusterId).toBe("A");
    expect(out[0].hours).toBeCloseTo(80, 5);
    // 80h spread over 2 weeks = 40h/week → 1 FTE
    expect(out[0].fteShift).toBeCloseTo(1.0, 5);
    expect(out[0].weekStart).toBe("2026-04-06T00:00:00.000Z");
    expect(out[0].weekStartEnd).toBe("2026-04-13T00:00:00.000Z");
  });

  it("rounds FTE to two decimals", () => {
    const forecast = makeForecast(
      [{ weekStart: "2026-04-06T00:00:00.000Z", gapByCluster: { A: 10, B: -10 } }],
      { A: "A", B: "B" },
    );
    const out = generateRebalanceSuggestions(forecast);
    // 10h / 1 week / 40 = 0.25 FTE
    expect(out[0].fteShift).toBeCloseTo(0.25, 5);
  });

  it("ignores tiny gaps below the half-hour threshold", () => {
    const forecast = makeForecast(
      [{ weekStart: "2026-04-06T00:00:00.000Z", gapByCluster: { A: 0.4, B: -0.4 } }],
      { A: "A", B: "B" },
    );
    expect(generateRebalanceSuggestions(forecast)).toEqual([]);
  });

  it("respects maxSuggestions option", () => {
    const weeks = [
      { weekStart: "2026-04-06T00:00:00.000Z", gapByCluster: { A: 10, B: 0, C: 0, D: -10 } },
      // Use a non-consecutive week so distinct pair entries don't merge
      { weekStart: "2026-05-04T00:00:00.000Z", gapByCluster: { A: 0, B: 10, C: -10, D: 0 } },
    ];
    const forecast = makeForecast(weeks, { A: "A", B: "B", C: "C", D: "D" });
    const out = generateRebalanceSuggestions(forecast, { maxSuggestions: 1 });
    expect(out.length).toBe(1);
  });
});
