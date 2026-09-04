#!/usr/bin/env python3
"""Python side of the 30-case v1.3.1 canonical closure fixture."""

from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from optimizer.canonical_contract import (  # noqa: E402
    CanonicalError,
    canonical_date,
    canonical_text,
    canonical_time,
    import_date,
    import_time,
    plan_identity,
    request_identity,
    scenario_identity,
)

FIXTURE = json.loads((ROOT / "shared" / "canonical-hash-fixtures-v131.json").read_text(encoding="utf-8"))


def reverse_object_keys(value):
    if isinstance(value, list):
        return [reverse_object_keys(item) for item in value]
    if isinstance(value, dict):
        return {key: reverse_object_keys(child) for key, child in reversed(list(value.items()))}
    return value


class CanonicalClosureTests(unittest.TestCase):
    def test_30_cross_language_fixtures(self) -> None:
        self.assertEqual(FIXTURE["caseCount"], 30)
        for row in FIXTURE["cases"]:
            with self.subTest(row=row["id"]):
                try:
                    identity = scenario_identity(row["scenario"])
                    request = request_identity(identity["inputHash"], row["requestOptions"])
                    plan = plan_identity(identity["inputHash"], row["plan"])
                except CanonicalError as error:
                    self.assertEqual(error.code, row["expected"]["expectedErrorCode"])
                    continue
                self.assertIsNone(row["expected"]["expectedErrorCode"])
                self.assertEqual(identity["inputBytes"].hex(), row["expected"]["expectedCanonicalUtf8Hex"])
                self.assertEqual(identity["inputBytes"].decode("utf-8"), row["expected"]["expectedCanonicalText"])
                self.assertEqual(identity["contentHash"], row["expected"]["expectedContentHash"])
                self.assertEqual(identity["inputHash"], row["expected"]["expectedInputHash"])
                self.assertEqual(request["requestHash"], row["expected"]["expectedRequestHash"])
                self.assertEqual(plan["planHash"], row["expected"]["expectedPlanHash"])

    def test_property_style_order_stability(self) -> None:
        base = next(row for row in FIXTURE["cases"] if row["id"] == "22-request-options")
        expected = scenario_identity(base["scenario"])["inputHash"]
        for index in range(20):
            scenario = reverse_object_keys(copy.deepcopy(base["scenario"]))
            if index % 2:
                scenario["orders"].reverse()
            if index % 3:
                scenario["vehicles"].reverse()
            self.assertEqual(scenario_identity(scenario)["inputHash"], expected)

    def test_adapter_and_canonical_contract_are_separate(self) -> None:
        self.assertEqual(import_date("2026/5/1", "adapter.date"), "2026-05-01")
        self.assertEqual(import_time("1:02", "adapter.time"), "01:02")
        with self.assertRaises(CanonicalError):
            canonical_date("2026/5/1", "canonical.date")
        with self.assertRaises(CanonicalError):
            canonical_time("1:02", "canonical.time")
        with self.assertRaises(CanonicalError) as context:
            canonical_text(True, required=True, field="identifier")
        self.assertEqual(context.exception.code, "CANONICAL_TYPE_ERROR")


if __name__ == "__main__":
    unittest.main(verbosity=2)
