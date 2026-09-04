# STCT v1.8 Architecture Decisions

## Authority And Identity

- `network-contract-v18.js` owns canonical input normalization and SHA-256 identities.
- Solver output is accepted only after independent network verification.
- Assignment, trip, custody, dock/wave, accounting, scenario, execution, visualization, and delivery evidence keep their source hashes.

## Planning And Execution

- Depot eligibility and capacity are checked before trip construction.
- Physical vehicles and drivers use ordered, non-overlapping trip chains.
- Pickup precedes delivery; custody has one owner at a time; cross-dock transfer consumes dock time.
- Dock reservations and dispatch waves are explicit, revisioned artifacts.
- Recovery starts from a frozen execution cutoff and preserves accepted history.

## User Experience

- Decision Room actions begin as preview-only and require an explicit apply action.
- Heatmap, map, Dock Gantt, and Time-Space views retain text/table alternatives.
- No-WebGL and reduced-motion profiles preserve evidence rather than hiding it.
- Chinese, English, and Japanese labels share one terminology dictionary.

## Boundaries

- The default road and network data are deterministic synthetic fixtures.
- External routing providers are disabled unless an approved local provider is explicitly configured.
- Results are local-demo estimates and best-found candidates, not global-optimum, production, warehouse, or regulatory claims.

