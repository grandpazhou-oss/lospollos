"""STCT v1.6 road-aware routing contract.

This module validates local fixture/provider envelopes only. It performs no network
requests and never substitutes an unreachable road leg with Haversine distance.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import unicodedata
from dataclasses import dataclass
from typing import Any


MATRIX_SCHEMA = "stct-road-matrix-v1.6"
ROUTE_SCHEMA = "stct-road-route-v1.6"
DISTANCE_UNITS = {"m", "km"}
DURATION_UNITS = {"seconds", "minutes"}


@dataclass
class RoutingContractError(ValueError):
    code: str
    message: str
    detail: dict[str, Any] | None = None

    def __str__(self) -> str:
        return self.message


def _normalized(value: Any) -> Any:
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if isinstance(value, list):
        return [_normalized(item) for item in value]
    if isinstance(value, dict):
        return {unicodedata.normalize("NFC", str(key)): _normalized(value[key]) for key in sorted(value, key=lambda item: unicodedata.normalize("NFC", str(item)).encode("utf-8"))}
    if isinstance(value, float):
        if not math.isfinite(value):
            raise RoutingContractError("NON_FINITE_IDENTITY", "Routing identity values must be finite.")
        return 0 if value == 0 else value
    return value


def stable_hash(value: Any) -> str:
    encoded = json.dumps(_normalized(value), ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def matrix_identity(matrix: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": MATRIX_SCHEMA,
        "providerId": str(matrix.get("providerId") or "").strip(),
        "providerVersion": str(matrix.get("providerVersion") or "").strip(),
        "graphHash": str(matrix.get("graphHash") or "").strip(),
        "requestHash": str(matrix.get("requestHash") or "").strip(),
        "profile": str(matrix.get("profile") or "").strip(),
        "sourceIds": copy.deepcopy(matrix.get("sourceIds") or []),
        "targetIds": copy.deepcopy(matrix.get("targetIds") or []),
        "distances": copy.deepcopy(matrix.get("distances") or []),
        "durations": copy.deepcopy(matrix.get("durations") or []),
        "distanceUnit": str(matrix.get("distanceUnit") or "").strip(),
        "durationUnit": str(matrix.get("durationUnit") or "").strip(),
        "unreachablePairs": copy.deepcopy(matrix.get("unreachablePairs") or []),
        "closureIds": copy.deepcopy(matrix.get("closureIds") or []),
        "vehicleProfile": copy.deepcopy(matrix.get("vehicleProfile") or {}),
        "avoidTolls": matrix.get("avoidTolls") is True,
        "trafficMode": str(matrix.get("trafficMode") or "").strip(),
        "departureTimeApplied": matrix.get("departureTimeApplied") is True,
    }


def _grid(value: Any, rows: int, columns: int, name: str) -> list[list[float | int | None]]:
    if not isinstance(value, list) or len(value) != rows or any(not isinstance(row, list) or len(row) != columns for row in value):
        raise RoutingContractError("MATRIX_DIMENSION_MISMATCH", f"{name} must be {rows} x {columns}.")
    output: list[list[float | int | None]] = []
    for row_index, row in enumerate(value):
        normalized_row: list[float | int | None] = []
        for column_index, item in enumerate(row):
            if item is None:
                normalized_row.append(None)
                continue
            if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(float(item)) or float(item) < 0:
                raise RoutingContractError("MATRIX_VALUE_INVALID", f"{name}[{row_index}][{column_index}] is invalid.")
            normalized_row.append(item)
        output.append(normalized_row)
    return output


def validate_matrix(matrix: dict[str, Any], *, expected_point_ids: list[str] | None = None, verify_hash: bool = True) -> dict[str, Any]:
    value = copy.deepcopy(matrix)
    if value.get("schemaVersion") != MATRIX_SCHEMA:
        raise RoutingContractError("MATRIX_SCHEMA_UNSUPPORTED", "Road matrix schema is unsupported.")
    required_text = ["providerId", "providerVersion", "graphHash", "requestHash", "profile"]
    if any(not str(value.get(field) or "").strip() for field in required_text):
        raise RoutingContractError("MATRIX_PROVENANCE_REQUIRED", "Road matrix provider, graph, request, and profile fields are required.")
    source_ids = [str(item).strip() for item in value.get("sourceIds") or []]
    target_ids = [str(item).strip() for item in value.get("targetIds") or []]
    if not source_ids or not target_ids or len(set(source_ids)) != len(source_ids) or len(set(target_ids)) != len(target_ids):
        raise RoutingContractError("MATRIX_POINT_IDS_INVALID", "Road matrix point IDs are missing or duplicated.")
    if expected_point_ids is not None and (source_ids != expected_point_ids or target_ids != expected_point_ids):
        raise RoutingContractError("MATRIX_POINT_MAPPING_MISMATCH", "Road matrix point IDs do not match the optimizer request.", {"expected": expected_point_ids, "sourceIds": source_ids, "targetIds": target_ids})
    distance_unit = str(value.get("distanceUnit") or "").strip()
    duration_unit = str(value.get("durationUnit") or "").strip()
    if distance_unit not in DISTANCE_UNITS or duration_unit not in DURATION_UNITS:
        raise RoutingContractError("MATRIX_UNITS_UNSUPPORTED", f"Unsupported road matrix units: {distance_unit}/{duration_unit}")
    distances = _grid(value.get("distances"), len(source_ids), len(target_ids), "distances")
    durations = _grid(value.get("durations"), len(source_ids), len(target_ids), "durations")
    unreachable = {(str(item.get("sourceId") or ""), str(item.get("targetId") or "")) for item in value.get("unreachablePairs") or []}
    for row, source_id in enumerate(source_ids):
        for column, target_id in enumerate(target_ids):
            pair_unreachable = distances[row][column] is None or durations[row][column] is None
            if pair_unreachable != ((source_id, target_id) in unreachable):
                raise RoutingContractError("MATRIX_UNREACHABLE_CONTRACT_MISMATCH", f"Unreachable pair contract mismatch: {source_id}->{target_id}")
    value.update({"sourceIds": source_ids, "targetIds": target_ids, "distances": distances, "durations": durations, "distanceUnit": distance_unit, "durationUnit": duration_unit})
    expected_hash = stable_hash(matrix_identity(value))
    if verify_hash and value.get("matrixHash") != expected_hash:
        raise RoutingContractError("MATRIX_HASH_STALE", "Road matrix hash does not match its semantic content.", {"expectedHash": expected_hash, "actualHash": value.get("matrixHash")})
    value["matrixHash"] = expected_hash
    return value


def route_identity(route: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": ROUTE_SCHEMA,
        "providerId": str(route.get("providerId") or "").strip(),
        "providerVersion": str(route.get("providerVersion") or "").strip(),
        "graphHash": str(route.get("graphHash") or "").strip(),
        "requestHash": str(route.get("requestHash") or "").strip(),
        "matrixHash": route.get("matrixHash"),
        "pointIds": copy.deepcopy(route.get("pointIds") or []),
        "legs": copy.deepcopy(route.get("legs") or []),
        "totalDistance": route.get("totalDistance"),
        "totalDuration": route.get("totalDuration"),
        "geometry": copy.deepcopy(route.get("geometry") or []),
        "edgeIds": copy.deepcopy(route.get("edgeIds") or []),
        "restrictionsApplied": copy.deepcopy(route.get("restrictionsApplied") or []),
        "tollSummary": copy.deepcopy(route.get("tollSummary") or {}),
    }


def validate_route(route: dict[str, Any], *, verify_hash: bool = True) -> dict[str, Any]:
    value = copy.deepcopy(route)
    if value.get("schemaVersion") != ROUTE_SCHEMA:
        raise RoutingContractError("ROUTE_SCHEMA_UNSUPPORTED", "Road route schema is unsupported.")
    if any(not str(value.get(field) or "").strip() for field in ["providerId", "providerVersion", "graphHash", "requestHash"]):
        raise RoutingContractError("ROUTE_PROVENANCE_REQUIRED", "Road route provenance is incomplete.")
    legs = value.get("legs") or []
    point_ids = value.get("pointIds") or []
    if len(point_ids) < 2 or len(legs) != len(point_ids) - 1:
        raise RoutingContractError("ROUTE_LEG_COUNT_MISMATCH", "Road route legs do not match point order.")
    if any(leg.get("fromPointId") != point_ids[index] or leg.get("toPointId") != point_ids[index + 1] for index, leg in enumerate(legs)):
        raise RoutingContractError("ROUTE_POINT_MAPPING_MISMATCH", "Road route leg point mapping is invalid.")
    distance = sum(float(leg.get("distance") or 0) for leg in legs)
    duration = sum(float(leg.get("duration") or 0) for leg in legs)
    if not math.isclose(distance, float(value.get("totalDistance") or 0), rel_tol=0, abs_tol=1e-9):
        raise RoutingContractError("ROUTE_DISTANCE_TOTAL_MISMATCH", "Road route distance total does not match legs.")
    if not math.isclose(duration, float(value.get("totalDuration") or 0), rel_tol=0, abs_tol=1e-9):
        raise RoutingContractError("ROUTE_DURATION_TOTAL_MISMATCH", "Road route duration total does not match legs.")
    expected_hash = stable_hash(route_identity(value))
    if verify_hash and value.get("routeHash") != expected_hash:
        raise RoutingContractError("ROUTE_HASH_STALE", "Road route hash does not match its semantic content.")
    value["routeHash"] = expected_hash
    return value


def optimizer_matrix_payload(matrix: dict[str, Any], expected_point_ids: list[str]) -> dict[str, Any]:
    value = validate_matrix(matrix, expected_point_ids=expected_point_ids)
    if any(item is None for row in value["distances"] for item in row):
        raise RoutingContractError("MATRIX_UNREACHABLE_FOR_SOLVE", "Authoritative road matrix contains unreachable pairs; no Haversine substitution is permitted.")
    distance_scale = 1000 if value["distanceUnit"] == "km" else 1
    duration_scale = 60 if value["durationUnit"] == "minutes" else 1
    return {
        "pointIds": value["sourceIds"],
        "distanceMeters": [[round(float(item) * distance_scale) for item in row] for row in value["distances"]],
        "durationSeconds": [[round(float(item) * duration_scale) for item in row] for row in value["durations"]],
        "matrixHash": value["matrixHash"],
        "providerProvenance": copy.deepcopy(value.get("providerProvenance") or {}),
        "authoritative": True,
        "fallbackUsed": False,
    }
