import { describe, it, expect } from "vitest";
import { mapGeoapifyVRPToDTO } from "../../server/services/mapProvider";

const recordedGeoapifyResponse = {
  type: "FeatureCollection" as const,
  properties: {
    issues: {
      unassignedAgents: [],
      unassignedJobs: [2],
    },
  },
  features: [
    {
      type: "Feature" as const,
      properties: {
        agent_index: 0,
        agent_id: "agent-A",
        distance: 18450,
        time: 2730,
        actions: [
          { type: "start" as const, start_time: 0, waypoint_index: 0 },
          {
            type: "job" as const,
            start_time: 600,
            duration: 900,
            job_index: 0,
            job_id: "job-0",
            waypoint_index: 1,
          },
          {
            type: "break" as const,
            start_time: 1500,
            duration: 300,
          },
          {
            type: "job" as const,
            start_time: 1800,
            duration: 1200,
            job_index: 1,
            job_id: "job-1",
            waypoint_index: 2,
          },
          { type: "end" as const, start_time: 2730, waypoint_index: 3 },
        ],
        waypoints: [
          { original_location: [18.0686, 59.3293], location: [18.0686, 59.3293] },
          { original_location: [18.0710, 59.3300], location: [18.0710, 59.3300] },
          { original_location: [18.0750, 59.3350], location: [18.0750, 59.3350] },
          { original_location: [18.0686, 59.3293], location: [18.0686, 59.3293] },
        ],
      },
      geometry: {
        type: "MultiLineString",
        coordinates: [[[18.0686, 59.3293], [18.0710, 59.3300]]],
      },
    },
    {
      type: "Feature" as const,
      properties: {
        agent_index: 1,
        agent_id: "agent-B",
        distance: 5320,
        time: 980,
        actions: [
          { type: "start" as const, start_time: 0, waypoint_index: 0 },
          {
            type: "job" as const,
            start_time: 400,
            duration: 580,
            job_index: 3,
            job_id: "job-3",
            waypoint_index: 1,
          },
          { type: "end" as const, start_time: 980, waypoint_index: 2 },
        ],
        waypoints: [
          { original_location: [18.0686, 59.3293], location: [18.0686, 59.3293] },
          { original_location: [18.0800, 59.3400], location: [18.0800, 59.3400] },
          { original_location: [18.0686, 59.3293], location: [18.0686, 59.3293] },
        ],
      },
      geometry: { type: "LineString", coordinates: [[18.0686, 59.3293], [18.0800, 59.3400]] },
    },
  ],
};

describe("mapGeoapifyVRPToDTO", () => {
  it("maps an OK response into the provider-agnostic DTO", () => {
    const result = mapGeoapifyVRPToDTO({ ok: true, data: recordedGeoapifyResponse });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.unassignedJobIndices).toEqual([2]);
    expect(result.unassignedAgentIndices).toEqual([]);
    expect(result.agentPlans).toHaveLength(2);

    const a = result.agentPlans[0];
    expect(a.agentIndex).toBe(0);
    expect(a.agentId).toBe("agent-A");
    expect(a.distanceMeters).toBe(18450);
    expect(a.durationSeconds).toBe(2730);
    expect(a.actions).toHaveLength(5);

    const startAction = a.actions[0];
    expect(startAction.type).toBe("start");
    expect(startAction.location).toEqual({ lat: 59.3293, lng: 18.0686 });

    const firstJob = a.actions[1];
    expect(firstJob.type).toBe("job");
    expect(firstJob.jobIndex).toBe(0);
    expect(firstJob.jobId).toBe("job-0");
    expect(firstJob.startTimeSeconds).toBe(600);
    expect(firstJob.durationSeconds).toBe(900);
    expect(firstJob.location).toEqual({ lat: 59.33, lng: 18.071 });

    const breakAction = a.actions[2];
    expect(breakAction.type).toBe("break");
    expect(breakAction.location).toBeUndefined();

    expect(a.geometry).toEqual(recordedGeoapifyResponse.features[0].geometry);

    const b = result.agentPlans[1];
    expect(b.agentIndex).toBe(1);
    expect(b.actions.filter((x) => x.type === "job").map((x) => x.jobId)).toEqual(["job-3"]);
  });

  it("produces a stable snapshot (guards against accidental DTO drift)", () => {
    const result = mapGeoapifyVRPToDTO({ ok: true, data: recordedGeoapifyResponse });
    expect(result).toMatchSnapshot();
  });

  it("handles missing properties / features gracefully", () => {
    const result = mapGeoapifyVRPToDTO({
      ok: true,
      data: { type: "FeatureCollection", properties: {}, features: [] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agentPlans).toEqual([]);
    expect(result.unassignedJobIndices).toEqual([]);
    expect(result.unassignedAgentIndices).toEqual([]);
  });

  it("propagates error responses unchanged", () => {
    const result = mapGeoapifyVRPToDTO({ ok: false, status: 503, error: "upstream down" });
    expect(result).toEqual({ ok: false, status: 503, error: "upstream down" });
  });

  it("omits location when waypoint_index is missing or out of range", () => {
    const result = mapGeoapifyVRPToDTO({
      ok: true,
      data: {
        type: "FeatureCollection",
        properties: {},
        features: [
          {
            type: "Feature",
            properties: {
              agent_index: 0,
              distance: 0,
              time: 0,
              actions: [
                { type: "job", job_index: 0, job_id: "j0" },
                { type: "job", job_index: 1, job_id: "j1", waypoint_index: 99 },
              ],
              waypoints: [],
            },
            geometry: null,
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agentPlans[0].actions[0].location).toBeUndefined();
    expect(result.agentPlans[0].actions[1].location).toBeUndefined();
  });
});
