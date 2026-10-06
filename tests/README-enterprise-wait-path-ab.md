# Bounded waiting-path A/B, separate from product acceptance

This short real-Chromium component experiment tests one specific candidate behind
the persistent secondary DOM count in the browser soaks. It does not modify the
product or shared UI helpers, start OR-Tools/native optimization, rerun the 21-minute
paced control, or replace the separately preserved fast-seed 2 GiB failure.

## Run and pure guards

Use the already approved hosted Linux runtime with **Python Playwright 1.57.0**
and its installed Chromium. Other installed Playwright versions report an
environment block instead of substituting their behavior. No software is installed
by this harness and no alternative browser route is attempted after a launch block.

```sh
python -B tests/test_enterprise_wait_path_ab.py \
  --evidence-dir "$RUNNER_TEMP/enterprise-wait-path-ab" \
  --memory-profile hosted-2gib --generations 32 --idle-seconds 60 \
  --max-wall-seconds 180
```

Browser-free guard tests:

```sh
python -B -m unittest discover -s tests -p test_enterprise_wait_path_ab.py -v
```

An equivalent pure-guard entry writes an explicitly labeled summary and test log:

```sh
python -B tests/test_enterprise_wait_path_ab.py --self-test \
  --evidence-dir "$RUNNER_TEMP/enterprise-soak-preflight/wait-path-guards"
```

Pure guards test bounds, error-class classification, page attribution and the
decision rule using controlled values; they are not real-browser evidence. In an
AB-only CI selection, longer native/paced windows must be labeled not run for that
selection rather than falsely reported as passed.

## Single changed variable

A fresh persistent Chromium context contains exactly three owned pages. A and B
load identical synthetic HTML bytes; the third page performs the preliminary
semantic qualification and then remains static. All pages use the same settings,
loopback-only network restriction, closed WebSockets and blocked service workers.
An owned standard-library HTTP server serves only this generated fixture. Before
binding an ephemeral port, the harness reads Linux's port range and blocks if it
could overlap any protected port; it never changes network settings.

Each paired generation creates exactly **512 element nodes**: one visible target
root section and 511 empty spans. The waited node and the WeakRef target are the
same root object, avoiding a child-handle/parent-wrapper ambiguity. The fixture
checks a single target. Both arms wait for visibility, then detach their matching
root. No text nodes are
added inside these generations. Execution order alternates A/B and B/A per round.

- A: `locator.wait_for(state='visible', timeout=25000)`
- B: `expect(locator).to_be_visible(timeout=25000)`

Those calls are the only experimental difference. They isolate the final visible
wait used by the existing `reveal` and recovery-control paths. The main timeout is
explicitly 25,000 ms in both arms; expect's default 5,000 ms is never substituted.
The actual application, persisted study history and conflict/solver workflows are
not exercised or accepted by this fixture.

## Semantics and exception qualification

Before taking the A/B baseline, the third page checks both public waiting APIs:
ordinary visible and opacity-zero elements must succeed; visibility-hidden,
zero-size and missing targets must fail. Positive checks use 25,000 ms. Negative
checks deliberately use a separately labeled **150 ms** timeout, solely to verify
failure semantics without burning the experiment budget.

A negative A call must raise Playwright `TimeoutError`; B must raise
`AssertionError`. Exact exception class, bounded message and elapsed time are
recorded. Any false success or unexpected error type fails qualification. Equal
visibility conditions do not imply identical polling cadence or exception types.
Fewer retained handles therefore do not authorize replacing every shared wait.

These paths are grounded in pinned upstream source:

- [Python Locator.wait_for](https://github.com/microsoft/playwright-python/blob/v1.57.0/playwright/_impl/_locator.py#L705)
  awaits a selector result while returning no handle to its caller
- [Python visibility assertions](https://github.com/microsoft/playwright-python/blob/v1.57.0/playwright/_impl/_assertions.py#L756)
  and [their default timeout](https://github.com/microsoft/playwright-python/blob/v1.57.0/playwright/_impl/_assertions.py#L56)
- [FrameDispatcher selector result](https://github.com/microsoft/playwright/blob/v1.57.0/packages/playwright-core/src/server/dispatchers/frameDispatcher.ts#L94)
  creates an ElementHandle dispatcher; [FrameDispatcher expect](https://github.com/microsoft/playwright/blob/v1.57.0/packages/playwright-core/src/server/dispatchers/frameDispatcher.ts#L264)
  returns serialized assertion results

## Actual object evidence, bounded observation

Each arm retains at most 32 **WeakRefs** to its detached roots. It never stores a
strong reference to an old root. Observation returns only primitive generation,
connected-state and element-count values; no DOM node or JSHandle is returned from
fixture evaluation. Reads of a WeakRef can keep its target alive until that
JavaScript job ends, so repeated aggressive WeakRef polling is avoided.

The baseline follows qualification, before either main arm runs. Checkpoints occur
every eight generations, up to 32. If still necessary, ordinary idle observation
is bounded to 60 scheduled seconds, with checkpoints at 5, 15, 30 and 60 seconds
(a shorter requested bound clips these points). This is at most nine object
checkpoints total. Final bounded sampling can take slightly longer than the idle
wait itself; the independent 180-second process watchdog remains authoritative.

Each checkpoint records:

- Page GUIDs and identical page-object membership, plus Page=3/BrowserContext=1
- Read-only protocol registry counts, attributed by following each object's
  parent chain to its verified Page GUID; ElementHandle or network-object
  attribution failure is a hard failure, never an assumed zero
- Detached-root WeakRef observations with generation IDs, and CDP DOM/document/
  listener/JS heap counters; CDP metrics may include shared renderer activity,
  so per-page protocol ownership and page-local WeakRefs are the stronger arm
  evidence
- Owned-process RSS/FD/thread counts, separated into Chromium, driver, harness and
  the fixture HTTP server. Shared pages can be double-counted in summed RSS

Network Request/Response/Route totals must remain unchanged after the baseline,
excluding new network traffic as the changing variable. CDP sessions detach after
each sample. There is no private registry deletion, dispatcher-threshold override,
forced GC, heap dump, continuous trace, browser restart, or unbounded WeakRef/log
collection. Resource sampling is once per second plus the bounded checkpoints.

## Predetermined decision and stop rules

The experiment stops at the first checkpoint with sufficient component evidence:
at least eight generations, A's ElementHandle delta equals the completed generation
count, B's delta is zero, all A roots remain observed alive and detached, and at
least four matched generation roots remain alive only in A while B's corresponding
WeakRefs no longer resolve. The result is
`DETACHED_FIXTURE_RETENTION_DIFFERENCE_OBSERVED`, never proof about all 103,784
application DOM nodes or a product-wide leak.

If the expected protocol pattern does not occur, stop immediately with
`INCONCLUSIVE_PROTOCOL_PATTERN`. If only handle retention is confirmed and natural
collection does not distinguish DOM roots within the configured bounds, report
`HANDLE_RETENTION_ONLY_DOM_INCONCLUSIVE`. Do not extend the window, add generations
or nodes, force GC, or silently change collection behavior to obtain a result.

Any resource/identity/fixture/visibility/network invariant failure is `FAIL`.
Qualified component evidence plus successful cleanup gives `PASS_DIAGNOSTIC`;
an executed but unresolved comparison gives `COMPLETE_INCONCLUSIVE`. Both retain
`productAcceptance: NOT_RUN` and `soakQualification: NOT_MUTATION_SOAK`.
`componentOutcomeAccepted` is true only for successful component evidence with
confirmed owned-process cleanup. The supervisor converts nonterminal/unknown
summaries, nonzero exits with stale success and cleanup failure to explicit `FAIL`.
A lower RSS alone is never a causal success rule.

## Resource supervision and compatibility

The aggregate RSS ceiling remains 2 GiB, FDs 1,024 and pages exactly three. Optional
`--max-rss-mib` can tighten the ceiling only. Generations can be 8/16/24/32, idle
can be 0–60 seconds, and the independent watchdog is capped at 180 seconds.

This script imports the existing `EvidenceLog`, `ResourceMonitor`,
`process_table`, `source_identity` and `supervise_process` without editing them.
The same cooperative abort marker and SIGTERM flag avoid throwing into Playwright's
dispatcher. The supervisor owns only this worker and its recorded descendants,
with PID/startTicks checks and a run-token ownership receipt for the fixture server.
It uses the existing identity-checked TERM/KILL cleanup and reports the final
survivors. There is no production launcher or external service cleanup callback:
the fixture server is a supervised child. Normal shutdown closes the owned context
and terminates only that verified server; requiring KILL is a cleanup failure.

Use a five-minute CI step to cover the 180-second watchdog and existing bounded
cleanup allowance (at most the established 65 seconds). Source before/after,
explicit hashes of both A/B files, and fixture hash bind the evidence to the actual
checkout. All fixture files, persistent browser profile and logs are outside the
checkout. Original soak artifacts are never edited. Local blocked/incompatible
browser runtimes cannot be used as substitute real evidence.

Evidence: `summary.json`, `events.jsonl`, `resources.jsonl`, generated synthetic
fixture HTML and sanitized fixture-server log. Exit 0 means the bounded comparison
executed and cleaned up (inspect whether conclusive or inconclusive), 1 means
failure, and 78 means a verified environment block.
