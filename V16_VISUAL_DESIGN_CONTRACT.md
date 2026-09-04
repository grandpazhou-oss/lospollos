# STCT v1.6 Visual Design Contract

Status: implementation contract

## Continuity

- Extend the v1.5.1 light operations workstation. This is not a site redesign.
- Keep LOGISTEED deep blue and red as small structural and action signals.
- Prioritize map, timeline, route sequence, provenance, and evidence over KPI tiles.
- Use square or lightly rounded surfaces (8 px maximum) and avoid nested cards.
- Keep all implementation text readable at desktop, mobile portrait, and mobile landscape sizes.

## Truth Labels

Every road, execution, ETA, alert, driver, traffic, or GPS-like screen must expose the applicable boundary in the first viewport:

- `Local Demo`
- `Synthetic Road Fixture` or `Configured Local Provider`
- `Local Execution Simulation`
- `Synthetic GPS-like Events`
- `Not Live Traffic`
- `Not Live Operations`
- `Driver Simulator - Not a Production Driver App`

The UI must never display `Production`, `Live GPS`, `Live Traffic`, `Real-Time Control Tower`, or equivalent claims.

## Desktop Hierarchy

Operations Command Center uses this order:

1. Top status rail
2. Primary map or no-WebGL operational replacement
3. Alert rail
4. Route health board
5. Event and execution timeline
6. Context inspector

Road-Aware Planning and Rolling Reoptimization may change the side-panel emphasis, but the map and route evidence remain primary. Equal-weight KPI card grids are prohibited.

## Mobile Hierarchy

1. Current operational state and truth label
2. Open critical alerts
3. Selected route or stop
4. Map or no-WebGL route sequence
5. Primary actions
6. Queue, acknowledgement, and evidence status

Actions must remain reachable without overlapping map controls or critical state. Touch targets are at least 44 by 44 CSS pixels.

## Motion

- Motion may represent only simulated progress, selection, seek, alert focus, or state transition.
- Reduced Motion must preserve the same state and evidence in a static form.
- No pulsing, sweeping, or continuous motion is allowed when it is merely decorative.
- A paused or hidden execution view must own no active animation frame.

## Map and Fallback

- Planned geometry, simulated actual trace, current position, alerts, and selected stop use separate registered layers.
- Map colors must have matching labels, icons, or patterns; color alone is insufficient.
- no-WebGL is an operational mode, not an empty placeholder. It must retain route sequence, distance and ETA, provider provenance, matrix/route consistency, execution progress, alerts, timeline, and recovery actions.

## Data Boundary

- Existing project data remains volume-only. Do not introduce weight or fuel metrics.
- Road fixture values, traffic profiles, GPS-like points, ETAs, and actuals must be deterministic and explicitly synthetic.
- External providers remain disabled until configured, privacy-reviewed, and tested.

## Concept Evidence

The eight generated concepts are stored outside the repository under the Wave 0 baseline `concepts/` directory. They are design references only, not product evidence and not source assets for the release bundle.
