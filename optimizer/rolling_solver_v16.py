"""Road-matrix-backed rolling reoptimization for the STCT v1.6 local demo."""

from __future__ import annotations

import copy
import math
import time
from typing import Any

try:
    from routing_contract_v16 import RoutingContractError, optimizer_matrix_payload, stable_hash
except ImportError:
    from optimizer.routing_contract_v16 import RoutingContractError, optimizer_matrix_payload, stable_hash


SCHEMA = "stct-rolling-solve-request-v1.6"


class RollingSolveError(ValueError):
    def __init__(self, code: str, message: str, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.detail = detail or {}


def _text(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else fallback
    except (TypeError, ValueError):
        return fallback


def _context_identity(value: dict[str, Any]) -> dict[str, Any]:
    fields = (
        "baseInputHash", "currentPlanHash", "executionRunHash", "executionStateHash",
        "cutoffLogicalMinute", "vehicleStates", "completedStopIds", "activeStopIds",
        "failedStopIds", "remainingOrderIds", "cancelledOrderIds", "loadedOrderAssignments",
        "lockedRouteIds", "fixedRoutePrefixes", "transferPolicy", "matrixHash",
        "providerProvenance",
    )
    return {"schemaVersion": "stct-rolling-plan-context-v1.6", **{field: copy.deepcopy(value.get(field)) for field in fields}}


def _scenario_identity(value: dict[str, Any]) -> dict[str, Any]:
    semantic = copy.deepcopy(value)
    semantic.pop("inputHash", None)
    semantic.pop("contentHash", None)
    semantic.pop("generatedAt", None)
    return semantic


def _request_identity(value: dict[str, Any]) -> dict[str, Any]:
    fields = (
        "rollingContextHash", "derivedInputHash", "matrixHash", "objective",
        "timeLimitSeconds", "fixedAssignments", "fixedPrefixes", "changePenaltyWeights",
        "incidentHash",
    )
    return {"schemaVersion": SCHEMA, **{field: copy.deepcopy(value.get(field)) for field in fields}}


def validate_request(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict) or payload.get("schemaVersion") != SCHEMA:
        raise RollingSolveError("ROLLING_SOLVE_SCHEMA_UNSUPPORTED", "Rolling solve request schema is unsupported.")
    context = payload.get("rollingContext")
    scenario = payload.get("derivedScenario")
    matrix = payload.get("authoritativeMatrix")
    if not isinstance(context, dict) or not isinstance(scenario, dict) or not isinstance(matrix, dict):
        raise RollingSolveError("ROLLING_SOLVE_ENVELOPE_INVALID", "Rolling context, derived scenario, and authoritative matrix are required.")
    context_hash = stable_hash(_context_identity(context))
    if payload.get("rollingContextHash") != context_hash or context.get("contextHash") != context_hash:
        raise RollingSolveError("ROLLING_CONTEXT_HASH_STALE", "Rolling context hash is stale.", {"expectedHash": context_hash})
    input_hash = stable_hash(_scenario_identity(scenario))
    if payload.get("derivedInputHash") != input_hash or payload.get("claimedInputHash") != input_hash or scenario.get("inputHash") != input_hash:
        raise RollingSolveError("DERIVED_INPUT_HASH_STALE", "Derived scenario input hash is stale.", {"expectedHash": input_hash})
    request_hash = stable_hash(_request_identity(payload))
    if payload.get("claimedRequestHash") != request_hash:
        raise RollingSolveError("ROLLING_REQUEST_HASH_STALE", "Rolling solve request hash is stale.", {"expectedHash": request_hash})

    point_ids = [_text(item) for item in payload.get("matrixPointIds") or []]
    required_ids: list[str] = []
    for vehicle in scenario.get("vehicles") or []:
        if vehicle.get("available") is False:
            continue
        required_ids.extend([_text(vehicle.get("startPointId")), _text(vehicle.get("endPointId"))])
    required_ids.extend(_text(order.get("id")) for order in scenario.get("orders") or [])
    required = {item for item in required_ids if item}
    if len(point_ids) != len(set(point_ids)) or set(point_ids) != required:
        raise RollingSolveError("MATRIX_POINT_MAPPING_MISMATCH", "Matrix point IDs do not exactly match rolling starts, ends, and orders.", {"required": sorted(required), "actual": point_ids})
    matrix_payload = optimizer_matrix_payload(matrix, point_ids)
    if payload.get("matrixHash") != matrix_payload["matrixHash"] or context.get("matrixHash") != matrix_payload["matrixHash"] or scenario.get("matrixHash") != matrix_payload["matrixHash"]:
        raise RollingSolveError("ROLLING_MATRIX_HASH_MISMATCH", "Rolling request matrix hashes do not match the authoritative matrix.")
    return {
        "payload": copy.deepcopy(payload),
        "context": copy.deepcopy(context),
        "scenario": copy.deepcopy(scenario),
        "matrix": matrix_payload,
        "requestHash": request_hash,
        "inputHash": input_hash,
        "contextHash": context_hash,
    }


def solve_rolling(
    payload: dict[str, Any],
    pywrapcp: Any,
    routing_enums_pb2: Any,
    *,
    engine_version: str,
    max_seconds: int = 45,
) -> dict[str, Any]:
    if pywrapcp is None or routing_enums_pb2 is None:
        raise RollingSolveError("ORTOOLS_UNAVAILABLE", "OR-Tools is unavailable for full reoptimization.")
    validated = validate_request(payload)
    scenario = validated["scenario"]
    context = validated["context"]
    matrix = validated["matrix"]
    point_ids = matrix["pointIds"]
    point_index = {point_id: index for index, point_id in enumerate(point_ids)}
    vehicles = [vehicle for vehicle in scenario.get("vehicles") or [] if vehicle.get("available") is not False]
    orders = list(scenario.get("orders") or [])
    if not vehicles:
        raise RollingSolveError("ROLLING_NO_AVAILABLE_VEHICLE", "No available vehicle remains after the rolling cutoff.")
    starts = [point_index[_text(vehicle.get("startPointId"))] for vehicle in vehicles]
    ends = [point_index[_text(vehicle.get("endPointId"))] for vehicle in vehicles]
    manager = pywrapcp.RoutingIndexManager(len(point_ids), len(vehicles), starts, ends)
    routing = pywrapcp.RoutingModel(manager)
    order_by_point = {_text(order.get("id")): order for order in orders}
    vehicle_index = {_text(vehicle.get("id") or vehicle.get("vehicleId")): index for index, vehicle in enumerate(vehicles)}
    fixed_assignments = {_text(row.get("orderId")): _text(row.get("vehicleId")) for row in payload.get("fixedAssignments") or []}
    base_assignment = {_text(row.get("orderId")): _text(row.get("vehicleId")) for row in context.get("loadedOrderAssignments") or []}
    weights = payload.get("changePenaltyWeights") or {}

    distance_meters = matrix["distanceMeters"]
    duration_minutes = [[int(math.ceil(value / 60)) for value in row] for row in matrix["durationSeconds"]]
    callback_refs: list[Any] = []
    for vehicle_position, vehicle in enumerate(vehicles):
        vehicle_id = _text(vehicle.get("id") or vehicle.get("vehicleId"))

        def cost_callback(from_index: int, to_index: int, *, _vehicle_id: str = vehicle_id) -> int:
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            destination = point_ids[to_node]
            disruption = 0
            previous_vehicle = base_assignment.get(destination)
            if previous_vehicle and previous_vehicle != _vehicle_id:
                disruption = int(round(_number(weights.get("changedVehicles"), 30) + _number(weights.get("driverDisruption"), 25)))
            return int(distance_meters[from_node][to_node]) + disruption

        callback = routing.RegisterTransitCallback(cost_callback)
        callback_refs.append(callback)
        routing.SetArcCostEvaluatorOfVehicle(callback, vehicle_position)

    service_minutes = {_text(order.get("id")): max(0, int(round(_number(order.get("serviceMin", order.get("serviceMinutes", 5)), 5)))) for order in orders}

    def time_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return duration_minutes[from_node][to_node] + service_minutes.get(point_ids[from_node], 0)

    time_index = routing.RegisterTransitCallback(time_callback)
    callback_refs.append(time_index)
    horizon = max(int(_number(context.get("cutoffLogicalMinute"), 0)) + int(_number(vehicle.get("remainingShiftMinutes"), 0)) for vehicle in vehicles) + 24 * 60
    routing.AddDimension(time_index, 24 * 60, max(horizon, 24 * 60), False, "Time")
    time_dimension = routing.GetDimensionOrDie("Time")
    for position, vehicle in enumerate(vehicles):
        start_minute = int(_number(vehicle.get("startMinute"), context.get("cutoffLogicalMinute", 0)))
        end_minute = int(_number(vehicle.get("endMinute"), start_minute + _number(vehicle.get("remainingShiftMinutes"), 0)))
        time_dimension.CumulVar(routing.Start(position)).SetRange(start_minute, start_minute)
        time_dimension.CumulVar(routing.End(position)).SetRange(start_minute, max(start_minute, end_minute))
    for order in orders:
        point_id = _text(order.get("id"))
        index = manager.NodeToIndex(point_index[point_id])
        earliest = int(_number(order.get("twStart", order.get("windowStartMinute", context.get("cutoffLogicalMinute", 0))), context.get("cutoffLogicalMinute", 0)))
        latest = int(_number(order.get("twEnd", order.get("windowEndMinute", horizon)), horizon))
        if latest < earliest:
            latest += 24 * 60
        time_dimension.CumulVar(index).SetRange(max(0, earliest), max(max(0, earliest), latest))

    volume_scale = 1000
    demands = {point_id: max(0, int(round(_number(order.get("volume"), 0) * volume_scale))) for point_id, order in order_by_point.items()}

    def volume_callback(index: int) -> int:
        return demands.get(point_ids[manager.IndexToNode(index)], 0)

    volume_index = routing.RegisterUnaryTransitCallback(volume_callback)
    callback_refs.append(volume_index)
    capacities = [max(0, int(round((_number(vehicle.get("maxVolume"), 0) - _number(vehicle.get("currentLoad"), 0)) * volume_scale))) for vehicle in vehicles]
    routing.AddDimensionWithVehicleCapacity(volume_index, 0, capacities, True, "Volume")

    for order_id, vehicle_id in fixed_assignments.items():
        if order_id not in point_index or vehicle_id not in vehicle_index:
            raise RollingSolveError("ROLLING_FIXED_ASSIGNMENT_INVALID", f"Fixed assignment is invalid: {order_id}/{vehicle_id}")
        routing.VehicleVar(manager.NodeToIndex(point_index[order_id])).SetValue(vehicle_index[vehicle_id])
    for order in orders:
        order_id = _text(order.get("id"))
        index = manager.NodeToIndex(point_index[order_id])
        if order_id not in fixed_assignments:
            routing.AddDisjunction([index], 10**12)

    active_by_vehicle: dict[str, str] = {}
    for vehicle in vehicles:
        active_id = _text(vehicle.get("activeStopId"))
        if active_id:
            vehicle_id = _text(vehicle.get("id") or vehicle.get("vehicleId"))
            if active_id not in point_index:
                raise RollingSolveError("ROLLING_ACTIVE_STOP_INVALID", f"Active stop is absent from the derived scenario: {active_id}")
            active_by_vehicle[vehicle_id] = active_id
            routing.solver().Add(routing.NextVar(routing.Start(vehicle_index[vehicle_id])) == manager.NodeToIndex(point_index[active_id]))

    search = pywrapcp.DefaultRoutingSearchParameters()
    search.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    search.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    limit = max(1, min(int(_number(payload.get("timeLimitSeconds"), 5)), max_seconds))
    search.time_limit.FromSeconds(limit)
    started = time.perf_counter()
    assignment = routing.SolveWithParameters(search)
    solve_ms = int(round((time.perf_counter() - started) * 1000))
    if assignment is None:
        raise RollingSolveError("ROLLING_NO_FEASIBLE_SOLUTION", "OR-Tools found no feasible rolling solution.")

    prefix_by_vehicle = {_text(row.get("vehicleId")): row for row in context.get("fixedRoutePrefixes") or []}
    routes: list[dict[str, Any]] = []
    assigned_orders: set[str] = set()
    for position, vehicle in enumerate(vehicles):
        vehicle_id = _text(vehicle.get("id") or vehicle.get("vehicleId"))
        route_id = _text(prefix_by_vehicle.get(vehicle_id, {}).get("routeId")) or f"ROLL-{position + 1:02d}"
        index = routing.Start(position)
        order_ids: list[str] = []
        eta_by_order: dict[str, int] = {}
        distance_total = 0
        while not routing.IsEnd(index):
            next_index = assignment.Value(routing.NextVar(index))
            from_node = manager.IndexToNode(index)
            to_node = manager.IndexToNode(next_index)
            distance_total += int(distance_meters[from_node][to_node])
            point_id = point_ids[to_node]
            if point_id in order_by_point:
                order_ids.append(point_id)
                assigned_orders.add(point_id)
                eta_by_order[point_id] = int(assignment.Value(time_dimension.CumulVar(next_index)))
            index = next_index
        if order_ids:
            routes.append({
                "routeId": route_id,
                "vehicleId": vehicle_id,
                "startPointId": _text(vehicle.get("startPointId")),
                "endPointId": _text(vehicle.get("endPointId")),
                "orderIds": order_ids,
                "etaByOrder": eta_by_order,
                "totalDistance": distance_total / 1000,
                "distanceUnit": "km",
            })

    candidate = {
        "schemaVersion": "stct-recovery-candidate-v1.6",
        "candidateType": "FULL_REOPTIMIZATION_OR_TOOLS",
        "reference": False,
        "engine": "OR-Tools",
        "engineVersion": engine_version,
        "inputHash": validated["inputHash"],
        "matrixHash": matrix["matrixHash"],
        "incidentHash": _text(payload.get("incidentHash")),
        "contextHash": validated["contextHash"],
        "routes": routes,
        "historicalPrefixes": copy.deepcopy(context.get("fixedRoutePrefixes") or []),
        "unassignedOrderIds": sorted({_text(order.get("id")) for order in orders} - assigned_orders),
        "solverStatus": "BEST_FOUND_WITHIN_LIMIT",
        "optimalityClaim": "NOT_CLAIMED",
        "solveTimeMs": solve_ms,
        "providerProvenance": copy.deepcopy(matrix.get("providerProvenance") or {}),
    }
    candidate["planHash"] = stable_hash({
        "schemaVersion": candidate["schemaVersion"],
        "candidateType": candidate["candidateType"],
        "inputHash": candidate["inputHash"],
        "matrixHash": candidate["matrixHash"],
        "incidentHash": candidate["incidentHash"],
        "contextHash": candidate["contextHash"],
        "routes": [{"routeId": route["routeId"], "vehicleId": route["vehicleId"], "orderIds": route["orderIds"]} for route in routes],
        "historicalPrefixes": candidate["historicalPrefixes"],
        "unassignedOrderIds": candidate["unassignedOrderIds"],
    })
    return {
        "ok": True,
        "engine": "OR-Tools",
        "engineVersion": engine_version,
        "actualOrtoolsVersion": engine_version,
        "solverStatus": candidate["solverStatus"],
        "solveTimeMs": solve_ms,
        "requestHash": validated["requestHash"],
        "matrixHash": matrix["matrixHash"],
        "matrixProvenance": {**copy.deepcopy(matrix.get("providerProvenance") or {}), "authoritative": True, "fallbackUsed": False},
        "candidate": candidate,
    }
