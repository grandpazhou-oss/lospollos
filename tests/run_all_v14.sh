#!/usr/bin/env bash
set -uo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="release"
if [ "${1:-}" = "--mode" ]; then MODE="${2:-}"; shift 2; fi
case "$MODE" in release|fallback|static|browser) ;; *) echo "Usage: $0 --mode release|fallback|static|browser" >&2; exit 2 ;; esac

RESULT_DIR="${STCT_TEST_RESULT_DIR:-/tmp/lospollos-v1.4-${MODE}-results-$(date +%Y%m%d_%H%M%S)}"
mkdir -p "$RESULT_DIR"
TSV="$RESULT_DIR/suites.tsv"
: > "$TSV"

record_suite() {
  local name="$1" status="$2" code="$3" evidence="$4"
  printf '%s\t%s\t%s\t%s\n' "$name" "$status" "$code" "$evidence" >> "$TSV"
  printf '%-32s %s\n' "$name" "$status"
}

run_suite() {
  local name="$1"
  shift
  local output="$RESULT_DIR/$name.txt" code status
  (cd "$ROOT" && "$@") >"$output" 2>&1
  code=$?
  if [ "$code" -ne 0 ]; then
    status="FAIL"
  elif grep -q 'SKIPPED_DEPENDENCY' "$output"; then
    status="SKIPPED_DEPENDENCY"
  elif grep -q 'BLOCKED_ENVIRONMENT' "$output"; then
    status="BLOCKED_ENVIRONMENT"
  else
    status="PASS"
  fi
  record_suite "$name" "$status" "$code" "$output"
}

skip_dependency() {
  local name="$1" reason="$2" output
  output="$RESULT_DIR/$name.txt"
  printf 'SKIPPED_DEPENDENCY: %s\n' "$reason" > "$output"
  record_suite "$name" "SKIPPED_DEPENDENCY" 0 "$output"
}

summarize() {
  python3 "$ROOT/tests/summarize_v14.py" "$TSV" "$RESULT_DIR/test-summary.json" "$RESULT_DIR/test-summary.txt" "$MODE"
  cat "$RESULT_DIR/test-summary.txt"
  printf 'RESULT_DIR=%s\n' "$RESULT_DIR"
  python3 -c 'import json,sys; raise SystemExit(0 if json.load(open(sys.argv[1]))["status"] == "PASS" else 1)' "$RESULT_DIR/test-summary.json"
}

run_static_suites() {
  run_suite static bash tests/test_static_v13.sh
  run_suite canonical-closure-js node tests/test_canonical_closure_v131.js
  run_suite canonical-closure-python python3 -m unittest -v tests/test_canonical_closure_v131.py
  run_suite canonical-v13-js node tests/test_canonical_v13.js
  run_suite canonical-v13-python python3 -m unittest -v tests/test_canonical_v13.py
  run_suite verifier node tests/test_verifier_v13.js
  run_suite date-semantics node tests/test_date_semantics_v13.js
  run_suite priority node tests/test_priority_v13.js
  run_suite manual node tests/test_manual_v13.js
  run_suite i18n node tests/test_i18n_v13.js
  run_suite runtime-boot node tests/test_runtime_boot_v13.js
  run_suite synthetic-data node tests/test_synthetic_data_v14.js
  run_suite experience-state node tests/test_experience_state_v14.js
  run_suite replay-v14 node tests/test_replay_v14.js
  run_suite scenario-arena-v14 node tests/test_scenario_arena_v14.js
  run_suite timeline-v14 node tests/test_timeline_v14.js
  run_suite demo-director-v14 node tests/test_demo_director_v14.js
  run_suite audit-redaction node tests/test_audit_redaction_v14.js
  run_suite dist bash tests/test_dist_v14.sh
}

if [ "$MODE" = "release" ]; then
  dependency_output="$RESULT_DIR/ortools-dependency.txt"
  if python3 -c 'import ortools,sys; raise SystemExit(0 if ortools.__version__ == "9.15.6755" else 1)' >"$dependency_output" 2>&1; then
    printf 'ortools==9.15.6755\n' >> "$dependency_output"
    record_suite ortools-dependency PASS 0 "$dependency_output"
  else
    printf 'BLOCKED_ENVIRONMENT: release requires ortools==9.15.6755\n' >> "$dependency_output"
    record_suite ortools-dependency BLOCKED_ENVIRONMENT 1 "$dependency_output"
    summarize
    exit $?
  fi
  run_static_suites
  run_suite optimizer python3 -m unittest -v tests/test_optimizer_v13.py
  run_suite identity-http bash tests/test_identity_http_v13.sh
  run_suite solver-verifier bash tests/test_solver_verifier_v13.sh
  run_suite multiday-solver bash tests/test_multiday_solver_v13.sh
  run_suite what-if bash tests/test_whatif_v13.sh
  run_suite fallback-e2e node tests/test_fallback_v131.js
  if [ -f "$ROOT/tests/test_performance_v14.sh" ]; then run_suite performance bash tests/test_performance_v14.sh; else run_suite performance bash tests/test_performance_v13.sh; fi
  run_suite start-stop bash tests/test_start_stop_v13.sh
elif [ "$MODE" = "fallback" ]; then
  run_static_suites
  run_suite fallback-e2e node tests/test_fallback_v131.js
  skip_dependency optimizer "OR-Tools service suite is intentionally disabled in fallback mode."
  skip_dependency identity-http "OR-Tools HTTP identity suite is intentionally disabled in fallback mode."
  skip_dependency solver-verifier "OR-Tools solver parity suite is intentionally disabled in fallback mode."
  skip_dependency multiday-solver "OR-Tools multi-day solver suite is intentionally disabled in fallback mode."
  skip_dependency performance "OR-Tools performance suite is intentionally disabled in fallback mode."
elif [ "$MODE" = "static" ]; then
  run_static_suites
else
  run_static_suites
  if [ -n "${STCT_BROWSER_EVIDENCE:-}" ] && [ -f "$STCT_BROWSER_EVIDENCE" ]; then
    run_suite browser-evidence node tests/test_browser_evidence_v14.js "$STCT_BROWSER_EVIDENCE"
  else
    output="$RESULT_DIR/browser-evidence.txt"
    printf 'BLOCKED_ENVIRONMENT: set STCT_BROWSER_EVIDENCE to the current browser QA JSON.\n' > "$output"
    record_suite browser-evidence BLOCKED_ENVIRONMENT 1 "$output"
  fi
  if [ -n "${STCT_EXPERIENCE_PERFORMANCE_EVIDENCE:-}" ] && [ -f "$STCT_EXPERIENCE_PERFORMANCE_EVIDENCE" ]; then
    run_suite experience-performance-evidence node tests/test_experience_performance_evidence_v14.js "$STCT_EXPERIENCE_PERFORMANCE_EVIDENCE"
  else
    output="$RESULT_DIR/experience-performance-evidence.txt"
    printf 'BLOCKED_ENVIRONMENT: set STCT_EXPERIENCE_PERFORMANCE_EVIDENCE to the current Experience performance JSON.\n' > "$output"
    record_suite experience-performance-evidence BLOCKED_ENVIRONMENT 1 "$output"
  fi
fi

summarize
