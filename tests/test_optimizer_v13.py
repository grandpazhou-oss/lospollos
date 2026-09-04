#!/usr/bin/env python3
"""Trust-gate and optimizer contract tests for v1.3."""

from __future__ import annotations

import copy
import json
import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from optimizer import ortools_service as service  # noqa: E402
from optimizer.canonical_contract import CONTRACT, CanonicalError, request_identity, scenario_identity  # noqa: E402


FIXTURE = json.loads((ROOT / "shared" / "canonical-hash-fixtures.json").read_text(encoding="utf-8"))


def request_for(case_index: int = 0, objective: str = "distance", seconds: int = 1) -> dict:
    scenario = copy.deepcopy(FIXTURE["cases"][case_index]["scenario"])
    identity = scenario_identity(scenario)
    search = {"firstSolutionStrategy": "parallel-cheapest-insertion", "localSearchMetaheuristic": "guided-local-search", "randomSeed": 13, "logSearch": False, "servicePolicy": "priority-score-then-assigned-count-then-business-objective"}
    request = request_identity(identity["inputHash"], {"objective": objective, "timeLimitSeconds": seconds, "engineRequested": "ortools", "searchConfiguration": search})
    return {
        "version": "v1.3-trust-gates",
        "contractVersion": CONTRACT["contractVersion"],
        "canonicalVersion": CONTRACT["canonicalVersion"],
        "requestId": "REQ-V13-TEST",
        "requestSequence": 1,
        "canonicalScenario": scenario,
        "claimedContentHash": identity["contentHash"],
        "claimedInputHash": identity["inputHash"],
        "claimedRequestHash": request["requestHash"],
        "objective": objective,
        "timeLimitSeconds": seconds,
        "engineRequested": "ortools",
        "searchConfiguration": search,
    }


def compact_scenario(orders: list[dict], max_volume: float = 2, max_weight: float = 10) -> dict:
    date = "2026-05-01"
    return {
        "planningMode": "SINGLE_DAY",
        "planningDate": date,
        "depot": {"id": "D1", "name": "Depot", "address": "A", "lon": 0, "lat": 0},
        "orders": [
            {
                "id": row["id"], "code": row["id"], "name": row["id"], "address": row["id"],
                "date": date, "lon": row.get("lon", 0.01), "lat": row.get("lat", 0),
                "count": 1, "volume": row.get("volume", 1), "weight": row.get("weight", 1),
                "serviceMin": 0, "twStart": row.get("twStart", "09:00"), "twEnd": row.get("twEnd", "18:00"),
                "priority": row.get("priority", "normal"), "priorityWeight": row.get("priorityWeight", 1),
                "prioritySource": "mapped", "orderType": "", "requiredVehicleType": "",
            }
            for row in orders
        ],
        "vehicles": [{
            "id": "V1", "name": "Vehicle", "type": "van", "availableDate": date,
            "maxVolume": max_volume, "maxWeight": max_weight, "start": "09:00", "end": "18:00",
            "fixedCost": 100, "perKmCost": 2, "perMinuteCost": 0.5, "perStopCost": 5,
            "emissionFactor": 0.2, "sourceVehicleId": "V1", "isVirtual": False, "enabled": True,
        }],
        "constraints": {
            "singleTrip": True, "maxWaitingMinutes": 90, "workStart": "09:00", "workEnd": "18:00",
            "maxOrders": 500, "maxSolveSeconds": 45, "allowUnassigned": True,
            "capacityScale": 1000, "weightScale": 1000, "maxStops": 500,
            "maxRouteMinutes": 540, "shiftExtensionMinutes": 0,
        },
        "assumptions": {
            "roadDistanceFactor": 1, "averageSpeedKmh": 60, "defaultServiceMin": 0,
            "costModelVersion": "stct-cost-v1", "emissionModelVersion": "stct-emission-v1",
            "priorityMappingVersion": "priority-map-v1", "missingVehicleDatePolicy": "blank-means-daily",
            "missingTimeWindowPolicy": "reject-order", "overnightPolicy": "end-before-start-means-next-day",
            "distanceModel": "haversine-road-factor", "roadMetersRounding": "half-up",
            "travelMinutesRounding": "ceil", "costMinuteBasis": "driving", "defaultEmissionFactor": 0.192,
            "lowUtilizationThreshold": 35, "balancedWeightUsedVehicles": 20,
            "balancedWeightDistance": 20, "balancedWeightCost": 20, "balancedWeightCarbon": 15,
            "balancedWeightLatestEnd": 15, "balancedWeightUtilization": 10,
        },
    }


def request_for_scenario(scenario: dict, objective: str = "service", seconds: int = 1) -> dict:
    identity = scenario_identity(scenario)
    search = {"firstSolutionStrategy": "parallel-cheapest-insertion", "localSearchMetaheuristic": "guided-local-search", "randomSeed": 13, "logSearch": False, "servicePolicy": "priority-score-then-assigned-count-then-business-objective"}
    request = request_identity(identity["inputHash"], {"objective": objective, "timeLimitSeconds": seconds, "engineRequested": "ortools", "searchConfiguration": search})
    return {
        "version": "v1.3-trust-gates", "contractVersion": CONTRACT["contractVersion"],
        "canonicalVersion": CONTRACT["canonicalVersion"], "requestId": "REQ-V13-PRIORITY", "requestSequence": 1,
        "canonicalScenario": scenario, "claimedContentHash": identity["contentHash"],
        "claimedInputHash": identity["inputHash"], "claimedRequestHash": request["requestHash"],
        "objective": objective, "timeLimitSeconds": seconds, "engineRequested": "ortools", "searchConfiguration": search,
    }


class ServerIdentityTests(unittest.TestCase):
    def assert_code(self, payload: dict, expected: str) -> None:
        with self.assertRaises(CanonicalError) as context:
            service.normalize_payload(payload)
        self.assertEqual(context.exception.code, expected)

    def test_valid_request_is_recomputed_and_verified(self) -> None:
        normalized = service.normalize_payload(request_for())
        self.assertTrue(normalized["serverHashVerified"])
        self.assertTrue(normalized["contentHash"].startswith("sha256:"))
        self.assertTrue(normalized["inputHash"].startswith("sha256:"))
        self.assertTrue(normalized["requestHash"].startswith("sha256:"))

    def test_fake_content_hash_is_rejected(self) -> None:
        payload = request_for()
        payload["claimedContentHash"] = "sha256:" + "0" * 64
        self.assert_code(payload, "CONTENT_HASH_MISMATCH")

    def test_fake_input_hash_is_rejected(self) -> None:
        payload = request_for()
        payload["claimedInputHash"] = "sha256:" + "0" * 64
        self.assert_code(payload, "INPUT_HASH_MISMATCH")

    def test_fake_request_hash_is_rejected(self) -> None:
        payload = request_for()
        payload["claimedRequestHash"] = "sha256:" + "0" * 64
        self.assert_code(payload, "REQUEST_HASH_MISMATCH")

    def test_contract_mismatch_is_rejected(self) -> None:
        payload = request_for()
        payload["contractVersion"] = "stct-planning-contract-v0"
        self.assert_code(payload, "CONTRACT_VERSION_MISMATCH")

    def test_content_mutation_with_old_hash_is_rejected(self) -> None:
        payload = request_for()
        payload["canonicalScenario"]["orders"][0]["lon"] = 130
        payload["canonicalScenario"]["orders"][0]["volume"] = 1000
        self.assert_code(payload, "CONTENT_HASH_MISMATCH")

    def test_duplicate_order_is_rejected(self) -> None:
        payload = request_for()
        payload["canonicalScenario"]["orders"].append(copy.deepcopy(payload["canonicalScenario"]["orders"][0]))
        self.assert_code(payload, "DUPLICATE_ORDER_ID")

    def test_non_finite_value_is_rejected(self) -> None:
        payload = request_for()
        payload["canonicalScenario"]["orders"][0]["volume"] = float("inf")
        self.assert_code(payload, "INVALID_CANONICAL_NUMBER")

    def test_objective_changes_request_hash_not_input_hash(self) -> None:
        distance = request_for(objective="distance")
        cost = request_for(objective="cost")
        self.assertEqual(distance["claimedInputHash"], cost["claimedInputHash"])
        self.assertNotEqual(distance["claimedRequestHash"], cost["claimedRequestHash"])


@unittest.skipIf(service.pywrapcp is None, "SKIPPED_DEPENDENCY: OR-Tools is unavailable")
class RealOptimizerIdentityTests(unittest.TestCase):
    def test_plan_response_has_server_identity(self) -> None:
        plan = service.solve(request_for())
        self.assertTrue(plan["serverHashVerified"])
        self.assertTrue(plan["contentHash"].startswith("sha256:"))
        self.assertTrue(plan["inputHash"].startswith("sha256:"))
        self.assertTrue(plan["requestHash"].startswith("sha256:"))
        self.assertTrue(plan["planHash"].startswith("sha256:"))
        self.assertEqual(plan["meta"]["actualEngineVersion"], service.ortools_package.__version__)


class LexicographicBoundsTests(unittest.TestCase):
    def test_dynamic_bounds_prove_both_dominance_layers(self) -> None:
        proof = service.lexicographic_bounds([3, 2, 1], 2, 1_000, [200, 200], 10, 600)
        self.assertEqual(proof["lexicographicMethod"], "proven-big-m")
        self.assertTrue(proof["proof"]["assignedDominatesBusiness"])
        self.assertTrue(proof["proof"]["priorityDominatesAssignedAndBusiness"])
        self.assertTrue(proof["int64Safe"])

    def test_500_order_adversarial_bound_is_int64_safe(self) -> None:
        proof = service.lexicographic_bounds([100] * 500, 100, 250_000, [10_000] * 100, 100, 2_880)
        self.assertTrue(proof["int64Safe"])
        self.assertGreater(proof["priorityScale"], 500 * proof["assignedScale"] + proof["maxBusinessObjectiveBound"])


@unittest.skipIf(service.pywrapcp is None, "SKIPPED_DEPENDENCY: OR-Tools is unavailable")
class RealPrioritySolverTests(unittest.TestCase):
    def assigned_ids(self, plan: dict) -> set[str]:
        return {order_id for route in plan["routes"] for order_id in route.get("orderIds", [])}

    def test_priority_capacity_conflict(self) -> None:
        scenario = compact_scenario([
            {"id": "HIGH", "priority": "high", "priorityWeight": 3, "volume": 2, "lon": 0.02},
            {"id": "LOW-1", "priorityWeight": 1, "volume": 1, "lon": 0.001},
            {"id": "LOW-2", "priorityWeight": 1, "volume": 1, "lon": 0.002},
        ])
        for _ in range(3):
            plan = service.solve(request_for_scenario(scenario))
            self.assertEqual(self.assigned_ids(plan), {"HIGH"})
            self.assertEqual(plan["metrics"]["servicePriorityScore"], 3)
            self.assertEqual(plan["meta"]["objectiveDefinition"]["lexicographicMethod"], "proven-big-m")

    def test_priority_time_window_conflict_keeps_hard_feasibility(self) -> None:
        scenario = compact_scenario([
            {"id": "HIGH-IMPOSSIBLE", "priority": "high", "priorityWeight": 3, "volume": 1, "twStart": "12:00", "twEnd": "12:10"},
            {"id": "LOW-FEASIBLE", "priorityWeight": 1, "volume": 1, "twStart": "09:00", "twEnd": "10:00", "lon": 0.002},
        ], max_volume=1)
        plan = service.solve(request_for_scenario(scenario))
        self.assertEqual(self.assigned_ids(plan), {"LOW-FEASIBLE"})

    def test_same_priority_score_prefers_more_orders(self) -> None:
        scenario = compact_scenario([
            {"id": "ONE-MEDIUM", "priority": "medium", "priorityWeight": 2, "volume": 2, "lon": 0.02},
            {"id": "NORMAL-1", "priorityWeight": 1, "volume": 1, "lon": 0.001},
            {"id": "NORMAL-2", "priorityWeight": 1, "volume": 1, "lon": 0.002},
        ])
        plan = service.solve(request_for_scenario(scenario))
        self.assertEqual(self.assigned_ids(plan), {"NORMAL-1", "NORMAL-2"})
        self.assertEqual(plan["metrics"]["assigned"], 2)

    def test_same_service_distance_objective_prefers_near_order(self) -> None:
        scenario = compact_scenario([
            {"id": "NEAR", "priorityWeight": 1, "volume": 1, "lon": 0.001},
            {"id": "FAR", "priorityWeight": 1, "volume": 1, "lon": 0.05},
        ], max_volume=1)
        plan = service.solve(request_for_scenario(scenario, objective="distance"))
        self.assertEqual(self.assigned_ids(plan), {"NEAR"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
