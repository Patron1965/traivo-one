import type { VRPOptimizationResult } from "../route-optimizer";

const OPTIMIZATION_SERVICE_URL = process.env.OPTIMIZATION_SERVICE_URL || "http://localhost:8090";
const ASYNC_THRESHOLD = 20;

export { ASYNC_THRESHOLD };

export interface OptimizationStop {
  id: string;
  lat: number;
  lng: number;
  time_window?: [number, number];
  duration: number;
  required_skills?: string[];
  demand: number;
  priority: number;
}

export interface OptimizationVehicle {
  id: string;
  capacity: number;
  skills?: string[];
  home_lat: number;
  home_lng: number;
  start_time: number;
  end_time: number;
}

export interface PrecomputedDistanceEntry {
  from_idx: number;
  to_idx: number;
  distance_m: number;
  duration_s: number;
}

export interface OptimizationJobData {
  stops: OptimizationStop[];
  vehicles: OptimizationVehicle[];
  maxSolveSeconds?: number;
  distanceMatrix?: PrecomputedDistanceEntry[];
}

export interface ORToolsRouteStop {
  stop_id: string;
  sequence: number;
  arrival_time: number;
  departure_time: number;
}

export interface ORToolsRoute {
  vehicle_id: string;
  stops: ORToolsRouteStop[];
  total_distance_km: number;
  total_duration_seconds: number;
}

export interface OptimizationJobResult {
  success: boolean;
  routes: ORToolsRoute[];
  unassigned_stop_ids: string[];
  solve_time_ms: number;
  solver: string;
}

let _serviceAvailable: boolean | null = null;
let _lastCheck = 0;
const CHECK_INTERVAL_MS = 30_000;

export async function isServiceAvailable(): Promise<boolean> {
  const now = Date.now();
  if (_serviceAvailable !== null && now - _lastCheck < CHECK_INTERVAL_MS) {
    return _serviceAvailable;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${OPTIMIZATION_SERVICE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    _serviceAvailable = res.ok;
  } catch {
    _serviceAvailable = false;
  }
  _lastCheck = now;
  return _serviceAvailable;
}

export async function callOptimizationService(data: OptimizationJobData): Promise<OptimizationJobResult> {
  const payload: Record<string, unknown> = {
    stops: data.stops.map(s => ({
      id: s.id,
      lat: s.lat,
      lng: s.lng,
      time_window: s.time_window ?? null,
      duration: s.duration,
      required_skills: s.required_skills ?? null,
      demand: s.demand,
      priority: s.priority,
    })),
    vehicles: data.vehicles.map(v => ({
      id: v.id,
      capacity: v.capacity,
      skills: v.skills ?? null,
      home_lat: v.home_lat,
      home_lng: v.home_lng,
      start_time: v.start_time,
      end_time: v.end_time,
    })),
    max_solve_seconds: data.maxSolveSeconds ?? 30,
  };

  if (data.distanceMatrix && data.distanceMatrix.length > 0) {
    payload.distance_matrix = data.distanceMatrix;
  }

  const response = await fetch(`${OPTIMIZATION_SERVICE_URL}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Optimization service error (${response.status}): ${text}`);
  }

  return response.json() as Promise<OptimizationJobResult>;
}

export function convertORToolsToVRPResult(
  orResult: OptimizationJobResult,
  stopMap: Map<string, { title: string; lat: number; lng: number; durationMin: number }>,
  vehicleMap: Map<string, string>,
): VRPOptimizationResult {
  const routes = orResult.routes.map(r => {
    const stops = r.stops.map(s => {
      const info = stopMap.get(s.stop_id);
      return {
        orderId: s.stop_id,
        orderTitle: info?.title || s.stop_id,
        sequence: s.sequence,
        arrivalSeconds: s.arrival_time,
        serviceMinutes: info?.durationMin || 30,
        waitingMinutes: 0,
        location: { lat: info?.lat || 0, lng: info?.lng || 0 },
        isBreak: false,
      };
    });

    const totalServiceMin = stops.reduce((s, st) => s + st.serviceMinutes, 0);
    const totalDurationMin = Math.round(r.total_duration_seconds / 60);

    return {
      resourceId: r.vehicle_id,
      resourceName: vehicleMap.get(r.vehicle_id) || r.vehicle_id,
      stops,
      totalDurationMinutes: totalDurationMin,
      totalDistanceKm: r.total_distance_km,
      totalServiceMinutes: totalServiceMin,
      efficiency: totalDurationMin > 0 ? Math.round((totalServiceMin / totalDurationMin) * 100) : 0,
    };
  });

  const totalAssigned = routes.reduce((s, r) => s + r.stops.length, 0);
  const totalOrders = totalAssigned + orResult.unassigned_stop_ids.length;

  return {
    success: orResult.success,
    routes,
    unassignedOrders: orResult.unassigned_stop_ids.map(id => ({
      orderId: id,
      reason: "Kunde inte tilldelas inom tids- och kapacitetsrestriktioner",
    })),
    summary: {
      totalOrders,
      assignedOrders: totalAssigned,
      totalDurationMinutes: routes.reduce((s, r) => s + r.totalDurationMinutes, 0),
      totalDistanceKm: routes.reduce((s, r) => s + r.totalDistanceKm, 0),
      avgEfficiency: routes.length > 0
        ? Math.round(routes.reduce((s, r) => s + r.efficiency, 0) / routes.length)
        : 0,
    },
    constraintsApplied: ["OR-Tools CVRPTW"],
    error: orResult.success ? undefined : "Optimering returnerade inga rutter",
  };
}
