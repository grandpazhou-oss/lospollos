# STCT v1.8 Security and License Boundary

## Local Demo Boundary

STCT v1.8 is a local deterministic demonstration. It is not a production control tower, certified optimizer, live warehouse system, navigation service, or proof of a global optimum.

## External Services

Public OSRM, Valhalla, VROOM, and other public routing or optimization calls are disabled. Coordinates may be sent only to an explicitly configured local provider after explicit transmission approval. The existing MapLibre/OpenFreeMap/OpenStreetMap presentation can still depend on external map assets and must disclose attribution and availability limits.

## Data and Import Security

Customer Excel files, cleaned derivatives, addresses, coordinates, screenshots, logs, and route results remain internal unless separately approved. Clean distribution excludes customer workbooks and templates containing operational data. JSON imports reject dangerous object keys and enforce byte, depth, and entity limits. CSV exports protect formula-leading cells, HTML is escaped, filenames are normalized, and release candidates are scanned for secrets, absolute paths, and unexpected binary files.

## Open Source

The v1.8 implementation is clean-room work built on the existing STCT codebase. No AGPL source code was copied. MapLibre GL JS, SheetJS Community Edition, and Google OR-Tools retain their own licenses and notices. Inspired behavioral patterns are documented without importing third-party source.

## Known Limitations

Security checks are local static and runtime guards, not a penetration test or production security certification. The demo has no production identity provider, multi-tenant authorization, secrets vault, hardened upload service, live GPS guarantee, traffic SLA, or audited production deployment controls.
