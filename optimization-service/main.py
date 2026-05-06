"""
Traivo OR-Tools Optimization Service
Fristående Python FastAPI-mikrotjänst som löser CVRPTW
(Capacitated Vehicle Routing Problem with Time Windows) med Google OR-Tools.

Endpoint: POST /optimize
Health:  GET /health
Port:    8090
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import math
import time

app = FastAPI(title="Traivo Optimization Service", version="1.0.0")

try:
    from ortools.constraint_solver import routing_enums_pb2, pywrapcp
    HAS_ORTOOLS = True
except ImportError:
    HAS_ORTOOLS = False

try:
    from sklearn.cluster import KMeans, DBSCAN
    import numpy as np
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False


class Stop(BaseModel):
    id: str
    lat: float
    lng: float
    time_window: Optional[list[int]] = None
    duration: int = 1800
    required_skills: Optional[list[str]] = None
    demand: int = 1
    priority: int = 1
    depends_on: Optional[list[str]] = None


class Vehicle(BaseModel):
    id: str
    capacity: int = 100
    skills: Optional[list[str]] = None
    home_lat: float = 59.33
    home_lng: float = 18.07
    start_time: int = 28800
    end_time: int = 61200


class DistanceMatrixEntry(BaseModel):
    from_idx: int
    to_idx: int
    distance_m: int
    duration_s: int


class OptimizeRequest(BaseModel):
    stops: list[Stop]
    vehicles: list[Vehicle]
    max_solve_seconds: int = Field(default=30, ge=1, le=300)
    distance_matrix: Optional[list[DistanceMatrixEntry]] = None
    alns_time_fraction: float = Field(default=0.4, ge=0.0, le=0.9)
    dependencies: Optional[list[list[str]]] = None


class RouteStopResult(BaseModel):
    stop_id: str
    sequence: int
    arrival_time: int
    departure_time: int


class RouteResult(BaseModel):
    vehicle_id: str
    stops: list[RouteStopResult]
    total_distance_km: float
    total_duration_seconds: int


class OptimizeResponse(BaseModel):
    success: bool
    routes: list[RouteResult]
    unassigned_stop_ids: list[str]
    solve_time_ms: int
    solver: str


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def build_distance_matrix(locations: list[tuple[float, float]], precomputed: Optional[list[DistanceMatrixEntry]] = None) -> list[list[int]]:
    n = len(locations)
    matrix = [[0] * n for _ in range(n)]
    if precomputed:
        for entry in precomputed:
            if 0 <= entry.from_idx < n and 0 <= entry.to_idx < n:
                matrix[entry.from_idx][entry.to_idx] = entry.distance_m
        for i in range(n):
            for j in range(n):
                if i != j and matrix[i][j] == 0:
                    dist_km = haversine_km(locations[i][0], locations[i][1], locations[j][0], locations[j][1])
                    matrix[i][j] = int(dist_km * 1000)
        return matrix
    for i in range(n):
        for j in range(n):
            if i != j:
                dist_km = haversine_km(locations[i][0], locations[i][1], locations[j][0], locations[j][1])
                matrix[i][j] = int(dist_km * 1000)
    return matrix


def build_time_matrix(locations: list[tuple[float, float]], precomputed: Optional[list[DistanceMatrixEntry]] = None) -> list[list[int]]:
    n = len(locations)
    matrix = [[0] * n for _ in range(n)]
    if precomputed:
        for entry in precomputed:
            if 0 <= entry.from_idx < n and 0 <= entry.to_idx < n:
                matrix[entry.from_idx][entry.to_idx] = entry.duration_s
        for i in range(n):
            for j in range(n):
                if i != j and matrix[i][j] == 0:
                    dist_km = haversine_km(locations[i][0], locations[i][1], locations[j][0], locations[j][1])
                    matrix[i][j] = int(dist_km / 40 * 3600)
        return matrix
    for i in range(n):
        for j in range(n):
            if i != j:
                dist_km = haversine_km(locations[i][0], locations[i][1], locations[j][0], locations[j][1])
                matrix[i][j] = int(dist_km / 40 * 3600)
    return matrix


def temporal_distance(a: Stop, b: Stop) -> float:
    tw_a = a.time_window
    tw_b = b.time_window
    if not tw_a or not tw_b or len(tw_a) < 2 or len(tw_b) < 2:
        return 0.0
    overlap_start = max(tw_a[0], tw_b[0])
    overlap_end = min(tw_a[1], tw_b[1])
    overlap = max(0, overlap_end - overlap_start)
    max_span = max(tw_a[1] - tw_a[0], tw_b[1] - tw_b[0])
    if max_span == 0:
        return 0.0
    return 1.0 - (overlap / max_span)


def dbscan_pre_cluster(
    stops: list[Stop],
    n_clusters: int,
    epsilon_km: float = 15.0,
    min_samples: int = 3,
    temporal_weight: float = 0.3,
) -> list[list[Stop]]:
    if not HAS_SKLEARN or len(stops) <= min_samples:
        return [stops]

    max_geo_dist = 1.0
    for i in range(len(stops)):
        for j in range(i + 1, len(stops)):
            d = haversine_km(stops[i].lat, stops[i].lng, stops[j].lat, stops[j].lng)
            if d > max_geo_dist:
                max_geo_dist = d

    n = len(stops)
    dist_matrix = np.zeros((n, n))
    geo_weight = 1.0 - temporal_weight
    for i in range(n):
        for j in range(i + 1, n):
            geo_d = haversine_km(stops[i].lat, stops[i].lng, stops[j].lat, stops[j].lng)
            norm_geo = geo_d / max_geo_dist
            temp_d = temporal_distance(stops[i], stops[j])
            combined = (geo_weight * norm_geo + temporal_weight * temp_d) * max_geo_dist
            dist_matrix[i][j] = combined
            dist_matrix[j][i] = combined

    dbscan = DBSCAN(eps=epsilon_km, min_samples=min_samples, metric="precomputed")
    labels = dbscan.fit_predict(dist_matrix)

    unique_labels = set(labels)
    unique_labels.discard(-1)

    if len(unique_labels) <= 1:
        return pre_cluster_kmeans(stops, n_clusters)

    clusters: dict[int, list[Stop]] = {}
    noise: list[Stop] = []
    for i, label in enumerate(labels):
        if label == -1:
            noise.append(stops[i])
        else:
            clusters.setdefault(int(label), []).append(stops[i])

    cluster_list = list(clusters.values())

    for ns in noise:
        best_idx = 0
        best_dist = float("inf")
        for ci, cl in enumerate(cluster_list):
            centroid_lat = sum(s.lat for s in cl) / len(cl)
            centroid_lng = sum(s.lng for s in cl) / len(cl)
            geo_d = haversine_km(ns.lat, ns.lng, centroid_lat, centroid_lng)
            norm_geo = geo_d / max_geo_dist if max_geo_dist > 0 else 0
            rep_stop = cl[0]
            temp_d = temporal_distance(ns, rep_stop)
            combined = ((1.0 - temporal_weight) * norm_geo + temporal_weight * temp_d) * max_geo_dist
            if combined < best_dist:
                best_dist = combined
                best_idx = ci
        cluster_list[best_idx].append(ns)

    noise_count = len(noise)
    print(f"[dbscan-py] {len(stops)} stops → {len(cluster_list)} clusters, {noise_count} noise points assigned")
    return cluster_list


def pre_cluster_kmeans(stops: list[Stop], n_clusters: int) -> list[list[Stop]]:
    if not HAS_SKLEARN or len(stops) <= n_clusters:
        return [stops]
    coords = np.array([[s.lat, s.lng] for s in stops])
    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = kmeans.fit_predict(coords)
    clusters: dict[int, list[Stop]] = {}
    for i, label in enumerate(labels):
        clusters.setdefault(int(label), []).append(stops[i])
    return list(clusters.values())


def pre_cluster(stops: list[Stop], n_clusters: int) -> list[list[Stop]]:
    if not HAS_SKLEARN or len(stops) <= n_clusters:
        return [stops]
    try:
        return dbscan_pre_cluster(stops, n_clusters)
    except Exception as e:
        print(f"[dbscan-py] DBSCAN failed, falling back to K-Means: {e}")
        return pre_cluster_kmeans(stops, n_clusters)


def solve_nearest_neighbor(stops: list[Stop], vehicles: list[Vehicle]) -> OptimizeResponse:
    start_time = time.time()
    routes: list[RouteResult] = []
    assigned_ids: set[str] = set()

    remaining = list(stops)

    for vehicle in vehicles:
        if not remaining:
            break

        route_stops: list[RouteStopResult] = []
        current_lat, current_lng = vehicle.home_lat, vehicle.home_lng
        current_time = vehicle.start_time
        total_dist = 0.0
        sequence = 1
        unvisited = list(remaining)

        while unvisited:
            best_idx = -1
            best_dist = float("inf")
            for idx, stop in enumerate(unvisited):
                d = haversine_km(current_lat, current_lng, stop.lat, stop.lng)
                if d < best_dist:
                    travel_seconds = int(d / 40 * 3600)
                    arrival = current_time + travel_seconds
                    if stop.time_window and arrival > stop.time_window[1]:
                        continue
                    departure = max(arrival, stop.time_window[0] if stop.time_window else arrival) + stop.duration
                    if departure > vehicle.end_time:
                        continue
                    best_dist = d
                    best_idx = idx

            if best_idx == -1:
                break

            stop = unvisited.pop(best_idx)
            travel_seconds = int(best_dist / 40 * 3600)
            arrival = current_time + travel_seconds
            effective_arrival = max(arrival, stop.time_window[0] if stop.time_window else arrival)
            departure = effective_arrival + stop.duration

            route_stops.append(RouteStopResult(
                stop_id=stop.id,
                sequence=sequence,
                arrival_time=effective_arrival,
                departure_time=departure,
            ))

            total_dist += best_dist
            current_lat, current_lng = stop.lat, stop.lng
            current_time = departure
            assigned_ids.add(stop.id)
            sequence += 1

        remaining = [s for s in remaining if s.id not in assigned_ids]

        if route_stops:
            return_dist = haversine_km(current_lat, current_lng, vehicle.home_lat, vehicle.home_lng)
            total_dist += return_dist
            routes.append(RouteResult(
                vehicle_id=vehicle.id,
                stops=route_stops,
                total_distance_km=round(total_dist, 2),
                total_duration_seconds=current_time - vehicle.start_time + int(return_dist / 40 * 3600),
            ))

    unassigned = [s.id for s in stops if s.id not in assigned_ids]
    solve_ms = int((time.time() - start_time) * 1000)

    return OptimizeResponse(
        success=True,
        routes=routes,
        unassigned_stop_ids=unassigned,
        solve_time_ms=solve_ms,
        solver="nearest_neighbor",
    )


def solve_ortools(stops: list[Stop], vehicles: list[Vehicle], max_seconds: int, precomputed_matrix: Optional[list[DistanceMatrixEntry]] = None, alns_time_fraction: float = 0.4, dep_edges: Optional[list[list[str]]] = None) -> OptimizeResponse:
    if not HAS_ORTOOLS:
        return solve_nearest_neighbor(stops, vehicles)

    start_time = time.time()

    locations: list[tuple[float, float]] = []
    depot_indices: list[int] = []

    for v in vehicles:
        depot_indices.append(len(locations))
        locations.append((v.home_lat, v.home_lng))

    stop_start_index = len(locations)
    for s in stops:
        locations.append((s.lat, s.lng))

    distance_matrix = build_distance_matrix(locations, precomputed_matrix)
    time_matrix = build_time_matrix(locations, precomputed_matrix)

    manager = pywrapcp.RoutingIndexManager(len(locations), len(vehicles), depot_indices, depot_indices)
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return distance_matrix[from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    def time_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        travel = time_matrix[from_node][to_node]
        if travel == 0 and from_node != to_node:
            travel = int(distance_matrix[from_node][to_node] * 3600 / (40 * 1000))
        service = 0
        if to_node >= stop_start_index:
            service = stops[to_node - stop_start_index].duration
        return travel + service

    time_callback_index = routing.RegisterTransitCallback(time_callback)

    routing.AddDimension(time_callback_index, 3600, 36000, False, "Time")
    time_dimension = routing.GetDimensionOrDie("Time")

    for i, v in enumerate(vehicles):
        idx = routing.Start(i)
        time_dimension.CumulVar(idx).SetRange(v.start_time, v.end_time)
        idx_end = routing.End(i)
        time_dimension.CumulVar(idx_end).SetRange(v.start_time, v.end_time)

    for si, stop in enumerate(stops):
        node = stop_start_index + si
        idx = manager.NodeToIndex(node)
        if stop.time_window:
            time_dimension.CumulVar(idx).SetRange(stop.time_window[0], stop.time_window[1])

    for node in range(stop_start_index, stop_start_index + len(stops)):
        routing.AddDisjunction([manager.NodeToIndex(node)], 100000)

    ortools_budget = max(1, int(max_seconds * (1.0 - alns_time_fraction)))
    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    search_parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    search_parameters.time_limit.seconds = ortools_budget

    solution = routing.SolveWithParameters(search_parameters)

    if not solution:
        return solve_nearest_neighbor(stops, vehicles)

    routes: list[RouteResult] = []
    assigned_ids: set[str] = set()

    for vi in range(len(vehicles)):
        route_stops: list[RouteStopResult] = []
        index = routing.Start(vi)
        total_dist = 0.0
        prev_node = manager.IndexToNode(index)
        sequence = 1

        while not routing.IsEnd(index):
            next_index = solution.Value(routing.NextVar(index))
            node = manager.IndexToNode(next_index)
            if node >= stop_start_index and not routing.IsEnd(next_index):
                stop_idx = node - stop_start_index
                arrival = solution.Value(time_dimension.CumulVar(next_index))
                departure = arrival + stops[stop_idx].duration
                route_stops.append(RouteStopResult(
                    stop_id=stops[stop_idx].id,
                    sequence=sequence,
                    arrival_time=arrival,
                    departure_time=departure,
                ))
                assigned_ids.add(stops[stop_idx].id)
                sequence += 1

            total_dist += distance_matrix[prev_node][node] / 1000
            prev_node = node
            index = next_index

        if route_stops:
            end_time = solution.Value(time_dimension.CumulVar(index))
            start_t = vehicles[vi].start_time
            routes.append(RouteResult(
                vehicle_id=vehicles[vi].id,
                stops=route_stops,
                total_distance_km=round(total_dist, 2),
                total_duration_seconds=end_time - start_t,
            ))

    unassigned_stops = [s for s in stops if s.id not in assigned_ids]

    ortools_routes = list(routes)
    ortools_unassigned_ids = [s.id for s in unassigned_stops]

    alns_budget = max(1, max_seconds - ortools_budget)
    try:
        from alns import ALNSStop as AStop, ALNSVehicle as AVehicle, ALNSRoute as ARoute
        from alns import ALNSSolution as ASolution, ALNSConfig, run_alns

        dep_by_stop: dict[str, list[str]] = {}
        depended_by: dict[str, list[str]] = {}
        if dep_edges:
            for edge in dep_edges:
                if len(edge) >= 2:
                    before_id, after_id = edge[0], edge[1]
                    dep_by_stop.setdefault(after_id, []).append(before_id)
                    depended_by.setdefault(before_id, []).append(after_id)
        for s in stops:
            if s.depends_on:
                for dep_id in s.depends_on:
                    dep_by_stop.setdefault(s.id, []).append(dep_id)
                    depended_by.setdefault(dep_id, []).append(s.id)

        alns_stops_by_id: dict[str, AStop] = {}
        for si_idx, s in enumerate(stops):
            alns_stops_by_id[s.id] = AStop(
                id=s.id, lat=s.lat, lng=s.lng,
                tw_start=s.time_window[0] if s.time_window else None,
                tw_end=s.time_window[1] if s.time_window else None,
                duration=s.duration,
                skills=[str(sk) for sk in (s.required_skills or [])],
                demand=s.demand, priority=s.priority,
                loc_idx=stop_start_index + si_idx,
                depends_on_ids=dep_by_stop.get(s.id, []),
                depended_by_ids=depended_by.get(s.id, []),
            )

        alns_vehicles: list[AVehicle] = []
        for vi_idx, v in enumerate(vehicles):
            alns_vehicles.append(AVehicle(
                id=v.id, capacity=v.capacity,
                skills=[str(sk) for sk in (v.skills or [])],
                home_lat=v.home_lat, home_lng=v.home_lng,
                start_time=v.start_time, end_time=v.end_time,
                depot_idx=depot_indices[vi_idx],
            ))

        vehicle_map = {v.id: v for v in alns_vehicles}
        vehicles_with_routes: set[str] = set()

        alns_routes: list[ARoute] = []
        for r in ortools_routes:
            av = vehicle_map.get(r.vehicle_id)
            if not av:
                continue
            r_stops = [alns_stops_by_id[rs.stop_id] for rs in r.stops if rs.stop_id in alns_stops_by_id]
            alns_routes.append(ARoute(av, r_stops))
            vehicles_with_routes.add(r.vehicle_id)

        for av in alns_vehicles:
            if av.id not in vehicles_with_routes:
                alns_routes.append(ARoute(av, []))

        alns_unassigned = [alns_stops_by_id[s.id] for s in unassigned_stops if s.id in alns_stops_by_id]

        alns_solution = ASolution(alns_routes, alns_unassigned)
        alns_config = ALNSConfig(
            max_iterations=min(500, len(stops) * 20),
            max_time_seconds=float(alns_budget),
        )

        alns_result = run_alns(alns_solution, distance_matrix, time_matrix, alns_config)
        improved_solution: ASolution = alns_result["solution"]

        improved_routes: list[RouteResult] = []
        improved_assigned: set[str] = set()
        for ar in improved_solution.routes:
            if not ar.stops:
                continue
            r_stops: list[RouteStopResult] = []
            current_time = ar.vehicle.start_time
            prev_idx = ar.vehicle.depot_idx
            total_dist_km = 0.0
            for seq, ast in enumerate(ar.stops, 1):
                travel = time_matrix[prev_idx][ast.loc_idx]
                arrival = current_time + travel
                effective_arrival = max(arrival, ast.tw_start) if ast.tw_start is not None else arrival
                departure = effective_arrival + ast.duration
                r_stops.append(RouteStopResult(
                    stop_id=ast.id, sequence=seq,
                    arrival_time=effective_arrival,
                    departure_time=departure,
                ))
                total_dist_km += distance_matrix[prev_idx][ast.loc_idx] / 1000
                improved_assigned.add(ast.id)
                current_time = departure
                prev_idx = ast.loc_idx
            total_dist_km += distance_matrix[prev_idx][ar.vehicle.depot_idx] / 1000
            return_travel = time_matrix[prev_idx][ar.vehicle.depot_idx]
            improved_routes.append(RouteResult(
                vehicle_id=ar.vehicle.id,
                stops=r_stops,
                total_distance_km=round(total_dist_km, 2),
                total_duration_seconds=current_time - ar.vehicle.start_time + return_travel,
            ))

        from alns import _route_feasible as alns_feasible, _solution_dependencies_valid as alns_deps_valid
        from alns import _compute_route_schedule

        all_schedule: dict[str, tuple[int, int]] = {}
        for ar in improved_solution.routes:
            sched = _compute_route_schedule(ar, time_matrix)
            all_schedule.update(sched)

        all_feasible = True
        for ar in improved_solution.routes:
            if ar.stops and not alns_feasible(ar, time_matrix, distance_matrix, global_schedule=all_schedule):
                all_feasible = False
                print(f"[alns] WARNING: Route for vehicle {ar.vehicle.id} failed final feasibility check")
                break

        if not alns_deps_valid(improved_solution, time_matrix):
            all_feasible = False
            print("[alns] WARNING: Final solution failed dependency validation")

        if all_feasible:
            routes = improved_routes
            unassigned_ids = [s.id for s in stops if s.id not in improved_assigned]
            solver_name = "ortools+alns"
        else:
            print("[alns] Final validation failed, falling back to OR-Tools solution")
            routes = ortools_routes
            unassigned_ids = ortools_unassigned_ids
            solver_name = "ortools"
    except Exception as e:
        print(f"[alns] ALNS improvement phase failed, using OR-Tools solution: {e}")
        routes = ortools_routes
        unassigned_ids = ortools_unassigned_ids
        solver_name = "ortools"

    solve_ms = int((time.time() - start_time) * 1000)

    return OptimizeResponse(
        success=True,
        routes=routes,
        unassigned_stop_ids=unassigned_ids,
        solve_time_ms=solve_ms,
        solver=solver_name,
    )


try:
    from alns import run_alns as _alns_check
    HAS_ALNS = True
except ImportError:
    HAS_ALNS = False


@app.get("/health")
def health():
    return {
        "status": "ok",
        "ortools_available": HAS_ORTOOLS,
        "sklearn_available": HAS_SKLEARN,
        "alns_available": HAS_ALNS,
    }


@app.post("/optimize", response_model=OptimizeResponse)
def optimize(req: OptimizeRequest):
    if not req.stops:
        raise HTTPException(status_code=400, detail="No stops provided")
    if not req.vehicles:
        raise HTTPException(status_code=400, detail="No vehicles provided")

    if len(req.stops) > 50 and HAS_SKLEARN and not req.distance_matrix:
        n_clusters = max(len(req.vehicles), len(req.stops) // 20)
        clusters = pre_cluster(req.stops, n_clusters)
        all_routes: list[RouteResult] = []
        all_unassigned: list[str] = []
        total_solve_ms = 0

        for cluster_stops in clusters:
            if HAS_ORTOOLS:
                result = solve_ortools(cluster_stops, req.vehicles, req.max_solve_seconds,
                                       alns_time_fraction=req.alns_time_fraction, dep_edges=req.dependencies)
            else:
                result = solve_nearest_neighbor(cluster_stops, req.vehicles)
            all_routes.extend(result.routes)
            all_unassigned.extend(result.unassigned_stop_ids)
            total_solve_ms += result.solve_time_ms

        return OptimizeResponse(
            success=True,
            routes=all_routes,
            unassigned_stop_ids=all_unassigned,
            solve_time_ms=total_solve_ms,
            solver="ortools_clustered" if HAS_ORTOOLS else "nearest_neighbor_clustered",
        )

    if HAS_ORTOOLS:
        return solve_ortools(req.stops, req.vehicles, req.max_solve_seconds, req.distance_matrix,
                             alns_time_fraction=req.alns_time_fraction, dep_edges=req.dependencies)
    return solve_nearest_neighbor(req.stops, req.vehicles)


# ============================================
# Task #421: ML duration-prediktion (Fas 1 — scaffolding)
# ============================================
class PredictionRequestRow(BaseModel):
    workOrderId: str
    estimatedDurationMin: int
    executionCode: Optional[str] = None
    taskCategory: Optional[str] = None
    weekday: Optional[int] = None
    hourOfDay: Optional[int] = None
    isWeekend: Optional[bool] = None
    objectLat: Optional[float] = None
    objectLng: Optional[float] = None


class PredictionBatchRequest(BaseModel):
    tenantId: str
    rows: list[PredictionRequestRow]


class PredictionResultRow(BaseModel):
    workOrderId: str
    predictedDurationMin: int
    p50: int
    modelVersion: str
    fallbackUsed: bool


class PredictionBatchResponse(BaseModel):
    predictions: list[PredictionResultRow]
    modelLoaded: bool


# Scaffolding: ingen modell laddas förrän Fas 0-audit returnerar GO.
# Vid GO-beslut: ladda .lgb från Object Storage här och cacha i minnet.
_loaded_model = None
_loaded_model_version = "none"


@app.post("/predict/durations", response_model=PredictionBatchResponse)
def predict_durations(req: PredictionBatchRequest):
    """Returnerar fallback (= estimatedDurationMin) tills modell laddats.
    Caller (mlPredictionClient.ts) faller då tillbaka på heuristisk skattning."""
    if _loaded_model is None:
        return PredictionBatchResponse(
            predictions=[
                PredictionResultRow(
                    workOrderId=r.workOrderId,
                    predictedDurationMin=r.estimatedDurationMin,
                    p50=r.estimatedDurationMin,
                    modelVersion=_loaded_model_version,
                    fallbackUsed=True,
                )
                for r in req.rows
            ],
            modelLoaded=False,
        )

    # När modellen finns: bygg feature-matris och kör _loaded_model.predict(...)
    raise HTTPException(status_code=501, detail="Model loaded but inference not yet implemented")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8090)
