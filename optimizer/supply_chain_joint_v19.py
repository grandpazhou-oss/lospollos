"""Local strategic two-stage network flow model; no routing or inventory decisions."""

from __future__ import annotations

import math
import time
from decimal import Decimal, InvalidOperation
from typing import Any, Callable


class SupplyChainSolveError(Exception):
    def __init__(self, code: str, detail: dict[str, Any] | None = None):
        self.code = code
        self.detail = detail or {}
        super().__init__(code)


QUANTITY_SCALE = 10000  # period demand can gain one decimal place after a 10% scenario
COEFFICIENT_SCALE = 1000
SCHEMA = "stct-supply-chain-joint-request-v1"
SCHEMA_V2 = "stct-supply-chain-joint-request-v2"


def _number(value: Any, label: str, minimum: float = 0) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value < minimum:
        raise SupplyChainSolveError("SUPPLY_JOINT_NUMBER_INVALID", {"field": label})
    return float(value)


def _units(value: Any, label: str, scale: int = QUANTITY_SCALE) -> int:
    amount = _number(value, label)
    if amount*scale > 10**12:
        raise SupplyChainSolveError("SUPPLY_JOINT_VOLUME_LIMIT", {"field": label})
    try:
        exact = Decimal(str(value)) * scale
    except InvalidOperation:
        raise SupplyChainSolveError("SUPPLY_JOINT_QUANTITY_PRECISION", {"field": label})
    if exact != exact.to_integral_value() and (exact.to_integral_value() == 0 and amount != 0 or abs(float(exact-exact.to_integral_value())) > 16*math.ulp(amount)*scale):
        raise SupplyChainSolveError("SUPPLY_JOINT_QUANTITY_PRECISION", {"field": label})
    return int(exact.to_integral_value())


def _coefficient(value: Any, label: str) -> int:
    return round(_number(value, label) * COEFFICIENT_SCALE)


def _id(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip()) and "\x00" not in value


def _period_map(value: Any, periods: list[str], label: str, *, precision: bool = False,
                complete: bool = False, nullable: bool = False, scale: int = QUANTITY_SCALE) -> None:
    if not isinstance(value, dict) or any(period not in periods for period in value) or complete and any(period not in value for period in periods):
        raise SupplyChainSolveError("SUPPLY_JOINT_PERIOD_INVALID", {"field": label})
    for period, amount in value.items():
        if nullable and amount is None: continue
        (_units(amount, f"{label}.{period}", scale) if precision else _number(amount, f"{label}.{period}"))


def _validate(payload: dict[str, Any]) -> None:
    if not isinstance(payload, dict) or payload.get("schemaVersion") not in {SCHEMA, SCHEMA_V2} or not _id(payload.get("requestId")) or not _id(payload.get("studyHash")):
        raise SupplyChainSolveError("SUPPLY_JOINT_SCHEMA_INVALID")
    scale = payload.get("quantityScale", QUANTITY_SCALE) if payload["schemaVersion"] == SCHEMA_V2 else QUANTITY_SCALE
    if type(scale) is not int or scale not in {10000, 100000, 1000000} or payload["schemaVersion"] == SCHEMA and "quantityScale" in payload:
        raise SupplyChainSolveError("SUPPLY_JOINT_QUANTITY_SCALE_INVALID")
    if not isinstance(payload.get("scope"), str) or not isinstance(payload.get("objective"), str) or payload.get("scope") not in {"UPSTREAM_ONLY", "FULL_CHAIN"} or payload.get("objective") not in {"VOLUME_KM", "COST"}:
        raise SupplyChainSolveError("SUPPLY_JOINT_SCOPE_INVALID")
    source_mode = payload.get("sourceMode", "PARTIAL" if payload.get("sourceRules") else "FREE")
    total_mode = payload.get("supplierTotalMode", "ADJUSTABLE")
    if not isinstance(source_mode, str) or not isinstance(total_mode, str) or source_mode not in {"FREE", "FIXED", "PARTIAL"} or total_mode not in {"FIXED_OBSERVED", "ADJUSTABLE"}:
        raise SupplyChainSolveError("SUPPLY_JOINT_SOURCE_MODE_INVALID")
    for group in ("periods", "suppliers", "sites", "demands"):
        rows = payload.get(group)
        if not isinstance(rows, list) or group != "periods" and any(not isinstance(row, dict) for row in rows):
            raise SupplyChainSolveError("SUPPLY_JOINT_SCHEMA_INVALID", {"group": group})
        names = [row if group == "periods" else row.get("id") for row in rows]
        if any(not _id(name) for name in names) or len(names) != len(set(names)):
            raise SupplyChainSolveError("SUPPLY_JOINT_DUPLICATE_ID", {"group": group})
    periods, suppliers, sites, demands = (payload[key] for key in ("periods", "suppliers", "sites", "demands"))
    if not periods or len(periods) > 24 or not suppliers or len(suppliers) > 30 or not sites or len(sites) > 20 or len(demands) > 500:
        raise SupplyChainSolveError("SUPPLY_JOINT_SIZE_LIMIT")
    if payload["scope"] == "FULL_CHAIN" and not demands or payload["scope"] == "UPSTREAM_ONLY" and demands:
        raise SupplyChainSolveError("SUPPLY_JOINT_DEMAND_REQUIRED")
    source_ids, site_ids, demand_ids = ({row["id"] for row in group} for group in (suppliers, sites, demands))
    if source_ids & site_ids:
        raise SupplyChainSolveError("SUPPLY_JOINT_DUPLICATE_ID", {"group": "node roles"})
    forbidden = {site["id"] for site in sites if site.get("status") == "FORBIDDEN"}
    for site in sites:
        if not isinstance(site.get("status"), str) or site.get("status") not in {"REQUIRED", "OPTIONAL", "FORBIDDEN"}:
            raise SupplyChainSolveError("SUPPLY_JOINT_SITE_RULE_INVALID")
        for field in ("capacityByPeriod", "receivingByPeriod", "frozenByPeriod"):
            _period_map(site.get(field, {}), periods, field, precision=True, nullable=field == "capacityByPeriod", scale=scale)
        required_cost = payload["objective"] == "COST" and payload["scope"] == "FULL_CHAIN" and site["status"] != "FORBIDDEN"
        for field in ("fixedCostByPeriod", "handlingPerUnitByPeriod"):
            _period_map(site.get(field, {}), periods, field, nullable=True, complete=required_cost)
            if required_cost and any(site.get(field, {}).get(period) is None for period in periods):
                raise SupplyChainSolveError("SUPPLY_COST_OBJECTIVE_INCOMPLETE")
    required = sum(site["status"] == "REQUIRED" for site in sites)
    counts = payload.get("siteCounts")
    if not isinstance(counts, list) or not counts or any(type(count) is not int or count < max(1, required) or count > len(sites)-len(forbidden) for count in counts) or len(counts) != len(set(counts)):
        raise SupplyChainSolveError("SUPPLY_JOINT_SITE_COUNTS_INVALID")
    for supplier in suppliers:
        for field in ("fixedTotalByPeriod", "minByPeriod", "maxByPeriod"):
            _period_map(supplier.get(field, {}), periods, field, precision=True, complete=field == "fixedTotalByPeriod" and total_mode == "FIXED_OBSERVED", scale=scale)
        for period in periods:
            lower, upper = (supplier.get(field, {}).get(period) for field in ("minByPeriod", "maxByPeriod"))
            if lower is not None and upper is not None and lower > upper:
                raise SupplyChainSolveError("SUPPLY_JOINT_SUPPLIER_BOUNDS_INVALID")
    for demand in demands:
        locked = demand.get("lockedSiteId")
        if not _id(demand.get("customerNodeId")) or locked is not None and (not _id(locked) or locked not in site_ids or locked in forbidden):
            raise SupplyChainSolveError("SUPPLY_JOINT_DEMAND_REFERENCE_INVALID")
        _period_map(demand.get("quantitiesByPeriod"), periods, "quantitiesByPeriod", precision=True, scale=scale)
    edge_keys = {}
    for group, limit in (("inboundEdges", 600), ("outboundEdges", 10000)):
        rows = payload.get(group)
        if not isinstance(rows, list) or len(rows) > limit:
            raise SupplyChainSolveError("SUPPLY_JOINT_EDGE_LIMIT")
        edge_keys[group] = set()
        for edge in rows:
            if not isinstance(edge, dict) or not _id(edge.get("siteId")) or not _id(edge.get("supplierId") if group == "inboundEdges" else edge.get("demandId")) or edge.get("siteId") not in site_ids or edge.get("siteId") in forbidden or (edge.get("supplierId") not in source_ids if group == "inboundEdges" else edge.get("demandId") not in demand_ids):
                raise SupplyChainSolveError("SUPPLY_JOINT_EDGE_REFERENCE_INVALID")
            pair = (edge.get("supplierId") if group == "inboundEdges" else edge.get("demandId"), edge["siteId"])
            if pair in edge_keys[group]: raise SupplyChainSolveError("SUPPLY_JOINT_DUPLICATE_EDGE")
            edge_keys[group].add(pair)
            _number(edge.get("distanceKm"), "distanceKm")
            _period_map(edge.get("unitCostByPeriod", {}), periods, "unitCostByPeriod", nullable=payload["objective"] != "COST", complete=payload["objective"] == "COST")
    if payload["scope"] == "UPSTREAM_ONLY" and payload["outboundEdges"]:
        raise SupplyChainSolveError("SUPPLY_JOINT_EDGE_REFERENCE_INVALID")
    rules = payload.get("sourceRules")
    if not isinstance(rules, list) or source_mode == "FREE" and rules or source_mode == "FIXED" and not rules:
        raise SupplyChainSolveError("SUPPLY_JOINT_RULE_INVALID")
    rule_keys = set()
    for rule in rules:
        if not isinstance(rule, dict) or not isinstance(rule.get("mode"), str) or not _id(rule.get("supplierId")) or not _id(rule.get("siteId")) or rule.get("mode") not in {"FIXED_AMOUNT", "FIXED_SHARE", "MIN_SHARE", "EXCLUSIVE"} or rule.get("supplierId") not in source_ids or rule.get("siteId") not in site_ids:
            raise SupplyChainSolveError("SUPPLY_JOINT_RULE_INVALID")
        pair = (rule["supplierId"], rule["siteId"])
        if pair in rule_keys: raise SupplyChainSolveError("SUPPLY_JOINT_RULE_INVALID")
        rule_keys.add(pair)
        if pair not in edge_keys["inboundEdges"]: raise SupplyChainSolveError("SUPPLY_JOINT_RULE_EDGE_MISSING")
        if rule["mode"] == "FIXED_AMOUNT": _period_map(rule.get("quantityByPeriod"), periods, "quantityByPeriod", precision=True, complete=True, scale=scale)
        if rule["mode"] in {"FIXED_SHARE", "MIN_SHARE"}:
            share = _number(rule.get("share"), "share")
            if share > 1 or abs(round(share*1_000_000)/1_000_000-share) > 1e-10:
                raise SupplyChainSolveError("SUPPLY_JOINT_SHARE_INVALID")
    if source_mode == "FIXED" and edge_keys["inboundEdges"] - rule_keys:
        raise SupplyChainSolveError("SUPPLY_JOINT_RULE_EDGE_MISSING")
    if not 1 <= _number(payload.get("timeLimitSeconds", 10), "timeLimitSeconds") <= 30:
        raise SupplyChainSolveError("SUPPLY_JOINT_BUDGET_INVALID")
    limit = payload.get("maxResultsPerCount", 5)
    if type(limit) is not int or not 1 <= limit <= 8:
        raise SupplyChainSolveError("SUPPLY_JOINT_BUDGET_INVALID")
    volume = sum(sum(row.get("quantitiesByPeriod" if payload["scope"] == "FULL_CHAIN" else "receivingByPeriod", {}).values()) for row in (demands if payload["scope"] == "FULL_CHAIN" else sites))
    if volume*scale > 10**12: raise SupplyChainSolveError("SUPPLY_JOINT_VOLUME_LIMIT")
    def max_edge(rows):
        return max([0] + [amount for edge in rows for amount in (edge["unitCostByPeriod"].values() if payload["objective"] == "COST" else [edge["distanceKm"]])])
    active = [site for site in sites if site["status"] != "FORBIDDEN"]
    costing = payload["objective"] == "COST" and payload["scope"] == "FULL_CHAIN"
    handling = max([0] + [value for site in active for value in site["handlingPerUnitByPeriod"].values()]) if costing else 0
    fixed = sum(value for site in active for value in site["fixedCostByPeriod"].values()) if costing else 0
    if (volume*(max_edge(payload["inboundEdges"])+max_edge(payload["outboundEdges"])+handling)+fixed)*scale*COEFFICIENT_SCALE > 2**61:
        raise SupplyChainSolveError("SUPPLY_JOINT_OBJECTIVE_RANGE")


def solve_joint(payload: dict[str, Any], cp_model: Any, engine_version: str,
                deadline: float | None = None,
                on_progress: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
    _validate(payload)
    quantity_scale = payload.get("quantityScale", QUANTITY_SCALE)
    objective_scale = quantity_scale * COEFFICIENT_SCALE
    def units(value: Any, label: str) -> int:
        return _units(value, label, quantity_scale)
    periods = payload["periods"]
    suppliers = payload["suppliers"]
    sites = payload["sites"]
    demands = payload.get("demands") or []
    supplier_ids = [row["id"] for row in suppliers]
    site_ids = [row["id"] for row in sites]
    demand_ids = [row["id"] for row in demands]
    inbound = {(row["supplierId"], row["siteId"]): row for row in payload["inboundEdges"]}
    outbound = {(row["siteId"], row["demandId"]): row for row in payload.get("outboundEdges") or []}
    if len(inbound) != len(payload["inboundEdges"]) or len(outbound) != len(payload.get("outboundEdges") or []):
        raise SupplyChainSolveError("SUPPLY_JOINT_DUPLICATE_EDGE")
    for (source, site), edge in inbound.items():
        if source not in supplier_ids or site not in site_ids:
            raise SupplyChainSolveError("SUPPLY_JOINT_EDGE_REFERENCE_INVALID")
        _number(edge.get("distanceKm"), "inbound.distanceKm")
        if payload["objective"] == "COST":
            for period in periods: _number(edge.get("unitCostByPeriod", {}).get(period), "inbound.unitCost")
    for (site, demand), edge in outbound.items():
        if site not in site_ids or demand not in demand_ids:
            raise SupplyChainSolveError("SUPPLY_JOINT_EDGE_REFERENCE_INVALID")
        _number(edge.get("distanceKm"), "outbound.distanceKm")
        if payload["objective"] == "COST":
            for period in periods: _number(edge.get("unitCostByPeriod", {}).get(period), "outbound.unitCost")
    total_units = sum(units(value, "demand") for row in demands for value in row.get("quantitiesByPeriod", {}).values()) if payload["scope"] == "FULL_CHAIN" else sum(units(value, "receiving") for row in sites for value in row.get("receivingByPeriod", {}).values())
    if total_units <= 0 or total_units > 10**12:
        raise SupplyChainSolveError("SUPPLY_JOINT_VOLUME_LIMIT")
    limit = min(30, max(1, _number(payload.get("timeLimitSeconds", 10), "timeLimitSeconds", 1)))
    max_results = min(8, max(1, int(payload.get("maxResultsPerCount", 5))))
    all_results: list[dict[str, Any]] = []
    period_total_units = {period: sum(units(row.get("quantitiesByPeriod", {}).get(period, 0), "demand.period") for row in demands) for period in periods} if payload["scope"] == "FULL_CHAIN" else {}

    counts = sorted(set(payload["siteCounts"]))
    excluded_by_count: dict[int, list[set[str]]] = {count: [] for count in counts}
    finished_counts: set[int] = set()
    budget_exhausted = False
    for rank in range(max_results):
        for count in counts:
            if count in finished_counts: continue
            if deadline is not None and deadline - time.monotonic() <= 0:
                budget_exhausted = True
                break
            excluded = excluded_by_count[count]
            started = time.monotonic()
            model = cp_model.CpModel()
            y = {site: model.NewBoolVar(f"open_{i}") for i, site in enumerate(site_ids)}
            model.Add(sum(y.values()) == count)
            for site in sites:
                if site.get("status") == "REQUIRED": model.Add(y[site["id"]] == 1)
                if site.get("status") == "FORBIDDEN": model.Add(y[site["id"]] == 0)
            for used in excluded:
                model.Add(sum(y[site] if site in used else 1-y[site] for site in site_ids) <= len(site_ids)-1)
            x = {}
            if payload["scope"] == "FULL_CHAIN":
                for demand in demands:
                    did = demand["id"]
                    eligible = [site for site in site_ids if (site, did) in outbound and (not demand.get("lockedSiteId") or demand["lockedSiteId"] == site)]
                    if not eligible:
                        raise SupplyChainSolveError("SUPPLY_JOINT_DEMAND_NO_EDGE", {"demandId": did})
                    for site in eligible:
                        x[site, did] = model.NewBoolVar(f"assign_{site_ids.index(site)}_{demand_ids.index(did)}")
                        model.Add(x[site, did] <= y[site])
                    model.Add(sum(x[site, did] for site in eligible) == 1)
            f = {}
            site_load = {}
            for site in sites:
                sid = site["id"]
                for period in periods:
                    if payload["scope"] == "FULL_CHAIN":
                        load = sum(units(d.get("quantitiesByPeriod", {}).get(period, 0), "demand.period") * x[sid, d["id"]] for d in demands if (sid, d["id"]) in x)
                    else:
                        load = units(site.get("receivingByPeriod", {}).get(period, 0), "receiving.period")
                        if load: model.Add(y[sid] == 1)
                    site_load[sid, period] = load
                    cap = site.get("capacityByPeriod", {}).get(period)
                    frozen = units(site.get("frozenByPeriod", {}).get(period, 0), "site.frozen") if payload["scope"] == "UPSTREAM_ONLY" else 0
                    if frozen: model.Add(y[sid] == 1)
                    if cap is not None: model.Add(load + frozen <= units(cap, "site.capacity"))
                    period_upper = period_total_units[period] if payload["scope"] == "FULL_CHAIN" else load
                    if cap is not None: period_upper = min(period_upper, max(0, units(cap, "site.capacity")-frozen))
                    incoming = []
                    for source in supplier_ids:
                        if (source, sid) not in inbound: continue
                        var = model.NewIntVar(0, period_upper, f"flow_{supplier_ids.index(source)}_{site_ids.index(sid)}_{periods.index(period)}")
                        model.Add(var <= period_upper * y[sid])
                        f[source, sid, period] = var
                        incoming.append(var)
                    model.Add(sum(incoming) == load)
            for supplier in suppliers:
                source = supplier["id"]
                for period in periods:
                    volume = sum(f[source, site, period] for site in site_ids if (source, site, period) in f)
                    fixed = supplier.get("fixedTotalByPeriod", {}).get(period)
                    if fixed is not None: model.Add(volume == units(fixed, "supplier.fixedTotal"))
                    lower = supplier.get("minByPeriod", {}).get(period)
                    upper = supplier.get("maxByPeriod", {}).get(period)
                    if lower is not None: model.Add(volume >= units(lower, "supplier.min"))
                    if upper is not None: model.Add(volume <= units(upper, "supplier.max"))
            for rule in payload.get("sourceRules") or []:
                source, site, mode = rule.get("supplierId"), rule.get("siteId"), rule.get("mode")
                if source not in supplier_ids or site not in site_ids or mode not in {"FIXED_AMOUNT", "FIXED_SHARE", "MIN_SHARE", "EXCLUSIVE"}:
                    raise SupplyChainSolveError("SUPPLY_JOINT_RULE_INVALID")
                if (source, site) not in inbound:
                    raise SupplyChainSolveError("SUPPLY_JOINT_RULE_EDGE_MISSING")
                if mode == "EXCLUSIVE":
                    for other in supplier_ids:
                        if other != source:
                            for period in periods:
                                if (other, site, period) in f: model.Add(f[other, site, period] == 0)
                for period in periods:
                    flow = f[source, site, period]
                    if mode == "FIXED_AMOUNT":
                        model.Add(flow == units(rule.get("quantityByPeriod", {}).get(period), "rule.fixedAmount"))
                    elif mode in {"FIXED_SHARE", "MIN_SHARE"}:
                        share = _number(rule.get("share"), "rule.share")
                        if share > 1: raise SupplyChainSolveError("SUPPLY_JOINT_SHARE_INVALID")
                        numerator = round(share * 1_000_000)
                        if mode == "FIXED_SHARE":
                            model.Add(flow * 1_000_000 >= site_load[site, period] * numerator - 500_000)
                            model.Add(flow * 1_000_000 <= site_load[site, period] * numerator + 500_000)
                        else:
                            model.Add(flow * 1_000_000 >= site_load[site, period] * numerator)
            terms = []
            for (source, site, period), var in f.items():
                edge = inbound[source, site]
                coefficient = edge["unitCostByPeriod"][period] if payload["objective"] == "COST" else edge["distanceKm"]
                terms.append(_coefficient(coefficient, "inbound.objective") * var)
            if payload["scope"] == "FULL_CHAIN":
                for (site, did), var in x.items():
                    edge = outbound[site, did]
                    demand = demands[demand_ids.index(did)]
                    terms.append(sum(_coefficient(edge["unitCostByPeriod"][period] if payload["objective"] == "COST" else edge["distanceKm"], "outbound.objective") * units(demand.get("quantitiesByPeriod", {}).get(period, 0), "demand.period") for period in periods) * var)
                if payload["objective"] == "COST":
                    for site in sites:
                        if site["status"] == "FORBIDDEN": continue
                        sid = site["id"]
                        for period in periods:
                            fixed = site.get("fixedCostByPeriod", {}).get(period, 0)
                            handling = site.get("handlingPerUnitByPeriod", {}).get(period, 0)
                            terms.append(round(_number(fixed, "fixedCost") * objective_scale) * y[sid])
                            terms.append(_coefficient(handling, "handling") * site_load[sid, period])
            model.Minimize(sum(terms))
            solver = cp_model.CpSolver()
            remaining = deadline - time.monotonic() if deadline is not None else limit
            if remaining <= 0:
                budget_exhausted = True
                break
            solver.parameters.max_time_in_seconds = min(limit, remaining)
            solver.parameters.num_search_workers = 1
            solver.parameters.random_seed = 1909
            status_code = solver.Solve(model)
            status = {cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE", cp_model.INFEASIBLE: "INFEASIBLE", cp_model.UNKNOWN: "TIME_LIMIT"}.get(status_code, "MODEL_INVALID")
            if status not in {"OPTIMAL", "FEASIBLE"}:
                if rank == 0: all_results.append({"facilityCount": count, "rank": 1, "status": status, "reasonCode": "MODEL_PROVEN_INFEASIBLE" if status == "INFEASIBLE" else "NO_VERIFIED_SOLUTION", "solveTimeMs": round((time.monotonic()-started)*1000)})
                finished_counts.add(count)
                if status == "TIME_LIMIT": budget_exhausted = True
                if on_progress: on_progress({"facilityCount": count, "rank": rank+1, "status": status, "feasible": sum(row["status"] in {"OPTIMAL", "FEASIBLE"} for row in all_results), "elapsedMs": round((time.monotonic()-started)*1000)})
                continue
            selected = [site for site in site_ids if solver.Value(y[site])]
            assignments = [{"demandId": did, "siteId": site} for (site, did), var in x.items() if solver.Value(var)]
            flows = [{"supplierId": source, "siteId": site, "period": period, "quantity": solver.Value(var)/quantity_scale} for (source, site, period), var in f.items() if solver.Value(var)]
            objective_value = sum(row["quantity"] * (inbound[row["supplierId"], row["siteId"]]["unitCostByPeriod"][row["period"]] if payload["objective"] == "COST" else inbound[row["supplierId"], row["siteId"]]["distanceKm"]) for row in flows)
            if payload["scope"] == "FULL_CHAIN":
                demand_by_id = {row["id"]: row for row in demands}
                objective_value += sum(sum(demand_by_id[row["demandId"]].get("quantitiesByPeriod", {}).get(period, 0) * (outbound[row["siteId"], row["demandId"]]["unitCostByPeriod"][period] if payload["objective"] == "COST" else outbound[row["siteId"], row["demandId"]]["distanceKm"]) for period in periods) for row in assignments)
                if payload["objective"] == "COST":
                    for site in selected:
                        config = sites[site_ids.index(site)]
                        objective_value += sum(config.get("fixedCostByPeriod", {}).get(period, 0) + config.get("handlingPerUnitByPeriod", {}).get(period, 0) * solver.Value(site_load[site, period])/quantity_scale for period in periods)
            all_results.append({"facilityCount": count, "rank": rank+1, "status": status, "selectedSiteIds": selected, "assignments": assignments, "sourceFlows": flows, "objectiveValue": objective_value, "objectiveScaledValue": solver.ObjectiveValue()/objective_scale, "objectiveUnit": payload.get("currency") if payload["objective"] == "COST" else f"{payload.get('unit')}_km", "bestBound": solver.BestObjectiveBound()/objective_scale, "relativeGap": 0 if status == "OPTIMAL" else abs(solver.ObjectiveValue()-solver.BestObjectiveBound())/max(1, abs(solver.ObjectiveValue())), "solveTimeMs": round((time.monotonic()-started)*1000), "variableCount": len(y)+len(x)+len(f), "constraintCount": len(model.Proto().constraints)})
            excluded.append(set(selected))
            if status != "OPTIMAL": finished_counts.add(count)
            if on_progress: on_progress({"facilityCount": count, "rank": rank+1, "status": status, "feasible": sum(row["status"] in {"OPTIMAL", "FEASIBLE"} for row in all_results), "elapsedMs": round((time.monotonic()-started)*1000)})
        if budget_exhausted: break
    feasible = [row for row in all_results if row["status"] in {"OPTIMAL", "FEASIBLE"}]
    feasible.sort(key=lambda row: row["objectiveValue"])
    first_by_count = [next((row for row in feasible if row["facilityCount"] == count), None) for count in counts]
    selected = [row for row in first_by_count if row is not None]
    selected += [row for row in feasible if row not in selected][:max(0, max_results-len(selected))]
    returned = selected + [row for row in all_results if row["status"] not in {"OPTIMAL", "FEASIBLE"}]
    coverage = [{"facilityCount": count, "status": "PROVEN_EXHAUSTED" if count in finished_counts and not any(row["facilityCount"] == count and row["status"] in {"TIME_LIMIT", "FEASIBLE"} for row in all_results) else "BUDGET_EXHAUSTED" if budget_exhausted else "LIMIT_REACHED", "feasible": sum(row["facilityCount"] == count and row["status"] in {"OPTIMAL", "FEASIBLE"} for row in all_results)} for count in counts]
    complete = not budget_exhausted and all(row["status"] == "PROVEN_EXHAUSTED" for row in coverage) and len(selected) == len(feasible)
    return {"schemaVersion": "stct-supply-chain-joint-result-v1", "requestId": payload["requestId"], "studyHash": payload["studyHash"], "scope": payload["scope"], "objective": payload["objective"], "engine": {"id": "OR_TOOLS_CP_SAT", "version": engine_version, "workers": 1, "randomSeed": 1909, "quantityPrecision": 1 / quantity_scale, "quantityScale": quantity_scale, "coefficientPrecision": 0.001, "claim": "PER_RESULT_STATUS_ON_DISCRETIZED_MODEL"}, "results": returned, "attempted": len(all_results), "feasible": len(feasible), "displayed": len(selected), "infeasible": sum(row["status"] == "INFEASIBLE" for row in all_results), "timedOut": sum(row["status"] == "TIME_LIMIT" for row in all_results), "budgetExhausted": budget_exhausted, "countCoverage": coverage, "candidateSetComplete": complete}
