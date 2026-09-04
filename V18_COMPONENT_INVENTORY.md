# STCT v1.8 Visualization Component Inventory

| Component | Canonical Source | Fallback |
|---|---|---|
| Network Map | Network scenario and verified network plan | SVG plus network tables |
| Capacity Heatmap | Depot, dock, vehicle, assignment, and reservation facts | Keyboard-readable value grid |
| Trip Chain | Trips, reloads, breaks, reposition legs, and conflicts | Vehicle-lane table |
| Time-Space | Departures, transfers, reloads, delays, and missed connections | Ordered event table |
| Dock Gantt | Dock reservations, queues, conflicts, cutoffs, and departures | Reservation table |
| Scenario Arena | Scenario and network input hashes | Same-input/different-input comparison table |
| Decision Room | Alerts, actions, reason codes, and source hashes | Priority-ordered evidence list |

Every visual record carries a verified canonical source hash. Synthetic fixtures are labeled as synthetic test data.
