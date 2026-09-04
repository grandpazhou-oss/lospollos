#!/usr/bin/env bash
set -uo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="release"
if [ "${1:-}" = "--mode" ]; then MODE="${2:-}"; shift 2; fi
case "$MODE" in release|fallback|external-disabled|static|browser) ;; *) printf 'Usage: %s --mode release|fallback|external-disabled|static|browser\n' "$0" >&2; exit 2 ;; esac
RESULT_DIR="${STCT_V16_RESULT_DIR:-/tmp/lospollos-v1.6-${MODE}-results-$(date +%Y%m%d_%H%M%S)}"
NODE_BIN="${STCT_NODE_BIN:-node}"
PYTHON_BIN="${STCT_PYTHON_BIN:-python3}"
mkdir -p "$RESULT_DIR"
TSV="$RESULT_DIR/suites.tsv"
: > "$TSV"

record_suite() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >> "$TSV"; printf '%-38s %s\n' "$1" "$2"; }
run_suite() {
  local name="$1" output code status
  shift
  output="$RESULT_DIR/$name.txt"
  (cd "$ROOT" && "$@") >"$output" 2>&1
  code=$?
  if [ "$code" -ne 0 ]; then status="FAIL"
  elif grep -q 'BLOCKED_ENVIRONMENT' "$output"; then status="BLOCKED_ENVIRONMENT"
  elif grep -q 'SKIPPED_DEPENDENCY' "$output"; then status="SKIPPED_DEPENDENCY"
  elif grep -q 'DISABLED_BY_CONFIGURATION' "$output"; then status="DISABLED_BY_CONFIGURATION"
  elif grep -q 'BLOCKED_MEASUREMENT' "$output"; then status="BLOCKED_MEASUREMENT"
  else status="PASS"
  fi
  record_suite "$name" "$status" "$code" "$output"
}
blocked() { local output="$RESULT_DIR/$1.txt"; printf 'BLOCKED_ENVIRONMENT: %s\n' "$2" > "$output"; record_suite "$1" "BLOCKED_ENVIRONMENT" 1 "$output"; }

run_v16_core() {
  run_suite goal-coverage-v16 "$NODE_BIN" tests/test_goal_coverage_v16.js
  run_suite static-v16 "$NODE_BIN" tests/test_static_v16.js
  run_suite routing-provider-v16 "$NODE_BIN" tests/test_routing_provider_v16.js
  run_suite road-routing-v16 "$NODE_BIN" tests/test_road_routing_v16.js
  run_suite routing-contract-python "$PYTHON_BIN" -m unittest -v tests/test_routing_contract_v16.py
  run_suite execution-twin-v16 "$NODE_BIN" tests/test_execution_twin_v16.js
  run_suite plan-vs-actual-v16 "$NODE_BIN" tests/test_plan_vs_actual_v16.js
  run_suite operations-alerts-v16 "$NODE_BIN" tests/test_operations_alerts_v16.js
  run_suite driver-simulator-v16 "$NODE_BIN" tests/test_driver_simulator_v16.js
  run_suite dynamic-capsule-v16 "$NODE_BIN" tests/test_dynamic_operations_capsule_v16.js
}
run_v151_regression() {
  if [ -n "${STCT_V16_BASELINE:-}" ] && [ -n "${STCT_V151_DELIVERY:-}" ]; then
    run_suite gate0-v16 "$NODE_BIN" tests/test_gate0_v16.js "$STCT_V16_BASELINE" "$STCT_V151_DELIVERY"
  else
    blocked gate0-v16 "STCT_V16_BASELINE and STCT_V151_DELIVERY are required for Gate 0 evidence verification."
  fi
  run_suite v151-integrity-hash "$NODE_BIN" tests/test_integrity_hash_v151.js
  run_suite v151-pareto-integrity "$NODE_BIN" tests/test_pareto_integrity_v151.js
  run_suite v151-recovery-matrix "$NODE_BIN" tests/test_recovery_matrix_context_v151.js
  run_suite v151-derived-scenario bash tests/test_derived_scenario_identity_v151.sh
  run_suite v151-capsule-integrity "$NODE_BIN" tests/test_capsule_deep_integrity_v151.js
}
run_browser() {
  if [ -z "${STCT_V16_BASE_URL:-}" ]; then blocked browser-v16 "STCT_V16_BASE_URL is required."; return; fi
  if ! "$NODE_BIN" -e 'require("playwright")' >/dev/null 2>&1; then blocked browser-v16 "Playwright is unavailable to STCT_NODE_BIN/NODE_PATH."; return; fi
  run_suite browser-v16 "$NODE_BIN" tests/test_dynamic_operations_browser_v16.js --base-url "$STCT_V16_BASE_URL" --evidence "$RESULT_DIR/browser-evidence.json" --screenshots "$RESULT_DIR/screenshots"
}

case "$MODE" in
  release)
    run_v151_regression
    run_v16_core
    run_suite rolling-reoptimization-v16 "$NODE_BIN" tests/test_rolling_reoptimization_v16.js
    run_suite execution-recovery-v16 "$NODE_BIN" tests/test_execution_recovery_v16.js
    run_browser
    ;;
  fallback)
    run_v16_core
    run_suite fallback-v16 "$NODE_BIN" tests/test_fallback_v16.js
    ;;
  external-disabled)
    run_suite external-provider-disabled "$NODE_BIN" tests/test_fallback_v16.js
    ;;
  static)
    run_v151_regression
    run_v16_core
    ;;
  browser)
    run_browser
    ;;
esac

"$NODE_BIN" "$ROOT/tests/summarize_v16.js" "$TSV" "$RESULT_DIR/STCT-v1.6-TEST_SUMMARY.json" "$RESULT_DIR/STCT-v1.6-TEST_SUMMARY.md" "$MODE"
summary_code=$?
printf 'RESULT_DIR=%s\n' "$RESULT_DIR"
exit "$summary_code"
