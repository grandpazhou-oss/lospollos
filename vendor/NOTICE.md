# Vendored browser runtime assets

These files are checked into the local Demo so the application does not depend on a public JavaScript CDN at runtime.

- `maplibre/maplibre-gl.js` and `maplibre/maplibre-gl.css`: MapLibre GL JS 5.12.0, downloaded from `https://unpkg.com/maplibre-gl@5.12.0/dist/` (BSD-3-Clause).
- `xlsx/xlsx.full.min.js`: **SheetJS Community Edition 0.20.3** browser build (Apache-2.0), downloaded from the official CDN `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (package `xlsx-0.20.3.tgz` SHA-256 `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`, reproduced by independent second download; `package/package.json` declares `"version": "0.20.3"`).
  - File SHA-256 (locked): `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`.
  - Supersedes 0.18.5 (previous file SHA-256 `c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99`, sourced from jsDelivr/npm).
  - Security: upgrade authorized by the user on 2026-09-30 and chosen to cover **CVE-2023-30533** (prototype pollution via crafted workbook; fixed in 0.19.3) and **CVE-2024-22363** (ReDoS; fixed in 0.20.2). No malicious-workbook exploit was executed; mitigation rests on the upstream fixed version plus the app-side import guards (size limits, sheet/time budgets in `importSession`).
  - Integrity note: the publisher's hash pages (sheetjs.com/download and related docs URLs) were unreachable at upgrade time (404 after site restructure), so the publisher-side digest could not be cross-checked; the hashes above are locally computed from the official CDN over HTTPS and pinned here. Re-pin against a publisher digest when available.

The OpenFreeMap style, map tiles, and fonts remain online resources. Their failure must not prevent data validation, planning, analysis, or export. The road preview uses the **local** OSRM instance (`http://127.0.0.1:5001`) by default; the public OSRM endpoint is disabled unless the user explicitly opts in (`localStorage stct.allowPublicOsrm='1'`), and every road request is audit-logged (endpoint, coordinate range, policy, outcome).
