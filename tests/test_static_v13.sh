#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
count=0
pass() { count=$((count + 1)); }

for file in index.html style.css experience-v14.css canonical.js verifier.js planning-v12.js experience-v14.js replay-v14.js scenario-arena-v14.js timeline-v14.js demo-director-v14.js experience-ui-v14.js optimizer/ortools_service.py optimizer/canonical_contract.py shared/planning-contract-v13.json; do
  test -s "$ROOT/$file"
  pass
done
node --check "$ROOT/canonical.js"
node --check "$ROOT/verifier.js"
node --check "$ROOT/planning-v12.js"
node --check "$ROOT/render.js"
node --check "$ROOT/upload.js"
node --check "$ROOT/experience-v14.js"
node --check "$ROOT/replay-v14.js"
node --check "$ROOT/scenario-arena-v14.js"
node --check "$ROOT/timeline-v14.js"
node --check "$ROOT/demo-director-v14.js"
node --check "$ROOT/experience-ui-v14.js"
node --check "$ROOT/tests/test_experience_browser_v14.js"
node --check "$ROOT/tests/test_experience_performance_browser_v14.js"
node --check "$ROOT/tests/test_experience_performance_evidence_v14.js"
python3 -m py_compile "$ROOT/optimizer/ortools_service.py" "$ROOT/optimizer/canonical_contract.py"
pass
test "$(grep -c '^ortools==9\.15\.6755$' "$ROOT/requirements-demo.txt")" = "1"
pass
grep -q 'publish = "dist"' "$ROOT/netlify.toml"
pass
! grep -q 'require_command lsof' "$ROOT/start_demo.sh"
pass
grep -q 'get("noWebGL") === "1"' "$ROOT/main.js"
pass
bash -n "$ROOT/start_demo.sh" "$ROOT/stop_demo.sh" "$ROOT/scripts/build_demo_dist.sh" "$ROOT/tests/test_dist_runtime_v14.sh"
pass
printf '{"status":"PASS","checks":%s}\n' "$count"
