#!/usr/bin/env bash
set -uo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
RESULT_DIR="${STCT_V17_RESULT_DIR:-/tmp/stct-v17-results}"
DELIVERY_DIR="${STCT_V17_DELIVERY_DIR:-/Users/gz/Documents/STCT-v1.7-operational-truth-multi-vehicle-execution-20260831}"
DIST_DIR="${STCT_V17_DIST_DIR:-/tmp/lospollos-v1.7-demo-dist}"
AUDIT_DIR="${STCT_V17_AUDIT_DIR:-/tmp/lospollos-v1.7-audit-bundle}"
PORT="${STCT_V17_BROWSER_PORT:-19232}"
NODE_BIN="${STCT_NODE_BIN:-node}"
BUNDLED_NODE="${STCT_BROWSER_NODE_BIN:-/Users/gz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
BUNDLED_NODE_PATH="${STCT_BROWSER_NODE_PATH:-/Users/gz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules}"
rm -rf "$RESULT_DIR"; mkdir -p "$RESULT_DIR/browser"; : > "$RESULT_DIR/suites.tsv"
SERVER_PID=""
cleanup() { if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi; SERVER_PID=""; }
trap cleanup EXIT INT TERM
record() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >> "$RESULT_DIR/suites.tsv"; printf '%-34s %s\n' "$1" "$2"; }
run_suite() { local name="$1" output="$2"; shift 2; "$@" >"$output" 2>"$output.stderr"; local code=$? status=PASS; [ "$code" -ne 0 ] && status=FAIL; record "$name" "$status" "$code" "$output"; return "$code"; }

cd "$ROOT"
node scripts/generate_requirements_v17.js >/dev/null
run_suite baseline "$RESULT_DIR/baseline-command.json" node tests/test_baseline_protection_v17.js --evidence "$RESULT_DIR/baseline.json" || true
run_suite execution "$RESULT_DIR/execution.json" node tests/test_execution_state_machine_v17.js || true
run_suite offline "$RESULT_DIR/offline.json" node tests/test_offline_projection_v17.js || true
run_suite telemetry "$RESULT_DIR/telemetry.json" node tests/test_verified_telemetry_v17.js || true
run_suite multi-vehicle "$RESULT_DIR/multi-vehicle.json" node tests/test_multi_vehicle_execution_v17.js || true
run_suite domain "$RESULT_DIR/domain.json" node tests/test_domain_wiring_v17.js || true
run_suite capsule "$RESULT_DIR/capsule.json" node tests/test_capsule_replay_equivalence_v17.js || true
run_suite performance "$RESULT_DIR/performance-command.json" node tests/test_real_performance_v17.js --evidence "$RESULT_DIR/performance.json" || true
cp "$RESULT_DIR/performance.json" /tmp/stct-v17-real-performance.json 2>/dev/null || true
run_suite shift-review "$RESULT_DIR/shift-command.json" node tests/test_shift_review_flight_recorder_v17.js --evidence "$RESULT_DIR/shift-review.json" || true

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >"$RESULT_DIR/browser-server.log" 2>&1 & SERVER_PID=$!
for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:$PORT/index.html" >/dev/null 2>&1 && break; sleep .1; done
NODE_PATH="$BUNDLED_NODE_PATH" run_suite browser "$RESULT_DIR/browser-command.json" "$BUNDLED_NODE" tests/test_browser_accessibility_v17.js --base-url "http://127.0.0.1:$PORT/index.html?v=v17-final-gate" --evidence-dir "$RESULT_DIR/browser" || true
cleanup
rm -rf /tmp/stct-v17-browser-evidence-7; cp -R "$RESULT_DIR/browser" /tmp/stct-v17-browser-evidence-7

run_suite delivery-stage "$RESULT_DIR/delivery-stage.json" node scripts/assemble_delivery_v17.js --delivery-dir "$DELIVERY_DIR" --dist-dir "$DIST_DIR" --audit-dir "$AUDIT_DIR" --browser-dir "$RESULT_DIR/browser" --final-status PENDING_FINAL_GATE || true
run_suite traceability "$RESULT_DIR/traceability-command.json" node tests/test_traceability_v17.js --delivery-dir "$DELIVERY_DIR" --dist-dir "$DIST_DIR" --audit-dir "$AUDIT_DIR" --output-dir "$DELIVERY_DIR" || true
run_suite delivery-final-build "$RESULT_DIR/delivery-final-build.json" node scripts/assemble_delivery_v17.js --delivery-dir "$DELIVERY_DIR" --dist-dir "$DIST_DIR" --audit-dir "$AUDIT_DIR" --browser-dir "$RESULT_DIR/browser" --final-status COMPLETED || true
run_suite delivery "$RESULT_DIR/delivery-command.json" "$BUNDLED_NODE" tests/test_delivery_v17.js --delivery-dir "$DELIVERY_DIR" --dist-dir "$DIST_DIR" --audit-dir "$AUDIT_DIR" || true
run_suite summarize "$RESULT_DIR/summary-command.json" node tests/summarize_v17.js "$RESULT_DIR" "$DELIVERY_DIR" || true
run_suite delivery-repack "$RESULT_DIR/delivery-repack.json" node scripts/assemble_delivery_v17.js --delivery-dir "$DELIVERY_DIR" --dist-dir "$DIST_DIR" --audit-dir "$AUDIT_DIR" --browser-dir "$RESULT_DIR/browser" --final-status COMPLETED || true
run_suite delivery-final-verify "$RESULT_DIR/delivery-final-verify.json" "$BUNDLED_NODE" tests/test_delivery_v17.js --delivery-dir "$DELIVERY_DIR" --dist-dir "$DIST_DIR" --audit-dir "$AUDIT_DIR" || true

if awk -F '\t' '$2=="FAIL" || $3!=0 { bad=1 } END { exit bad ? 0 : 1 }' "$RESULT_DIR/suites.tsv"; then printf 'FAIL\n'; exit 1; fi
printf 'PASS\nRESULT_DIR=%s\nDELIVERY_DIR=%s\n' "$RESULT_DIR" "$DELIVERY_DIR"
