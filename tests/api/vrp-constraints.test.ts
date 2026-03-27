import { describe, it, expect } from "vitest";
import {
  enrichVRPRequestWithConstraints,
  type EnrichedGeoapifyJob,
  type EnrichedGeoapifyAgent,
  type VRPConstraintOptions,
} from "../../server/vrp-constraints";

function makeJob(id: string, duration = 1800, priority = 50): EnrichedGeoapifyJob {
  return {
    location: [20.263, 63.826],
    duration,
    priority,
    id,
    description: `Job ${id}`,
  };
}

function makeAgent(id: string): EnrichedGeoapifyAgent {
  return {
    start_location: [20.263, 63.826],
    end_location: [20.263, 63.826],
    time_windows: [[28800, 61200]],
    id,
    description: `Agent ${id}`,
  };
}

const allDisabled: VRPConstraintOptions = {
  respectTimeWindows: false,
  respectSkills: false,
  respectCapacity: false,
  respectDependencies: false,
  tenantId: "default-tenant",
};

const allEnabled: VRPConstraintOptions = {
  respectTimeWindows: true,
  respectSkills: true,
  respectCapacity: true,
  respectDependencies: true,
  tenantId: "default-tenant",
};

describe("VRP Constraint Enrichment — Basic", () => {
  it("returns valid result with all constraints disabled", async () => {
    const result = await enrichVRPRequestWithConstraints(
      [makeJob("wo-1"), makeJob("wo-2")],
      [makeAgent("res-1")],
      [], [], [],
      allDisabled,
    );

    expect(result.jobs).toHaveLength(2);
    expect(result.agents).toHaveLength(1);
    expect(result.constraintsApplied).toHaveLength(0);
    expect(result.preFilteredPairs).toBe(0);
    expect(result.dependencySequences).toHaveLength(0);
  });

  it("returns valid result with all constraints enabled (no data)", async () => {
    const result = await enrichVRPRequestWithConstraints(
      [makeJob("wo-1"), makeJob("wo-2")],
      [makeAgent("res-1")],
      [], [], [],
      allEnabled,
    );

    expect(result.jobs).toHaveLength(2);
    expect(result.agents).toHaveLength(1);
    expect(result.constraintsApplied).toContain("time_windows");
  });

  it("preserves original job properties", async () => {
    const result = await enrichVRPRequestWithConstraints(
      [makeJob("wo-1", 1800, 50)],
      [makeAgent("res-1")],
      [], [], [],
      allDisabled,
    );

    expect(result.jobs[0].id).toBe("wo-1");
    expect(result.jobs[0].duration).toBe(1800);
    expect(result.jobs[0].priority).toBe(50);
    expect(result.jobs[0].location).toEqual([20.263, 63.826]);
  });

  it("preserves original agent properties", async () => {
    const result = await enrichVRPRequestWithConstraints(
      [makeJob("wo-1")],
      [makeAgent("res-1")],
      [], [], [],
      allDisabled,
    );

    expect(result.agents[0].id).toBe("res-1");
    expect(result.agents[0].start_location).toEqual([20.263, 63.826]);
    expect(result.agents[0].time_windows).toEqual([[28800, 61200]]);
  });
});

describe("VRP Constraint Enrichment — Skills", () => {
  it("does not assign all skills to uncoded resources", async () => {
    const options: VRPConstraintOptions = {
      ...allDisabled,
      respectSkills: true,
    };

    const result = await enrichVRPRequestWithConstraints(
      [makeJob("wo-1")],
      [makeAgent("res-nocodes")],
      [{ id: "wo-1", executionCode: "RENGORING", objectId: "obj-1" }] as never[],
      [{ id: "res-nocodes", executionCodes: [] }] as never[],
      [],
      options,
    );

    const agent = result.agents[0];
    expect(agent.skills).toBeUndefined();
    expect(result.jobs[0].required_skills).toBeDefined();
    expect(result.preFilteredPairs).toBeGreaterThan(0);
  });

  it("assigns correct skill indices to matching resources", async () => {
    const options: VRPConstraintOptions = {
      ...allDisabled,
      respectSkills: true,
    };

    const result = await enrichVRPRequestWithConstraints(
      [makeJob("wo-1")],
      [makeAgent("res-1")],
      [{ id: "wo-1", executionCode: "RENGORING", objectId: "obj-1" }] as never[],
      [{ id: "res-1", executionCodes: ["RENGORING"] }] as never[],
      [],
      options,
    );

    expect(result.jobs[0].required_skills).toEqual([0]);
    expect(result.agents[0].skills).toEqual([0]);
    expect(result.preFilteredPairs).toBe(0);
  });
});

describe("VRP Optimize Endpoint", () => {
  const BASE = "http://localhost:5000";

  it("POST /api/ai/optimize-vrp — accepts constraints parameter (returns 200 or 401)", async () => {
    const res = await fetch(`${BASE}/api/ai/optimize-vrp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-03-27",
        constraints: {
          respectTimeWindows: true,
          respectSkills: true,
          respectCapacity: true,
          respectDependencies: true,
        },
      }),
    });
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json();
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("routes");
      expect(data).toHaveProperty("summary");
    }
  });

  it("POST /api/ai/optimize-vrp — backward compatible without constraints", async () => {
    const res = await fetch(`${BASE}/api/ai/optimize-vrp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-03-27" }),
    });
    expect([200, 401]).toContain(res.status);
  });
});
