# STCT v1.5.1 Integrity Closure

Release boundary: `STCT v1.5.1 Integrity Closed`

This report records the local validation boundary for the v1.5.1 integrity-closure work. It is not a production deployment or a claim of live operational integration.

## Gate Results

| Gate | Status | Evidence |
| --- | --- | --- |
| Pareto Metric Completeness | PASS | Missing, null, string, NaN, and Infinity are rejected; 23 adversarial fixtures pass; `changeCount` is verifier or verified-diff authority only. |
| Unified SHA-256 Identity | PASS | Nine audit identities use Canonical UTF-8 SHA-256; JS/Python matrix identity parity passes. |
| Derived Scenario Authority | PASS | Derived content re-enters the Canonical pipeline; JS/Python parity passes; optimizer accepts the valid identity with HTTP 200 and rejects a false claimed hash with HTTP 400. |
| Capsule Deep Validation | PASS | Canonical scenario, event chain, incidents, simulation state, recovery lineage, engine/matrix provenance, plans, verifier results, and final capsule hash are revalidated; nine resealed internal mutations are rejected. |
| Recovery Engine / Matrix Truth | PASS | Haversine and Fixture MatrixContext runs produce provider-owned provenance and distinct route/insertion metrics. Full Reoptimization remains `ADAPTER_ONLY / NOT_INTEGRATED`. |
| 240-stop Performance | PASS | 240 stops: 1 long task, 19.85 application updates/s, 19.85 map-source updates/s, 58.98 RAF callbacks/s, 0.95 visible cursor updates/s. Target is fewer than 15 long tasks. |

## Performance Changes

- Replay advances logical time without generating a discarded full snapshot on every browser RAF.
- Static route and stop geometry is cached by plan hash.
- Dynamic completed paths, active legs, service pulses, and vehicles share one batched GeoJSON source update.
- Replay events and cumulative route facts are cached outside the render loop.
- The shared Domain Event Lane renders a 40-row window and refreshes filter options only when its source changes.

## Regression Boundary

- v1.4 release regression: 28 suites PASS, including OR-Tools, HTTP identity, verifier parity, multi-day, What-if, fallback, performance, and start/stop.
- v1.5/v1.5.1 unit and contract suites PASS.
- Browser suites PASS: Wave A, Wave B, Wave D, zh/en/ja i18n, Incident Recovery, Gate E interactions, and the 60/120/240 performance matrix.
- 240-stop baseline: 54 long tasks. Final sample: 1 long task.

No automatic commit, push, deployment, or production-integration claim is part of this closure.
