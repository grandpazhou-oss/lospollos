#!/usr/bin/env python3
"""Rebuild the retained legacy view using existing local libraries, on Mac or Windows."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
APP = ROOT.parent
OUTPUT = APP / "dispatch.html"
# Chart.js is already embedded in the preserved legacy page; no install or network fetch.
chart = next((block for block in re.findall(r"<script(?:\s[^>]*)?>(.*?)</script>", OUTPUT.read_text(encoding="utf-8"), re.S) if "/npm/chart.js@" in block[:300]), None)
if chart is None:
    raise RuntimeError("Existing embedded Chart.js is missing; retain dispatch.html before rebuilding")
libraries = {"ML_CSS": (APP / "vendor/maplibre/maplibre-gl.css").read_text(encoding="utf-8"), "ML_JS": (APP / "vendor/maplibre/maplibre-gl.js").read_text(encoding="utf-8"), "SHEETJS": (APP / "vendor/xlsx/xlsx.full.min.js").read_text(encoding="utf-8"), "CHART_JS": chart}
html = (ROOT / "dashboard_template.html").read_text(encoding="utf-8")
for key, value in libraries.items():
    html = html.replace("{{" + key + "}}", value)
OUTPUT.write_text(html, encoding="utf-8")
print("Retained legacy dashboard rebuilt from local libraries:", OUTPUT.name, OUTPUT.stat().st_size)
