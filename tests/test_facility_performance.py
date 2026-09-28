#!/usr/bin/env python3
"""Measured synthetic workloads for Facility MVP-1; not an SLA benchmark."""

from __future__ import annotations

import json
import math
import os
import platform
import sys
import time

import ortools
from ortools.sat.python import cp_model

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from optimizer.facility_mvp1 import solve_facility  # noqa: E402


def request(demand_count: int, site_count: int, counts: list[int], time_limit: int) -> dict:
    sites = []
    demands = []
    rows = []
    for j in range(site_count):
        sites.append({
            "siteId": f"S{j + 1:03d}",
            "status": "CANDIDATE",
            "fixedCost": 5000 + j * 11,
            "handlingCostPerUnit": 0.08 + (j % 4) * 0.01,
            "capacity": {"quantity": math.ceil(demand_count / min(counts)) * 1.6},
            "capabilities": ["STANDARD"],
        })
    for i in range(demand_count):
        demands.append({
            "demandId": f"D{i + 1:04d}",
            "demand": {"quantity": 1, "weight": 0, "volume": 0},
            "requiredCapabilities": ["STANDARD"],
        })
        home = i % site_count
        for j in range(site_count):
            ring = min(abs(j - home), site_count - abs(j - home))
            rows.append({"siteId": f"S{j + 1:03d}", "demandId": f"D{i + 1:04d}", "distanceMeters": 2500 + ring * 900 + (i % 17) * 13})
    return {
        "schemaVersion": "stct-facility-solve-request-v1.9-mvp1",
        "requestId": f"PERF-{demand_count}-{site_count}",
        "studyHash": f"synthetic:{demand_count}:{site_count}",
        "demands": demands,
        "sites": sites,
        "matrix": {"rows": rows},
        "options": {
            "transportBasis": "quantity",
            "transportCostPerUnitKm": 0.5,
            "currency": "CNY",
            "costPeriod": "MODEL_RUN",
            "facilityCounts": counts,
            "timeLimitSeconds": time_limit,
            "randomSeed": 1909,
        },
    }


def run_case(demand_count: int, site_count: int, counts: list[int], time_limit: int) -> dict:
    payload = request(demand_count, site_count, counts, time_limit)
    started = time.perf_counter()
    result = solve_facility(payload, cp_model, ortools.__version__)
    elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
    statuses = [row["status"] for row in result["results"]]
    if not statuses or any(value not in {"OPTIMAL", "FEASIBLE", "INFEASIBLE"} for value in statuses):
        raise AssertionError(f"unexpected statuses: {statuses}")
    return {
        "demands": demand_count,
        "candidateSites": site_count,
        "facilityCounts": counts,
        "matrixRows": demand_count * site_count,
        "elapsedMs": elapsed_ms,
        "statuses": statuses,
        "resultCount": len(result["results"]),
        "publicRequests": result["publicRequests"],
    }


if __name__ == "__main__":
    cases = [
        run_case(24, 6, [1, 2, 3], 8),
        run_case(120, 20, [1, 2, 3], 12),
        run_case(500, 100, [3], 20),
    ]
    print(json.dumps({
        "schemaVersion": "stct-v1.9-facility-mvp1-performance-v1",
        "status": "PASS",
        "machine": {"platform": platform.platform(), "python": platform.python_version(), "ortools": ortools.__version__},
        "cases": cases,
        "evidenceClass": "REAL_LOCAL_CP_SAT_SYNTHETIC_WORKLOAD",
        "limitations": ["Single local measurements are not an SLA or p95.", "The 500/100 target measures P=3 only to bound local runtime."],
        "externalRequests": 0,
    }, ensure_ascii=False, indent=2))
