import { describe, expect, it } from "vitest";
import {
  tryMapVRPRequestToGoogle,
  mapGoogleOptimizeToursResult,
} from "../../server/services/googleMapProvider";
import type { ProviderVRPRequest } from "../../server/services/mapProvider";

// Anchor till en deterministisk dag (2026-01-01 UTC) så att absoluta
// timestamp-strängar i förväntningar är reproducerbara.
const DAY_ANCHOR_SEC = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const isoAt = (offsetSec: number) =>
  new Date((DAY_ANCHOR_SEC + offsetSec) * 1000).toISOString();

function makeRequest(): ProviderVRPRequest {
  return {
    globalStartTimeSeconds: DAY_ANCHOR_SEC,
    jobs: [
      {
        id: "wo-1",
        location: [18.06, 59.33], // Stockholm [lng, lat]
        duration: 1800,
        priority: 75,
        time_windows: [[9 * 3600, 11 * 3600]],
        required_skills: [0], // skill 0 — bara agent A har
        delivery: [200, 0],
      },
      {
        id: "wo-2",
        location: [11.97, 57.71], // Göteborg
        duration: 600,
        priority: 25,
      },
    ],
    agents: [
      {
        id: "agent-A",
        start_location: [18.07, 59.33],
        end_location: [18.07, 59.33],
        time_windows: [[8 * 3600, 17 * 3600]],
        breaks: [{ duration: 1800, time_windows: [[11 * 3600, 13 * 3600]] }],
        skills: [0, 1],
        capacity: [1500, 12],
      },
      {
        id: "agent-B",
        start_location: [12.0, 57.7],
        skills: [1],
      },
    ],
  };
}

describe("tryMapVRPRequestToGoogle", () => {
  it("mappar jobs/agents till Googles shipments/vehicles med alla berikade fält", () => {
    const mapped = tryMapVRPRequestToGoogle(makeRequest());
    expect(mapped).not.toBeNull();
    const model = (mapped as any).model;

    expect(model.globalStartTime).toBe(isoAt(0));
    expect(model.globalEndTime).toBe(isoAt(17 * 3600));

    // Shipments
    expect(model.shipments).toHaveLength(2);
    const s1 = model.shipments[0];
    expect(s1.label).toBe("wo-1");
    expect(s1.penaltyCost).toBe(75000);
    expect(s1.allowedVehicleIndices).toEqual([0]); // bara agent A har skill 0

    const d1 = s1.deliveries[0];
    expect(d1.arrivalLocation).toEqual({ latitude: 59.33, longitude: 18.06 });
    expect(d1.duration).toBe("1800s");
    expect(d1.timeWindows).toEqual([
      { startTime: isoAt(9 * 3600), endTime: isoAt(11 * 3600) },
    ]);
    expect(d1.loadDemands).toEqual({ dim0: { amount: "200" } });

    const s2 = model.shipments[1];
    expect(s2.label).toBe("wo-2");
    expect(s2.penaltyCost).toBe(25000);
    expect(s2.allowedVehicleIndices).toBeUndefined(); // inga required_skills
    expect(s2.deliveries[0].timeWindows).toBeUndefined();

    // Vehicles
    expect(model.vehicles).toHaveLength(2);
    const v1 = model.vehicles[0];
    expect(v1.label).toBe("agent-A");
    expect(v1.startLocation).toEqual({ latitude: 59.33, longitude: 18.07 });
    expect(v1.endLocation).toEqual({ latitude: 59.33, longitude: 18.07 });
    expect(v1.startTimeWindows).toEqual([
      { startTime: isoAt(8 * 3600), endTime: isoAt(17 * 3600) },
    ]);
    expect(v1.endTimeWindows).toEqual(v1.startTimeWindows);
    expect(v1.loadLimits).toEqual({
      dim0: { maxLoad: "1500" },
      dim1: { maxLoad: "12" },
    });
    expect(v1.breakRule).toEqual({
      breakRequests: [
        {
          earliestStartTime: isoAt(11 * 3600),
          latestStartTime: isoAt(13 * 3600 - 1800), // latest - duration
          minDuration: "1800s",
        },
      ],
    });

    const v2 = model.vehicles[1];
    expect(v2.startLocation).toEqual({ latitude: 57.7, longitude: 12.0 });
    expect(v2.endLocation).toEqual({ latitude: 57.7, longitude: 12.0 }); // fallback till start
    expect(v2.loadLimits).toBeUndefined();
    expect(v2.breakRule).toBeUndefined();
    expect(v2.startTimeWindows).toBeUndefined();
  });

  it("returnerar null om jobs/agents saknar koordinater", () => {
    expect(tryMapVRPRequestToGoogle({ jobs: "x" as unknown, agents: [] })).toBeNull();
    expect(
      tryMapVRPRequestToGoogle({
        jobs: [{ location: "bad" }],
        agents: [{ start_location: [1, 2] }],
      } as unknown as ProviderVRPRequest),
    ).toBeNull();
  });

  it("clampar prioritet till penaltyCost-intervallet [0, 100000]", () => {
    const mapped = tryMapVRPRequestToGoogle({
      globalStartTimeSeconds: DAY_ANCHOR_SEC,
      jobs: [
        { id: "lo", location: [0, 0], priority: -50 },
        { id: "hi", location: [0, 0], priority: 9999 },
        { id: "default", location: [0, 0] },
      ],
      agents: [{ start_location: [0, 0] }],
    });
    const ships = (mapped as any).model.shipments;
    expect(ships[0].penaltyCost).toBe(0);
    expect(ships[1].penaltyCost).toBe(100000);
    expect(ships[2].penaltyCost).toBe(1000); // default
  });

  it("modellerar pickup-vektorn som pickups-stop på samma plats", () => {
    const mapped = tryMapVRPRequestToGoogle({
      globalStartTimeSeconds: DAY_ANCHOR_SEC,
      jobs: [{ id: "p", location: [10, 20], pickup: [3, 0, 7] }],
      agents: [{ start_location: [0, 0], capacity: [100, 0, 100] }],
    });
    const s = (mapped as any).model.shipments[0];
    expect(s.pickups).toEqual([
      {
        arrivalLocation: { latitude: 20, longitude: 10 },
        duration: "0s",
        loadDemands: { dim0: { amount: "3" }, dim2: { amount: "7" } },
      },
    ]);
  });
});

describe("mapGoogleOptimizeToursResult", () => {
  it("mappar tillbaka till ProviderVRPResult med korrekt distance/time/visits/breaks", () => {
    const res = mapGoogleOptimizeToursResult({
      routes: [
        {
          vehicleIndex: 0,
          vehicleLabel: "agent-A",
          vehicleStartTime: isoAt(8 * 3600),
          vehicleEndTime: isoAt(15 * 3600),
          metrics: { travelDistanceMeters: 42000, totalDuration: "25200s" },
          visits: [
            {
              shipmentIndex: 0,
              shipmentLabel: "wo-1",
              startTime: isoAt(9 * 3600),
              arrivalLocation: { latitude: 59.33, longitude: 18.06 },
            },
            {
              shipmentIndex: 1,
              shipmentLabel: "wo-2",
              startTime: isoAt(13 * 3600 + 1800),
            },
          ],
          breaks: [
            { startTime: isoAt(11 * 3600), duration: "1800s" },
          ],
          routePolyline: { points: "abc" },
        },
        {
          vehicleIndex: 1,
          vehicleLabel: "agent-B",
          // Inga visits → räknas som unassigned agent
          metrics: { travelDistanceMeters: 0, totalDuration: "0s" },
        },
      ],
      skippedShipments: [{ index: 7, label: "wo-skip", reasons: [{ code: "NO_FIT" }] }],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.unassignedJobIndices).toEqual([7]);
    expect(res.unassignedAgentIndices).toEqual([1]);
    expect(res.agentPlans).toHaveLength(2);

    const plan = res.agentPlans[0];
    expect(plan.agentId).toBe("agent-A");
    expect(plan.distanceMeters).toBe(42000);
    expect(plan.durationSeconds).toBe(25200);
    expect(plan.geometry).toEqual({ type: "EncodedPolyline", points: "abc" });

    // start, job(09:00), break(11:00), job(13:30), end — sorterade kronologiskt
    expect(plan.actions.map((a) => a.type)).toEqual([
      "start",
      "job",
      "break",
      "job",
      "end",
    ]);
    expect(plan.actions[1]).toMatchObject({
      type: "job",
      jobIndex: 0,
      jobId: "wo-1",
      location: { lat: 59.33, lng: 18.06 },
    });
    expect(plan.actions[2]).toMatchObject({
      type: "break",
      durationSeconds: 1800,
    });
  });

  it("hanterar tomt svar utan att kasta", () => {
    const res = mapGoogleOptimizeToursResult({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.agentPlans).toEqual([]);
    expect(res.unassignedJobIndices).toEqual([]);
    expect(res.unassignedAgentIndices).toEqual([]);
  });
});
