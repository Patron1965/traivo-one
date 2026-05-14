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
import { optimizeRoutesVRP } from "../server/route-optimizer";
import {
  _setMapProviderForTests,
  type MapProvider,
  type ProviderVRPRequest,
  type ProviderVRPResult,
  type ProviderVRPAction,
  type ProviderVRPAgentPlan,
  type ProviderRouteFetchResult,
} from "../server/services/mapProvider";
import type { MapTileConfig } from "../server/services/routing";
import type { WorkOrder, Resource, ServiceObject, Cluster } from "../shared/schema";

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

// =============================================================================
// Task #493 — end-to-end VRP-pipeline benchmark
//
// Driver hela `optimizeRoutesVRP` med en deterministisk mock-MapProvider
// (fast latency per kluster-anrop, inga riktiga Geoapify/OSRM/HTTP-anrop).
// Kör samma scenario två gånger: en gång med VRP_PARALLEL_CLUSTERS=true
// (default, p-limit fanout) och en gång med =false (seriell loop).
// Wall-time loggas och skrivs till `vrpEndToEnd`-sektionen i output-JSON.
// =============================================================================

interface VrpEndToEndScenario {
  numOrders: number;
  numResources: number;
  perClusterLatencyMs: number;
}

interface VrpEndToEndRunResult {
  mode: "parallel" | "serial";
  wallTimeMs: number;
  routes: number;
  assignedOrders: number;
  unassignedOrders: number;
  clustersInvoked: number;
}

interface VrpEndToEndResult {
  scenario: VrpEndToEndScenario;
  parallel: VrpEndToEndRunResult;
  serial: VrpEndToEndRunResult;
  speedup: number;
}

function buildMockProvider(perCallLatencyMs: number, counter: { calls: number }): MapProvider {
  const tileConfig: MapTileConfig = {
    tileUrl: "https://example.invalid/{z}/{x}/{y}.png",
    attribution: "mock",
    maxZoom: 19,
  };
  const routeFetchErr: ProviderRouteFetchResult = {
    ok: false,
    status: 0,
    error: "mock provider — routeWithStatus inte implementerad",
  };

  return {
    name: "geoapify",
    isRoutingAvailable: () => true,
    isGeocodingAvailable: () => false,
    async routeSummary() { return null; },
    async routeGeometry() { return null; },
    async routeWithStatus() { return routeFetchErr; },
    async routeMatrix() { return []; },
    async routePair() { return null; },
    async routeMatrixSquare() { return null; },
    async geocode() { return null; },
    async reverseGeocode() { return null; },
    async autocomplete() { return []; },
    async searchDestinations() { return null; },
    async batchGeocode() { return new Map(); },
    getTileConfig() { return tileConfig; },
    async optimizeRoutes(req: ProviderVRPRequest): Promise<ProviderVRPResult> {
      counter.calls++;
      // Modellera Geoapify Route Planner-latency.
      await new Promise((resolve) => setTimeout(resolve, perCallLatencyMs));

      const jobs = (req.jobs as Array<{
        id?: string;
        location: [number, number];
        duration?: number;
      }>) ?? [];
      const agents = (req.agents as Array<{
        start_location?: [number, number];
      }>) ?? [];

      if (agents.length === 0 || jobs.length === 0) {
        return { ok: true, agentPlans: [], unassignedJobIndices: [], unassignedAgentIndices: [] };
      }

      // Deterministiskt: round-robin-fördela jobben över agents, behåll input-ordning.
      const perAgent: number[][] = agents.map(() => []);
      jobs.forEach((_, i) => perAgent[i % agents.length].push(i));

      const agentPlans: ProviderVRPAgentPlan[] = agents.map((agent, idx) => {
        const jobIndices = perAgent[idx];
        const start = agent.start_location ?? [20.263, 63.826];
        let t = 8 * 3600;
        const actions: ProviderVRPAction[] = [
          { type: "start", startTimeSeconds: t, location: { lat: start[1], lng: start[0] } },
        ];
        let dist = 0;
        let prevLoc = { lat: start[1], lng: start[0] };
        for (const ji of jobIndices) {
          const job = jobs[ji];
          const loc = { lat: job.location[1], lng: job.location[0] };
          const dur = job.duration ?? 1800;
          actions.push({
            type: "job",
            startTimeSeconds: t,
            durationSeconds: dur,
            jobIndex: ji,
            jobId: job.id,
            location: loc,
          });
          // Rough Haversine i meter — bara för deterministisk distansrapportering.
          const R = 6371000;
          const dLat = (loc.lat - prevLoc.lat) * Math.PI / 180;
          const dLng = (loc.lng - prevLoc.lng) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(prevLoc.lat * Math.PI / 180) * Math.cos(loc.lat * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
          dist += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          prevLoc = loc;
          t += dur;
        }
        actions.push({ type: "end", startTimeSeconds: t, location: prevLoc });
        return {
          agentIndex: idx,
          distanceMeters: Math.round(dist),
          durationSeconds: t - 8 * 3600,
          actions,
        };
      });

      return { ok: true, agentPlans, unassignedJobIndices: [], unassignedAgentIndices: [] };
    },
  };
}

// Typed fixture-builders. Sätter alla notNull-fält explicit så att returvärdet
// är ett komplett `WorkOrder`/`Resource`/`ServiceObject` utan att vi behöver
// `as unknown as`-kast i benchmark-scenariot.

const BENCH_TENANT_ID = "bench-tenant";
const BENCH_CUSTOMER_ID = "bench-customer";

function makeBenchWorkOrder(overrides: Partial<WorkOrder> & Pick<WorkOrder, "id" | "title">): WorkOrder {
  const base: WorkOrder = {
    id: overrides.id,
    tenantId: BENCH_TENANT_ID,
    customerId: BENCH_CUSTOMER_ID,
    objectId: null,
    taskCategory: "field",
    clusterId: null,
    resourceId: null,
    teamId: null,
    title: overrides.title,
    description: null,
    orderType: "service",
    priority: "normal",
    status: "draft",
    orderStatus: "skapad",
    scheduledDate: null,
    scheduledStartTime: null,
    desiredDeliveryStart: null,
    desiredDeliveryEnd: null,
    plannedWindowStart: null,
    plannedWindowEnd: null,
    estimatedDuration: 30,
    actualDuration: null,
    setupTime: null,
    setupReason: null,
    lockedAt: null,
    completedAt: null,
    invoicedAt: null,
    cachedValue: 0,
    cachedCost: 0,
    cachedProductionMinutes: 0,
    isSimulated: false,
    simulationScenarioId: null,
    impossibleReason: null,
    impossibleReasonText: null,
    impossibleAt: null,
    impossibleBy: null,
    impossiblePhotoUrl: null,
    executionStatus: "not_planned",
    creationMethod: "manual",
    structuralArticleId: null,
    taskLatitude: null,
    taskLongitude: null,
    executionCode: null,
    externalReference: null,
    onWayAt: null,
    onSiteAt: null,
    inspectedAt: null,
    plannedBy: null,
    plannedNotes: null,
    notes: null,
    metadata: {},
    outsidePreferredWindow: false,
    deliveryPreferencePriority: null,
    importBatchId: null,
    etaSmsSent: false,
    parentWorkOrderId: null,
    frozenUnit: null,
    frozenQuantity: null,
    frozenUnitPrice: null,
    frozenUnitCost: null,
    frozenUnitTime: null,
    frozenAt: null,
    metadataSnapshot: null,
    createdAt: new Date(0),
    deletedAt: null,
  };
  return { ...base, ...overrides };
}

function makeBenchObject(overrides: Partial<ServiceObject> & Pick<ServiceObject, "id" | "name">): ServiceObject {
  const base: ServiceObject = {
    id: overrides.id,
    tenantId: BENCH_TENANT_ID,
    customerId: BENCH_CUSTOMER_ID,
    clusterId: null,
    parentId: null,
    name: overrides.name,
    objectNumber: null,
    objectType: "omrade",
    hierarchyLevel: "fastighet",
    objectLevel: 1,
    address: null,
    city: null,
    postalCode: null,
    latitude: null,
    longitude: null,
    entranceLatitude: null,
    entranceLongitude: null,
    addressDescriptor: null,
    accessType: "open",
    accessCode: null,
    keyNumber: null,
    accessInfo: {},
    accessCodeInherited: false,
    keyNumberInherited: false,
    accessInfoInherited: false,
    preferredTime1: null,
    preferredTime2: null,
    preferredTimeInherited: false,
    containerCount: 0,
    containerCountK2: 0,
    containerCountK3: 0,
    containerCountK4: 0,
    servicePeriods: {},
    avgSetupTime: 0,
    serialNumber: null,
    articleId: null,
    manufacturer: null,
    purchaseDate: null,
    warrantyExpiry: null,
    lastInspection: null,
    condition: "good",
    resolvedAccessCode: null,
    resolvedKeyNumber: null,
    resolvedAccessInfo: {},
    resolvedPreferredTime1: null,
    resolvedPreferredTime2: null,
    hierarchyDepth: 0,
    hierarchyPath: [],
    isInterimObject: false,
    polylineData: null,
    status: "active",
    notes: null,
    deliveryPreferences: null,
    lastServiceDate: null,
    importBatchId: null,
    createdAt: new Date(0),
    deletedAt: null,
  };
  return { ...base, ...overrides };
}

function makeBenchResource(overrides: Partial<Resource> & Pick<Resource, "id" | "name">): Resource {
  const base: Resource = {
    id: overrides.id,
    tenantId: BENCH_TENANT_ID,
    userId: null,
    name: overrides.name,
    initials: null,
    resourceType: "person",
    phone: null,
    email: null,
    pin: null,
    homeLocation: null,
    homeLatitude: null,
    homeLongitude: null,
    currentLatitude: null,
    currentLongitude: null,
    lastPositionUpdate: null,
    trackingStatus: "offline",
    weeklyHours: 40,
    competencies: [],
    executionCodes: [],
    availability: {},
    serviceArea: [],
    efficiencyFactor: 1.0,
    drivingFactor: 1.0,
    costCenter: null,
    projectCode: null,
    isOnline: false,
    lastSeenAt: null,
    status: "active",
    smsOnScheduleSend: true,
    smsOnExtraJob: true,
    lastSchedulePublishedAt: null,
    lastSchedulePeriodStart: null,
    lastSchedulePeriodEnd: null,
    createdAt: new Date(0),
    deletedAt: null,
  };
  return { ...base, ...overrides };
}

function buildVrpScenario(numOrders: number, numResources: number) {
  const rand = seededRandom(7);
  // Sprid stop över fyra svenska centra så DBSCAN delar upp i flera kluster.
  const centers = [
    { lat: 59.33, lng: 18.07 },
    { lat: 57.71, lng: 11.97 },
    { lat: 63.82, lng: 20.26 },
    { lat: 55.60, lng: 13.00 },
  ];

  const objects: ServiceObject[] = [];
  const workOrders: WorkOrder[] = [];
  for (let i = 0; i < numOrders; i++) {
    const c = centers[i % centers.length];
    const lat = c.lat + (rand() - 0.5) * 0.15;
    const lng = c.lng + (rand() - 0.5) * 0.3;
    const objectId = `obj-${i}`;
    objects.push(makeBenchObject({ id: objectId, name: `Objekt ${i}`, latitude: lat, longitude: lng }));
    workOrders.push(makeBenchWorkOrder({ id: `wo-${i}`, title: `Order ${i}`, objectId }));
  }

  const resources: Resource[] = [];
  for (let i = 0; i < numResources; i++) {
    const c = centers[i % centers.length];
    resources.push(makeBenchResource({ id: `res-${i}`, name: `Resurs ${i}`, homeLatitude: c.lat, homeLongitude: c.lng }));
  }

  const clusters: Cluster[] = [];
  return { workOrders, resources, objects, clusters };
}

async function runVrpEndToEndOnce(
  scenario: VrpEndToEndScenario,
  mode: "parallel" | "serial",
): Promise<VrpEndToEndRunResult> {
  const { workOrders, resources, objects, clusters } = buildVrpScenario(
    scenario.numOrders,
    scenario.numResources,
  );

  const counter = { calls: 0 };
  const provider = buildMockProvider(scenario.perClusterLatencyMs, counter);
  _setMapProviderForTests(provider);

  process.env.VRP_PARALLEL_CLUSTERS = mode === "parallel" ? "true" : "false";
  process.env.VRP_PARALLEL_CONCURRENCY = process.env.VRP_PARALLEL_CONCURRENCY || "4";

  try {
    const t0 = Date.now();
    const result = await optimizeRoutesVRP(workOrders, resources, objects, clusters);
    const wallTimeMs = Date.now() - t0;

    return {
      mode,
      wallTimeMs,
      routes: result.routes.length,
      assignedOrders: result.summary.assignedOrders,
      unassignedOrders: result.unassignedOrders.length,
      clustersInvoked: counter.calls,
    };
  } finally {
    _setMapProviderForTests(null);
  }
}

async function benchVrpEndToEnd(scenario: VrpEndToEndScenario): Promise<VrpEndToEndResult> {
  console.log(
    `  VRP end-to-end ${scenario.numOrders} orders / ${scenario.numResources} resurser / ${scenario.perClusterLatencyMs} ms per kluster-anrop`,
  );

  const parallel = await runVrpEndToEndOnce(scenario, "parallel");
  console.log(
    `    parallel  → ${fmt(parallel.wallTimeMs)} (${parallel.clustersInvoked} kluster, ${parallel.assignedOrders}/${scenario.numOrders} tilldelade, ${parallel.routes} rutter)`,
  );

  const serial = await runVrpEndToEndOnce(scenario, "serial");
  console.log(
    `    serial    → ${fmt(serial.wallTimeMs)} (${serial.clustersInvoked} kluster, ${serial.assignedOrders}/${scenario.numOrders} tilldelade, ${serial.routes} rutter)`,
  );

  const speedup = serial.wallTimeMs / Math.max(parallel.wallTimeMs, 1);
  console.log(`    speedup   → ${speedup.toFixed(2)}×`);

  return { scenario, parallel, serial, speedup };
}

async function main() {
  console.log("=== Task #490/#493 benchmark ===\n");
  console.log("DBSCAN clustering (grid spatial index vs full O(N²) matrix):");
  const dbscanResults = await benchDbscan([100, 250, 500, 1000, 2000]);

  console.log("\nSimulerad cluster-VRP-fanout (Geoapify-latency-modell):");
  const vrpResults: VrpFanoutResult[] = [];
  vrpResults.push(await benchVrpFanout(4, 1500, 4));
  vrpResults.push(await benchVrpFanout(6, 1500, 4));
  vrpResults.push(await benchVrpFanout(10, 1500, 4));

  console.log("\nVRP end-to-end pipeline (mock-provider, parallel vs serial):");
  const vrpEndToEnd: VrpEndToEndResult[] = [];
  // 50-order baseline (under DBSCAN-tröskeln 50 → enkel batch).
  vrpEndToEnd.push(await benchVrpEndToEnd({ numOrders: 50, numResources: 4, perClusterLatencyMs: 200 }));
  // 200-order huvudscenario — målet "200-order 2× snabbare".
  vrpEndToEnd.push(await benchVrpEndToEnd({ numOrders: 200, numResources: 8, perClusterLatencyMs: 200 }));
  // 200-order med högre latency (närmare verklig Geoapify-RTT).
  vrpEndToEnd.push(await benchVrpEndToEnd({ numOrders: 200, numResources: 8, perClusterLatencyMs: 500 }));

  const summary = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    dbscan: dbscanResults,
    vrpFanout: vrpResults,
    vrpEndToEnd,
  };

  const outDir = path.join(process.cwd(), "docs");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "benchmark-route-optimizer.json");
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nSammanfattning skriven till ${outPath}`);
}

main()
  .then(() => {
    // Importerade server-moduler (t.ex. `distance-matrix-service` med
    // schemalagd L2-cache-cleanup) registrerar långlivade `setInterval`-
    // handles som annars håller event-loopen vid liv tills CI-jobbet
    // timeout-failar. Vi har redan skrivit JSON-output, så avsluta rent.
    process.exit(0);
  })
  .catch((err) => {
    console.error("Benchmark misslyckades:", err);
    process.exit(1);
  });
