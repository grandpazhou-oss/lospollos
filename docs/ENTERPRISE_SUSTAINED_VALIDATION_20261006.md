# Sustained validation after the 6caba33 acceptance snapshot

Status: **implemented; hosted sustained execution pending**. This document is a plan, not test evidence.

The completed `6caba338c5a8020848bbdbb7c6bcb51faf94ea51` acceptance artifact remains immutable. Sustained-load evidence belongs to a later exact commit and must not overwrite or retroactively relabel that snapshot. This work follows the user's explicit request to continue testing and stress testing on 2026-10-06.

## First observation window

1. Run the existing core, native and browser/UI regressions on the new head.
2. Run 30 minutes of actual OR-Tools mixed load on a private loopback backend. Increase synthetic demand counts (10/50/200), sites (2/5/10), and clients (1/2/4). The solver process-wide admission limit remains one. At least the first 75% of the window keeps the same backend alive so restarts cannot conceal persistent memory growth.
3. Exercise duplicate/pre-start/in-flight cancellation, owned worker exits, transport disconnects and owned backend restarts. A legitimate duplicate active job is idempotent; distinct concurrent work must receive 429. Track successful native outcomes and failure paths separately.
4. Run 12 minutes of isolated browser/storage activity, targeting at least 30 real UI cycles and 600 native IndexedDB component transactions. Clearly separate visible workflow evidence from component fault injection. Do not fill the filesystem or create unbounded archives to manufacture a failure.
5. Repeat the existing affected COMMAND UI regression three times in independent profiles, separately from the long-running storage browser.
6. Review resource trajectories, coverage minima and cleanup before declaring a window successful. A completed short smoke test is not a completed soak. Continue with focused reproduction or additional observation when the results leave an unresolved trend.

## Resource and safety boundaries

- Only synthetic data, approved ephemeral hosted dependencies and private loopback services. No requests to business services or unapproved routing/model endpoints.
- Existing protected ports 8787/8877/8791 and 8766/8788/19095 are untouched. Every process terminated by a fault test must be created and identity-verified by that test.
- Native process family: at most 1 GiB RSS, 512 file descriptors and 64 threads. Browser family: at most 1 GiB RSS, 1024 descriptors and three pages. These are test safety ceilings, not performance promises.
- Abort and retain diagnostics on conservation/authority errors, admitted concurrency above one, uncollected owned workers, hard safety ceilings or failed recovery. Distinguish a harness/environment limit from a confirmed product defect.
- Track RSS, descriptor/thread/child counts, native call intervals, latency and idle recovery. JobManager intentionally retains recent terminal jobs (15 before accepting a new job, up to 16 after acceptance); bounded retention and immutable study history are not automatically leaks.
- A read-only out-of-tree Python profile observer may measure real solver intervals. If used, record its exact source hash, method and overhead limits. It must not replace solvers/admission, bypass manifests or set a service-returned fingerprint as trusted. Instrumented timing is not an uninstrumented latency SLA.

## CI execution and evidence

A real-native short smoke and a short browser smoke validate the new harness before long execution; neither qualifies as a completed soak. The read-only workflow runs the sustained job only on pushes to the validation branch after the ordinary checks succeed, avoiding a duplicate long run on the matching PR event. Its job safety timeout is 60 minutes. Evidence is written outside the checkout and uploaded as separate `enterprise-native-soak` and `enterprise-browser-soak` artifacts. Every summary must state actual source SHA, dirty state, duration, cycles, fault counts, observed resource peaks/trends and cleanup outcome. GitHub's seven-day artifact retention is not a permanent backup.

The existing v1.8 six-to-eight-hour overnight harness uses a different Network model and historical run inventories. It is not silently substituted for this service/browser soak, and this first window does not close that historical acceptance item.

## Unchanged implementation limits

Synchronous deadlines remain cooperative, not hard process termination. Tasks remain in memory and cannot continue after service restart. No durable queue, multi-user access system, deployment, new paid infrastructure or target-workstation dependency installation is introduced. Hosted testing does not establish Windows workstation, real OSRM, customer-data, human-trial or overnight-soak acceptance.

## Budget-tail defect found while constructing the stress cases

A legitimate Facility request could fail with `FACILITY_TIME_LIMIT_INVALID` when its internal deadline remainder dropped below one second: the wrapper overwrote a valid public input with the derived remainder, then revalidated it. The reviewed fix keeps the public 1–120 second input contract intact and applies the remaining time only to the internal CP-SAT limit, including current-baseline solves. Model-building exhaustion returns a time-limit/partial outcome and preserves prior candidates; a longer service deadline cannot enlarge a shorter user limit. Seven controlled regression cases cover this, including actual manager/subprocess status propagation. These controlled checks do not constitute native-solver evidence; the forthcoming ordinary native regression and sustained window must validate the new runtime fingerprint.
