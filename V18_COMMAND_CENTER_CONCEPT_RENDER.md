# STCT v1.8 Command Center Concept / Render Comparison

## Scope

This audit covers the local, synthetic-data command center rendered by
`network-command-center-v18.js`. It does not claim deployment, production
readiness, physical fleet execution, or a global optimum.

## Comparison

| Concept intent | Rendered implementation | Evidence check | Status |
| --- | --- | --- | --- |
| Decision-first hierarchy | Decision Room opens first with alert, action, evidence, preview, and apply gate | Browser heading, action state, and source hash | Implemented |
| Network context stays visible | Map and text summary share a responsive workspace | Desktop and mobile screenshots | Implemented |
| Capacity is inspectable without color | Heatmap is a table with signal, value, and level | DOM table audit | Implemented |
| Trips, docks, and time remain operational | Trip Chain, Dock Gantt, and Time-Space expose keyboard steppers and tables | Keyboard workflow audit | Implemented |
| Scenario and recovery actions remain controlled | Compare and recovery preview create local UI state only | Browser side-effect audit | Implemented |
| No-WebGL remains useful | Assignment, route, trip, dock, and recovery evidence remain tabular | No-WebGL screenshot and DOM audit | Implemented |

## Five Fidelity Checks

1. Information hierarchy: page title, section title, primary evidence, and action gate are distinct.
2. Business fidelity: service, cost, carbon, assignment, trip, dock, wave, transfer, and recovery values originate from canonical v1.8 artifacts.
3. Interaction fidelity: visible controls change selected entity, preview state, comparison state, recovery state, or capsule state.
4. Responsive fidelity: desktop, mobile portrait, mobile landscape, no-WebGL, and reduced-motion profiles retain core evidence.
5. Trust fidelity: synthetic-data, local-demo, preview-only, read-only replay, and no-global-optimum boundaries remain visible.

## Copy Diff

| Risky or ambiguous copy | Rendered copy | Reason |
| --- | --- | --- |
| `Optimize` | `Preview` | Avoids implying automatic operational change |
| `Best plan` | `Best found in tested configurations` | Avoids global-optimum claim |
| `Execute recovery` | `Recovery candidate previewed; not applied` | Preserves human approval boundary |
| `Export run` | `Export capsule` and `Read-only replay` | Makes replay semantics explicit |

## Typography Audit

- Font stack is local system sans-serif with monospace only for evidence hashes.
- Hero-scale typography is not used inside operational panels.
- Letter spacing is zero; text may wrap and tables scroll rather than overlap.
- Desktop section heading is 22 px and mobile section heading is 18 px.

## Icon Audit

- No decorative icon library or downloaded icon asset is introduced.
- Previous/next use familiar directional symbols with localized accessible names.
- Alert state is redundantly encoded by text, border, reason code, and evidence.

## Device And Browser Evidence

- Native-size browser viewports exercised: 1440 x 900, 390 x 844, and 844 x 390.
- Browser commands recorded by the Gate 13 test include `setContent`, `click`, `press`, `screenshot`, and `evaluate`.
- Physical iPhone validation: `BLOCKED_PHYSICAL_IPHONE_NOT_TESTED`. This is a declared measurement boundary, not a passing device claim.

