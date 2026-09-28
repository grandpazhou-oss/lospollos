"""Unknown strategic capacity remains unmodeled without relaxing demand validation."""

import copy
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "optimizer"))

import ortools
from ortools.sat.python import cp_model

from facility_mvp1 import FacilityError, solve_facility


request = {
    "schemaVersion": "stct-facility-solve-request-v1.9-mvp1",
    "requestId": "NULL-CAPACITY-SYNTHETIC",
    "studyHash": "sha256:synthetic-test",
    "demands": [{"demandId": "D1", "demand": {"quantity": 1, "weight": 0, "volume": 2}}],
    "sites": [{"siteId": "S1", "status": "OPTIONAL", "capacity": {"quantity": None, "weight": None, "volume": None}, "fixedCost": 10, "handlingCostPerUnit": 2}],
    "matrix": {"rows": [{"siteId": "S1", "demandId": "D1", "distanceMeters": 1000, "travelSeconds": 60, "unreachable": False}]},
    "options": {"facilityCounts": [1], "currentPortfolioSiteIds": ["S1"], "transportBasis": "volume", "transportCostPerUnitKm": 3, "currency": "CNY", "costPeriod": "MODEL_RUN", "randomSeed": 1909},
}

result = solve_facility(request, cp_model, ortools.__version__)
assert result["results"][0]["status"] == "OPTIMAL"
assert result["results"][0]["objectiveValue"] == 20
assert result["currentBaseline"]["status"] == "OPTIMAL"

for key, field in (("demand", "demand"), ("capacity", "capacity")):
    invalid = copy.deepcopy(request)
    collection = "demands" if key == "demand" else "sites"
    invalid[collection][0][key]["volume"] = None if key == "demand" else "invalid"
    try:
        solve_facility(invalid, cp_model, ortools.__version__)
    except FacilityError as error:
        assert error.code == "FACILITY_NUMERIC_INPUT_INVALID"
        assert error.detail["field"] == field
    else:
        raise AssertionError(f"{field} accepted an invalid value")

cost_request = copy.deepcopy(request)
cost_request["sites"].append({"siteId": "S2", "status": "OPTIONAL", "capacity": {"volume": None}, "fixedCost": 10, "handlingCostPerUnit": 2})
cost_request["matrix"]["rows"].append({"siteId": "S2", "demandId": "D1", "distanceMeters": 9000, "travelSeconds": 540, "unreachable": False})
cost_request["objective"] = {"mode": "COST", "unit": "CNY", "pairValues": [{"siteId": "S1", "demandId": "D1", "value": 100}, {"siteId": "S2", "demandId": "D1", "value": 10}], "siteValues": [{"siteId": "S1", "value": 4}, {"siteId": "S2", "value": 5}]}
cost_result = solve_facility(cost_request, cp_model, ortools.__version__)
cost_best = cost_result["results"][0]
assert cost_best["selectedSiteIds"] == ["S2"]
assert cost_best["objectiveValue"] == 15
assert cost_best["objectiveMode"] == cost_result["objectiveMode"] == "COST"
assert cost_best["objectiveUnit"] == cost_result["objectiveUnit"] == "CNY"
assert cost_best["cost"]["scope"] == "LEGACY_OUTBOUND_COMPONENTS_NOT_TOTAL_OBJECTIVE"
assert cost_best["cost"]["total"] != cost_best["objectiveValue"]
hash_input = {key: value for key, value in cost_best.items() if key not in {"portfolioHash", "rank"}}
assert cost_best["portfolioHash"] == "sha256:" + hashlib.sha256(json.dumps(hash_input, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
assert "objectiveMode" not in result

volume_request = copy.deepcopy(cost_request)
volume_request["objective"] = {"mode": "VOLUME_KM", "unit": "m3_km", "pairValues": [{"siteId": "S1", "demandId": "D1", "value": 2}, {"siteId": "S2", "demandId": "D1", "value": 18}], "siteValues": [{"siteId": "S1", "value": 0}, {"siteId": "S2", "value": 0}]}
volume_best = solve_facility(volume_request, cp_model, ortools.__version__)["results"][0]
assert volume_best["selectedSiteIds"] == ["S1"]
assert volume_best["objectiveValue"] == 2
assert volume_best["objectiveUnit"] == "m3_km"

limited = copy.deepcopy(cost_request)
limited["options"]["maxDistanceKm"] = 2
assert solve_facility(limited, cp_model, ortools.__version__)["results"][0]["selectedSiteIds"] == ["S1"]

for mutation in ("MISSING_PAIR", "NEGATIVE_VALUE", "WRONG_UNIT"):
    invalid = copy.deepcopy(cost_request)
    if mutation == "MISSING_PAIR":
        invalid["objective"]["pairValues"].pop()
    elif mutation == "NEGATIVE_VALUE":
        invalid["objective"]["pairValues"][0]["value"] = -1
    else:
        invalid["objective"]["unit"] = "m3_km"
    try:
        solve_facility(invalid, cp_model, ortools.__version__)
    except FacilityError as error:
        assert error.code.startswith("FACILITY_OBJECTIVE_")
    else:
        raise AssertionError(f"{mutation} objective accepted")

print(json.dumps({"suite": "FACILITY_NULL_CAPACITY_AND_OBJECTIVE", "status": "PASS", "legacyObjective": result["results"][0]["objectiveValue"], "costSelected": cost_best["selectedSiteIds"], "volumeKmSelected": volume_best["selectedSiteIds"]}))
