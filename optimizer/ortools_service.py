#!/usr/bin/env python3
"""Local OR-Tools service for the LOSPOLLOS v1.3 trust-gates demo."""

from __future__ import annotations

import hashlib
import json
import math
import os
import platform
import time
import uuid
from pathlib import Path
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable
from urllib.parse import urlsplit, parse_qs

try:
    import ortools as ortools_package
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2
    from ortools.sat.python import cp_model
except Exception:
    ortools_package = None
    pywrapcp = None
    routing_enums_pb2 = None
    cp_model = None

try:
    from canonical_contract import CONTRACT, CanonicalError, plan_identity, request_identity, scenario_identity
except ImportError:
    from optimizer.canonical_contract import CONTRACT, CanonicalError, plan_identity, request_identity, scenario_identity

try:
    from rolling_solver_v16 import RollingSolveError, solve_rolling
    from routing_contract_v16 import RoutingContractError
except ImportError:
    from optimizer.rolling_solver_v16 import RollingSolveError, solve_rolling
    from optimizer.routing_contract_v16 import RoutingContractError

try:
    from facility_mvp1 import FacilityError, solve_facility
except ImportError:
    from optimizer.facility_mvp1 import FacilityError, solve_facility

try:
    from supply_chain_joint_v19 import SupplyChainSolveError, solve_joint
except ImportError:
    from optimizer.supply_chain_joint_v19 import SupplyChainSolveError, solve_joint

try:
    from supply_chain_jobs_v6 import JOBS, JobError
except ImportError:
    from optimizer.supply_chain_jobs_v6 import JOBS, JobError

if os.environ.get("DISABLE_ORTOOLS", "").strip().lower() in {"1", "true", "yes"}:
    pywrapcp = None
    routing_enums_pb2 = None

try:
    from build_identity import verified_identity
    from solve_admission import SOLVE_ADMISSION, SolverBusy
except ImportError:
    from optimizer.build_identity import verified_identity
    from optimizer.solve_admission import SOLVE_ADMISSION, SolverBusy

HOST = "127.0.0.1"
PORT = int(os.environ.get("OPT_PORT", "8787"))
MAX_SOLVE_SECONDS = max(5, min(120, int(os.environ.get("MAX_SOLVE_SECONDS", "45"))))
MAX_ORDERS = max(60, min(2000, int(os.environ.get("MAX_OPTIMIZER_ORDERS", "500"))))
COLORS = ["#2563eb", "#0891b2", "#16a34a", "#f97316", "#dc2626", "#7c3aed", "#0f766e", "#a855f7", "#ca8a04", "#be123c"]
GOAL_DEFINITIONS = {
    "service": "最大化 priorityWeight 服务分，再最大化已分配订单数",
    "vehicles": "最佳服务水平候选中，先最小化实际使用车辆数，再最小化估算道路距离",
    "distance": "最佳服务水平候选中，最小化 estimatedRoadKm",
    "utilization": "生成装载匹配候选，最终标签由公开 utilizationScore 在候选池中授予",
    "cost": "最佳服务水平候选中，最小化车辆级 Demo totalCost",
    "carbon": "最佳服务水平候选中，最小化车辆级 Demo totalCO2",
    "balanced_seed": "生成综合平衡搜索种子；最终 balancedPoolScore 由去重候选池相对评分授予",
}
INT64_MAX = 9_223_372_036_854_775_807


def num(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return fallback
        return float(value)
    except Exception:
        return fallback


def text(value: Any, fallback: str = "") -> str:
    value = fallback if value is None else value
    return str(value).strip()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


STARTED_AT = utc_now()
INSTANCE_ID = uuid.uuid4().hex
_RUNTIME_MANIFEST = verified_identity()
_BUILD_FILES = tuple(row["path"] for row in _RUNTIME_MANIFEST["files"])
BUILD_FINGERPRINT = _RUNTIME_MANIFEST["fingerprint"]
SUPPLY_PROTOCOL_VERSION = "stct-supply-chain-jobs-v6"
SUPPLY_MODEL_VERSION = "v6-cp-sat-1"


def job_identity(body: dict) -> dict:
    return {**body, "backendInstanceId": INSTANCE_ID, "backendBuildFingerprint": BUILD_FINGERPRINT}


def round_half_up_int(value: Any) -> int:
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def scaled_int(value: Any, scale: int) -> int:
    return round_half_up_int(Decimal(str(value)) * scale)


def stable_hash(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


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
    raw = text(value).replace("：", ":")
    next_day = 24 * 60 if "次日" in raw else 0
    raw = raw.replace("次日", "").strip()
    if ":" in raw:
        h, m = raw.split(":", 1)
        return next_day + int(h) * 60 + int(float(m))
    if len(raw) in (3, 4) and raw.isdigit():
        return next_day + int(raw[:-2]) * 60 + int(raw[-2:])
    return fallback


def valid_time_value(value: Any) -> bool:
    if isinstance(value, (int, float)):
        return math.isfinite(float(value)) and float(value) >= 0
    raw = text(value).replace("：", ":").replace("次日", "").strip()
    if ":" in raw:
        parts = raw.split(":", 1)
        try:
            hour, minute = int(parts[0]), int(float(parts[1]))
            return 0 <= hour <= 23 and 0 <= minute <= 59
        except (TypeError, ValueError):
            return False
    return len(raw) in (3, 4) and raw.isdigit() and int(raw[-2:]) <= 59


def overnight_end(start: int, end: int) -> int:
    return end + 24 * 60 if end < start else end


def normalized_window_minutes(start_value: Any, end_value: Any, shift_start: int, default_start: int, default_end: int) -> tuple[int, int]:
    start = time_to_minutes(start_value, default_start)
    end = overnight_end(start, time_to_minutes(end_value, default_end))
    while end < shift_start:
        start += 24 * 60
        end += 24 * 60
    return start, end


def minutes_to_time(value: int) -> str:
    value = max(0, int(round(value)))
    prefix = ""
    while value >= 24 * 60:
        prefix = "次日 "
        value -= 24 * 60
    return f"{prefix}{value // 60:02d}:{value % 60:02d}"


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = a
    lon2, lat2 = b
    radius = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.atan2(math.sqrt(h), math.sqrt(max(0.0, 1 - h)))


def build_matrix(points: list[tuple[float, float]], speed_kmh: float, road_factor: float) -> tuple[list[list[int]], list[list[int]]]:
    km_matrix: list[list[int]] = []
    minute_matrix: list[list[int]] = []
    speed = max(speed_kmh, 1.0)
    factor = max(1.0, min(3.0, road_factor))
    for start in points:
        km_row: list[int] = []
        minute_row: list[int] = []
        for end in points:
            road_meters = round_half_up_int(haversine_km(start, end) * factor * 1000)
            km_row.append(road_meters)
            minute_row.append(max(0, math.ceil(road_meters / 1000 / speed * 60)))
        km_matrix.append(km_row)
        minute_matrix.append(minute_row)
    return km_matrix, minute_matrix


def deterministic_route_schedule(
    route_nodes: list[int],
    orders: list[dict[str, Any]],
    vehicle: dict[str, Any],
    minute_matrix: list[list[int]],
    service_minutes: list[int],
    max_waiting: int,
    work_start: int,
    work_end: int,
) -> list[dict[str, int]]:
    """Choose a deterministic feasible schedule with at most max_waiting per leg."""
    shift_start = time_to_minutes(vehicle.get("start"), work_start)
    intervals: list[tuple[int, int]] = [(shift_start, shift_start)]
    transits: list[int] = [0]
    previous_node = 0
    for node in route_nodes:
        order = orders[node - 1]
        tw_start, tw_end = normalized_window_minutes(order.get("twStart"), order.get("twEnd"), shift_start, work_start, work_end)
        transit = minute_matrix[previous_node][node] + service_minutes[previous_node]
        earliest = max(tw_start, intervals[-1][0] + transit)
        latest = min(tw_end, intervals[-1][1] + transit + max_waiting)
        if earliest > latest:
            raise RuntimeError(f"ROUTE_SCHEDULE_INCONSISTENT:{order.get('id')}:{earliest}>{latest}")
        intervals.append((earliest, latest))
        transits.append(transit)
        previous_node = node

    starts = [0] * len(intervals)
    starts[-1] = intervals[-1][0]
    for index in range(len(intervals) - 2, -1, -1):
        lower = max(intervals[index][0], starts[index + 1] - transits[index + 1] - max_waiting)
        upper = min(intervals[index][1], starts[index + 1] - transits[index + 1])
        if lower > upper:
            raise RuntimeError(f"ROUTE_SCHEDULE_BACKTRACK_INCONSISTENT:{index}:{lower}>{upper}")
        starts[index] = lower

    schedule: list[dict[str, int]] = []
    previous_node = 0
    for index, node in enumerate(route_nodes, start=1):
        travel = minute_matrix[previous_node][node]
        raw_arrival = starts[index - 1] + service_minutes[previous_node] + travel
        arrive = starts[index]
        schedule.append({
            "rawArrival": raw_arrival,
            "arrive": arrive,
            "depart": arrive + service_minutes[node],
            "waiting": arrive - raw_arrival,
        })
        previous_node = node
    return schedule


def lexicographic_bounds(
    order_priority_weights: list[int],
    vehicle_count: int,
    max_arc_cost: int,
    fixed_costs: list[int],
    span_coefficient: int = 0,
    span_max_minutes: int = 48 * 60,
) -> dict[str, Any]:
    order_count = len(order_priority_weights)
    max_business = (
        max(0, max_arc_cost) * (order_count + vehicle_count)
        + sum(max(0, value) for value in fixed_costs)
        + max(0, span_coefficient) * span_max_minutes
    )
    assigned_scale = max_business + 1
    priority_scale = order_count * assigned_scale + max_business + 1
    maximum_total = sum(order_priority_weights) * priority_scale + order_count * assigned_scale + max_business
    int64_safe = maximum_total <= INT64_MAX
    if not int64_safe:
        raise CanonicalError(
            "LEXICOGRAPHIC_INT64_OVERFLOW",
            "Scenario objective bounds exceed signed int64.",
            {"maximumTotalObjective": maximum_total, "int64Max": INT64_MAX},
        )
    return {
        "lexicographicMethod": "proven-big-m",
        "maxBusinessObjectiveBound": max_business,
        "assignedScale": assigned_scale,
        "priorityScale": priority_scale,
        "maximumTotalObjective": maximum_total,
        "int64Safe": True,
        "proof": {
            "assignedDominatesBusiness": assigned_scale > max_business,
            "priorityDominatesAssignedAndBusiness": priority_scale > order_count * assigned_scale + max_business,
        },
    }


def reason_row(order: dict[str, Any], category: str, reason: str, action: str, status: str) -> dict[str, Any]:
    reason_codes = {
        "missing_coordinate": "MISSING_COORDINATE",
        "invalid_coordinate": "INVALID_COORDINATE",
        "invalid_demand": "INVALID_DEMAND",
        "invalid_time_window": "INVALID_TIME_WINDOW",
        "duplicate_order": "INVALID_DEMAND",
        "over_volume_capacity": "ORDER_EXCEEDS_ALL_VEHICLES_VOLUME",
        "over_weight_capacity": "ORDER_EXCEEDS_ALL_VEHICLES_WEIGHT",
        "vehicle_date_mismatch": "NO_VEHICLE_AVAILABLE_ON_DATE",
        "total_capacity": "TOTAL_CAPACITY_SHORTFALL",
        "time_window": "TIME_WINDOW_CONFLICT",
        "shift_limit": "SHIFT_LIMIT_CONFLICT",
        "solver_time_limit": "SOLVER_TIME_LIMIT",
        "solver_no_solution": "SOLVER_NO_FEASIBLE_ASSIGNMENT",
    }
    reason_code = reason_codes.get(category, "UNKNOWN_CONSTRAINT_CONFLICT")
    deterministic = reason_code in {
        "MISSING_COORDINATE", "INVALID_COORDINATE", "INVALID_DEMAND",
        "ORDER_EXCEEDS_ALL_VEHICLES_VOLUME", "ORDER_EXCEEDS_ALL_VEHICLES_WEIGHT",
        "NO_VEHICLE_AVAILABLE_ON_DATE", "INVALID_TIME_WINDOW",
    }
    return {
        **order,
        "id": order.get("_scenarioOrderKey") or order.get("id") or order.get("orderId") or order.get("code"),
        "code": order.get("code") or order.get("id") or order.get("orderId"),
        "reasonCategory": category,
        "reasonCode": reason_code,
        "reasonLabel": reason,
        "reason": reason,
        "suggestion": action,
        "suggestedActions": [part.strip() for part in action.replace("，", "、").split("、") if part.strip()],
        "confidence": "deterministic" if deterministic else ("unknown" if reason_code == "UNKNOWN_CONSTRAINT_CONFLICT" else "probable"),
        "evidence": {},
        "assignmentStatus": "BLOCKED_PRECHECK" if status == "blocked" else "UNASSIGNED_SOLVER",
    }


def normalize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    contract_version = text(payload.get("contractVersion"))
    if contract_version != CONTRACT["contractVersion"]:
        raise CanonicalError(
            "CONTRACT_VERSION_MISMATCH",
            "Request contractVersion does not match the optimizer contract.",
            {"expected": CONTRACT["contractVersion"], "actual": contract_version},
        )
    claimed_scenario = payload.get("canonicalScenario")
    if not isinstance(claimed_scenario, dict):
        raise CanonicalError("CANONICALIZATION_ERROR", "canonicalScenario is required.")
    identity = scenario_identity(claimed_scenario)
    canonical_scenario = identity["scenario"]
    comparisons = (
        ("CONTENT_HASH_MISMATCH", "claimedContentHash", identity["contentHash"]),
        ("INPUT_HASH_MISMATCH", "claimedInputHash", identity["inputHash"]),
    )
    for code, field, expected in comparisons:
        actual = text(payload.get(field))
        if actual != expected:
            raise CanonicalError(code, f"{field} does not match the server canonical hash.", {"expected": expected, "actual": actual})

    requested_goal = text(payload.get("objective") or payload.get("requestedObjective"))
    if requested_goal not in GOAL_DEFINITIONS:
        raise CanonicalError("CANONICALIZATION_ERROR", f"Unsupported optimization objective: {requested_goal}")
    requested_seconds = int(num(payload.get("timeLimitSeconds"), 8))
    if requested_seconds < 1 or requested_seconds > MAX_SOLVE_SECONDS:
        raise CanonicalError("CANONICALIZATION_ERROR", "timeLimitSeconds is outside the server limit.", {"max": MAX_SOLVE_SECONDS, "actual": requested_seconds})
    request_options = {
        "objective": requested_goal,
        "timeLimitSeconds": requested_seconds,
        "engineRequested": text(payload.get("engineRequested"), "ortools"),
        "searchConfiguration": payload.get("searchConfiguration") or {},
    }
    request_result = request_identity(identity["inputHash"], request_options)
    claimed_request_hash = text(payload.get("claimedRequestHash"))
    if claimed_request_hash != request_result["requestHash"]:
        raise CanonicalError(
            "REQUEST_HASH_MISMATCH",
            "claimedRequestHash does not match the server canonical request hash.",
            {"expected": request_result["requestHash"], "actual": claimed_request_hash},
        )

    orders = [
        {**order, "_scenarioOrderKey": order["id"], "addr": order["address"]}
        for order in canonical_scenario["orders"]
    ]
    vehicles = [
        {**vehicle, "vehicleId": vehicle["id"], "vehicleName": vehicle["name"], "virtual": vehicle["isVirtual"]}
        for vehicle in canonical_scenario["vehicles"]
        if vehicle["enabled"]
    ]
    if len(orders) > MAX_ORDERS:
        raise CanonicalError("CANONICALIZATION_ERROR", f"Scenario contains {len(orders)} orders; the local demo limit is {MAX_ORDERS}.")
    source_date = canonical_scenario["planningDate"]
    unavailable = [vehicle["id"] for vehicle in vehicles if vehicle["availableDate"] and vehicle["availableDate"] != source_date]
    if unavailable:
        raise CanonicalError("VEHICLE_NOT_AVAILABLE_ON_DATE", "Scenario contains vehicles unavailable on planningDate.", {"vehicleIds": unavailable, "planningDate": source_date})

    constraints = dict(canonical_scenario["constraints"])
    assumptions = dict(canonical_scenario["assumptions"])
    road_factor = num(assumptions["roadDistanceFactor"], 1.35)
    average_speed = num(assumptions["averageSpeedKmh"], 28)
    default_service = num(assumptions["defaultServiceMin"], 5)
    cost_model = {
        "fixedVehicleCost": num(CONTRACT["models"]["defaultFixedCost"]),
        "perKm": num(CONTRACT["models"]["defaultPerKmCost"]),
        "perMinute": num(CONTRACT["models"]["defaultPerMinuteCost"]),
        "perStop": num(CONTRACT["models"]["defaultPerStopCost"]),
        "currency": "CNY",
    }
    carbon_model = {"defaultVehicleFactor": num(assumptions["defaultEmissionFactor"]), "unit": "kgCO2/km"}
    balanced_weights = {
        "usedVehicles": num(assumptions["balancedWeightUsedVehicles"]),
        "estimatedRoadKm": num(assumptions["balancedWeightDistance"]),
        "totalCost": num(assumptions["balancedWeightCost"]),
        "totalCO2": num(assumptions["balancedWeightCarbon"]),
        "latestEndScore": num(assumptions["balancedWeightLatestEnd"]),
        "utilizationScore": num(assumptions["balancedWeightUtilization"]),
        "vehicles": 25,
        "distance": 1,
        "latestEnd": 0.2,
        "lowUtilization": 8,
        "cost": 0.15,
        "carbon": 2,
    }
    scenario_id = f"SCN-{identity['inputHash'].split(':', 1)[1][:16].upper()}"
    return {
        "date": source_date,
        "goal": requested_goal,
        "orders": orders,
        "vehicles": vehicles,
        "depot": canonical_scenario["depot"],
        "constraints": constraints,
        "roadFactor": max(1.0, min(3.0, road_factor)),
        "averageSpeedKmh": max(1.0, average_speed),
        "defaultServiceMinutes": max(0.0, default_service),
        "timeLimitSeconds": requested_seconds,
        "costModel": cost_model,
        "carbonModel": carbon_model,
        "balancedWeights": balanced_weights,
        "batchId": text(payload.get("batchId"), "AUDIT-METADATA"),
        "inputFingerprint": identity["inputHash"],
        "contentHash": identity["contentHash"],
        "inputHash": identity["inputHash"],
        "requestHash": request_result["requestHash"],
        "scenarioId": scenario_id,
        "scenario": canonical_scenario,
        "canonicalScenario": canonical_scenario,
        "contractVersion": CONTRACT["contractVersion"],
        "canonicalVersion": CONTRACT["canonicalVersion"],
        "serverHashVerified": True,
        "canonicalInputBytes": identity["inputBytes"].decode("utf-8"),
        "requestId": text(payload.get("requestId")),
        "shiftExtensionMinutes": max(0, int(num(constraints.get("shiftExtensionMinutes"), 0))),
        "limit": "ALL",
    }


def plan_fingerprint(routes: list[dict[str, Any]], stop_features: list[dict[str, Any]]) -> str:
    stops_by_route: dict[str, list[str]] = {}
    for feature in stop_features:
        props = feature.get("properties") or {}
        stops_by_route.setdefault(text(props.get("routeId")), []).append(text(props.get("orderId") or props.get("cargoCodes") or props.get("code")))
    canonical = []
    for route in routes:
        canonical.append({"vehicle": route.get("vehicleId"), "orders": stops_by_route.get(text(route.get("routeId")), [])})
    return stable_hash(canonical)


def attach_trust_identity(plan: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    stops_by_route: dict[str, list[tuple[int, str]]] = {}
    for feature in (plan.get("stopGeoJson") or {}).get("features") or []:
        props = feature.get("properties") or {}
        stops_by_route.setdefault(text(props.get("routeId")), []).append((int(num(props.get("seq"), 0)), text(props.get("orderId"))))
    authority = {
        "routes": [
            {
                "routeId": text(route.get("routeId")),
                "vehicleId": text(route.get("vehicleId")),
                "orderIds": [order_id for _, order_id in sorted(stops_by_route.get(text(route.get("routeId")), []))],
            }
            for route in plan.get("routes") or []
        ],
        "unassignedOrderIds": [text(row.get("id") or row.get("orderId") or row.get("code")) for row in plan.get("unassignedOrders") or []],
        "blockedOrderIds": [text(row.get("id") or row.get("orderId") or row.get("code")) for row in plan.get("blockedOrders") or []],
        "manualRevision": 0,
    }
    plan_result = plan_identity(data["inputHash"], authority)
    plan.update({
        "contractVersion": data["contractVersion"],
        "canonicalVersion": data["canonicalVersion"],
        "contentHash": data["contentHash"],
        "inputHash": data["inputHash"],
        "requestHash": data["requestHash"],
        "planHash": plan_result["planHash"],
        "serverHashVerified": True,
        "reportedMetrics": dict(plan.get("metrics") or {}),
        "unassignedOrderIds": authority["unassignedOrderIds"],
        "blockedOrderIds": authority["blockedOrderIds"],
    })
    for route, authority_route in zip(plan.get("routes") or [], authority["routes"]):
        route["orderIds"] = authority_route["orderIds"]
    plan["meta"] = {
        **(plan.get("meta") or {}),
        "contractVersion": data["contractVersion"],
        "canonicalVersion": data["canonicalVersion"],
        "contentHash": data["contentHash"],
        "inputHash": data["inputHash"],
        "requestHash": data["requestHash"],
        "planHash": plan_result["planHash"],
        "serverHashVerified": True,
        "actualEngineVersion": getattr(ortools_package, "__version__", None),
    }
    return plan


def create_empty_plan(data: dict[str, Any], blocked: list[dict[str, Any]], unassigned: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    unassigned = unassigned or []
    conservation = {
        "input": len(data["orders"]),
        "assigned": 0,
        "unassigned": len(unassigned),
        "blocked": len(blocked),
    }
    conservation["balanced"] = conservation["input"] == conservation["assigned"] + conservation["unassigned"] + conservation["blocked"]
    plan = {
        "engine": "OR-Tools",
        "scenarioId": data["scenarioId"],
        "inputHash": data["inputHash"],
        "routes": [],
        "routeGeoJson": {"type": "FeatureCollection", "features": []},
        "stopGeoJson": {"type": "FeatureCollection", "features": []},
        "depot": data["depot"],
        "daySummaries": [{"date": data["date"], "routes": 0, "orders": 0, "stops": 0, "packages": 0, "km": 0, "latestEnd": "-", "avgVolumeUtil": "0%"}],
        "missingStops": [*blocked, *unassigned],
        "unassignedOrders": unassigned,
        "blockedOrders": blocked,
        "splitRows": [],
        "conservation": conservation,
        "metrics": {"assigned": 0, "unassigned": len(unassigned), "blocked": len(blocked), "vehicles": 0, "usedVehicles": 0, "totalDistance": 0, "estimatedRoadKm": 0, "cost": 0, "totalCost": 0, "co2": 0, "totalCO2": 0},
        "fingerprint": stable_hash([]),
        "meta": build_metadata(data),
    }
    return attach_trust_identity(plan, data)


def build_metadata(data: dict[str, Any]) -> dict[str, Any]:
    factors = [num(vehicle.get("emissionFactor"), data["carbonModel"]["defaultVehicleFactor"]) for vehicle in data["vehicles"]]
    costs = [num(vehicle.get("perKmCost"), data["costModel"]["perKm"]) for vehicle in data["vehicles"]]
    equivalence = []
    if data["goal"] == "carbon" and len({round(value, 8) for value in factors}) <= 1:
        equivalence.append("所有可用车辆使用相同排放因子，最低碳排与最短距离在当前假设下等价。")
    if data["goal"] == "cost" and len({round(value, 8) for value in costs}) <= 1:
        equivalence.append("所有可用车辆使用相同单位里程成本；固定车辆成本仍会影响方案。")
    return {
        "version": "v1.4-trust-closure-mission-control",
        "source": "Local OR-Tools API",
        "engine": "OR-Tools",
        "engineVersion": getattr(ortools_package, "__version__", None),
        "actualEngineVersion": getattr(ortools_package, "__version__", None),
        "contractVersion": data["contractVersion"],
        "canonicalVersion": data["canonicalVersion"],
        "contentHash": data["contentHash"],
        "scenarioId": data["scenarioId"],
        "inputHash": data["inputHash"],
        "requestHash": data["requestHash"],
        "serverHashVerified": True,
        "requestId": data["requestId"],
        "requestedGoal": data["goal"],
        "goal": data["goal"],
        "goalDefinition": GOAL_DEFINITIONS[data["goal"]],
        "objectiveDefinition": {
            "servicePriority": "lexicographic-service-first",
            "formula": GOAL_DEFINITIONS[data["goal"]],
            "weights": data["balancedWeights"] if data["goal"] == "balanced_seed" else {},
            "integerScale": {"distanceMeters": 1000, "currencyCents": 100, "carbonTenThousandths": 10000},
            "tieBreakers": ["planHash"],
            **data.get("lexicographicProof", {"lexicographicMethod": "not-calculated"}),
        },
        "batchId": data["batchId"],
        "inputFingerprint": data["inputFingerprint"],
        "generatedAt": utc_now(),
        "distanceModel": "haversineKm × roadDistanceFactor",
        "roadDistanceFactor": data["roadFactor"],
        "averageSpeedKmh": data["averageSpeedKmh"],
        "defaultServiceMinutes": data["defaultServiceMinutes"],
        "costModel": data["costModel"],
        "carbonModel": data["carbonModel"],
        "balancedWeights": data["balancedWeights"],
        "timeLimitSeconds": data["timeLimitSeconds"],
        "inputLimit": data["limit"],
        "solverObjectiveUnit": "internal scaled integer; not a business unit",
        "solverOptimalityClaim": "Best found within the configured time limit; global optimality is not proven.",
        "verificationPolicy": {
            "required": True,
            "authority": "independent frontend verifier",
            "failClosed": True,
            "tolerances": CONTRACT["tolerances"],
        },
        "equivalenceExplanation": equivalence,
        "distanceDisclaimer": "估算道路距离，不是正式货车导航距离。地图道路形状仅用于展示增强。",
    }


def utilization_metrics(routes: list[dict[str, Any]], threshold: float = 35.0) -> dict[str, Any]:
    effective: list[float] = []
    for route in routes:
        volume_util = num(route.get("volume")) / max(num(route.get("maxVolume")), 1e-9) * 100 if num(route.get("maxVolume")) > 0 else 0
        weight_util = num(route.get("weight")) / max(num(route.get("maxWeight")), 1e-9) * 100 if num(route.get("maxWeight")) > 0 else 0
        effective.append(max(volume_util, weight_util))
    total_volume = sum(num(route.get("volume")) for route in routes)
    total_volume_capacity = sum(num(route.get("maxVolume")) for route in routes)
    total_weight = sum(num(route.get("weight")) for route in routes)
    total_weight_capacity = sum(num(route.get("maxWeight")) for route in routes)
    volume_fleet = total_volume / total_volume_capacity * 100 if total_volume_capacity > 0 else 0
    weight_fleet = total_weight / total_weight_capacity * 100 if total_weight_capacity > 0 and total_weight > 0 else 0
    fleet_util = max(volume_fleet, weight_fleet)
    average = sum(effective) / len(effective) if effective else 0
    minimum = min(effective) if effective else 0
    stddev = math.sqrt(sum((value - average) ** 2 for value in effective) / len(effective)) if effective else 0
    low_count = sum(1 for value in effective if value < threshold)
    low_share = low_count / len(effective) * 100 if effective else 100
    score = max(0, min(100,
        fleet_util * 0.35 + average * 0.25 + minimum * 0.20
        + max(0, 100 - stddev) * 0.10 + max(0, 100 - low_share) * 0.10
    ))
    return {
        "weightedFleetUtilization": round(fleet_util, 1),
        "averageEffectiveUtilization": round(average, 1),
        "minimumRouteUtilization": round(minimum, 1),
        "utilizationStdDev": round(stddev, 1),
        "lowUtilizationRouteCount": low_count,
        "lowUtilizationThreshold": threshold,
        "utilizationScore": round(score, 1),
        "utilizationFormula": "0.35*fleetUtil + 0.25*avgEffective + 0.20*minRoute + 0.10*(100-stdDev) + 0.10*(100-lowRouteShare)",
    }


def capacity_lower_bound(demand: float, vehicles: list[dict[str, Any]], field: str) -> int | None:
    if demand <= 0:
        return 0
    capacities = sorted((num(vehicle.get(field)) for vehicle in vehicles if num(vehicle.get(field)) > 0), reverse=True)
    total = 0.0
    for index, capacity in enumerate(capacities, start=1):
        total += capacity
        if total + 1e-9 >= demand:
            return index
    return None


def solve(payload: dict[str, Any]) -> dict[str, Any]:
    if pywrapcp is None or routing_enums_pb2 is None:
        raise RuntimeError("OR-Tools is not installed in this Python environment.")
    solve_started = time.perf_counter()
    data = normalize_payload(payload)
    max_volume = max((num(vehicle.get("maxVolume")) for vehicle in data["vehicles"]), default=0)
    max_weight = max((num(vehicle.get("maxWeight")) for vehicle in data["vehicles"]), default=0)
    blocked: list[dict[str, Any]] = []
    orders: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    if not data["vehicles"]:
        blocked = [reason_row(order, "vehicle_date_mismatch", "车辆可用日期不匹配", "检查车辆可用日期", "blocked") for order in data["orders"]]
        return create_empty_plan(data, blocked)

    for row_index, order in enumerate(data["orders"], start=2):
        business_order_id = text(order.get("id") or order.get("orderId") or order.get("code"), f"ROW-{row_index}")
        scenario_order_id = text(order.get("_scenarioOrderKey"), business_order_id)
        normalized = {**order, "id": scenario_order_id, "businessOrderId": business_order_id, "_row": row_index}
        if business_order_id in seen_ids:
            blocked.append(reason_row(normalized, "duplicate_order", "订单 ID 重复", "修正为唯一订单 ID", "blocked"))
            continue
        seen_ids.add(business_order_id)
        raw_lon, raw_lat = order.get("lon"), order.get("lat")
        lon, lat = normalize_lon_lat(raw_lon, raw_lat)
        if not (math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90):
            category = "missing_coordinate" if raw_lon in (None, "") or raw_lat in (None, "") else "invalid_coordinate"
            label = "缺少坐标" if category == "missing_coordinate" else "坐标无效"
            blocked.append(reason_row(normalized, category, label, "补充有效经纬度", "blocked"))
            continue
        normalized.update({"lon": lon, "lat": lat})
        if num(order.get("volume"), math.nan) < 0 or num(order.get("weight"), math.nan) < 0:
            blocked.append(reason_row(normalized, "invalid_demand", "订单容积和重量必须为非负数", "修正订单容量数据", "blocked"))
            continue
        if num(order.get("volume")) > max_volume > 0:
            blocked.append(reason_row(normalized, "over_volume_capacity", "单票超过全部车辆容积容量", "拆单或增加大容积车辆", "blocked"))
            continue
        if num(order.get("weight")) > max_weight > 0:
            blocked.append(reason_row(normalized, "over_weight_capacity", "单票超过全部车辆重量容量", "拆单或增加大载重车辆", "blocked"))
            continue
        if (order.get("twStart") not in (None, "") and not valid_time_value(order.get("twStart"))) or (order.get("twEnd") not in (None, "") and not valid_time_value(order.get("twEnd"))):
            blocked.append(reason_row(normalized, "invalid_time_window", "时间窗格式无效", "修正时间窗", "blocked"))
            continue
        orders.append(normalized)

    if not orders:
        return create_empty_plan(data, blocked)

    vehicles = [vehicle for vehicle in data["vehicles"] if num(vehicle.get("maxVolume")) > 0 and num(vehicle.get("maxWeight")) > 0]
    if not vehicles:
        blocked.extend(reason_row(order, "vehicle_capacity", "车辆主数据缺少有效容积容量", "修正车辆最大容积", "blocked") for order in orders)
        return create_empty_plan(data, blocked)

    depot = data["depot"]
    depot_lon, depot_lat = normalize_lon_lat(depot.get("lon"), depot.get("lat"))
    if not (math.isfinite(depot_lon) and math.isfinite(depot_lat)):
        raise ValueError("Depot coordinates are missing or invalid.")
    depot_coord = (depot_lon, depot_lat)
    points = [depot_coord] + [(num(order.get("lon")), num(order.get("lat"))) for order in orders]
    matrix_started = time.perf_counter()
    km_matrix, minute_matrix = build_matrix(points, data["averageSpeedKmh"], data["roadFactor"])
    matrix_build_ms = round((time.perf_counter() - matrix_started) * 1000, 1)
    manager = pywrapcp.RoutingIndexManager(len(points), len(vehicles), [0] * len(vehicles), [0] * len(vehicles))
    routing = pywrapcp.RoutingModel(manager)

    def business_arc_cost(vehicle: dict[str, Any], start_node: int, end_node: int) -> int:
        per_km = num(vehicle.get("perKmCost"), data["costModel"]["perKm"])
        per_minute = num(vehicle.get("perMinuteCost"), data["costModel"]["perMinute"])
        per_stop = num(vehicle.get("perStopCost"), data["costModel"]["perStop"])
        emission = num(vehicle.get("emissionFactor"), data["carbonModel"]["defaultVehicleFactor"])
        meters = km_matrix[start_node][end_node]
        driving_minutes = minute_matrix[start_node][end_node]
        if data["goal"] == "cost":
            return max(0, round_half_up_int((meters / 1000 * per_km + driving_minutes * per_minute + (per_stop if end_node else 0)) * 100))
        if data["goal"] == "carbon":
            return max(0, round_half_up_int(meters / 1000 * emission * 10000))
        if data["goal"] == "balanced_seed":
            distance_cost = meters * data["balancedWeights"]["distance"]
            monetary_cost = (meters / 1000 * per_km + driving_minutes * per_minute + (per_stop if end_node else 0)) * data["balancedWeights"]["cost"] * 100
            carbon_cost = meters / 1000 * emission * data["balancedWeights"]["carbon"] * 1000
            return max(0, round_half_up_int(distance_cost + monetary_cost + carbon_cost))
        return meters

    def arc_cost_callback(vehicle: dict[str, Any]) -> Callable[[int, int], int]:
        def callback(from_index: int, to_index: int) -> int:
            start_node, end_node = manager.IndexToNode(from_index), manager.IndexToNode(to_index)
            return business_arc_cost(vehicle, start_node, end_node)

        return callback

    max_vehicle_volume = max(num(vehicle.get("maxVolume"), 1) for vehicle in vehicles)
    fixed_costs: list[int] = []
    for vehicle_index, vehicle in enumerate(vehicles):
        evaluator = routing.RegisterTransitCallback(arc_cost_callback(vehicle))
        routing.SetArcCostEvaluatorOfVehicle(evaluator, vehicle_index)
        solver_fixed_cost = 0
        if data["goal"] == "vehicles":
            solver_fixed_cost = 100_000_000
        elif data["goal"] == "utilization":
            capacity_penalty = int(num(vehicle.get("maxVolume"), 1) / max_vehicle_volume * 5_000_000)
            solver_fixed_cost = 60_000_000 + capacity_penalty
        elif data["goal"] == "cost":
            fixed_cost = num(vehicle.get("fixedCost"), data["costModel"]["fixedVehicleCost"])
            solver_fixed_cost = max(0, round_half_up_int(fixed_cost * 100))
        elif data["goal"] == "balanced_seed":
            fixed_cost = num(vehicle.get("fixedCost"), data["costModel"]["fixedVehicleCost"])
            combined = data["balancedWeights"]["vehicles"] * 100_000 + fixed_cost * data["balancedWeights"]["cost"] * 100
            solver_fixed_cost = max(0, round_half_up_int(combined))
        routing.SetFixedCostOfVehicle(solver_fixed_cost, vehicle_index)
        fixed_costs.append(solver_fixed_cost)

    service_minutes = [0] + [max(0, round_half_up_int(num(order.get("serviceMin"), data["defaultServiceMinutes"]))) for order in orders]

    def time_callback(from_index: int, to_index: int) -> int:
        start_node, end_node = manager.IndexToNode(from_index), manager.IndexToNode(to_index)
        return minute_matrix[start_node][end_node] + service_minutes[start_node]

    time_index = routing.RegisterTransitCallback(time_callback)
    max_waiting = max(0, int(num(data["constraints"].get("maxWaitingMinutes"), CONTRACT["time"]["maxWaitingMinutes"])))
    max_route_minutes = max(1, int(num(data["constraints"].get("maxRouteMinutes"), 48 * 60)))
    routing.AddDimension(time_index, max_waiting, max(48 * 60, max_route_minutes), False, "Time")
    time_dimension = routing.GetDimensionOrDie("Time")
    work_start = time_to_minutes(data["constraints"].get("workStart"), 9 * 60)
    work_end = time_to_minutes(data["constraints"].get("workEnd"), 17 * 60 + 30)
    for vehicle_index, vehicle in enumerate(vehicles):
        start = time_to_minutes(vehicle.get("start"), work_start)
        end = overnight_end(start, time_to_minutes(vehicle.get("end"), work_end)) + data["shiftExtensionMinutes"]
        time_dimension.CumulVar(routing.Start(vehicle_index)).SetRange(start, start)
        time_dimension.CumulVar(routing.End(vehicle_index)).SetRange(start, end)
    for order_index, order in enumerate(orders, start=1):
        tw_start, tw_end = normalized_window_minutes(order.get("twStart"), order.get("twEnd"), work_start, work_start, work_end)
        time_dimension.CumulVar(manager.NodeToIndex(order_index)).SetRange(tw_start, tw_end)

    span_coefficient = 0
    if data["goal"] == "balanced_seed":
        span_coefficient = max(1, round_half_up_int(data["balancedWeights"]["latestEnd"] * 100))
        time_dimension.SetGlobalSpanCostCoefficient(span_coefficient)

    volume_scale = int(num(data["constraints"].get("capacityScale"), CONTRACT["capacity"]["volumeScale"]))
    volume_demands = [0] + [max(0, scaled_int(order.get("volume"), volume_scale)) for order in orders]
    volume_caps = [max(1, scaled_int(vehicle.get("maxVolume"), volume_scale)) for vehicle in vehicles]

    def volume_callback(from_index: int) -> int:
        return volume_demands[manager.IndexToNode(from_index)]

    routing.AddDimensionWithVehicleCapacity(routing.RegisterUnaryTransitCallback(volume_callback), 0, volume_caps, True, "Volume")

    weight_scale = int(num(data["constraints"].get("weightScale"), CONTRACT["capacity"]["weightScale"]))
    weight_demands = [0] + [max(0, scaled_int(order.get("weight"), weight_scale)) for order in orders]
    weight_caps = [max(1, scaled_int(vehicle.get("maxWeight"), weight_scale)) for vehicle in vehicles]

    def weight_callback(from_index: int) -> int:
        return weight_demands[manager.IndexToNode(from_index)]

    routing.AddDimensionWithVehicleCapacity(routing.RegisterUnaryTransitCallback(weight_callback), 0, weight_caps, True, "Weight")

    max_arc_cost = max(
        business_arc_cost(vehicle, start_node, end_node)
        for vehicle in vehicles
        for start_node in range(len(points))
        for end_node in range(len(points))
    )
    priority_weights = [max(1, int(num(order.get("priorityWeight"), 1))) for order in orders]
    proof = lexicographic_bounds(priority_weights, len(vehicles), max_arc_cost, fixed_costs, span_coefficient, max(48 * 60, max_route_minutes))
    data["lexicographicProof"] = proof
    for order_index, order in enumerate(orders, start=1):
        priority = priority_weights[order_index - 1]
        penalty = priority * proof["priorityScale"] + proof["assignedScale"]
        routing.AddDisjunction([manager.NodeToIndex(order_index)], penalty)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.FromSeconds(data["timeLimitSeconds"])
    optimizer_started = time.perf_counter()
    solution = routing.SolveWithParameters(params)
    solve_ms = round((time.perf_counter() - optimizer_started) * 1000, 1)
    if solution is None:
        unassigned = [reason_row(order, "solver_no_solution", "求解器在当前时限内未找到可行方案", "检查时间窗、容量或增加求解时限", "unassigned") for order in orders]
        return create_empty_plan(data, blocked, unassigned)

    date_label = data["date"] if data["date"] != "ALL" else "OPT-ALL"
    fixed_depot = {**depot, "lon": depot_lon, "lat": depot_lat}
    routes: list[dict[str, Any]] = []
    route_features: list[dict[str, Any]] = []
    stop_features: list[dict[str, Any]] = []
    assigned_nodes: set[int] = set()

    for vehicle_index, vehicle in enumerate(vehicles):
        index = routing.Start(vehicle_index)
        route_nodes: list[int] = []
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            if node:
                route_nodes.append(node)
                assigned_nodes.add(node)
            index = solution.Value(routing.NextVar(index))
        if not route_nodes:
            continue

        color = vehicle.get("color") or COLORS[len(routes) % len(COLORS)]
        route_id = f"{date_label}-{len(routes) + 1:02d}"
        coords = [[depot_lon, depot_lat]]
        route_meters = 0
        route_weight = route_volume = 0.0
        route_driving_minutes = 0
        packages = 0
        previous_node = 0
        route_start = time_to_minutes(vehicle.get("start"), work_start)
        schedule = deterministic_route_schedule(
            route_nodes, orders, vehicle, minute_matrix, service_minutes,
            max_waiting, work_start, work_end,
        )
        departure_minutes = route_start
        route_regions: set[str] = set()
        for sequence, node in enumerate(route_nodes, start=1):
            order = orders[node - 1]
            point = [num(order.get("lon")), num(order.get("lat"))]
            leg_meters = km_matrix[previous_node][node]
            leg_minutes = minute_matrix[previous_node][node]
            route_meters += leg_meters
            route_driving_minutes += leg_minutes
            timing = schedule[sequence - 1]
            raw_arrival = timing["rawArrival"]
            arrive = timing["arrive"]
            depart = timing["depart"]
            departure_minutes = depart
            route_weight += num(order.get("weight"))
            route_volume += num(order.get("volume"))
            packages += int(num(order.get("count"), 1))
            region = text(order.get("region") or order.get("province") or order.get("city"))
            if region:
                route_regions.add(region)
            coords.append(point)
            stop_features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": point},
                "properties": {
                    "date": date_label,
                    "routeId": route_id,
                    "vehicleId": vehicle.get("vehicleId"),
                    "vehicleName": vehicle.get("vehicleName", "配送车辆"),
                    "seq": sequence,
                    "orderId": order.get("id"),
                    "code": order.get("code") or order.get("id"),
                    "name": order.get("name") or order.get("code") or order.get("id"),
                    "addr": order.get("addr", ""),
                    "region": region,
                    "batch": sequence,
                    "count": int(num(order.get("count"), 1)),
                    "weight": num(order.get("weight")),
                    "volume": num(order.get("volume")),
                    "serviceMin": service_minutes[node],
                    "arrive": minutes_to_time(arrive),
                    "depart": minutes_to_time(depart),
                    "travelMeters": leg_meters,
                    "travelKm": round(leg_meters / 1000, 3),
                    "travelMin": leg_minutes,
                    "waitingMinutes": timing["waiting"],
                    "coordStatus": "OK",
                    "cargoCodes": order.get("id"),
                    "color": color,
                },
            })
            previous_node = node

        route_meters += km_matrix[previous_node][0]
        route_driving_minutes += minute_matrix[previous_node][0]
        coords.append([depot_lon, depot_lat])
        end_time = departure_minutes + minute_matrix[previous_node][0]
        route_km = route_meters / 1000
        max_weight_value = num(vehicle.get("maxWeight"))
        max_volume_value = max(1, num(vehicle.get("maxVolume"), 1))
        fixed_cost = num(vehicle.get("fixedCost"), data["costModel"]["fixedVehicleCost"])
        per_km_cost = num(vehicle.get("perKmCost"), data["costModel"]["perKm"])
        per_minute_cost = num(vehicle.get("perMinuteCost"), data["costModel"]["perMinute"])
        per_stop_cost = num(vehicle.get("perStopCost"), data["costModel"]["perStop"])
        emission_factor = num(vehicle.get("emissionFactor"), data["carbonModel"]["defaultVehicleFactor"])
        route = {
            "date": date_label,
            "routeId": route_id,
            "vehicleId": vehicle.get("vehicleId") or f"V{vehicle_index + 1:02d}",
            "vehicleName": vehicle.get("vehicleName") or "配送车辆",
            "orders": len(route_nodes),
            "stops": len(route_nodes),
            "packages": packages,
            "weight": round(route_weight, 3),
            "maxWeight": max_weight_value,
            "volume": round(route_volume, 3),
            "maxVolume": max_volume_value,
            "roadMeters": route_meters,
            "km": round(route_km, 3),
            "drivingMinutes": route_driving_minutes,
            "startMinutes": route_start,
            "returnMinutes": end_time,
            "start": minutes_to_time(route_start),
            "end": minutes_to_time(end_time),
            "status": "OK",
            "weightUtil": f"{round(route_weight / max_weight_value * 100, 1)}%" if max_weight_value > 0 else "N/A",
            "volumeUtil": f"{round(route_volume / max_volume_value * 100, 1)}%",
            "fixedCost": round(fixed_cost, 4),
            "kmCost": round(route_km * per_km_cost, 4),
            "timeCost": round(route_driving_minutes * per_minute_cost, 4),
            "stopCost": round(len(route_nodes) * per_stop_cost, 4),
            "estimatedCost": round(fixed_cost + route_km * per_km_cost + route_driving_minutes * per_minute_cost + len(route_nodes) * per_stop_cost, 4),
            "estimatedCo2": round(route_km * emission_factor, 6),
            "perKmCost": per_km_cost,
            "perMinuteCost": per_minute_cost,
            "perStopCost": per_stop_cost,
            "emissionFactor": emission_factor,
            "region": next(iter(route_regions)) if len(route_regions) == 1 else ("多个区域" if route_regions else ""),
            "color": color,
        }
        routes.append(route)
        route_features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords}, "properties": {**route, "color": color}})

    assigned_orders = [orders[node - 1] for node in sorted(assigned_nodes)]
    remaining_orders = [order for index, order in enumerate(orders, start=1) if index not in assigned_nodes]
    total_volume = sum(num(order.get("volume")) for order in orders)
    total_volume_capacity = sum(num(vehicle.get("maxVolume")) for vehicle in vehicles)
    total_weight = sum(num(order.get("weight")) for order in orders)
    total_weight_capacity = sum(num(vehicle.get("maxWeight")) for vehicle in vehicles)
    unassigned: list[dict[str, Any]] = []
    for order in remaining_orders:
        if total_volume > total_volume_capacity or (total_weight_capacity > 0 and total_weight > total_weight_capacity):
            unassigned.append(reason_row(order, "total_capacity", "车辆数量或总容量不足", "增加车辆、拆单或调整批次", "unassigned"))
        elif order.get("twStart") or order.get("twEnd"):
            unassigned.append(reason_row(order, "time_window", "时间窗不可满足", "放宽时间窗或调整车辆班次", "unassigned"))
        else:
            unassigned.append(reason_row(order, "solver_time_limit", "求解器在当前时限内未找到可行分配", "增加求解时限或调整硬约束", "unassigned"))

    latest_end_value = max((int(route.get("returnMinutes", 0)) for route in routes), default=0)
    total_road_meters = sum(int(route.get("roadMeters", 0)) for route in routes)
    total_km = round(total_road_meters / 1000, 3)
    average_volume = round(sum(num(text(route.get("volumeUtil")).rstrip("%")) for route in routes) / max(1, len(routes)), 1)
    average_weight_values = [num(text(route.get("weightUtil")).rstrip("%")) for route in routes if route.get("weightUtil") != "N/A"]
    day_summary = {
        "date": date_label,
        "vehicles": len(routes),
        "routes": len(routes),
        "orders": len(assigned_orders),
        "destinations": len(stop_features),
        "stops": len(stop_features),
        "stopBatches": len(stop_features),
        "packages": sum(int(num(route.get("packages"))) for route in routes),
        "weight": round(sum(num(route.get("weight")) for route in routes), 1),
        "volume": round(sum(num(route.get("volume")) for route in routes), 1),
        "km": total_km,
        "latestEnd": minutes_to_time(latest_end_value) if latest_end_value else "-",
        "vehicleUtil": f"{round(len(routes) / max(1, len(vehicles)) * 100, 1)}%",
        "avgVolumeUtil": f"{average_volume}%",
        "avgWeightUtil": f"{round(sum(average_weight_values) / len(average_weight_values), 1)}%" if average_weight_values else "N/A",
    }
    conservation = {
        "input": len(data["orders"]),
        "assigned": len(assigned_orders),
        "unassigned": len(unassigned),
        "blocked": len(blocked),
    }
    conservation["balanced"] = conservation["input"] == conservation["assigned"] + conservation["unassigned"] + conservation["blocked"]
    metadata = build_metadata(data)
    utilization = utilization_metrics(routes, num(data["scenario"].get("assumptions", {}).get("lowUtilizationThreshold"), 35))
    total_cost = round(sum(num(route.get("estimatedCost")) for route in routes), 4)
    total_co2 = round(sum(num(route.get("estimatedCo2")) for route in routes), 6)
    assigned_volume = sum(num(order.get("volume")) for order in assigned_orders)
    assigned_weight = sum(num(order.get("weight")) for order in assigned_orders)
    volume_lower_bound = capacity_lower_bound(assigned_volume, vehicles, "maxVolume")
    weight_lower_bound = capacity_lower_bound(assigned_weight, vehicles, "maxWeight") if assigned_weight > 0 else 0
    metadata["solveStats"] = {
        "status": "BEST_FOUND",
        "timeLimitSeconds": data["timeLimitSeconds"],
        "solveMs": solve_ms,
        "matrixBuildMs": matrix_build_ms,
        "totalMs": round((time.perf_counter() - solve_started) * 1000, 1),
        "solverObjectiveValue": int(solution.ObjectiveValue()),
        "globalOptimalityProven": False,
    }
    metadata["minimumVehicleEvidence"] = {
        "method": "capacity lower bound and current candidate pool",
        "usedVehicles": len(routes),
        "volumeLowerBound": volume_lower_bound,
        "weightLowerBound": weight_lower_bound,
        "proof": volume_lower_bound == len(routes) or weight_lower_bound == len(routes),
        "note": "Capacity lower bounds are necessary conditions, not a complete VRP feasibility proof unless they equal the used vehicle count.",
    }
    metrics = {
        "assigned": len(assigned_orders),
        "unassigned": len(unassigned),
        "blocked": len(blocked),
        "servicePriorityScore": sum(max(1, num(order.get("priorityWeight"), 1)) for order in assigned_orders),
        "vehicles": len(routes),
        "usedVehicles": len(routes),
        "routes": len(routes),
        "orders": len(assigned_orders),
        "stops": len(stop_features),
        "packages": day_summary["packages"],
        "totalDistance": total_km,
        "estimatedRoadKm": total_km,
        "roadMeters": total_road_meters,
        "latestEnd": day_summary["latestEnd"],
        "latestEndMinutes": latest_end_value,
        "avgVolume": average_volume,
        "avgWeight": round(sum(average_weight_values) / len(average_weight_values), 1) if average_weight_values else None,
        "cost": total_cost,
        "totalCost": total_cost,
        "co2": total_co2,
        "totalCO2": total_co2,
        "serviceRate": round(len(assigned_orders) / max(1, len(data["orders"])) * 100, 1),
        **utilization,
    }
    fingerprint = plan_fingerprint(routes, stop_features)
    plan = {
        "engine": "OR-Tools",
        "scenarioId": data["scenarioId"],
        "inputHash": data["inputHash"],
        "routes": routes,
        "routeGeoJson": {"type": "FeatureCollection", "features": route_features},
        "stopGeoJson": {"type": "FeatureCollection", "features": stop_features},
        "depot": fixed_depot,
        "daySummaries": [day_summary],
        "missingStops": [*blocked, *unassigned],
        "unassignedOrders": unassigned,
        "blockedOrders": blocked,
        "splitRows": [],
        "conservation": conservation,
        "metrics": metrics,
        "fingerprint": fingerprint,
        "meta": {**metadata, "planFingerprint": fingerprint},
    }
    return attach_trust_identity(plan, data)


MAX_REQUEST_BYTES = 64 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def _local_origin(self) -> bool:
        host = urlsplit("http://" + self.headers.get("Host", "")).hostname
        if host not in {"127.0.0.1", "localhost"}:
            return False
        origin = self.headers.get("Origin")
        if origin is None:
            return True
        if not origin or origin == "null":
            return False
        parsed = urlsplit(origin)
        return parsed.scheme in {"http", "https"} and parsed.hostname in {"127.0.0.1", "localhost"} and not parsed.username and not parsed.password

    def _send(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        origin = self.headers.get("Origin")
        if origin and self._local_origin():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self) -> None:
        if not self._local_origin():
            self._send(403, {"error": {"code": "LOCAL_ORIGIN_REQUIRED", "details": {}}})
            return
        self._send(200, {"ok": True})

    def do_GET(self) -> None:
        if not self._local_origin():
            self._send(403, {"error": {"code": "LOCAL_ORIGIN_REQUIRED", "details": {}}})
            return
        if self.path.startswith("/supply-chain-jobs-v6/"):
            try:
                parsed = urlsplit(self.path)
                self._send(200, job_identity(JOBS.get(parsed.path.split("/")[2], parse_qs(parsed.query).get("results") == ["1"])))
            except JobError as exc:
                self._send(exc.status, {"error": {"code": exc.code, "details": {}}})
            return
        if self.path.startswith("/health"):
            available = pywrapcp is not None
            supply_ready = available and cp_model is not None
            self._send(200, {
                "ok": True,
                "available": available,
                "engine": "OR-Tools" if available else "Demo Heuristic",
                "status": "ready" if available else "ortools_unavailable",
                "appVersion": CONTRACT["appVersion"],
                "version": "v1.4-trust-closure-mission-control",
                "contractVersion": CONTRACT["contractVersion"],
                "appContractVersion": CONTRACT["contractVersion"],
                "canonicalVersion": CONTRACT["canonicalVersion"],
                "actualEngineVersion": getattr(ortools_package, "__version__", None),
                "actualOrtoolsVersion": getattr(ortools_package, "__version__", None),
                "pythonVersion": platform.python_version(),
                "platform": platform.platform(),
                "maxSolveSeconds": MAX_SOLVE_SECONDS,
                "maxOrders": MAX_ORDERS,
                "supplyChainJobsV6": True,
                "startedAt": STARTED_AT,
                "endpoint": f"http://{self.server.server_address[0]}:{self.server.server_address[1]}",
                "instanceId": INSTANCE_ID,
                "buildFingerprint": BUILD_FINGERPRINT,
                "buildFiles": list(_BUILD_FILES),
                "protocolVersion": SUPPLY_PROTOCOL_VERSION,
                "modelVersion": SUPPLY_MODEL_VERSION,
                "capabilities": ["FACILITY", "SUPPLY_CHAIN_JOBS_V6", "UPSTREAM_ONLY", "FULL_CHAIN", "QUANTITY_SCALE_V2", "FACILITY_ACTIVATION_COST_V86"] if supply_ready else [],
                "dependencies": {"ortools": available, "cpSat": cp_model is not None, "supplyChainReady": supply_ready},
            })
        else:
            self._send(404, {"ok": False, "error": {"code": "NOT_FOUND", "message": "Not found", "details": {}}})

    def do_POST(self) -> None:
        if not self._local_origin():
            self._send(403, {"error": {"code": "LOCAL_ORIGIN_REQUIRED", "details": {}}})
            return
        if self.path == "/supply-chain-jobs-v6" or self.path.startswith("/supply-chain-jobs-v6/"):
            try:
                if self.path.endswith("/cancel"):
                    self._send(200, job_identity(JOBS.cancel(self.path.split("/")[2])))
                    return
                length = int(self.headers.get("Content-Length", "0"))
                if length > MAX_REQUEST_BYTES:
                    self._send(413, {"error": {"code": "REQUEST_TOO_LARGE", "details": {"limit": MAX_REQUEST_BYTES}}})
                    return
                if self.path != "/supply-chain-jobs-v6" or not 0 < length <= 20_000_000:
                    raise JobError("SUPPLY_JOB_SPEC_INVALID")
                if pywrapcp is None or cp_model is None:
                    raise JobError("ORTOOLS_UNAVAILABLE", 503)
                self._send(202, job_identity(JOBS.start(json.loads(self.rfile.read(length).decode("utf-8")))))
            except JobError as exc:
                self._send(exc.status, {"error": {"code": exc.code, "details": {}}})
            except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
                self._send(400, {"error": {"code": "SUPPLY_JOB_SPEC_INVALID", "details": {}}})
            return
        if urlsplit(self.path).path not in {"/optimize", "/reoptimize-v16", "/facility-optimize-v19", "/supply-chain-optimize-v19"}:
            self._send(404, {"ok": False, "error": {"code": "NOT_FOUND", "message": "Not found", "details": {}}})
            return
        if pywrapcp is None or ((self.path.startswith("/facility-optimize-v19") or self.path.startswith("/supply-chain-optimize-v19")) and cp_model is None):
            if self.path.startswith("/reoptimize-v16"):
                self._send(503, {"ok": False, "engine": "OR-Tools", "availability": "SKIPPED_DEPENDENCY", "error": {"code": "ORTOOLS_UNAVAILABLE", "message": "Full reoptimization is unavailable because the local OR-Tools dependency is not available.", "details": {}}})
            else:
                self._send(503, {"ok": False, "engine": "Demo Heuristic", "error": {"code": "ORTOOLS_UNAVAILABLE", "message": "OR-Tools is unavailable; use the explicitly labelled Demo Heuristic fallback.", "details": {}}})
            return
        solve_lease = None
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_REQUEST_BYTES:
                self._send(413, {"error": {"code": "REQUEST_TOO_LARGE", "details": {"limit": MAX_REQUEST_BYTES}}})
                return
            if length <= 0 or length > 20_000_000:
                raise ValueError("Request body is empty or exceeds the local demo limit.")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("Request must be a JSON object")
            candidate_lease = uuid.uuid4().hex
            SOLVE_ADMISSION.acquire(candidate_lease)
            solve_lease = candidate_lease
            deadline = time.monotonic() + MAX_SOLVE_SECONDS
            if self.path.startswith("/supply-chain-optimize-v19"):
                self._send(200, solve_joint(payload, cp_model, getattr(ortools_package, "__version__", "unknown"), deadline=deadline))
                return
            if self.path.startswith("/facility-optimize-v19"):
                self._send(200, solve_facility(payload, cp_model, getattr(ortools_package, "__version__", "unknown"), deadline=deadline))
                return
            if self.path.startswith("/reoptimize-v16"):
                result = solve_rolling(
                    payload,
                    pywrapcp,
                    routing_enums_pb2,
                    engine_version=getattr(ortools_package, "__version__", "unknown"),
                    max_seconds=MAX_SOLVE_SECONDS,
                )
                self._send(200, result)
                return
            plan = solve(payload)
            self._send(200, {
                "ok": True,
                "engine": "OR-Tools",
                "version": "v1.4-trust-closure-mission-control",
                "contractVersion": plan.get("contractVersion"),
                "canonicalVersion": plan.get("canonicalVersion"),
                "serverContentHash": plan.get("contentHash"),
                "serverInputHash": plan.get("inputHash"),
                "serverRequestHash": plan.get("requestHash"),
                "serverHashVerified": True,
                "planHash": plan.get("planHash"),
                "actualEngineVersion": getattr(ortools_package, "__version__", None),
                "solverStatus": (plan.get("meta") or {}).get("solveStats", {}).get("status"),
                "solveTimeMs": (plan.get("meta") or {}).get("solveStats", {}).get("solveMs"),
                "lexicographicMethod": (plan.get("meta") or {}).get("objectiveDefinition", {}).get("lexicographicMethod"),
                "lexicographicProof": (plan.get("meta") or {}).get("objectiveDefinition", {}),
                "servicePriorityScore": (plan.get("metrics") or {}).get("servicePriorityScore", 0),
                "assignedCount": (plan.get("metrics") or {}).get("assigned", 0),
                "reportedMetrics": plan.get("reportedMetrics") or {},
                "modelDiagnostics": {"conservation": plan.get("conservation") or {}},
                "scenarioId": plan.get("scenarioId"),
                "inputHash": plan.get("inputHash"),
                "requestHash": plan.get("requestHash"),
                "requestId": (payload or {}).get("requestId"),
                "plan": plan,
            })
        except SolverBusy:
            self._send(429, {"error": {"code": "SUPPLY_JOB_BUSY", "details": {"retryable": True}}})
        except CanonicalError as exc:
            self._send(400, {"ok": False, "engine": "OR-Tools", "error": {"code": exc.code, "message": str(exc), "details": exc.details}})
        except (RollingSolveError, RoutingContractError) as exc:
            self._send(400, {"ok": False, "engine": "OR-Tools", "error": {"code": exc.code, "message": str(exc), "details": getattr(exc, "detail", None) or {}}})
        except FacilityError as exc:
            self._send(400, {"ok": False, "engine": "OR-Tools CP-SAT", "error": {"code": exc.code, "message": str(exc), "details": exc.detail}})
        except SupplyChainSolveError as exc:
            self._send(400, {"ok": False, "engine": "OR-Tools CP-SAT", "error": {"code": exc.code, "message": str(exc), "details": exc.detail}})
        except ValueError as exc:
            self._send(400, {"ok": False, "engine": "OR-Tools", "error": {"code": "INVALID_REQUEST", "message": str(exc), "details": {}}})
        except Exception as exc:
            print(f"optimizer_internal_error {type(exc).__name__}: {exc}", flush=True)
            self._send(500, {"ok": False, "engine": "OR-Tools", "error": {"code": "OPTIMIZER_INTERNAL_ERROR", "message": "The optimizer could not process this request.", "details": {}}})

        finally:
            if solve_lease is not None:
                SOLVE_ADMISSION.release(solve_lease)

    def log_message(self, fmt: str, *args: Any) -> None:
        print(fmt % args, flush=True)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"LOSPOLLOS optimizer service listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
