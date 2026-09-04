#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${DIST_DIR:-/tmp/lospollos-v1.7-demo-dist}"
ZIP_PATH="${ZIP_PATH:-${DIST_DIR%/}.zip}"
VERIFY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/stct-v17-dist-verify.XXXXXX")"
SYNTH_JSON="$(mktemp "${TMPDIR:-/tmp}/stct-v17-synthetic.XXXXXX")"
SYNTH_ROUTES="$(mktemp "${TMPDIR:-/tmp}/stct-v17-routes.XXXXXX")"
trap 'rm -rf "$VERIFY_ROOT"; rm -f "$SYNTH_JSON" "$SYNTH_ROUTES"' EXIT

for command_name in node shasum zip unzip rg; do command -v "$command_name" >/dev/null 2>&1 || { printf 'Required command is unavailable: %s\n' "$command_name" >&2; exit 1; }; done
rm -rf "$DIST_DIR"; rm -f "$ZIP_PATH"; mkdir -p "$DIST_DIR/assets/demo" "$DIST_DIR/data" "$DIST_DIR/vendor/maplibre" "$DIST_DIR/vendor/xlsx" "$DIST_DIR/shared" "$DIST_DIR/optimizer" "$DIST_DIR/scripts" "$DIST_DIR/templates"
node "$ROOT/scripts/build_demo_data_v14.js" "$SYNTH_JSON" >/dev/null
node "$ROOT/scripts/build_synthetic_routes_v14.js" "$SYNTH_JSON" "$SYNTH_ROUTES" >/dev/null

runtime_files=(index.html style.css experience-v14.css experience-v15.css experience-v16.css experience-v17.css config.js canonical.js validator.js optimizer.js verifier.js planning-v12.js main.js map.js upload.js render.js start_demo.sh stop_demo.sh requirements-demo.txt netlify.toml DATA_CLASSIFICATION.md NOTICE.md INTEGRITY_CLOSURE_V151.md)
for file in "${runtime_files[@]}"; do cp "$ROOT/$file" "$DIST_DIR/$file"; done
cp "$ROOT/README-DIST-V17.md" "$DIST_DIR/README-DIST.md"
module_files=(experience-v14.js replay-v14.js scenario-arena-v14.js timeline-v14.js demo-director-v14.js experience-ui-v14.js integrity-hash-v151.js domain-events-v15.js canonical-diff-v15.js explainability-v15.js pareto-v15.js engine-registry-v15.js matrix-provider-v15.js scenario-capsule-v15.js map-layer-registry-v15.js service-zone-v15.js trust-lab-v15.js simulation-store-v15.js experience-v15.js incident-v15.js impact-analysis-v15.js recovery-v15.js incident-ui-v15.js replay-v15.js timeline-v15.js experience-ui-v15.js road-network-fixture-v16.js road-routing-v16.js routing-provenance-v16.js routing-provider-registry-v16.js rolling-plan-v16.js change-penalty-v16.js job-lifecycle-v16.js reoptimization-v16.js rolling-recovery-v16.js execution-profiles-v16.js execution-twin-v16.js execution-store-v16.js plan-vs-actual-v16.js operations-alerts-v16.js offline-queue-v16.js driver-simulator-v16.js execution-recovery-v16.js dynamic-operations-capsule-v16.js map-layer-registry-v16.js experience-ui-v16.js execution-invariants-v17.js execution-reducer-v17.js driver-local-projection-v17.js driver-reconciliation-v17.js telemetry-v17.js telemetry-matcher-v17.js telemetry-validator-v17.js telemetry-pipeline-v17.js fleet-tracks-v17.js fleet-replay-v17.js multi-vehicle-plan-actual-v17.js operations-workspace-v17.js operational-capsule-v17.js capsule-replay-validator-v17.js performance-instrumentation-v17.js shift-review-v17.js flight-recorder-v17.js experience-ui-v17.js)
for file in "${module_files[@]}"; do cp "$ROOT/$file" "$DIST_DIR/$file"; done
cp "$ROOT/assets/logisteed-logo.png" "$ROOT/assets/logisteed-logo-white.png" "$DIST_DIR/assets/"
cp "$SYNTH_JSON" "$DIST_DIR/assets/demo/stct-synthetic-demo.json"; cp "$SYNTH_ROUTES" "$DIST_DIR/data/routes-data.js"
cp "$ROOT/vendor/NOTICE.md" "$DIST_DIR/vendor/"; cp "$ROOT/vendor/maplibre/maplibre-gl.css" "$ROOT/vendor/maplibre/maplibre-gl.js" "$DIST_DIR/vendor/maplibre/"; cp "$ROOT/vendor/xlsx/xlsx.full.min.js" "$DIST_DIR/vendor/xlsx/"
cp "$ROOT/shared/planning-contract-v13.json" "$DIST_DIR/shared/"
cp "$ROOT/optimizer/ortools_service.py" "$ROOT/optimizer/canonical_contract.py" "$ROOT/optimizer/matrix_contract.py" "$ROOT/optimizer/routing_contract_v16.py" "$ROOT/optimizer/rolling_solver_v16.py" "$ROOT/optimizer/README.md" "$DIST_DIR/optimizer/"
cp "$ROOT/templates/raw-dispatch-template.xlsx" "$DIST_DIR/templates/"
cp "$ROOT/scripts/build_demo_data_v14.js" "$ROOT/scripts/build_synthetic_routes_v14.js" "$ROOT/scripts/build_capsule_zip_v15.js" "$DIST_DIR/scripts/"
node -e 'const fs=require("fs"),r=require(process.argv[1]);const out={schemaVersion:"stct-v17-traceability-summary-v1.7",status:"READ_ONLY_SUMMARY",requirementCount:r.requirements.length,gates:Object.fromEntries([...new Set(r.requirements.map(x=>x.gate))].map(g=>[g,r.requirements.filter(x=>x.gate===g).length])),semanticRegistryRequired:true,lexicalCoverage:"AUXILIARY_ONLY"};fs.writeFileSync(process.argv[2],JSON.stringify(out,null,2)+"\n")' "$ROOT/requirements-v17.json" "$DIST_DIR/STCT-v1.7-TRACEABILITY-SUMMARY.json"
chmod +x "$DIST_DIR/start_demo.sh" "$DIST_DIR/stop_demo.sh" "$DIST_DIR/scripts/"*.js

if find "$DIST_DIR" -type d \( -name .git -o -name .claude -o -name logs -o -name tests -o -name audit \) -print -quit | grep -q .; then echo 'Forbidden directory found in dist' >&2; exit 1; fi
if find "$DIST_DIR" -type f \( -iname '*7-eleven*' -o -iname '*laiyifen*' -o -iname '*工作簿*' -o -name '*.diff' \) -print -quit | grep -q .; then echo 'Forbidden source/evidence file found in dist' >&2; exit 1; fi
if rg -n --text '/Users/|/home/|/tmp/|/private/var/folders|/var/folders|file:///Users' "$DIST_DIR" >/dev/null 2>&1; then echo 'Local absolute path found in dist' >&2; exit 1; fi
if rg -n --text '来伊份|laiyifen|7-Eleven天津|工作簿2|医薬熊本物流センター|熊本県熊本' "$DIST_DIR" >/dev/null 2>&1; then echo 'Internal or customer marker found in dist' >&2; exit 1; fi
if rg -n --text '(sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY)' "$DIST_DIR" >/dev/null 2>&1; then echo 'Secret-like material found in dist' >&2; exit 1; fi
(cd "$DIST_DIR" && find . -type f ! -name SHA256SUMS.txt -print0 | LC_ALL=C sort -z | while IFS= read -r -d '' file; do shasum -a 256 "$file"; done > SHA256SUMS.txt && shasum -a 256 -c SHA256SUMS.txt >/dev/null)
DIST_PARENT="$(CDPATH= cd -- "$(dirname -- "$DIST_DIR")" && pwd)"; DIST_NAME="$(basename -- "$DIST_DIR")"; case "$ZIP_PATH" in /*) ;; *) ZIP_PATH="$ROOT/$ZIP_PATH" ;; esac
(cd "$DIST_PARENT" && zip -Xqry "$ZIP_PATH" "$DIST_NAME"); unzip -q "$ZIP_PATH" -d "$VERIFY_ROOT"; (cd "$VERIFY_ROOT/$DIST_NAME" && shasum -a 256 -c SHA256SUMS.txt >/dev/null)
printf 'DIST_PATH=%s\nZIP_PATH=%s\nFILE_COUNT=%s\nMANIFEST_STATUS=PASS\nEXTRACTED_MANIFEST_STATUS=PASS\n' "$DIST_DIR" "$ZIP_PATH" "$(find "$DIST_DIR" -type f | wc -l | tr -d ' ')"
