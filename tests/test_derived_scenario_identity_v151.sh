#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${STCT_DERIVED_IDENTITY_PORT:-19131}"
LOG="$(mktemp "${TMPDIR:-/tmp}/stct-derived-identity.XXXXXX")"
OPT_PORT="$PORT" python3 "$ROOT/optimizer/ortools_service.py" >"$LOG" 2>&1 &
pid=$!
cleanup() { kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; rm -f "$LOG"; }
trap cleanup EXIT
for _ in $(seq 1 50); do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.1
done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null
OPTIMIZER_URL="http://127.0.0.1:$PORT" node "$ROOT/tests/test_derived_scenario_identity_v151.js"
