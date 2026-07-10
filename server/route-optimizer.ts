import type { WorkOrder, Resource, ServiceObject } from "@shared/schema";
import { isStartTask } from "@shared/start-task";
import { resolveLocationRequirement } from "@shared/location-requirement";
import { getBatchDistances } from "./distance-matrix-service";
import type { VRPConstraintOptions } from "./vrp-constraints";
import { getMapProvider } from "./services/mapProvider";
import { resolveObjectLocation, objectIsRoutable, isUsableCoord } from "./services/object-location";

export interface RouteStop {
  workOrderId: string;
  objectId: string;
  objectName: string;
  latitude: number;
  longitude: number;
  estimatedDuration: number;
  priority: string;
}

export interface OptimizedRoute {
  resourceId: string;
  resourceName: string;
  date: string;
  stops: RouteStop[];
  totalDriveTime: number; // minuter
  totalWorkTime: number; // minuter
  totalDistance: number; // km
  optimizationScore: number; // 0-100
  originalOrder: string[];
  optimizedOrder: string[];
  // Nya fält för besparingsvisning
  originalDriveTime: number; // minuter före optimering
  originalDistance: number; // km före optimering
  timeSaved: number; // minuter sparade
  distanceSaved: number; // km sparade
  estimatedFuelSaved: number; // liter bränsle sparade (ca 0.08 l/km)
  estimatedCostSaved: number; // SEK sparade (bränsle + tid)
}

export interface DayRouteOptimization {
  date: string;
  routes: OptimizedRoute[];
  totalSavings: number; // minuter sparade
  totalDistanceSaved: number; // km sparade
  totalFuelSaved: number; // liter sparade
  totalCostSaved: number; // SEK sparade
  summary: string;
}

interface Coordinates {
  lat: number;
  lng: number;
}

function getCoordinates(obj: ServiceObject): Coordinates | null {
  // Task #990: ruttbar koordinat via central platsupplösning (pinpoint + giltig
  // huvudkoordinat). Område/ingen-geo ger null.
  const loc = resolveObjectLocation(obj);
  if (loc.routable && loc.latitude != null && loc.longitude != null) {
    return { lat: loc.latitude, lng: loc.longitude };
  }
  return null;
}

function getNavigationCoordinates(obj: ServiceObject): Coordinates | null {
  // Område/ingen-geo navigeras aldrig.
  if (!objectIsRoutable(obj)) return null;
  // Navigering föredrar entré-koordinat när den finns, annars huvudkoordinat.
  if (isUsableCoord((obj as any).entranceLatitude, (obj as any).entranceLongitude)) {
    return { lat: (obj as any).entranceLatitude, lng: (obj as any).entranceLongitude };
  }
  return getCoordinates(obj);
}

function haversineDistance(coord1: Coordinates, coord2: Coordinates): number {
  const R = 6371;
  const dLat = (coord2.lat - coord1.lat) * Math.PI / 180;
  const dLng = (coord2.lng - coord1.lng) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(coord1.lat * Math.PI / 180) * Math.cos(coord2.lat * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function nearestNeighborOptimization(stops: RouteStop[], startCoord?: Coordinates): RouteStop[] {
  if (stops.length <= 1) return stops;
  
  const remaining = [...stops];
  const result: RouteStop[] = [];
  
  let current: Coordinates = startCoord || { lat: remaining[0].latitude, lng: remaining[0].longitude };
  
  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    
    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineDistance(current, { 
        lat: remaining[i].latitude, 
        lng: remaining[i].longitude 
      });
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    
    const nearest = remaining.splice(nearestIdx, 1)[0];
    result.push(nearest);
    current = { lat: nearest.latitude, lng: nearest.longitude };
  }
  
  return result;
}

function calculateTotalDistanceHaversine(stops: RouteStop[], startCoord?: Coordinates): number {
  if (stops.length === 0) return 0;
  
  let total = 0;
  let current = startCoord || { lat: stops[0].latitude, lng: stops[0].longitude };
  
  for (const stop of stops) {
    total += haversineDistance(current, { lat: stop.latitude, lng: stop.longitude });
    current = { lat: stop.latitude, lng: stop.longitude };
  }
  
  return total;
}

async function calculateTotalDistance(stops: RouteStop[], startCoord?: Coordinates): Promise<number> {
  if (stops.length === 0) return 0;

  try {
    const pairs: Array<{ id: string; fromLat: number; fromLng: number; toLat: number; toLng: number }> = [];
    let current = startCoord || { lat: stops[0].latitude, lng: stops[0].longitude };

    for (let i = 0; i < stops.length; i++) {
      pairs.push({
        id: `leg-${i}`,
        fromLat: current.lat,
        fromLng: current.lng,
        toLat: stops[i].latitude,
        toLng: stops[i].longitude,
      });
      current = { lat: stops[i].latitude, lng: stops[i].longitude };
    }

    const results = await getBatchDistances(pairs);
    let total = 0;
    for (let i = 0; i < stops.length; i++) {
      const r = results.get(`leg-${i}`);
      if (r) total += r.distanceKm;
      else total += haversineDistance(
        i === 0 ? (startCoord || { lat: stops[0].latitude, lng: stops[0].longitude }) : { lat: stops[i - 1].latitude, lng: stops[i - 1].longitude },
        { lat: stops[i].latitude, lng: stops[i].longitude }
      );
    }
    return total;
  } catch {
    return calculateTotalDistanceHaversine(stops, startCoord);
  }
}

// OBS: Tidigare lokal 1h-cache är borttagen — cachen ligger nu i
// `server/services/routing.ts` så att webb, mobil och optimering delar träffar
// (Task #457). `getRouteSummary` slår mot den delade cachen.
async function getRouteFromGeoapify(coordinates: [number, number][]): Promise<{
  distance: number;
  duration: number;
} | null> {
  const provider = getMapProvider();
  if (!provider.isRoutingAvailable() || coordinates.length < 2) {
    return null;
  }

  const summary = await provider.routeSummary(
    coordinates.map(([lng, lat]) => ({ lat, lng })),
  );
  if (!summary) return null;

  return { distance: summary.distanceKm, duration: summary.durationMinutes };
}

export async function optimizeResourceDayRoute(
  resourceId: string,
  resourceName: string,
  date: string,
  workOrders: WorkOrder[],
  objects: ServiceObject[],
  resource?: Resource
): Promise<OptimizedRoute | null> {
  const dayOrders = workOrders.filter(wo => {
    if (!wo.scheduledDate || wo.resourceId !== resourceId) return false;
    // §5 A / Task #381 — platskrav 'ingen' (admin/logistik) ingår aldrig i ruttoptimering eller dagsrutt.
    if (resolveLocationRequirement(wo) === "ingen") return false;
    if (!wo.objectId) return false;
    const orderDate = wo.scheduledDate instanceof Date 
      ? wo.scheduledDate.toISOString().split("T")[0]
      : String(wo.scheduledDate).split("T")[0];
    return orderDate === date;
  });
  
  if (dayOrders.length === 0) {
    return null;
  }
  
  const stops: RouteStop[] = [];
  const objectMap = new Map(objects.map(o => [o.id, o]));
  
  for (const order of dayOrders) {
    if (!order.objectId) continue;
    const obj = objectMap.get(order.objectId);
    // Task #990: hoppa över ej ruttbara objekt (område/ingen-geo/utan koordinat).
    if (!obj || !objectIsRoutable(obj)) continue;
    
    // objectIsRoutable garanterar giltig huvudkoordinat ⇒ navCoords är satt.
    const navCoords = getNavigationCoordinates(obj);
    if (!navCoords) continue;
    stops.push({
      workOrderId: order.id,
      objectId: obj.id,
      objectName: obj.name,
      latitude: navCoords.lat,
      longitude: navCoords.lng,
      estimatedDuration: order.estimatedDuration || 60,
      priority: order.priority || "normal",
    });
  }
  
  if (stops.length === 0) {
    return null;
  }
  
  // Spara originalordningen FÖRE optimering
  const originalStops = [...stops];
  const originalOrder = originalStops.map(s => s.workOrderId);
  
  const hasLivePosition = resource?.currentLatitude && resource?.currentLongitude && resource?.lastPositionUpdate 
    && (Date.now() - new Date(resource.lastPositionUpdate).getTime()) < 30 * 60 * 1000;
  
  const startCoord = hasLivePosition
    ? { lat: resource.currentLatitude!, lng: resource.currentLongitude! }
    : (resource?.homeLatitude && resource?.homeLongitude
      ? { lat: resource.homeLatitude, lng: resource.homeLongitude }
      : undefined);
  
  // Beräkna originaldistans från den ursprungliga ordningen (OSRM med Haversine-fallback)
  const originalDistance = await calculateTotalDistance(originalStops, startCoord);
  const originalDriveTime = (originalDistance / 40) * 60; // 40 km/h snitt
  
  // Optimera och beräkna ny distans
  const optimizedStops = nearestNeighborOptimization(stops, startCoord);
  const optimizedDistance = await calculateTotalDistance(optimizedStops, startCoord);
  const optimizedDriveTime = (optimizedDistance / 40) * 60;
  
  const optimizedOrder = optimizedStops.map(s => s.workOrderId);
  
  const totalWorkTime = optimizedStops.reduce((sum, s) => sum + s.estimatedDuration, 0);
  
  // Beräkna besparingar
  const timeSaved = Math.max(0, originalDriveTime - optimizedDriveTime);
  const distanceSaved = Math.max(0, originalDistance - optimizedDistance);
  const fuelSaved = distanceSaved * 0.08; // ca 8 liter/100km för lätt lastbil
  const costSaved = (fuelSaved * 22) + (timeSaved / 60 * 450); // 22 kr/liter + 450 kr/timme personal
  
  const savingsRatio = originalDistance > 0 
    ? Math.max(0, (originalDistance - optimizedDistance) / originalDistance)
    : 0;
  const optimizationScore = Math.round(50 + savingsRatio * 50);
  
  return {
    resourceId,
    resourceName,
    date,
    stops: optimizedStops,
    totalDriveTime: Math.round(optimizedDriveTime),
    totalWorkTime,
    totalDistance: Math.round(optimizedDistance * 10) / 10,
    optimizationScore,
    originalOrder,
    optimizedOrder,
    originalDriveTime: Math.round(originalDriveTime),
    originalDistance: Math.round(originalDistance * 10) / 10,
    timeSaved: Math.round(timeSaved),
    distanceSaved: Math.round(distanceSaved * 10) / 10,
    estimatedFuelSaved: Math.round(fuelSaved * 10) / 10,
    estimatedCostSaved: Math.round(costSaved),
  };
}

// =============================================================================
// Geoapify Route Planner API (VRP Optimization)
// =============================================================================

export interface BreakConfig {
  enabled: boolean;
  durationMinutes: number;
  earliestStart: number;
  latestEnd: number;
}

export const DEFAULT_BREAK_CONFIG: BreakConfig = {
  enabled: true,
  durationMinutes: 30,
  earliestStart: 11 * 3600,
  latestEnd: 13 * 3600,
};

interface GeoapifyAgent {
  start_location: [number, number];
  end_location?: [number, number];
  time_windows?: [number, number][];
  breaks?: Array<{ duration: number; time_windows?: [number, number][] }>;
  id?: string;
  description?: string;
}

interface GeoapifyJob {
  location: [number, number];
  duration?: number;
  priority?: number;
  time_windows?: [number, number][];
  id?: string;
  description?: string;
}

export interface VRPRouteStop {
  orderId: string;
  orderTitle: string;
  sequence: number;
  arrivalSeconds?: number;
  serviceMinutes: number;
  waitingMinutes: number;
  location: { lat: number; lng: number };
  isBreak?: boolean;
  breakDurationMinutes?: number;
}

interface VRPRoute {
  resourceId: string;
  resourceName: string;
  stops: VRPRouteStop[];
  totalDurationMinutes: number;
  totalDistanceKm: number;
  totalServiceMinutes: number;
  efficiency: number;
  geometry?: unknown;
  breakConfig?: BreakConfig;
}

export interface VRPOptimizationResult {
  success: boolean;
  routes: VRPRoute[];
  unassignedOrders: Array<{ orderId: string; reason: string }>;
  summary: {
    totalOrders: number;
    assignedOrders: number;
    totalDurationMinutes: number;
    totalDistanceKm: number;
    avgEfficiency: number;
  };
  constraintsApplied?: string[];
  error?: string;
}

const DEFAULT_SERVICE_TIME_SECONDS = 30 * 60; // 30 min
const DEFAULT_WORK_HOURS: [number, number] = [8 * 3600, 17 * 3600]; // 08-17

function parseScheduledTime(value: string): number | null {
  const timeOnly = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeOnly) {
    const hours = parseInt(timeOnly[1], 10);
    const minutes = parseInt(timeOnly[2], 10);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return hours * 3600 + minutes * 60;
    }
  }

  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    return hours * 3600 + minutes * 60;
  }

  console.warn(`Unable to parse scheduledStartTime value: "${value}", skipping time_window constraint`);
  return null;
}

/**
 * Optimize routes using Geoapify Route Planner API
 * Supports multi-vehicle VRP with time windows
 */
export async function optimizeRoutesVRP(
  workOrders: WorkOrder[],
  resources: Resource[],
  objects: ServiceObject[],
  breakConfig?: BreakConfig,
  constraintOptions?: VRPConstraintOptions,
): Promise<VRPOptimizationResult> {
  if (!getMapProvider().isRoutingAvailable()) {
    return {
      success: false,
      routes: [],
      unassignedOrders: [],
      summary: {
        totalOrders: workOrders.length,
        assignedOrders: 0,
        totalDurationMinutes: 0,
        totalDistanceKm: 0,
        avgEfficiency: 0
      },
      error: "Geoapify API-nyckel saknas. Lägg till GEOAPIFY_API_KEY."
    };
  }

  const objectMap = new Map(objects.map(o => [o.id, o]));

  const validJobs: Array<{ order: WorkOrder; job: GeoapifyJob; index: number }> = [];
  let jobIndex = 0;

  for (const order of workOrders) {
    // Task #1216: startuppgifter är kedjans startpunkt, inte ett rutt-jobb.
    if (isStartTask(order)) continue;
    // Task #1216: uppgifter utan geografisk koppling (admin/utbildning m.m.)
    // planeras av tidsmotorn — central gate oavsett anropsväg.
    if (resolveLocationRequirement(order) === "ingen") continue;

    let coords: [number, number] | null = null;

    const obj = objectMap.get(order.objectId);
    if (obj) {
      // Task #990: ruttbara objekt (pinpoint + giltig koordinat) routas via nav-koordinat.
      // Område/ingen-geo objekt hoppas över — falla ALDRIG tillbaka på kluster för ett
      // befintligt objekt (det skulle gissa fel position).
      if (objectIsRoutable(obj)) {
        const navCoords = getNavigationCoordinates(obj);
        coords = navCoords ? [navCoords.lng, navCoords.lat] : null;
      }
    } else if (order.taskLatitude != null && order.taskLongitude != null) {
      // Task #1216: uppgiftens egen position (utan objekt). Klustercentrum
      // används ALDRIG som positionsgissning — uppgifter utan position flaggas
      // som datakvalitetsbrist i planeringen istället.
      coords = [order.taskLongitude, order.taskLatitude];
    }

    if (!coords) continue;

    const serviceTime = order.estimatedDuration 
      ? order.estimatedDuration * 60 
      : DEFAULT_SERVICE_TIME_SECONDS;

    const priority = order.priority === "urgent" ? 100 
      : order.priority === "high" ? 75
      : order.priority === "normal" ? 50 : 25;

    const job: GeoapifyJob = {
      location: coords,
      duration: serviceTime,
      priority,
      id: order.id,
      description: order.title || `Order ${order.id.slice(0, 8)}`
    };

    if (order.scheduledStartTime) {
      const parsedSec = parseScheduledTime(order.scheduledStartTime);
      if (parsedSec !== null) {
        const endSec = Math.min(parsedSec + 3600, DEFAULT_WORK_HOURS[1]);
        if (endSec > parsedSec) {
          job.time_windows = [[parsedSec, endSec]];
        } else {
          console.warn(`Scheduled time ${parsedSec}s is at or past work hours end ${DEFAULT_WORK_HOURS[1]}s, skipping time_window`);
        }
      }
    }

    validJobs.push({ order, job, index: jobIndex });
    jobIndex++;
  }

  if (validJobs.length === 0) {
    return {
      success: false,
      routes: [],
      unassignedOrders: workOrders.map(o => ({ orderId: o.id, reason: "Saknar koordinater" })),
      summary: {
        totalOrders: workOrders.length,
        assignedOrders: 0,
        totalDurationMinutes: 0,
        totalDistanceKm: 0,
        avgEfficiency: 0
      },
      error: "Inga ordrar med giltiga koordinater"
    };
  }

  const effectiveBreak = breakConfig?.enabled !== false ? (breakConfig || DEFAULT_BREAK_CONFIG) : null;

  // Task #1216: agenter utan startposition hoppas över — ingen default-position
  // (t.ex. Umeå) får någonsin gissas. Team-fordon får sin position från dagens
  // startuppgift (buildTeamVehicles); resurser från hemkoordinater.
  const routableResources = resources.filter((resource) => {
    const ok = resource.homeLatitude != null && resource.homeLongitude != null;
    if (!ok) {
      console.log(`[route-optimizer] Resurs/team "${resource.name}" (${resource.id}) saknar startposition — hoppas över i VRP`);
    }
    return ok;
  });

  const agents: GeoapifyAgent[] = routableResources.map((resource, idx) => {
    const startCoord: [number, number] = [resource.homeLongitude!, resource.homeLatitude!];

    const agent: GeoapifyAgent = {
      start_location: startCoord,
      end_location: startCoord,
      time_windows: [
        [
          Number.isFinite(DEFAULT_WORK_HOURS[0]) ? DEFAULT_WORK_HOURS[0] : 8 * 3600,
          Number.isFinite(DEFAULT_WORK_HOURS[1]) ? DEFAULT_WORK_HOURS[1] : 17 * 3600
        ]
      ],
      id: resource.id,
      description: resource.name,
    };

    if (effectiveBreak) {
      agent.breaks = [{
        duration: effectiveBreak.durationMinutes * 60,
        time_windows: [[effectiveBreak.earliestStart, effectiveBreak.latestEnd]],
      }];
    }

    return agent;
  });

  if (agents.length === 0) {
    return {
      success: false,
      routes: [],
      unassignedOrders: [],
      summary: {
        totalOrders: workOrders.length,
        assignedOrders: 0,
        totalDurationMinutes: 0,
        totalDistanceKm: 0,
        avgEfficiency: 0
      },
      error: "Inga resurser tillgängliga"
    };
  }

  let enrichedJobs = validJobs.map(j => j.job);
  let enrichedAgents: Record<string, unknown>[] = agents;
  let constraintsSummary: string[] = [];

  if (constraintOptions) {
    try {
      const { enrichVRPRequestWithConstraints } = await import("./vrp-constraints");
      const enrichResult = await enrichVRPRequestWithConstraints(
        validJobs.map(j => ({
          ...j.job,
          duration: j.job.duration || DEFAULT_SERVICE_TIME_SECONDS,
          priority: j.job.priority || 50,
          id: j.job.id || j.order.id,
        })),
        agents.map(a => ({ ...a })),
        workOrders,
        resources,
        objects,
        constraintOptions,
      );
      enrichedJobs = enrichResult.jobs;
      enrichedAgents = enrichResult.agents;
      constraintsSummary = enrichResult.constraintsApplied;
      console.log(`[VRP] Constraints applied: ${constraintsSummary.join(", ")} | Pre-filtered pairs: ${enrichResult.preFilteredPairs} | Dependency sequences: ${enrichResult.dependencySequences.length}`);
    } catch (enrichErr) {
      console.warn("[VRP] Constraint enrichment failed, proceeding without:", enrichErr instanceof Error ? enrichErr.message : enrichErr);
    }
  }

  const PRE_CLUSTER_THRESHOLD = 50;
  if (enrichedJobs.length > PRE_CLUSTER_THRESHOLD && enrichedAgents.length > 1) {
    try {
      const { haversineDistanceKm } = await import("./distance-matrix-service");
      const dbscanMod = await import("./dbscan-clustering");
      const stops: Array<{ id: string; lat: number; lng: number; timeWindows?: [number, number][] }> = enrichedJobs.map(j => ({
        id: j.id || "",
        lat: j.location[1],
        lng: j.location[0],
        timeWindows: j.time_windows as [number, number][] | undefined,
      }));
      const clusterCount = Math.min(enrichedAgents.length, Math.ceil(enrichedJobs.length / 15));
      const geoClusters = dbscanMod.dbscanPreCluster(stops, clusterCount);
      console.log(`[VRP] DBSCAN pre-clustering ${enrichedJobs.length} jobs into ${geoClusters.length} clusters`);

      const jobMap = new Map(enrichedJobs.map(j => [j.id, j]));
      const agentUsed = new Set<number>();
      const clusterAgentAssignment: number[][] = [];

      for (const gc of geoClusters) {
        const agentsPerCluster = Math.max(1, Math.floor(enrichedAgents.length / geoClusters.length));
        const assigned: number[] = [];
        // Task #1216: ingen default-koordinat — agent utan start_location
        // rankas sist (Infinity) istället för att få en gissad position.
        const agentDistances = enrichedAgents.map((a, idx) => {
          const agentObj = a as { start_location?: [number, number] };
          const loc = agentObj.start_location;
          return {
            idx,
            dist: loc ? haversineDistanceKm(gc.centroid.lat, gc.centroid.lng, loc[1], loc[0]) : Infinity,
          };
        }).sort((a, b) => a.dist - b.dist);

        for (const ad of agentDistances) {
          if (assigned.length >= agentsPerCluster) break;
          if (!agentUsed.has(ad.idx)) {
            assigned.push(ad.idx);
            agentUsed.add(ad.idx);
          }
        }

        if (assigned.length === 0) {
          assigned.push(agentDistances[0].idx);
        }
        clusterAgentAssignment.push(assigned);
      }

      const allRoutes: VRPRoute[] = [];
      const allUnassigned: Array<{ orderId: string; reason: string }> = [];
      let totalAssigned = 0;
      let totalDistance = 0;
      let totalTime = 0;
      const orderMap = new Map(workOrders.map(o => [o.id, o]));

      // Task #490 — parallellisera cluster-VRP-anrop med bounded concurrency.
      // Tidigare seriell loop blockerade på varje Geoapify-anrop (~2-5 s) ×
      // antal kluster, vilket dominerade total VRP-tid för stora indata.
      // Backout: VRP_PARALLEL_CLUSTERS=false → serial som tidigare.
      // Concurrency styrs av VRP_PARALLEL_CONCURRENCY (default 4) — håll
      // konservativt så vi inte triggar Geoapify rate-limit.
      const parallelEnabled = (process.env.VRP_PARALLEL_CLUSTERS ?? "true").toLowerCase() !== "false";
      const concurrency = Math.max(1, parseInt(process.env.VRP_PARALLEL_CONCURRENCY || "4", 10) || 4);

      interface ClusterOutcome {
        ci: number;
        routes: VRPRoute[];
        unassigned: Array<{ orderId: string; reason: string }>;
        assignedCount: number;
        distance: number;
        time: number;
      }

      const runCluster = async (ci: number): Promise<ClusterOutcome> => {
        const gc = geoClusters[ci];
        const clusterJobs = gc.stops.map(s => jobMap.get(s.id)).filter(Boolean) as GeoapifyJob[];
        const clusterAgentIndices = clusterAgentAssignment[ci];
        const clusterAgents = clusterAgentIndices.map(idx => enrichedAgents[idx]);
        const clusterResources = clusterAgentIndices.map(idx => resources[idx]);

        const outcome: ClusterOutcome = {
          ci, routes: [], unassigned: [], assignedCount: 0, distance: 0, time: 0,
        };
        if (clusterJobs.length === 0) return outcome;

        try {
          const plannerResult = await getMapProvider().optimizeRoutes({
            agents: clusterAgents,
            jobs: clusterJobs,
          });

          if (!plannerResult.ok) {
            console.warn(`[VRP] Cluster ${ci} API error ${plannerResult.status}`);
            for (const job of clusterJobs) {
              outcome.unassigned.push({ orderId: job.id || "", reason: "Kluster-optimering misslyckades" });
            }
            return outcome;
          }

          const clJobIndexToOrderId = new Map(clusterJobs.map((j, idx) => [idx, j.id || ""]));

          for (const plan of plannerResult.agentPlans) {
            const resource = clusterResources[plan.agentIndex];
            const relevantActions = plan.actions.filter(a => a.type === "job" || a.type === "break");
            const stops: VRPRouteStop[] = [];
            let seq = 1;

            for (const action of relevantActions) {
              if (action.type === "break") {
                const prevStop = stops.length > 0 ? stops[stops.length - 1] : null;
                stops.push({
                  orderId: `break-${resource?.id || plan.agentIndex}`,
                  orderTitle: "Rast",
                  sequence: seq++,
                  arrivalSeconds: action.startTimeSeconds || 0,
                  serviceMinutes: Math.round((action.durationSeconds || 0) / 60),
                  waitingMinutes: 0,
                  location: prevStop?.location || { lat: 0, lng: 0 },
                  isBreak: true,
                  breakDurationMinutes: Math.round((action.durationSeconds || 0) / 60),
                });
              } else {
                const orderId = action.jobId || (action.jobIndex !== undefined ? clJobIndexToOrderId.get(action.jobIndex) : "") || "";
                const order = orderMap.get(orderId);
                stops.push({
                  orderId,
                  orderTitle: order?.title || `Order ${orderId.slice(0, 8)}`,
                  sequence: seq++,
                  arrivalSeconds: action.startTimeSeconds || 0,
                  serviceMinutes: Math.round((action.durationSeconds || 0) / 60),
                  waitingMinutes: 0,
                  location: action.location || { lat: 0, lng: 0 },
                });
              }
            }

            const jobStops = stops.filter(s => !s.isBreak);
            outcome.assignedCount += jobStops.length;
            const totalDur = Math.round(plan.durationSeconds / 60);
            const totalSvc = jobStops.reduce((s, st) => s + st.serviceMinutes, 0);
            const distKm = Math.round(plan.distanceMeters / 100) / 10;
            outcome.distance += plan.distanceMeters;
            outcome.time += plan.durationSeconds;

            outcome.routes.push({
              resourceId: resource?.id || "",
              resourceName: resource?.name || `Resurs`,
              stops,
              totalDurationMinutes: totalDur,
              totalDistanceKm: distKm,
              totalServiceMinutes: totalSvc,
              efficiency: totalDur > 0 ? Math.round((totalSvc / totalDur) * 100) : 0,
              geometry: plan.geometry,
              breakConfig: effectiveBreak || undefined,
            });
          }

          for (const idx of plannerResult.unassignedJobIndices) {
            outcome.unassigned.push({
              orderId: clJobIndexToOrderId.get(idx) || "",
              reason: "Kunde inte tilldelas i kluster",
            });
          }
        } catch (clusterErr) {
          console.warn(`[VRP] Cluster ${ci} optimization failed:`, clusterErr);
          for (const job of clusterJobs) {
            outcome.unassigned.push({ orderId: job.id || "", reason: "Kluster-optimering kraschade" });
          }
        }
        return outcome;
      };

      const tClusterStart = Date.now();
      let outcomes: ClusterOutcome[];
      if (parallelEnabled && geoClusters.length > 1) {
        const { default: pLimit } = await import("p-limit");
        const limit = pLimit(concurrency);
        const settled = await Promise.allSettled(
          geoClusters.map((_, ci) => limit(() => runCluster(ci))),
        );
        outcomes = settled.map((r, ci) =>
          r.status === "fulfilled"
            ? r.value
            : {
                ci,
                routes: [],
                unassigned: (geoClusters[ci].stops.map(s => jobMap.get(s.id)).filter(Boolean) as GeoapifyJob[])
                  .map(j => ({ orderId: j.id || "", reason: "Kluster-optimering kraschade" })),
                assignedCount: 0,
                distance: 0,
                time: 0,
              },
        );
        console.log(`[VRP] Parallel cluster optimization (${geoClusters.length} clusters, concurrency=${concurrency}) klart på ${Date.now() - tClusterStart} ms`);
      } else {
        outcomes = [];
        for (let ci = 0; ci < geoClusters.length; ci++) {
          outcomes.push(await runCluster(ci));
        }
        console.log(`[VRP] Serial cluster optimization (${geoClusters.length} clusters) klart på ${Date.now() - tClusterStart} ms`);
      }

      // Bevara deterministisk merge-ordning (sortera efter ci) så att
      // route-ID-tilldelning är reproducerbar mellan körningar.
      outcomes.sort((a, b) => a.ci - b.ci);
      for (const o of outcomes) {
        allRoutes.push(...o.routes);
        allUnassigned.push(...o.unassigned);
        totalAssigned += o.assignedCount;
        totalDistance += o.distance;
        totalTime += o.time;
      }

      const mergedRoutes: Map<string, VRPRoute> = new Map();
      for (const route of allRoutes) {
        const existing = mergedRoutes.get(route.resourceId);
        if (existing) {
          const offset = existing.stops.length;
          existing.stops.push(...route.stops.map(s => ({ ...s, sequence: s.sequence + offset })));
          existing.totalDurationMinutes += route.totalDurationMinutes;
          existing.totalDistanceKm += route.totalDistanceKm;
          existing.totalServiceMinutes += route.totalServiceMinutes;
        } else {
          mergedRoutes.set(route.resourceId, { ...route });
        }
      }

      for (const route of mergedRoutes.values()) {
        route.efficiency = route.totalDurationMinutes > 0
          ? Math.round((route.totalServiceMinutes / route.totalDurationMinutes) * 100) : 0;
      }

      const finalRoutes = [...mergedRoutes.values()];
      const avgEff = finalRoutes.length > 0
        ? Math.round(finalRoutes.reduce((s, r) => s + r.efficiency, 0) / finalRoutes.length)
        : 0;

      return {
        success: true,
        routes: finalRoutes,
        unassignedOrders: allUnassigned,
        summary: {
          totalOrders: workOrders.length,
          assignedOrders: totalAssigned,
          totalDurationMinutes: Math.round(totalTime / 60),
          totalDistanceKm: Math.round(totalDistance / 100) / 10,
          avgEfficiency: avgEff
        },
        constraintsApplied: constraintsSummary.length > 0 ? constraintsSummary : undefined,
      };
    } catch (clErr) {
      console.warn("[VRP] Pre-clustering failed, proceeding with single batch:", clErr instanceof Error ? clErr.message : clErr);
    }
  }

  try {
    const plannerResult = await getMapProvider().optimizeRoutes({
      agents: enrichedAgents,
      jobs: enrichedJobs,
    });

    if (!plannerResult.ok) {
      throw new Error(`Geoapify Route Planner API error: ${plannerResult.status} - ${plannerResult.error}`);
    }

    const orderMap = new Map(workOrders.map(o => [o.id, o]));
    const jobIndexToOrderId = new Map(validJobs.map(j => [j.index, j.order.id]));

    let totalAssigned = 0;
    let totalDistance = 0;
    let totalTime = 0;

    const routes = plannerResult.agentPlans.map(plan => {
      const resource = resources[plan.agentIndex];

      const relevantActions = plan.actions.filter(a => a.type === "job" || a.type === "break");
      const stops: VRPRouteStop[] = [];
      let seq = 1;

      for (const action of relevantActions) {
        if (action.type === "break") {
          const prevStop = stops.length > 0 ? stops[stops.length - 1] : null;
          stops.push({
            orderId: `break-${resource?.id || plan.agentIndex}`,
            orderTitle: "Rast",
            sequence: seq++,
            arrivalSeconds: action.startTimeSeconds || 0,
            serviceMinutes: Math.round((action.durationSeconds || 0) / 60),
            waitingMinutes: 0,
            location: prevStop?.location || { lat: 0, lng: 0 },
            isBreak: true,
            breakDurationMinutes: Math.round((action.durationSeconds || 0) / 60),
          });
        } else {
          const orderId = action.jobId || (action.jobIndex !== undefined ? jobIndexToOrderId.get(action.jobIndex) : "") || "";
          const order = orderMap.get(orderId);

          stops.push({
            orderId,
            orderTitle: order?.title || `Order ${orderId.slice(0, 8)}`,
            sequence: seq++,
            arrivalSeconds: action.startTimeSeconds || 0,
            serviceMinutes: Math.round((action.durationSeconds || 0) / 60),
            waitingMinutes: 0,
            location: action.location || { lat: 0, lng: 0 },
          });
        }
      }

      const jobStops = stops.filter(s => !s.isBreak);
      totalAssigned += jobStops.length;

      const totalDur = Math.round(plan.durationSeconds / 60);
      const totalSvc = jobStops.reduce((s, st) => s + st.serviceMinutes, 0);
      const distKm = Math.round(plan.distanceMeters / 100) / 10;

      totalDistance += plan.distanceMeters;
      totalTime += plan.durationSeconds;

      return {
        resourceId: resource?.id || "",
        resourceName: resource?.name || `Resurs ${plan.agentIndex + 1}`,
        stops,
        totalDurationMinutes: totalDur,
        totalDistanceKm: distKm,
        totalServiceMinutes: totalSvc,
        efficiency: totalDur > 0 ? Math.round((totalSvc / totalDur) * 100) : 0,
        geometry: plan.geometry,
        breakConfig: effectiveBreak || undefined,
      };
    });

    const unassignedOrders = plannerResult.unassignedJobIndices.map(idx => ({
      orderId: jobIndexToOrderId.get(idx) || "",
      reason: "Kunde inte tilldelas"
    }));

    const avgEff = routes.length > 0
      ? Math.round(routes.reduce((s, r) => s + r.efficiency, 0) / routes.length)
      : 0;

    return {
      success: true,
      routes,
      unassignedOrders,
      summary: {
        totalOrders: workOrders.length,
        assignedOrders: totalAssigned,
        totalDurationMinutes: Math.round(totalTime / 60),
        totalDistanceKm: Math.round(totalDistance / 100) / 10,
        avgEfficiency: avgEff
      },
      constraintsApplied: constraintsSummary.length > 0 ? constraintsSummary : undefined,
    };

  } catch (error) {
    console.error("VRP optimization error:", error);
    return {
      success: false,
      routes: [],
      unassignedOrders: [],
      summary: {
        totalOrders: workOrders.length,
        assignedOrders: 0,
        totalDurationMinutes: 0,
        totalDistanceKm: 0,
        avgEfficiency: 0
      },
      error: error instanceof Error ? error.message : "Okänt fel vid VRP-optimering"
    };
  }
}

export async function optimizeDayRoutes(
  date: string,
  workOrders: WorkOrder[],
  resources: Resource[],
  objects: ServiceObject[]
): Promise<DayRouteOptimization> {
  const resourcesWithOrders = new Set<string>();
  
  workOrders.forEach(wo => {
    if (!wo.scheduledDate || !wo.resourceId) return;
    const orderDate = wo.scheduledDate instanceof Date 
      ? wo.scheduledDate.toISOString().split("T")[0]
      : String(wo.scheduledDate).split("T")[0];
    if (orderDate === date) {
      resourcesWithOrders.add(wo.resourceId);
    }
  });
  
  const routes: OptimizedRoute[] = [];
  let totalSavings = 0;
  let totalDistanceSaved = 0;
  let totalFuelSaved = 0;
  let totalCostSaved = 0;
  
  for (const resourceId of Array.from(resourcesWithOrders)) {
    const resource = resources.find(r => r.id === resourceId);
    const route = await optimizeResourceDayRoute(
      resourceId,
      resource?.name || "Okänd resurs",
      date,
      workOrders,
      objects,
      resource
    );
    
    if (route) {
      routes.push(route);
      totalSavings += route.timeSaved;
      totalDistanceSaved += route.distanceSaved;
      totalFuelSaved += route.estimatedFuelSaved;
      totalCostSaved += route.estimatedCostSaved;
    }
  }
  
  const summary = routes.length > 0
    ? `${routes.length} rutter optimerade. Sparar ${Math.round(totalSavings)} min, ${totalDistanceSaved.toFixed(1)} km och ~${Math.round(totalCostSaved)} kr.`
    : "Inga rutter att optimera för detta datum.";
  
  return {
    date,
    routes,
    totalSavings: Math.round(totalSavings),
    totalDistanceSaved: Math.round(totalDistanceSaved * 10) / 10,
    totalFuelSaved: Math.round(totalFuelSaved * 10) / 10,
    totalCostSaved: Math.round(totalCostSaved),
    summary,
  };
}

const OPTIMIZE_ASYNC_THRESHOLD = 20;

export async function optimizeAsync(
  stops: Array<{ id: string; lat: number; lng: number; duration: number; time_window?: [number, number]; required_skills?: string[]; demand?: number; priority?: number }>,
  vehicles: Array<{ id: string; home_lat: number; home_lng: number; capacity?: number; skills?: string[]; start_time?: number; end_time?: number }>,
  _constraints?: Record<string, unknown>,
  _requestedBy?: string,
): Promise<VRPOptimizationResult | { jobId: string; status: "queued" }> {
  const { isServiceAvailable, callOptimizationService, convertORToolsToVRPResult } = await import("./services/optimizationQueue");
  type PrecomputedDistanceEntry = import("./services/optimizationQueue").PrecomputedDistanceEntry;

  const serviceUp = await isServiceAvailable();

  if (serviceUp && stops.length <= OPTIMIZE_ASYNC_THRESHOLD) {
    let distanceMatrix: PrecomputedDistanceEntry[] | undefined;

    const allLocations = [
      ...vehicles.map(v => ({ lat: v.home_lat, lng: v.home_lng })),
      ...stops.map(s => ({ lat: s.lat, lng: s.lng })),
    ];

    const { computeORToolsMatrix } = await import("./distance-matrix-service");
    distanceMatrix = await computeORToolsMatrix(allLocations) ?? undefined;

    const orResult = await callOptimizationService({
      stops: stops.map(s => ({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        time_window: s.time_window,
        duration: s.duration,
        required_skills: s.required_skills,
        demand: s.demand ?? 1,
        priority: s.priority ?? 1,
      })),
      vehicles: vehicles.map(v => ({
        id: v.id,
        capacity: v.capacity ?? 100,
        skills: v.skills,
        home_lat: v.home_lat,
        home_lng: v.home_lng,
        start_time: v.start_time ?? 28800,
        end_time: v.end_time ?? 61200,
      })),
      distanceMatrix,
    });

    const stopMap = new Map(stops.map(s => [s.id, {
      title: s.id,
      lat: s.lat,
      lng: s.lng,
      durationMin: Math.round(s.duration / 60),
    }]));
    const vehicleMap = new Map(vehicles.map(v => [v.id, v.id]));

    return convertORToolsToVRPResult(orResult, stopMap, vehicleMap);
  }

  return {
    success: false,
    routes: [],
    unassignedOrders: stops.map(s => ({ orderId: s.id, reason: "OR-Tools tjänsten inte tillgänglig, använd Geoapify VRP" })),
    summary: {
      totalOrders: stops.length,
      assignedOrders: 0,
      totalDurationMinutes: 0,
      totalDistanceKm: 0,
      avgEfficiency: 0,
    },
    error: "OR-Tools tjänsten inte tillgänglig. Optimering sker via Geoapify VRP.",
  };
}

export { OPTIMIZE_ASYNC_THRESHOLD };
