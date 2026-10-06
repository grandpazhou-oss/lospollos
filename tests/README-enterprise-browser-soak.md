# Bounded synthetic browser and storage soak

Run in an already approved Linux test environment with existing Node, OR-Tools,
Python Playwright and Chromium. This suite installs nothing and does not try an
alternate launch path if Chromium is unavailable or forbidden.

```sh
python -B tests/test_enterprise_browser_soak.py \
  --evidence-dir "$RUNNER_TEMP/browser-soak-$(date +%s)" \
  --duration-seconds 720
```

Defaults: **12-minute sustained operating window**, **30 public-UI cycles**,
**600 separately labeled native IndexedDB component cycles**, and a genuine native
retry after a controlled HTTP 429 initially and every five UI cycles. Setup and
cleanup are outside the 12-minute window; the final bounded transaction can extend
the requested window, with a 180-second operation-overrun failure threshold.
The schedule distributes writes across all UI windows. Between scheduled writes
it continuously performs additional real public-UI reopens and full native-IDB
history readback, including the final interval. Extra readonly checks are separately
counted and do not inflate the complete mutation-cycle counts or create unbounded
history. Requested cadence waits are at most 250 ms. Per-minute operation counts,
measured operation time (including normal response waits), and explicit controlled
interval time are reported separately; pure waiting is never called pressure activity.

For a short, explicitly non-soak harness check:

```sh
python -B tests/test_enterprise_browser_soak.py \
  --evidence-dir /tmp/fresh-browser-soak-smoke \
  --smoke --duration-seconds 0 --ui-cycles 1 --storage-cycles 10 --native-every 1
```

Configuration:

- `--duration-seconds`: 0–900 seconds; qualifying soak requires at least 600
- `--ui-cycles`: 1–50; qualifying soak requires at least 20
- `--storage-cycles`: 1–1000; qualifying soak requires at least 300
- `--native-every`: repeat controlled busy rejection + real native retry at this UI interval
- `--sample-seconds`: .25–5 seconds, default 1
- `--max-rss-mib` / `--max-fds`: can tighten, never exceed the 1024 MiB / 1024 FD budgets
- `--smoke`: permits short configurations; `soakQualification` remains `NOT_QUALIFIED_SHORT_RUN`

The evidence directory must be fresh, empty and outside the checkout. An existing
Chromium executable may be selected with `STCT_CHROMIUM` or `STCT_BROWSER`, exactly
as in the existing full-UI suite. There is no installation or browser fallback.

## Two distinct evidence layers

### Actual public UI, one imported synthetic workbook

The production launcher starts fresh owned loopback services, avoiding protected
ports 8787, 8877, 8791, 8766, 8788 and 19095. One new persistent Chromium profile,
one browser process family and those same services remain in use for the entire
window. Only ordinary page reloads occur; browser/profile restart is not claimed.
There are at most three pages: two actual application tabs and one distinctly
labeled component page. Browser HTTP is restricted to the two exact owned origins;
service workers and WebSockets are blocked. All input is newly invented synthetic
data. No private workbooks, customer data, external routing or cloud service is used.

The workbook enters via the real Data Hub, explicit mapping, units and synthetic
classification. Missing-CRS guard and real OUTBOUND_ONLY native solver verification
are inherited from the proven full-UI/fault suites. Each public-UI cycle:

1. Reopens the same saved study in two actual tabs
2. Edits capacity and scenario name through visible controls, then saves the first tab
3. Edits distinct capacity/name in the stale tab, verifies visible `REVISION_CONFLICT`
   and unchanged stale receipt, and downloads its retained draft
4. Uses the visible save-as-branch recovery control and verifies the draft lineage
5. Reimports the bytes of the actual downloaded package through the visible file
   input; verifies exact study/scenario identity and that it is still unsaved
6. Reopens the saved branch; verifies the original winning pointer is unchanged
7. Reads visible history, reloads the main page, and publicly reopens the current
   version, checking study hash, scenario, revision and absence of stale results

Periodic native retries include an explicitly labeled controlled 429, followed by
an unaltered real backend request and independent Python Haversine/conservation/
small exhaustive-oracle checks. A fabricated solver success is never accepted.
This suite chooses the bounded native-retry option; it does **not** claim repeated
COMMAND manual/apply/cancel coverage. The separate COMMAND acceptance suite covers
those flows.

Application UI state evaluation only observes. Direct controller calls occur only
in the separately labeled component page described below.

### Native IndexedDB component, never counted as UI cycles

The third page loads the production repository/controller modules against browser
native IndexedDB, with a separate uniquely named database. It creates exactly one
study pointer and uses three bounded native connections, not one database per round.
Each component round:

- Reopens the current revision on two independent controllers/connections
- Uses a declared precommit timing barrier so both writers reach actual repository
  commit before either transaction runs; exactly one durable CAS save succeeds and
  one reports `REVISION_CONFLICT`
- Checks revision progression, immutable payload and durable receipt identity
- Injects `QuotaExceededError` and `STORAGE_TRANSACTION_FAILED` separately through
  the existing repository fault seam, rotating all five transaction stages
- Verifies native rollback leaves the pointer, controller receipt, record counts,
  audit counts and immutable history unchanged; no partial rejected record remains
- Opens the original historical version and reopens current, without mutating the
  live pointer; checks every record hash and contiguous audit revision every 25 rounds
  and at the end

These are actual native transaction aborts with **controlled fault injection**, not
real disk exhaustion, browser-quota discovery, customer-scale payloads or UI fault
coverage. Final hard assertions require all configured cycles and minimum coverage.

## Resource budget and interpretation

Linux `/proc` is required. Once per second, the suite samples its own Python PID,
Playwright/browser descendants and verified production-launcher service PIDs and
all their descendants. PID start times guard identity. Metrics include aggregate
and per-process RSS, browser RSS, file descriptor count, thread count, process count,
baseline/last/peak/delta and linear trend. Summed RSS conservatively double-counts
shared pages, and includes the test driver/instrumentation. It is not PSS.

The suite stops on >1 GiB aggregate RSS, >1024 aggregate FDs, >3 tabs, an unhandled
browser error, inconsistent data, false success, or a missing required check.
If the isolated warm-up/baseline already exceeds the budget, it reports
`BLOCKED_ENVIRONMENT` / `NOT_RUN_RESOURCE_BASELINE_BLOCKED`, without relaxing it.
After the soak starts, a resource-bound violation is `FAIL`. The sampling thread
interrupts only this test's main thread to run owned cleanup; it never signals
another process by name or port. SIGTERM is handled as an interrupted failure with
owned-service cleanup and retained evidence. SIGKILL cannot be handled.

Normal immutable history intentionally grows. For N component cycles, exactly
N+1 small immutable study records and N+1 audit records, one pointer and zero
snapshots must exist. UI growth is separately measured in readonly native store
counts and browser storage estimates: one main study and at most one new recovery
branch per configured UI cycle (maximum 50). UI autosave can add audit revisions;
it is not assumed to make exactly one revision per human save click. Periodic native
retries also add expected snapshots. No archive is created without a configured
bound, no database is filled to force quota exhaustion, and observed history/disk
growth is not automatically called a memory leak. Conversely a finite bounded run
is never labeled proof of absence of leaks.

## Evidence, status and cleanup

- `summary.json`: actual checkout SHA, dirty flag/paths, diff and harness hashes,
  requested and completed coverage, qualification, stage status, baseline/final
  storage, resource trends and cleanup result; flushed after each component/UI cycle
- `cycles.jsonl`: every stage and component round, UI cycle, revision/hash/branch,
  fault method, native job identity, per-cycle coverage, storage and trend checkpoint
- `resources.jsonl`: periodic `/proc` samples and any budget/observation failure
- Synthetic input workbook, each retained downloaded package, baseline/first/middle/last/
  final screenshots, failure diagnostics and sanitized launcher/service logs
- On an application/invariant/resource failure after startup, the closed synthetic
  browser profile is moved into the external evidence directory for reproduction
  when possible; there is no continuous trace to inflate instrumentation overhead

Start/end source identities must match; an edit during execution invalidates the
run rather than attaching evidence to a different source. Prior evidence is never
replaced. Runtime cleanup calls the real launcher's identity-checked stop, closes
only the browser/profile created by this invocation, and checks owned ports became
available. It never kills by port/image name. A cleanup failure makes the run fail
and retains the ownership receipt. There is no merge, deployment, installation or
modification of production code by this harness.

Exit status: 0 means all configured checks and cleanup passed; 1 means failure or
interruption; 78 means an environment/dependency/browser/baseline-budget blocker.
A short smoke exit 0 is **not** qualifying soak evidence. Always inspect both
`status` and `soakQualification` plus actual coverage before making acceptance claims.
