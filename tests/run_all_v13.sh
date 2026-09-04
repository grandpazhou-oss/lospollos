#!/usr/bin/env bash
set -uo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
RESULT_DIR="${STCT_TEST_RESULT_DIR:-/tmp/lospollos-v1.3-test-results-$(date +%Y%m%d_%H%M%S)}"
mkdir -p "$RESULT_DIR"
TSV="$RESULT_DIR/suites.tsv"
: > "$TSV"

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
  else
    status="PASS"
  fi
  printf '%s\t%s\t%s\t%s\n' "$name" "$status" "$code" "$output" >> "$TSV"
  printf '%-28s %s\n' "$name" "$status"
}

run_suite static bash tests/test_static_v13.sh
run_suite canonical-js node tests/test_canonical_v13.js
run_suite canonical-python python3 -m unittest -v tests/test_canonical_v13.py
run_suite verifier node tests/test_verifier_v13.js
run_suite optimizer python3 -m unittest -v tests/test_optimizer_v13.py
run_suite identity-http bash tests/test_identity_http_v13.sh
run_suite solver-verifier bash tests/test_solver_verifier_v13.sh
run_suite date-semantics node tests/test_date_semantics_v13.js
run_suite multiday-solver bash tests/test_multiday_solver_v13.sh
run_suite what-if bash tests/test_whatif_v13.sh
run_suite performance bash tests/test_performance_v13.sh
run_suite priority node tests/test_priority_v13.js
run_suite manual node tests/test_manual_v13.js
run_suite i18n node tests/test_i18n_v13.js
run_suite runtime-boot node tests/test_runtime_boot_v13.js
run_suite start-stop bash tests/test_start_stop_v13.sh

python3 "$ROOT/tests/summarize_v13.py" "$TSV" "$RESULT_DIR/test-summary.json" "$RESULT_DIR/test-summary.txt"
cat "$RESULT_DIR/test-summary.txt"
printf 'RESULT_DIR=%s\n' "$RESULT_DIR"
python3 -c 'import json,sys; raise SystemExit(0 if json.load(open(sys.argv[1]))["fail"] == 0 else 1)' "$RESULT_DIR/test-summary.json"
