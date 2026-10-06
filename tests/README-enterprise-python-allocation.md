# Bounded paired Python allocation diagnostic

This diagnostic answers a narrow question about the **Python automation worker's**
allocations and a declared subset of retained protocol/collector objects. It does
not qualify a mutation soak, attribute Node/Chrome/native allocations, establish a
product leak, or repeat the completed 720-second verification.

Run once in the approved hosted Linux environment with its existing pinned
Playwright 1.57, Chromium, Node and OR-Tools. There is no dependency installation,
local-browser fallback, forced GC, private-registry deletion or vendor change.

```sh
python -B tests/test_enterprise_python_allocation.py \
  --evidence-dir "$RUNNER_TEMP/enterprise-python-allocation"
```

The directory must be fresh, empty and outside the checkout. There are no options
to enlarge budgets or add/repeat arms. Pure guards do not start any service:

```sh
python -B tests/test_enterprise_python_allocation.py --self-test
python -B -m unittest discover -s tests -p test_enterprise_python_allocation.py -v
python -B -m unittest discover -s tests -p test_enterprise_python_allocation_support.py -v
```

## Fixed workload and ordering

The two arms run sequentially, **trace off then trace on**, each with fresh owned
services, a fresh persistent profile and the existing three-page browser setup.
Both use the same inherited import, missing-CRS guard, initial native solve,
selected-wait qualification, 32-handle control and ten-second idle baseline.
Both run the same bounded object census. The sole instrument switch is
`tracemalloc.start(1)` in the on arm, before the idle baseline; the off arm rejects
ambient tracing. This is an ordered instrument-control pair, not a randomized
causal estimate of all RSS differences.

Tracing starts **after setup**, before the ten-second idle baseline. Allocations
already alive from imports, browser startup, workbook import and the initial
native round therefore have no tracemalloc allocation-site attribution. The
object census still includes its declared subset of those existing objects.
Changes in live traced bytes are not changes in all Python RSS. Each arm records
Python implementation/version, OS release/architecture, Playwright, actual Chromium,
OR-Tools and the Node executable selected by Playwright itself (`--version` on
that fixed executable, not a system-Node lookup).

`enterprise_python_allocation_schedule.json` contains only operation kinds and
relative target clocks from the first five UI cycles of the completed source
`680a807c57c220568caec96da31ad8b8ef1216e5` run. Its provenance includes the original
`cycles.jsonl` SHA-256. The harness pins the fixture's own SHA-256. Targets are
original `operation_timing.elapsedSeconds - seconds - soak_window_start`, rounded
to four decimals; UI targets explicitly retain the original cadence at
**0, 24, 48, 72 and 96 seconds**. The final periodic native operation starts at
119.1931 seconds in this frozen schedule.

There are exactly **325 scheduled operations per arm**:

- Five complete real public-UI mutation cycles, including five ordinary reloads
- 100 separately labeled real IndexedDB component/fault cycles
- 219 public reopens plus full component-history probes, at the same sequence positions
- One periodic controlled-busy rejection and genuine native retry after cycle five
- An additional initial genuine native round occurs before the baseline

`cycle_ui`, `storage_batch(1, expired_boundary)`, `durability_probe` and
`native_round` reuse the existing business assertions. The new scheduler never
fills spare time with probes: its `operate_until` override rejects future
throughput-filling boundaries. Every actual start/end, target, sequence index and
completion/stop status is exported as bounded scalar metadata. A start more than
two seconds late stops the arm; no operation is skipped, accelerated or relabeled
to repair the schedule. Both arms use the same baseline and cycle-one checkpoint
screenshots temporarily. There are no automatic cycle-three/cycle-five/final
checkpoint screenshots from treating five cycles as a standalone soak. Existing
setup/native business screenshots still occur identically in both arms.

The same operation methods and extra scheduler/census bookkeeping apply to both
arms. That bookkeeping differs from the historic 680 run: the fixture preserves
the selected operation kinds/order/target clocks, not every incidental historic
collector call. Automatic throughput-timed in-window CDP observations are disabled
identically; the declared baseline/endpoint census calls are fixed.

## Measurement and stopping gates

- Three pages, aggregate RSS hard cap 2 GiB, aggregate FD cap 1,024
- Preventive instrument stop at **RSS >= 1,856 MiB**, checked during guards and
  immediately before either allocation checkpoint; no large snapshot is taken
  after this gate is reached
- Maximum activity interval **150 seconds per arm**; independent arm watchdog
  **240 seconds**, plus the existing at-most-65-second abnormal cleanup sequence
- Independent pair watchdog **660 seconds**, plus its own at-most-65-second
  cleanup; the CI step has a 13-minute outer limit
- Only two allocation checkpoints, `baseline` and `endpoint`, in each arm
- A complete checkpoint API call, including evidence write and error return,
  must finish within **two seconds**. Both inner measurement and outer call
  durations are recorded; delayed/incomplete calls cannot pass
- Tracemalloc metadata storage above **32 MiB** stops the arm. The on arm uses
  one frame; snapshots are immediately reduced to allowed module/line allocation
  bytes and block counts, then discarded. No raw snapshot is exported
- Each allocation aggregate and scalar summary file is capped at **1 MiB**;
  the complete scalar artifact has an **8 MiB** stop budget
- Census limits are 200,000 unique visited objects and container depth six.
  Incomplete census or aggregation is an inconclusive stop, never a smaller
  unannounced measurement scope

The existing `supervise_process` owns all arm and pair deadlines and cleanup.
No second process-supervision implementation is introduced. The arm supervisor
and outer pair supervisor are both included in aggregate RSS roots, using verified
PID/start-time identities. Allocation snapshots measure only the Python arm worker,
not these supervisor processes. Both levels adopt only this invocation's explicit
service ownership receipts, use the launcher's existing identity checks and retain
normal/abnormal cleanup evidence. A timed-out or leaked arm prevents the next arm
from starting. Stale success, unknown status, nonzero child exit or incomplete
cleanup becomes a nonzero diagnostic stop.

At activity start a fixed 150-second timer writes the existing arm
`abort-request.json` flag; the external arm supervisor observes it even if an
unchanged native business wait is blocked. The timer is cancelled after activity
and before the endpoint allocation checkpoint. Its trigger time and subsequent
supervisor/cleanup times are retained. A recorded timer trigger or remaining arm
abort flag prevents pair success even if a child exits zero before its supervisor
consumes the flag. Immediately after spawning an arm, its verified PID/start-time
root is atomically published to the pair receipt, before waiting for launcher
startup. The worker then expands this receipt as services and browsers appear.
Atomic pair receipts contain the verified
arm worker, Playwright driver and Chrome PID/start-time roots as well as the owned
services, so newly appearing descendants remain discoverable after an intermediate
parent exits. Terminal summaries are written before post-exit scalar projection;
partial event lines or projection failures cannot leave stale running/success output.

The support census measures a **declared reachable subset**, with globally
unique-object accounting and explicitly excluded ownership/event-loop edges. Its
`sys.getsizeof` sums are lower bounds for those declared fields, not dominated
retained bytes or process RSS. Both arms receive the same protocol registry view,
resource-sample collection and result-field projection. The four selected result
collections are `nativeRequests`, `consoleErrors`, `genuineNativeSuccesses` and
`latestDraftRoundtrip`; other result/stage trees are explicitly outside that census.

## Business matching without hiding meaningful differences

Normalization is used **only by the offline comparison between arms**. Each arm
continues the original package/input/snapshot consistency checks and complete
save, conflict, branch, draft, history, native oracle and component fault assertions.
No normalized value is passed into the application or used to weaken those checks.

The comparison keeps the complete five draft packages and endpoint
study/profile/scenario/savedPointer structures, then hashes their normalized
representations. All node/supplier/customer IDs, periods, source rows, coordinates,
units, quantities, fees/rates, scenario values and any other business fields remain
unchanged. Only these exact generated paths have fixed substitutions:

| Exact path | Checked substitution |
| --- | --- |
| `study.studyId` | One consistent `SUPPLY-<digits>` root identity per arm |
| `study.inputHash` | SHA-256 value mapped to a consistent symbolic hash binding |
| `profile.profileId` | One consistent `MAPPING-<digits>` identity per arm |
| `packageHash` | Checked SHA-256 symbolic binding |
| `staleResult.snapshotHash`, `staleResult.studyHash` | Checked SHA-256 symbolic bindings, preserving repeated-reference relationships |
| `savedPointer.id`, `savedPointer.projectId` | Must derive from that same root study identity |
| `savedPointer.inputHash`, `snapshotHash`, `historySnapshotHashes[]`, `refs[].id` | Checked SHA-256 symbolic bindings |
| `savedPointer.savedAt` | Valid ISO save timestamp marker |

The nested saved-pointer stale-result hash paths receive the same specified
stale-result transformation. No field-name wildcard, arbitrary key removal or
recursive timestamp stripping is used. Unexpected identity formats or changes
fail. Unknown fields are retained and therefore cause a comparison mismatch if
they differ; they are never silently discarded.

The comparison additionally hashes all 100 component winner/revision/count/fault
receipts and the complete initial and periodic independent native business-oracle
receipts. It does not compare the native job transport envelope's generated job ID,
timestamps, elapsed runtime or process identity. The native snapshot envelope is
not itself paired byte-for-byte; its business quantities, selected sites,
conservation and objective results are checked by each arm's full inherited oracle
and by matching the complete oracle receipt. Generated branch identities are
validated by the original exact within-arm lineage assertions. The fresh component
database name is not paired; every component winner, revision and fault outcome is.
The fixed normalization schema is always exported. Comparison hashes are generated
only for a successfully completed arm; on partial failure the artifact retains the
completed operation clocks, stage outcomes and any actual checkpoint receipts or
hashes that were generated, and marks the missing portions explicitly.

Pure read-only validation against the existing first-five-cycle packages from
1dfd614, bb809f8 and 680a807 produced identical normalized package digests. That is
normalization/schema evidence, not execution of this new allocation pair.

## Outputs and conclusions

Inherited packages, screenshots, profiles, service logs and business-state material
exist only in that arm's owned temporary runtime/work directory so the unchanged
checks can operate. After verified cleanup, they are discarded. The final artifact
contains only allocation/census aggregates, bounded per-operation clocks, phase
statuses, protocol/resource counters, source/cleanup receipts, semantic comparison
hashes and precise failure type/source-location/reason. It exports no request URL,
header/body, workbook, study/package contents, raw allocation trace or browser
profile. Failure message hashes and source line numbers identify a failing check
without copying arbitrary exception payloads.

`PASS_DIAGNOSTIC` requires both arms to finish, every declared operation and semantic
comparison to match, valid bounded measurements, unchanged clean source and normal
cleanup. `soakQualification` is always `NOT_MUTATION_SOAK`; product acceptance is
`NOT_RUN`, and `explainsAllPythonOrRSS` remains false. A timing, preventive resource,
trace-storage, artifact, census or comparison gate produces **INCONCLUSIVE_STOP**
and a nonzero exit, with unstarted/uncompleted operations and any unexecuted arm
recorded. This is not a product-failure conclusion. Genuine missing dependencies or
system launch restrictions are separately `BLOCKED_ENVIRONMENT`.

Native HTTP polling may naturally produce different protocol-owner inventories.
This does not change the frozen business schedule or force HTTP timing. For each
arm and checkpoint the report gives exact Request/Response/Route/Artifact/Stream/
Worker counts, each census category's direct subset bytes, and descriptive subset
bytes per registered owner. Global shared-object deduplication and fixed traversal
order make this an **order-dependent subset average**, not exclusive retained bytes
per owner. Missing categories for known nonzero owner counts cannot become zero.
If inventories differ, pair completion may still pass the strict business and
measurement gates, but `crossArmTotalByteCausalAttribution` is explicitly
`INCONCLUSIVE_OWNER_COUNTS_DIFFER`: total byte differences cannot be attributed to
the tracer or product. Even equal inventories do not establish full RSS causality.

Stop when the bounded pair yields useful allocation ownership evidence or shows
that instrument burden/data mismatch prevents comparison. Do not add an arm,
repeat a window, relax a gate or treat this as resolving the prior fast-burst
2 GiB failure, aggregate memory stability or real-Windows acceptance.
