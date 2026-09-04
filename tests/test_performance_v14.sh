#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${STCT_PERFORMANCE_PORT:-19117}"
LOG="$(mktemp "${TMPDIR:-/tmp}/stct-v14-performance.XXXXXX")"
OPT_PORT="$PORT" python3 "$ROOT/optimizer/ortools_service.py" >"$LOG" 2>&1 &
pid=$!
cleanup() { kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; rm -f "$LOG"; }
trap cleanup EXIT
for _ in $(seq 1 80); do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.1
done
health="$(curl -fsS "http://127.0.0.1:$PORT/health")"
python3 -c 'import json,sys; body=json.loads(sys.argv[1]); assert body["available"] is True; assert body["actualOrtoolsVersion"] == "9.15.6755"' "$health"
OPTIMIZER_URL="http://127.0.0.1:$PORT" node "$ROOT/tests/test_performance_v13.js"
