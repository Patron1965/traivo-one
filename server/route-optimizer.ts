import type { WorkOrder, Resource, ServiceObject, Cluster } from "@shared/schema";

const OPENROUTESERVICE_API_KEY = process.env.OPENROUTESERVICE_API_KEY;

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
  
  try {
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
    
    if (!response.ok) {
      console.error("ORS route error:", await response.text());
      return null;
    }
    
    const data = await response.json();
    const summary = data.features?.[0]?.properties?.summary;
    
    if (summary) {
      return {
        distance: summary.distance / 1000,
        duration: summary.duration / 60,
      };
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
