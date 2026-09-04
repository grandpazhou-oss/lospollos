#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/stct-start-stop.XXXXXX")"
WEB_PORT="${STCT_TEST_WEB_PORT:-19115}"
OPT_PORT="${STCT_TEST_OPT_PORT:-19117}"
cleanup() { STCT_RUN_DIR="$RUN_DIR" "$ROOT/stop_demo.sh" >/dev/null 2>&1 || true; rm -rf "$RUN_DIR"; }
trap cleanup EXIT

STCT_FORCE_SOCKET_FALLBACK=1 STCT_RUN_DIR="$RUN_DIR" WEB_PORT="$WEB_PORT" OPT_PORT="$OPT_PORT" "$ROOT/start_demo.sh" >/tmp/stct-start-v13-1.txt
web_pid="$(cat "$RUN_DIR/web.pid")"
opt_pid="$(cat "$RUN_DIR/optimizer.pid")"
STCT_FORCE_SOCKET_FALLBACK=1 STCT_RUN_DIR="$RUN_DIR" WEB_PORT="$WEB_PORT" OPT_PORT="$OPT_PORT" "$ROOT/start_demo.sh" >/tmp/stct-start-v13-2.txt
test "$(cat "$RUN_DIR/web.pid")" = "$web_pid"
test "$(cat "$RUN_DIR/optimizer.pid")" = "$opt_pid"
curl -fsS "http://127.0.0.1:$WEB_PORT/index.html" >/dev/null
curl -fsS "http://127.0.0.1:$OPT_PORT/health" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["available"] and d["actualOrtoolsVersion"] == "9.15.6755"'
STCT_RUN_DIR="$RUN_DIR" "$ROOT/stop_demo.sh" >/dev/null
STCT_RUN_DIR="$RUN_DIR" "$ROOT/stop_demo.sh" >/dev/null
printf '{"status":"PASS","checks":7,"socketFallback":true,"repeatStart":true,"repeatStop":true}\n'
