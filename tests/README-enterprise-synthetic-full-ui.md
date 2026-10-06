# Synthetic full-UI acceptance

Run from the checkout using the same Python that already has OR-Tools and Python Playwright:

```sh
python tests/test_enterprise_synthetic_full_ui.py --evidence-dir "$RUNNER_TEMP/enterprise-full-ui"
```

The evidence directory must be empty and outside the checkout. Without `RUNNER_TEMP`, supply any fresh external directory. The suite does not install anything. Node is needed only for the checked-in XLSX reader/writer. Playwright's managed Chromium is used by default; `STCT_CHROMIUM` or `STCT_BROWSER` can select an existing executable. The existing ephemeral CI dependencies (`ortools==9.15.6755`, `playwright==1.57.0`, managed Chromium) suffice.

Exit codes:

- `0`: all implemented stages executed and passed, including owned-service cleanup
- `1`: an assertion/application/launcher failure, or unconfirmed cleanup
- `78`: a dependency, Chromium-launch, or socket environment blocker; dependent stages remain `NOT_RUN`

## What is exercised

- Actual `scripts/local_trial.py` start/stop with a unique external `STCT_RUN_DIR`, preferably free ports 8865/8887, otherwise fresh ephemeral ports; never 8787/8877/8791/8766/8788/19095
- New isolated browser context, public home → Data Hub → DESIGN workbook import, explicit field mapping and m³ units, synthetic classification, explicit WGS84 geographic-screening assumption
- Missing-CRS preflight blocks native submission and creation of results
- Two suppliers, two sites, two customers, two periods, 45.5 m³ total outbound and inbound, with deliberately crossed observed assignments and supply relationships
- OUTBOUND_ONLY, UPSTREAM_ONLY, FULL_CHAIN through visible controls and actual native jobs; full-chain includes entered unit transport rates, zero fixed/handling fees, excluded inventory/transfer fees and actual-cost objective
- Independent Python Haversine ledgers, baseline provenance, per-period conservation, selected-site validity, capacity checks and a tiny exhaustive optimum oracle; native solver metadata/build fingerprint and job completion checked separately
- DOM comparison order and report order; schematic map's study/snapshot/focus identities and correct comparison reference
- Explicit save, actual page reload, public saved-study reopen and native IndexedDB roundtrip for every scope
- HTML/CSV/JSON/Markdown/package downloads; fresh-context public package reimport and hash/row equivalence for every scope; tampered package rejected without replacing active results
- Same-ID complete-package import refuses to overwrite an existing saved study; visible conflict controls retain the complete package and an edited draft, save a new branch, and preserve the original pointer, snapshot and history
- Two actual tabs sharing the isolated browser context edit the same saved branch: the first tab saves changed capacity, the stale tab receives a revision conflict, downloads its distinct draft and saves a distinct branch; public history opening and current-version reopen preserve the winner
- Changed conditions invalidate full-chain results, hide stale map relations, and prevent current report exports

All application changes are via visible controls; page evaluation only reads state or DOM. There is no state injection, mocked solver, response fulfilment, private workbook input, or external-site access. Application requests are restricted to the two exact owned loopback origins, with service workers and WebSockets blocked.

## Evidence and boundaries

`summary.json` gives per-stage `PASS`, `FAIL`, `BLOCKED_ENVIRONMENT`, or `NOT_RUN`. Screenshots, generated workbook, exported reports/packages, sanitized launcher/service logs and a sanitized main-context Playwright trace are saved alongside it. Runtime ownership receipts stay in a separate temporary directory and are removed only after confirmed cleanup. The launcher performs process identity checks before terminating its own services; this suite does not kill by image name or by port.

A successful run establishes only this synthetic geographic-screening flow on the executing environment. It does not establish real Windows/macOS-machine acceptance, real OSRM routing, private-data acceptance, production authentication, human observation, browser profile durability after browser restart, cancellation races, deliberately delayed asynchronous save-receipt races, or visual approval. Late save-receipt behavior remains component-only coverage. A missing dependency is never presented as a passing browser or solver test. Package-readback screenshots cover fresh contexts; the single trace covers the primary context only.

The conflict banner has no dedicated “open existing” shortcut. The suite exercises the available public route: import step → saved-study list → open study. Branch recovery creates a draft and requires a new solve; the original complete snapshot remains attached to its original study. Shared-context tab checks are real UI/IndexedDB actions, separate from the component race harness.
