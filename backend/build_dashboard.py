#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the dispatch dashboard HTML from template + embedded libraries.

   The route data is NOT embedded — it's loaded at runtime from backend/route_data.js.
   This means: update data → just regenerate route_data.js → refresh browser.
"""

import os

ROOT = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(ROOT, 'dashboard_template.html')
OUTPUT = os.path.join(ROOT, '..', 'dispatch.html')

# Read libraries (embedded in HTML for offline use)
with open('/tmp/maplibre.css', 'r') as f: ml_css = f.read()
with open('/tmp/maplibre.js', 'r') as f: ml_js = f.read()
with open('/tmp/chart.js', 'r') as f: chart_js = f.read()
with open('/tmp/sheetjs.js', 'r') as f: sheetjs = f.read()

# Read template and replace placeholders
with open(TEMPLATE, 'r', encoding='utf-8') as f:
    html = f.read()

html = html.replace('{{ML_CSS}}', ml_css)
html = html.replace('{{ML_JS}}', ml_js)
html = html.replace('{{CHART_JS}}', chart_js)
html = html.replace('{{SHEETJS}}', sheetjs)

with open(OUTPUT, 'w', encoding='utf-8') as f:
    f.write(html)

size = os.path.getsize(OUTPUT)
print(f"dispatch.html: {size:,} bytes ({size/1024:.0f} KB)")
print(f"  MapLibre GL JS + Chart.js embedded")
print(f"  Route data loaded from: backend/route_data.js")
print(f"  Carbon data computed in-browser")
print(f"Done!")
