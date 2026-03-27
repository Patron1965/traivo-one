import { describe, it, expect } from "vitest";
import {
  enrichVRPRequestWithConstraints,
  type EnrichedGeoapifyJob,
  type EnrichedGeoapifyAgent,
  type VRPConstraintOptions,
} from "../../server/vrp-constraints";

describe("VRP Constraint Enrichment", () => {
  const mockJobs: EnrichedGeoapifyJob[] = [
    {
      location: [20.263, 63.826],
      duration: 1800,
      priority: 50,
      id: "wo-1",
      description: "Test Order 1",
    },
    {
      location: [20.300, 63.850],
      duration: 3600,
      priority: 75,
      id: "wo-2",
      description: "Test Order 2",
    },
  ];

  const mockAgents: EnrichedGeoapifyAgent[] = [
    {
      start_location: [20.263, 63.826],
      end_location: [20.263, 63.826],
      time_windows: [[28800, 61200]],
      id: "res-tomas",
      description: "Tomas",
    },
  ];

  it("returns valid result with all constraints disabled", async () => {
    const options: VRPConstraintOptions = {
      respectTimeWindows: false,
      respectSkills: false,
      respectCapacity: false,
      respectDependencies: false,
      tenantId: "default-tenant",
    };

    const result = await enrichVRPRequestWithConstraints(
      [...mockJobs.map(j => ({ ...j }))],
      [...mockAgents.map(a => ({ ...a }))],
      [],
      [],
      [],
      options,
    );

    expect(result).toBeDefined();
    expect(result.jobs).toHaveLength(2);
    expect(result.agents).toHaveLength(1);
    expect(result.constraintsApplied).toHaveLength(0);
    expect(result.preFilteredPairs).toBe(0);
    expect(result.dependencySequences).toHaveLength(0);
  });

  it("returns valid result with all constraints enabled", async () => {
    const options: VRPConstraintOptions = {
      respectTimeWindows: true,
      respectSkills: true,
      respectCapacity: true,
      respectDependencies: true,
      tenantId: "default-tenant",
    };

    const result = await enrichVRPRequestWithConstraints(
      [...mockJobs.map(j => ({ ...j }))],
      [...mockAgents.map(a => ({ ...a }))],
      [],
      [],
      [],
      options,
    );

    expect(result).toBeDefined();
    expect(result.jobs).toHaveLength(2);
    expect(result.agents).toHaveLength(1);
    expect(Array.isArray(result.constraintsApplied)).toBe(true);
  });

  it("jobs retain original properties after enrichment", async () => {
    const options: VRPConstraintOptions = {
      respectTimeWindows: false,
      respectSkills: false,
      respectCapacity: false,
      respectDependencies: false,
      tenantId: "default-tenant",
    };

    const result = await enrichVRPRequestWithConstraints(
      [...mockJobs.map(j => ({ ...j }))],
      [...mockAgents.map(a => ({ ...a }))],
      [],
      [],
      [],
      options,
    );

    expect(result.jobs[0].id).toBe("wo-1");
    expect(result.jobs[0].duration).toBe(1800);
    expect(result.jobs[0].priority).toBe(50);
    expect(result.jobs[0].location).toEqual([20.263, 63.826]);

    expect(result.jobs[1].id).toBe("wo-2");
    expect(result.jobs[1].duration).toBe(3600);
    expect(result.jobs[1].priority).toBe(75);
  });

  it("agents retain original properties after enrichment", async () => {
    const options: VRPConstraintOptions = {
      respectTimeWindows: false,
      respectSkills: false,
      respectCapacity: false,
      respectDependencies: false,
      tenantId: "default-tenant",
    };

    const result = await enrichVRPRequestWithConstraints(
      [...mockJobs.map(j => ({ ...j }))],
      [...mockAgents.map(a => ({ ...a }))],
      [],
      [],
      [],
      options,
    );

    expect(result.agents[0].id).toBe("res-tomas");
    expect(result.agents[0].start_location).toEqual([20.263, 63.826]);
    expect(result.agents[0].time_windows).toEqual([[28800, 61200]]);
  });

  it("does not assign all skills to uncoded resources", async () => {
    const options: VRPConstraintOptions = {
      respectTimeWindows: false,
      respectSkills: true,
      respectCapacity: false,
      respectDependencies: false,
      tenantId: "default-tenant",
    };

    const jobsWithSkill: EnrichedGeoapifyJob[] = [
      { location: [20.263, 63.826], duration: 1800, priority: 50, id: "wo-skill-1" },
    ];
    const agentsNoCode: EnrichedGeoapifyAgent[] = [
      { start_location: [20.263, 63.826], time_windows: [[28800, 61200]], id: "res-nocodes" },
    ];
    const workOrders = [
      { id: "wo-skill-1", executionCode: "RENGORING", objectId: "obj-1" },
    ] as never[];
    const resources = [
      { id: "res-nocodes", executionCodes: [] },
    ] as never[];

    const result = await enrichVRPRequestWithConstraints(
      jobsWithSkill, agentsNoCode, workOrders, resources, [], options,
    );

    const agent = result.agents[0];
    expect(agent.skills).toBeUndefined();
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
      if (data.constraintsApplied) {
        expect(Array.isArray(data.constraintsApplied)).toBe(true);
      }
    }
  });

  it("POST /api/ai/optimize-vrp — works without constraints (backward compatible)", async () => {
    const res = await fetch(`${BASE}/api/ai/optimize-vrp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-03-27",
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
});
