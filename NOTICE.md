# STCT v1.6-v1.8 Notices and Runtime Boundaries

STCT v1.6 is a local demonstration. It is not a production control tower, GPS feed, live traffic service, navigation product, or proof of globally optimal routing.

## Included Runtime Components

- MapLibre GL JS 5.12.0 is included under its BSD-3-Clause license. Vendored-file provenance is recorded in `vendor/NOTICE.md`.
- SheetJS Community Edition 0.18.5 is included under Apache-2.0. Vendored-file provenance is recorded in `vendor/NOTICE.md`.
- Google OR-Tools is used by the local optimizer environment when already available. OR-Tools results labelled `BEST_FOUND` are not a claim of global optimality.

## Existing Online Map Requests

The existing application map may request OpenFreeMap styles, tiles, sprites, or fonts derived from OpenStreetMap/OpenMapTiles services. Availability and attribution remain subject to those services. The deterministic v1.6 Road Fixture remains usable without those online map assets.

## Disabled External Routing Providers

OSRM-compatible and Valhalla-compatible adapters are disabled by default. STCT does not call public OSRM, public Valhalla, or public VROOM endpoints. Enabling a configured local provider requires an explicit endpoint and explicit coordinate-transmission approval.

## Synthetic Data

The v1.6 road graph, route events, execution state, driver queue, alerts, and recovery scenarios are synthetic fixtures. They do not represent real roads, real GPS, real traffic, or customer activity.

## v1.7 Operational Truth

STCT v1.7 adds deterministic multi-vehicle execution, verified synthetic telemetry, offline driver projection, recovery workflows, Operational Capsule replay, Shift Review, and Flight Recorder views. These remain local demo functions: there is no live GPS feed, production database, multi-user concurrency control, or production capacity claim. The local simulator is not a real driver application, and the synthetic road fixture is not a representation of real roads.

## v1.8 Network Intelligence

STCT v1.8 adds deterministic multi-depot assignment, multi-trip chains, pickup-delivery and cross-dock custody, dock/wave scheduling, network accounting, scenario comparison, recovery candidates, and a responsive Network Decision Room. These are synthetic local-demo functions. They do not establish a live warehouse feed, certified optimizer, audited cost or carbon result, production database, multi-user authorization, or global optimality.

The existing visual map may still request OpenFreeMap assets based on OpenMapTiles and OpenStreetMap. The configured v1.8 routing and optimization provider remains local/disabled unless explicitly enabled; no public OSRM, Valhalla, or VROOM service is called by the v1.8 delivery workflow.
