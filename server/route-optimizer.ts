import type { WorkOrder, Resource, ServiceObject, Cluster } from "@shared/schema";
import { trackApiUsage } from "./api-usage-tracker";

const OPENROUTESERVICE_API_KEY = process.env.OPENROUTESERVICE_API_KEY;

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

async function getRouteFromORS(coordinates: [number, number][]): Promise<{
  distance: number;
  duration: number;
} | null> {
  if (!OPENROUTESERVICE_API_KEY || coordinates.length < 2) {
    return null;
  }
  
  const cacheKey = getRouteCacheKey(coordinates);
  const cached = routeCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < ROUTE_CACHE_TTL) {
    return cached.result;
  }
  
  try {
    const startTime = Date.now();
    const response = await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": OPENROUTESERVICE_API_KEY,
      },
      body: JSON.stringify({
        coordinates,
        instructions: false,
      }),
    });

    trackApiUsage({
      service: "openrouteservice",
      method: "directions",
      endpoint: "/v2/directions",
      units: 1,
      statusCode: response.status,
      durationMs: Date.now() - startTime,
    });
    
    if (!response.ok) {
      console.error("ORS route error:", await response.text());
      return null;
    }
    
    const data = await response.json();
    const summary = data.features?.[0]?.properties?.summary;
    
    if (summary) {
      const result = {
        distance: summary.distance / 1000,
        duration: summary.duration / 60,
      };
      routeCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }
    
    return null;
  } catch (error) {
    console.error("ORS route fetch error:", error);
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
    
    stops.push({
      workOrderId: order.id,
      objectId: obj.id,
      objectName: obj.name,
      latitude: obj.latitude,
      longitude: obj.longitude,
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
  
  const startCoord = resource?.homeLatitude && resource?.homeLongitude
    ? { lat: resource.homeLatitude, lng: resource.homeLongitude }
    : undefined;
  
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
// VROOM-based VRP Optimization (OpenRouteService Optimization API)
// =============================================================================

interface VROOMVehicle {
  id: number;
  profile: string;
  description?: string;
  start: [number, number]; // [lng, lat]
  end?: [number, number];
  capacity?: number[];
  skills?: number[];
  time_window?: [number, number];
}

interface VROOMJob {
  id: number;
  location: [number, number];
  service?: number;
  delivery?: number[];
  pickup?: number[];
  skills?: number[];
  priority?: number;
  time_windows?: [number, number][];
  description?: string;
}

interface VROOMStep {
  type: "start" | "job" | "end";
  location?: [number, number];
  id?: number;
  service?: number;
  waiting_time?: number;
  arrival?: number;
  duration?: number;
  distance?: number;
  description?: string;
}

interface VROOMRoute {
  vehicle: number;
  cost: number;
  service: number;
  duration: number;
  distance: number;
  waiting_time: number;
  priority: number;
  steps: VROOMStep[];
  geometry?: string;
}

interface VROOMResponse {
  code: number;
  summary: {
    cost: number;
    routes: number;
    unassigned: number;
    service: number;
    duration: number;
    distance: number;
  };
  unassigned: Array<{ id: number; description?: string }>;
  routes: VROOMRoute[];
}

export interface VRPOptimizationResult {
  success: boolean;
  routes: Array<{
    resourceId: string;
    resourceName: string;
    stops: Array<{
      orderId: string;
      orderTitle: string;
      sequence: number;
      arrivalSeconds?: number;
      serviceMinutes: number;
      waitingMinutes: number;
      location: { lat: number; lng: number };
    }>;
    totalDurationMinutes: number;
    totalDistanceKm: number;
    totalServiceMinutes: number;
    efficiency: number;
    geometry?: string;
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

const ORS_OPTIMIZATION_URL = "https://api.openrouteservice.org/optimization";
const DEFAULT_SERVICE_TIME_SECONDS = 30 * 60; // 30 min
const DEFAULT_WORK_HOURS: [number, number] = [8 * 3600, 17 * 3600]; // 08-17

/**
 * Optimize routes using VROOM via OpenRouteService's optimization API
 * Supports multi-vehicle VRP with time windows
 */
export async function optimizeRoutesVRP(
  workOrders: WorkOrder[],
  resources: Resource[],
  objects: ServiceObject[],
  clusters: Cluster[]
): Promise<VRPOptimizationResult> {
  if (!OPENROUTESERVICE_API_KEY) {
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
      error: "OpenRouteService API-nyckel saknas. Lägg till OPENROUTESERVICE_API_KEY."
    };
  }

  const objectMap = new Map(objects.map(o => [o.id, o]));
  const clusterMap = new Map(clusters.map(c => [c.id, c]));

  // Build jobs from work orders
  const validJobs: Array<{ order: WorkOrder; job: VROOMJob }> = [];
  let jobId = 1;

  for (const order of workOrders) {
    let coords: [number, number] | null = null;

    // Try object coordinates
    const obj = objectMap.get(order.objectId);
    if (obj?.latitude && obj?.longitude) {
      coords = [obj.longitude, obj.latitude];
    } 
    // Try cluster center
    else if (order.clusterId) {
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

    const job: VROOMJob = {
      id: jobId,
      location: coords,
      service: serviceTime,
      priority,
      description: order.title || `Order ${order.id.slice(0, 8)}`
    };

    // Add time window if scheduled
    if (order.scheduledStartTime) {
      const start = new Date(order.scheduledStartTime);
      const startSec = start.getHours() * 3600 + start.getMinutes() * 60;
      job.time_windows = [[startSec, Math.min(startSec + 3600, DEFAULT_WORK_HOURS[1])]];
    }

    validJobs.push({ order, job });
    jobId++;
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

  // Build vehicles from resources
  const vehicles: VROOMVehicle[] = resources.map((resource, idx) => {
    const startCoord: [number, number] = resource.homeLatitude && resource.homeLongitude
      ? [resource.homeLongitude, resource.homeLatitude]
      : [20.263, 63.826]; // Umeå default

    return {
      id: idx + 1,
      profile: "driving-car",
      description: resource.name,
      start: startCoord,
      end: startCoord,
      time_window: DEFAULT_WORK_HOURS,
      capacity: [8]
    };
  });

  if (vehicles.length === 0) {
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

  // Call VROOM API
  try {
    const startTime = Date.now();
    const response = await fetch(ORS_OPTIMIZATION_URL, {
      method: "POST",
      headers: {
        "Authorization": OPENROUTESERVICE_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        vehicles,
        jobs: validJobs.map(j => j.job),
        options: { g: true }
      })
    });

    trackApiUsage({
      service: "openrouteservice",
      method: "optimization",
      endpoint: "/optimization",
      units: 1,
      statusCode: response.status,
      durationMs: Date.now() - startTime,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ORS Optimization API error: ${response.status} - ${errorText}`);
    }

    const data: VROOMResponse = await response.json();

    // Build order ID map using actual job IDs (not array indices)
    const orderIdMap = new Map(validJobs.map(j => [j.job.id, j.order.id]));
    const orderMap = new Map(workOrders.map(o => [o.id, o]));

    // Convert routes
    const routes = data.routes.map(route => {
      const resource = resources[route.vehicle - 1];

      const stops = route.steps
        .filter(step => step.type === "job" && step.id !== undefined)
        .map((step, idx) => {
          const orderId = orderIdMap.get(step.id!) || "";
          const order = orderMap.get(orderId);
          return {
            orderId,
            orderTitle: step.description || order?.title || `Order ${orderId.slice(0, 8)}`,
            sequence: idx + 1,
            arrivalSeconds: step.arrival,
            serviceMinutes: Math.round((step.service || 0) / 60),
            waitingMinutes: Math.round((step.waiting_time || 0) / 60),
            location: step.location 
              ? { lat: step.location[1], lng: step.location[0] }
              : { lat: 0, lng: 0 }
          };
        });

      const totalDur = Math.round(route.duration / 60);
      const totalSvc = Math.round(route.service / 60);

      return {
        resourceId: resource?.id || "",
        resourceName: resource?.name || `Resurs ${route.vehicle}`,
        stops,
        totalDurationMinutes: totalDur,
        totalDistanceKm: Math.round(route.distance / 100) / 10,
        totalServiceMinutes: totalSvc,
        efficiency: totalDur > 0 ? Math.round((totalSvc / totalDur) * 100) : 0,
        geometry: route.geometry
      };
    });

    const unassignedOrders = data.unassigned.map(u => ({
      orderId: orderIdMap.get(u.id) || "",
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
        assignedOrders: validJobs.length - data.unassigned.length,
        totalDurationMinutes: Math.round(data.summary.duration / 60),
        totalDistanceKm: Math.round(data.summary.distance / 100) / 10,
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
