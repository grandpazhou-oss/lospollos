# Controlled HTTP UI fault acceptance

```sh
python tests/test_enterprise_ui_faults.py --evidence-dir "$RUNNER_TEMP/enterprise-ui-faults"
```

Use an empty external evidence directory. Dependencies and optional `STCT_CHROMIUM` / `STCT_BROWSER` are identical to `test_enterprise_synthetic_full_ui.py`. Nothing is installed. Exit codes are 0 PASS, 1 FAIL, 78 BLOCKED_ENVIRONMENT.

This separate suite reuses the previously validated synthetic workbook, visible mapping/units/CRS controls, independent Python ledger verifier and owned `local_trial.py` lifecycle. It does not modify or weaken the full three-scope suite. The browser has an isolated context, blocks other origins, service workers and WebSockets, and never injects application/controller state. Artifacts remain outside the checkout.

Implemented cases:

- Controlled health build mismatch and missing instance identity: visible rejection, no solve POST
- Controlled old-instance health identity: real job response disagrees with the announced instance, so it is rejected before result adoption
- Controlled HTTP 429: actual visible busy error and enabled retry; subsequent unaltered native retry is independently verified
- Controlled nonterminal HTTP view and held genuine status response: actual cancel control clicked twice, actual cancellation requests reach the native backend, held poll released, UI settles and another unaltered native retry succeeds
- Actual page reload while a job poll is held: visible INTERRUPTED state, session resume marker removed, cancellation requested, no silent solve restart, then unaltered native retry
- Genuine job-creation response held while the user-visible saved-study controls switch to a different synthetic study: old response released, detached cancellation requested, new study/pointer/results remain unchanged

## Explicit evidence boundaries

Only stages named `NATIVE_RETRY_*` claim an unaltered successful native solve, supported by actual job/build metadata and independent geometry/conservation verification. All HTTP failures and timing manipulations are labeled controlled UI evidence. There are no fake successful solver outputs, roads, private workbooks or external services.

Health does not pin a previously seen instance ID. A valid, nonempty but different instance ID is accepted at health and checked against job responses after submission. Accordingly, the old-instance case intentionally records one solve POST and protocol rejection; it does not claim instance-only pre-POST rejection. Empty instance identity and wrong build are separately proven to reject before submission.

The tiny native fixture may finish before the cancel click. The suite requires real cancel requests, idempotent repeated UI cancellation, terminal backend state and correct UI settling, and reports whether cancellation actually won. A backend COMPLETE/PARTIAL response is never relabeled as native cancellation. Native worker termination guarantees and larger workload cancellation are covered separately; this suite is bounded UI recovery evidence.
