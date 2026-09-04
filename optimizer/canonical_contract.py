#!/usr/bin/env python3
"""Shared v1.3 canonical planning identity for the local optimizer service."""

from __future__ import annotations

import hashlib
import json
import math
import unicodedata
from datetime import date as date_type, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "shared" / "planning-contract-v13.json"


class CanonicalError(ValueError):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.details = details or {}


def load_contract(path: Path = CONTRACT_PATH) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not value.get("contractVersion") or not value.get("canonicalSchemas"):
        raise CanonicalError("CONTRACT_INVALID", "Planning contract is missing required sections.")
    return value


CONTRACT = load_contract()


def canonical_text(value: Any, *, required: bool = False, field: str = "") -> str:
    if value is None:
        if required:
            raise CanonicalError("CANONICALIZATION_ERROR", f"Missing required string: {field}", {"field": field})
        return ""
    if not isinstance(value, str):
        raise CanonicalError("CANONICAL_TYPE_ERROR", f"Invalid string type: {field}", {"field": field, "type": type(value).__name__})
    normalized = unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n").strip())
    if required and not normalized:
        raise CanonicalError("CANONICALIZATION_ERROR", f"Empty required string: {field}", {"field": field})
    return normalized


def import_text(value: Any, *, required: bool = False, field: str = "") -> str:
    if value is None:
        return canonical_text(value, required=required, field=field) if required else ""
    if isinstance(value, bool) or isinstance(value, (dict, list, tuple, set)):
        raise CanonicalError("IMPORT_TYPE_ERROR", f"Invalid imported text type: {field}", {"field": field, "type": type(value).__name__})
    if isinstance(value, datetime):
        source = value.astimezone(timezone.utc).isoformat()
    elif isinstance(value, float):
        if not math.isfinite(value):
            raise CanonicalError("IMPORT_TYPE_ERROR", f"Invalid imported number: {field}", {"field": field})
        source = "0" if value == 0 else str(value)
    else:
        source = str(value)
    return canonical_text(source, required=required, field=field)


def import_date(value: Any, field: str, *, optional: bool = False) -> str:
    if value in (None, ""):
        if optional:
            return ""
        raise CanonicalError("CANONICALIZATION_ERROR", f"Missing required date: {field}", {"field": field})
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date_type):
        return value.isoformat()
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)):
        return (date_type(1899, 12, 30) + timedelta(days=int(value))).isoformat()
    source = import_text(value, required=not optional, field=field)
    parts = source.replace("/", "-").split("-")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        raise CanonicalError("CANONICALIZATION_ERROR", f"Invalid imported date: {field}", {"field": field, "value": source})
    strict = f"{int(parts[0]):04d}-{int(parts[1]):02d}-{int(parts[2]):02d}"
    return canonical_date(strict, field, optional=optional)


def import_time(value: Any, field: str) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)) and 0 <= float(value) < 1:
        minutes = round(float(value) * 1440) % 1440
        return f"{minutes // 60:02d}:{minutes % 60:02d}"
    source = import_text(value, required=True, field=field)
    parts = source.split(":")
    if len(parts) != 2 or not all(part.isdigit() for part in parts) or len(parts[0]) > 2 or len(parts[1]) != 2:
        raise CanonicalError("CANONICALIZATION_ERROR", f"Invalid imported time: {field}", {"field": field, "value": source})
    return canonical_time(f"{int(parts[0]):02d}:{parts[1]}", field)


def canonical_decimal(value: Any, scale: int, field: str) -> str:
    if isinstance(value, float) and not math.isfinite(value):
        raise CanonicalError("INVALID_CANONICAL_NUMBER", f"Non-finite number: {field}", {"field": field})
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise CanonicalError("CANONICAL_TYPE_ERROR", f"Invalid number type: {field}", {"field": field, "type": type(value).__name__})
    source = "-0" if isinstance(value, float) and value == 0 and math.copysign(1.0, value) < 0 else str(value).strip()
    try:
        number = Decimal(source)
    except (InvalidOperation, ValueError) as exc:
        raise CanonicalError("INVALID_CANONICAL_NUMBER", f"Invalid number: {field}", {"field": field, "value": source}) from exc
    if not number.is_finite():
        raise CanonicalError("INVALID_CANONICAL_NUMBER", f"Non-finite number: {field}", {"field": field})
    quantum = Decimal(1).scaleb(-scale)
    try:
        rounded = number.quantize(quantum, rounding=ROUND_HALF_UP)
    except InvalidOperation as exc:
        raise CanonicalError("INVALID_CANONICAL_NUMBER", f"Number exponent is outside the supported range: {field}", {"field": field}) from exc
    if rounded == 0:
        rounded = abs(rounded)
    return format(rounded, f".{scale}f")


def canonical_integer(value: Any, field: str) -> str:
    return canonical_decimal(value, 0, field)


def canonical_boolean(value: Any, field: str) -> bool:
    if value is True or value is False:
        return value
    if value in (1, "1") or str(value).lower() == "true":
        return True
    if value in (0, "0") or str(value).lower() == "false":
        return False
    raise CanonicalError("CANONICALIZATION_ERROR", f"Invalid boolean: {field}", {"field": field, "value": value})


def canonical_date(value: Any, field: str, *, optional: bool = False) -> str:
    source = canonical_text(value, required=not optional, field=field)
    if not source and optional:
        return ""
    parts = source.split("-")
    if len(source) != 10 or len(parts) != 3 or [len(part) for part in parts] != [4, 2, 2] or not all(part.isdigit() for part in parts):
        raise CanonicalError("CANONICALIZATION_ERROR", f"Invalid date: {field}", {"field": field, "value": source})
    try:
        parsed = date_type(int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError as exc:
        raise CanonicalError("CANONICALIZATION_ERROR", f"Invalid date: {field}", {"field": field, "value": source}) from exc
    return parsed.isoformat()


def canonical_time(value: Any, field: str) -> str:
    source = canonical_text(value, required=True, field=field)
    parts = source.split(":")
    if len(source) != 5 or len(parts) != 2 or [len(part) for part in parts] != [2, 2] or not all(part.isdigit() for part in parts):
        raise CanonicalError("CANONICALIZATION_ERROR", f"Invalid time: {field}", {"field": field, "value": source})
    hours, minutes = (int(parts[0]), int(parts[1]))
    if hours > 23 or minutes > 59:
        raise CanonicalError("CANONICALIZATION_ERROR", f"Invalid time: {field}", {"field": field, "value": source})
    return source


def canonical_utf8_key(value: str) -> bytes:
    return canonical_text(value, required=True, field="canonical-sort").encode("utf-8")


def normalize_entity(source: dict[str, Any] | None, schema_name: str, contract: dict[str, Any] = CONTRACT) -> dict[str, Any]:
    schema = contract["canonicalSchemas"].get(schema_name)
    if not schema:
        raise CanonicalError("CONTRACT_INVALID", f"Unknown canonical schema: {schema_name}")
    source = source or {}
    result: dict[str, Any] = {}
    for definition in schema:
        name = definition["name"]
        field = f"{schema_name}.{name}"
        value = source.get(name)
        data_type = definition["type"]
        if data_type in ("identifier", "text", "optionalText", "enum"):
            result[name] = canonical_text(value, required=bool(definition.get("required")), field=field)
        elif data_type == "date":
            result[name] = canonical_date(value, field)
        elif data_type == "optionalDate":
            result[name] = canonical_date(value, field, optional=True)
        elif data_type == "time":
            result[name] = canonical_time(value, field)
        elif data_type == "number":
            result[name] = canonical_decimal(value, int(definition["scale"]), field)
        elif data_type == "integer":
            result[name] = canonical_integer(value, field)
        elif data_type == "boolean":
            result[name] = canonical_boolean(value, field)
        else:
            raise CanonicalError("CONTRACT_INVALID", f"Unknown canonical type: {data_type}", {"field": field})
    return result


def _unique_sorted(rows: list[dict[str, Any]], entity_name: str) -> list[dict[str, Any]]:
    seen: set[str] = set()
    for row in rows:
        if row["id"] in seen:
            code = "DUPLICATE_ORDER_ID" if entity_name == "order" else "DUPLICATE_VEHICLE_ID"
            raise CanonicalError(code, f"Duplicate {entity_name} id: {row['id']}", {"id": row["id"]})
        seen.add(row["id"])
    return sorted(rows, key=lambda row: canonical_utf8_key(row["id"]))


def _validate_scenario_values(scenario: dict[str, Any], contract: dict[str, Any] = CONTRACT) -> None:
    if abs(float(scenario["depot"]["lon"])) > 180 or abs(float(scenario["depot"]["lat"])) > 90:
        raise CanonicalError("CANONICALIZATION_ERROR", "Depot coordinate is outside the valid range.")
    for order in scenario["orders"]:
        if abs(float(order["lon"])) > 180 or abs(float(order["lat"])) > 90:
            raise CanonicalError("CANONICALIZATION_ERROR", "Order coordinate is outside the valid range.", {"orderId": order["id"]})
        for field in ("count", "volume", "weight", "serviceMin"):
            if Decimal(order[field]) < 0:
                raise CanonicalError("CANONICALIZATION_ERROR", f"Order {field} must be non-negative.", {"orderId": order["id"], "field": field})
        priority_weight = int(order["priorityWeight"])
        mapping = contract["priorityMapping"]
        if priority_weight < mapping["minimum"] or priority_weight > mapping["maximum"]:
            raise CanonicalError("CANONICALIZATION_ERROR", "priorityWeight is outside the supported range.", {"orderId": order["id"], "priorityWeight": order["priorityWeight"]})
    for vehicle in scenario["vehicles"]:
        if Decimal(vehicle["maxVolume"]) <= 0 or Decimal(vehicle["maxWeight"]) <= 0:
            raise CanonicalError("INVALID_VEHICLE_CAPACITY_DATA", "Vehicle capacity must be positive.", {"vehicleId": vehicle["id"]})


def canonical_scenario(source: dict[str, Any], contract: dict[str, Any] = CONTRACT) -> dict[str, Any]:
    planning_mode = canonical_text(source.get("planningMode"), required=True, field="planningMode")
    if planning_mode not in contract["planningModes"]:
        raise CanonicalError("CANONICALIZATION_ERROR", f"Unsupported planningMode: {planning_mode}")
    result = {
        "contractVersion": contract["contractVersion"],
        "canonicalVersion": contract["canonicalVersion"],
        "planningMode": planning_mode,
        "planningDate": canonical_date(source.get("planningDate"), "planningDate"),
        "depot": normalize_entity(source.get("depot"), "depot", contract),
        "orders": _unique_sorted([normalize_entity(row, "order", contract) for row in source.get("orders", [])], "order"),
        "vehicles": _unique_sorted([normalize_entity(row, "vehicle", contract) for row in source.get("vehicles", [])], "vehicle"),
        "constraints": normalize_entity(source.get("constraints"), "constraints", contract),
        "assumptions": normalize_entity(source.get("assumptions"), "assumptions", contract),
    }
    if planning_mode == "SINGLE_DAY":
        for order in result["orders"]:
            if order["date"] != result["planningDate"]:
                raise CanonicalError(
                    "MULTIPLE_ORDER_DATES_IN_SINGLE_DAY_SCENARIO",
                    "SINGLE_DAY scenario contains an order from another date.",
                    {"orderId": order["id"], "orderDate": order["date"], "planningDate": result["planningDate"]},
                )
    _validate_scenario_values(result, contract)
    return result


def content_envelope(scenario: dict[str, Any]) -> dict[str, Any]:
    return {
        "canonicalVersion": scenario["canonicalVersion"],
        "depot": scenario["depot"],
        "orders": scenario["orders"],
        "vehicles": scenario["vehicles"],
    }


def canonical_bytes(value: Any) -> bytes:
    def render(item: Any) -> str:
        if item is None:
            return "null"
        if isinstance(item, bool):
            return "true" if item else "false"
        if isinstance(item, str):
            return json.dumps(unicodedata.normalize("NFC", item), ensure_ascii=False, separators=(",", ":"))
        if isinstance(item, int) and not isinstance(item, bool):
            if abs(item) > 9_007_199_254_740_991:
                raise CanonicalError("INVALID_CANONICAL_NUMBER", "Canonical JSON only accepts cross-language safe integer number tokens.")
            return str(item)
        if isinstance(item, list):
            return f"[{','.join(render(child) for child in item)}]"
        if isinstance(item, dict):
            normalized: dict[str, Any] = {}
            for source_key, child in item.items():
                key = canonical_text(source_key, required=True, field="canonical-key")
                if key in normalized:
                    raise CanonicalError("DUPLICATE_CANONICAL_KEY", f"Duplicate canonical key: {key}", {"key": key})
                normalized[key] = child
            entries = (
                f"{json.dumps(key, ensure_ascii=False)}:{render(normalized[key])}"
                for key in sorted(normalized, key=canonical_utf8_key)
            )
            return f"{{{','.join(entries)}}}"
        raise CanonicalError("CANONICALIZATION_ERROR", "Unsupported canonical JSON value.", {"type": type(item).__name__})

    return render(value).encode("utf-8")


def sha256_bytes(value: bytes, contract: dict[str, Any] = CONTRACT) -> str:
    return f"{contract['hash']['prefix']}{hashlib.sha256(value).hexdigest()}"


def scenario_identity(source: dict[str, Any], contract: dict[str, Any] = CONTRACT) -> dict[str, Any]:
    scenario = canonical_scenario(source, contract)
    content = canonical_bytes(content_envelope(scenario))
    input_value = canonical_bytes(scenario)
    return {
        "scenario": scenario,
        "contentBytes": content,
        "inputBytes": input_value,
        "contentHash": sha256_bytes(content, contract),
        "inputHash": sha256_bytes(input_value, contract),
    }


def request_envelope(input_hash: str, options: dict[str, Any], contract: dict[str, Any] = CONTRACT) -> dict[str, Any]:
    schema = contract["requestSchema"]
    unknown_top_level = sorted(set(options) - set(schema["allowedTopLevel"]), key=canonical_utf8_key)
    if unknown_top_level:
        raise CanonicalError("UNKNOWN_REQUEST_OPTION", f"Unknown request option: {unknown_top_level[0]}", {"fields": unknown_top_level})
    objective = canonical_text(options.get("objective"), required=True, field="objective")
    if objective not in contract["objectives"]:
        raise CanonicalError("CANONICALIZATION_ERROR", f"Unsupported objective: {objective}")
    engine_requested = canonical_text(options.get("engineRequested") or "ortools", required=True, field="engineRequested")
    if engine_requested not in schema["engineRequested"]:
        raise CanonicalError("CANONICALIZATION_ERROR", f"Unsupported engineRequested: {engine_requested}")
    source_search = options.get("searchConfiguration") or {}
    if not isinstance(source_search, dict):
        raise CanonicalError("CANONICAL_TYPE_ERROR", "searchConfiguration must be an object.")
    unknown_search = sorted(set(source_search) - set(schema["searchConfiguration"]), key=canonical_utf8_key)
    if unknown_search:
        raise CanonicalError("UNKNOWN_REQUEST_OPTION", f"Unknown search option: {unknown_search[0]}", {"fields": unknown_search})
    search_configuration: dict[str, Any] = {}
    for key in sorted(source_search, key=canonical_utf8_key):
        definition = schema["searchConfiguration"][key]
        value = source_search[key]
        if definition["type"] == "integer":
            search_configuration[key] = canonical_integer(value, f"searchConfiguration.{key}")
        elif definition["type"] == "boolean":
            search_configuration[key] = canonical_boolean(value, f"searchConfiguration.{key}")
        elif definition["type"] == "enum":
            normalized = canonical_text(value, required=True, field=f"searchConfiguration.{key}")
            if normalized not in definition["values"]:
                raise CanonicalError("CANONICALIZATION_ERROR", f"Unsupported search option value: {key}", {"field": key, "value": normalized})
            search_configuration[key] = normalized
        else:
            raise CanonicalError("CONTRACT_INVALID", f"Unsupported request schema type: {definition['type']}", {"field": key})
    return {
        "contractVersion": contract["contractVersion"],
        "canonicalVersion": contract["canonicalVersion"],
        "inputHash": canonical_text(input_hash, required=True, field="inputHash"),
        "objective": objective,
        "timeLimitSeconds": canonical_integer(options.get("timeLimitSeconds"), "timeLimitSeconds"),
        "engineRequested": engine_requested,
        "searchConfiguration": search_configuration,
    }


def request_identity(input_hash: str, options: dict[str, Any], contract: dict[str, Any] = CONTRACT) -> dict[str, Any]:
    envelope = request_envelope(input_hash, options, contract)
    value = canonical_bytes(envelope)
    return {"envelope": envelope, "requestBytes": value, "requestHash": sha256_bytes(value, contract)}


def normalize_plan_envelope(input_hash: str, source: dict[str, Any], contract: dict[str, Any] = CONTRACT) -> dict[str, Any]:
    route_ids: set[str] = set()
    routes: list[dict[str, Any]] = []
    for source_route in source.get("routes", []):
        route = {
            "routeId": canonical_text(source_route.get("routeId"), required=True, field="route.routeId"),
            "vehicleId": canonical_text(source_route.get("vehicleId"), required=True, field="route.vehicleId"),
            "orderIds": [canonical_text(order_id, required=True, field="route.orderIds") for order_id in source_route.get("orderIds", [])],
        }
        if route["routeId"] in route_ids:
            raise CanonicalError("DUPLICATE_ROUTE_ID", f"Duplicate route id: {route['routeId']}")
        route_ids.add(route["routeId"])
        routes.append(route)
    routes.sort(key=lambda route: (canonical_utf8_key(route["routeId"]), canonical_utf8_key(route["vehicleId"])))
    return {
        "contractVersion": contract["contractVersion"],
        "canonicalVersion": contract["canonicalVersion"],
        "inputHash": canonical_text(input_hash, required=True, field="inputHash"),
        "parentPlanHash": canonical_text(source.get("parentPlanHash") or source.get("basePlanHash") or ""),
        "routes": routes,
        "unassignedOrderIds": sorted({canonical_text(order_id, required=True, field="unassignedOrderIds") for order_id in source.get("unassignedOrderIds", [])}, key=canonical_utf8_key),
        "blockedOrderIds": sorted({canonical_text(order_id, required=True, field="blockedOrderIds") for order_id in source.get("blockedOrderIds", [])}, key=canonical_utf8_key),
        "manualRevision": canonical_integer(source.get("manualRevision") or 0, "manualRevision"),
    }


def plan_identity(input_hash: str, source: dict[str, Any], contract: dict[str, Any] = CONTRACT) -> dict[str, Any]:
    envelope = normalize_plan_envelope(input_hash, source, contract)
    value = canonical_bytes(envelope)
    return {"envelope": envelope, "planBytes": value, "planHash": sha256_bytes(value, contract)}


def normalize_priority(value: Any, explicit_weight: Any = None, contract: dict[str, Any] = CONTRACT) -> dict[str, Any]:
    mapping = contract["priorityMapping"]
    explicit_text = "" if explicit_weight is None else str(explicit_weight).strip()
    if explicit_text:
        weight = int(canonical_integer(explicit_text, "priorityWeight"))
        if mapping["minimum"] <= weight <= mapping["maximum"]:
            original = canonical_text(value)
            return {"original": original, "normalized": original.lower() or "normal", "weight": weight, "source": "explicit", "warning": None}
        raise CanonicalError("CANONICALIZATION_ERROR", "Explicit priorityWeight is outside the supported range.", {"priorityWeight": explicit_weight})
    original = canonical_text(value)
    normalized_key = mapping["aliases"].get(original, mapping["aliases"].get(original.lower()))
    if normalized_key in mapping["values"]:
        return {"original": original, "normalized": normalized_key, "weight": mapping["values"][normalized_key], "source": "mapped", "warning": None}
    return {"original": original, "normalized": "normal", "weight": mapping["default"], "source": "defaulted", "warning": "UNKNOWN_PRIORITY_DEFAULTED_TO_NORMAL"}


__all__ = [
    "CONTRACT",
    "CanonicalError",
    "canonical_bytes",
    "canonical_scenario",
    "canonical_utf8_key",
    "content_envelope",
    "import_date",
    "import_text",
    "import_time",
    "load_contract",
    "normalize_plan_envelope",
    "normalize_priority",
    "plan_identity",
    "request_identity",
    "scenario_identity",
    "sha256_bytes",
]
