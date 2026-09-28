# P5 Local Data and Study Workflow

Platform: **Supply Chain Decision Platform**. Workspaces remain **DESIGN** and **COMMAND**.

## Local Start

Use an existing Python 3 installation, from this directory:

```sh
python3 -m http.server 8768 --bind 127.0.0.1
```

On Windows, `py -3 -m http.server 8768 --bind 127.0.0.1` is equivalent.
Open `http://127.0.0.1:8768/index.html?noWebGL=1#/platform/data`.
No dependency installation or public routing service is required for P5.
The existing optional optimizer/backend is not required by the P5 local network workflow.

## Data Hub

1. Select dataset scope and upload XLSX, CSV files or schema JSON containing `scenario`.
2. Review sheet types and field mapping. Nested fields use names such as
   `coordinate.0`, `coordinate.1`, `demand.volume`, `capacity.volume`.
3. Explicitly confirm WGS84, units, observation period, cost period, currency and classification.
4. Validate. Errors identify file, sheet, row and field. Excluding invalid rows requires confirmation;
   export the rejected records before continuing. Cancel never adopts the draft.
5. Save a dataset version. Adopt it as a new DESIGN study or create a separate COMMAND draft.

IDs remain strings. Coordinates and missing resources are not invented. Candidate sites are
retained as candidate references, not opened depots. This is local rule-based preparation,
not a remote AI cleaning service. An incomplete dataset can be retained as DATA_ONLY_SAVED,
but cannot be evaluated as a complete network.

Updating an existing dataset creates a version and exposes record differences. A derived study
does not rewrite the previous study's pinned data or reuse a stale result as current.

## Studies and Portability

Save a baseline, create a demand scenario, evaluate and save it independently. Demand +25%
means per-order volume and weight, not 25% more orders. Copies can reuse admitted computation,
but have independent IDs and bindings. Rename and archive change catalog metadata only.

Saved records use native IndexedDB. SAVED requires transaction completion and readback.
Two tabs writing an old revision receive CONFLICT; reload or save a copy. A failed save
preserves the old version and permits exporting the unsaved draft.

Export `.study.json` from Scenario Library for a portable backup. It includes normalized
inputs, history, results and references, but explicitly omits original uploaded file bytes.
The importer independently revalidates current-format results. Old briefs and packages
missing dependencies remain read-only; they do not silently become a default demonstration.

Storage belongs to the browser profile and exact origin (scheme, host, port). Changing ports,
using another profile, clearing site storage or copying source files alone does not carry
saved studies. Export the study package first.

## COMMAND

Data adoption creates only a planning draft. Generate a candidate, review verification and
explicitly apply it. Applying downloads a before-state backup and creates a PREPARED execution
state. It does not seed deliveries or automatically start a driver. Use **Release execution plan**
on Execution before driver acceptance and departure. Pending driver ACKs block replacement.
This is a data-to-planning adapter, not the P6 strategic-to-operational bridge.

## Settings and Cost Periods

PLATFORM settings cover language, reduced motion, No-WebGL and future import defaults.
DESIGN and COMMAND defaults are separate. Changing active DESIGN business assumptions requires
confirmation, creates a revision and expires its result. Display labels such as FY2027 do not
annualize costs. Currency labels do not perform exchange-rate conversion.

Optional `costParameters` rows use `costKey`, `amount`, `currency`, `basis`, `period`.
Keep the source period or explicitly select annual normalization: MONTH x 12, DAY x user-entered
business days, ONE_TIME x 1. Mixed currencies are blocked. Source cost parameters and their
conversion ledger remain separate from the existing route model accounting ledger; no unqualified
combined economic total is presented. Source parameters are not automatically mapped onto arbitrary
vehicle cost fields. Model-run route totals are not annual totals.

## Boundaries

- Local heuristic results are model estimates, not proven global optima.
- Synthetic matrix provenance is shown explicitly; this does not provide live road distances.
- PERSONAL/CONFIDENTIAL adoption enables No-WebGL; no public provider is enabled by P5.
- Local audit entries are not tamper-proof compliance records or digital signatures.
- Facility Location Solver and P6 are NOT_STARTED. v1.8 soak remains DEFERRED_BY_USER.
- Large portable packages require substantial local validation time. Wait for validation and
  readback; do not interpret a busy state as SAVED.
- Responsive browser emulation does not replace physical iPhone validation.
