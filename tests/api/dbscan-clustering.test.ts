import { describe, it, expect } from "vitest";

// Task #490 — regressionstester för DBSCAN-grid-optimeringen.
// Garanterar att grid-spatial-index ger bit-identiska kluster jämfört med
// O(N²)-matrisversionen på syntetiska indata, så att backout-flaggan
// `DBSCAN_USE_KDTREE=false` aldrig ändrar planerings-output.

import { dbscanCluster, type TemporalStop } from "../../server/dbscan-clustering";

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function generateStops(n: number, seed: number): TemporalStop[] {
  const rand = seededRandom(seed);
  const stops: TemporalStop[] = [];
  // Tre tydliga geografiska kluster runt Stockholm/Göteborg/Umeå + lite spridning.
  const centers = [
    { lat: 59.33, lng: 18.07 },
    { lat: 57.71, lng: 11.97 },
    { lat: 63.82, lng: 20.26 },
  ];
  for (let i = 0; i < n; i++) {
    const c = centers[i % centers.length];
    stops.push({
      id: `s${i}`,
      lat: c.lat + (rand() - 0.5) * 0.1,
      lng: c.lng + (rand() - 0.5) * 0.2,
    });
  }
  return stops;
}

function clusterSignature(stops: TemporalStop[]): { mode: string; result: ReturnType<typeof dbscanCluster> } {
  return { mode: process.env.DBSCAN_USE_KDTREE ?? "(unset)", result: dbscanCluster(stops) };
}

function normalize(result: ReturnType<typeof dbscanCluster>) {
  // Ordna kluster efter (sorterade medlems-IDn) så jämförelser blir
  // oberoende av iterationsordning över Map<>.
  const clusters = result.clusters
    .map(c => ({ stops: c.stops.map(s => s.id).sort() }))
    .map(c => ({ key: c.stops.join(","), stops: c.stops }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(c => c.stops);
  const noise = result.noise.map(s => s.id).sort();
  return { clusters, noise };
}

describe("dbscanCluster — grid vs matrix equivalens", () => {
  it("ger identiska kluster för 100 punkter", () => {
    const stops = generateStops(100, 42);
    process.env.DBSCAN_USE_KDTREE = "true";
    const grid = clusterSignature(stops).result;
    process.env.DBSCAN_USE_KDTREE = "false";
    const matrix = clusterSignature(stops).result;
    expect(normalize(grid)).toEqual(normalize(matrix));
  });

  it("ger identiska kluster för 500 punkter", () => {
    const stops = generateStops(500, 7);
    process.env.DBSCAN_USE_KDTREE = "true";
    const grid = clusterSignature(stops).result;
    process.env.DBSCAN_USE_KDTREE = "false";
    const matrix = clusterSignature(stops).result;
    expect(normalize(grid)).toEqual(normalize(matrix));
  });

  it("hanterar tomt indata + minSamples-undantaget", () => {
    process.env.DBSCAN_USE_KDTREE = "true";
    expect(dbscanCluster([]).clusters).toEqual([]);
    const tiny = dbscanCluster(generateStops(2, 1));
    expect(tiny.clusters).toHaveLength(1);
    expect(tiny.clusters[0].stops).toHaveLength(2);
  });

  it("DBSCAN på 1000 punkter klarar < 500 ms (grid-mode)", () => {
    process.env.DBSCAN_USE_KDTREE = "true";
    const stops = generateStops(1000, 3);
    const t0 = Date.now();
    const result = dbscanCluster(stops);
    const elapsed = Date.now() - t0;
    expect(result.clusters.length).toBeGreaterThan(0);
    // Generös budget — på CI-runner med varm cache ska det vara väl under 500 ms.
    // Failar bara om vi får verklig regression till O(N²).
    expect(elapsed).toBeLessThan(500);
  });
});
