# Sustained real-native enterprise workload

Run only on an authorized Linux host with Python 3.11 and the already-installed
OR-Tools 9.15.6755 dependency. The harness never installs anything. It starts its
own loopback backend on a verified free port; it does not attach to a live user
backend, access a public routing service, or use customer data.

```sh
# Dependency-free payload, validator and observer checks; explicitly NOT native.
PYTHONDONTWRITEBYTECODE=1 python tests/test_enterprise_native_soak.py --self-test \
  --evidence-dir /tmp/enterprise-native-soak-selftest-unique

# Separate controlled deadline/manager regression; explicitly NOT native.
PYTHONDONTWRITEBYTECODE=1 python tests/test_enterprise_facility_deadline.py

# Full active business-load window, at least 30 minutes after ready/control.
PYTHONDONTWRITEBYTECODE=1 python tests/test_enterprise_native_soak.py \
  --duration-seconds 1800 --evidence-dir /tmp/enterprise-native-soak-unique

# Optional real-native smoke. This can NEVER produce a 30-minute soak PASS.
PYTHONDONTWRITEBYTECODE=1 python tests/test_enterprise_native_soak.py \
  --duration-seconds 60 --evidence-dir /tmp/enterprise-native-smoke-unique
```

Evidence must be outside the checkout and in an empty or new directory. Existing
acceptance evidence is never replaced. A missing or unexpected native dependency
is BLOCKED_ENVIRONMENT (exit 78), coverageStatus=NOT_RUN and nativeExecutionVerified=false. An explicit DISABLE_ORTOOLS policy is preserved and produces the same blocked classification; it is never overridden.
The build manifest must match the exact checkout; no stale-pin bypass is used.

## Workload and hard completion gates

- The full window progresses through 10 demands/2 sites, 50/5, and 200/10, with
  one, two, and four concurrent clients. Vehicle count uses the corresponding
  site count for routing. Every cycle executes all four retained synchronous
  APIs and both FACILITY and JOINT jobs. HTTP429 requests use bounded FIFO retry
- Canonical routing hashes, rolling matrix/context hashes, facility study hashes,
  and job run hashes are real. Sequence changes semantic synthetic inputs and
  job scenario identity; changing requestId alone is not used as a collision
- Finite site/vehicle/supplier capacities and two joint periods remain enabled.
  Independent result checks enforce exact demand coverage, capacities, inbound
  equals outbound per site/period, supplier bounds, schedules, objectives and
  identities. An infeasible/unknown-only output is not a successful math check
- Routing asks for one second, CP-SAT asks for two seconds, and jobs have a
  three-second global budget. The backend's legal server-wide minimum is five
  seconds. The facility deadline regression ensures the effective subproblem
  limit is min(user limit, remaining global time) without weakening input rules
- A full run needs at least 30 mixed cycles; each of six workloads at each size
  must succeed at least three times. Every route, including jobs, must record at
  least three real 429 responses. Minimum coverage is six startup cancellations,
  three solving cancellations, repeated cancellations, three owned-worker
  abnormal exits, three disconnect/recoveries, one backend restart/old-job404,
  three bounded retention checks, and at least two resource samples per second
- At least one backend instance must remain up for 15 minutes. Normally the
  initial observed backend remains uninterrupted for about 22.5 minutes; restart
  is deferred to the last quarter. Thus periodic restarts cannot hide growth

Each lifecycle fault is recorded separately from successful native mathematics.
SIGSTOP of a verified owned worker makes the 429 collision window deterministic;
SIGKILL then verifies actual abnormal exit and recovery. Backend SIGKILL leaves
the real ownership pipe responsible for worker exit. Client disconnect waits for
an actual native-entry observation before closing the connection. Missing a
required fault window or missing minimum coverage cannot produce PASS.

## Observation, safety and limitations

The method is labelled INSTRUMENTED_REAL_NATIVE_EXECUTION. A same-checkout,
uninstrumented native success is recorded first. A source-external sitecustomize
observer records exact production solve-function entry/exit, without replacing
solver functions, changing admission, modifying requests/results or altering the
build pin. Its SHA-256 is in summary.json and the script is preserved. Nested
solver frames in one thread count as one span; another thread or worker counts
as concurrency. Unclosed fault spans close only after PID/start-time-verified
exit. Observer errors fail the run.

Profiling imposes uncalibrated Python call/return filtering and locked JSON-line
append overhead. These timings are not uninstrumented performance/SLA claims.
Linux /proc is sampled every 0.2 seconds across all owned backend/worker sessions,
including worker children launched from non-main threads. Aggregate limits are
RSS 1 GiB, 512 descriptors, 64 threads and one live worker. Cross-thread/process
native execution must never exceed one. Limits, conservation failures, orphan
or idle-reclamation timeouts stop the run and clean up only owned processes.
Signals use pidfd plus PID/start-time/command verification. Protected service
ports 8787, 8877, 8791, 8766, 8788 and 19095 are refused.

Completed jobs are retained by count, not TTL: 15 old completed jobs before a
new admission, at most 16 including the newest. Real old-job404 probes verify the
bound. RSS reporting compares warmed idle windows after retention-table filling;
normal cache filling is not called a leak. The 1 GiB upper bound is enforced;
smaller warm RSS trends are reported for review, not silently described as flat.
The resource sampling interval can miss sub-interval peaks; boundary events
provide separate exact Python entrypoint concurrency evidence.

## Evidence

- summary.json: atomically refreshed state, coverage, maxima, observer identity,
  failure reason, cleanup result, stable-instance and warmed-idle windows
- events.jsonl: immediately flushed cycle/identity/verification/fault records
- resources.jsonl: immediately flushed bounded /proc samples
- native-boundaries.jsonl: exact observed function boundaries
- instrumentation/sitecustomize.py: preserved observer source
- backend-N.log: owned process stdout/stderr, without full request payloads

The generator plus sequence reproduces the synthetic data. Normal events retain
compact verification counts, not repeated 200-demand payloads or large traces.
SELF_TEST_PASS_NOT_NATIVE and SMOKE_PASS_NOT_30_MINUTE_SOAK remain distinct from a
full-duration PASS. Coverage, cleanup, native dependency and resource assertions
must all pass before the process exits zero.
