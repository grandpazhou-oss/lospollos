# COMMAND UI integration smoke

Run with the existing approved native Python and Playwright environment:

```sh
python tests/test_enterprise_command_ui.py --evidence-dir "$RUNNER_TEMP/enterprise-command-ui"
```

The directory must be empty and outside the checkout. Dependencies and launch conventions are shared with `test_enterprise_synthetic_full_ui.py`: pinned OR-Tools, Python Playwright/managed Chromium, Node, production `local_trial.py`, an isolated runtime ownership directory and two free loopback ports. The protected ports are excluded. No installation is performed. The browser permits only the exact two owned origins, blocks service workers/WebSockets/external access, and starts in a fresh context. Service shutdown uses the launcher's identity-checked stop flow.

## Implemented stages

1. Visible COMMAND local recovery: preview requirement, apply, exact undo, using the built-in synthetic operational demo. This is explicitly local deterministic behavior, not native reoptimization proof.
2. Native reoptimization UI boundary: real optimizer health is ready, but COMMAND's full-engine button remains disabled. The shipped adapter creates its context without `fullRecoveryEngine`; the suite records native recovery UI as `NOT_RUN_NOT_EXPOSED`. The `/reoptimize-v16` native API regression is separate.
3. Original dispatch UI: upload a newly invented two-date JSON input through the mounted original import panel, review/apply it, select one date and a four-second solver limit.
4. Controlled admission fault: one labeled HTTP 429 response verifies no heuristic success, candidates or applied-plan mutation. This is UI fault handling, not a real solver-saturation measurement.
5. Genuine `/optimize`: six actual native goal solves, build-verified backend, OR-Tools 9.15.6755/server identity and independent order-ID conservation checks. No mocked successful solver response.
6. Visible manual adjustment: lock and reject an edit, undo the lock, reorder a stop, exact undo, redo and apply. Verify both original dispatch data and COMMAND operational context adopt the verified manual plan and retain audit history.
7. Visible multi-day cancellation: hold delivery of one genuine native response using Playwright `route.fetch`, click “cancel remaining dates,” deliver the unchanged response, then verify stale rejection, no later date submission, and retention of the applied plan. This does not claim termination of the in-flight synchronous solve. Single-day dispatch has no equivalent exposed hard-cancel control.

All application changes use visible public controls or normal file selection. Browser evaluation only observes state or DOM. The input validator is also checked locally, but that does not establish browser execution.

## Evidence and status

`summary.json`, screenshots, a sanitized trace, generated synthetic input and sanitized service logs are retained outside source. Missing dependencies/browser launch support produce exit 78 and leave dependent stages `NOT_RUN`; successful syntax checks never imply UI PASS. Exit 0 requires all implemented assertions and owned-service cleanup. An asserted unavailable UI boundary can pass as a boundary check while the native operation itself remains explicitly not executed.

This is a bounded synthetic COMMAND integration smoke, not all-route acceptance, native recovery UI coverage, OSRM, private-data acceptance, a physical Windows/macOS validation or human visual approval.
