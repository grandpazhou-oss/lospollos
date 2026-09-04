# STCT v1.7 Open Source Inspiration

This implementation is a clean-room local demo. No AGPL source code was copied.

| Project / pattern | Pattern studied | STCT v1.7 adaptation |
| --- | --- | --- |
| Traccar | Append-only device events, per-device tracks, seek, offline/stale state | Immutable execution events, per-vehicle tracks, Flight Recorder seek, explicit stale/partial labels |
| Timefold | Derived state, pinning, continuous planning, change minimization | Derived operational state, cutoff-aware recovery, change-penalty evidence |
| Fleetbase / FleetOps | Activity timeline and order/route/execution separation | Shared Fleet Timeline, route execution contracts, dispatcher alert/recovery workflow |
| Karrio | Provider-owned claims and connector normalization | Reported-versus-derived telemetry split and provider provenance |
| OSRM / Valhalla | Route matching, snap confidence, provenance | Local fixture provider match, snap confidence, disabled external adapters |

External routing services remain disabled by default. Existing OpenFreeMap/OpenStreetMap-derived map assets may require network access and retain their own attribution and availability boundaries.
