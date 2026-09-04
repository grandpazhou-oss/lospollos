#!/usr/bin/env python3
"""Small, local-only OR-Tools execution probe for STCT v1.8."""

from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from typing import Any

import ortools
from ortools.constraint_solver import pywrapcp, routing_enums_pb2


SCHEMA = "stct-ortools-probe-v1.8"


def solve_probe(node_count: int = 12) -> dict[str, Any]:
    if node_count < 3 or node_count > 500:
        raise ValueError("node_count must be between 3 and 500")
    matrix = [[abs(left - right) + (0 if left == right else 1) for right in range(node_count)] for left in range(node_count)]
    manager = pywrapcp.RoutingIndexManager(node_count, 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    def distance(from_index: int, to_index: int) -> int:
        return matrix[manager.IndexToNode(from_index)][manager.IndexToNode(to_index)]

    callback = routing.RegisterTransitCallback(distance)
    routing.SetArcCostEvaluatorOfAllVehicles(callback)
    parameters = pywrapcp.DefaultRoutingSearchParameters()
    parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    parameters.time_limit.seconds = 2
    started = time.perf_counter()
    solution = routing.SolveWithParameters(parameters)
    elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
    if solution is None:
        return {"schemaVersion": SCHEMA, "status": "FAIL", "actualOrtoolsRun": True, "engineVersion": ortools.__version__, "reasonCode": "NO_SOLUTION", "elapsedMs": elapsed_ms}
    route: list[int] = []
    index = routing.Start(0)
    while not routing.IsEnd(index):
        route.append(manager.IndexToNode(index))
        index = solution.Value(routing.NextVar(index))
    route.append(manager.IndexToNode(index))
    return {"schemaVersion": SCHEMA, "status": "PASS", "actualOrtoolsRun": True, "engine": "OR_TOOLS", "engineVersion": ortools.__version__, "pythonVersion": platform.python_version(), "nodeCount": node_count, "route": route, "objective": solution.ObjectiveValue(), "elapsedMs": elapsed_ms, "publicRoutingCalls": 0}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--nodes", type=int, default=12)
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args()
    try:
        result = solve_probe(args.nodes)
    except Exception as error:  # pragma: no cover - CLI boundary
        result = {"schemaVersion": SCHEMA, "status": "FAIL", "actualOrtoolsRun": False, "reasonCode": type(error).__name__, "message": str(error)}
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":") if args.compact else None))
    return 0 if result["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
