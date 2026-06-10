#!/usr/bin/env python3
"""OR-Tools optimization service for Smart Transportation Control Tower."""

from __future__ import annotations

import json
import math
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

try:
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2
except Exception:
    pywrapcp = None
    routing_enums_pb2 = None

HOST = "127.0.0.1"
PORT = 8787
COLORS = ["#2563eb", "#0891b2", "#16a34a", "#f97316", "#dc2626", "#7c3aed", "#0f766e", "#a855f7", "#ca8a04", "#be123c"]


def num(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return fallback
        return float(value)
    except Exception:
        return fallback


def normalize_lon_lat(lon: Any, lat: Any) -> tuple[float, float]:
    lon_num = num(lon, math.nan)
    lat_num = num(lat, math.nan)
    if math.isfinite(lon_num) and math.isfinite(lat_num) and abs(lon_num) <= 60 and abs(lat_num) > 60:
        return lat_num, lon_num
    return lon_num, lat_num


def time_to_minutes(value: Any, fallback: int = 9 * 60) -> int:
    if value is None or value == "":
        return fallback
    if isinstance(value, (int, float)):
        return int(round(value * 24 * 60)) if 0 <= value < 1 else int(value)
    text = str(value).strip()
    if ":" in text:
        h, m = text.replace("：", ":").split(":", 1)
        return int(h) * 60 + int(float(m))
    if len(text) in (3, 4) and text.isdigit():
        return int(text[:-2]) * 60 + int(text[-2:])
    return fallback


def overnight_end(start: int, end: int) -> int:
    return end + 24 * 60 if end <= start else end


def minutes_to_time(value: int) -> str:
    value = max(0, int(round(value)))
    if value >= 24 * 60:
        value -= 24 * 60
        return f"次日 {value // 60:02d}:{value % 60:02d}"
    return f"{value // 60:02d}:{value % 60:02d}"


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = a
    lon2, lat2 = b
    r = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(x), math.sqrt(1 - x))


def build_matrix(points: list[tuple[float, float]], speed_kmh: float) -> tuple[list[list[int]], list[list[int]]]:
    km_matrix, min_matrix = [], []
    speed = max(speed_kmh, 1)
    for a in points:
        km_row, min_row = [], []
        for b in points:
            km = haversine_km(a, b)
            km_row.append(int(round(km * 1000)))
            min_row.append(max(0, int(round(km / speed * 60))))
        km_matrix.append(km_row)
        min_matrix.append(min_row)
    return km_matrix, min_matrix


def normalize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    raw = payload.get("raw") or payload
    source_date = payload.get("date") or "ALL"
    limit = payload.get("limit") or "ALL"
    orders = list(raw.get("orders") or [])
    vehicles = list(raw.get("vehicles") or [])
    if source_date != "ALL":
        orders = [o for o in orders if str(o.get("date", "")) == str(source_date)]
        vehicles = [v for v in vehicles if not v.get("availableDate") or str(v.get("availableDate")) == str(source_date)]
    if limit != "ALL":
        orders = orders[: int(limit)]
    return {
        "date": source_date,
        "goal": payload.get("goal") or "balanced",
        "orders": orders,
        "vehicles": vehicles,
        "depot": raw.get("depot") or {"lon": 130.7079, "lat": 32.8031, "name": "DEPOT"},
        "constraints": raw.get("constraints") or {},
    }


def solve(payload: dict[str, Any]) -> dict[str, Any]:
    if pywrapcp is None:
        raise RuntimeError("OR-Tools is not installed in this Python environment.")
    data = normalize_payload(payload)
    orders = []
    for order in data["orders"]:
        lon, lat = normalize_lon_lat(order.get("lon"), order.get("lat"))
        if math.isfinite(lon) and math.isfinite(lat):
            orders.append({**order, "lon": lon, "lat": lat})
    vehicles = [v for v in data["vehicles"] if num(v.get("maxVolume")) > 0]
    if not orders:
        raise ValueError("No valid orders with coordinates were provided.")
    if not vehicles:
        raise ValueError("No vehicles with capacity were provided.")

    goal = data["goal"]
    if goal in ("utilization", "finish"):
        vehicles = sorted(vehicles, key=lambda v: num(v.get("maxVolume")))
    elif goal == "vehicles":
        vehicles = sorted(vehicles, key=lambda v: num(v.get("maxVolume")), reverse=True)

    depot = data["depot"]
    constraints = data["constraints"]
    depot_lon, depot_lat = normalize_lon_lat(depot.get("lon"), depot.get("lat"))
    points = [(depot_lon, depot_lat)] + [(num(o.get("lon")), num(o.get("lat"))) for o in orders]
    km_matrix, minute_matrix = build_matrix(points, num(constraints.get("averageSpeedKmh"), 28))
    manager = pywrapcp.RoutingIndexManager(len(points), len(vehicles), [0] * len(vehicles), [0] * len(vehicles))
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index: int, to_index: int) -> int:
        return km_matrix[manager.IndexToNode(from_index)][manager.IndexToNode(to_index)]

    routing.SetArcCostEvaluatorOfAllVehicles(routing.RegisterTransitCallback(distance_callback))
    service_minutes = [0] + [max(1, int(round(num(o.get("serviceMin"), 1)))) for o in orders]

    def time_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return minute_matrix[from_node][to_node] + service_minutes[from_node]

    time_idx = routing.RegisterTransitCallback(time_callback)
    routing.AddDimension(time_idx, 90, 48 * 60, False, "Time")
    time_dim = routing.GetDimensionOrDie("Time")
    work_start = time_to_minutes(constraints.get("workStart"), 9 * 60)
    work_end = time_to_minutes(constraints.get("workEnd"), 17 * 60 + 30)
    for vehicle_id, vehicle in enumerate(vehicles):
        start = time_to_minutes(vehicle.get("start"), work_start)
        end = overnight_end(start, time_to_minutes(vehicle.get("end"), work_end))
        time_dim.CumulVar(routing.Start(vehicle_id)).SetRange(start, start)
        time_dim.CumulVar(routing.End(vehicle_id)).SetRange(start, end)
    for i, order in enumerate(orders, start=1):
        tw_start = time_to_minutes(order.get("twStart"), work_start)
        tw_end = overnight_end(tw_start, time_to_minutes(order.get("twEnd"), work_end))
        time_dim.CumulVar(manager.NodeToIndex(i)).SetRange(tw_start, tw_end)

    def add_capacity_dimension(name: str, key: str, max_key: str) -> None:
        scale = 100
        demands = [0] + [int(round(num(o.get(key)) * scale)) for o in orders]
        capacities = [max(1, int(round(num(v.get(max_key), 0) * scale))) for v in vehicles]

        def demand_callback(from_index: int) -> int:
            return demands[manager.IndexToNode(from_index)]

        routing.AddDimensionWithVehicleCapacity(routing.RegisterUnaryTransitCallback(demand_callback), 0, capacities, True, name)

    add_capacity_dimension("Weight", "weight", "maxWeight")
    add_capacity_dimension("Volume", "volume", "maxVolume")

    for vehicle_id, vehicle in enumerate(vehicles):
        if goal == "vehicles":
            routing.SetFixedCostOfVehicle(2_000_000, vehicle_id)
        elif goal == "utilization":
            routing.SetFixedCostOfVehicle(max(200_000, int(num(vehicle.get("maxVolume")) * 25_000)), vehicle_id)
        elif goal == "finish":
            routing.SetFixedCostOfVehicle(500_000, vehicle_id)
    if goal in ("finish", "balanced"):
        time_dim.SetGlobalSpanCostCoefficient(80 if goal == "finish" else 25)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.FromSeconds(int(num(payload.get("timeLimitSeconds"), 30)))
    solution = routing.SolveWithParameters(params)
    if solution is None:
        raise RuntimeError("OR-Tools could not find a feasible solution for the submitted data.")

    date = data["date"] if data["date"] != "ALL" else "OPT-ALL"
    depot_coord = [depot_lon, depot_lat]
    fixed_depot = {**depot, "lon": depot_lon, "lat": depot_lat}
    routes, route_features, stop_features, assigned_nodes = [], [], [], set()
    for vehicle_id, vehicle in enumerate(vehicles):
        index = routing.Start(vehicle_id)
        route_nodes = []
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            if node != 0:
                route_nodes.append(node)
                assigned_nodes.add(node)
            index = solution.Value(routing.NextVar(index))
        if not route_nodes:
            continue
        color = vehicle.get("color") or COLORS[len(routes) % len(COLORS)]
        route_id = f"{date}-{len(routes) + 1:02d}"
        coords = [depot_coord]
        km = weight = volume = 0.0
        packages = 0
        prev = 0
        for seq, node in enumerate(route_nodes, start=1):
            order = orders[node - 1]
            point = [num(order.get("lon")), num(order.get("lat"))]
            km += km_matrix[prev][node] / 1000
            arrive = solution.Value(time_dim.CumulVar(manager.NodeToIndex(node)))
            depart = arrive + service_minutes[node]
            weight += num(order.get("weight"))
            volume += num(order.get("volume"))
            packages += int(num(order.get("count"), 1))
            coords.append(point)
            stop_features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": point},
                "properties": {
                    "date": date, "routeId": route_id, "vehicleId": vehicle.get("vehicleId"),
                    "vehicleName": vehicle.get("vehicleName", "配送车辆"), "seq": seq,
                    "code": order.get("code") or order.get("id"), "name": order.get("name") or order.get("code") or order.get("id"),
                    "addr": order.get("addr", ""), "batch": seq, "count": int(num(order.get("count"), 1)),
                    "weight": num(order.get("weight")), "volume": num(order.get("volume")),
                    "serviceMin": service_minutes[node], "arrive": minutes_to_time(arrive), "depart": minutes_to_time(depart),
                    "travelKm": round(km_matrix[prev][node] / 1000, 1), "travelMin": minute_matrix[prev][node],
                    "coordStatus": "OK", "cargoCodes": order.get("id") or order.get("code"), "color": color,
                },
            })
            prev = node
        km += km_matrix[prev][0] / 1000
        coords.append(depot_coord)
        end_time = solution.Value(time_dim.CumulVar(routing.End(vehicle_id)))
        max_weight = max(1, num(vehicle.get("maxWeight"), 1))
        max_volume = max(1, num(vehicle.get("maxVolume"), 1))
        route = {
            "date": date, "routeId": route_id, "vehicleId": vehicle.get("vehicleId") or f"V{vehicle_id + 1:02d}",
            "vehicleName": vehicle.get("vehicleName") or "配送车辆", "stops": len(route_nodes), "packages": packages,
            "weight": round(weight, 1), "maxWeight": max_weight, "volume": round(volume, 1), "maxVolume": max_volume,
            "km": round(km, 1), "start": minutes_to_time(solution.Value(time_dim.CumulVar(routing.Start(vehicle_id)))),
            "end": minutes_to_time(end_time), "status": "OK", "weightUtil": f"{round(weight / max_weight * 100, 1)}%",
            "volumeUtil": f"{round(volume / max_volume * 100, 1)}%", "color": color,
        }
        routes.append(route)
        route_features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords}, "properties": {**route, "color": color}})

    missing = [{**orders[i - 1], "reason": "OR-Tools 硬约束下未分配"} for i in range(1, len(orders) + 1) if i not in assigned_nodes]
    latest_end = max((r["end"] for r in routes), default="-")
    avg_volume = round(sum(num(r["volumeUtil"].rstrip("%")) for r in routes) / max(1, len(routes)), 1)
    day_summary = {
        "date": date, "routes": len(routes), "stops": sum(r["stops"] for r in routes),
        "packages": sum(r["packages"] for r in routes), "km": round(sum(r["km"] for r in routes), 1),
        "latestEnd": latest_end, "vehicleUtil": f"{round(len(routes) / max(1, len(vehicles)) * 100, 1)}%",
        "avgVolumeUtil": f"{avg_volume}%",
    }
    return {
        "engine": "OR-Tools", "routes": routes, "routeGeoJson": {"type": "FeatureCollection", "features": route_features},
        "stopGeoJson": {"type": "FeatureCollection", "features": stop_features}, "depot": fixed_depot,
        "daySummaries": [day_summary], "missingStops": missing, "splitRows": [],
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self) -> None:
        self._send(200, {"ok": True})

    def do_GET(self) -> None:
        if self.path.startswith("/health"):
            self._send(200, {"ok": pywrapcp is not None, "engine": "OR-Tools" if pywrapcp else "unavailable", "python": sys.executable})
        else:
            self._send(404, {"ok": False, "error": "Not found"})

    def do_POST(self) -> None:
        if not self.path.startswith("/optimize"):
            self._send(404, {"ok": False, "error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            plan = solve(json.loads(self.rfile.read(length).decode("utf-8")))
            self._send(200, {"ok": True, "plan": plan})
        except Exception as exc:
            self._send(400, {"ok": False, "error": str(exc)})

    def log_message(self, fmt: str, *args: Any) -> None:
        print(fmt % args)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"OR-Tools optimizer service listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
