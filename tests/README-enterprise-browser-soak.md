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

- `--workload-profile`: `mutation-soak` (default), `fixed-history-recovery`
  (fast seed), or `paced-history-recovery` (original 720-second seed cadence);
  both history-recovery profiles are diagnostics, not mutation-soak qualification
- `--duration-seconds`: 0–900 seconds; qualifying soak requires at least 600
- `--ui-cycles`: 1–50; qualifying soak requires at least 20
- `--storage-cycles`: 1–1000; qualifying soak requires at least 300
- `--native-every`: repeat controlled busy rejection + real native retry at this UI interval
- `--sample-seconds`: .25–5 seconds, default 1
- `--memory-profile`: `standard-1gib` (default, 1024 MiB) or explicit `hosted-2gib`
  (2048 MiB, independent hosted-runner qualification only)
- `--max-rss-mib`: optional tighter RSS limit within the selected profile; it cannot
  enlarge the default profile. `--max-fds` remains capped at 1024 in both profiles
- `--max-wall-seconds`: independent worker wall-clock limit, default 180 seconds for
  smoke or requested duration + 120 seconds otherwise; includes setup, unlike the
  sustained operating-window clock. Deadline always fails, never skips assertions
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

Linux `/proc` is required. Once per second, the suite samples its supervisor and
worker Python PIDs, Playwright/browser descendants and verified production-launcher service PIDs and
all their descendants. PID start times guard identity. Metrics include aggregate
and per-process RSS, browser RSS, file descriptor count, thread count, process count,
baseline/last/peak/delta and linear trend. Samples and trends separate Chrome, owned
services/native workers, Playwright driver, and Python/test harness processes. The
launcher receipts identify service roots; process names do not authorize cleanup.
Before the sustained window, a ten-second idle observation records multiple actual
samples, medians, minimum/maximum/range, standard deviation and variation relative
to median. No GC is injected, no test action mutates the app in that idle interval,
and no resource limit is adjusted to fit observed usage. Summed RSS conservatively double-counts
shared pages, and includes the test driver/instrumentation. It is not PSS.

Before that baseline, a separate 32-handle control proves that real Playwright
`wait_for_function` results register as protocol handles, and that disposing all
32 returns the handle count to its exact prior value. The public navigation/reopen
helpers dispose their consumed boolean wait results. This addresses test-owned
handle lifetime; the control does not attribute all observed RSS growth to handles.
Once per minute and at the final invariant check, `memory_diagnostic` JSONL records
the installed Python Playwright protocol-object registry counts, pending callback
count, resource-sample retention count, and existing log-file sizes. Short-lived
read-only CDP sessions collect heap, document, DOM-node and listener counters for
each page and detach immediately. Renderer metrics may cover shared work; they
are not independent per-page RSS. There is no forced GC, heap snapshot, continuous
trace, browser/profile restart, extra application mutation, or changed resource
ceiling. The original load schedule and coverage gates remain unchanged.

The original `aaefcfb` hosted run passed its functional and upper-bound checks but
left a memory-stability question open: aggregate RSS peaked at 2,119,540,736 bytes,
leaving only 27,942,912 bytes below the unchanged 2 GiB limit. Python harness RSS
rose by 133,316,608 bytes; Chrome and driver growth are separately recorded. A
same-load hosted comparison is required to measure the handle-lifetime correction.
Finite functional success and remaining under the ceiling do not establish
memory stability or absence of a product leak. If growth remains unresolved,
separate fixed-history readback and recovery observations are the next controls.

The suite stops above its explicitly named aggregate RSS budget (default 1 GiB,
independent `hosted-2gib` 2 GiB), >1024 aggregate FDs, >3 tabs, an unhandled
browser error, inconsistent data, false success, or a missing required check.
If the isolated warm-up/baseline already exceeds the budget, it reports
`BLOCKED_ENVIRONMENT` / `NOT_RUN_RESOURCE_BASELINE_BLOCKED`, without relaxing it.
After the soak starts, a resource-bound violation is `FAIL`. The sampling thread
publishes an atomic abort marker and never injects an asynchronous exception into
Playwright's synchronous dispatcher. SIGTERM on the worker sets a cooperative stop
flag. An independent test-specific supervisor observes the marker and bounds the
whole process even if a browser promise or cleanup stalls. It first requests graceful
worker shutdown, calls the launcher's identity-checked stop independently of
Playwright, then signals only this invocation's previously observed descendant
PID/start-time identities if still necessary. No process-name or port matching is
used. Each grace wait is at most 10 seconds; service stop is bounded at 40 seconds,
and a last owned-process wait at 5 seconds. Deadline and forced cleanup are recorded
as failure, with the original last stage and profile retained. Normal child exit also checks every recorded owned PID/start-time
identity for surviving live processes. An unexpected live remainder fails the run
even if subsequent cleanup succeeds. pidfd signaling is used where available, with
a start-time recheck after opening the descriptor. After termination, a bounded
wait and final live/zombie process report establish the actual result; sending
SIGKILL alone is not treated as proof of cleanup. Zombies are reported separately
as non-running processes. A directly delivered
SIGKILL cannot be handled by the process receiving it.

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


## Original 1 GiB evidence and independent hosted profile

The immutable earlier artifact `ci-bd9c019/preflight/browser` (GitHub artifact
`enterprise-soak-preflight/browser/resources.jsonl`) records at 2.196 seconds:
aggregate owned-process RSS **1,093,218,304 bytes**, against **1,073,741,824 bytes**;
Chrome-only RSS was **747,298,816 bytes**. No complete public-UI or component-soak
cycle had run. The resource interruption then exposed the old harness's synchronous
Playwright-dispatcher hang, leaving its old summary at `RUNNING` without cleanup.
That artifact remains unchanged. It establishes an initial aggregate-budget block
and a harness shutdown bug, not Chrome alone exceeding 1 GiB and not an application
memory leak.

An explicitly approved, separately named hosted calibration run uses:

```sh
python -B tests/test_enterprise_browser_soak.py --memory-profile hosted-2gib \
  --duration-seconds 720 --evidence-dir /tmp/fresh-browser-soak-hosted-2gib
```

The same flag can be appended to the short smoke command. Summary records the exact
profile, effective ceiling, calibration reason and reference to the original 1 GiB
artifact. It does not rewrite or reclassify that original evidence, change a product
memory guarantee, increase concurrency, change the runner, or relax FD/tab limits.
A pass in `hosted-2gib` is evidence for that explicitly named profile only.

## Separate fixed-history and natural-recovery diagnostic

The same-load `1dfd614` comparison kept consumed boolean JSHandles at zero but
Python RSS still increased by 129,249,280 bytes, versus 133,316,608 previously.
Request/Response/Route counts rose from 406 to 6,076 each; ElementHandles rose from
25 to 325. The handle correction therefore did not explain the main RSS growth.
This separate profile tests repeated reads at fixed durable history, followed by
ordinary idle recovery, without rewriting either original mutation-soak result.

```sh
python -B tests/test_enterprise_browser_soak.py \
  --workload-profile fixed-history-recovery --memory-profile hosted-2gib \
  --fixed-history-seconds 360 --recovery-seconds 180 --seed-max-seconds 300 \
  --max-wall-seconds 960 --evidence-dir /tmp/fresh-browser-fixed-history
```

It seeds exactly 30 complete UI cycles and 600 component cycles using the existing
save/conflict/branch/export/import/reload/history assertions and seven genuine
native retries. This seed is unpaced (`duration-seconds` defaults to zero for this
profile) and must finish within 300 seconds. A rapid-seed resource/deadline failure
remains a failure; the resource cap is not adjusted. Seed duration is not claimed
as a sustained mutation-load observation.

The next phase performs at least six minutes of public reopens and full component
history verification, with at least one actual operation in every complete minute.
The last phase observes at least three minutes of ordinary idle recovery, reporting
zero pressure operations. Resource samples and once-per-minute read-only
CDP/protocol counters continue in both phases. Phase resource trends are separate.
The same three page objects, browser/profile, exact-origin network guard, services
and 2 GiB ceiling remain throughout. There is no browser restart, forced GC,
dispatcher-threshold override, private-map deletion, trace or package patch.

Before readback and after each control phase, readonly native transactions read
every row from `supplyStudies`, `supplySnapshots`, `pointers` and `audit` in each of
the two existing databases. Record counts and SHA-256 digests of the complete row
arrays must match exactly, detecting changed history, pointer revisions, records
or audit contents even when counts remain equal. The database set must also stay
unchanged. Digests and counts are retained in the summary; browser quota estimates
are observations, not exact-stability assertions. No diagnostic write is made to
the application's persistent data. If a database disappears between enumeration
and open, any upgrade transaction is aborted, its connection is closed, and the
observation fails instead of recreating the database.

`status: PASS_DIAGNOSTIC` and `diagnosticQualification: PASS_DIAGNOSTIC` establish
that these configured controls, data invariants, resource bounds and cleanup
passed. `soakQualification` remains `NOT_MUTATION_SOAK`; no leak-free or overall
stability conclusion follows automatically. On worker failure, cleanup failure or
supervisor interruption, diagnostic qualification is finalized from the terminal
status (`FAIL` or `BLOCKED_ENVIRONMENT`) and cannot retain an earlier pass. The
diagnostic `soakQualification` label remains `NOT_MUTATION_SOAK` on those paths.
The independent watchdog is at most
960 seconds, with the existing bounded owned-process cleanup afterward. Seed,
readback and idle budgets together may not exceed 900 seconds; watchdog must cover
those budgets plus at least 30 seconds. CI should also leave room for supervisor
cleanup. The default mutation profile's duration and minimum gates are unchanged.

The short diagnostic qualification is explicit and cannot receive long-profile
qualification:

```sh
python -B tests/test_enterprise_browser_soak.py \
  --workload-profile fixed-history-recovery --memory-profile hosted-2gib --smoke \
  --ui-cycles 1 --storage-cycles 10 --native-every 1 \
  --fixed-history-seconds 2 --recovery-seconds 2 --seed-max-seconds 60 \
  --max-wall-seconds 180 --evidence-dir /tmp/fresh-browser-fixed-history-smoke
```

Successful smoke reports `PASS_DIAGNOSTIC_SMOKE`, `NOT_MUTATION_SOAK`, and
`diagnosticQualification: NOT_QUALIFIED_SHORT_RUN`. Run browser-free guard checks
with `python -B -m unittest discover -s tests -p test_enterprise_browser_soak.py`.
These test configuration boundaries, exact fingerprint tamper detection, a
controlled missing-after-enumeration request event, and worker/supervisor terminal
qualification. The controlled request event is not native-IDB/browser evidence;
actual browser control execution still requires the approved runtime.

## Separate paced-seed recovery diagnostic

The `2f29dc0` fast-seed diagnostic remains **FAIL**. At 156.84 seconds, after
24 completed UI cycles and 480 component cycles, aggregate RSS reached
2,149,654,528 bytes, exceeding the unchanged 2,147,483,648-byte limit by 2,170,880
bytes. The supervisor stopped that run and verified all 18 observed owned
processes cleared. Neither the fixed-history nor idle-recovery phase ran. Its
artifact and failure classification are preserved.

`paced-history-recovery` is a separately named control using the original
720-second mutation cadence to seed the same history before the existing
360-second fixed-history and 180-second natural-idle controls:

```sh
python -B tests/test_enterprise_browser_soak.py \
  --workload-profile paced-history-recovery --memory-profile hosted-2gib \
  --duration-seconds 720 --ui-cycles 30 --storage-cycles 600 --native-every 5 \
  --seed-max-seconds 900 --fixed-history-seconds 360 --recovery-seconds 180 \
  --max-wall-seconds 1500 --evidence-dir /tmp/fresh-browser-paced-history
```

The exact original scheduler and strict seed checks are reused. Read-only public
reopens and native full-history checks fill intervals between scheduled writes
and any remainder of the requested 720-second seed window. Seed evidence includes
requested and observed cadence, actual operation counts per minute and the same
complete UI/component/native counts. In this diagnostic the seed is setup for
the following controls and `qualifiesMutationSoak` remains false. It does not
substitute for, repair or reclassify the failed fast-seed workload.

The existing fixed-history fingerprints, missing-database upgrade-abort guard,
same three page identities, profile/databases, exact-origin guard, 2 GiB ceiling,
natural idle, CDP/protocol observations and failure-status normalization apply
unchanged. No dispatcher retention setting, GC, trace, vendor code or application
behavior is changed. Successful full/smoke diagnostics retain their distinct
`PASS_DIAGNOSTIC` / `PASS_DIAGNOSTIC_SMOKE` statuses and `NOT_MUTATION_SOAK` label.

Full paced seed cadence must be exactly 720 seconds with exactly 30 UI cycles,
600 component cycles and native retry every five UI cycles. Its seed deadline is
at most 900 seconds; seed/read/idle budgets total at most 1,470 seconds and the
independent watchdog must cover those budgets plus 30 seconds, capped at 1,500
seconds. The existing supervisor cleanup remains bounded by another 65 seconds;
a 27-minute CI step leaves room for both. These bounds apply only to the paced
profile. The original mutation profile defaults and fast diagnostic's 960-second
watchdog ceiling remain unchanged.

Tiny paced qualification is explicit and never qualifies as a full diagnostic:

```sh
python -B tests/test_enterprise_browser_soak.py \
  --workload-profile paced-history-recovery --memory-profile hosted-2gib --smoke \
  --duration-seconds 2 --ui-cycles 1 --storage-cycles 10 --native-every 1 \
  --seed-max-seconds 60 --fixed-history-seconds 2 --recovery-seconds 2 \
  --max-wall-seconds 180 --evidence-dir /tmp/fresh-browser-paced-history-smoke
```

The browser-free guard suite covers both diagnostic profiles, original defaults,
short-cadence rejection outside smoke, distinct seed/watchdog limits, unchanged
RSS bounds and all diagnostic terminal-status paths. Real paced-control results
still require execution in the approved hosted runtime.

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

The component's init, cycle and final history Promise each have a 15-second
deadline, in addition to the 5-second two-writer barrier limit and independent
process watchdog. A timeout fails with its operation name. Stage starts are printed
and flushed immediately to CI stdout, and failure summary is written before
Playwright cleanup. This makes preflight stalls inspectable without waiting for
normal completion or artifact upload. The persistent context keeps a live owned
page while replacing its initial blank page.

Start/end source identities must match; an edit during execution invalidates the
run rather than attaching evidence to a different source. Prior evidence is never
replaced. Runtime cleanup calls the real launcher's identity-checked stop, closes
only the browser/profile created by this invocation, and checks owned ports became
available. It never kills by port/image name. A cleanup failure makes the run fail
and retains the ownership receipt. There is no merge, deployment, installation or
modification of production code by this harness.

Exit status: 0 means all configured checks and cleanup passed (including separately
labeled diagnostic or diagnostic-smoke success); 1 means failure or
interruption; 78 means an environment/dependency/browser/baseline-budget blocker.
A short smoke exit 0 is **not** qualifying soak evidence. Always inspect both
`status` and `soakQualification` plus actual coverage before making acceptance claims.
