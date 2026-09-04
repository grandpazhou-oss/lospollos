# STCT v1.8 Feature Evidence Matrix

This matrix distinguishes user-visible demonstration surfaces from core-only verification. All evidence uses local synthetic data and does not establish production readiness or global optimality.

| Capability | Exposure | User-visible or machine evidence |
| --- | --- | --- |
| Network map, depot and trip selection | USER_VISIBLE | Network Command Center and browser screenshots |
| Capacity heatmap and non-color labels | USER_VISIBLE | Command Center heatmap plus table-equivalent values |
| Trip chain and time-space relationships | USER_VISIBLE | Command Center panels and no-WebGL table fallback |
| Dock and wave inspection | USER_VISIBLE | Dock Gantt, wave controls and browser evidence |
| Scenario comparison and Decision Room | USER_VISIBLE | Scenario Lab and preview-only recommendation controls |
| Chinese, English and Japanese rendering | USER_VISIBLE | Desktop, mobile portrait and mobile landscape browser profiles |
| No-WebGL and reduced-motion operation | USER_VISIBLE | Static SVG/table fallback and reduced-motion browser profile |
| Independent plan verification | CORE_ONLY | Network verifier assertions and traceability evidence |
| Order conservation and assignment integrity | CORE_ONLY | Negative/adversarial solver and Red Team assertions |
| Pickup-delivery custody continuity | CORE_ONLY | Custody verifier and cross-dock scenario assertions |
| Physical vehicle, driver, dock and charger capacity invariants | CORE_ONLY | Independent verification, chaos and mutation evidence |
| Checkpoint identity and resume integrity | CORE_ONLY | Soak checkpoint replay and corruption assertions |
| Deep Capsule semantic replay | CORE_ONLY | Secure import, mutation and Red Team tamper evidence |
| Uncertainty ensemble integrity | CORE_ONLY | Seeded synthetic ensemble and hash verification |
| Performance provenance and leak analysis | CORE_ONLY | Instrumented raw traces and real-workload soak evidence |
