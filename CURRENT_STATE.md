# Current hardening candidate — 2026-10-06

Authority for this branch: this file, `BUILD_IDENTITY.md`, and the selected CI checks.
Base implementation: `a37e2ea813219fd506636e6521e9e45d56823ec0` on
`codex/windows-handoff-map-showcase-20261005`. This remains a **single-machine,
controlled trial**, not an enterprise production release.

## Changes in this candidate

- An unbound import or load cannot take over an existing study ID. Both identical
  and different-content imports return `REVISION_CONFLICT`; the existing UI offers
  “另存为分支” and draft export. Open an existing saved study to edit it. Repository
  compare-and-swap, history and immutable records remain in force.
- The shipped UI configuration selects `STRICT_PINNED`. Missing/malformed pins or
  a different runtime build prevent submission. `COMPATIBLE_WARN` remains an explicit
  development option. The standalone controller also defaults to STRICT_PINNED;
  missing configuration never enables warning mode implicitly. Neither mode is authentication.
- One process-wide solver lease is shared by jobs and the four retained synchronous
  endpoints. Busy requests receive HTTP 429. Cancellation does not release the job
  lease before the worker finalizer reaps the process. Synchronous facility/joint
  calls receive an overall deadline. This is not a durable or distributed queue.
- Automatic cross-study OSRM reuse requires the configured network version, profile,
  local endpoint, coordinate policy, directed coordinates, snap limit and freshness
  to match. The default age limit is 30 days; configure `roadReuseMaxAgeMs` as needed.
  Missing provenance requires deliberate import/regeneration. Road values remain
  `ESTIMATED_ROAD`; truck restrictions and traffic are still unverified/unmodeled.
- Runtime manifest verification includes the real worker and all recursive optimizer
  Python modules, including nested packages. LF checkout rules prevent Windows Git line-ending conversion from
  invalidating exact-byte hashes.

No solver objective, precision, constraint or verifier tolerance is weakened.
Historical F19's expectation of implicit revision adoption is intentionally replaced
by the new conflict requirement; native IndexedDB and real-controller regressions
cover the corrected behavior.

## Current controlled launch

Use a **full source checkout** of this candidate with the existing approved Python
and `ortools==9.15.6755` environment. Do not install dependencies automatically on
company devices. Verify identity before starting:

```sh
python3 scripts/update_build_identity.py --check
python3 scripts/local_trial.py start --web-port 8865 --opt-port 8887 --open
python3 scripts/local_trial.py stop
```

Windows: use your approved Python executable (or `STCT_PYTHON` with the existing
`start_windows.cmd`). Existing ports 8787/8877/8791 and existing services are not changed.
`http://127.0.0.1:8865/index.html?optPort=8887#/` is the isolated trial entry.
Do not use the historical v1.4–v1.8 clean-dist builders as a release procedure for
this branch: their file scopes are not this candidate's complete runtime. No new
public distribution or Netlify deployment is produced by this change.

## Reproducible selected checks

```sh
python3 scripts/run_enterprise_checks.py --mode core
python3 scripts/run_enterprise_checks.py --mode native
python3 scripts/run_enterprise_checks.py --mode browser
```

`core`: synthetic module tests and controlled HTTP tests; no native-solver claim.
`native`: pinned OR-Tools, actual solver/worker lifecycle and isolated launcher tests.
`browser`: real Chromium and native IndexedDB across two pages, using actual modules
in a component harness; not a full-UI acceptance claim. Playwright and its browser
must already be installed. Evidence defaults to a temporary directory outside source.
Missing dependencies are an explicit failure/block, never a PASS or hidden skip.
CI dependency installation happens only on ephemeral hosted runners.

## Still outside this change / release blockers

- Public-repository business-data classification and owner approval remain unresolved.
  Source trees, profiles and history may contain internal material. A static HTTP
  allowlist is NOT approval for publication. No files/history are removed and no
  repository visibility or access settings are changed automatically.
- Authentication/project authorization, server-side authoritative audit, shared
  persistence and backup/restore are not implemented by this single-machine patch.
- Jobs remain in memory. Refresh interruption/cancellation is preserved; this is not
  a resumable background job service. Saved-study recovery is a separate behavior.
- Physical Windows operation, real OSRM, private-dataset business acceptance, full UI
  end-to-end and deferred soak still require their own evidence and approval.
- No branch merge, force push, deployment or existing-service switchover is part of CI.

## Validation and omission repairs — 2026-10-06

The incremental validation candidate is based on hardening commit
`5a8078ef0547941ded9aadd53fd3d6cf3ee4faeb`, not `main`. See
[the validation record](docs/ENTERPRISE_VALIDATION_20261006.md) for newly reproduced
defects, test commands and evidence boundaries. It remains a Draft candidate.
