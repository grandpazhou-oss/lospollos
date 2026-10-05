"""Deterministic local CP-SAT facility-location solver for STCT v1.9 MVP-1."""

from __future__ import annotations

import hashlib
import json
import math
import time
from decimal import Decimal, ROUND_HALF_UP
from typing import Any


INT64_MAX = 9_223_372_036_854_775_807
INT64_SAFE_LIMIT = INT64_MAX // 4


class FacilityError(Exception):
    def __init__(self, code: str, detail: dict[str, Any] | None = None):
        super().__init__(code)
        self.code = code
        self.detail = detail or {}


def _scaled(value: Any, scale: int = 1000) -> int:
    scaled = int((Decimal(str(value)) * scale).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if abs(scaled) > INT64_SAFE_LIMIT:
        raise FacilityError("FACILITY_INT64_OVERFLOW", {"value": str(value), "scale": scale})
    return scaled


def _hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def _validate(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[tuple[str, str], dict[str, Any]]]:
    if not isinstance(payload, dict):
        raise FacilityError("FACILITY_REQUEST_OBJECT_REQUIRED")
    if payload.get("schemaVersion") != "stct-facility-solve-request-v1.9-mvp1":
        raise FacilityError("FACILITY_REQUEST_SCHEMA_INVALID")
    demands = payload.get("demands") or []
    sites = payload.get("sites") or []
    if not isinstance(payload.get("matrix") or {}, dict) or not isinstance(payload.get("options") or {}, dict):
        raise FacilityError("FACILITY_REQUEST_OBJECT_REQUIRED")
    rows = (payload.get("matrix") or {}).get("rows") or []
    for field, values in (("demands", demands), ("sites", sites), ("matrix.rows", rows)):
        if not isinstance(values, list) or any(not isinstance(value, dict) for value in values):
            raise FacilityError("FACILITY_ARRAY_OBJECTS_REQUIRED", {"field": field})
    for field, values in (("demandId", demands), ("siteId", sites)):
        ids = [value.get(field) for value in values]
        if any(not isinstance(value, str) or not value.strip() for value in ids) or len(set(ids)) != len(ids):
            raise FacilityError("FACILITY_ENTITY_ID_INVALID", {"field": field})
    if not demands or not sites:
        raise FacilityError("FACILITY_DEMAND_AND_SITES_REQUIRED")
    if len(demands) > 500 or len(sites) > 100:
        raise FacilityError("FACILITY_MODEL_LIMIT_EXCEEDED", {"demands": len(demands), "sites": len(sites)})
    def number(value):
        return type(value) in (int, float) and math.isfinite(value) and value >= 0
    options = payload.get("options") or {}
    counts = options.get("facilityCounts")
    if counts is not None and (not isinstance(counts, list) or not counts or any(type(value) is not int or value < 1 or value > len(sites) for value in counts) or len(set(counts)) != len(counts)):
        raise FacilityError("FACILITY_COUNT_INVALID")
    if "timeLimitSeconds" in options and (not number(options["timeLimitSeconds"]) or not 1 <= options["timeLimitSeconds"] <= 120):
        raise FacilityError("FACILITY_TIME_LIMIT_INVALID")
    for demand in demands:
        for field in ("eligibleSiteIds", "requiredCapabilities"):
            values = demand.get(field)
            if values is not None and (not isinstance(values, list) or any(not isinstance(value, str) for value in values)):
                raise FacilityError("FACILITY_ARRAY_STRINGS_REQUIRED", {"field": field})
        if any(site_id not in {site["siteId"] for site in sites} for site_id in demand.get("eligibleSiteIds", [])):
            raise FacilityError("FACILITY_ELIGIBLE_SITE_UNKNOWN")
    for key in ("transportCostPerUnitKm", "maxDistanceKm", "maxServiceDistance", "maxServiceTime"):
        if key in options and options[key] is not None and not number(options[key]):
            raise FacilityError("FACILITY_NUMERIC_INPUT_INVALID", {"field": key})
    # F09：预算/方案数必须为有限有界整数——拒绝负数、小数、字符串、布尔
    if "maxReassignments" in options and options["maxReassignments"] is not None:
        budget = options["maxReassignments"]
        if type(budget) is not int or budget < 0 or budget > len(demands):
            raise FacilityError("FACILITY_REASSIGNMENT_BUDGET_INVALID", {"maxReassignments": str(budget)})
    if "planCount" in options and options["planCount"] is not None:
        plan_count = options["planCount"]
        if type(plan_count) is not int or plan_count < 1 or plan_count > 5:
            raise FacilityError("FACILITY_PLAN_COUNT_INVALID", {"planCount": str(plan_count)})
    # F11：单位契约——显式支持 m3/t，其他单位运行前拒绝；禁止无换算率互换
    volume_unit = options.get("volumeUnit", "m3")
    if volume_unit not in ("m3", "t"):
        raise FacilityError("FACILITY_UNIT_NOT_SUPPORTED", {"volumeUnit": str(volume_unit)})
    for entity in demands + sites:
        for field in ("demand", "capacity"):
            if entity.get(field) is not None and not isinstance(entity[field], dict):
                raise FacilityError("FACILITY_REQUEST_OBJECT_REQUIRED", {"field": field})
        coordinate = entity.get("coordinate")
        if coordinate is not None and (not isinstance(coordinate, list) or len(coordinate) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) for v in coordinate) or abs(coordinate[0]) > 180 or abs(coordinate[1]) > 90):
            raise FacilityError("FACILITY_COORDINATE_INVALID")
        for key in ("demand", "capacity"):
            if any(not number(v) for v in (entity.get(key) or {}).values() if key == "demand" or v is not None):
                raise FacilityError("FACILITY_NUMERIC_INPUT_INVALID", {"field": key})
    for site in sites:
        if any(not number(site.get(key, 0)) for key in ("fixedCost", "handlingCostPerUnit")):
            raise FacilityError("FACILITY_COST_TYPE_INVALID")
    for row in rows:
        if row.get("siteId") not in {site["siteId"] for site in sites} or row.get("demandId") not in {demand["demandId"] for demand in demands}:
            raise FacilityError("FACILITY_MATRIX_REFERENCE_INVALID")
        if not number(row.get("distanceMeters")) or not number(row.get("travelSeconds", 0)):
            raise FacilityError("FACILITY_MATRIX_ROW_INVALID")
    # F09：同一矩阵键重复且取值冲突 → 拒绝；完全相同的重复行去重
    grid = {}
    for row in rows:
        key = (str(row.get("siteId")), str(row.get("demandId")))
        if key in grid and any(grid[key].get(field) != row.get(field) for field in ("distanceMeters", "travelSeconds", "unreachable")):
            raise FacilityError("FACILITY_MATRIX_ROW_CONFLICT", {"siteId": key[0], "demandId": key[1]})
        grid.setdefault(key, row)
    missing = [(site["siteId"], demand["demandId"]) for site in sites for demand in demands if (site["siteId"], demand["demandId"]) not in grid]
    if missing:
        raise FacilityError("FACILITY_MATRIX_GRID_INCOMPLETE", {"missing": missing[:20], "count": len(missing)})
    objective = payload.get("objective")
    if objective is not None:
        mode = objective.get("mode") if isinstance(objective, dict) else None
        unit = objective.get("unit") if isinstance(objective, dict) else None
        expected_unit = options.get("currency") if mode == "COST" else "%s_km" % (options.get("volumeUnit", "m3"),)
        if mode not in {"COST", "VOLUME_KM"} or not isinstance(unit, str) or not unit or unit != expected_unit:
            raise FacilityError("FACILITY_OBJECTIVE_MODE_OR_UNIT_INVALID", {"expected": expected_unit, "received": unit if isinstance(unit, str) else type(unit).__name__})
        expected_pairs = {(str(site["siteId"]), str(demand["demandId"])) for site in sites for demand in demands}
        expected_sites = {str(site["siteId"]) for site in sites}
        pair_values = objective.get("pairValues")
        site_values = objective.get("siteValues")
        if not isinstance(pair_values, list) or not isinstance(site_values, list):
            raise FacilityError("FACILITY_OBJECTIVE_VALUES_REQUIRED")
        pair_keys = [(str(row.get("siteId")), str(row.get("demandId"))) for row in pair_values if isinstance(row, dict)]
        site_keys = [str(row.get("siteId")) for row in site_values if isinstance(row, dict)]
        if len(pair_keys) != len(pair_values) or len(pair_keys) != len(expected_pairs) or set(pair_keys) != expected_pairs or len(site_keys) != len(site_values) or len(site_keys) != len(expected_sites) or set(site_keys) != expected_sites:
            raise FacilityError("FACILITY_OBJECTIVE_COVERAGE_INVALID")
        if any(not number(row.get("value")) for row in pair_values + site_values):
            raise FacilityError("FACILITY_OBJECTIVE_VALUE_INVALID")
        activations = objective.get("activationValues", [])
        if not isinstance(activations, list) or len(activations) > 20000:
            raise FacilityError("FACILITY_ACTIVATION_LIMIT_INVALID")
        activation_ids = set()
        for event in activations:
            if not isinstance(event, dict) or not isinstance(event.get("activationId"), str) or event["activationId"] in activation_ids:
                raise FacilityError("FACILITY_ACTIVATION_ID_INVALID")
            activation_ids.add(event["activationId"])
            members = event.get("demandIds")
            if event.get("siteId") not in expected_sites or not isinstance(members, list) or not members or any(not isinstance(member, str) or member not in {demand["demandId"] for demand in demands} for member in members) or len(set(members)) != len(members) or not number(event.get("value")):
                raise FacilityError("FACILITY_ACTIVATION_VALUE_INVALID")
    return demands, sites, grid


def _solve_one(cp_model: Any, payload: dict[str, Any], facility_count: int, excluded: list[list[str]], forced_site_ids: list[str] | None = None) -> dict[str, Any]:
    demands, sites, grid = _validate(payload)
    options = payload.get("options") or {}
    objective_spec = payload.get("objective")
    pair_values = {(str(row["siteId"]), str(row["demandId"])): row["value"] for row in objective_spec["pairValues"]} if objective_spec else {}
    site_values = {str(row["siteId"]): row["value"] for row in objective_spec["siteValues"]} if objective_spec else {}
    basis = options.get("transportBasis", "quantity")
    rate = Decimal(str(options.get("transportCostPerUnitKm", 0)))
    cutoff = options.get("maxDistanceKm", options.get("maxServiceDistance"))
    time_cutoff = options.get("maxServiceTime")
    site_ids = [str(row["siteId"]) for row in sites]
    demand_ids = [str(row["demandId"]) for row in demands]
    required = [j for j, site in enumerate(sites) if (site.get("status") == "REQUIRED_OPEN" or site.get("required") is True)]
    forbidden = [j for j, site in enumerate(sites) if site.get("status") == "FORBIDDEN"]
    forced = set(forced_site_ids or [])
    if forced and (len(forced) != facility_count or not forced.issubset(set(site_ids))):
        return {"facilityCount": facility_count, "status": "INFEASIBLE", "reasonCode": "CURRENT_PORTFOLIO_INVALID"}
    if facility_count < len(required) or facility_count > len(sites) - len(forbidden):
        return {"facilityCount": facility_count, "status": "INFEASIBLE", "reasonCode": "FACILITY_COUNT_CONFLICT"}

    model = cp_model.CpModel()
    y = [model.new_bool_var(f"open_{j}") for j in range(len(sites))]
    x: dict[tuple[int, int], Any] = {}
    for i, demand in enumerate(demands):
        allowed = set(demand.get("eligibleSiteIds") or site_ids)
        required_capabilities = set(demand.get("requiredCapabilities") or [])
        candidates = []
        for j, site in enumerate(sites):
            row = grid[(site_ids[j], demand_ids[i])]
            compatible = required_capabilities.issubset(set(site.get("capabilities") or []))
            reachable = not row.get("unreachable") and (cutoff is None or row["distanceMeters"] <= cutoff * 1000) and (time_cutoff is None or row["travelSeconds"] <= time_cutoff)
            if site_ids[j] in allowed and compatible and reachable and j not in forbidden:
                x[(i, j)] = model.new_bool_var(f"assign_{i}_{j}")
                model.add(x[(i, j)] <= y[j])
                candidates.append(x[(i, j)])
        if not candidates:
            return {"facilityCount": facility_count, "status": "INFEASIBLE", "reasonCode": "DEMAND_HAS_NO_ELIGIBLE_SITE", "demandId": demand_ids[i]}
        model.add(sum(candidates) == 1)
    model.add(sum(y) == facility_count)
    for j in required:
        model.add(y[j] == 1)
    for j in forbidden:
        model.add(y[j] == 0)
    if forced:
        for j, site_id in enumerate(site_ids):
            model.add(y[j] == (1 if site_id in forced else 0))
    for j, site in enumerate(sites):
        assignments = [x[(i, j)] for i in range(len(demands)) if (i, j) in x]
        if site.get("status") != "REQUIRED_OPEN":
            model.add(y[j] <= sum(assignments) if assignments else y[j] == 0)
        for dimension in ("quantity", "weight", "volume"):
            capacity = (site.get("capacity") or {}).get(dimension)
            if capacity is None:
                continue
            model.add(sum(_scaled((demand.get("demand") or {}).get(dimension, 0)) * x[(i, j)] for i, demand in enumerate(demands) if (i, j) in x) <= _scaled(capacity))
    for combination in excluded:
        indexes = [site_ids.index(site_id) for site_id in combination]
        model.add(sum(y[j] for j in indexes) <= len(indexes) - 1)
    reassign_budget = options.get("maxReassignments")
    if reassign_budget is not None:
        current_by_demand = {str(row.get("demandId")): str(row["currentSiteId"]) for row in demands if row.get("currentSiteId")}
        changed_terms, forced_changes = [], 0
        for i, demand in enumerate(demands):
            current_site = current_by_demand.get(demand_ids[i])
            if not current_site or current_site not in site_ids:
                continue
            variable = x.get((i, site_ids.index(current_site)))
            if variable is None:
                forced_changes += 1
            else:
                changed_terms.append(1 - variable)
        if changed_terms or forced_changes:
            model.add(sum(changed_terms) + forced_changes <= int(reassign_budget))

    terms = []
    objective_upper_bound = 0
    for j, site in enumerate(sites):
        coefficient = _scaled(site_values[site_ids[j]] if objective_spec else site.get("fixedCost", 0))
        objective_upper_bound += abs(coefficient)
        terms.append(coefficient * y[j])
    for (i, j), variable in x.items():
        demand = demands[i]
        amount = Decimal(str((demand.get("demand") or {}).get(basis, 0)))
        distance_km = Decimal(str(grid[(site_ids[j], demand_ids[i])]["distanceMeters"])) / Decimal("1000")
        handling = Decimal(str(sites[j].get("handlingCostPerUnit", 0))) * amount
        transport = distance_km * amount * rate
        coefficient = _scaled(pair_values[(site_ids[j], demand_ids[i])] if objective_spec else handling + transport)
        objective_upper_bound += abs(coefficient)
        terms.append(coefficient * variable)
    for event_index, event in enumerate((objective_spec or {}).get("activationValues", [])):
        j = site_ids.index(event["siteId"])
        members = [x[(demand_ids.index(demand_id), j)] for demand_id in event["demandIds"] if (demand_ids.index(demand_id), j) in x]
        if not members:
            continue
        active = model.new_bool_var(f"charge_{event_index}")
        model.add_max_equality(active, members)
        coefficient = _scaled(event["value"])
        objective_upper_bound += abs(coefficient)
        terms.append(coefficient * active)
    if objective_upper_bound > INT64_SAFE_LIMIT:
        raise FacilityError("FACILITY_OBJECTIVE_INT64_OVERFLOW", {"upperBound": objective_upper_bound})
    model.minimize(sum(terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = min(120.0, max(1.0, float(options.get("timeLimitSeconds", 15))))
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = int(options.get("randomSeed", 1909))
    started = time.perf_counter()
    status_code = solver.solve(model)
    elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
    names = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE", cp_model.INFEASIBLE: "INFEASIBLE", cp_model.MODEL_INVALID: "MODEL_INVALID", cp_model.UNKNOWN: "UNKNOWN"}
    status = names.get(status_code, "UNKNOWN")
    if status not in {"OPTIMAL", "FEASIBLE"}:
        return {"facilityCount": facility_count, "status": status, "solveTimeMs": elapsed_ms}
    selected = [site_ids[j] for j in range(len(sites)) if solver.value(y[j])]
    assignments = []
    components = {"fixed": Decimal("0"), "handling": Decimal("0"), "transport": Decimal("0")}
    for j, site in enumerate(sites):
        if solver.value(y[j]):
            components["fixed"] += Decimal(str(site.get("fixedCost", 0)))
    for (i, j), variable in x.items():
        if not solver.value(variable):
            continue
        demand = demands[i]
        amount = Decimal(str((demand.get("demand") or {}).get(basis, 0)))
        distance_m = int(grid[(site_ids[j], demand_ids[i])]["distanceMeters"])
        handling = Decimal(str(sites[j].get("handlingCostPerUnit", 0))) * amount
        transport = Decimal(str(distance_m)) / Decimal("1000") * amount * rate
        components["handling"] += handling
        components["transport"] += transport
        assignments.append({"demandId": demand_ids[i], "siteId": site_ids[j], "distanceMeters": distance_m, "basisAmount": float(amount)})
    objective = sum(components.values())
    bound_value = solver.best_objective_bound
    if callable(bound_value):
        bound_value = bound_value()
    bound = Decimal(str(bound_value)) / Decimal("1000")
    solver_objective = Decimal(str(solver.objective_value)) / Decimal("1000")
    gap = float((solver_objective - bound) / abs(solver_objective)) if solver_objective else 0.0
    result = {"facilityCount": facility_count, "portfolioKind": "CURRENT_NETWORK_BASELINE" if forced else "CANDIDATE_PORTFOLIO", "status": status, "selectedSiteIds": selected, "assignments": assignments, "serviceRate": 1.0, "cost": {"currency": options.get("currency"), "period": options.get("costPeriod"), "fixed": float(components["fixed"]), "handling": float(components["handling"]), "transport": float(components["transport"]), "total": float(objective)}, "objectiveValue": float(solver_objective), "bestBound": float(bound), "relativeGap": max(0.0, gap), "solveTimeMs": elapsed_ms}
    current_by_demand = {str(row.get("demandId")): str(row["currentSiteId"]) for row in payload.get("demands", []) if row.get("currentSiteId")}
    result["changedDemands"] = sum(1 for item in assignments if current_by_demand.get(item["demandId"]) not in (None, item["siteId"]))
    if payload.get("objective"):
        result["cost"]["scope"] = "LEGACY_OUTBOUND_COMPONENTS_NOT_TOTAL_OBJECTIVE"
        result["objectiveMode"] = payload["objective"]["mode"]
        result["objectiveUnit"] = payload["objective"]["unit"]
        result["objectiveScale"] = 1000
    result["portfolioHash"] = _hash(result)
    return result


def solve_facility(payload: dict[str, Any], cp_model: Any, engine_version: str,
                   deadline: float | None = None, on_progress=None) -> dict[str, Any]:
    _validate(payload)
    counts = payload.get("options", {}).get("facilityCounts") or [1, 2, 3]
    if any(type(value) is not int or value < 1 for value in counts):
        raise FacilityError("FACILITY_COUNT_INVALID")
    results = []
    plan_count = max(1, min(5, int(payload.get("options", {}).get("planCount") or 1)))
    demands_with_current = sum(1 for row in payload.get("demands", []) if row.get("currentSiteId"))
    use_plans = plan_count > 1 and demands_with_current > 0
    seen_assignments: dict[int, set] = {count: set() for count in counts}
    finished_counts: set[int] = set()
    budget_exhausted = False
    fractions = [index / plan_count for index in range(1, plan_count)]

    def _tag(row, rank, plan_rank, budget=None):
        if payload.get("objective"):
            row["objectiveMode"] = payload["objective"]["mode"]
            row["objectiveUnit"] = payload["objective"]["unit"]
            row["objectiveScale"] = 1000
        row["rank"] = rank
        row["planRank"] = plan_rank
        if budget is not None:
            row["maxReassignments"] = budget
        if "portfolioHash" in row:
            row["portfolioHash"] = _hash({key: value for key, value in row.items() if key not in {"portfolioHash", "rank"}})
        return row

    def _solve(count, extra, excluded=None):
        options_extra = {}
        if deadline is not None:
            options_extra["timeLimitSeconds"] = max(0.01, min(120, deadline - time.monotonic()))
        options_extra.update(extra)
        request = {**payload, "options": {**payload.get("options", {}), **options_extra}}
        return _solve_one(cp_model, request, count, excluded or [])

    for count in counts:
        if count in finished_counts:
            continue
        if deadline is not None and deadline - time.monotonic() <= 0:
            budget_exhausted = True
            break
        if use_plans:
            # Pass 0: unconstrained optimum learns how many changes perfection needs.
            opt_row = _tag(_solve(count, {}), 0, plan_count)
            if opt_row.get("status") not in {"OPTIMAL", "FEASIBLE"}:
                results.append(opt_row)
                finished_counts.add(count)
                continue
            optimum_changes = opt_row.get("changedDemands") or 0
            ordered = []
            for offset, fraction in enumerate(fractions):
                if deadline is not None and deadline - time.monotonic() <= 0:
                    budget_exhausted = True
                    break
                budget = max(1, math.ceil(optimum_changes * fraction)) if optimum_changes else 0
                if optimum_changes and budget >= optimum_changes:
                    continue
                row = _tag(_solve(count, {"maxReassignments": budget} if budget else {}), 0, offset + 1, budget)
                if row.get("status") in {"OPTIMAL", "FEASIBLE"}:
                    ordered.append(row)
            ordered.append(opt_row)
            for index, row in enumerate(ordered):
                signature = tuple(sorted((item["demandId"], item["siteId"]) for item in row.get("assignments", [])))
                if signature in seen_assignments[count]:
                    continue
                seen_assignments[count].add(signature)
                row["rank"] = index + 1
                row["planRank"] = index + 1
                results.append(row)
            if on_progress:
                on_progress({"facilityCount": count, "planRank": plan_count, "status": opt_row.get("status"),
                             "feasible": sum(item.get("status") in {"OPTIMAL", "FEASIBLE"} for item in results)})
        else:
            excluded: list[list[str]] = []
            for rank, plan_rank in ((1, 1), (2, 2)):
                if deadline is not None and deadline - time.monotonic() <= 0:
                    budget_exhausted = True
                    break
                row = _tag(_solve(count, {}, excluded), rank, plan_rank)
                results.append(row)
                if on_progress:
                    on_progress({"facilityCount": count, "rank": rank, "planRank": plan_rank, "status": row.get("status"),
                                 "feasible": sum(item.get("status") in {"OPTIMAL", "FEASIBLE"} for item in results)})
                if row.get("status") not in {"OPTIMAL", "FEASIBLE"}:
                    finished_counts.add(count)
                    break
                excluded.append(row["selectedSiteIds"])
    current_ids = [str(value) for value in payload.get("options", {}).get("currentPortfolioSiteIds", [])]
    current = None
    if current_ids and (deadline is None or deadline-time.monotonic() > 0):
        request = payload if deadline is None else {**payload, "options": {**payload.get("options", {}), "timeLimitSeconds": max(0.01, min(120, deadline-time.monotonic()))}}
        current = _solve_one(cp_model, request, len(current_ids), [], current_ids)
    if current is not None:
        if payload.get("objective"):
            current["objectiveMode"] = payload["objective"]["mode"]
            current["objectiveUnit"] = payload["objective"]["unit"]
            current["objectiveScale"] = 1000
        current["rank"] = 0
    response = {"schemaVersion": "stct-facility-solve-result-v1.9-mvp1", "requestId": payload.get("requestId"), "studyHash": payload.get("studyHash"), "engine": {"id": "OR_TOOLS_CP_SAT", "version": engine_version, "workers": 1, "randomSeed": int(payload.get("options", {}).get("randomSeed", 1909)), "globalOptimalityClaim": "PER_RESULT_STATUS_ONLY"}, "currentBaseline": current, "results": results, "publicRequests": 0}
    # F10：容量语义显式化——逐期容量未进入本候选生成模型时如实声明
    response["capacitySemantics"] = "AGGREGATE_CAPACITY_MODELED" if any((site.get("capacity") or {}).get(dim) is not None for site in payload.get("sites", []) for dim in ("quantity", "weight", "volume")) else "PERIOD_CAPACITY_NOT_MODELED"
    response["budgetExhausted"] = budget_exhausted or deadline is not None and deadline-time.monotonic() <= 0
    response["candidateSetComplete"] = not response["budgetExhausted"] and len(finished_counts) == len(set(counts)) and all(item.get("status") not in {"TIME_LIMIT", "FEASIBLE"} for item in results)
    if payload.get("objective"):
        response["objectiveMode"] = payload["objective"]["mode"]
        response["objectiveUnit"] = payload["objective"]["unit"]
        response["objectiveScale"] = 1000
    response["resultSetHash"] = _hash(response)
    return response
