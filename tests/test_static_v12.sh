#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

active_js=(
  config.js
  data/routes-data.js
  validator.js
  optimizer.js
  verifier.js
  planning-v12.js
  main.js
  upload.js
  map.js
  render.js
)

for file in "${active_js[@]}"; do
  node --check "$file"
done

python3 -m py_compile optimizer/ortools_service.py tests/test_optimizer_v12.py
bash -n start_demo.sh
bash -n stop_demo.sh

required_assets=(
  index.html
  style.css
  templates/laiyifen-202605-rawdata.xlsx
  vendor/NOTICE.md
  vendor/maplibre/maplibre-gl.js
  vendor/maplibre/maplibre-gl.css
  vendor/xlsx/xlsx.full.min.js
)
for file in "${required_assets[@]}"; do
  test -s "$file"
done

grep -Fq "MapLibre GL JS 5.12.0" vendor/NOTICE.md
grep -Fq "SheetJS Community Edition 0.18.5" vendor/NOTICE.md
grep -Fq 'var i="5.12.0"' vendor/maplibre/maplibre-gl.js
grep -Fq 'e.version="0.18.5"' vendor/xlsx/xlsx.full.min.js
grep -Fq './vendor/maplibre/maplibre-gl.js' index.html
grep -Fq './vendor/xlsx/xlsx.full.min.js' index.html
grep -Fq './verifier.js?v=1.2.0' index.html
grep -Fq './planning-v12.js?v=1.2.0' index.html

echo "STATIC_V12_PASS"
