"""STCT v1.5 routing-matrix validation contract.

This module has no network behavior. It mirrors the browser contract closely enough
for local optimizer adapters to reject malformed or stale matrix envelopes before use.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import unicodedata
from dataclasses import dataclass
from typing import Any


CONTRACT_VERSION = "stct-routing-matrix-v1.5"
DISTANCE_UNITS = {"km", "m"}
DURATION_UNITS = {"minutes", "seconds"}


@dataclass
class MatrixContractError(ValueError):
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
            raise MatrixContractError("MATRIX_VALUE_NON_FINITE", "Identity values must be finite.")
        return 0 if value == 0 else value
    return value


def stable_json(value: Any) -> str:
    return json.dumps(_normalized(value), ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def identity_envelope(matrix: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": CONTRACT_VERSION,
        "providerId": str(matrix.get("providerId") or matrix.get("provider", {}).get("id") or "").strip(),
        "providerVersion": str(matrix.get("providerVersion") or matrix.get("provider", {}).get("version") or "").strip(),
        "profile": str(matrix.get("profile") or "").strip(),
        "sourceIds": copy.deepcopy(matrix.get("sourceIds") or []),
        "targetIds": copy.deepcopy(matrix.get("targetIds") or []),
        "distances": copy.deepcopy(matrix.get("distances") or []),
        "durations": copy.deepcopy(matrix.get("durations") or []),
        "distanceUnit": str(matrix.get("distanceUnit") or matrix.get("units", {}).get("distance") or "").strip(),
        "durationUnit": str(matrix.get("durationUnit") or matrix.get("units", {}).get("duration") or "").strip(),
        "trafficMode": str(matrix.get("trafficMode") or "").strip(),
        "roadRestrictions": str(matrix.get("roadRestrictions") or "").strip(),
        "departureTimeApplied": matrix.get("departureTimeApplied") is True,
        "factor": matrix.get("factor"),
        "averageSpeedKph": matrix.get("averageSpeedKph"),
        "unreachablePairs": copy.deepcopy(matrix.get("unreachablePairs") or []),
    }


def computed_matrix_hash(matrix: dict[str, Any]) -> str:
    payload = stable_json(identity_envelope(matrix)).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def _validate_grid(rows: Any, row_count: int, column_count: int, name: str, unreachable_policy: str) -> tuple[list[list[float | None]], set[tuple[int, int]]]:
    if not isinstance(rows, list) or len(rows) != row_count or any(not isinstance(row, list) or len(row) != column_count for row in rows):
        raise MatrixContractError("MATRIX_DIMENSION_MISMATCH", f"{name} must be {row_count} x {column_count}.")
    unreachable: set[tuple[int, int]] = set()
    normalized: list[list[float | None]] = []
    for row_index, row in enumerate(rows):
        normalized_row: list[float | None] = []
        for column_index, raw in enumerate(row):
            if raw is None or raw == math.inf:
                if unreachable_policy != "ALLOW_INFINITY":
                    raise MatrixContractError("MATRIX_VALUE_INFINITY", f"{name}[{row_index}][{column_index}] is unreachable.")
                unreachable.add((row_index, column_index))
                normalized_row.append(None)
                continue
            if isinstance(raw, bool) or not isinstance(raw, (int, float)) or math.isnan(float(raw)):
                raise MatrixContractError("MATRIX_VALUE_NAN", f"{name}[{row_index}][{column_index}] is not numeric.")
            if not math.isfinite(float(raw)):
                raise MatrixContractError("MATRIX_VALUE_NON_FINITE", f"{name}[{row_index}][{column_index}] is not finite.")
            if float(raw) < 0:
                raise MatrixContractError("MATRIX_VALUE_NEGATIVE", f"{name}[{row_index}][{column_index}] is negative.")
            normalized_row.append(raw)
        normalized.append(normalized_row)
    return normalized, unreachable


def validate_matrix(matrix: dict[str, Any], *, unreachable_policy: str = "ALLOW_INFINITY", diagonal_policy: str = "WARN", verify_hash: bool = True) -> dict[str, Any]:
    value = copy.deepcopy(matrix)
    source_ids = [str(item).strip() for item in value.get("sourceIds") or []]
    target_ids = [str(item).strip() for item in value.get("targetIds") or []]
    if not source_ids or not target_ids or any(not item for item in source_ids + target_ids):
        raise MatrixContractError("MATRIX_POINT_IDS_REQUIRED", "sourceIds and targetIds are required.")
    if len(set(source_ids)) != len(source_ids) or len(set(target_ids)) != len(target_ids):
        raise MatrixContractError("MATRIX_POINT_ID_DUPLICATE", "sourceIds and targetIds must be unique.")
    provider_id = str(value.get("providerId") or value.get("provider", {}).get("id") or "").strip()
    provider_version = str(value.get("providerVersion") or value.get("provider", {}).get("version") or "").strip()
    profile = str(value.get("profile") or "").strip()
    if not provider_id or not provider_version:
        raise MatrixContractError("MATRIX_PROVIDER_VERSION_REQUIRED", "Provider id and version are required.")
    if not profile:
        raise MatrixContractError("MATRIX_PROFILE_REQUIRED", "Profile is required.")
    distance_unit = str(value.get("distanceUnit") or value.get("units", {}).get("distance") or "").strip()
    duration_unit = str(value.get("durationUnit") or value.get("units", {}).get("duration") or "").strip()
    if not distance_unit or not duration_unit:
        raise MatrixContractError("MATRIX_UNITS_REQUIRED", "Distance and duration units are required.")
    if distance_unit not in DISTANCE_UNITS or duration_unit not in DURATION_UNITS:
        raise MatrixContractError("MATRIX_UNITS_UNSUPPORTED", f"Unsupported units: {distance_unit}/{duration_unit}")
    distances, distance_unreachable = _validate_grid(value.get("distances"), len(source_ids), len(target_ids), "distances", unreachable_policy)
    durations, duration_unreachable = _validate_grid(value.get("durations"), len(source_ids), len(target_ids), "durations", unreachable_policy)
    warnings: list[dict[str, Any]] = []
    if source_ids == target_ids:
        for index, point_id in enumerate(source_ids):
            if distances[index][index] != 0 or durations[index][index] != 0:
                if diagonal_policy == "REJECT":
                    raise MatrixContractError("MATRIX_DIAGONAL_NONZERO", f"Diagonal value is nonzero for {point_id}.")
                warnings.append({"code": "MATRIX_DIAGONAL_NONZERO", "pointId": point_id})
    value.update({
        "providerId": provider_id,
        "providerVersion": provider_version,
        "profile": profile,
        "sourceIds": source_ids,
        "targetIds": target_ids,
        "distances": distances,
        "durations": durations,
        "distanceUnit": distance_unit,
        "durationUnit": duration_unit,
        "trafficMode": str(value.get("trafficMode") or "UNKNOWN"),
        "roadRestrictions": str(value.get("roadRestrictions") or "UNKNOWN"),
        "departureTimeApplied": value.get("departureTimeApplied") is True,
        "unreachablePairs": [
            {"sourceId": source_ids[row], "targetId": target_ids[column]}
            for row, column in sorted(distance_unreachable | duration_unreachable)
        ],
    })
    expected_hash = computed_matrix_hash(value)
    if verify_hash and value.get("matrixHash") and value["matrixHash"] != expected_hash:
        raise MatrixContractError("MATRIX_HASH_STALE", "matrixHash does not match matrix content.", {"expectedHash": expected_hash, "actualHash": value["matrixHash"]})
    value["matrixHash"] = expected_hash
    return {"status": "PASS", "matrix": value, "warnings": warnings}


def matrix_provenance(matrix: dict[str, Any]) -> dict[str, Any]:
    value = validate_matrix(matrix)["matrix"]
    return {
        "providerId": value["providerId"],
        "providerVersion": value["providerVersion"],
        "profile": value["profile"],
        "matrixHash": value["matrixHash"],
        "pointCount": len(set(value["sourceIds"] + value["targetIds"])),
        "sourceCount": len(value["sourceIds"]),
        "targetCount": len(value["targetIds"]),
        "distanceUnit": value["distanceUnit"],
        "durationUnit": value["durationUnit"],
        "trafficMode": value["trafficMode"],
        "departureTimeApplied": value["departureTimeApplied"],
        "generatedAt": value.get("generatedAt"),
        "generatedAtExcludedFromIdentity": True,
        "cacheHit": value.get("cacheHit") is True,
        "cacheHitExcludedFromIdentity": True,
        "snapSummary": copy.deepcopy(value.get("snapSummary") or {"supported": False, "snapped": 0}),
        "unreachablePairs": copy.deepcopy(value["unreachablePairs"]),
    }
