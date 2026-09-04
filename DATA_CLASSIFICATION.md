# STCT Demo Data Classification

## Scope

STCT is a local demonstration application. Data files supplied by a user or customer remain source data and must be treated as internal unless their owner explicitly approves another classification. The application does not turn uploaded data into public data.

## Original Excel Boundary

- Files under `templates/` that contain customer, store, address, coordinate, order, vehicle, or operating information are internal test inputs.
- Original Excel files must not be modified by the synthetic-data generator or copied into a clean distribution bundle.
- Upload, cleaning, planning, and export may create derived data. Derived data inherits the classification of its source unless it has been independently proven fully synthetic.
- A filename change, column deletion, masking of one field, or removal of a customer name is not sufficient to classify derived data as synthetic.

## Clean Distribution

The clean distribution may include only the deterministic dataset at `assets/demo/stct-synthetic-demo.json` and its generator `scripts/build_demo_data_v14.js`. That dataset is fully synthetic and is marked `meta.synthetic=true`.

STCT v1.6 may also include `road-network-fixture-v16.js`. Its nodes, directed edges, closures, tolls, restrictions, route geometry, matrix results, execution events, alerts, driver queue events, and recovery candidates are deterministic synthetic fixtures. They are not GPS observations, real roads, real traffic, or customer operations.

It contains:

- generic demo IDs and generic store/vehicle names;
- fictional address labels explicitly marked as non-real;
- deterministic coordinates generated around a test region, not copied from a customer dataset;
- three synthetic dates, three priority levels, time windows, and capacity-pressure cases.

It does not contain intentionally sourced customer names, real store names, real addresses, real order or vehicle identifiers, or coordinates copied from customer files.

## Internal-Only Data

Treat the following as internal and exclude them from clean distribution and external audit bundles:

- original or cleaned customer spreadsheets;
- uploads, exports, screenshots, logs, or evidence containing customer/store identifiers;
- exact addresses and coordinates from operational projects;
- planning results derived from those records;
- local absolute paths, usernames, and machine-specific runtime files.

## v1.6 Evidence Boundary

- Dynamic Operations Capsules inherit the classification of every embedded source. A valid integrity seal does not declassify data and is not a digital signature.
- Browser screenshots, request logs, response bodies, performance traces, route geometry, provider provenance, and plan revisions must be reviewed before external release.
- The v1.6 audit bundle may contain only synthetic fixture evidence and redacted local execution metadata. Original or cleaned Excel workbooks are excluded.
- Coordinates must not be sent to a configured routing provider until the user explicitly enables the provider and approves coordinate transmission.

## v1.7 Operational Truth Boundary

- Multi-vehicle tracks, telemetry observations, driver queues, alerts, plan revisions, recovery candidates, Shift Review records, and Operational Capsules shipped with v1.7 are deterministic synthetic fixtures.
- Synthetic telemetry is not live GPS. Derived telemetry is recomputed from the included fixture provider and must remain distinguishable from device-reported claims.
- Operational Capsules inherit the highest classification of their embedded sections. Hash integrity and replay equivalence do not declassify data.
- The clean v1.7 distribution includes only the synthetic demo dataset, the blank upload template, and a read-only traceability summary. The complete registry, browser evidence, performance traces, source diffs, and mutation evidence belong only in the redacted audit bundle.
- Browser screenshots are releasable only when generated from the synthetic fixture and separately scanned for local paths, customer identifiers, and secrets.

## v1.8 Network Intelligence Boundary

- Multi-depot assignments, trip chains, pickup-delivery pairs, cross-dock custody, dock reservations, waves, cost/carbon ledgers, recovery candidates, and Decision Room evidence shipped with v1.8 are deterministic synthetic fixtures.
- The generic blank workbook at `templates/raw-dispatch-template.xlsx` is classified `INTERNAL_TEMPLATE`. It contains no approved customer dataset and is excluded from the clean v1.8 distribution until a separate release review explicitly reclassifies it.
- The clean v1.8 distribution may include synthetic JSON fixtures and synthetic browser renders. It must exclude original or cleaned Excel workbooks, customer-derived routes, complete audit evidence, and machine-specific paths.
- A Network Capsule inherits the highest classification of its source scenario. Hash integrity, verifier success, and read-only replay do not declassify its contents.
- Cost and carbon values are scenario estimates from the included synthetic inputs. They are not invoices, audited emissions, or production capacity certification.

## External-Send Checklist

Before sending any STCT bundle outside the company:

1. Build from the clean-distribution policy, not from an ad hoc copy of the repository.
2. Confirm the only included demo dataset is marked fully synthetic.
3. Scan filenames and file contents for customer names, store names, addresses, order IDs, vehicle IDs, local usernames, absolute home-directory paths, local evidence-root paths, and local file URLs.
4. Verify the relative-path SHA-256 manifest before packaging and again after extraction to a different directory.
5. Review screenshots and audit evidence separately; manifest integrity does not prove data classification.
6. Obtain data-owner approval for any exception and record the approved files and purpose.
