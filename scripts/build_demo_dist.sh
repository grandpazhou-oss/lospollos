#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${DIST_DIR:-/tmp/lospollos-v1.4-clean-dist}"
ZIP_PATH="${ZIP_PATH:-${DIST_DIR%/}.zip}"
VERIFY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/stct-v14-dist-verify.XXXXXX")"
SYNTH_JSON="$(mktemp "${TMPDIR:-/tmp}/stct-v14-synthetic.XXXXXX")"
SYNTH_ROUTES="$(mktemp "${TMPDIR:-/tmp}/stct-v14-routes.XXXXXX")"
trap 'rm -rf "$VERIFY_ROOT"; rm -f "$SYNTH_JSON" "$SYNTH_ROUTES"' EXIT

for command_name in node shasum zip unzip rg; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command is unavailable: %s\n' "$command_name" >&2
    exit 1
  fi
done

rm -rf "$DIST_DIR"
rm -f "$ZIP_PATH"
mkdir -p "$DIST_DIR/assets/demo" "$DIST_DIR/data" "$DIST_DIR/vendor/maplibre" "$DIST_DIR/vendor/xlsx" "$DIST_DIR/shared" "$DIST_DIR/optimizer" "$DIST_DIR/templates" "$DIST_DIR/scripts"

node "$ROOT/scripts/build_demo_data_v14.js" "$SYNTH_JSON" >/dev/null
node "$ROOT/scripts/build_synthetic_routes_v14.js" "$SYNTH_JSON" "$SYNTH_ROUTES" >/dev/null

runtime_files=(
  index.html style.css experience-v14.css config.js canonical.js validator.js optimizer.js verifier.js
  planning-v12.js main.js map.js upload.js render.js start_demo.sh stop_demo.sh
  requirements-demo.txt netlify.toml README-DIST.md DATA_CLASSIFICATION.md
)
for file in "${runtime_files[@]}"; do
  cp "$ROOT/$file" "$DIST_DIR/$file"
done

experience_files=(experience-v14.js replay-v14.js scenario-arena-v14.js timeline-v14.js demo-director-v14.js experience-ui-v14.js)
for file in "${experience_files[@]}"; do
  if [ -f "$ROOT/$file" ]; then cp "$ROOT/$file" "$DIST_DIR/$file"; fi
done

cp "$ROOT/assets/logisteed-logo.png" "$DIST_DIR/assets/"
cp "$ROOT/assets/logisteed-logo-white.png" "$DIST_DIR/assets/"
cp "$SYNTH_JSON" "$DIST_DIR/assets/demo/stct-synthetic-demo.json"
cp "$SYNTH_ROUTES" "$DIST_DIR/data/routes-data.js"
cp "$ROOT/vendor/NOTICE.md" "$DIST_DIR/vendor/"
cp "$ROOT/vendor/maplibre/maplibre-gl.css" "$ROOT/vendor/maplibre/maplibre-gl.js" "$DIST_DIR/vendor/maplibre/"
cp "$ROOT/vendor/xlsx/xlsx.full.min.js" "$DIST_DIR/vendor/xlsx/"
cp "$ROOT/shared/planning-contract-v13.json" "$DIST_DIR/shared/"
cp "$ROOT/optimizer/ortools_service.py" "$ROOT/optimizer/canonical_contract.py" "$ROOT/optimizer/README.md" "$DIST_DIR/optimizer/"
cp "$ROOT/templates/raw-dispatch-template.xlsx" "$DIST_DIR/templates/"
cp "$ROOT/scripts/build_demo_data_v14.js" "$ROOT/scripts/build_synthetic_routes_v14.js" "$DIST_DIR/scripts/"

chmod +x "$DIST_DIR/start_demo.sh" "$DIST_DIR/stop_demo.sh" "$DIST_DIR/scripts/build_demo_data_v14.js" "$DIST_DIR/scripts/build_synthetic_routes_v14.js"

if find "$DIST_DIR" -type d \( -name .git -o -name .claude -o -name logs -o -name tests \) -print -quit | grep -q .; then
  echo "Forbidden directory found in dist" >&2
  exit 1
fi
if find "$DIST_DIR" -type f \( -name '*.diff' -o -name 'laiyifen-202605-rawdata.xlsx' -o -name 'git-baseline.txt' \) -print -quit | grep -q .; then
  echo "Forbidden source/evidence file found in dist" >&2
  exit 1
fi
if rg -n --text '/Users/|/home/|/tmp/|/private/var/folders|/var/folders|file:///Users' "$DIST_DIR" >/dev/null 2>&1; then
  echo "Local absolute path found in dist" >&2
  exit 1
fi
if rg -n --text '来伊份|laiyifen|医薬熊本物流センター|熊本県熊本' "$DIST_DIR" >/dev/null 2>&1; then
  echo "Internal or real-customer marker found in clean dist" >&2
  exit 1
fi

write_manifest() {
  local directory="$1"
  (
    cd "$directory"
    find . -type f ! -name SHA256SUMS.txt -print0 \
      | LC_ALL=C sort -z \
      | while IFS= read -r -d '' file; do shasum -a 256 "$file"; done \
      > SHA256SUMS.txt
    shasum -a 256 -c SHA256SUMS.txt
  )
}

write_manifest "$DIST_DIR" >/dev/null

DIST_PARENT="$(CDPATH= cd -- "$(dirname -- "$DIST_DIR")" && pwd)"
DIST_NAME="$(basename -- "$DIST_DIR")"
case "$ZIP_PATH" in
  /*) ;;
  *) ZIP_PATH="$ROOT/$ZIP_PATH" ;;
esac
(
  cd "$DIST_PARENT"
  zip -qry "$ZIP_PATH" "$DIST_NAME"
)
unzip -q "$ZIP_PATH" -d "$VERIFY_ROOT"
(
  cd "$VERIFY_ROOT/$DIST_NAME"
  shasum -a 256 -c SHA256SUMS.txt >/dev/null
)

printf 'DIST_PATH=%s\nZIP_PATH=%s\nFILE_COUNT=%s\nMANIFEST_STATUS=PASS\nEXTRACTED_MANIFEST_STATUS=PASS\n' \
  "$DIST_DIR" "$ZIP_PATH" "$(find "$DIST_DIR" -type f | wc -l | tr -d ' ')"
