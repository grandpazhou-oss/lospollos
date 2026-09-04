#!/usr/bin/env python3
"""Generate the checked-in cross-language canonical fixture expectations."""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from optimizer.canonical_contract import CONTRACT, plan_identity, request_identity, scenario_identity


OUTPUT = ROOT / "shared" / "canonical-hash-fixtures.json"


def base_scenario() -> dict:
    weights = CONTRACT["balancedPoolWeights"]
    return {
        "planningMode": "SINGLE_DAY",
        "planningDate": "2026-05-01",
        "depot": {"id": "D-01", "name": "\u4e0a\u6d77\u4ed3", "address": "\u4e5d\u65b0\u516c\u8def 855 \u53f7", "lon": 121.3182798, "lat": 31.0991395},
        "orders": [
            {
                "id": "O-001",
                "code": "C001",
                "name": "\u4e0a\u6d77\u5e97",
                "address": "\u957f\u5b81\u533a 1 \u53f7",
                "date": "2026-05-01",
                "lon": 121.3582075,
                "lat": 31.21796455,
                "count": 3,
                "volume": 0.165,
                "weight": 16,
                "serviceMin": 2,
                "twStart": "13:00",
                "twEnd": "15:00",
                "priority": "high",
                "priorityWeight": 3,
                "prioritySource": "mapped",
                "orderType": "cold",
                "requiredVehicleType": "",
            },
            {
                "id": "O-002",
                "code": "C002",
                "name": "\u666e\u901a\u5e97",
                "address": "\u957f\u5b81\u533a 2 \u53f7",
                "date": "2026-05-01",
                "lon": 121.3609523,
                "lat": 31.2132668,
                "count": 54,
                "volume": 2.052,
                "weight": 315,
                "serviceMin": 28,
                "twStart": "13:00",
                "twEnd": "17:30",
                "priority": "normal",
                "priorityWeight": 1,
                "prioritySource": "mapped",
                "orderType": "large",
                "requiredVehicleType": "",
            },
        ],
        "vehicles": [
            {
                "id": "V-001",
                "name": "\u6caaAB0001",
                "type": "EV-VAN",
                "availableDate": "",
                "maxVolume": 5,
                "maxWeight": 800,
                "start": "09:00",
                "end": "17:30",
                "fixedCost": 120,
                "perKmCost": 4.8,
                "perMinuteCost": 0.35,
                "perStopCost": 8,
                "emissionFactor": 0.12,
                "sourceVehicleId": "",
                "isVirtual": False,
                "enabled": True,
            },
            {
                "id": "V-002",
                "name": "\u6caaAB0002",
                "type": "EV-VAN",
                "availableDate": "2026-05-01",
                "maxVolume": 8,
                "maxWeight": 1200,
                "start": "18:00",
                "end": "02:00",
                "fixedCost": 140,
                "perKmCost": 5.2,
                "perMinuteCost": 0.4,
                "perStopCost": 9,
                "emissionFactor": 0.147,
                "sourceVehicleId": "",
                "isVirtual": False,
                "enabled": True,
            },
        ],
        "constraints": {
            "singleTrip": True,
            "maxWaitingMinutes": 90,
            "workStart": "09:00",
            "workEnd": "02:00",
            "maxOrders": 500,
            "maxSolveSeconds": 45,
            "allowUnassigned": True,
            "capacityScale": CONTRACT["capacity"]["volumeScale"],
            "weightScale": CONTRACT["capacity"]["weightScale"],
            "maxStops": 500,
            "maxRouteMinutes": 1020,
            "shiftExtensionMinutes": 0,
        },
        "assumptions": {
            "roadDistanceFactor": 1.35,
            "averageSpeedKmh": 28,
            "defaultServiceMin": 5,
            "costModelVersion": CONTRACT["models"]["costModelVersion"],
            "emissionModelVersion": CONTRACT["models"]["emissionModelVersion"],
            "priorityMappingVersion": CONTRACT["priorityMapping"]["version"],
            "missingVehicleDatePolicy": "blank-means-daily",
            "missingTimeWindowPolicy": CONTRACT["time"]["missingTimeWindowPolicy"],
            "overnightPolicy": CONTRACT["time"]["overnightPolicy"],
            "distanceModel": CONTRACT["distance"]["model"],
            "roadMetersRounding": CONTRACT["distance"]["roadMetersRounding"],
            "travelMinutesRounding": CONTRACT["distance"]["travelMinutesRounding"],
            "costMinuteBasis": CONTRACT["time"]["costMinuteBasis"],
            "defaultEmissionFactor": CONTRACT["models"]["defaultEmissionFactor"],
            "lowUtilizationThreshold": CONTRACT["utilization"]["lowRouteThresholdPercent"],
            "balancedWeightUsedVehicles": weights["usedVehicles"],
            "balancedWeightDistance": weights["estimatedRoadKm"],
            "balancedWeightCost": weights["totalCost"],
            "balancedWeightCarbon": weights["totalCO2"],
            "balancedWeightLatestEnd": weights["latestEnd"],
            "balancedWeightUtilization": weights["utilizationScore"],
        },
    }


def cases() -> list[dict]:
    base = base_scenario()
    result: list[dict] = []

    def add(case_id: str, mutate=None) -> None:
        scenario = copy.deepcopy(base)
        if mutate:
            mutate(scenario)
        result.append({"id": case_id, "scenario": scenario})

    add("normal_chinese")
    add("japanese_name", lambda value: value["orders"][0].update({"name": "\u718a\u672c\u914d\u9001\u30bb\u30f3\u30bf\u30fc"}))
    add("unicode_combining", lambda value: value["orders"][0].update({"name": "Cafe\u0301"}))
    add("cross_midnight", lambda value: value["orders"][0].update({"twStart": "23:00", "twEnd": "01:30"}))
    add("empty_available_date", lambda value: value["vehicles"][1].update({"availableDate": ""}))
    add("virtual_vehicle", lambda value: value["vehicles"][1].update({"id": "VIRTUAL-V-001-01", "sourceVehicleId": "V-001", "isVirtual": True, "availableDate": ""}))
    add("zero_values", lambda value: value["orders"][0].update({"count": 0, "volume": 0, "weight": 0, "serviceMin": 0}))
    add("decimal_rounding", lambda value: value["orders"][0].update({"lon": "121.35820755", "volume": "0.1655", "weight": "16.0004"}))
    add("orders_shuffled", lambda value: value["orders"].reverse())
    add("vehicles_shuffled", lambda value: value["vehicles"].reverse())
    return result


def main() -> None:
    request_options = {
        "objective": "distance",
        "timeLimitSeconds": 8,
        "engineRequested": "ortools",
        "searchConfiguration": {
            "firstSolutionStrategy": "parallel-cheapest-insertion",
            "localSearchMetaheuristic": "guided-local-search",
            "randomSeed": 13,
            "logSearch": False,
            "servicePolicy": "priority-score-then-assigned-count-then-business-objective",
        },
    }
    plan = {
        "routes": [{"routeId": "R-01", "vehicleId": "V-001", "orderIds": ["O-001", "O-002"]}],
        "unassignedOrderIds": [],
        "blockedOrderIds": [],
        "manualRevision": 0,
    }
    output_cases = []
    for row in cases():
        identity = scenario_identity(row["scenario"])
        request = request_identity(identity["inputHash"], request_options)
        plan_result = plan_identity(identity["inputHash"], plan)
        output_cases.append(
            {
                **row,
                "requestOptions": request_options,
                "plan": plan,
                "expected": {
                    "canonicalString": identity["inputBytes"].decode("utf-8"),
                    "contentHash": identity["contentHash"],
                    "inputHash": identity["inputHash"],
                    "requestHash": request["requestHash"],
                    "planHash": plan_result["planHash"],
                },
            }
        )
    payload = {
        "contractVersion": CONTRACT["contractVersion"],
        "canonicalVersion": CONTRACT["canonicalVersion"],
        "caseCount": len(output_cases),
        "cases": output_cases,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(OUTPUT)


if __name__ == "__main__":
    main()
