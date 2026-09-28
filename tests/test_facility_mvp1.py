#!/usr/bin/env python3
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "optimizer"))

import ortools
from ortools.sat.python import cp_model
from facility_mvp1 import FacilityError, solve_facility


def request():
    demands = [
        {"demandId": f"Q{i}", "coordinate": [117 + i * .01, 39], "demand": {"quantity": 1, "weight": 10, "volume": 2}, "eligibleSiteIds": [], "requiredCapabilities": []}
        for i in range(1, 13)
    ]
    sites = [
        {"siteId": f"S{i}", "coordinate": [117 + i * .03, 39], "status": "OPTIONAL", "capacity": {"quantity": 12, "weight": 120, "volume": 24}, "fixedCost": 100 + i * 10, "handlingCostPerUnit": 1, "capabilities": []}
        for i in range(1, 6)
    ]
    rows = []
    for j, site in enumerate(sites):
        for i, demand in enumerate(demands):
            rows.append({"siteId": site["siteId"], "demandId": demand["demandId"], "distanceMeters": abs(i - j * 3) * 1000 + 100, "travelSeconds": 60, "unreachable": False})
    return {"schemaVersion": "stct-facility-solve-request-v1.9-mvp1", "requestId": "TEST", "studyHash": "sha256:test", "demands": demands, "sites": sites, "matrix": {"rows": rows}, "options": {"facilityCounts": [1, 2, 3], "currentPortfolioSiteIds": ["S1", "S2", "S3"], "transportBasis": "volume", "transportCostPerUnitKm": 2, "currency": "CNY", "costPeriod": "MODEL_RUN", "timeLimitSeconds": 10, "randomSeed": 1909}}


payload = request()
result = solve_facility(payload, cp_model, ortools.__version__)
assert result["engine"]["id"] == "OR_TOOLS_CP_SAT"
assert result["engine"]["workers"] == 1
assert {row["facilityCount"] for row in result["results"]} == {1, 2, 3}
assert all(len(row["assignments"]) == 12 for row in result["results"] if row["status"] in {"OPTIMAL", "FEASIBLE"})
assert all(row["status"] == "OPTIMAL" for row in result["results"])
assert all(row["relativeGap"] == 0 for row in result["results"])
assert result["currentBaseline"]["portfolioKind"] == "CURRENT_NETWORK_BASELINE"
assert result["currentBaseline"]["selectedSiteIds"] == ["S1", "S2", "S3"]

matrix_case = {
    "schemaVersion": "stct-facility-solve-request-v1.9-mvp1", "requestId": "MATRIX", "studyHash": "sha256:matrix",
    "demands": [{"demandId": "D1", "demand": {"quantity": 1}}, {"demandId": "D2", "demand": {"quantity": 1}}],
    "sites": [{"siteId": "S1", "status": "OPTIONAL", "capacity": {"quantity": 1}, "fixedCost": 0}, {"siteId": "S2", "status": "OPTIONAL", "capacity": {"quantity": 2}, "fixedCost": 0}],
    "matrix": {"rows": [{"siteId": "S1", "demandId": "D1", "distanceMeters": 100}, {"siteId": "S1", "demandId": "D2", "distanceMeters": 200}, {"siteId": "S2", "demandId": "D1", "distanceMeters": 9000}, {"siteId": "S2", "demandId": "D2", "distanceMeters": 50}]},
    "options": {"facilityCounts": [1], "transportBasis": "quantity", "transportCostPerUnitKm": 1, "currency": "CNY", "costPeriod": "MODEL_RUN", "timeLimitSeconds": 5, "randomSeed": 1909},
}
matrix_result = solve_facility(matrix_case, cp_model, ortools.__version__)
assert matrix_result["results"][0]["selectedSiteIds"] == ["S2"]
before_objective = matrix_result["results"][0]["objectiveValue"]
matrix_case["matrix"]["rows"][2]["distanceMeters"] = 19000
changed_result = solve_facility(matrix_case, cp_model, ortools.__version__)
assert changed_result["results"][0]["objectiveValue"] > before_objective

attack = request()
attack["matrix"]["rows"].pop()
try:
    solve_facility(attack, cp_model, ortools.__version__)
    raise AssertionError("incomplete matrix accepted")
except FacilityError as error:
    assert error.code == "FACILITY_MATRIX_GRID_INCOMPLETE"

print(json.dumps({"suite": "FACILITY_MVP1_CP_SAT", "status": "PASS", "results": len(result["results"]), "currentBaseline": result["currentBaseline"]["status"], "importedMatrixChangedObjective": True, "engineVersion": ortools.__version__}, indent=2))
