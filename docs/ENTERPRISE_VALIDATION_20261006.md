# Incremental single-machine validation — 2026-10-06

Base: `5a8078ef0547941ded9aadd53fd3d6cf3ee4faeb` on
`codex/enterprise-hardening-20261006`; PR #1 remains separate. Work is isolated on
`codex/enterprise-validation-20261006`. No merge, deployment, main change, existing
service replacement, dependency installation on a workstation, or history rewrite.

## Reproduced and repaired

- **Runtime coverage:** adding `optimizer/package/solver.py` previously left the
  fingerprint unchanged. Recursive Python module discovery now detects new/changed
  nested code; runtime symlinks are rejected. The check/generator rejects symlinked
  output artifacts. Worker, shared-contract and nested-module mutations have regressions.
- **Worker lifetime:** closing the backend's ownership pipe previously left its
  detached worker computing. The line-delimited request leaves stdin open while the
  manager owns the worker; a dedicated worker watcher exits nonzero on pipe EOF.
  Controlled real-process tests also cover completion, cancellation/start races,
  timeout, crash, mixed HTTP/job admission and recovery. Synchronous solver deadlines
  remain cooperative, not hard termination.
- **Cancellation/disconnect cleanup:** broken stdin close no longer prevents closing
  stdout/stderr. Client connection errors do not provoke a second HTTP response;
  solver admission remains held until computation/finalization actually ends.
- **Report race:** starting an asynchronous comparison then changing a candidate
  could publish the old candidate's snapshot. Changes to captured report inputs now
  cancel the obsolete comparison, without relaxing freshness or verification.
- **Storage completion:** closing a repository during pending IndexedDB open could
  leave the promise unresolved. It now rejects `STORAGE_CLOSED`. Same-ID conflicts,
  CAS, tombstones, late receipts and failed saves retain their existing protections.
- **Road/report evidence:** route inputs are captured before asynchronous dispatch;
  caller mutation cannot rewrite provenance. Before/after affected-distance figures
  use the same known population and distance basis. Incomparable bases suppress the
  distance improvement percentage. Frequency data does not convert volume-km into
  vehicle-km. Numerical solver objectives, constraints, units and tolerances are unchanged.

- **Strict-identity UI integration:** the first real UI run completed native solving but
  failed before showing results: the shared study context rejected the hardening
  branch's new `buildPolicy` and `expectedBuildFingerprint` fields. The context now
  admits only these explicitly typed fields; unknown fields and malformed pins stay
  rejected. Three existing context/bridge/view suites and the full-UI rerun cover it.

## Reproduction

The existing Windows command files had CRLF bytes in Git despite a text/eol=crlf
checkout rule. They are normalized to LF in the Git index and remain CRLF in the
checkout, without changing commands. A regression and read-only post-test Git diff
check prevent inconsistent dirty-checkout evidence. This is not Windows hardware
acceptance.

With the approved existing Python, Node, OR-Tools and browser environment:

```sh
python3 scripts/update_build_identity.py --check
python3 scripts/run_enterprise_checks.py --mode core --output /tmp/stct-core
python3 scripts/run_enterprise_checks.py --mode native --output /tmp/stct-native
python3 scripts/run_enterprise_checks.py --mode browser --output /tmp/stct-browser
python3 tests/test_enterprise_synthetic_full_ui.py --evidence-dir /tmp/stct-full-ui
```

Use the actual approved Python path on Windows. Evidence is outside source; choose
an empty directory for the full-UI suite. The runner records actual Git HEAD, dirty
state and CI event SHA separately. Missing prerequisites are `BLOCKED_ENVIRONMENT`;
checks prevented by those prerequisites are `NOT_RUN`. Test assertion failures stay
`FAIL`. A passed preflight is never a passed business flow.

The full-UI suite creates a two-period invented workbook, drives public UI controls
and calls the real native backend. It covers three scopes, independent Haversine/
conservation/small exhaustive-oracle review, map/report, save/reload, export/reimport,
CRS rejection and stale-export guards. It blocks non-test network destinations and
uses isolated storage. See `tests/README-enterprise-synthetic-full-ui.md`.
Native IndexedDB suites remain component tests, with explicitly injected quota/abort
faults. They are not proof of physical disk exhaustion or a full UI journey.

## Evidence boundaries

The initial cloud Linux baseline passed identity and all 21 selected core commands.
Its Python lacked OR-Tools; separate Chromium launch was blocked by OS socket
permissions. The actual isolated launcher therefore refused readiness and removed
its own processes. Native solver and full UI are not local passes. Revised core
checks pass locally; use the commit-bound read-only GitHub workflow for separate
hosted native/browser evidence. The workflow now includes this incremental branch
and its hardening target. A workflow is evidence only after its exact commit passes.

Hosted Windows checks do not establish a real Windows workstation pass. Physical
Windows, real approved OSRM, customer-data acceptance, human observation and deferred
soak remain outstanding. All added fixtures are explicitly synthetic. Existing
repository material still needs owner-led publication classification; this change
does not delete business files or change repository access/history.

## Isolated operation and rollback

Use a full checkout and an approved environment. Set `STCT_RUN_DIR` to an empty
operator-owned directory outside the checkout; keep the same value for stop.

```sh
python3 scripts/update_build_identity.py --check
python3 scripts/local_trial.py start --web-port 8865 --opt-port 8887 --open
python3 scripts/local_trial.py stop
```

On Windows use the approved Python executable or `STCT_PYTHON` with the existing
`start_windows.cmd`/`stop_windows.cmd`. A missing dependency is a blocker, not an
instruction to install software on a managed computer. Never repoint the browser
pin at an arbitrary running service. Protected ports 8787/8877/8791 stay untouched.

Rollback: stop only this launcher-owned instance, preserve/export any trial studies,
then use a separate worktree of the verified prior hardening commit with its matching
manifest and pin. Re-run identity checks before starting on free isolated ports.
Do not hard-reset another working tree, overwrite existing browser storage, force-push,
or delete research. Reverting code does not promise automatic data-format migration.

No enterprise identity/project authorization, authoritative shared audit/backup,
or durable jobs are added. Backend restart loses in-memory jobs; the UI must display
interruption and old job identities must not be accepted as current work.
