#!/usr/bin/env python3
"""Replay Facility MVP-1 with a public synthetic finite-candidate fixture."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import ortools
from ortools.sat.python import cp_model

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "optimizer"))

from facility_mvp1 import solve_facility  # noqa: E402


def fixture() -> dict:
    demands = [{"demandId": f"R{i:02d}", "demand": {"quantity": 1, "weight": 0, "volume": 1}} for i in range(1, 13)]
    sites = [{"siteId": f"S{i}", "status": "OPTIONAL", "capacity": {"quantity": 12, "weight": 0, "volume": 12}, "fixedCost": 100 + i * 10, "handlingCostPerUnit": 1} for i in range(1, 6)]
    rows = [{"siteId": site["siteId"], "demandId": demand["demandId"], "distanceMeters": 500 + abs(site_index * 3 - demand_index) * 800} for site_index, site in enumerate(sites) for demand_index, demand in enumerate(demands)]
    return {"schemaVersion": "stct-facility-solve-request-v1.9-mvp1", "requestId": "PUBLIC-SYNTHETIC-REPLAY", "studyHash": "synthetic:public-replay", "demands": demands, "sites": sites, "matrix": {"rows": rows}, "options": {"facilityCounts": [1, 2, 3], "currentPortfolioSiteIds": ["S1", "S2", "S3"], "transportBasis": "volume", "transportCostPerUnitKm": 1, "currency": "CNY", "costPeriod": "MODEL_RUN", "timeLimitSeconds": 10, "randomSeed": 1909}}


def main() -> None:
    result = solve_facility(fixture(), cp_model, ortools.__version__)
    feasible = [row for row in result["results"] if row["status"] in {"OPTIMAL", "FEASIBLE"}]
    if result["engine"]["id"] != "OR_TOOLS_CP_SAT" or {row["facilityCount"] for row in feasible} != {1, 2, 3}:
        raise SystemExit("FACILITY_REPLAY_FAILED")
    print(json.dumps({"status": "PASS", "engine": result["engine"], "currentBaseline": result["currentBaseline"]["status"], "portfolios": [{"p": row["facilityCount"], "rank": row["rank"], "status": row["status"], "sites": row["selectedSiteIds"], "total": row["cost"]["total"]} for row in feasible], "publicRequests": result["publicRequests"]}, indent=2))


if __name__ == "__main__":
    main()
