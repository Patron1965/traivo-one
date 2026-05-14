import { describe, it, expect, vi, beforeEach } from "vitest";

import type {
  ProviderVRPRequest,
  ProviderVRPResult,
  ProviderVRPAgentPlan,
} from "../../server/services/mapProvider";

const optimizeRoutesMock = vi.fn<(req: ProviderVRPRequest) => Promise<ProviderVRPResult>>();

vi.mock("../../server/services/mapProvider", async () => {
  const actual = await vi.importActual<typeof import("../../server/services/mapProvider")>(
    "../../server/services/mapProvider",
  );
  return {
    ...actual,
    getMapProvider: () => ({
      name: "geoapify" as const,
      isRoutingAvailable: () => true,
      optimizeRoutes: (req: ProviderVRPRequest) => optimizeRoutesMock(req),
    }),
  };
});

import { optimizeRoutesVRP } from "../../server/route-optimizer";
import type { WorkOrder, Resource, ServiceObject, Cluster } from "@shared/schema";

function makeOrder(id: string, objectId: string, overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id,
    objectId,
    title: `Order ${id}`,
    priority: "normal",
    estimatedDuration: 30,
    ...overrides,
  } as unknown as WorkOrder;
}

function makeObject(id: string, lat: number, lng: number): ServiceObject {
  return {
    id,
    latitude: lat,
    longitude: lng,
  } as unknown as ServiceObject;
}

function makeResource(id: string, lat = 59.33, lng = 18.07): Resource {
  return {
    id,
    name: `Resurs ${id}`,
    homeLatitude: lat,
    homeLongitude: lng,
  } as unknown as Resource;
}

function buildAgentPlan(
  agentIndex: number,
  jobIds: string[],
  opts: { withBreak?: boolean; distanceMeters?: number; durationSeconds?: number } = {},
): ProviderVRPAgentPlan {
  const actions = [];
  let t = 0;
  actions.push({ type: "start" as const, startTimeSeconds: 0, location: { lat: 59.33, lng: 18.07 } });
  jobIds.forEach((jobId, i) => {
    t += 600;
    actions.push({
      type: "job" as const,
      startTimeSeconds: t,
      durationSeconds: 1800,
      jobId,
      jobIndex: i,
      location: { lat: 59.33 + i * 0.01, lng: 18.07 + i * 0.01 },
    });
    t += 1800;
  });
  if (opts.withBreak) {
    actions.push({ type: "break" as const, startTimeSeconds: t, durationSeconds: 1800 });
    t += 1800;
  }
  actions.push({ type: "end" as const, startTimeSeconds: t, location: { lat: 59.33, lng: 18.07 } });

  return {
    agentIndex,
    distanceMeters: opts.distanceMeters ?? 12000,
    durationSeconds: opts.durationSeconds ?? t,
    actions,
    geometry: { type: "LineString", coordinates: [[18.07, 59.33], [18.08, 59.34]] },
  };
}

describe("optimizeRoutesVRP — main path", () => {
  beforeEach(() => {
    optimizeRoutesMock.mockReset();
  });

  it("consumes provider DTO into VRPOptimizationResult (assigned + unassigned + break)", async () => {
    const orders = [
      makeOrder("o1", "obj1"),
      makeOrder("o2", "obj2"),
      makeOrder("o3", "obj3", { priority: "urgent" }),
    ];
    const objects = [
      makeObject("obj1", 59.33, 18.07),
      makeObject("obj2", 59.34, 18.08),
      makeObject("obj3", 59.35, 18.09),
    ];
    const resources = [makeResource("r1")];
    const clusters: Cluster[] = [];

    optimizeRoutesMock.mockResolvedValue({
      ok: true,
      agentPlans: [buildAgentPlan(0, ["o1", "o2"], { withBreak: true, distanceMeters: 18450, durationSeconds: 5400 })],
      unassignedJobIndices: [2],
      unassignedAgentIndices: [],
    });

    const result = await optimizeRoutesVRP(orders, resources, objects, clusters);

    expect(optimizeRoutesMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.routes).toHaveLength(1);

    const route = result.routes[0];
    expect(route.resourceId).toBe("r1");
    const jobStops = route.stops.filter((s) => !s.isBreak);
    const breakStops = route.stops.filter((s) => s.isBreak);
    expect(jobStops.map((s) => s.orderId)).toEqual(["o1", "o2"]);
    expect(breakStops).toHaveLength(1);
    expect(breakStops[0].orderId).toBe("break-r1");
    expect(route.totalDistanceKm).toBeCloseTo(18.5, 1);
    expect(route.totalDurationMinutes).toBe(90);

    expect(result.unassignedOrders.map((u) => u.orderId)).toEqual(["o3"]);
    expect(result.summary.totalOrders).toBe(3);
    expect(result.summary.assignedOrders).toBe(2);
  });

  it("returns success=false with error when provider call fails (non-ok DTO)", async () => {
    const orders = [makeOrder("o1", "obj1")];
    const objects = [makeObject("obj1", 59.33, 18.07)];
    const resources = [makeResource("r1")];

    optimizeRoutesMock.mockResolvedValue({
      ok: false,
      status: 503,
      error: "upstream down",
    });

    const result = await optimizeRoutesVRP(orders, resources, objects, []);
    expect(result.success).toBe(false);
    expect(result.error).toContain("503");
    expect(result.error).toContain("upstream down");
  });

  it("returns error when no orders have coordinates (no provider call)", async () => {
    const orders = [makeOrder("o1", "missing-obj")];
    const result = await optimizeRoutesVRP(orders, [makeResource("r1")], [], []);
    expect(optimizeRoutesMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/koordinater/i);
  });
});

describe("optimizeRoutesVRP — pre-clustering path (>50 orders, >1 resource)", () => {
  beforeEach(() => {
    optimizeRoutesMock.mockReset();
  });

  it("splits work into multiple provider calls and merges DTO routes per resource", async () => {
    const ORDER_COUNT = 60;
    const orders: WorkOrder[] = [];
    const objects: ServiceObject[] = [];
    for (let i = 0; i < ORDER_COUNT; i++) {
      // Two geographic clumps so DBSCAN actually splits them.
      const lat = i < ORDER_COUNT / 2 ? 59.33 + (i % 5) * 0.001 : 63.82 + (i % 5) * 0.001;
      const lng = i < ORDER_COUNT / 2 ? 18.07 + (i % 5) * 0.001 : 20.26 + (i % 5) * 0.001;
      orders.push(makeOrder(`o${i}`, `obj${i}`));
      objects.push(makeObject(`obj${i}`, lat, lng));
    }
    const resources = [makeResource("r1", 59.33, 18.07), makeResource("r2", 63.82, 20.26)];

    // Each cluster gets its own provider call. We just assign every job in the
    // cluster to that cluster's single agent and report no unassigned.
    optimizeRoutesMock.mockImplementation(async (req: ProviderVRPRequest) => {
      const jobs = req.jobs as Array<{ id: string }>;
      return {
        ok: true,
        agentPlans: [
          buildAgentPlan(
            0,
            jobs.map((j) => j.id),
            { distanceMeters: 5000, durationSeconds: 3600 },
          ),
        ],
        unassignedJobIndices: [],
        unassignedAgentIndices: [],
      };
    });

    const result = await optimizeRoutesVRP(orders, resources, objects, []);

    // Pre-cluster path always issues > 1 provider call (one per geo-cluster).
    expect(optimizeRoutesMock.mock.calls.length).toBeGreaterThan(1);
    expect(result.success).toBe(true);
    // Every order should be assigned across the merged routes.
    const assignedOrderIds = new Set(
      result.routes.flatMap((r) => r.stops.filter((s) => !s.isBreak).map((s) => s.orderId)),
    );
    expect(assignedOrderIds.size).toBe(ORDER_COUNT);
    expect(result.summary.totalOrders).toBe(ORDER_COUNT);
    expect(result.summary.assignedOrders).toBe(ORDER_COUNT);
    // No more routes than resources after merging.
    expect(result.routes.length).toBeLessThanOrEqual(resources.length);
  });

  it("kör cluster-VRP-anrop parallellt (Task #490)", async () => {
    // Verifierar att flera kluster startar i overlap snarare än seriellt.
    // Mockar varje provider-anrop med 80 ms sleep — om körningen är seriell
    // tar 4 kluster ~320 ms; parallell (concurrency=4) ska klara <200 ms.
    const ORDER_COUNT = 80;
    const orders: WorkOrder[] = [];
    const objects: ServiceObject[] = [];
    for (let i = 0; i < ORDER_COUNT; i++) {
      const region = i % 4;
      const lat = [59.33, 57.71, 63.82, 55.60][region] + (i % 5) * 0.001;
      const lng = [18.07, 11.97, 20.26, 13.00][region] + (i % 5) * 0.001;
      orders.push(makeOrder(`o${i}`, `obj${i}`));
      objects.push(makeObject(`obj${i}`, lat, lng));
    }
    const resources = [
      makeResource("r1", 59.33, 18.07),
      makeResource("r2", 57.71, 11.97),
      makeResource("r3", 63.82, 20.26),
      makeResource("r4", 55.60, 13.00),
    ];

    const callTimestamps: number[] = [];
    optimizeRoutesMock.mockImplementation(async (req: ProviderVRPRequest) => {
      callTimestamps.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 80));
      const jobs = req.jobs as Array<{ id: string }>;
      return {
        ok: true,
        agentPlans: [
          buildAgentPlan(0, jobs.map((j) => j.id), { distanceMeters: 5000, durationSeconds: 3600 }),
        ],
        unassignedJobIndices: [],
        unassignedAgentIndices: [],
      };
    });

    process.env.VRP_PARALLEL_CLUSTERS = "true";
    process.env.VRP_PARALLEL_CONCURRENCY = "4";

    const t0 = Date.now();
    const result = await optimizeRoutesVRP(orders, resources, objects, []);
    const elapsed = Date.now() - t0;

    expect(result.success).toBe(true);
    expect(callTimestamps.length).toBeGreaterThan(1);
    // Spridning mellan första och sista call-start ska vara liten (parallellt
    // start), och total wall-time klart under en seriell körning hade gett.
    const startSpread = callTimestamps[callTimestamps.length - 1] - callTimestamps[0];
    expect(startSpread).toBeLessThan(50);
    expect(elapsed).toBeLessThan(callTimestamps.length * 80);
  });

  it("respekterar VRP_PARALLEL_CLUSTERS=false (backout till serial)", async () => {
    const ORDER_COUNT = 60;
    const orders: WorkOrder[] = [];
    const objects: ServiceObject[] = [];
    for (let i = 0; i < ORDER_COUNT; i++) {
      const region = i < ORDER_COUNT / 2 ? 0 : 1;
      const lat = region === 0 ? 59.33 + (i % 5) * 0.001 : 63.82 + (i % 5) * 0.001;
      const lng = region === 0 ? 18.07 + (i % 5) * 0.001 : 20.26 + (i % 5) * 0.001;
      orders.push(makeOrder(`o${i}`, `obj${i}`));
      objects.push(makeObject(`obj${i}`, lat, lng));
    }
    const resources = [makeResource("r1", 59.33, 18.07), makeResource("r2", 63.82, 20.26)];

    const callOrder: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    optimizeRoutesMock.mockImplementation(async (req: ProviderVRPRequest) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      callOrder.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 30));
      const jobs = req.jobs as Array<{ id: string }>;
      inFlight--;
      return {
        ok: true,
        agentPlans: [
          buildAgentPlan(0, jobs.map((j) => j.id), { distanceMeters: 5000, durationSeconds: 3600 }),
        ],
        unassignedJobIndices: [],
        unassignedAgentIndices: [],
      };
    });

    process.env.VRP_PARALLEL_CLUSTERS = "false";
    const result = await optimizeRoutesVRP(orders, resources, objects, []);
    delete process.env.VRP_PARALLEL_CLUSTERS;

    expect(result.success).toBe(true);
    expect(maxInFlight).toBe(1); // Strikt seriellt — aldrig fler än 1 i flight
  });

  it("records per-cluster provider errors as unassigned orders without throwing", async () => {
    const ORDER_COUNT = 55;
    const orders: WorkOrder[] = [];
    const objects: ServiceObject[] = [];
    for (let i = 0; i < ORDER_COUNT; i++) {
      orders.push(makeOrder(`o${i}`, `obj${i}`));
      objects.push(makeObject(`obj${i}`, 59.33 + i * 0.001, 18.07 + i * 0.001));
    }
    const resources = [makeResource("r1"), makeResource("r2")];

    optimizeRoutesMock.mockResolvedValue({
      ok: false,
      status: 500,
      error: "boom",
    });

    const result = await optimizeRoutesVRP(orders, resources, objects, []);

    // Cluster path runs but every cluster fails; the function should still
    // return a structured result (success may be true with all unassigned,
    // because cluster failures are recorded as unassigned orders rather than
    // throwing).
    expect(result.success).toBe(true);
    expect(result.summary.assignedOrders).toBe(0);
    expect(result.unassignedOrders.length).toBe(ORDER_COUNT);
  });
});
