"""
AI Dispatch Engine — OR-Tools VRP solver with time windows, capacity constraints,
and heterogeneous vehicle fleet support.

Supports mixed vehicle types (e.g. small vans + large trucks) in a single dispatch run.
Each vehicle type has its own weight/volume capacity and cost-per-km.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

EARTH_R = 6371000


# ---- Utility ----

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return EARTH_R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _time_to_minutes(t: str) -> int:
    if not t or ":" not in t:
        return 0
    try:
        h, m = t.split(":")
        return int(h) * 60 + int(m)
    except (ValueError, TypeError):
        return 0


def _minutes_to_time(m: int) -> str:
    h = m // 60
    mm = m % 60
    return f"{h:02d}:{mm:02d}"


def _build_matrices(
    stops: list[dict],
    depot_lat: float,
    depot_lon: float,
    speed_kmh: float = 30.0,
) -> tuple[list[list[int]], list[list[int]]]:
    coords = [(depot_lat, depot_lon)] + [(s["lat"], s["lon"]) for s in stops]
    n = len(coords)
    dist_m = [[0] * n for _ in range(n)]
    time_m = [[0] * n for _ in range(n)]
    speed_m_per_min = speed_kmh * 1000 / 60

    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            d = haversine(coords[i][0], coords[i][1], coords[j][0], coords[j][1])
            dist_m[i][j] = int(d)
            time_m[i][j] = int(d / speed_m_per_min)
    return dist_m, time_m


# ---- Data classes ----

@dataclass
class VehicleType:
    """Definition of one vehicle type in the fleet."""
    name: str = "Standard"
    max_weight_kg: float = 600
    max_volume_l: float = 6000
    cost_per_km: float = 100     # relative cost (higher = more expensive to use)
    count: int = 1               # how many of this type in the fleet


@dataclass
class DispatchConfig:
    depot_lat: float = 32.8121
    depot_lon: float = 130.7501
    depot_open: str = "08:00"
    depot_close: str = "18:00"
    speed_kmh: float = 30.0
    service_time_min: int = 5
    solver_timeout_sec: int = 15
    # Fleet: one VehicleType per entry (e.g. 3 small vans + 2 trucks)
    fleet: list[VehicleType] = field(default_factory=lambda: [
        VehicleType(name="Small Van", max_weight_kg=400, max_volume_l=3000, cost_per_km=80, count=3),
        VehicleType(name="Standard", max_weight_kg=600, max_volume_l=6000, cost_per_km=100, count=2),
    ])

    @property
    def total_vehicles(self) -> int:
        return sum(v.count for v in self.fleet)

    def vehicle_name(self, vid: int) -> str:
        """Map vehicle index to a user-friendly name."""
        idx = 0
        for vt in self.fleet:
            for i in range(vt.count):
                if idx == vid:
                    return f"{vt.name} #{i + 1}"
                idx += 1
        return f"Vehicle {vid}"


@dataclass
class DispatchResult:
    routes: list[dict] = field(default_factory=list)
    summary: dict = field(default_factory=dict)
    solver_info: str = ""


# ---- Solver ----

def run(stops: list[dict], config: Optional[DispatchConfig] = None) -> DispatchResult:
    if not stops:
        return DispatchResult()

    cfg = config or DispatchConfig()
    n_stops = len(stops)
    num_vehicles = cfg.total_vehicles

    if num_vehicles == 0:
        return DispatchResult(summary={"error": "No vehicles configured", "routes": 0})

    # --- Build matrices ---
    dist_m, time_m = _build_matrices(stops, cfg.depot_lat, cfg.depot_lon, cfg.speed_kmh)
    depot_open = _time_to_minutes(cfg.depot_open)
    depot_close = _time_to_minutes(cfg.depot_close)
    route_window = depot_close - depot_open

    # --- Per-vehicle capacities & costs ---
    weight_caps = []   # one per vehicle (flattened fleet)
    volume_caps = []
    cost_factors = []  # relative cost-per-km per vehicle
    vehicle_ids = []   # (VehicleType idx in fleet, instance number)
    vt_idx = 0
    for vt in cfg.fleet:
        for i in range(vt.count):
            weight_caps.append(int(vt.max_weight_kg))
            volume_caps.append(int(vt.max_volume_l))
            cost_factors.append(vt.cost_per_km)
            vehicle_ids.append(vt_idx)
        vt_idx += 1

    # --- Time windows per stop ---
    stop_time_windows: list[tuple[int, int]] = []
    for s in stops:
        tw = s.get("timeWindow", "")
        if tw and "-" in tw:
            parts = tw.split("-")
            ready = _time_to_minutes(parts[0].strip())
            due = _time_to_minutes(parts[1].strip())
        else:
            ready = depot_open
            due = depot_close
        ready = max(ready, depot_open)
        due = min(due, depot_close)
        if ready >= due:
            ready = due - 15
        stop_time_windows.append((ready, due))

    service_times = [0] + [cfg.service_time_min] * n_stops
    weights = [0] + [int(s["weight"]) for s in stops]
    volumes = [0] + [int(s["volume"]) for s in stops]

    # --- OR-Tools Model ---
    manager = pywrapcp.RoutingIndexManager(n_stops + 1, num_vehicles, 0)
    routing = pywrapcp.RoutingModel(manager)

    # Distance + cost callback: cost = distance (m) × cost_factor
    def cost_cb(from_idx, to_idx):
        from_node = manager.IndexToNode(from_idx)
        to_node = manager.IndexToNode(to_idx)
        return dist_m[from_node][to_node]

    dist_idx = routing.RegisterTransitCallback(cost_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(dist_idx)

    # Prefer cheaper vehicles via fixed cost (penalty for using a vehicle at all)
    for vid in range(num_vehicles):
        routing.SetFixedCostOfVehicle(int(cost_factors[vid] * 100), vid)

    # Time dimension
    def time_cb(from_idx, to_idx):
        from_node = manager.IndexToNode(from_idx)
        to_node = manager.IndexToNode(to_idx)
        return time_m[from_node][to_node] + service_times[from_node]

    time_idx = routing.RegisterTransitCallback(time_cb)
    routing.AddDimension(time_idx, route_window, route_window, True, "Time")
    time_dim = routing.GetDimensionOrDie("Time")

    # Stop time windows (relative to route start = 0 = depot_open)
    for i in range(1, n_stops + 1):
        idx = manager.NodeToIndex(i)
        if idx == -1:
            continue
        ready, due = stop_time_windows[i - 1]
        ready_rel = ready - depot_open
        due_rel = due - depot_open
        if ready_rel >= due_rel:
            ready_rel = max(0, due_rel - 15)
        time_dim.CumulVar(idx).SetRange(max(0, ready_rel), min(route_window, due_rel))

    for v in range(num_vehicles):
        time_dim.CumulVar(routing.End(v)).SetRange(0, route_window)

    # Weight capacity — per-vehicle
    def weight_cb(from_idx):
        return weights[manager.IndexToNode(from_idx)]

    weight_idx = routing.RegisterUnaryTransitCallback(weight_cb)
    routing.AddDimensionWithVehicleCapacity(weight_idx, 0, weight_caps, True, "Weight")

    # Volume capacity — per-vehicle
    def volume_cb(from_idx):
        return volumes[manager.IndexToNode(from_idx)]

    volume_idx = routing.RegisterUnaryTransitCallback(volume_cb)
    routing.AddDimensionWithVehicleCapacity(volume_idx, 0, volume_caps, True, "Volume")

    # --- Solve ---
    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    search_params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    search_params.time_limit.seconds = cfg.solver_timeout_sec
    search_params.log_search = False

    solution = routing.SolveWithParameters(search_params)

    if not solution:
        return DispatchResult(
            summary={"error": "No feasible solution found", "routes": 0},
            solver_info="OR-Tools returned no solution within constraints",
        )

    # --- Extract routes ---
    routes = []
    total_km = 0.0
    total_duration = 0
    total_cost = 0.0

    for vid in range(num_vehicles):
        idx = routing.Start(vid)
        if routing.IsEnd(idx):
            continue

        route_nodes = []
        while not routing.IsEnd(idx):
            node = manager.IndexToNode(idx)
            if node != 0:
                route_nodes.append(node - 1)
            idx = solution.Value(routing.NextVar(idx))

        if not route_nodes:
            continue

        vt = cfg.fleet[vehicle_ids[vid]]
        ordered_stops = [stops[i] for i in route_nodes]
        geometry = [[cfg.depot_lon, cfg.depot_lat]]
        for s in ordered_stops:
            geometry.append([s["lon"], s["lat"]])
        geometry.append([cfg.depot_lon, cfg.depot_lat])

        km = 0.0
        prev = 0
        for node in route_nodes:
            km += dist_m[prev][node + 1] / 1000
            prev = node + 1
        km += dist_m[prev][0] / 1000
        km = round(km, 1)

        w = sum(stops[i]["weight"] for i in route_nodes)
        v = sum(stops[i]["volume"] for i in route_nodes)
        pkgs = sum(stops[i].get("packages", 0) for i in route_nodes)
        route_cost = round(km * vt.cost_per_km / 100, 1)

        end_cumul = solution.Min(time_dim.CumulVar(routing.End(vid)))
        duration = end_cumul
        start_time_str = _minutes_to_time(depot_open)
        end_time_str = _minutes_to_time(depot_open + int(end_cumul))

        # Per-stop ETA
        current_idx = routing.Start(vid)
        while not routing.IsEnd(current_idx):
            node = manager.IndexToNode(current_idx)
            if node != 0:
                eta = solution.Min(time_dim.CumulVar(current_idx))
                ordered_stops[list(route_nodes).index(node - 1)]["eta"] = _minutes_to_time(depot_open + int(eta))
            current_idx = solution.Value(routing.NextVar(current_idx))

        routes.append({
            "routeId": f"R-{len(routes)+1:03d}",
            "stops": ordered_stops,
            "stopCount": len(ordered_stops),
            "geometry": geometry,
            "km": km,
            "weightKg": round(w),
            "volumeL": round(v),
            "weightPct": round(w / vt.max_weight_kg * 100) if vt.max_weight_kg else 0,
            "volumePct": round(v / vt.max_volume_l * 100) if vt.max_volume_l else 0,
            "packages": pkgs,
            "startTime": start_time_str,
            "endTime": end_time_str,
            "durationMin": duration,
            "vehicleType": vt.name,
            "vehicleName": cfg.vehicle_name(vid),
            "cost": route_cost,
        })

        total_km += km
        total_duration += duration
        total_cost += route_cost

    routes.sort(key=lambda r: r["startTime"])
    for i, r in enumerate(routes):
        r["routeId"] = f"R-{i+1:03d}"

    return DispatchResult(
        routes=routes,
        summary={
            "routes": len(routes),
            "totalKm": round(total_km, 1),
            "totalStops": sum(r["stopCount"] for r in routes),
            "avgWeightPct": round(sum(r["weightPct"] for r in routes) / max(len(routes), 1)),
            "avgVolumePct": round(sum(r["volumePct"] for r in routes) / max(len(routes), 1)),
            "totalPackages": sum(r["packages"] for r in routes),
            "totalDurationMin": total_duration,
            "totalCost": round(total_cost, 1),
            "vehiclesUsed": len(routes),
            "vehiclesAvailable": num_vehicles,
        },
        solver_info=f"OR-Tools GLS · {len(routes)}/{num_vehicles} vehicles · {cfg.solver_timeout_sec}s",
    )
