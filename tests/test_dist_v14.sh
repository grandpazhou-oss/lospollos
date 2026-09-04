#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/stct-v14-dist-test.XXXXXX")"
DIST="$WORK/dist"
ZIP="$WORK/dist.zip"
trap 'rm -rf "$WORK"' EXIT

OUTPUT="$(DIST_DIR="$DIST" ZIP_PATH="$ZIP" bash "$ROOT/scripts/build_demo_dist.sh")"
grep -q '^MANIFEST_STATUS=PASS$' <<<"$OUTPUT"
grep -q '^EXTRACTED_MANIFEST_STATUS=PASS$' <<<"$OUTPUT"
test -f "$DIST/SHA256SUMS.txt"
test -f "$DIST/assets/demo/stct-synthetic-demo.json"
test -f "$DIST/data/routes-data.js"
test -f "$ZIP"

if grep -q 'SHA256SUMS.txt' "$DIST/SHA256SUMS.txt"; then
  echo "Manifest includes itself" >&2
  exit 1
fi
if awk '{print $2}' "$DIST/SHA256SUMS.txt" | grep -Ev '^\./' >/dev/null; then
  echo "Manifest contains a non-relative path" >&2
  exit 1
fi
if find "$DIST" -type f \( -name '*laiyifen*' -o -name '*.diff' -o -name 'git-baseline.txt' \) -print -quit | grep -q .; then
  echo "Forbidden file found" >&2
  exit 1
fi
if rg -n --text '/Users/|/home/|/tmp/|/private/var/folders|/var/folders|file:///Users|来伊份|laiyifen|医薬熊本物流センター|熊本県熊本' "$DIST" >/dev/null; then
  echo "Forbidden content found" >&2
  exit 1
fi

(cd "$DIST" && shasum -a 256 -c SHA256SUMS.txt >/dev/null)
printf '{"status":"PASS","manifest":"relative-self-excluded","zipExtractVerification":"PASS","cleanData":"fully-synthetic"}\n'
