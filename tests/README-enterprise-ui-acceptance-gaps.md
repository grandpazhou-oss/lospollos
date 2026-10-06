# Bounded storage-receipt and backend-restart UI acceptance

These two cases address previously recorded B6UI and D8UI gaps. Run one case in
one fresh owned service/browser runtime. They are not a soak or memory-attribution
rerun and do not implement new product features.

    python -B tests/test_enterprise_ui_acceptance_gaps.py --self-test
    python -B tests/test_enterprise_ui_acceptance_gaps.py --case delayed-save --evidence-dir "$RUNNER_TEMP/enterprise-ui-delayed-save"
    python -B tests/test_enterprise_ui_acceptance_gaps.py --case backend-restart --evidence-dir "$RUNNER_TEMP/enterprise-ui-backend-restart"

The --guard flag aliases --self-test. Guard execution checks budgets, failure
reporting, receipt sequencing/restoration, and restart identity/error guards with
synthetic collaborators. It starts no browser, listener, native solver or service.
Passing guards is not GUI acceptance.

Actual UI execution uses the existing approved hosted Linux environment:
Python, Node, OR-Tools 9.15.6755, Python Playwright and managed Chromium. The harness
installs nothing. Missing dependencies or inability to launch Chromium are
BLOCKED_ENVIRONMENT; dependent business stages remain NOT_RUN.

## Fixed operating limits

- One CLI invocation selects exactly one case
- External watchdog: 240 seconds; exceptional cleanup allowance: at most 65 seconds
- CI step timeout: six minutes, with the two cases in sequential steps
- Conservative aggregate RSS cap: 2 GiB; aggregate open FD cap: 1,024; at most two pages
- Native admission remains the product's one active solve limit
- One save receipt can be held for at most 5,000 ms; the browser deadline releases
  it and records expiry as failure, never as successful race coverage
- Prefer free loopback ports 8865/8887; exclude 8787/8877/8791/8766/8788/19095
- Requests are restricted to the two exact owned origins; service workers and
  WebSockets are blocked; only newly invented synthetic workbook data is used
- Evidence directory must be fresh, empty and outside the checkout

The runner reuses ResourceMonitor and supervise_process from
enterprise_browser_soak_support.py. It records PID/startTicks roots and their
descendants. Only launcher-verified own services and explicitly verified native
workers can be added. Cleanup does not signal a process by name or occupied port.
The existing launcher stop verifies command, repository and start identity.
The external supervisor independently checks remaining owned processes on both
normal and abnormal exits.

Before the second case, CI must inspect the first case's summary.json: the summary
must exist and ownedProcessCleanup must confirm PASS, no remaining live/zombie
processes, no signal errors and no forced termination. A business assertion failure
with confirmed cleanup permits the independent second case. Missing/incomplete
cleanup leaves the second case NOT_RUN_OWNERSHIP_UNCONFIRMED.

## B6UI: genuine durable receipt arrives after public study switch

The workbook, mapping, units and CRS steps reuse FaultSuite/full-UI helpers. One
real native outbound solve is independently checked by the existing Python
Haversine/conservation/tiny exhaustive oracle.

The browser appends a declared test wrapper immediately after the unchanged
platform-repository-v19.js response, before platform services create their
repository. The response must match checked-out source exactly before the appendix
is applied. The original frozen repository and transaction code stay unchanged.
The wrapper delegates one named Save to the real repository, waits for native
transaction completion and independent readback, and then holds only its returned
Promise receipt.

Business actions remain public UI actions:

1. Save distinct B through the global library's Save a copy control
2. Reopen complete A, arm the one-receipt timing gate and click Save
3. Confirm genuine commit/readback finished while A's receipt remains held
4. Open B through global Scenario Library → B row → Open, without changing a
   disabled state or invoking a controller mutation from browser evaluation
5. Record B's study/input/scenario/snapshot, pointer/revision, shared study
   context, header and visible save messages
6. Release the exact A receipt before five seconds, drain its continuation and
   verify B and its visible state did not change
7. Export B's draft, verify identity, save B, and publicly reopen A/B with their
   original history identities and correct individual revisions

The global library route is deliberate: in-study Open awaits its save queue and
would not exercise this race. The factory is restored and the gate released in
finally; remaining test wrapper calls directly delegate until context closure.
If the intended Save cannot be matched, B is unreachable while pending, the
five-second deadline expires or the receipt contaminates B, the case fails.
The delay is never extended and a direct controller call is never substituted.

This proves a controlled save-timing GUI boundary, not natural storage latency,
physical quota exhaustion, B7 deletion/import or general storage stress.

## D8UI: actual owned backend restart with the browser retained

enterprise_backend_restart_case.py supplies run_backend_restart_case(suite).
The main calls it after workbook import/units/CRS guard and provides FaultSuite
helpers, budget checks and verified service-root registration. The module records
exact process/instance/job identities and its declared HTTP timing intervention.

The browser context, page and document remain alive while the owned backend
actually exits and the matching launcher starts a new instance on the same ports.
The old worker must exit and the new backend must return a real 404 for the old
job. The browser must expose interruption/failure without a current successful
result. A fresh public retry must complete an independently verified native solve
on the new instance. The owned static web service also restarts through the
launcher; reloading/replacing the browser page would not close this gap.

Interruption wording is judged separately from data safety and native recovery.
Generic incomplete/retry wording does not prove an explanation of the missing old
task: D8_INTERRUPTION_EXPLANATION remains FAIL while earlier safety/native stages
retain their actual outcomes. Native recovery UI remains outside this scope.
An unavailable live-worker timing window, wrong ownership, unchanged instance,
old result adoption, failed retry or unconfirmed cleanup stays a failure/blocker.

## Evidence and exit status

Each case writes a source-bound summary.json, sanitized trace/screenshots,
generated workbook, relevant export, service logs and bounded resources.jsonl
outside source. Summary includes actual Git SHA/dirty state, harness hashes,
assertion stages, controlled intervention, resource limits, and
ownedProcessCleanup including remaining live/zombie processes and forced signals.

- 0: selected business case and required GUI/cleanup assertions passed
- 1: assertion, deadline/resource/ownership/cleanup failure, missing evidence,
  nonterminal status or inconsistent worker exit
- 78: verified environment blocker before business execution

Ordinary DESIGN/COMMAND suites remain separate evidence. These two cases do not
establish physical Windows/macOS, private workbook, real OSRM, authentication,
human visual approval, long-soak qualification or resolution of the inconclusive
memory comparison.
