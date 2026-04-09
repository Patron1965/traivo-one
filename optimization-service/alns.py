"""
ALNS (Adaptive Large Neighborhood Search) + Local Search (2-opt, or-opt)

Post-optimization improvement phase that runs after OR-Tools produces an
initial solution. Respects all constraints: time windows, capacity, skills.
"""

import math
import random
import time
from typing import Optional


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class ALNSStop:
    __slots__ = ("id", "lat", "lng", "tw_start", "tw_end", "duration",
                 "skills", "demand", "priority", "loc_idx")

    def __init__(self, id: str, lat: float, lng: float,
                 tw_start: Optional[int], tw_end: Optional[int],
                 duration: int, skills: Optional[list[str]],
                 demand: int, priority: int, loc_idx: int):
        self.id = id
        self.lat = lat
        self.lng = lng
        self.tw_start = tw_start
        self.tw_end = tw_end
        self.duration = duration
        self.skills = skills or []
        self.demand = demand
        self.priority = priority
        self.loc_idx = loc_idx


class ALNSVehicle:
    __slots__ = ("id", "capacity", "skills", "home_lat", "home_lng",
                 "start_time", "end_time", "depot_idx")

    def __init__(self, id: str, capacity: int, skills: Optional[list[str]],
                 home_lat: float, home_lng: float,
                 start_time: int, end_time: int, depot_idx: int):
        self.id = id
        self.capacity = capacity
        self.skills = skills or []
        self.home_lat = home_lat
        self.home_lng = home_lng
        self.start_time = start_time
        self.end_time = end_time
        self.depot_idx = depot_idx


class ALNSRoute:
    __slots__ = ("vehicle", "stops")

    def __init__(self, vehicle: ALNSVehicle, stops: list[ALNSStop]):
        self.vehicle = vehicle
        self.stops = list(stops)

    def copy(self) -> "ALNSRoute":
        return ALNSRoute(self.vehicle, list(self.stops))


class ALNSSolution:
    def __init__(self, routes: list[ALNSRoute], unassigned: list[ALNSStop]):
        self.routes = routes
        self.unassigned = list(unassigned)

    def copy(self) -> "ALNSSolution":
        return ALNSSolution(
            [r.copy() for r in self.routes],
            list(self.unassigned),
        )

    def total_distance(self, dist_matrix: list[list[int]]) -> float:
        total = 0.0
        for route in self.routes:
            if not route.stops:
                continue
            depot = route.vehicle.depot_idx
            prev = depot
            for s in route.stops:
                total += dist_matrix[prev][s.loc_idx]
                prev = s.loc_idx
            total += dist_matrix[prev][depot]
        total += sum(s.priority * 100000 for s in self.unassigned)
        return total


def _route_feasible(route: ALNSRoute, time_matrix: list[list[int]],
                    dist_matrix: list[list[int]]) -> bool:
    v = route.vehicle
    current_time = v.start_time
    total_demand = 0
    prev_idx = v.depot_idx

    for s in route.stops:
        travel = time_matrix[prev_idx][s.loc_idx]
        arrival = current_time + travel
        if s.tw_end is not None and arrival > s.tw_end:
            return False
        effective_arrival = max(arrival, s.tw_start) if s.tw_start is not None else arrival
        departure = effective_arrival + s.duration
        if departure > v.end_time:
            return False
        if s.skills:
            if not all(sk in v.skills for sk in s.skills):
                return False
        total_demand += s.demand
        if total_demand > v.capacity:
            return False
        current_time = departure
        prev_idx = s.loc_idx

    return_travel = time_matrix[prev_idx][v.depot_idx]
    if current_time + return_travel > v.end_time:
        return False
    return True


def _route_cost(route: ALNSRoute, dist_matrix: list[list[int]]) -> float:
    if not route.stops:
        return 0.0
    depot = route.vehicle.depot_idx
    cost = dist_matrix[depot][route.stops[0].loc_idx]
    for i in range(len(route.stops) - 1):
        cost += dist_matrix[route.stops[i].loc_idx][route.stops[i + 1].loc_idx]
    cost += dist_matrix[route.stops[-1].loc_idx][depot]
    return cost


def _insertion_cost(route: ALNSRoute, pos: int, stop: ALNSStop,
                    dist_matrix: list[list[int]]) -> float:
    depot = route.vehicle.depot_idx
    prev_idx = depot if pos == 0 else route.stops[pos - 1].loc_idx
    next_idx = depot if pos >= len(route.stops) else route.stops[pos].loc_idx
    old_cost = dist_matrix[prev_idx][next_idx]
    new_cost = dist_matrix[prev_idx][stop.loc_idx] + dist_matrix[stop.loc_idx][next_idx]
    return new_cost - old_cost


def _try_insert(route: ALNSRoute, pos: int, stop: ALNSStop,
                time_matrix: list[list[int]], dist_matrix: list[list[int]]) -> bool:
    route.stops.insert(pos, stop)
    if _route_feasible(route, time_matrix, dist_matrix):
        return True
    route.stops.pop(pos)
    return False


# ---------------------------------------------------------------------------
# DESTROY OPERATORS
# ---------------------------------------------------------------------------

def destroy_random(solution: ALNSSolution, num_remove: int,
                   rng: random.Random, **_kw) -> list[ALNSStop]:
    all_stops = [(ri, si) for ri, r in enumerate(solution.routes) for si in range(len(r.stops))]
    if not all_stops:
        return []
    num_remove = min(num_remove, len(all_stops))
    selected = rng.sample(all_stops, num_remove)
    selected.sort(key=lambda x: x[1], reverse=True)
    removed: list[ALNSStop] = []
    for ri, si in selected:
        removed.append(solution.routes[ri].stops.pop(si))
    return removed


def destroy_worst(solution: ALNSSolution, num_remove: int,
                  dist_matrix: list[list[int]], rng: random.Random, **_kw) -> list[ALNSStop]:
    costs: list[tuple[float, int, int]] = []
    for ri, route in enumerate(solution.routes):
        depot = route.vehicle.depot_idx
        for si, stop in enumerate(route.stops):
            prev_idx = depot if si == 0 else route.stops[si - 1].loc_idx
            next_idx = depot if si == len(route.stops) - 1 else route.stops[si + 1].loc_idx
            with_stop = dist_matrix[prev_idx][stop.loc_idx] + dist_matrix[stop.loc_idx][next_idx]
            without_stop = dist_matrix[prev_idx][next_idx]
            detour = with_stop - without_stop
            costs.append((detour, ri, si))
    costs.sort(key=lambda x: -x[0])
    num_remove = min(num_remove, len(costs))
    noise_factor = max(0, rng.gauss(0, 0.1))
    to_remove: list[tuple[int, int]] = []
    for i in range(min(num_remove * 2, len(costs))):
        if len(to_remove) >= num_remove:
            break
        if rng.random() < 0.8 + noise_factor or i < num_remove:
            to_remove.append((costs[i][1], costs[i][2]))
    to_remove.sort(key=lambda x: x[1], reverse=True)
    removed: list[ALNSStop] = []
    seen = set()
    for ri, si in to_remove:
        if len(removed) >= num_remove:
            break
        key = (ri, si)
        if key in seen:
            continue
        seen.add(key)
        if si < len(solution.routes[ri].stops):
            removed.append(solution.routes[ri].stops.pop(si))
    return removed


def destroy_related(solution: ALNSSolution, num_remove: int,
                    dist_matrix: list[list[int]], rng: random.Random, **_kw) -> list[ALNSStop]:
    all_stops_flat = [(ri, si, s) for ri, r in enumerate(solution.routes) for si, s in enumerate(r.stops)]
    if not all_stops_flat:
        return []
    seed_ri, seed_si, seed_stop = rng.choice(all_stops_flat)
    relatedness: list[tuple[float, int, int]] = []
    for ri, si, s in all_stops_flat:
        if ri == seed_ri and si == seed_si:
            continue
        d = dist_matrix[seed_stop.loc_idx][s.loc_idx]
        tw_dist = 0
        if seed_stop.tw_start is not None and s.tw_start is not None:
            tw_dist = abs(seed_stop.tw_start - s.tw_start) // 10
        relatedness.append((d + tw_dist, ri, si))
    relatedness.sort(key=lambda x: x[0])
    num_remove = min(num_remove, len(relatedness) + 1)
    to_remove = [(seed_ri, seed_si)]
    for rel_d, ri, si in relatedness:
        if len(to_remove) >= num_remove:
            break
        if rng.random() < 0.9:
            to_remove.append((ri, si))
    to_remove.sort(key=lambda x: (x[0], x[1]), reverse=True)
    removed: list[ALNSStop] = []
    seen = set()
    for ri, si in to_remove:
        key = (ri, si)
        if key in seen:
            continue
        seen.add(key)
        if si < len(solution.routes[ri].stops):
            removed.append(solution.routes[ri].stops.pop(si))
    return removed


# ---------------------------------------------------------------------------
# REPAIR OPERATORS
# ---------------------------------------------------------------------------

def repair_greedy(solution: ALNSSolution, removed: list[ALNSStop],
                  dist_matrix: list[list[int]], time_matrix: list[list[int]],
                  rng: random.Random, **_kw) -> None:
    rng.shuffle(removed)
    for stop in removed:
        best_cost = float("inf")
        best_ri = -1
        best_pos = -1
        for ri, route in enumerate(solution.routes):
            for pos in range(len(route.stops) + 1):
                cost = _insertion_cost(route, pos, stop, dist_matrix)
                if cost < best_cost:
                    route.stops.insert(pos, stop)
                    if _route_feasible(route, time_matrix, dist_matrix):
                        best_cost = cost
                        best_ri = ri
                        best_pos = pos
                    route.stops.pop(pos)
        if best_ri >= 0:
            solution.routes[best_ri].stops.insert(best_pos, stop)
        else:
            solution.unassigned.append(stop)


def repair_regret2(solution: ALNSSolution, removed: list[ALNSStop],
                   dist_matrix: list[list[int]], time_matrix: list[list[int]],
                   rng: random.Random, **_kw) -> None:
    _repair_regret_n(solution, removed, dist_matrix, time_matrix, 2)


def repair_regret3(solution: ALNSSolution, removed: list[ALNSStop],
                   dist_matrix: list[list[int]], time_matrix: list[list[int]],
                   rng: random.Random, **_kw) -> None:
    _repair_regret_n(solution, removed, dist_matrix, time_matrix, 3)


def _repair_regret_n(solution: ALNSSolution, removed: list[ALNSStop],
                     dist_matrix: list[list[int]], time_matrix: list[list[int]],
                     n: int) -> None:
    pool = list(removed)
    while pool:
        best_regret = -float("inf")
        best_stop_idx = -1
        best_ri = -1
        best_pos = -1

        for si, stop in enumerate(pool):
            insertion_costs: list[tuple[float, int, int]] = []
            for ri, route in enumerate(solution.routes):
                for pos in range(len(route.stops) + 1):
                    cost = _insertion_cost(route, pos, stop, dist_matrix)
                    route.stops.insert(pos, stop)
                    feasible = _route_feasible(route, time_matrix, dist_matrix)
                    route.stops.pop(pos)
                    if feasible:
                        insertion_costs.append((cost, ri, pos))
            if not insertion_costs:
                continue
            insertion_costs.sort(key=lambda x: x[0])
            best_1 = insertion_costs[0][0]
            if len(insertion_costs) >= n:
                regret = sum(insertion_costs[k][0] - best_1 for k in range(1, n))
            elif len(insertion_costs) >= 2:
                regret = insertion_costs[1][0] - best_1
            else:
                regret = 1e9
            if regret > best_regret:
                best_regret = regret
                best_stop_idx = si
                best_ri = insertion_costs[0][1]
                best_pos = insertion_costs[0][2]

        if best_stop_idx < 0:
            solution.unassigned.extend(pool)
            break

        stop = pool.pop(best_stop_idx)
        solution.routes[best_ri].stops.insert(best_pos, stop)


# ---------------------------------------------------------------------------
# LOCAL SEARCH: 2-opt (intra-route)
# ---------------------------------------------------------------------------

def local_search_2opt(solution: ALNSSolution, dist_matrix: list[list[int]],
                      time_matrix: list[list[int]]) -> int:
    improvements = 0
    for route in solution.routes:
        if len(route.stops) < 3:
            continue
        improved = True
        while improved:
            improved = False
            n = len(route.stops)
            for i in range(n - 1):
                for j in range(i + 2, n):
                    depot = route.vehicle.depot_idx
                    prev_i = depot if i == 0 else route.stops[i - 1].loc_idx
                    a = route.stops[i].loc_idx
                    b = route.stops[j].loc_idx
                    next_j = depot if j == n - 1 else route.stops[j + 1].loc_idx
                    old_cost = dist_matrix[prev_i][a] + dist_matrix[b][next_j]
                    new_cost = dist_matrix[prev_i][b] + dist_matrix[a][next_j]
                    if new_cost < old_cost - 1:
                        route.stops[i:j + 1] = route.stops[i:j + 1][::-1]
                        if _route_feasible(route, time_matrix, dist_matrix):
                            improved = True
                            improvements += 1
                        else:
                            route.stops[i:j + 1] = route.stops[i:j + 1][::-1]
    return improvements


# ---------------------------------------------------------------------------
# LOCAL SEARCH: or-opt (move 1-3 consecutive stops within/between routes)
# ---------------------------------------------------------------------------

def local_search_oropt(solution: ALNSSolution, dist_matrix: list[list[int]],
                       time_matrix: list[list[int]]) -> int:
    improvements = 0
    improved = True
    while improved:
        improved = False
        for seg_len in (1, 2, 3):
            for src_ri, src_route in enumerate(solution.routes):
                if len(src_route.stops) < seg_len:
                    continue
                for src_pos in range(len(src_route.stops) - seg_len + 1):
                    segment = src_route.stops[src_pos:src_pos + seg_len]
                    depot_src = src_route.vehicle.depot_idx
                    prev_src = depot_src if src_pos == 0 else src_route.stops[src_pos - 1].loc_idx
                    after_src = depot_src if src_pos + seg_len >= len(src_route.stops) else src_route.stops[src_pos + seg_len].loc_idx
                    removal_saving = (
                        dist_matrix[prev_src][segment[0].loc_idx] +
                        dist_matrix[segment[-1].loc_idx][after_src] -
                        dist_matrix[prev_src][after_src]
                    )

                    best_gain = 0
                    best_dst_ri = -1
                    best_dst_pos = -1

                    for dst_ri, dst_route in enumerate(solution.routes):
                        max_pos = len(dst_route.stops) + 1
                        if dst_ri == src_ri:
                            max_pos = len(dst_route.stops) - seg_len + 1
                        for dst_pos in range(max_pos):
                            if dst_ri == src_ri and dst_pos >= src_pos and dst_pos <= src_pos + seg_len:
                                continue
                            depot_dst = dst_route.vehicle.depot_idx
                            if dst_ri == src_ri:
                                adj_pos = dst_pos if dst_pos < src_pos else dst_pos + seg_len
                                stops_copy = [s for i, s in enumerate(dst_route.stops) if i < src_pos or i >= src_pos + seg_len]
                                insert_pos = min(adj_pos if dst_pos < src_pos else dst_pos, len(stops_copy))
                                prev_dst = depot_dst if insert_pos == 0 else stops_copy[insert_pos - 1].loc_idx
                                next_dst = depot_dst if insert_pos >= len(stops_copy) else stops_copy[insert_pos].loc_idx
                            else:
                                prev_dst = depot_dst if dst_pos == 0 else dst_route.stops[dst_pos - 1].loc_idx
                                next_dst = depot_dst if dst_pos >= len(dst_route.stops) else dst_route.stops[dst_pos].loc_idx

                            insertion_cost = (
                                dist_matrix[prev_dst][segment[0].loc_idx] +
                                dist_matrix[segment[-1].loc_idx][next_dst] -
                                dist_matrix[prev_dst][next_dst]
                            )

                            gain = removal_saving - insertion_cost
                            if gain > best_gain:
                                best_gain = gain
                                best_dst_ri = dst_ri
                                best_dst_pos = dst_pos

                    if best_gain > 1 and best_dst_ri >= 0:
                        seg_copy = list(segment)
                        del src_route.stops[src_pos:src_pos + seg_len]
                        dst_route_obj = solution.routes[best_dst_ri]
                        actual_pos = best_dst_pos
                        if best_dst_ri == src_ri and best_dst_pos > src_pos:
                            actual_pos = best_dst_pos - seg_len
                        actual_pos = max(0, min(actual_pos, len(dst_route_obj.stops)))
                        for k, s in enumerate(seg_copy):
                            dst_route_obj.stops.insert(actual_pos + k, s)

                        if (_route_feasible(src_route, time_matrix, dist_matrix) and
                                _route_feasible(dst_route_obj, time_matrix, dist_matrix)):
                            improved = True
                            improvements += 1
                            break
                        else:
                            for s in seg_copy:
                                if s in dst_route_obj.stops:
                                    dst_route_obj.stops.remove(s)
                            for k, s in enumerate(seg_copy):
                                src_route.stops.insert(src_pos + k, s)
                if improved:
                    break
            if improved:
                break
    return improvements


# ---------------------------------------------------------------------------
# ALNS MAIN LOOP
# ---------------------------------------------------------------------------

class ALNSConfig:
    def __init__(self,
                 max_iterations: int = 200,
                 max_time_seconds: float = 10.0,
                 removal_fraction: float = 0.2,
                 min_removal: int = 2,
                 max_removal: int = 15,
                 initial_temperature: float = 100.0,
                 cooling_rate: float = 0.995,
                 weight_best: float = 10.0,
                 weight_better: float = 5.0,
                 weight_accepted: float = 2.0,
                 weight_decay: float = 0.8,
                 seed: int = 42):
        self.max_iterations = max_iterations
        self.max_time_seconds = max_time_seconds
        self.removal_fraction = removal_fraction
        self.min_removal = min_removal
        self.max_removal = max_removal
        self.initial_temperature = initial_temperature
        self.cooling_rate = cooling_rate
        self.weight_best = weight_best
        self.weight_better = weight_better
        self.weight_accepted = weight_accepted
        self.weight_decay = weight_decay
        self.seed = seed


class OperatorStats:
    def __init__(self, names: list[str]):
        self.names = names
        self.weights = [1.0] * len(names)
        self.scores = [0.0] * len(names)
        self.uses = [0] * len(names)

    def select(self, rng: random.Random) -> int:
        total = sum(self.weights)
        r = rng.random() * total
        cumulative = 0.0
        for i, w in enumerate(self.weights):
            cumulative += w
            if r <= cumulative:
                return i
        return len(self.weights) - 1

    def update(self, idx: int, score: float):
        self.scores[idx] += score
        self.uses[idx] += 1

    def decay(self, factor: float):
        for i in range(len(self.weights)):
            if self.uses[i] > 0:
                avg_score = self.scores[i] / self.uses[i]
                self.weights[i] = self.weights[i] * factor + (1 - factor) * avg_score
                self.weights[i] = max(0.1, self.weights[i])
            self.scores[i] = 0.0
            self.uses[i] = 0


def run_alns(solution: ALNSSolution,
             dist_matrix: list[list[int]],
             time_matrix: list[list[int]],
             config: Optional[ALNSConfig] = None) -> dict:
    if config is None:
        config = ALNSConfig()

    rng = random.Random(config.seed)
    start_time = time.time()

    if solution.unassigned:
        unassigned_copy = list(solution.unassigned)
        solution.unassigned = []
        repair_greedy(solution, unassigned_copy, dist_matrix=dist_matrix,
                      time_matrix=time_matrix, rng=rng)

    total_stops = sum(len(r.stops) for r in solution.routes)
    if total_stops < 4:
        ls_2opt = local_search_2opt(solution, dist_matrix, time_matrix)
        ls_oropt = local_search_oropt(solution, dist_matrix, time_matrix)
        return {
            "solution": solution,
            "iterations": 0,
            "initial_cost": solution.total_distance(dist_matrix),
            "final_cost": solution.total_distance(dist_matrix),
            "improvement_pct": 0.0,
            "ls_2opt_improvements": ls_2opt,
            "ls_oropt_improvements": ls_oropt,
            "operator_stats": {},
            "elapsed_ms": int((time.time() - start_time) * 1000),
        }

    destroy_ops = [
        ("random_removal", destroy_random),
        ("worst_removal", destroy_worst),
        ("related_removal", destroy_related),
    ]
    repair_ops = [
        ("greedy_insertion", repair_greedy),
        ("regret2_insertion", repair_regret2),
        ("regret3_insertion", repair_regret3),
    ]

    destroy_stats = OperatorStats([name for name, _ in destroy_ops])
    repair_stats = OperatorStats([name for name, _ in repair_ops])

    best_solution = solution.copy()
    best_cost = best_solution.total_distance(dist_matrix)
    current_cost = best_cost
    initial_cost = best_cost
    temperature = config.initial_temperature

    iterations_done = 0
    segment_size = 25

    for iteration in range(config.max_iterations):
        if time.time() - start_time > config.max_time_seconds:
            break

        num_remove = rng.randint(
            config.min_removal,
            min(config.max_removal, max(config.min_removal, int(total_stops * config.removal_fraction))),
        )

        candidate = solution.copy()

        d_idx = destroy_stats.select(rng)
        removed = destroy_ops[d_idx][1](
            candidate, num_remove, dist_matrix=dist_matrix, rng=rng,
        )

        r_idx = repair_stats.select(rng)
        repair_ops[r_idx][1](
            candidate, removed, dist_matrix=dist_matrix,
            time_matrix=time_matrix, rng=rng,
        )

        candidate_cost = candidate.total_distance(dist_matrix)

        accepted = False
        if candidate_cost < current_cost:
            solution = candidate
            current_cost = candidate_cost
            accepted = True

            if candidate_cost < best_cost:
                best_solution = candidate.copy()
                best_cost = candidate_cost
                destroy_stats.update(d_idx, config.weight_best)
                repair_stats.update(r_idx, config.weight_best)
            else:
                destroy_stats.update(d_idx, config.weight_better)
                repair_stats.update(r_idx, config.weight_better)
        else:
            delta = candidate_cost - current_cost
            if temperature > 0.01 and rng.random() < math.exp(-delta / (temperature * 1000)):
                solution = candidate
                current_cost = candidate_cost
                accepted = True
                destroy_stats.update(d_idx, config.weight_accepted)
                repair_stats.update(r_idx, config.weight_accepted)

        temperature *= config.cooling_rate
        iterations_done += 1

        if iteration > 0 and iteration % segment_size == 0:
            destroy_stats.decay(config.weight_decay)
            repair_stats.decay(config.weight_decay)

    solution = best_solution

    ls_2opt = local_search_2opt(solution, dist_matrix, time_matrix)
    ls_oropt = local_search_oropt(solution, dist_matrix, time_matrix)

    final_cost = solution.total_distance(dist_matrix)
    improvement_pct = ((initial_cost - final_cost) / initial_cost * 100) if initial_cost > 0 else 0

    op_stats = {}
    for i, name in enumerate(destroy_stats.names):
        op_stats[name] = round(destroy_stats.weights[i], 2)
    for i, name in enumerate(repair_stats.names):
        op_stats[name] = round(repair_stats.weights[i], 2)

    elapsed_ms = int((time.time() - start_time) * 1000)

    print(f"[alns] {iterations_done} iterations, cost {initial_cost:.0f} → {final_cost:.0f} "
          f"({improvement_pct:.1f}% improvement), 2-opt: {ls_2opt}, or-opt: {ls_oropt}, "
          f"time: {elapsed_ms}ms")

    return {
        "solution": solution,
        "iterations": iterations_done,
        "initial_cost": initial_cost,
        "final_cost": final_cost,
        "improvement_pct": round(improvement_pct, 2),
        "ls_2opt_improvements": ls_2opt,
        "ls_oropt_improvements": ls_oropt,
        "operator_stats": op_stats,
        "elapsed_ms": elapsed_ms,
    }
