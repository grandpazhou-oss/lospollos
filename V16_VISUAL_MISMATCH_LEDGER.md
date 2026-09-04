# STCT v1.6 Visual Mismatch Ledger

Status: reviewed concept-to-implementation ledger

| Concept | Keep | Reject or correct | Verification |
| --- | --- | --- | --- |
| Road-Aware Planning Lab | central road map, provider health, consistency, provenance | generated dates and traffic signals are illustrative only | fixture identity and boundary visible |
| Operations Command Center | map-first hierarchy, alert rail, execution health | no live-operations wording or implied production telemetry | first-viewport truth labels |
| Plan vs Simulated Actual | planned/actual overlay, metric table, synchronized timeline | never shorten to ambiguous `Actual` without nearby `Simulated` boundary | copy scan and browser QA |
| Rolling Reoptimization | cutoff, locked/in-service/remaining groups, candidate lifecycle, human Apply | generated `Environment: Production` is explicitly rejected; use `Local Demo` | forbidden-copy test |
| Mobile Driver Simulator | next stop, ETA, queue/ACK/retry, synthetic location | generated fuel metric is rejected; project remains volume-only | data-field scan |
| Mobile Alert Detail | evidence-first severity and acknowledgement | no real driver identity or live location | fixture and redaction tests |
| Reduced Motion | complete static state | no animation-dependent evidence | reduced-motion browser test |
| No-WebGL | route sequence, metrics, alerts, timeline, recovery actions | no blank map placeholder; external provider rows are not enabled by default | no-WebGL browser test |

## Existing v1.5.1 Constraints

- Preserve the compact header and LOGISTEED logo scale.
- Preserve mobile title fit and right-edge logo spacing.
- Preserve route-detail sheet and stop-card close behavior.
- Do not reintroduce dark-map presets for operational views.
- Do not remove existing map label toggles or volume-only semantics.

## Phase 0 Decision

The concept set is accepted as directional evidence after the corrections above. Implementation follows this ledger when a generated concept conflicts with the product truth boundary or existing system behavior.

## Implemented Review

Browser review completed against the v1.6 implementation on desktop, mobile portrait, mobile landscape, no-WebGL, and reduced-motion contexts.

| Surface | Implemented match | Deliberate difference | Evidence |
| --- | --- | --- | --- |
| Road-Aware Lab | provider facts, road fixture, planned/actual line styles, stop stepping, text route summary | deterministic SVG fixture replaces an external interactive basemap inside the lab so routing evidence does not depend on a tile request | `road-fixture-desktop.png` |
| Operations | execution state, Route Health, evidence-backed alert workflow, screen-reader summary | alert inbox uses a scan-oriented split layout rather than a decorative map overlay | `operations-desktop.png`, `operations-stale.png` |
| Plan vs Simulated Actual | explicit labels, metric strip, timeline, stop table | missing accepted events remain partial instead of being visually interpolated | `plan-vs-actual-desktop.png` |
| Rolling Reoptimization | observed candidates, transfer policy, handover, explicit Preview and Apply confirmation | no Production label and no global-optimum claim | browser interaction evidence |
| Driver | single-column portrait action flow, offline queue, no-GPS boundary | navigation is a map-focus command only | `mobile-portrait-driver.png`, `driver-offline.png` |
| No-WebGL / Reduced Motion | complete table and workflow equivalents | route morph is static Before/After; alerts use outlines without pulse | browser evidence JSON |

No concept image is shipped as the operational UI. All state shown by the implementation is generated from the local Synthetic Road Fixture and accepted local simulation events.
