# STCT v1.6 Open Source Inspiration and License Boundary

Status: clean-room pattern review, captured 2026-08-31

No source code, UI assets, schemas, fixtures, or test data were copied from the projects below. STCT v1.6 uses only general architectural patterns described in public documentation. No new dependency was introduced by this review.

| Project | General pattern considered | Upstream license observed | Introduced dependency | NOTICE action |
| --- | --- | --- | --- | --- |
| OSRM | route, table/matrix, nearest/snap, profile, provenance | BSD-2-Clause | none | none for pattern-only review |
| Valhalla | route/matrix/locate boundaries and costing profile | MIT | none | none for pattern-only review |
| GraphHopper | route, matrix, snap, path details, profile boundary | Apache-2.0 | none | none for pattern-only review |
| Traccar | append-only position/event flow, replay seek, stale/offline state | Apache-2.0 | none | none for pattern-only review |
| Timefold Solver | pinning, continuous planning, derived state, change minimization | Apache-2.0 | none | none for pattern-only review |
| jsprit | regret insertion and local ruin-and-recreate concepts | Apache-2.0 | none | none for pattern-only review |
| VROOM | engine adapter, priorities, skills, custom matrix, rerouting boundary | BSD-2-Clause | none | none for pattern-only review |
| Fleetbase / FleetOps | order-route-activity separation, service zones, operations event lifecycle | AGPL-3.0 / AGPL-3.0-or-later | none | AGPL source is explicitly excluded |
| Karrio | provider capability matrix and provider-owned provenance | dual model; listed open-source components LGPL-3.0 | none | no code or package imported |

## License Sources

- OSRM: https://github.com/Project-OSRM/osrm-backend/blob/master/LICENSE.TXT
- Valhalla: https://github.com/valhalla/valhalla/blob/master/pyproject.toml
- GraphHopper: https://github.com/graphhopper/graphhopper
- Traccar: https://github.com/traccar/traccar
- Timefold Solver: https://github.com/TimefoldAI/timefold-solver/blob/main/pom.xml
- jsprit: https://github.com/graphhopper/jsprit
- VROOM: https://github.com/VROOM-Project/vroom
- Fleetbase: https://github.com/fleetbase/fleetbase
- FleetOps: https://github.com/fleetbase/fleetops
- Karrio: https://github.com/karrioapi/karrio

## Clean-Room Rule

Implementation is written against this Goal's local contracts and project-native patterns. AGPL code is not opened, copied, translated, ported, or used as a dependency. If a provider or solver is introduced later, its exact version, license texts, transitive dependencies, attribution, data terms, and deployment policy require a separate review.
