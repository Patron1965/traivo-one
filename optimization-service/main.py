"""OR-Tools CVRPTW Optimization Microservice.

FastAPI service that solves Capacitated Vehicle Routing Problems with
Time Windows using Google OR-Tools.  Includes geographic pre-clustering
via K-Means for large problem instances (>50 stops).
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from ortools.constraint_solver import pywrapcp, routing_enums_pb2
from sklearn.cluster import KMeans

app = FastAPI(title="Traivo Route Optimization Service", version="1.0.0")

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class Stop(BaseModel):
    id: str
    lat: float
    lng: float
    time_window: list[int] | None = None  # [earliest_sec, latest_sec]
    duration: int = 1800  # service duration in seconds (default 30 min)
    required_skills: list[str] = Field(default_factory=list)
    demand: int = 1  # capacity demand
    priority: int = 50  # 0-100


class Vehicle(BaseModel):
    id: str
    capacity: int = 20
    skills: list[str] = Field(default_factory=list)
    home_lat: float
    home_lng: float
    start_time: int = 28800  # seconds from midnight (default 08:00)
    end_time: int = 61200  # seconds from midnight (default 17:00)


class OptimizationRequest(BaseModel):
    stops: list[Stop]
    vehicles: list[Vehicle]
    max_solve_seconds: int = 30


class RouteStopResult(BaseModel):
    stop_id: str
    sequence: int
    arrival_time: int  # seconds from midnight
    departure_time: int
    waiting_time: int


class VehicleRoute(BaseModel):
    vehicle_id: str
    stops: list[RouteStopResult]
    total_distance_km: float
    total_duration_seconds: int


class OptimizationResponse(BaseModel):
    success: bool
    routes: list[VehicleRoute]
    unassigned_stop_ids: list[str]
    solve_time_ms: int
    cluster_info: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lng / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def build_distance_matrix(lats: list[float], lngs: list[float]) -> list[list[int]]:
    """Build distance matrix in *meters* (integer) for OR-Tools."""
    n = len(lats)
    matrix: list[list[int]] = []
    for i in range(n):
        row: list[int] = []
        for j in range(n):
            if i == j:
                row.append(0)
            else:
                km = haversine_km(lats[i], lngs[i], lats[j], lngs[j])
                row.append(int(km * 1000))  # meters
        matrix.append(row)
    return matrix


def build_time_matrix(distance_matrix: list[list[int]], avg_speed_kmh: float = 40.0) -> list[list[int]]:
    """Travel time matrix in seconds derived from distances (meters)."""
    speed_ms = avg_speed_kmh * 1000 / 3600
    return [
        [int(d / speed_ms) if speed_ms > 0 else 0 for d in row]
        for row in distance_matrix
    ]


def pre_cluster(stops: list[Stop], vehicles: list[Vehicle], max_per_cluster: int = 50) -> list[list[Stop]]:
    """K-Means pre-clustering when the number of stops exceeds threshold."""
    n_clusters = max(len(vehicles), math.ceil(len(stops) / max_per_cluster))
    coords = np.array([[s.lat, s.lng] for s in stops])
    km = KMeans(n_clusters=n_clusters, n_init=10, random_state=42)
    labels = km.fit_predict(coords)
    clusters: dict[int, list[Stop]] = {}
    for label, stop in zip(labels, stops):
        clusters.setdefault(int(label), []).append(stop)
    return list(clusters.values())


def skill_match(vehicle: Vehicle, stop: Stop) -> bool:
    if not stop.required_skills:
        return True
    return all(sk in vehicle.skills for sk in stop.required_skills)


# ---------------------------------------------------------------------------
# OR-Tools solver
# ---------------------------------------------------------------------------

def solve_vrptw(
    stops: list[Stop],
    vehicles: list[Vehicle],
    max_solve_seconds: int = 30,
) -> OptimizationResponse:
    t0 = time.time()

    if not stops or not vehicles:
        return OptimizationResponse(
            success=True,
            routes=[],
            unassigned_stop_ids=[s.id for s in stops],
            solve_time_ms=0,
        )

    # ----- build node list: depot nodes (one per vehicle) + stop nodes -----
    # Index layout: [depot_v0, depot_v1, ..., depot_vN, stop_0, stop_1, ...]
    n_vehicles = len(vehicles)
    n_stops = len(stops)
    n_nodes = n_vehicles + n_stops  # each vehicle has its own depot node

    lats: list[float] = [v.home_lat for v in vehicles] + [s.lat for s in stops]
    lngs: list[float] = [v.home_lng for v in vehicles] + [s.lng for s in stops]

    distance_matrix = build_distance_matrix(lats, lngs)
    time_matrix = build_time_matrix(distance_matrix)

    # demands: depots = 0, stops = demand
    demands = [0] * n_vehicles + [s.demand for s in stops]

    # time windows: depots get vehicle start/end, stops get their window or full day
    time_windows: list[tuple[int, int]] = []
    for v in vehicles:
        time_windows.append((v.start_time, v.end_time))
    for s in stops:
        if s.time_window and len(s.time_window) == 2:
            time_windows.append((s.time_window[0], s.time_window[1]))
        else:
            # default: full working day window
            time_windows.append((0, 86400))

    service_times = [0] * n_vehicles + [s.duration for s in stops]

    # penalties for dropping stops (based on priority)
    penalties = [0] * n_vehicles + [max(1000, s.priority * 200) for s in stops]

    # ----- OR-Tools manager -----
    manager = pywrapcp.RoutingIndexManager(
        n_nodes,
        n_vehicles,
        list(range(n_vehicles)),  # start depots
        list(range(n_vehicles)),  # end depots
    )
    routing = pywrapcp.RoutingModel(manager)

    # distance callback
    def distance_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return distance_matrix[from_node][to_node]

    transit_cb_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_cb_index)

    # time dimension
    def time_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        travel = time_matrix[from_node][to_node]
        service = service_times[from_node]
        return travel + service

    time_cb_index = routing.RegisterTransitCallback(time_callback)
    routing.AddDimensionWithVehicleCapacity(
        time_cb_index,
        30 * 60,  # max waiting time (30 min slack)
        [v.end_time - v.start_time + 3600 for v in vehicles],  # max time per vehicle
        False,
        "Time",
    )
    time_dimension = routing.GetDimensionOrDie("Time")

    for node_idx in range(n_nodes):
        index = manager.NodeToIndex(node_idx)
        tw = time_windows[node_idx]
        time_dimension.CumulVar(index).SetRange(tw[0], tw[1])

    # minimise total time span
    for v in range(n_vehicles):
        start_idx = routing.Start(v)
        end_idx = routing.End(v)
        time_dimension.CumulVar(start_idx).SetRange(
            vehicles[v].start_time, vehicles[v].end_time
        )
        time_dimension.CumulVar(end_idx).SetRange(
            vehicles[v].start_time, vehicles[v].end_time
        )
        routing.AddVariableMinimizedByFinalizer(time_dimension.CumulVar(start_idx))
        routing.AddVariableMinimizedByFinalizer(time_dimension.CumulVar(end_idx))

    # capacity dimension
    def demand_callback(from_index: int) -> int:
        node = manager.IndexToNode(from_index)
        return demands[node]

    demand_cb_index = routing.RegisterUnaryTransitCallback(demand_callback)
    routing.AddDimensionWithVehicleCapacity(
        demand_cb_index,
        0,
        [v.capacity for v in vehicles],
        True,
        "Capacity",
    )

    # skill constraints – disallow arcs from vehicle to incompatible stops
    for stop_idx, stop in enumerate(stops):
        if not stop.required_skills:
            continue
        node = n_vehicles + stop_idx  # node index in the manager
        index = manager.NodeToIndex(node)
        allowed_vehicles: list[int] = []
        for v_idx, v in enumerate(vehicles):
            if skill_match(v, stop):
                allowed_vehicles.append(v_idx)
        if allowed_vehicles:
            routing.SetAllowedVehiclesForIndex(allowed_vehicles, index)

    # allow dropping nodes with penalty
    for stop_idx in range(n_stops):
        node = n_vehicles + stop_idx
        index = manager.NodeToIndex(node)
        routing.AddDisjunction([index], penalties[node])

    # ----- search parameters -----
    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    search_params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    search_params.time_limit.FromSeconds(max_solve_seconds)

    solution = routing.SolveWithParameters(search_params)

    solve_ms = int((time.time() - t0) * 1000)

    if not solution:
        return OptimizationResponse(
            success=False,
            routes=[],
            unassigned_stop_ids=[s.id for s in stops],
            solve_time_ms=solve_ms,
        )

    # ----- extract solution -----
    assigned_stop_ids: set[str] = set()
    routes: list[VehicleRoute] = []

    for v_idx in range(n_vehicles):
        route_stops: list[RouteStopResult] = []
        index = routing.Start(v_idx)
        route_distance = 0
        seq = 1

        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            next_index = solution.Value(routing.NextVar(index))
            route_distance += distance_matrix[node][manager.IndexToNode(next_index)]

            if node >= n_vehicles:  # it's a stop, not a depot
                stop = stops[node - n_vehicles]
                time_var = time_dimension.CumulVar(index)
                arrival = solution.Value(time_var)
                tw = time_windows[node]
                waiting = max(0, tw[0] - arrival) if arrival < tw[0] else 0
                departure = arrival + waiting + stop.duration

                route_stops.append(
                    RouteStopResult(
                        stop_id=stop.id,
                        sequence=seq,
                        arrival_time=arrival,
                        departure_time=departure,
                        waiting_time=waiting,
                    )
                )
                assigned_stop_ids.add(stop.id)
                seq += 1

            index = next_index

        if route_stops:
            end_node = manager.IndexToNode(index)
            end_time_var = time_dimension.CumulVar(index)
            total_duration = solution.Value(end_time_var) - vehicles[v_idx].start_time

            routes.append(
                VehicleRoute(
                    vehicle_id=vehicles[v_idx].id,
                    stops=route_stops,
                    total_distance_km=round(route_distance / 1000, 2),
                    total_duration_seconds=max(0, total_duration),
                )
            )

    unassigned = [s.id for s in stops if s.id not in assigned_stop_ids]

    return OptimizationResponse(
        success=True,
        routes=routes,
        unassigned_stop_ids=unassigned,
        solve_time_ms=solve_ms,
    )


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok", "service": "optimization"}


@app.post("/optimize", response_model=OptimizationResponse)
async def optimize(req: OptimizationRequest):
    try:
        cluster_info: dict[str, Any] | None = None

        # Pre-cluster if the problem is large
        if len(req.stops) > 50:
            clusters = pre_cluster(req.stops, req.vehicles)
            cluster_info = {
                "used": True,
                "num_clusters": len(clusters),
                "cluster_sizes": [len(c) for c in clusters],
            }

            # Solve each cluster independently then merge
            all_routes: list[VehicleRoute] = []
            all_unassigned: list[str] = []
            total_solve_ms = 0

            per_cluster_time = max(5, req.max_solve_seconds // len(clusters))

            for cluster_stops in clusters:
                result = solve_vrptw(cluster_stops, req.vehicles, per_cluster_time)
                all_routes.extend(result.routes)
                all_unassigned.extend(result.unassigned_stop_ids)
                total_solve_ms += result.solve_time_ms

            # Merge routes per vehicle
            merged: dict[str, VehicleRoute] = {}
            for route in all_routes:
                if route.vehicle_id in merged:
                    existing = merged[route.vehicle_id]
                    offset = len(existing.stops)
                    for s in route.stops:
                        s.sequence = offset + s.sequence
                    existing.stops.extend(route.stops)
                    existing.total_distance_km += route.total_distance_km
                    existing.total_duration_seconds += route.total_duration_seconds
                else:
                    merged[route.vehicle_id] = route

            return OptimizationResponse(
                success=True,
                routes=list(merged.values()),
                unassigned_stop_ids=all_unassigned,
                solve_time_ms=total_solve_ms,
                cluster_info=cluster_info,
            )

        return solve_vrptw(req.stops, req.vehicles, req.max_solve_seconds)

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8090)
