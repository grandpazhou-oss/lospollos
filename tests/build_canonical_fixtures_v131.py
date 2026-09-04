#!/usr/bin/env python3
"""Build the 30-case v1.3.1 cross-language canonical closure fixture."""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from optimizer.canonical_contract import CanonicalError, plan_identity, request_identity, scenario_identity  # noqa: E402
from tests.build_canonical_fixtures_v13 import base_scenario  # noqa: E402

OUTPUT = ROOT / "shared" / "canonical-hash-fixtures-v131.json"


def request_options(objective: str = "distance") -> dict[str, Any]:
    return {
        "objective": objective,
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


def set_order_ids(scenario: dict[str, Any], identifiers: list[str]) -> None:
    seed = scenario["orders"][0]
    scenario["orders"] = []
    for index, identifier in enumerate(identifiers):
        order = copy.deepcopy(seed)
        order.update({"id": identifier, "code": identifier, "name": f"Demo {index + 1}", "lon": str(121.1 + index * 0.001)})
        scenario["orders"].append(order)


def reverse_dicts(value: Any) -> Any:
    if isinstance(value, list):
        return [reverse_dicts(item) for item in value]
    if isinstance(value, dict):
        return {key: reverse_dicts(child) for key, child in reversed(list(value.items()))}
    return value


def build_specs() -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []

    def add(identifier: str, mutate: Callable[[dict[str, Any]], None] | None = None, *, objective: str = "distance", plan_reverse: bool = False) -> None:
        scenario = base_scenario()
        if mutate:
            mutate(scenario)
        specs.append({"id": identifier, "scenario": scenario, "requestOptions": request_options(objective), "planReverse": plan_reverse})

    add("01-ascii-case", lambda value: set_order_ids(value, ["A", "a", "Z", "z"]))
    add("02-punctuation", lambda value: set_order_ids(value, ["a-b", "a_b"]))
    add("03-chinese-id", lambda value: set_order_ids(value, ["上海店", "中文ID"]))
    add("04-japanese-id", lambda value: set_order_ids(value, ["日本語ID", "熊本店"]))
    add("05-accent-id", lambda value: set_order_ids(value, ["ä", "z"]))
    add("06-emoji-id", lambda value: set_order_ids(value, ["😀", "A"]))
    add("07-nfc-nfd", lambda value: value["orders"][0].update({"name": "Cafe\u0301"}))
    add("08-whitespace-newline", lambda value: value["orders"][0].update({"name": "  Line 1\r\nLine 2  "}))
    add("09-boolean-string", lambda value: value["vehicles"][0].update({"enabled": "true", "isVirtual": "false"}))
    add("10-invalid-boolean", lambda value: value["vehicles"][0].update({"enabled": "yes"}))
    add("11-strict-date", lambda value: (value.update({"planningDate": "0001-01-01"}), [order.update({"date": "0001-01-01"}) for order in value["orders"]]))
    add("12-invalid-leap-day", lambda value: (value.update({"planningDate": "2026-02-29"}), [order.update({"date": "2026-02-29"}) for order in value["orders"]]))
    add("13-strict-time", lambda value: value["orders"][0].update({"twStart": "01:02"}))
    add("14-invalid-hour", lambda value: value["orders"][0].update({"twStart": "24:00"}))
    add("15-negative-zero", lambda value: value["orders"][0].update({"volume": "-0.0", "weight": "-0"}))
    add("16-scientific-notation", lambda value: value["orders"][0].update({"volume": "1e-7", "weight": "1e-07"}))
    add("17-scale-rounding", lambda value: value["orders"][0].update({"volume": "0.1655", "lon": "121.35820755"}))
    add("18-duplicate-id", lambda value: value["orders"][1].update({"id": value["orders"][0]["id"]}))
    scenario = reverse_dicts(base_scenario())
    specs.append({"id": "19-object-key-order", "scenario": scenario, "requestOptions": request_options(), "planReverse": False})
    add("20-order-array-order", lambda value: value["orders"].reverse())
    add("21-vehicle-array-order", lambda value: value["vehicles"].reverse())
    add("22-request-options")
    add("23-objective-change", objective="cost")
    add("24-batch-metadata-exclusion", lambda value: value.update({"batchId": "BATCH-IGNORED", "uploadedAt": "2099-01-01T00:00:00Z"}))
    add("25-assumption-mutation", lambda value: value["assumptions"].update({"roadDistanceFactor": "1.4000"}))
    add("26-cost-mutation", lambda value: value["vehicles"][0].update({"fixedCost": "121"}))
    add("27-emission-mutation", lambda value: value["vehicles"][0].update({"emissionFactor": "0.121"}))
    add("28-coordinate-mutation", lambda value: value["orders"][0].update({"lon": "121.4"}))
    add("29-priority-mutation", lambda value: value["orders"][0].update({"priority": "urgent", "priorityWeight": 4, "prioritySource": "explicit"}))
    add("30-route-sequence-mutation", plan_reverse=True)
    return specs


def build_plan(scenario: dict[str, Any], reverse: bool) -> dict[str, Any]:
    order_ids = [str(order["id"]) for order in scenario.get("orders", [])]
    if reverse:
        order_ids.reverse()
    vehicle_id = str(scenario.get("vehicles", [{}])[0].get("id", "V-001"))
    return {
        "routes": [{"routeId": "R-01", "vehicleId": vehicle_id, "orderIds": order_ids}],
        "unassignedOrderIds": [],
        "blockedOrderIds": [],
        "manualRevision": 1 if reverse else 0,
    }


def main() -> None:
    cases = []
    for spec in build_specs():
        plan = build_plan(spec["scenario"], spec["planReverse"])
        expected = {
            "expectedCanonicalUtf8Hex": None,
            "expectedCanonicalText": None,
            "expectedContentHash": None,
            "expectedInputHash": None,
            "expectedRequestHash": None,
            "expectedPlanHash": None,
            "expectedErrorCode": None,
        }
        try:
            identity = scenario_identity(spec["scenario"])
            request = request_identity(identity["inputHash"], spec["requestOptions"])
            plan_result = plan_identity(identity["inputHash"], plan)
            expected.update({
                "expectedCanonicalUtf8Hex": identity["inputBytes"].hex(),
                "expectedCanonicalText": identity["inputBytes"].decode("utf-8"),
                "expectedContentHash": identity["contentHash"],
                "expectedInputHash": identity["inputHash"],
                "expectedRequestHash": request["requestHash"],
                "expectedPlanHash": plan_result["planHash"],
            })
        except CanonicalError as error:
            expected["expectedErrorCode"] = error.code
        cases.append({
            "id": spec["id"],
            "scenario": spec["scenario"],
            "requestOptions": spec["requestOptions"],
            "plan": plan,
            "expected": expected,
        })
    payload = {"contractVersion": "stct-planning-contract-v1.3.1", "caseCount": len(cases), "cases": cases}
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(OUTPUT)


if __name__ == "__main__":
    main()
