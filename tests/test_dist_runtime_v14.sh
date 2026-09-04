#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ZIP_PATH="${1:-}"
if [ -z "$ZIP_PATH" ] || [ ! -f "$ZIP_PATH" ]; then
  echo "Usage: $0 /path/to/lospollos-v1.4-demo-dist.zip" >&2
  exit 2
fi

for command_name in curl node python3 shasum unzip; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "BLOCKED_ENVIRONMENT: missing $command_name" >&2; exit 1; }
done

BROWSER_NODE="${STCT_BROWSER_NODE:-$(command -v node)}"
BROWSER_NODE_PATH="${STCT_NODE_PATH:-${NODE_PATH:-}}"
if ! NODE_PATH="$BROWSER_NODE_PATH" "$BROWSER_NODE" -e 'require("playwright")' >/dev/null 2>&1; then
  echo "BLOCKED_ENVIRONMENT: Playwright is not available to STCT_BROWSER_NODE/STCT_NODE_PATH." >&2
  exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/stct-v14-dist-runtime.XXXXXX")"
EXTRACT_ROOT="$WORK/extracted"
RELEASE_RUN="$WORK/run-release"
FALLBACK_RUN="$WORK/run-fallback"
EVIDENCE="$WORK/evidence"
mkdir -p "$EXTRACT_ROOT" "$EVIDENCE/release/screenshots" "$EVIDENCE/fallback/screenshots"

DIST_DIR=""
cleanup() {
  if [ -n "$DIST_DIR" ] && [ -x "$DIST_DIR/stop_demo.sh" ]; then
    STCT_RUN_DIR="$RELEASE_RUN" "$DIST_DIR/stop_demo.sh" >/dev/null 2>&1 || true
    STCT_RUN_DIR="$FALLBACK_RUN" "$DIST_DIR/stop_demo.sh" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

read -r RELEASE_WEB RELEASE_OPT FALLBACK_WEB FALLBACK_OPT < <(python3 - <<'PY'
import socket

sockets = []
ports = []
for _ in range(4):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sockets.append(sock)
    ports.append(str(sock.getsockname()[1]))
print(" ".join(ports))
for sock in sockets:
    sock.close()
PY
)

unzip -q "$ZIP_PATH" -d "$EXTRACT_ROOT"
root_count="$(find "$EXTRACT_ROOT" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
if [ "$root_count" -ne 1 ]; then
  echo "Expected one distribution root after extraction." >&2
  exit 1
fi
DIST_DIR="$(find "$EXTRACT_ROOT" -mindepth 1 -maxdepth 1 -type d -print)"

(cd "$DIST_DIR" && shasum -a 256 -c SHA256SUMS.txt >"$EVIDENCE/manifest-release.txt")

STCT_RUN_DIR="$RELEASE_RUN" WEB_PORT="$RELEASE_WEB" OPT_PORT="$RELEASE_OPT" "$DIST_DIR/start_demo.sh" >"$EVIDENCE/release/start.txt"
curl -fsS "http://127.0.0.1:$RELEASE_OPT/health" >"$EVIDENCE/release/health.json"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["available"] is True and d["actualOrtoolsVersion"] == "9.15.6755"' "$EVIDENCE/release/health.json"
curl -fsS "http://127.0.0.1:$RELEASE_WEB/index.html" >"$EVIDENCE/release/home.html"
curl -fsS "http://127.0.0.1:$RELEASE_WEB/style.css" >/dev/null
curl -fsS "http://127.0.0.1:$RELEASE_WEB/experience-ui-v14.js" >/dev/null
curl -fsS "http://127.0.0.1:$RELEASE_WEB/assets/demo/stct-synthetic-demo.json" >"$EVIDENCE/release/synthetic.json"
test "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$RELEASE_WEB/.git/config")" = "404"

NODE_PATH="$BROWSER_NODE_PATH" "$BROWSER_NODE" "$ROOT/tests/test_experience_browser_v14.js" \
  --base-url "http://127.0.0.1:$RELEASE_WEB/index.html?optPort=$RELEASE_OPT" \
  --evidence "$EVIDENCE/release/browser.json" \
  --screenshots "$EVIDENCE/release/screenshots"
node "$ROOT/tests/test_browser_evidence_v14.js" "$EVIDENCE/release/browser.json" >"$EVIDENCE/release/browser-validation.json"

STCT_RUN_DIR="$RELEASE_RUN" "$DIST_DIR/stop_demo.sh" >"$EVIDENCE/release/stop-1.txt"
STCT_RUN_DIR="$RELEASE_RUN" "$DIST_DIR/stop_demo.sh" >"$EVIDENCE/release/stop-2.txt"
test ! -f "$RELEASE_RUN/web.pid"
test ! -f "$RELEASE_RUN/optimizer.pid"

DISABLE_ORTOOLS=1 STCT_RUN_DIR="$FALLBACK_RUN" WEB_PORT="$FALLBACK_WEB" OPT_PORT="$FALLBACK_OPT" "$DIST_DIR/start_demo.sh" >"$EVIDENCE/fallback/start.txt"
curl -fsS "http://127.0.0.1:$FALLBACK_OPT/health" >"$EVIDENCE/fallback/health.json"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["available"] is False and d["engine"] == "Demo Heuristic"' "$EVIDENCE/fallback/health.json"
NODE_PATH="$BROWSER_NODE_PATH" "$BROWSER_NODE" "$ROOT/tests/test_experience_browser_v14.js" \
  --only fallback \
  --base-url "http://127.0.0.1:$FALLBACK_WEB/index.html?optPort=$FALLBACK_OPT" \
  --evidence "$EVIDENCE/fallback/browser.json" \
  --screenshots "$EVIDENCE/fallback/screenshots"
STCT_RUN_DIR="$FALLBACK_RUN" "$DIST_DIR/stop_demo.sh" >"$EVIDENCE/fallback/stop-1.txt"
STCT_RUN_DIR="$FALLBACK_RUN" "$DIST_DIR/stop_demo.sh" >"$EVIDENCE/fallback/stop-2.txt"
test ! -f "$FALLBACK_RUN/web.pid"
test ! -f "$FALLBACK_RUN/optimizer.pid"

printf '{"status":"PASS","randomExtract":"PASS","manifest":"PASS","release":"PASS","fallback":"PASS","repeatStop":"PASS","evidence":"%s"}\n' "$EVIDENCE"
trap - EXIT
