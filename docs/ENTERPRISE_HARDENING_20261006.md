# Enterprise hardening integration — 2026-10-06

This is a controlled single-machine candidate, not a production release. The base is
`a37e2ea813219fd506636e6521e9e45d56823ec0`. Work is isolated on
`codex/enterprise-hardening-20261006`, targeting the active Windows-handoff branch,
not the old `main`. No merge, force push, deployment or user-service switch is performed.

## Integrated fixes

1. Unbound same-ID imports cannot adopt the current revision, including identical
   drafts and complete packages. Explicit editing retains repository CAS; switching
   studies while a save is pending invalidates the stale save. Tombstones are retained.
2. Default STRICT_PINNED admission rejects missing/malformed/mismatched pins. Only
   explicit COMPATIBLE_WARN allows developer compatibility with an explicit warning.
3. A verified runtime manifest includes worker, optimizer modules and shared runtime
   contracts. Service and launcher validate it; regeneration updates the frontend pin.
4. The four synchronous solver endpoints and jobs share one process-wide lease.
   Overlap receives 429; cancellation retains the lease until the worker is reaped.
   Facility/joint synchronous calls receive an overall deadline. This is not a queue.
5. Cross-study OSRM reuse checks direction, coordinates/CRS, network/profile/endpoint,
   snap evidence, assumptions and age. Expired OSRM rows do not suppress regeneration.
   This does not upgrade driving estimates into verified truck routing.
6. Explicit regression commands and read-only CI run on pushes/PRs. CI is not itself a
   protected-branch rule; repository access/rules have not been changed.

No solver objective, numeric precision, capacity constraint or verifier tolerance is
weakened. Historical F19's implicit-adoption expectation is intentionally corrected.
The old compatibility-only health vector now explicitly selects COMPATIBLE_WARN;
strict defaults remain covered by independent regression tests.

## Evidence

The integration workflow run `37353887590` completed successfully, running 21 core
commands, 11 native-mode commands (including the OR-Tools dependency check), and two
browser-mode commands (dependency check plus the real Chromium/IndexedDB component
suite). Source changes were committed and pushed only after those checks succeeded,
as `78d251389a9103f98716262d91742736f66c42ff`.

The real storage suite covers two-page CAS, conflicting and identical imports,
explicit new-ID copies, and reload/readback. It uses real production modules and native
IndexedDB in a component harness, **not** full-UI end-to-end acceptance. Core suites
separately include 36 Node test cases with controlled domain collaborators and 44
real-module assertions with synthetic memory storage. These counts are not interchangeable.
Native mode includes real OR-Tools as well as separately named controlled subprocess tests.

Use the permanent `Enterprise hardening checks` workflow for commit-bound evidence.
The initial local Chromium attempt was blocked by ERR_BLOCKED_BY_ADMINISTRATOR; that
is not reported as a local pass. Hosted CI supplies separate real-browser evidence.

Temporary source-snapshot and apply workflows are removed from the final tree; the
permanent workflow has read-only repository permissions and never writes source.
Historical source artifacts expire after one day; test evidence expires after seven.
Removal of a workflow file does not erase historical runs or artifacts.

## Reproduce

With an approved environment, use `scripts/run_enterprise_checks.py --mode core`,
`--mode native`, or `--mode browser`. Read `CURRENT_STATE.md` and `BUILD_IDENTITY.md`.
No dependency installation is performed on user/company devices by these scripts;
CI installs dependencies only on ephemeral hosted runners.

## Unresolved boundaries

Public-repository business-data classification/owner approval/history cleanup,
enterprise identity/project authorization, authoritative shared audit, durable jobs,
server backup/restore, actual Windows-workstation acceptance, real OSRM, private-data
business acceptance and full UI/soak are not completed by this patch. Jobs still live
in memory; refresh interruption and cancellation are not resumable execution.
No business data or Git history is removed, and repository visibility is unchanged.
Keep the PR as a draft pending remaining applicable acceptance and maintainer review.
Rollback with a normal revert, not destructive branch updates or data deletion.
