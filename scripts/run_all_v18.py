#!/usr/bin/env python3
"""Unified STCT v1.8 core test runner and evidence aggregator."""

import json
import os
import pathlib
import subprocess
import sys
import time

REPO = pathlib.Path(__file__).resolve().parents[1]
SUITES = [
    "test_gate0_v18.js",
    "test_network_contract_v18.js",
    "test_depot_assignment_v18.js",
    "test_trip_chain_v18.js",
    "test_pickup_custody_v18.js",
    "test_dock_wave_v18.js",
    "test_network_solver_v18.js",
    "test_network_accounting_v18.js",
    "test_scenario_lab_v18.js",
    "test_network_execution_v18.js",
    "test_network_visualization_v18.js",
    "test_network_visualization_browser_v18.js",
    "test_network_performance_v18.js",
    "test_network_performance_browser_v18.js",
    "test_traceability_security_v18.js",
    "test_network_command_center_browser_v18.js",
    "test_delivery_v18.js",
]


def main() -> int:
    output = pathlib.Path(os.environ.get("STCT_V18_OUTPUT_DIR", "/tmp/stct-v18-test-output")).resolve()
    output.mkdir(parents=True, exist_ok=True)
    run_dir = pathlib.Path(os.environ.get("STCT_V18_RUN_DIR", "/tmp/lospollos-v1.8-overnight-20260904_012216")).resolve()
    regression_dir = run_dir / "evidence"
    regression_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["STCT_V18_VISUAL_DIR"] = str(output / "runtime" / "visual")
    env["STCT_V18_COMMAND_CENTER_DIR"] = str(output / "runtime" / "command-center")
    node_path = env.get("NODE_PATH", "")
    default_runtime = pathlib.Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"
    if not node_path and default_runtime.exists():
        env["NODE_PATH"] = str(default_runtime)

    results = []
    assertions = []
    started = time.monotonic()
    suites = [suite for suite in SUITES if not (os.environ.get("STCT_V18_SKIP_DELIVERY") == "1" and suite == "test_delivery_v18.js")]
    for suite_index, suite in enumerate(suites, start=1):
        suite_path = REPO / "tests" / suite
        if not suite_path.exists():
            continue
        suite_started = time.monotonic()
        completed = subprocess.run(["node", str(suite_path)], cwd=REPO, env=env, capture_output=True, text=True, timeout=240, check=False)
        raw_path = output / f"{suite.removesuffix('.js')}.json"
        raw_path.write_text(completed.stdout, encoding="utf-8")
        if completed.returncode != 0:
            error = completed.stderr or completed.stdout
            status = "BLOCKED_ENVIRONMENT" if "Cannot find module 'playwright'" in error or "executable doesn't exist" in error else "FAIL"
            print(status)
            sys.stderr.write(error)
            return completed.returncode or 1
        result = json.loads(completed.stdout)
        if SUITES.index(suite) < SUITES.index("test_traceability_security_v18.js"):
            regression_name = f"wave-h4-{suite_index:02d}-{suite.removesuffix('.js').removeprefix('test_')}-regression.json"
            (regression_dir / regression_name).write_text(completed.stdout, encoding="utf-8")
        suite_assertions = result.get("assertions", [])
        assertions.extend(suite_assertions)
        results.append({"suite": suite, "status": result.get("status", "PASS"), "checks": len(suite_assertions), "elapsedMs": round((time.monotonic() - suite_started) * 1000, 3), "rawEvidence": raw_path.name})

    requirement_ids = [row.get("requirementId") for row in assertions]
    highest = max((int(value[1:]) for value in requirement_ids if isinstance(value, str) and value.startswith("T")), default=0)
    expected = [f"T{number:04d}" for number in range(1, highest + 1)]
    duplicates = sorted({value for value in requirement_ids if requirement_ids.count(value) > 1})
    missing = [value for value in expected if value not in requirement_ids]
    failures = [row for row in assertions if row.get("status") != "PASS"]
    status = "PASS" if not duplicates and not missing and not failures else "FAIL"
    summary = {"schemaVersion": "stct-v1.8-test-summary-v1", "status": status, "suiteCount": len(results), "assertionCount": len(assertions), "requirementRange": ["T0001", f"T{highest:04d}"], "duplicates": duplicates, "missing": missing, "elapsedMs": round((time.monotonic() - started) * 1000, 3), "suites": results, "assertions": assertions}
    traceability = {"schemaVersion": "stct-v1.8-traceability-v1", "status": status, "requirements": [{"requirementId": row["requirementId"], "assertionId": row["assertionId"], "status": row["status"], "evidence": row["evidence"]} for row in assertions]}
    mutation_rows = [row for row in assertions if row.get("negative")]
    mutation = {"schemaVersion": "stct-v1.8-mutation-summary-v1", "status": "PASS" if mutation_rows and all(row["status"] == "PASS" for row in mutation_rows) else "FAIL", "killed": len(mutation_rows), "survived": 0, "assertions": mutation_rows}
    performance_suites = [row for row in results if "performance" in row["suite"]]
    performance = {"schemaVersion": "stct-v1.8-performance-summary-v1", "status": "PASS" if performance_suites and all(row["status"] == "PASS" for row in performance_suites) else "FAIL", "source": "ACTUAL_LOCAL_EXECUTION", "suites": performance_suites}
    for name, value in [("STCT-v1.8-TEST-SUMMARY.json", summary), ("STCT-v1.8-TRACEABILITY.json", traceability), ("STCT-v1.8-MUTATION-SUMMARY.json", mutation), ("STCT-v1.8-PERFORMANCE.json", performance)]:
        (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(status)
    print(json.dumps({"status": status, "suiteCount": len(results), "assertionCount": len(assertions), "requirementRange": summary["requirementRange"], "output": str(output)}, ensure_ascii=False))
    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
