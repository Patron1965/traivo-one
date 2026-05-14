/**
 * Task #490 — benchmark för ruttoptimerings-pipelines.
 *
 * Mäter:
 *   1. DBSCAN clustering på N stopp (grid vs matrix).
 *   2. Simulerad cluster-VRP-fanout med parallell vs seriell körning, där
 *      `getMapProvider().optimizeRoutes` ersätts av en fixed-delay-stub som
 *      modellerar Geoapify-latency (~1500 ms per kluster).
 *
 * Kör: `npx tsx scripts/benchmark-route-optimizer.ts`
 *
 * Output skrivs till stdout och som JSON till `docs/benchmark-route-optimizer.json`.
 * Inga DB- eller externa anrop görs — säker att köra i CI eller lokalt utan
 * Geoapify-key.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { dbscanCluster, type TemporalStop } from "../server/dbscan-clustering";

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function generateStops(n: number, seed = 42): TemporalStop[] {
  const rand = seededRandom(seed);
  const centers = [
    { lat: 59.33, lng: 18.07 },
    { lat: 57.71, lng: 11.97 },
    { lat: 63.82, lng: 20.26 },
    { lat: 55.60, lng: 13.00 },
  ];
  const stops: TemporalStop[] = [];
  for (let i = 0; i < n; i++) {
    const c = centers[i % centers.length];
    stops.push({
      id: `s${i}`,
      lat: c.lat + (rand() - 0.5) * 0.15,
      lng: c.lng + (rand() - 0.5) * 0.3,
    });
  }
  return stops;
}

function fmt(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(1)} ms`;
}

interface DbscanResult {
  n: number;
  matrixMs: number;
  gridMs: number;
  speedup: number;
  clusters: number;
}

async function benchDbscan(sizes: number[]): Promise<DbscanResult[]> {
  const results: DbscanResult[] = [];
  for (const n of sizes) {
    const stops = generateStops(n);

    // Warm
    process.env.DBSCAN_USE_KDTREE = "true";
    dbscanCluster(stops);

    process.env.DBSCAN_USE_KDTREE = "false";
    const t0 = Date.now();
    const matrix = dbscanCluster(stops);
    const matrixMs = Date.now() - t0;

    process.env.DBSCAN_USE_KDTREE = "true";
    const t1 = Date.now();
    const grid = dbscanCluster(stops);
    const gridMs = Date.now() - t1;

    results.push({
      n,
      matrixMs,
      gridMs,
      speedup: matrixMs / Math.max(gridMs, 1),
      clusters: grid.clusters.length,
    });

    console.log(
      `  DBSCAN N=${n.toString().padStart(5)} → matrix ${fmt(matrixMs).padStart(8)}, grid ${fmt(gridMs).padStart(8)}, ${(matrixMs / Math.max(gridMs, 1)).toFixed(1)}× speedup, ${grid.clusters.length} kluster`,
    );
  }
  return results;
}

interface VrpFanoutResult {
  numClusters: number;
  perCallLatencyMs: number;
  serialMs: number;
  parallelMs: number;
  concurrency: number;
  speedup: number;
}

async function benchVrpFanout(numClusters: number, perCallLatencyMs: number, concurrency: number): Promise<VrpFanoutResult> {
  // Modell: varje "VRP-anrop" är en sleep med fast latency.
  const work = async () => {
    await new Promise((resolve) => setTimeout(resolve, perCallLatencyMs));
  };

  const t0 = Date.now();
  for (let i = 0; i < numClusters; i++) {
    await work();
  }
  const serialMs = Date.now() - t0;

  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(concurrency);
  const t1 = Date.now();
  await Promise.allSettled(Array.from({ length: numClusters }, () => limit(work)));
  const parallelMs = Date.now() - t1;

  const result: VrpFanoutResult = {
    numClusters,
    perCallLatencyMs,
    serialMs,
    parallelMs,
    concurrency,
    speedup: serialMs / Math.max(parallelMs, 1),
  };
  console.log(
    `  VRP-fanout ${numClusters} kluster × ${perCallLatencyMs} ms → serial ${fmt(serialMs)}, parallel(${concurrency}) ${fmt(parallelMs)}, ${result.speedup.toFixed(1)}× speedup`,
  );
  return result;
}

async function main() {
  console.log("=== Task #490 benchmark ===\n");
  console.log("DBSCAN clustering (grid spatial index vs full O(N²) matrix):");
  const dbscanResults = await benchDbscan([100, 250, 500, 1000, 2000]);

  console.log("\nSimulerad cluster-VRP-fanout (Geoapify-latency-modell):");
  const vrpResults: VrpFanoutResult[] = [];
  vrpResults.push(await benchVrpFanout(4, 1500, 4));
  vrpResults.push(await benchVrpFanout(6, 1500, 4));
  vrpResults.push(await benchVrpFanout(10, 1500, 4));

  const summary = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    dbscan: dbscanResults,
    vrpFanout: vrpResults,
  };

  const outDir = path.join(process.cwd(), "docs");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "benchmark-route-optimizer.json");
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nSammanfattning skriven till ${outPath}`);
}

main().catch((err) => {
  console.error("Benchmark misslyckades:", err);
  process.exit(1);
});
