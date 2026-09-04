# STCT v1.8 Renderer Ownership

All views use deterministic synthetic evidence and retain a table or text equivalent.

| View | Primary renderer | Evidence boundary | Non-visual equivalent |
| --- | --- | --- | --- |
| Network map | MapLibre when available; static SVG fallback | Geographic depot, stop and route geometry only | Depot, route, closure and transfer tables |
| Capacity heatmap | HTML/CSS grid | Numeric depot/time capacity values | Capacity table with value and level |
| Trip chain | HTML/SVG | Ordered vehicle trips, reload and charge sessions | Trip and charge table |
| Dock Gantt | HTML/SVG | Dock reservations and queue intervals | Reservation table and button actions |
| Time-space | HTML/SVG | Time-ordered operational events | Event table |
| Scenario frontier | HTML/SVG | Observed candidates only | Candidate comparison table |
| EV energy | HTML/SVG | Synthetic SOC and charger reservations | Energy and charger tables |
| Uncertainty | HTML/SVG | Seeded synthetic percentiles | Sample-count and percentile tables |

Map-space routes remain separate by trip and vehicle; no renderer may draw bridge lines between unrelated trips. Dense non-geographic timelines use SVG/HTML rather than the map. Selection state is controller-owned and shared by map, trip, dock, alert and inspector views.

`deck.gl` is not introduced because no measured blocker justifies it and no user authorization was given. Reduced-motion mode removes animation while retaining every numeric claim. No-WebGL mode preserves all operational decisions and metrics.
