#!/usr/bin/env python3
"""Original optimizer business fixtures through the current canonical contract."""

from __future__ import annotations

import copy
import importlib.util
import json
import pathlib
import sys
import unittest
from typing import Optional


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
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


def scenario_for(fixture: dict) -> dict:
    # Keep the original coordinates, demand, capacities, costs, emissions,
    # windows and priority values; fill only fields required by the envelope.
    template = json.loads((ROOT / "shared" / "canonical-hash-fixtures.json").read_text(encoding="utf-8"))["cases"][0]["scenario"]
    scenario = {
        "planningMode": "SINGLE_DAY", "planningDate": "2026-01-01",
        "depot": {"address": "", **fixture["depot"]},
        "orders": [{
            "name": "", "address": "", "count": 1,
            "serviceMin": fixture["constraints"]["defaultServiceMinutes"],
            "priority": "normal", "priorityWeight": 1,
            "prioritySource": "fixture", "orderType": "", "requiredVehicleType": "",
            **row,
        } for row in fixture["orders"]],
        "vehicles": [{
            **template["vehicles"][0], "name": "", "type": "",
            "availableDate": "", "emissionFactor": OPTIMIZER.CONTRACT["models"]["defaultEmissionFactor"],
            "fixedCost": OPTIMIZER.CONTRACT["models"]["defaultFixedCost"],
            "perKmCost": OPTIMIZER.CONTRACT["models"]["defaultPerKmCost"],
            "perMinuteCost": OPTIMIZER.CONTRACT["models"]["defaultPerMinuteCost"],
            "perStopCost": OPTIMIZER.CONTRACT["models"]["defaultPerStopCost"],
            **row, "id": row["vehicleId"],
        } for row in fixture["vehicles"]],
        "constraints": {**template["constraints"], **fixture["constraints"]},
        "assumptions": {
            **template["assumptions"],
            "roadDistanceFactor": fixture["constraints"]["roadDistanceFactor"],
            "averageSpeedKmh": fixture["constraints"]["averageSpeedKmh"],
            "defaultServiceMin": fixture["constraints"]["defaultServiceMinutes"],
        },
    }
    return scenario


def envelope_for(scenario: dict, name: str, goal: str = "distance", time_limit: int = 1) -> dict:
    identity = OPTIMIZER.scenario_identity(scenario)
    options = {"objective": goal, "timeLimitSeconds": time_limit, "engineRequested": "ortools", "searchConfiguration": {}}
    request = OPTIMIZER.request_identity(identity["inputHash"], options)
    return {
        "contractVersion": OPTIMIZER.CONTRACT["contractVersion"],
        "canonicalScenario": identity["scenario"],
        "claimedContentHash": identity["contentHash"],
        "claimedInputHash": identity["inputHash"],
        "claimedRequestHash": request["requestHash"],
        "requestId": f"REQ-{name}", **options,
    }


def payload_for(name: str, goal: Optional[str] = None, time_limit: int = 1) -> tuple[dict, dict]:
    fixture = load_fixture(name)
    return envelope_for(scenario_for(fixture), name, goal or fixture.get("expect", {}).get("goal") or "distance", time_limit), fixture


def reason_codes(plan: dict) -> set[str]:
    return {
        row.get("reasonCode")
        for row in [*(plan.get("blockedOrders") or []), *(plan.get("unassignedOrders") or [])]
    }


class OptimizerContractTests(unittest.TestCase):
    def test_request_and_response_contract(self) -> None:
        request, _ = payload_for("distance_distinction")
        plan = OPTIMIZER.solve(request)
        self.assertEqual(plan["scenarioId"], f"SCN-{request['claimedInputHash'].split(':', 1)[1][:16].upper()}")
        self.assertEqual(plan["inputHash"], request["claimedInputHash"])
        self.assertEqual(plan["requestHash"], request["claimedRequestHash"])
        self.assertEqual(plan["contentHash"], request["claimedContentHash"])
        self.assertTrue(plan["serverHashVerified"])
        self.assertEqual(plan["contractVersion"], OPTIMIZER.CONTRACT["contractVersion"])
        self.assertEqual(plan["engine"], "OR-Tools")
        self.assertEqual(plan["meta"]["version"], OPTIMIZER.CONTRACT["appVersion"])
        self.assertEqual(plan["meta"]["requestId"], request["requestId"])
        self.assertEqual(plan["meta"]["solveStats"]["status"], "BEST_FOUND")
        self.assertFalse(plan["meta"]["solveStats"]["globalOptimalityProven"])
        self.assertEqual(plan["meta"]["objectiveDefinition"]["servicePriority"], "lexicographic-service-first")
        self.assertTrue(plan["meta"]["verificationPolicy"]["required"])
        self.assertTrue(plan["conservation"]["balanced"])
        for key in ("routes", "routeGeoJson", "stopGeoJson", "metrics", "fingerprint"):
            self.assertIn(key, plan)

    def test_unknown_goal_is_rejected(self) -> None:
        request, _ = payload_for("distance_distinction")
        request["objective"] = "not-a-goal"
        with self.assertRaisesRegex(ValueError, "Unsupported optimization objective"):
            OPTIMIZER.normalize_payload(request)

    def test_time_limit_is_bounded_server_side(self) -> None:
        request, _ = payload_for("distance_distinction")
        request["timeLimitSeconds"] = 999
        with self.assertRaisesRegex(ValueError, "outside the server limit"):
            OPTIMIZER.normalize_payload(request)

    def test_exact_scenario_order_set_is_enforced(self) -> None:
        request, _ = payload_for("distance_distinction")
        request["canonicalScenario"]["orders"].pop()
        with self.assertRaises(OPTIMIZER.CanonicalError) as context:
            OPTIMIZER.normalize_payload(request)
        self.assertEqual(context.exception.code, "CONTENT_HASH_MISMATCH")

    def test_order_permutation_preserves_canonical_identity(self) -> None:
        request, _ = payload_for("distance_distinction")
        request["canonicalScenario"]["orders"].reverse()
        self.assertEqual(OPTIMIZER.normalize_payload(request)["inputHash"], request["claimedInputHash"])

    def test_scenario_input_hash_is_enforced(self) -> None:
        request, _ = payload_for("distance_distinction")
        request["claimedInputHash"] = "different"
        with self.assertRaises(OPTIMIZER.CanonicalError) as context:
            OPTIMIZER.normalize_payload(request)
        self.assertEqual(context.exception.code, "INPUT_HASH_MISMATCH")

    def test_request_hash_is_enforced(self) -> None:
        request, _ = payload_for("distance_distinction")
        request["claimedRequestHash"] = "different"
        with self.assertRaises(OPTIMIZER.CanonicalError) as context:
            OPTIMIZER.normalize_payload(request)
        self.assertEqual(context.exception.code, "REQUEST_HASH_MISMATCH")


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
        fixture = load_fixture("duplicate_and_conservation")
        request, _ = payload_for("distance_distinction")
        request["canonicalScenario"] = scenario_for(fixture)
        with self.assertRaises(OPTIMIZER.CanonicalError) as context:
            OPTIMIZER.solve(request)
        self.assertEqual(context.exception.code, "DUPLICATE_ORDER_ID")
        # The whole invalid request is rejected. The same valid row still solves
        # with conservation after removing the duplicate input record.
        fixture["orders"] = fixture["orders"][:1]
        plan = OPTIMIZER.solve(envelope_for(scenario_for(fixture), "duplicate-valid-row"))
        self.assertEqual(plan["metrics"]["assigned"], 1)
        self.assertEqual(plan["conservation"], {"input": 1, "assigned": 1, "unassigned": 0, "blocked": 0, "balanced": True})

    def test_no_vehicle_available_reason(self) -> None:
        request, _ = payload_for("distance_distinction")
        request["canonicalScenario"]["vehicles"] = []
        request = envelope_for(request["canonicalScenario"], "no-vehicle")
        plan = OPTIMIZER.solve(request)
        self.assertEqual(plan["metrics"]["blocked"], 2)
        self.assertEqual(reason_codes(plan), {"NO_VEHICLE_AVAILABLE_ON_DATE"})

    def test_missing_coordinate_and_invalid_time_are_distinct(self) -> None:
        request, _ = payload_for("distance_distinction")
        request["canonicalScenario"]["orders"][0]["lon"] = ""
        with self.assertRaises(OPTIMIZER.CanonicalError) as coordinate_error:
            OPTIMIZER.solve(request)
        self.assertEqual(coordinate_error.exception.code, "INVALID_CANONICAL_NUMBER")
        self.assertEqual(coordinate_error.exception.details["field"], "order.lon")
        request, _ = payload_for("distance_distinction")
        request["canonicalScenario"]["orders"][1]["twEnd"] = "25:90"
        with self.assertRaises(OPTIMIZER.CanonicalError) as time_error:
            OPTIMIZER.solve(request)
        self.assertEqual(time_error.exception.code, "CANONICALIZATION_ERROR")
        self.assertEqual(time_error.exception.details["field"], "order.twEnd")


if __name__ == "__main__":
    unittest.main(verbosity=2)
