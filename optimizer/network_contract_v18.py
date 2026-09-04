#!/usr/bin/env python3
"""Dependency-free canonical JSON and SHA-256 contract for STCT v1.8."""

from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import unicodedata
from collections import OrderedDict
from decimal import Decimal
from typing import Any


VERSION = "stct-network-contract-v1.8"
MAX_DEPTH = 24
MAX_ARRAY_LENGTH = 5000
MAX_STRING_LENGTH = 2048
DANGEROUS_KEYS = {"__proto__", "prototype", "constructor"}


class NetworkContractError(ValueError):
    def __init__(self, code: str, message: str, detail: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.detail = detail or {}


def fail(code: str, message: str, **detail: Any) -> None:
    raise NetworkContractError(code, message, detail)


def normalize_text(value: Any, field: str = "value", allow_empty: bool = True) -> str:
    if not isinstance(value, str):
        fail("NETWORK_TYPE_ERROR", f"{field} must be a string.", field=field, value_type=type(value).__name__)
    result = unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n")).strip()
    if not allow_empty and not result:
        fail("NETWORK_REQUIRED_FIELD", f"{field} is required.", field=field)
    if len(result) > MAX_STRING_LENGTH:
        fail("NETWORK_STRING_LIMIT", f"{field} exceeds the string limit.", field=field)
    return result


def safe_value(value: Any, field: str = "value", depth: int = 0) -> Any:
    if depth > MAX_DEPTH:
        fail("NETWORK_DEPTH_LIMIT", f"{field} exceeds the object depth limit.", field=field, depth=depth)
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, str):
        return normalize_text(value, field)
    if isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > 9007199254740991:
            fail("NETWORK_INTEGER_ERROR", f"{field} exceeds the JavaScript safe integer range.", field=field)
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            fail("NETWORK_NUMBER_ERROR", f"{field} must be finite.", field=field)
        return 0 if value == 0 else value
    if isinstance(value, list):
        if len(value) > MAX_ARRAY_LENGTH:
            fail("NETWORK_ARRAY_LIMIT", f"{field} exceeds the array limit.", field=field)
        return [safe_value(item, f"{field}[{index}]", depth + 1) for index, item in enumerate(value)]
    if isinstance(value, dict):
        normalized: dict[str, Any] = {}
        for raw_key, item in value.items():
            key = normalize_text(raw_key, f"{field}.key", allow_empty=False)
            if key in DANGEROUS_KEYS:
                fail("NETWORK_DANGEROUS_KEY", f"{field} contains a dangerous key.", field=field, key=key)
            if key in normalized:
                fail("NETWORK_DUPLICATE_CANONICAL_KEY", f"{field} contains duplicate canonical keys.", field=field, key=key)
            normalized[key] = safe_value(item, f"{field}.{key}", depth + 1)
        return normalized
    fail("NETWORK_TYPE_ERROR", f"{field} contains an unsupported value.", field=field, value_type=type(value).__name__)


def number_string(value: int | float) -> str:
    if isinstance(value, int):
        return str(value)
    if value == 0:
        return "0"
    absolute = abs(value)
    if 1e-6 <= absolute < 1e21:
        decimal = Decimal(repr(value))
        result = format(decimal, "f").rstrip("0").rstrip(".")
        return "0" if result in {"-0", ""} else result
    mantissa, exponent = format(value, ".15e").split("e")
    mantissa = mantissa.rstrip("0").rstrip(".")
    exponent_value = int(exponent)
    sign = "+" if exponent_value >= 0 else ""
    return f"{mantissa}e{sign}{exponent_value}"


def canonical_string(value: Any) -> str:
    value = safe_value(value)

    def encode(item: Any) -> str:
        if item is None:
            return "null"
        if isinstance(item, bool):
            return "true" if item else "false"
        if isinstance(item, str):
            return json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        if isinstance(item, (int, float)) and not isinstance(item, bool):
            return number_string(item)
        if isinstance(item, list):
            return "[" + ",".join(encode(child) for child in item) + "]"
        if isinstance(item, dict):
            keys = sorted(item, key=lambda key: key.encode("utf-8"))
            return "{" + ",".join(f"{json.dumps(key, ensure_ascii=False)}:{encode(item[key])}" for key in keys) + "}"
        fail("NETWORK_TYPE_ERROR", "Unsupported canonical value.", value_type=type(item).__name__)

    return encode(value)


def hash_value(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_string(value).encode("utf-8")).hexdigest()


def content_projection(scenario: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in scenario.items() if key not in {"policies", "constraints", "assumptions", "routingContext"}}


def identity_from_normalized(scenario: dict[str, Any], solve_options: dict[str, Any] | None = None) -> dict[str, Any]:
    scenario = safe_value(scenario, "NetworkScenario")
    content = content_projection(scenario)
    network_content_hash = hash_value(content)
    network_input_hash = hash_value({
        "content": content,
        "policies": scenario.get("policies", {}),
        "constraints": scenario.get("constraints", {}),
        "assumptions": scenario.get("assumptions", {}),
    })
    routing_context_hash = hash_value(scenario.get("routingContext", {}))
    solve_context_hash = hash_value({
        "networkInputHash": network_input_hash,
        "routingContextHash": routing_context_hash,
        "solveOptions": safe_value(solve_options or {}, "solveOptions"),
    })
    return {
        "schemaVersion": "stct-network-identity-v1.8",
        "canonicalVersion": VERSION,
        "networkContentHash": network_content_hash,
        "networkInputHash": network_input_hash,
        "routingContextHash": routing_context_hash,
        "solveContextHash": solve_context_hash,
    }


def cli() -> int:
    payload = json.load(sys.stdin)
    mode = payload.get("mode", "canonical") if isinstance(payload, dict) else "canonical"
    value = payload.get("value") if isinstance(payload, dict) and "value" in payload else payload
    try:
        if mode == "canonical":
            result = {"status": "PASS", "canonical": canonical_string(value), "hash": hash_value(value)}
        elif mode == "identity":
            result = {"status": "PASS", **identity_from_normalized(value, payload.get("solveOptions", {}))}
        elif mode == "batch":
            results = []
            for case in payload.get("cases", []):
                try:
                    results.append({"id": case.get("id"), "status": "PASS", "canonical": canonical_string(case.get("value")), "hash": hash_value(case.get("value"))})
                except NetworkContractError as error:
                    results.append({"id": case.get("id"), "status": "REJECTED", "code": error.code})
            result = {"status": "PASS", "count": len(results), "results": results}
        else:
            fail("NETWORK_CLI_MODE", "Unsupported CLI mode.", mode=mode)
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    except NetworkContractError as error:
        print(json.dumps({"status": "REJECTED", "code": error.code, "detail": error.detail}, ensure_ascii=False, separators=(",", ":")))
        return 2


if __name__ == "__main__":
    raise SystemExit(cli())
