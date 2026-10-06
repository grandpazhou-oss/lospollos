"""Synthetic inputs and independent result checks for the native solver soak.

Only standard-library dependencies and the repository's pure contract modules are
used. No service is imported, solver is substituted, or native execution claimed
by self_test(). All sites/vehicles have finite capacities; joint problems have
both supplier bounds and two separately conserved periods. Synthetic identity
metadata and distances change with sequence, so job reuse cannot hide execution.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from optimizer.canonical_contract import CONTRACT, plan_identity, request_identity, scenario_identity
from optimizer.facility_mvp1 import _validate as validate_facility_request
from optimizer.rolling_solver_v16 import validate_request as validate_rolling_request
from optimizer.routing_contract_v16 import matrix_identity, stable_hash
from optimizer.supply_chain_joint_v19 import _validate as validate_joint_request
from optimizer.supply_chain_jobs_v6 import validate_payloads, validate_spec

ROUTES = ("/optimize", "/reoptimize-v16", "/facility-optimize-v19", "/supply-chain-optimize-v19")
_CONTEXT_FIELDS = ("baseInputHash", "currentPlanHash", "executionRunHash", "executionStateHash",
                   "cutoffLogicalMinute", "vehicleStates", "completedStopIds", "activeStopIds",
                   "failedStopIds", "remainingOrderIds", "cancelledOrderIds", "loadedOrderAssignments",
                   "lockedRouteIds", "fixedRoutePrefixes", "transferPolicy", "matrixHash", "providerProvenance")
_REQUEST_FIELDS = ("rollingContextHash", "derivedInputHash", "matrixHash", "objective", "timeLimitSeconds",
                   "fixedAssignments", "fixedPrefixes", "changePenaltyWeights", "incidentHash")


def _check(condition, message):
    if not condition:
        raise AssertionError(message)


def _json_hash(value):
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _number(value, label="number"):
    _check(type(value) in (int, float) and math.isfinite(value), f"{label}: not a finite number")
    return Decimal(str(value))


def _near(actual, expected, label, tolerance="0.000001"):
    a, b = _number(actual, label), Decimal(str(expected))
    _check(abs(a-b) <= Decimal(tolerance), f"{label}: {a} != {b}")


def _scaled(value, scale=1000):
    return int((Decimal(str(value))*scale).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _finite_tree(value):
    if isinstance(value, dict):
        for child in value.values():
            _finite_tree(child)
    elif isinstance(value, list):
        for child in value:
            _finite_tree(child)
    elif isinstance(value, float):
        _check(math.isfinite(value), "result contains a non-finite number")


def _ids(rows, field):
    values = [row[field] for row in rows]
    _check(len(values) == len(set(values)), f"duplicate {field}")
    return {row[field]: row for row in rows}


def _optimize(demand_count, site_count, sequence):
    # Start with a real canonical fixture, replacing all business entities.
    fixture = json.loads((ROOT / "shared/canonical-hash-fixtures.json").read_text(encoding="utf-8"))
    scenario = copy.deepcopy(fixture["cases"][0]["scenario"])
    date = "2026-10-06"
    scenario.update(planningMode="SINGLE_DAY", planningDate=date,
                    depot={"id": "DEPOT", "name": "Synthetic depot", "address": "Synthetic", "lon": 117, "lat": 39})
    cap = math.ceil(demand_count/site_count) + 1
    scenario["orders"] = [{"id": f"D{i:04d}", "code": f"D{i:04d}", "name": "Synthetic demand",
        "address": "Synthetic", "date": date, "lon": round(117.001 + (i % 20)*0.0001 + sequence*0.0000001, 7),
        "lat": round(39.001 + (i//20)*0.0001, 7), "count": 1, "volume": 1, "weight": 2,
        "serviceMin": 1, "twStart": "09:00", "twEnd": "18:00", "priority": "normal",
        "priorityWeight": 1, "prioritySource": "mapped", "orderType": "", "requiredVehicleType": ""}
        for i in range(demand_count)]
    scenario["vehicles"] = [{"id": f"V{j:03d}", "name": "Synthetic vehicle", "type": "van",
        "availableDate": date, "maxVolume": cap, "maxWeight": cap*2, "start": "09:00", "end": "18:00",
        "fixedCost": 100+j, "perKmCost": 2, "perMinuteCost": 0.5, "perStopCost": 1,
        "emissionFactor": 0.2, "sourceVehicleId": f"V{j:03d}", "isVirtual": False, "enabled": True}
        for j in range(site_count)]
    scenario["constraints"].update(singleTrip=True, maxWaitingMinutes=90, workStart="09:00", workEnd="18:00",
        maxOrders=500, maxSolveSeconds=45, allowUnassigned=True, capacityScale=1000, weightScale=1000,
        maxStops=500, maxRouteMinutes=540, shiftExtensionMinutes=0)
    scenario["assumptions"].update(roadDistanceFactor=1, averageSpeedKmh=60, defaultServiceMin=1)
    identity = scenario_identity(scenario)
    search = {"firstSolutionStrategy": "parallel-cheapest-insertion", "localSearchMetaheuristic": "guided-local-search",
              "randomSeed": 13, "logSearch": False, "servicePolicy": "priority-score-then-assigned-count-then-business-objective"}
    options = {"objective": "service", "timeLimitSeconds": 1, "engineRequested": "ortools", "searchConfiguration": search}
    return {"version": "v1.3-trust-gates", "contractVersion": CONTRACT["contractVersion"],
        "canonicalVersion": CONTRACT["canonicalVersion"], "requestId": f"SOAK-OPT-{sequence}", "requestSequence": sequence,
        "canonicalScenario": identity["scenario"], "claimedContentHash": identity["contentHash"],
        "claimedInputHash": identity["inputHash"], "claimedRequestHash": request_identity(identity["inputHash"], options)["requestHash"], **options}


def _rolling(demand_count, site_count, sequence, optimize):
    order_ids = [f"D{i:04d}" for i in range(demand_count)]
    vehicle_ids = [f"V{j:03d}" for j in range(site_count)]
    points = [f"{vid}-START" for vid in vehicle_ids] + ["DEPOT-END"] + order_ids
    distances = [[0 if i == j else 100+2*abs(i-j)+sequence for j in range(len(points))] for i in range(len(points))]
    provenance = {"providerId": "SYNTHETIC_SOAK_MATRIX", "providerVersion": "1", "synthetic": True,
                  "authoritative": True, "fallbackUsed": False, "haversineSubstituted": False}
    matrix = {"schemaVersion": "stct-road-matrix-v1.6", "providerId": provenance["providerId"], "providerVersion": "1",
        "graphHash": stable_hash({"syntheticGraph": sequence, "points": points}),
        "requestHash": stable_hash({"points": points, "sequence": sequence}), "profile": "synthetic-van",
        "sourceIds": points, "targetIds": points[:], "distances": distances,
        "durations": [[0 if i == j else 60 for j in range(len(points))] for i in range(len(points))],
        "distanceUnit": "m", "durationUnit": "seconds", "unreachablePairs": [], "closureIds": [],
        "vehicleProfile": {}, "avoidTolls": False, "trafficMode": "NONE", "departureTimeApplied": False,
        "providerProvenance": provenance}
    matrix["matrixHash"] = stable_hash(matrix_identity(matrix))
    prefixes = [{"routeId": f"R{j:03d}", "vehicleId": vid, "stopIds": [f"H{j:03d}"]} for j, vid in enumerate(vehicle_ids)]
    fixed = [{"orderId": order_ids[j], "vehicleId": vid} for j, vid in enumerate(vehicle_ids)]
    cap = math.ceil(demand_count/site_count)+1
    states = [{"vehicleId": vid, "status": "IN_SERVICE", "currentLogicalMinute": 600,
        "currentCoordinate": [117, 39], "currentRoadNodeId": f"{vid}-START", "currentLoad": 0,
        "completedStopIds": [f"H{j:03d}"], "activeStopId": order_ids[j], "remainingLoadedOrderIds": [],
        "remainingShiftMinutes": 480, "available": True, "failureReason": "", "atDepot": False}
        for j, vid in enumerate(vehicle_ids)]
    # The historical stops really belong to the hashed base scenario. They are
    # removed at the cutoff, leaving exactly demand_count remaining orders.
    base_scenario = copy.deepcopy(optimize["canonicalScenario"])
    for j in range(site_count):
        historical = copy.deepcopy(base_scenario["orders"][j])
        historical.update(id=f"H{j:03d}", code=f"H{j:03d}", name="Completed synthetic stop")
        base_scenario["orders"].append(historical)
    base_input_hash = scenario_identity(base_scenario)["inputHash"]
    base_plan = {"routes": [{"routeId": f"R{j:03d}", "vehicleId": vid,
                            "orderIds": [f"H{j:03d}"]+order_ids[j::site_count]}
                           for j, vid in enumerate(vehicle_ids)], "unassignedOrderIds": [], "blockedOrderIds": []}
    context = {"schemaVersion": "stct-rolling-plan-context-v1.6", "baseInputHash": base_input_hash,
        "currentPlanHash": plan_identity(base_input_hash, base_plan)["planHash"],
        "executionRunHash": stable_hash({"run": sequence}), "executionStateHash": stable_hash({"states": states, "sequence": sequence}),
        "cutoffLogicalMinute": 600, "vehicleStates": states, "completedStopIds": [f"H{j:03d}" for j in range(site_count)],
        "activeStopIds": order_ids[:site_count], "failedStopIds": [], "remainingOrderIds": order_ids,
        "cancelledOrderIds": [], "loadedOrderAssignments": [], "lockedRouteIds": [row["routeId"] for row in prefixes],
        "fixedRoutePrefixes": prefixes, "transferPolicy": "LOCK_LOADED_ORDERS_TO_VEHICLE", "matrixHash": matrix["matrixHash"],
        "providerProvenance": provenance}
    context["contextHash"] = stable_hash({"schemaVersion": context["schemaVersion"], **{key: context[key] for key in _CONTEXT_FIELDS}})
    scenario = {"schemaVersion": "stct-derived-remaining-scenario-v1.6", "scenarioId": f"SOAK-ROLL-{sequence}",
        "baseScenarioId": f"SOAK-{sequence}", "baseInputHash": context["baseInputHash"], "contextHash": context["contextHash"],
        "planningDate": "2026-10-06", "depot": {"id": "DEPOT-END", "lon": 117, "lat": 39},
        "orders": [{"id": oid, "volume": 1, "serviceMin": 1, "twStart": 600, "twEnd": 1080,
                    "activeService": i < site_count, "fixedVehicleId": "", "cancelled": False, "failedRetry": False}
                   for i, oid in enumerate(order_ids)],
        "vehicles": [{"id": vid, "vehicleId": vid, "maxVolume": cap, "available": True,
            "startPointId": f"{vid}-START", "endPointId": "DEPOT-END", "currentCoordinate": [117, 39],
            "startMinute": 600, "endMinute": 1080, "remainingShiftMinutes": 480, "currentLoad": 0,
            "activeStopId": order_ids[j], "remainingLoadedOrderIds": [], "failureReason": "", "atDepot": False}
            for j, vid in enumerate(vehicle_ids)],
        **{key: copy.deepcopy(context[key]) for key in ("completedStopIds", "activeStopIds", "failedStopIds", "cancelledOrderIds",
            "lockedRouteIds", "loadedOrderAssignments", "transferPolicy", "matrixHash", "providerProvenance", "cutoffLogicalMinute")},
        "historicalPrefixes": prefixes, "transferBoundary": {"policy": context["transferPolicy"], "label": "Loaded orders locked to vehicle",
            "boundary": "Loaded orders cannot change vehicle", "simulationOnly": False},
        "constraints": {"volumeOnly": True}, "assumptions": {"source": "SYNTHETIC_SOAK", "roadMatrixAuthoritative": True, "noHaversineSubstitution": True}}
    scenario["inputHash"] = stable_hash(scenario)
    scenario["contentHash"] = scenario["inputHash"]
    payload = {"schemaVersion": "stct-rolling-solve-request-v1.6", "rollingContext": context,
        "rollingContextHash": context["contextHash"], "derivedScenario": scenario, "derivedInputHash": scenario["inputHash"],
        "claimedInputHash": scenario["inputHash"], "authoritativeMatrix": matrix, "matrixHash": matrix["matrixHash"],
        "matrixPointIds": points, "objective": "MINIMIZE_ROAD_DISTANCE_AND_CHANGE", "timeLimitSeconds": 1,
        "fixedAssignments": fixed, "fixedPrefixes": prefixes, "changePenaltyWeights": {"changedVehicles": 30, "driverDisruption": 25},
        "incidentHash": stable_hash({"syntheticIncident": sequence})}
    payload["claimedRequestHash"] = stable_hash({"schemaVersion": payload["schemaVersion"], **{key: payload[key] for key in _REQUEST_FIELDS}})
    return payload


def _facility(demand_count, site_count, sequence):
    count = max(2, (site_count+1)//2)
    cap = math.ceil(demand_count/count)
    demands = [{"demandId": f"D{i:04d}", "demand": {"quantity": 1, "weight": 2, "volume": 1},
                "requiredCapabilities": ["STANDARD"], "eligibleSiteIds": []} for i in range(demand_count)]
    sites = [{"siteId": f"S{j:03d}", "status": "OPTIONAL", "capacity": {"quantity": cap, "weight": cap*2, "volume": cap},
              "fixedCost": 10+j, "handlingCostPerUnit": 1, "capabilities": ["STANDARD"]} for j in range(site_count)]
    payload = {"schemaVersion": "stct-facility-solve-request-v1.9-mvp1", "requestId": f"SOAK-FAC-{sequence}",
        "demands": demands, "sites": sites,
        "matrix": {"rows": [{"siteId": site["siteId"], "demandId": demand["demandId"],
            "distanceMeters": 1000 + 1000*abs(j-i%count)+sequence, "travelSeconds": 60+abs(j-i%count), "unreachable": False}
            for i, demand in enumerate(demands) for j, site in enumerate(sites)]},
        "options": {"facilityCounts": [count], "transportBasis": "quantity", "transportCostPerUnitKm": 1,
                    "currency": "CNY", "costPeriod": "MODEL_RUN", "volumeUnit": "m3", "timeLimitSeconds": 2, "randomSeed": 1909}}
    payload["studyHash"] = _json_hash({key: value for key, value in payload.items() if key != "requestId"})
    return payload


def _joint(demand_count, site_count, sequence):
    count = max(2, (site_count+1)//2)
    periods = ["2026-10", "2026-11"]
    demands = [{"id": f"D{i:04d}", "customerNodeId": f"C{i:04d}",
                "quantitiesByPeriod": {periods[0]: 1, periods[1]: 1+i%2}} for i in range(demand_count)]
    totals = {p: sum(d["quantitiesByPeriod"][p] for d in demands) for p in periods}
    caps = {p: max(sum(d["quantitiesByPeriod"][p] for i, d in enumerate(demands) if i%count == group)
                   for group in range(count)) for p in periods}
    sites = [{"id": f"S{j:03d}", "status": "OPTIONAL", "capacityByPeriod": caps.copy(),
              "fixedCostByPeriod": {p: 10+j for p in periods}, "handlingPerUnitByPeriod": {p: 1 for p in periods}}
             for j in range(site_count)]
    suppliers = [{"id": f"U{j:03d}", "minByPeriod": {p: math.floor(totals[p]*0.3) for p in periods},
                  "maxByPeriod": {p: math.ceil(totals[p]*0.7) for p in periods}} for j in range(2)]
    payload = {"schemaVersion": "stct-supply-chain-joint-request-v2", "requestId": f"SOAK-JOINT-{sequence}",
        "quantityScale": 10000, "scope": "FULL_CHAIN", "objective": "COST" if sequence%2 else "VOLUME_KM",
        "unit": "m3", "currency": "CNY", "sourceMode": "FREE", "supplierTotalMode": "ADJUSTABLE",
        "periods": periods, "suppliers": suppliers, "sites": sites, "demands": demands, "siteCounts": [count],
        "inboundEdges": [{"supplierId": source["id"], "siteId": site["id"], "distanceKm": 1+abs(i-j)+sequence/1000,
                          "unitCostByPeriod": {p: 1+abs(i-j)+sequence/1000 for p in periods}}
                         for i, source in enumerate(suppliers) for j, site in enumerate(sites)],
        "outboundEdges": [{"siteId": site["id"], "demandId": demand["id"], "distanceKm": 1+abs(j-i%count)+sequence/1000,
                           "unitCostByPeriod": {p: 1+abs(j-i%count)+sequence/1000 for p in periods}}
                          for i, demand in enumerate(demands) for j, site in enumerate(sites)],
        "sourceRules": [], "timeLimitSeconds": 2, "maxResultsPerCount": 1}
    payload["studyHash"] = _json_hash({key: value for key, value in payload.items() if key != "requestId"})
    return payload


def make_payloads(demand_count, site_count, sequence):
    """Return four fresh native requests; site_count is vehicle count for VRP."""
    _check(type(demand_count) is int and 1 <= demand_count <= 500, "demand_count must be 1..500")
    _check(type(site_count) is int and 2 <= site_count <= min(20, demand_count), "site_count must be 2..min(20, demands)")
    _check(type(sequence) is int and 0 <= sequence <= 1_000_000, "sequence must be 0..1000000")
    optimize = _optimize(demand_count, site_count, sequence)
    return dict(zip(ROUTES, [optimize, _rolling(demand_count, site_count, sequence, optimize),
                            _facility(demand_count, site_count, sequence), _joint(demand_count, site_count, sequence)]))


def make_job(payload, sequence):
    """Wrap a facility or joint request using the frontend's run identity shape."""
    value = copy.deepcopy(payload)
    kind = "FACILITY" if value.get("schemaVersion") == "stct-facility-solve-request-v1.9-mvp1" else "JOINT"
    _check(kind == "FACILITY" or value.get("schemaVersion") in {"stct-supply-chain-joint-request-v1", "stct-supply-chain-joint-request-v2"}, "unsupported job payload")
    scenario_hash = stable_hash({"schemaVersion": "synthetic-soak-scenario-v1", "sequence": sequence,
                                 "studyHash": value["studyHash"], "kind": kind})
    identity = {"schemaVersion": "stct-supply-chain-run-v6", "studyHash": value["studyHash"],
        "scenarioHash": scenario_hash, "modelVersion": "v6-cp-sat-1", "declaredBudgetSeconds": 3,
        "requests": [{"kind": kind, "phase": "CANDIDATES", "payload": {**value, "requestId": None}}]}
    run_hash = stable_hash(identity)
    value["requestId"] = f"{run_hash}:CANDIDATES"
    return {**{key: val for key, val in identity.items() if key != "requests"}, "budgetSeconds": 3,
            "preparationSeconds": 0, "runSpecHash": run_hash,
            "requests": [{"kind": kind, "phase": "CANDIDATES", "payload": value}]}


def _coverage(assignments, demands, sites, selected):
    seen = Counter(row["demandId"] for row in assignments)
    _check(set(seen) == set(demands) and all(n == 1 for n in seen.values()), "demands must be assigned exactly once")
    _check(all(row["siteId"] in sites and row["siteId"] in selected for row in assignments), "assignment to unknown/closed site")


def _cp_header(payload, result, schema):
    _check(result.get("schemaVersion") == schema, "result schema mismatch")
    _check(result.get("studyHash") == payload["studyHash"] and result.get("requestId") == payload["requestId"], "result request identity mismatch")
    engine = result.get("engine", {})
    _check(engine.get("id") == "OR_TOOLS_CP_SAT" and engine.get("workers") == 1 and bool(engine.get("version")), "native CP-SAT identity missing")
    rows = result.get("results")
    _check(isinstance(rows, list) and rows, "CP-SAT returned no result")
    _check(all(row.get("status") in {"OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN", "TIME_LIMIT"} for row in rows), "invalid CP-SAT result status")
    feasible = [row for row in rows if row["status"] in {"OPTIMAL", "FEASIBLE"}]
    _check(feasible, "no independently checkable feasible native result")
    return feasible


def _selected(row, sites, counts, required_status):
    selected = row.get("selectedSiteIds", [])
    _check(len(selected) == len(set(selected)) == row["facilityCount"] and row["facilityCount"] in counts,
           "selected site count mismatch")
    _check(set(selected) <= set(sites), "unknown selected site")
    _check(all(s["status"] != "FORBIDDEN" for sid, s in sites.items() if sid in selected), "forbidden site opened")
    _check(all(sid in selected for sid, s in sites.items() if s["status"] == required_status or s.get("required") is True), "required site closed")
    return set(selected)


def _bound(row, objective):
    bound = _number(row["bestBound"], "bestBound")
    _check(bound <= Decimal(str(objective))+Decimal("0.00001"), "minimization bound exceeds objective")
    gap = _number(row["relativeGap"], "relativeGap")
    _check(gap >= 0, "negative relative gap")
    if row["status"] == "OPTIMAL":
        _near(float(bound), objective, "optimal objective/bound", "0.00001")
        _near(float(gap), 0, "optimal gap")


def _validate_facility(payload, result):
    rows = _cp_header(payload, result, "stct-facility-solve-result-v1.9-mvp1")
    _check(result.get("publicRequests") == 0, "unexpected public request")
    _check(result.get("capacitySemantics") == "AGGREGATE_CAPACITY_MODELED", "finite capacity not acknowledged")
    _check(result.get("resultSetHash") == _json_hash({key: value for key, value in result.items() if key != "resultSetHash"}), "facility result hash mismatch")
    demands, sites = _ids(payload["demands"], "demandId"), _ids(payload["sites"], "siteId")
    grid = {(r["siteId"], r["demandId"]): r for r in payload["matrix"]["rows"]}
    options = payload["options"]
    capacity_checks = assignment_checks = 0
    for row in rows:
        selected = _selected(row, sites, options["facilityCounts"], "REQUIRED_OPEN")
        assignments = row["assignments"]
        _coverage(assignments, demands, sites, selected)
        loads = defaultdict(lambda: defaultdict(Decimal))
        components = {"fixed": sum((Decimal(str(sites[sid]["fixedCost"])) for sid in selected), Decimal(0)), "handling": Decimal(0), "transport": Decimal(0)}
        scaled_objective = sum(_scaled(sites[sid]["fixedCost"]) for sid in selected)
        for assignment in assignments:
            did, sid = assignment["demandId"], assignment["siteId"]
            demand, site, edge = demands[did], sites[sid], grid[sid, did]
            _check(not edge.get("unreachable"), "unreachable assignment")
            _check(not demand.get("eligibleSiteIds") or sid in demand["eligibleSiteIds"], "ineligible assignment")
            _check(set(demand.get("requiredCapabilities", [])) <= set(site.get("capabilities", [])), "capability mismatch")
            for dim in ("quantity", "weight", "volume"):
                loads[sid][dim] += Decimal(str(demand["demand"].get(dim, 0)))
            amount = Decimal(str(demand["demand"][options["transportBasis"]]))
            handling = amount*Decimal(str(site["handlingCostPerUnit"]))
            transport = amount*Decimal(str(edge["distanceMeters"]))/1000*Decimal(str(options["transportCostPerUnitKm"]))
            components["handling"] += handling
            components["transport"] += transport
            scaled_objective += _scaled(handling+transport)
            _near(assignment["distanceMeters"], edge["distanceMeters"], "assignment distance")
            _near(assignment["basisAmount"], amount, "assignment quantity")
        for sid, site in sites.items():
            for dim, cap in site["capacity"].items():
                if cap is not None:
                    _check(loads[sid][dim] <= Decimal(str(cap)), f"facility {sid} exceeds {dim} capacity")
                    capacity_checks += 1
        for key, value in components.items():
            _near(row["cost"][key], value, f"facility {key} cost")
        _near(row["cost"]["total"], sum(components.values()), "facility total cost")
        expected_objective = Decimal(scaled_objective)/1000
        _near(row["objectiveValue"], expected_objective, "facility objective")
        _bound(row, expected_objective)
        _check(row["portfolioHash"] == _json_hash({key: value for key, value in row.items() if key not in {"portfolioHash", "rank"}}), "portfolio hash mismatch")
        assignment_checks += len(assignments)
    return {"status": "PASS", "feasibleResults": len(rows), "assignmentChecks": assignment_checks,
            "capacityChecks": capacity_checks, "objectiveChecks": len(rows), "hashChecks": 1+len(rows)}


def _validate_joint(payload, result):
    rows = _cp_header(payload, result, "stct-supply-chain-joint-result-v1")
    _check(result.get("scope") == payload["scope"] and result.get("objective") == payload["objective"], "joint result mode mismatch")
    demands, sites, sources = _ids(payload["demands"], "id"), _ids(payload["sites"], "id"), _ids(payload["suppliers"], "id")
    inbound = {(r["supplierId"], r["siteId"]): r for r in payload["inboundEdges"]}
    outbound = {(r["siteId"], r["demandId"]): r for r in payload["outboundEdges"]}
    periods, scale = payload["periods"], payload.get("quantityScale", 10000)
    checks = Counter()
    for row in rows:
        selected = _selected(row, sites, payload["siteCounts"], "REQUIRED")
        _coverage(row["assignments"], demands, sites, selected)
        loads, arrivals, source_totals = defaultdict(Decimal), defaultdict(Decimal), defaultdict(Decimal)
        objective = Decimal(0)
        scaled_objective = 0
        for assignment in row["assignments"]:
            did, sid = assignment["demandId"], assignment["siteId"]
            demand = demands[did]
            _check((sid, did) in outbound and demand.get("lockedSiteId", sid) == sid, "joint illegal assignment")
            edge = outbound[sid, did]
            for period in periods:
                amount = Decimal(str(demand["quantitiesByPeriod"].get(period, 0)))
                coefficient = Decimal(str(edge["unitCostByPeriod"][period] if payload["objective"] == "COST" else edge["distanceKm"]))
                loads[sid, period] += amount
                objective += amount*coefficient
                scaled_objective += int(amount*scale)*round(float(coefficient)*1000)
            checks["assignmentChecks"] += 1
        seen = set()
        for flow in row["sourceFlows"]:
            source, sid, period = flow["supplierId"], flow["siteId"], flow["period"]
            key = source, sid, period
            _check(key not in seen and source in sources and sid in selected and period in periods and (source, sid) in inbound, "duplicate or illegal source flow")
            seen.add(key)
            amount = _number(flow["quantity"], "source flow")
            _check(amount > 0 and amount*scale == (amount*scale).to_integral_value(), "invalid flow quantity/precision")
            arrivals[sid, period] += amount
            source_totals[source, period] += amount
            edge = inbound[source, sid]
            coefficient = Decimal(str(edge["unitCostByPeriod"][period] if payload["objective"] == "COST" else edge["distanceKm"]))
            objective += amount*coefficient
            scaled_objective += int(amount*scale)*round(float(coefficient)*1000)
            checks["flowChecks"] += 1
        for sid, site in sites.items():
            for period in periods:
                _check(arrivals[sid, period] == loads[sid, period], f"joint inbound != outbound: {sid}/{period}")
                cap = site.get("capacityByPeriod", {}).get(period)
                if cap is not None:
                    _check(loads[sid, period] <= Decimal(str(cap)), f"joint site capacity exceeded: {sid}/{period}")
                    checks["capacityChecks"] += 1
                checks["flowConservationChecks"] += 1
                if sid in selected and payload["objective"] == "COST":
                    fixed = Decimal(str(site["fixedCostByPeriod"][period]))
                    handling = Decimal(str(site["handlingPerUnitByPeriod"][period]))
                    objective += fixed+handling*loads[sid, period]
                    scaled_objective += round(float(fixed)*scale*1000)+round(float(handling)*1000)*int(loads[sid, period]*scale)
        for source, config in sources.items():
            for period in periods:
                amount = source_totals[source, period]
                for field, relation in (("minByPeriod", lambda a, b: a >= b), ("maxByPeriod", lambda a, b: a <= b), ("fixedTotalByPeriod", lambda a, b: a == b)):
                    bound = config.get(field, {}).get(period)
                    if bound is not None:
                        _check(relation(amount, Decimal(str(bound))), f"supplier {field} violated: {source}/{period}")
                        checks["supplierBoundChecks"] += 1
        for period in periods:
            demand_total = sum(Decimal(str(d["quantitiesByPeriod"].get(period, 0))) for d in demands.values())
            _check(sum(source_totals[source, period] for source in sources) == demand_total, "period demand not conserved")
            checks["flowConservationChecks"] += 1
        _near(row["objectiveValue"], objective, "joint objective", "0.00001")
        scaled_value = Decimal(scaled_objective)/(scale*1000)
        _near(row["objectiveScaledValue"], scaled_value, "joint scaled objective", "0.00001")
        _bound(row, scaled_value)
        checks["objectiveChecks"] += 1
    return {"status": "PASS", "feasibleResults": len(rows), **dict(checks)}


def _route_coverage(plan, orders, vehicles):
    route_ids, used_vehicles, seen = set(), set(), Counter()
    routes = plan["routes"]
    for route in routes:
        rid, vid = route["routeId"], route["vehicleId"]
        _check(rid not in route_ids and vid not in used_vehicles and vid in vehicles, "duplicate route/vehicle or unknown vehicle")
        route_ids.add(rid)
        used_vehicles.add(vid)
        _check(route.get("orderIds"), "empty returned route")
        seen.update(route["orderIds"])
    _check(set(seen) == set(orders) and all(count == 1 for count in seen.values()), "routing must serve every synthetic order exactly once")
    _check(not plan.get("unassignedOrderIds") and not plan.get("blockedOrderIds"), "unexpected unserved synthetic order")
    return routes


def _meters(a, b, road_factor):
    lon1, lat1, lon2, lat2 = map(float, (a["lon"], a["lat"], b["lon"], b["lat"]))
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((phi2-phi1)/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(math.radians(lon2-lon1)/2)**2
    distance = 6371*2*math.atan2(math.sqrt(h), math.sqrt(max(0, 1-h)))
    return _scaled(distance*road_factor, 1000)


def _validate_optimize(payload, result):
    _check(result.get("ok") is True and result.get("engine") == "OR-Tools" and result.get("actualEngineVersion"), "native routing identity missing")
    plan = result["plan"]
    for claimed, server, plan_key in (("claimedInputHash", "serverInputHash", "inputHash"), ("claimedContentHash", "serverContentHash", "contentHash"), ("claimedRequestHash", "serverRequestHash", "requestHash")):
        _check(payload[claimed] == result[server] == plan[plan_key], f"optimize {plan_key} mismatch")
    _check(result.get("serverHashVerified") is True and result.get("requestId") == payload["requestId"], "optimize request not verified")
    scenario = payload["canonicalScenario"]
    orders, vehicles = _ids(scenario["orders"], "id"), _ids(scenario["vehicles"], "id")
    routes = _route_coverage(plan, orders, vehicles)
    authority = {"routes": routes, "unassignedOrderIds": [], "blockedOrderIds": [], "manualRevision": 0}
    _check(result["planHash"] == plan["planHash"] == plan_identity(payload["claimedInputHash"], authority)["planHash"], "optimize plan hash mismatch")
    stop_rows = [feature["properties"] for feature in plan["stopGeoJson"]["features"]]
    stops = _ids(stop_rows, "orderId")
    _check(set(stops) == set(orders), "stop geometry coverage mismatch")
    factor, speed = float(scenario["assumptions"]["roadDistanceFactor"]), float(scenario["assumptions"]["averageSpeedKmh"])
    for route in routes:
        vehicle = vehicles[route["vehicleId"]]
        for dim, cap in (("volume", "maxVolume"), ("weight", "maxWeight")):
            amount = sum(Decimal(orders[oid][dim]) for oid in route["orderIds"])
            _check(amount <= Decimal(vehicle[cap]), f"route {dim} capacity exceeded")
            _near(route[dim], amount, f"route reported {dim}")
        previous, elapsed, distance, driving = scenario["depot"], 540, 0, 0
        for seq, oid in enumerate(route["orderIds"], 1):
            order, stop = orders[oid], stops[oid]
            leg = _meters(previous, order, factor)
            minutes = math.ceil(leg/1000/speed*60)
            distance += leg
            driving += minutes
            elapsed += minutes
            _check(stop["routeId"] == route["routeId"] and stop["vehicleId"] == route["vehicleId"] and stop["seq"] == seq, "stop route mapping mismatch")
            _near(stop["travelMeters"], leg, "stop leg meters")
            _check(stop["arrive"] == f"{elapsed//60:02d}:{elapsed%60:02d}", "stop arrival mismatch")
            _check(540 <= elapsed <= 1080, "stop time window violated")
            elapsed += int(Decimal(order["serviceMin"]))
            previous = order
        leg = _meters(previous, scenario["depot"], factor)
        distance += leg
        driving += math.ceil(leg/1000/speed*60)
        elapsed += math.ceil(leg/1000/speed*60)
        _check(elapsed <= 1080, "route shift exceeded")
        _near(route["roadMeters"], distance, "route distance")
        _near(route["drivingMinutes"], driving, "route driving time")
        _near(route["returnMinutes"], elapsed, "route return time")
    _near(plan["metrics"]["assigned"], len(orders), "assigned metric")
    return {"status": "PASS", "routesChecked": len(routes), "assignmentChecks": len(orders),
            "capacityChecks": 2*len(routes), "scheduleChecks": len(orders), "hashChecks": 4}


def _validate_rolling(payload, result):
    _check(result.get("ok") is True and result.get("engine") == "OR-Tools" and result.get("actualOrtoolsVersion"), "native rolling identity missing")
    _check(result.get("requestHash") == payload["claimedRequestHash"] and result.get("matrixHash") == payload["matrixHash"], "rolling response identity mismatch")
    _check(result.get("matrixProvenance", {}).get("authoritative") is True and result["matrixProvenance"].get("fallbackUsed") is False, "rolling matrix not authoritative")
    plan, scenario, context, matrix = result["candidate"], payload["derivedScenario"], payload["rollingContext"], payload["authoritativeMatrix"]
    _check(plan.get("engine") == "OR-Tools" and plan.get("reference") is False and plan.get("candidateType") == "FULL_REOPTIMIZATION_OR_TOOLS", "rolling candidate identity missing")
    for key, expected in (("inputHash", payload["derivedInputHash"]), ("matrixHash", payload["matrixHash"]), ("contextHash", payload["rollingContextHash"]), ("incidentHash", payload["incidentHash"])):
        _check(plan.get(key) == expected, f"rolling {key} mismatch")
    _check(plan.get("historicalPrefixes") == context["fixedRoutePrefixes"], "historical prefixes changed")
    orders, vehicles = _ids(scenario["orders"], "id"), _ids(scenario["vehicles"], "id")
    routes = _route_coverage(plan, orders, vehicles)
    point_index = {pid: i for i, pid in enumerate(matrix["sourceIds"])}
    assignments = {}
    for route in routes:
        vehicle = vehicles[route["vehicleId"]]
        _check(route["startPointId"] == vehicle["startPointId"] and route["endPointId"] == vehicle["endPointId"], "rolling endpoint mismatch")
        _check(route["orderIds"][0] == vehicle["activeStopId"], "active stop is not fixed first")
        amount = sum(Decimal(str(orders[oid]["volume"])) for oid in route["orderIds"])
        _check(amount <= Decimal(str(vehicle["maxVolume"]-vehicle["currentLoad"])), "rolling volume capacity exceeded")
        previous, minute, distance = vehicle["startPointId"], vehicle["startMinute"], 0
        for oid in route["orderIds"]:
            a, b = point_index[previous], point_index[oid]
            distance += matrix["distances"][a][b]
            earliest = minute + math.ceil(matrix["durations"][a][b]/60)
            eta = route["etaByOrder"][oid]
            _check(type(eta) is int and eta >= earliest and orders[oid]["twStart"] <= eta <= orders[oid]["twEnd"], "rolling ETA violates travel/time window")
            minute, previous = eta+orders[oid]["serviceMin"], oid
            assignments[oid] = route["vehicleId"]
        a, b = point_index[previous], point_index[vehicle["endPointId"]]
        distance += matrix["distances"][a][b]
        _check(minute+math.ceil(matrix["durations"][a][b]/60) <= vehicle["endMinute"], "rolling shift exceeded")
        _near(route["totalDistance"], Decimal(distance)/1000, "rolling distance")
    for fixed in payload["fixedAssignments"]:
        _check(assignments[fixed["orderId"]] == fixed["vehicleId"], "rolling fixed assignment changed")
    identity = {key: plan[key] for key in ("schemaVersion", "candidateType", "inputHash", "matrixHash", "incidentHash", "contextHash", "historicalPrefixes", "unassignedOrderIds")}
    identity["routes"] = [{key: route[key] for key in ("routeId", "vehicleId", "orderIds")} for route in routes]
    _check(plan["planHash"] == stable_hash(identity), "rolling plan hash mismatch")
    return {"status": "PASS", "routesChecked": len(routes), "assignmentChecks": len(orders), "capacityChecks": len(routes),
            "fixedAssignmentChecks": len(payload["fixedAssignments"]), "scheduleChecks": len(orders), "hashChecks": 7}


def validate_result(route, payload, result):
    """Raise AssertionError for bad native output; return compact checked counts.

    FEASIBLE results are acceptable without claiming optimality. Additional
    exhausted/infeasible portfolios are tolerated, but an empty/UNKNOWN-only
    response is never counted as mathematical success. Checks target the
    generated schemas and intentionally require full service of these known
    feasible synthetic routing inputs.
    """
    _check(isinstance(result, dict) and not result.get("error"), "solver error or non-object result")
    _finite_tree(result)
    validators = dict(zip(ROUTES, [_validate_optimize, _validate_rolling, _validate_facility, _validate_joint]))
    _check(route in validators, "unsupported validation route")
    return validators[route](payload, result)


def _checker_witnesses(payloads):
    """Analytic CHECKER TEST ONLY witnesses; never used by the native harness.

    These hand-built response-shaped values exercise the checkers themselves.
    They are not solver mocks, native observations, or solver-success evidence.
    Only the deliberately tiny 10-demand, 2-site self-test case is supported.
    """
    label = "CHECKER_TEST_ONLY_NO_SOLVER_EXECUTED"
    engine = {"id": "OR_TOOLS_CP_SAT", "version": label, "workers": 1}
    responses = {}
    payload = payloads[ROUTES[2]]
    selected = [site["siteId"] for site in payload["sites"]]
    grid = {(r["siteId"], r["demandId"]): r for r in payload["matrix"]["rows"]}
    assignments = [{"demandId": d["demandId"], "siteId": selected[i%2],
                    "distanceMeters": grid[selected[i%2], d["demandId"]]["distanceMeters"], "basisAmount": 1}
                   for i, d in enumerate(payload["demands"])]
    fixed = sum(Decimal(str(site["fixedCost"])) for site in payload["sites"])
    handling = Decimal(len(assignments))
    transport = sum(Decimal(r["distanceMeters"])/1000 for r in assignments)
    objective = fixed+handling+transport
    row = {"facilityCount": 2, "status": "FEASIBLE", "selectedSiteIds": selected,
           "assignments": assignments, "cost": {"fixed": float(fixed), "handling": float(handling),
           "transport": float(transport), "total": float(objective)}, "objectiveValue": float(objective),
           "bestBound": 0, "relativeGap": 1, "rank": 1, "planRank": 1}
    facility = {"schemaVersion": "stct-facility-solve-result-v1.9-mvp1", "requestId": payload["requestId"],
                "studyHash": payload["studyHash"], "engine": engine, "results": [row], "publicRequests": 0,
                "capacitySemantics": "AGGREGATE_CAPACITY_MODELED", "evidenceClass": label}
    _resign_checker_facility(facility)
    responses[ROUTES[2]] = facility

    payload = payloads[ROUTES[3]]
    periods = payload["periods"]
    assignments = [{"demandId": d["id"], "siteId": selected[i%2]} for i, d in enumerate(payload["demands"])]
    loads = {(sid, p): sum(d["quantitiesByPeriod"][p] for i, d in enumerate(payload["demands"]) if selected[i%2] == sid)
             for sid in selected for p in periods}
    flows = [{"supplierId": payload["suppliers"][j]["id"], "siteId": sid, "period": p, "quantity": loads[sid, p]}
             for j, sid in enumerate(selected) for p in periods]
    inbound = {(edge["supplierId"], edge["siteId"]): edge for edge in payload["inboundEdges"]}
    outbound = {(edge["siteId"], edge["demandId"]): edge for edge in payload["outboundEdges"]}
    demands = {d["id"]: d for d in payload["demands"]}
    def coefficient(edge, period):
        return Decimal(str(edge["unitCostByPeriod"][period] if payload["objective"] == "COST" else edge["distanceKm"]))
    objective = sum(Decimal(flow["quantity"])*coefficient(inbound[flow["supplierId"], flow["siteId"]], flow["period"]) for flow in flows)
    objective += sum(Decimal(demands[a["demandId"]]["quantitiesByPeriod"][p])*coefficient(outbound[a["siteId"], a["demandId"]], p)
                     for a in assignments for p in periods)
    if payload["objective"] == "COST":
        objective += sum(Decimal(site["fixedCostByPeriod"][p])+Decimal(site["handlingPerUnitByPeriod"][p])*loads[site["id"], p]
                         for site in payload["sites"] for p in periods)
    responses[ROUTES[3]] = {"schemaVersion": "stct-supply-chain-joint-result-v1", "requestId": payload["requestId"],
        "studyHash": payload["studyHash"], "scope": payload["scope"], "objective": payload["objective"], "engine": engine,
        "evidenceClass": label, "results": [{"facilityCount": 2, "rank": 1, "status": "FEASIBLE",
        "selectedSiteIds": selected, "assignments": assignments, "sourceFlows": flows,
        "objectiveValue": float(objective), "objectiveScaledValue": float(objective), "bestBound": 0, "relativeGap": 1}]}

    payload = payloads[ROUTES[0]]
    scenario = payload["canonicalScenario"]
    factor, speed = float(scenario["assumptions"]["roadDistanceFactor"]), float(scenario["assumptions"]["averageSpeedKmh"])
    routes, features = [], []
    for j, vehicle in enumerate(scenario["vehicles"]):
        group = scenario["orders"][j::2]
        rid, previous, minute, distance, driving = f"R{j:03d}", scenario["depot"], 540, 0, 0
        for seq, order in enumerate(group, 1):
            leg = _meters(previous, order, factor)
            travel = math.ceil(leg/1000/speed*60)
            minute += travel
            distance += leg
            driving += travel
            features.append({"properties": {"orderId": order["id"], "vehicleId": vehicle["id"], "routeId": rid,
                             "seq": seq, "travelMeters": leg, "arrive": f"{minute//60:02d}:{minute%60:02d}"}})
            minute += int(Decimal(order["serviceMin"]))
            previous = order
        leg = _meters(previous, scenario["depot"], factor)
        distance += leg
        driving += math.ceil(leg/1000/speed*60)
        minute += math.ceil(leg/1000/speed*60)
        routes.append({"routeId": rid, "vehicleId": vehicle["id"], "orderIds": [o["id"] for o in group],
                       "volume": len(group), "weight": 2*len(group), "roadMeters": distance,
                       "drivingMinutes": driving, "returnMinutes": minute})
    plan = {"routes": routes, "unassignedOrderIds": [], "blockedOrderIds": [], "stopGeoJson": {"features": features},
            "inputHash": payload["claimedInputHash"], "contentHash": payload["claimedContentHash"],
            "requestHash": payload["claimedRequestHash"], "metrics": {"assigned": 10}}
    plan["planHash"] = plan_identity(payload["claimedInputHash"], plan)["planHash"]
    responses[ROUTES[0]] = {"ok": True, "engine": "OR-Tools", "actualEngineVersion": label, "evidenceClass": label,
        "requestId": payload["requestId"], "serverHashVerified": True, "serverInputHash": payload["claimedInputHash"],
        "serverContentHash": payload["claimedContentHash"], "serverRequestHash": payload["claimedRequestHash"],
        "planHash": plan["planHash"], "plan": plan}

    payload = payloads[ROUTES[1]]
    scenario, matrix = payload["derivedScenario"], payload["authoritativeMatrix"]
    point_index = {pid: i for i, pid in enumerate(matrix["sourceIds"])}
    routes = []
    for j, vehicle in enumerate(scenario["vehicles"]):
        group = scenario["orders"][j::2]
        previous, minute, distance, eta = vehicle["startPointId"], vehicle["startMinute"], 0, {}
        for order in group:
            a, b = point_index[previous], point_index[order["id"]]
            distance += matrix["distances"][a][b]
            minute += math.ceil(matrix["durations"][a][b]/60)
            eta[order["id"]] = minute
            minute += order["serviceMin"]
            previous = order["id"]
        distance += matrix["distances"][point_index[previous]][point_index[vehicle["endPointId"]]]
        routes.append({"routeId": f"R{j:03d}", "vehicleId": vehicle["id"], "orderIds": [o["id"] for o in group],
            "startPointId": vehicle["startPointId"], "endPointId": vehicle["endPointId"],
            "totalDistance": distance/1000, "etaByOrder": eta})
    plan = {"schemaVersion": "stct-recovery-candidate-v1.6", "candidateType": "FULL_REOPTIMIZATION_OR_TOOLS",
        "engine": "OR-Tools", "reference": False, "inputHash": payload["derivedInputHash"], "matrixHash": payload["matrixHash"],
        "contextHash": payload["rollingContextHash"], "incidentHash": payload["incidentHash"], "routes": routes,
        "historicalPrefixes": payload["rollingContext"]["fixedRoutePrefixes"], "unassignedOrderIds": []}
    identity = {key: plan[key] for key in ("schemaVersion", "candidateType", "inputHash", "matrixHash", "incidentHash",
                                         "contextHash", "historicalPrefixes", "unassignedOrderIds")}
    identity["routes"] = [{key: route[key] for key in ("routeId", "vehicleId", "orderIds")} for route in routes]
    plan["planHash"] = stable_hash(identity)
    responses[ROUTES[1]] = {"ok": True, "engine": "OR-Tools", "actualOrtoolsVersion": label, "evidenceClass": label,
        "requestHash": payload["claimedRequestHash"], "matrixHash": payload["matrixHash"],
        "matrixProvenance": {"authoritative": True, "fallbackUsed": False}, "candidate": plan}
    return responses


def _resign_checker_facility(result):
    for row in result["results"]:
        row["portfolioHash"] = _json_hash({key: value for key, value in row.items() if key not in {"portfolioHash", "rank"}})
    result["resultSetHash"] = _json_hash({key: value for key, value in result.items() if key != "resultSetHash"})


def _checker_adversarial_self_test():
    payloads = make_payloads(10, 2, 1)
    witnesses = _checker_witnesses(payloads)
    for route in ROUTES:
        validate_result(route, payloads[route], witnesses[route])
    rejected = []
    def reject(name, route, damaged, reason):
        try:
            validate_result(route, payloads[route], damaged)
        except AssertionError as exc:
            _check(reason in str(exc), f"{name} failed for unintended reason: {exc}")
            rejected.append(name)
            return
        raise AssertionError(f"checker accepted {name}")
    route = ROUTES[2]
    duplicate = copy.deepcopy(witnesses[route])
    duplicate["results"][0]["assignments"][1]["demandId"] = duplicate["results"][0]["assignments"][0]["demandId"]
    _resign_checker_facility(duplicate)
    reject("facility_duplicate_assignment", route, duplicate, "exactly once")
    over = copy.deepcopy(witnesses[route])
    grid = {(r["siteId"], r["demandId"]): r for r in payloads[route]["matrix"]["rows"]}
    for i, assignment in enumerate(over["results"][0]["assignments"]):
        assignment["siteId"] = "S000" if i < 6 else "S001"
        assignment["distanceMeters"] = grid[assignment["siteId"], assignment["demandId"]]["distanceMeters"]
    _resign_checker_facility(over)
    reject("facility_capacity_exceeded", route, over, "exceeds quantity capacity")
    stale = copy.deepcopy(witnesses[route])
    stale["results"][0]["cost"]["total"] += 1
    reject("stale_facility_result_hash", route, stale, "result hash mismatch")
    damaged = copy.deepcopy(witnesses[ROUTES[3]])
    damaged["results"][0]["sourceFlows"][0]["quantity"] += 1
    reject("joint_flow_not_conserved", ROUTES[3], damaged, "inbound != outbound")
    damaged = copy.deepcopy(witnesses[ROUTES[3]])
    for flow in damaged["results"][0]["sourceFlows"]:
        flow["supplierId"] = "U000"
    reject("joint_supplier_bound_exceeded", ROUTES[3], damaged, "supplier maxByPeriod violated")
    damaged = copy.deepcopy(witnesses[ROUTES[3]])
    assignment_by_id = {}
    for i, assignment in enumerate(damaged["results"][0]["assignments"]):
        assignment["siteId"] = "S000" if i < 6 else "S001"
        assignment_by_id[assignment["demandId"]] = assignment["siteId"]
    for flow in damaged["results"][0]["sourceFlows"]:
        flow["quantity"] = sum(d["quantitiesByPeriod"][flow["period"]] for d in payloads[ROUTES[3]]["demands"]
                               if assignment_by_id[d["id"]] == flow["siteId"])
    reject("joint_site_capacity_exceeded", ROUTES[3], damaged, "joint site capacity exceeded")
    for route in ROUTES:
        damaged = copy.deepcopy(witnesses[route])
        if route == ROUTES[0]:
            damaged["serverInputHash"] = "sha256:"+"0"*64
            reason = "inputHash mismatch"
        elif route == ROUTES[1]:
            damaged["requestHash"] = "sha256:"+"0"*64
            reason = "response identity mismatch"
        else:
            damaged["requestId"] = "WRONG-REQUEST"
            reason = "request identity mismatch"
        reject(f"{route[1:]}_wrong_identity", route, damaged, reason)
    for route in ROUTES[:2]:
        damaged = copy.deepcopy(witnesses[route])
        plan = damaged["plan" if route == ROUTES[0] else "candidate"]
        plan["routes"] = [plan["routes"][0]]
        plan["routes"][0]["orderIds"] = [f"D{i:04d}" for i in range(10)]
        if route == ROUTES[0]:
            plan["planHash"] = damaged["planHash"] = plan_identity(payloads[route]["claimedInputHash"], plan)["planHash"]
        reject(f"{route[1:]}_capacity_exceeded", route, damaged, "volume capacity exceeded")
    return {"evidenceClass": "CHECKER_TEST_ONLY_NO_SOLVER_EXECUTED", "analyticWitnessesChecked": len(witnesses),
            "adversarialCasesRejected": rejected, "nativeSolverExecuted": False}


def self_test():
    """Verify all nine input shapes and real hashes; never executes a solver."""
    cases, request_checks, envelope_checks = [], 0, 0
    for demand_count in (10, 50, 200):
        for site_count in (2, 5, 10):
            sequence = demand_count*100+site_count
            payloads = make_payloads(demand_count, site_count, sequence)
            optimize = payloads[ROUTES[0]]
            identity = scenario_identity(optimize["canonicalScenario"])
            _check(identity["contentHash"] == optimize["claimedContentHash"] and identity["inputHash"] == optimize["claimedInputHash"], "canonical input hash mismatch")
            options = {key: optimize[key] for key in ("objective", "timeLimitSeconds", "engineRequested", "searchConfiguration")}
            _check(request_identity(identity["inputHash"], options)["requestHash"] == optimize["claimedRequestHash"], "canonical request hash mismatch")
            validate_rolling_request(payloads[ROUTES[1]])
            validate_facility_request(payloads[ROUTES[2]])
            validate_joint_request(payloads[ROUTES[3]])
            # Constructive feasibility checks, not simulated solver responses:
            # cyclic assignment fits every finite site/vehicle capacity, and
            # the fully connected supplier graph can satisfy period totals.
            facility, joint = payloads[ROUTES[2]], payloads[ROUTES[3]]
            open_count = facility["options"]["facilityCounts"][0]
            for j in range(open_count):
                group = facility["demands"][j::open_count]
                for dimension, cap in facility["sites"][j]["capacity"].items():
                    _check(sum(d["demand"][dimension] for d in group) <= cap, "generated facility lacks capacity witness")
                for period in joint["periods"]:
                    load = sum(d["quantitiesByPeriod"][period] for d in joint["demands"][j::open_count])
                    _check(load <= joint["sites"][j]["capacityByPeriod"][period], "generated joint lacks capacity witness")
            for period in joint["periods"]:
                total = sum(d["quantitiesByPeriod"][period] for d in joint["demands"])
                lower = sum(s["minByPeriod"][period] for s in joint["suppliers"])
                upper = sum(s["maxByPeriod"][period] for s in joint["suppliers"])
                _check(lower <= total <= upper, "generated supplier bounds cannot meet demand")
            for j, vehicle in enumerate(optimize["canonicalScenario"]["vehicles"]):
                group = optimize["canonicalScenario"]["orders"][j::site_count]
                for dimension, cap_key in (("volume", "maxVolume"), ("weight", "maxWeight")):
                    _check(sum(Decimal(d[dimension]) for d in group) <= Decimal(vehicle[cap_key]), "generated vehicle lacks capacity witness")
            for route in ROUTES[2:]:
                payload = payloads[route]
                _check(payload["studyHash"] == _json_hash({k: v for k, v in payload.items() if k not in {"requestId", "studyHash"}}), "study hash mismatch")
                job = make_job(payload, sequence)
                validate_payloads(validate_spec(job))
                job_identity = {key: job[key] for key in ("schemaVersion", "studyHash", "scenarioHash", "modelVersion", "declaredBudgetSeconds")}
                job_identity["requests"] = [{**row, "payload": {**row["payload"], "requestId": None}} for row in job["requests"]]
                _check(stable_hash(job_identity) == job["runSpecHash"], "job run hash mismatch")
                _check(make_job(payload, sequence+1)["scenarioHash"] != job["scenarioHash"], "job sequence did not change scenario identity")
                envelope_checks += 1
            wire = json.loads(json.dumps(payloads, allow_nan=False))
            _check(wire == payloads, "payload JSON roundtrip changed data")
            request_checks += len(payloads)
            cases.append({"demands": demand_count, "sites": site_count, "routes": len(payloads)})
    # Mutation sanity checks exercise the authoritative pure-contract rejection.
    sample = make_payloads(10, 2, 1)
    rolling = copy.deepcopy(sample[ROUTES[1]])
    rolling["authoritativeMatrix"]["distances"][0][1] += 1
    rejected = False
    try:
        validate_rolling_request(rolling)
    except ValueError:
        rejected = True
    _check(rejected, "stale matrix mutation accepted")
    second = make_payloads(10, 2, 2)
    _check(sample[ROUTES[0]]["claimedInputHash"] != second[ROUTES[0]]["claimedInputHash"], "optimize sequence has no business identity effect")
    _check(sample[ROUTES[2]]["studyHash"] != second[ROUTES[2]]["studyHash"], "facility sequence has no business identity effect")
    _check(sample[ROUTES[3]]["studyHash"] != second[ROUTES[3]]["studyHash"], "joint sequence has no business identity effect")
    return {"status": "PASS", "evidenceClass": "PURE_INPUT_CONTRACT_CHECKS_NOT_NATIVE_SOLVER_EXECUTION",
            "cases": cases, "requestChecks": request_checks, "jobEnvelopeChecks": envelope_checks,
            "capacityWitnessCases": len(cases), "staleMatrixRejected": True,
            "checkerTests": _checker_adversarial_self_test(), "nativeSolverExecuted": False}


if __name__ == "__main__":
    print(json.dumps(self_test(), indent=2))
