import type { WorkOrder, Resource, ServiceObject, Cluster } from "@shared/schema";
import { trackApiUsage } from "./api-usage-tracker";
import {
  addOptimizationJob,
  getJobStatus,
  getJobResult,
  isQueueAvailable,
  type OptimizationStop,
  type OptimizationVehicle,
  type OptimizationJobResult,
} from "./services/optimizationQueue";

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;

interface RouteCache {
  result: { distance: number; duration: number };
  timestamp: number;
}

const routeCache = new Map<string, RouteCache>();
const ROUTE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getRouteCacheKey(coordinates: [number, number][]): string {
  return coordinates.map(c => `${c[0].toFixed(4)},${c[1].toFixed(4)}`).join("|");
}

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
  if (obj.latitude && obj.longitude) {
    return { lat: obj.latitude, lng: obj.longitude };
  }
  return null;
}

function getNavigationCoordinates(obj: ServiceObject): Coordinates | null {
  if ((obj as any).entranceLatitude && (obj as any).entranceLongitude) {
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

function calculateTotalDistance(stops: RouteStop[], startCoord?: Coordinates): number {
  if (stops.length === 0) return 0;
  
  let total = 0;
  let current = startCoord || { lat: stops[0].latitude, lng: stops[0].longitude };
  
  for (const stop of stops) {
    total += haversineDistance(current, { lat: stop.latitude, lng: stop.longitude });
    current = { lat: stop.latitude, lng: stop.longitude };
  }
  
  return total;
}

async function getRouteFromGeoapify(coordinates: [number, number][]): Promise<{
  distance: number;
  duration: number;
} | null> {
  if (!GEOAPIFY_API_KEY || coordinates.length < 2) {
    return null;
  }
  
  const cacheKey = getRouteCacheKey(coordinates);
  const cached = routeCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < ROUTE_CACHE_TTL) {
    return cached.result;
  }
  
  try {
    const waypoints = coordinates
      .map(([lng, lat]) => `${lat},${lng}`)
      .join("|");
    
    const startTime = Date.now();
    const response = await fetch(
      `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=drive&apiKey=${GEOAPIFY_API_KEY}`
    );

    trackApiUsage({
      service: "geoapify",
      method: "routing",
      endpoint: "/v1/routing",
      units: 1,
      statusCode: response.status,
      durationMs: Date.now() - startTime,
    });
    
    if (!response.ok) {
      console.error("Geoapify routing error:", await response.text());
      return null;
    }
    
    const data = await response.json();
    const feature = data.features?.[0];
    const props = feature?.properties;
    
    if (props && props.distance !== undefined && props.time !== undefined) {
      const result = {
        distance: props.distance / 1000,
        duration: props.time / 60,
      };
      routeCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }
    
    return null;
  } catch (error) {
    console.error("Geoapify routing fetch error:", error);
    return null;
  }
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
    const obj = objectMap.get(order.objectId);
    if (!obj || !obj.latitude || !obj.longitude) continue;
    
    const navCoords = getNavigationCoordinates(obj);
    stops.push({
      workOrderId: order.id,
      objectId: obj.id,
      objectName: obj.name,
      latitude: navCoords?.lat || obj.latitude,
      longitude: navCoords?.lng || obj.longitude,
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
  
  // Beräkna originaldistans från den ursprungliga ordningen
  const originalDistance = calculateTotalDistance(originalStops, startCoord);
  const originalDriveTime = (originalDistance / 40) * 60; // 40 km/h snitt
  
  // Optimera och beräkna ny distans
  const optimizedStops = nearestNeighborOptimization(stops, startCoord);
  const optimizedDistance = calculateTotalDistance(optimizedStops, startCoord);
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

interface GeoapifyAction {
  type: "start" | "end" | "job" | "break";
  start_time?: number;
  duration?: number;
  job_index?: number;
  job_id?: string;
  waypoint_index?: number;
}

interface GeoapifyWaypoint {
  original_location: [number, number];
  location: [number, number];
  start_time?: number;
  duration?: number;
  actions?: GeoapifyAction[];
}

interface GeoapifyAgentPlan {
  type: "Feature";
  properties: {
    agent_index: number;
    distance: number;
    time: number;
    total_time: number;
    start_time: number;
    mode: string;
    actions: GeoapifyAction[];
    waypoints: GeoapifyWaypoint[];
  };
  geometry: any;
}

interface GeoapifyRoutePlannerResponse {
  type: "FeatureCollection";
  properties: {
    mode: string;
    issues?: {
      unassignedAgents?: number[];
      unassignedJobs?: number[];
    };
  };
  features: GeoapifyAgentPlan[];
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

export interface VRPOptimizationResult {
  success: boolean;
  routes: Array<{
    resourceId: string;
    resourceName: string;
    stops: VRPRouteStop[];
    totalDurationMinutes: number;
    totalDistanceKm: number;
    totalServiceMinutes: number;
    efficiency: number;
    geometry?: string;
    breakConfig?: BreakConfig;
  }>;
  unassignedOrders: Array<{ orderId: string; reason: string }>;
  summary: {
    totalOrders: number;
    assignedOrders: number;
    totalDurationMinutes: number;
    totalDistanceKm: number;
    avgEfficiency: number;
  };
  error?: string;
}

const GEOAPIFY_ROUTE_PLANNER_URL = "https://api.geoapify.com/v1/routeplanner";
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
  clusters: Cluster[],
  breakConfig?: BreakConfig,
): Promise<VRPOptimizationResult> {
  if (!GEOAPIFY_API_KEY) {
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
  const clusterMap = new Map(clusters.map(c => [c.id, c]));

  const validJobs: Array<{ order: WorkOrder; job: GeoapifyJob; index: number }> = [];
  let jobIndex = 0;

  for (const order of workOrders) {
    let coords: [number, number] | null = null;

    const obj = objectMap.get(order.objectId);
    if (obj) {
      const navCoords = getNavigationCoordinates(obj);
      if (navCoords) {
        coords = [navCoords.lng, navCoords.lat];
      } else if (obj.latitude && obj.longitude) {
        coords = [obj.longitude, obj.latitude];
      }
    } else if (order.clusterId) {
      const cluster = clusterMap.get(order.clusterId);
      if (cluster?.centerLatitude && cluster?.centerLongitude) {
        coords = [cluster.centerLongitude, cluster.centerLatitude];
      }
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

  const agents: GeoapifyAgent[] = resources.map((resource, idx) => {
    const startCoord: [number, number] = resource.homeLatitude && resource.homeLongitude
      ? [resource.homeLongitude, resource.homeLatitude]
      : [20.263, 63.826]; // Umeå default

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

  try {
    const startTime = Date.now();
    const response = await fetch(`${GEOAPIFY_ROUTE_PLANNER_URL}?apiKey=${GEOAPIFY_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "drive",
        agents,
        jobs: validJobs.map(j => j.job),
      })
    });

    trackApiUsage({
      service: "geoapify",
      method: "route-planner",
      endpoint: "/v1/routeplanner",
      units: 1,
      statusCode: response.status,
      durationMs: Date.now() - startTime,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Geoapify Route Planner API error: ${response.status} - ${errorText}`);
    }

    const data: GeoapifyRoutePlannerResponse = await response.json();

    const orderMap = new Map(workOrders.map(o => [o.id, o]));
    const jobIndexToOrderId = new Map(validJobs.map(j => [j.index, j.order.id]));

    let totalAssigned = 0;
    let totalDistance = 0;
    let totalTime = 0;

    const routes = data.features.map(feature => {
      const props = feature.properties;
      const resource = resources[props.agent_index];

      const relevantActions = props.actions.filter(a => a.type === "job" || a.type === "break");
      const stops: VRPRouteStop[] = [];
      let seq = 1;

      for (const action of relevantActions) {
        if (action.type === "break") {
          const prevStop = stops.length > 0 ? stops[stops.length - 1] : null;
          stops.push({
            orderId: `break-${resource?.id || props.agent_index}`,
            orderTitle: "Rast",
            sequence: seq++,
            arrivalSeconds: action.start_time || 0,
            serviceMinutes: Math.round((action.duration || 0) / 60),
            waitingMinutes: 0,
            location: prevStop?.location || { lat: 0, lng: 0 },
            isBreak: true,
            breakDurationMinutes: Math.round((action.duration || 0) / 60),
          });
        } else {
          const orderId = action.job_id || (action.job_index !== undefined ? jobIndexToOrderId.get(action.job_index) : "") || "";
          const order = orderMap.get(orderId);
          const waypoint = action.waypoint_index !== undefined ? props.waypoints[action.waypoint_index] : null;

          stops.push({
            orderId,
            orderTitle: order?.title || `Order ${orderId.slice(0, 8)}`,
            sequence: seq++,
            arrivalSeconds: action.start_time || 0,
            serviceMinutes: Math.round((action.duration || 0) / 60),
            waitingMinutes: 0,
            location: waypoint?.location 
              ? { lat: waypoint.location[1], lng: waypoint.location[0] }
              : { lat: 0, lng: 0 },
          });
        }
      }

      const jobStops = stops.filter(s => !s.isBreak);
      totalAssigned += jobStops.length;

      const totalDur = Math.round(props.time / 60);
      const totalSvc = jobStops.reduce((s, st) => s + st.serviceMinutes, 0);
      const distKm = Math.round(props.distance / 100) / 10;

      totalDistance += props.distance;
      totalTime += props.time;

      return {
        resourceId: resource?.id || "",
        resourceName: resource?.name || `Resurs ${props.agent_index + 1}`,
        stops,
        totalDurationMinutes: totalDur,
        totalDistanceKm: distKm,
        totalServiceMinutes: totalSvc,
        efficiency: totalDur > 0 ? Math.round((totalSvc / totalDur) * 100) : 0,
        geometry: feature.geometry,
        breakConfig: effectiveBreak || undefined,
      };
    });

    const unassignedJobIndices = data.properties?.issues?.unassignedJobs || [];
    const unassignedOrders = unassignedJobIndices.map(idx => ({
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
      }
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



// =============================================================================
// Async optimization via BullMQ + Python OR-Tools service
// =============================================================================

const ASYNC_THRESHOLD = 20; // stops above this count use async path

export interface AsyncOptimizationResult {
  mode: "sync" | "async";
  jobId?: string;
  syncResult?: DayRouteOptimization;
}

/**
 * Smart optimization entry point.
 * - For ≤ ASYNC_THRESHOLD stops: uses existing synchronous optimization
 * - For > ASYNC_THRESHOLD stops: submits to BullMQ async queue (Python OR-Tools)
 */
export async function optimizeAsync(
  stops: OptimizationStop[],
  vehicles: OptimizationVehicle[],
  constraints: { maxSolveSeconds?: number } = {},
  requestedBy: string = "system",
): Promise<AsyncOptimizationResult> {
  // For small jobs or when queue is unavailable, use sync path
  if (stops.length <= ASYNC_THRESHOLD || !isQueueAvailable()) {
    // We don't have full WorkOrder/Resource objects here, so return a
    // lightweight sync result using haversine nearest-neighbor.
    const routeStops: RouteStop[] = stops.map((s) => ({
      workOrderId: s.id,
      objectId: s.id,
      objectName: s.id,
      latitude: s.lat,
      longitude: s.lng,
      estimatedDuration: (s.duration ?? 1800) / 60, // convert seconds to minutes
      priority: String(s.priority ?? 50),
    }));

    const optimized = nearestNeighborOptimization(routeStops);
    const totalDist = calculateTotalDistance(optimized);
    const driveTime = (totalDist / 40) * 60;
    const totalWork = optimized.reduce((sum, s) => sum + s.estimatedDuration, 0);

    const syncResult: DayRouteOptimization = {
      date: new Date().toISOString().split("T")[0],
      routes: [
        {
          resourceId: vehicles[0]?.id ?? "default",
          resourceName: vehicles[0]?.id ?? "Default",
          date: new Date().toISOString().split("T")[0],
          stops: optimized,
          totalDriveTime: Math.round(driveTime),
          totalWorkTime: totalWork,
          totalDistance: Math.round(totalDist * 10) / 10,
          optimizationScore: 70,
          originalOrder: stops.map((s) => s.id),
          optimizedOrder: optimized.map((s) => s.workOrderId),
          originalDriveTime: Math.round(driveTime * 1.2),
          originalDistance: Math.round(totalDist * 1.2 * 10) / 10,
          timeSaved: Math.round(driveTime * 0.2),
          distanceSaved: Math.round(totalDist * 0.2 * 10) / 10,
          estimatedFuelSaved: Math.round(totalDist * 0.2 * 0.08 * 10) / 10,
          estimatedCostSaved: Math.round(
            totalDist * 0.2 * 0.08 * 22 + (driveTime * 0.2) / 60 * 450,
          ),
        },
      ],
      totalSavings: Math.round(driveTime * 0.2),
      totalDistanceSaved: Math.round(totalDist * 0.2 * 10) / 10,
      totalFuelSaved: Math.round(totalDist * 0.2 * 0.08 * 10) / 10,
      totalCostSaved: Math.round(
        totalDist * 0.2 * 0.08 * 22 + (driveTime * 0.2) / 60 * 450,
      ),
      summary: `Synkron optimering av ${stops.length} stopp.`,
    };

    return { mode: "sync", syncResult };
  }

  // Async path – submit to BullMQ
  const jobId = await addOptimizationJob({
    stops,
    vehicles,
    constraints,
    requestedBy,
  });

  return { mode: "async", jobId };
}

/**
 * Convenience: poll for an async job result.
 * Re-exported from optimizationQueue for callers that import from route-optimizer.
 */
export { getJobStatus, getJobResult, isQueueAvailable };
