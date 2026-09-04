#!/usr/bin/env python3
"""Deterministic contract and infeasibility tests for the local v1.2 optimizer."""

from __future__ import annotations

import copy
import importlib.util
import json
import pathlib
import unittest
from typing import Optional


ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE_PATH = ROOT / "tests" / "fixtures" / "optimizer-fixtures.json"
SPEC = importlib.util.spec_from_file_location("stct_optimizer", ROOT / "optimizer" / "ortools_service.py")
OPTIMIZER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(OPTIMIZER)


def load_fixture(name: str) -> dict:
    fixture_set = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    return {
        **copy.deepcopy(fixture_set["defaults"]),
        **copy.deepcopy(fixture_set["fixtures"][name]),
    }


def payload_for(name: str, goal: Optional[str] = None, time_limit: int = 1) -> tuple[dict, dict]:
    fixture = load_fixture(name)
    orders = fixture["orders"]
    for order in orders:
        order.setdefault("_scenarioOrderKey", order["id"])
    vehicles = fixture["vehicles"]
    input_hash = f"fixture-{name}"
    scenario_id = f"SCN-{name.upper().replace('_', '-')}"
    scenario = {
        "scenarioId": scenario_id,
        "planningDate": "2026-01-01",
        "warehouseId": fixture["depot"]["id"],
        "orderIds": [order["_scenarioOrderKey"] for order in orders],
        "vehicleIds": [vehicle["vehicleId"] for vehicle in vehicles],
        "constraintsSnapshot": fixture["constraints"],
        "assumptionsSnapshot": {"lowUtilizationThreshold": 35},
        "inputHash": input_hash,
    }
    request = {
        "version": "v1.2",
        "requestId": f"REQ-{name}",
        "scenarioId": scenario_id,
        "inputHash": input_hash,
        "requestedGoal": goal or fixture.get("expect", {}).get("goal") or "distance",
        "timeLimitSeconds": time_limit,
        "date": "2026-01-01",
        "limit": "ALL",
        "scenario": scenario,
        "raw": {
            "orders": orders,
            "vehicles": vehicles,
            "depot": fixture["depot"],
            "constraints": fixture["constraints"],
        },
    }
    return request, fixture


def reason_codes(plan: dict) -> set[str]:
    return {
        row.get("reasonCode")
        for row in [*(plan.get("blockedOrders") or []), *(plan.get("unassignedOrders") or [])]
    }


class OptimizerContractTests(unittest.TestCase):
    def test_request_and_response_contract(self) -> None:
        request, _ = payload_for("distance_distinction")
        plan = OPTIMIZER.solve(request)
        self.assertEqual(plan["scenarioId"], request["scenarioId"])
        self.assertEqual(plan["inputHash"], request["inputHash"])
        self.assertEqual(plan["engine"], "OR-Tools")
        self.assertEqual(plan["meta"]["version"], "v1.2")
        self.assertEqual(plan["meta"]["requestId"], request["requestId"])
        self.assertEqual(plan["meta"]["solveStats"]["status"], "BEST_FOUND")
        self.assertFalse(plan["meta"]["solveStats"]["globalOptimalityProven"])
        self.assertEqual(plan["meta"]["objectiveDefinition"]["servicePriority"], "lexicographic")
        self.assertTrue(plan["meta"]["verificationPolicy"]["required"])
        self.assertTrue(plan["conservation"]["balanced"])
        for key in ("routes", "routeGeoJson", "stopGeoJson", "metrics", "fingerprint"):
            self.assertIn(key, plan)

    def test_unknown_goal_is_rejected(self) -> None:
        request, _ = payload_for("distance_distinction", goal="not-a-goal")
        with self.assertRaisesRegex(ValueError, "Unsupported optimization goal"):
            OPTIMIZER.normalize_payload(request)

    def test_time_limit_is_capped_server_side(self) -> None:
        request, _ = payload_for("distance_distinction", time_limit=999)
        normalized = OPTIMIZER.normalize_payload(request)
        self.assertEqual(normalized["timeLimitSeconds"], OPTIMIZER.MAX_SOLVE_SECONDS)

    def test_exact_scenario_order_set_is_enforced(self) -> None:
        request, _ = payload_for("distance_distinction")
        request["scenario"]["orderIds"].reverse()
        with self.assertRaisesRegex(ValueError, "exact request order set"):
            OPTIMIZER.normalize_payload(request)

    def test_scenario_input_hash_is_enforced(self) -> None:
        request, _ = payload_for("distance_distinction")
        request["inputHash"] = "different"
        with self.assertRaisesRegex(ValueError, "inputHash"):
            OPTIMIZER.normalize_payload(request)


class OptimizerFixtureTests(unittest.TestCase):
    def assert_expectations(self, name: str) -> dict:
        request, fixture = payload_for(name)
        plan = OPTIMIZER.solve(request)
        expect = fixture["expect"]
        metrics = plan["metrics"]
        for key in ("assigned", "unassigned", "blocked", "usedVehicles"):
            if key in expect:
                self.assertEqual(metrics.get(key, 0), expect[key], f"{name}: {key}")
        if "maxDistanceKm" in expect:
            self.assertLess(metrics["estimatedRoadKm"], expect["maxDistanceKm"])
        if "vehicleId" in expect:
            self.assertEqual(plan["routes"][0]["vehicleId"], expect["vehicleId"])
        if "assignedOrderId" in expect:
            assigned_ids = {feature["properties"]["orderId"] for feature in plan["stopGeoJson"]["features"]}
            self.assertIn(expect["assignedOrderId"], assigned_ids)
        if "reasonCode" in expect:
            self.assertIn(expect["reasonCode"], reason_codes(plan))
        if "conservation" in expect:
            self.assertEqual(plan["conservation"]["balanced"], expect["conservation"])
        self.assertTrue(plan["conservation"]["balanced"], name)
        self.assertEqual(
            plan["conservation"]["input"],
            plan["conservation"]["assigned"] + plan["conservation"]["unassigned"] + plan["conservation"]["blocked"],
        )
        return plan

    def test_distance_distinction(self) -> None:
        self.assert_expectations("distance_distinction")

    def test_cost_distinction(self) -> None:
        self.assert_expectations("cost_distinction")

    def test_carbon_distinction(self) -> None:
        self.assert_expectations("carbon_distinction")

    def test_one_vehicle_boundary(self) -> None:
        self.assert_expectations("one_vehicle_boundary")

    def test_two_vehicle_boundary(self) -> None:
        self.assert_expectations("two_vehicle_boundary")

    def test_time_window_conflict(self) -> None:
        self.assert_expectations("time_window_conflict")

    def test_single_order_over_capacity(self) -> None:
        self.assert_expectations("single_order_over_capacity")

    def test_drop_penalty_preserves_higher_priority_order(self) -> None:
        self.assert_expectations("drop_penalty")

    def test_duplicate_and_conservation(self) -> None:
        self.assert_expectations("duplicate_and_conservation")

    def test_no_vehicle_available_reason(self) -> None:
        request, _ = payload_for("distance_distinction")
        request["raw"]["vehicles"] = []
        request["scenario"]["vehicleIds"] = []
        plan = OPTIMIZER.solve(request)
        self.assertEqual(plan["metrics"]["blocked"], 2)
        self.assertEqual(reason_codes(plan), {"NO_VEHICLE_AVAILABLE_ON_DATE"})

    def test_missing_coordinate_and_invalid_time_are_distinct(self) -> None:
        request, _ = payload_for("distance_distinction")
        request["raw"]["orders"][0]["lon"] = ""
        request["raw"]["orders"][1]["twEnd"] = "25:90"
        plan = OPTIMIZER.solve(request)
        self.assertEqual(reason_codes(plan), {"MISSING_COORDINATE", "INVALID_TIME_WINDOW"})
        self.assertTrue(plan["conservation"]["balanced"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
