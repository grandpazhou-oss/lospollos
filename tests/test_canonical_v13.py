#!/usr/bin/env python3
"""Canonical v1.3 Python conformance and identity tests."""

from __future__ import annotations

import copy
import json
import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from optimizer.canonical_contract import (  # noqa: E402
    CONTRACT,
    CanonicalError,
    plan_identity,
    request_identity,
    scenario_identity,
)


FIXTURE = json.loads((ROOT / "shared" / "canonical-hash-fixtures.json").read_text(encoding="utf-8"))


class CanonicalFixtureTests(unittest.TestCase):
    def test_all_cross_language_fixture_expectations(self) -> None:
        self.assertEqual(FIXTURE["caseCount"], 10)
        for row in FIXTURE["cases"]:
            with self.subTest(case=row["id"]):
                actual = scenario_identity(row["scenario"])
                request = request_identity(actual["inputHash"], row["requestOptions"])
                plan = plan_identity(actual["inputHash"], row["plan"])
                self.assertEqual(actual["inputBytes"].decode("utf-8"), row["expected"]["canonicalString"])
                self.assertEqual(actual["contentHash"], row["expected"]["contentHash"])
                self.assertEqual(actual["inputHash"], row["expected"]["inputHash"])
                self.assertEqual(request["requestHash"], row["expected"]["requestHash"])
                self.assertEqual(plan["planHash"], row["expected"]["planHash"])

    def test_order_and_vehicle_order_do_not_change_hash(self) -> None:
        base = scenario_identity(FIXTURE["cases"][0]["scenario"])
        shuffled = copy.deepcopy(FIXTURE["cases"][0]["scenario"])
        shuffled["orders"].reverse()
        shuffled["vehicles"].reverse()
        actual = scenario_identity(shuffled)
        self.assertEqual(actual["contentHash"], base["contentHash"])
        self.assertEqual(actual["inputHash"], base["inputHash"])

    def test_batch_metadata_does_not_change_hash(self) -> None:
        source = copy.deepcopy(FIXTURE["cases"][0]["scenario"])
        base = scenario_identity(source)
        source.update({"batchId": "BATCH-B", "uploadedAt": "2099-01-01T00:00:00Z", "language": "en"})
        actual = scenario_identity(source)
        self.assertEqual(actual["contentHash"], base["contentHash"])
        self.assertEqual(actual["inputHash"], base["inputHash"])

    def test_content_mutation_changes_hash(self) -> None:
        source = copy.deepcopy(FIXTURE["cases"][0]["scenario"])
        base = scenario_identity(source)
        source["orders"][0]["lon"] = 121.5
        actual = scenario_identity(source)
        self.assertNotEqual(actual["contentHash"], base["contentHash"])
        self.assertNotEqual(actual["inputHash"], base["inputHash"])

    def test_assumption_mutation_only_changes_input_hash(self) -> None:
        source = copy.deepcopy(FIXTURE["cases"][0]["scenario"])
        base = scenario_identity(source)
        source["assumptions"]["roadDistanceFactor"] = 1.4
        actual = scenario_identity(source)
        self.assertEqual(actual["contentHash"], base["contentHash"])
        self.assertNotEqual(actual["inputHash"], base["inputHash"])

    def test_objective_and_time_only_change_request_hash(self) -> None:
        base = scenario_identity(FIXTURE["cases"][0]["scenario"])
        first = request_identity(base["inputHash"], {"objective": "distance", "timeLimitSeconds": 8, "engineRequested": "ortools", "searchConfiguration": {}})
        second = request_identity(base["inputHash"], {"objective": "cost", "timeLimitSeconds": 8, "engineRequested": "ortools", "searchConfiguration": {}})
        third = request_identity(base["inputHash"], {"objective": "distance", "timeLimitSeconds": 9, "engineRequested": "ortools", "searchConfiguration": {}})
        self.assertNotEqual(first["requestHash"], second["requestHash"])
        self.assertNotEqual(first["requestHash"], third["requestHash"])
        self.assertEqual(first["envelope"]["inputHash"], second["envelope"]["inputHash"])

    def test_plan_hash_tracks_structure_not_reported_metrics(self) -> None:
        base = scenario_identity(FIXTURE["cases"][0]["scenario"])
        plan = {"routes": [{"routeId": "R1", "vehicleId": "V-001", "orderIds": ["O-001", "O-002"]}], "unassignedOrderIds": [], "blockedOrderIds": [], "manualRevision": 0}
        original = plan_identity(base["inputHash"], plan)
        changed = copy.deepcopy(plan)
        changed["routes"][0]["orderIds"].reverse()
        changed["manualRevision"] = 1
        self.assertNotEqual(plan_identity(base["inputHash"], changed)["planHash"], original["planHash"])
        reported = copy.deepcopy(plan)
        reported["reportedMetrics"] = {"totalCost": 999999}
        self.assertEqual(plan_identity(base["inputHash"], reported)["planHash"], original["planHash"])
        self.assertEqual(plan_identity(base["inputHash"], plan)["planHash"], original["planHash"])

    def test_duplicate_and_invalid_values_are_rejected(self) -> None:
        duplicate = copy.deepcopy(FIXTURE["cases"][0]["scenario"])
        duplicate["orders"].append(copy.deepcopy(duplicate["orders"][0]))
        with self.assertRaises(CanonicalError) as duplicate_error:
            scenario_identity(duplicate)
        self.assertEqual(duplicate_error.exception.code, "DUPLICATE_ORDER_ID")

        invalid = copy.deepcopy(FIXTURE["cases"][0]["scenario"])
        invalid["orders"][0]["volume"] = float("nan")
        with self.assertRaises(CanonicalError) as numeric_error:
            scenario_identity(invalid)
        self.assertEqual(numeric_error.exception.code, "INVALID_CANONICAL_NUMBER")

    def test_single_day_rejects_multiple_dates(self) -> None:
        source = copy.deepcopy(FIXTURE["cases"][0]["scenario"])
        source["orders"][1]["date"] = "2026-05-02"
        with self.assertRaises(CanonicalError) as context:
            scenario_identity(source)
        self.assertEqual(context.exception.code, "MULTIPLE_ORDER_DATES_IN_SINGLE_DAY_SCENARIO")

    def test_negative_zero_is_normalized(self) -> None:
        source = copy.deepcopy(FIXTURE["cases"][0]["scenario"])
        source["orders"][0]["volume"] = "-0"
        negative = scenario_identity(source)
        source["orders"][0]["volume"] = "0"
        zero = scenario_identity(source)
        self.assertEqual(negative["inputHash"], zero["inputHash"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
