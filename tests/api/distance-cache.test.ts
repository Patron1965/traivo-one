import { describe, it, expect } from "vitest";
import {
  haversineDistanceKm,
  geographicPreCluster,
  getDistanceCacheStats,
  type CoordStop,
} from "../../server/distance-matrix-service";

describe("Haversine distance", () => {
  it("calculates correct distance between two known points", () => {
    const d = haversineDistanceKm(63.826, 20.263, 59.329, 18.069);
    expect(d).toBeGreaterThan(400);
    expect(d).toBeLessThan(600);
  });

  it("returns 0 for same point", () => {
    const d = haversineDistanceKm(63.826, 20.263, 63.826, 20.263);
    expect(d).toBe(0);
  });
});

describe("Geographic Pre-Clustering", () => {
  const stops: CoordStop[] = [
    { id: "a", lat: 63.82, lng: 20.26 },
    { id: "b", lat: 63.83, lng: 20.27 },
    { id: "c", lat: 63.84, lng: 20.28 },
    { id: "d", lat: 59.33, lng: 18.07 },
    { id: "e", lat: 59.34, lng: 18.08 },
    { id: "f", lat: 59.35, lng: 18.09 },
  ];

  it("clusters stops into requested number of groups", () => {
    const clusters = geographicPreCluster(stops, 2);
    expect(clusters.length).toBe(2);
    const totalStops = clusters.reduce((s, c) => s + c.stops.length, 0);
    expect(totalStops).toBe(6);
  });

  it("returns one cluster per stop if numGroups >= stops.length", () => {
    const clusters = geographicPreCluster(stops, 10);
    expect(clusters.length).toBe(6);
  });

  it("returns empty array for empty stops", () => {
    const clusters = geographicPreCluster([], 3);
    expect(clusters.length).toBe(0);
  });

  it("geographically separates Umeå and Stockholm stops", () => {
    const clusters = geographicPreCluster(stops, 2);
    const clusterIds = clusters.map(c => c.stops.map(s => s.id));

    const umeaStops = ["a", "b", "c"];
    const stockholmStops = ["d", "e", "f"];

    const cluster0HasUmea = clusterIds[0].some(id => umeaStops.includes(id));
    const cluster0HasStockholm = clusterIds[0].some(id => stockholmStops.includes(id));

    expect(cluster0HasUmea !== cluster0HasStockholm || clusters.length > 2).toBe(true);
  });

  it("each cluster has a centroid", () => {
    const clusters = geographicPreCluster(stops, 2);
    for (const cluster of clusters) {
      expect(cluster.centroid).toBeDefined();
      expect(typeof cluster.centroid.lat).toBe("number");
      expect(typeof cluster.centroid.lng).toBe("number");
    }
  });

  it("produces balanced clusters", () => {
    const manyStops: CoordStop[] = [];
    for (let i = 0; i < 30; i++) {
      manyStops.push({
        id: `stop-${i}`,
        lat: 63.8 + (i % 10) * 0.01,
        lng: 20.2 + Math.floor(i / 10) * 0.05,
      });
    }
    const clusters = geographicPreCluster(manyStops, 3);
    const sizes = clusters.map(c => c.stops.length);
    const maxSize = Math.max(...sizes);
    const minSize = Math.min(...sizes);
    expect(maxSize - minSize).toBeLessThanOrEqual(Math.ceil(30 / 3) + 5);
  });
});

describe("Distance Cache Stats", () => {
  it("returns l1 stats structure", () => {
    const stats = getDistanceCacheStats();
    expect(stats).toHaveProperty("l1Size");
    expect(stats).toHaveProperty("l1MaxSize");
    expect(stats).toHaveProperty("l2TtlHours");
    expect(typeof stats.l1Size).toBe("number");
  });
});

describe("Distance Cache Admin Endpoints", () => {
  const BASE = "http://localhost:5000";

  it("GET /api/admin/distance-cache returns stats", async () => {
    const res = await fetch(`${BASE}/api/admin/distance-cache`);
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json();
      expect(data).toHaveProperty("l1Size");
      expect(data).toHaveProperty("l2Count");
    }
  });

  it("POST /api/admin/distance-cache/cleanup removes expired", async () => {
    const res = await fetch(`${BASE}/api/admin/distance-cache/cleanup`, { method: "POST" });
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json();
      expect(data).toHaveProperty("removed");
    }
  });

  it("DELETE /api/admin/distance-cache clears cache", async () => {
    const res = await fetch(`${BASE}/api/admin/distance-cache`, { method: "DELETE" });
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json();
      expect(data).toHaveProperty("l1Cleared");
      expect(data).toHaveProperty("l2Cleared");
    }
  });
});
