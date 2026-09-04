# Vendored browser runtime assets

These files are checked into the local Demo so the application does not depend on a public JavaScript CDN at runtime.

- `maplibre/maplibre-gl.js` and `maplibre/maplibre-gl.css`: MapLibre GL JS 5.12.0, downloaded from `https://unpkg.com/maplibre-gl@5.12.0/dist/` (BSD-3-Clause).
- `xlsx/xlsx.full.min.js`: SheetJS Community Edition 0.18.5 browser build, downloaded from `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js` (Apache-2.0).

The OpenFreeMap style, map tiles, fonts, and optional OSRM road preview remain online resources. Their failure must not prevent data validation, planning, analysis, or export.
