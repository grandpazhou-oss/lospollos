#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${STCT_WHATIF_PORT:-19133}"
LOG="$(mktemp "${TMPDIR:-/tmp}/stct-whatif.XXXXXX")"
OPT_PORT="$PORT" python3 "$ROOT/optimizer/ortools_service.py" >"$LOG" 2>&1 &
pid=$!
cleanup() { kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; rm -f "$LOG"; }
trap cleanup EXIT
for _ in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.1
done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null
OPTIMIZER_URL="http://127.0.0.1:$PORT" node "$ROOT/tests/test_whatif_v13.js"
