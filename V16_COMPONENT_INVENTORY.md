# STCT v1.6 Component Inventory

Status: implementation contract

| Surface | Required components | Owner | Fallback requirement |
| --- | --- | --- | --- |
| Road-Aware Planning Lab | provider selector, provider health, snap report, matrix/route consistency, route provenance, route map, candidate list | `STCTV16.road` + planning UI | route sequence and provenance table |
| Rolling Reoptimization | cutoff summary, locked/in-service/remaining sets, policy controls, job lifecycle, candidate pool, before/after comparison, human Apply | `STCTV16.rolling` | complete textual candidate comparison |
| Operations Command Center | status rail, execution map, alert rail, route health, event timeline, inspector, stale/offline banner | `STCTV16.operations` | route progress board and event list |
| Plan vs Simulated Actual | planned/actual overlay, metrics, stop comparison, deviation timeline, synchronized inspector | `STCTV16.planActual` | sequence table plus metrics and timeline |
| Driver Simulator | current stop, ETA, arrival/departure actions, queue status, ACK/retry, synthetic location | `STCTV16.driver` | same actions without map |
| Alert Detail | severity, evidence, entity links, ETA impact, last-known-good, acknowledgement, recovery action | `STCTV16.alerts` | full text evidence |
| Execution Recovery | cutoff snapshot, frozen state, remaining scenario, recovery candidate, handover, undo gate, counter-recovery | `STCTV16.recovery` | non-map review and Apply flow |
| Scenario Capsule | manifest, execution/events/alerts/queue/recovery/provenance sections, deep validation result | `STCTV16.capsule` | import/export report |

## Shared Controls

- Icon buttons: close, focus, play/pause, seek, acknowledge, retry, export/import.
- Segmented controls: planning mode, execution profile, comparison mode.
- Select menus: provider, route, vehicle, alert severity.
- Sliders: replay cursor and speed only; no slider changes layout dimensions.
- Toggles: map layer visibility, traffic fixture, stops, planned/actual traces.
- Tables and lists: use real buttons for selectable rows and expose `aria-selected` or `aria-pressed`.

## State Ownership

The UI reads but does not merge these stores:

- `PlanningStore`
- `SimulationStore`
- `ExecutionStore`
- `AlertStore`
- `RecoveryStore`

Every rendered state includes its authority and identity. A simulated actual value never mutates a planned value in place.

## Lifecycle Contract

Each mounted component must return an idempotent cleanup function. Cleanup removes event listeners, animation frames, timers, map handlers, layers, sources, subscriptions, and detached-node references created by that component.
