# Verified local runtime identity

This candidate replaces the historical five-file fingerprint with a generated runtime
manifest. It is an integrity check, **not** a digital signature, trusted attestation,
credential, full-application hash or proof of business correctness.

`optimizer/build_identity.py` defines the exact scope: all top-level `optimizer/*.py`
modules (including `supply_chain_job_worker_v6.py` and the identity/admission modules),
`shared/planning-contract-v13.json`, the local launcher/static server/path allowlist
implementation, and `public-resources.json`. The generated `optimizer/build-manifest.json`
contains the sorted repository-relative paths, exact file SHA-256 hashes and a combined
fingerprint over `relative-path UTF-8 + NUL + exact file bytes` for each path in order.

The service refuses startup when the stored manifest differs from recomputed source,
when a file is missing/invalid, or when a new optimizer Python module is not recorded.
The launcher uses the same validator. `/health` reports this fingerprint and its scope.
The browser controller separately checks endpoint, instance, protocol, model and
capabilities; the shipped `config.js` now chooses `STRICT_PINNED`.

```sh
# After deliberate changes to scoped runtime source, regenerate BOTH artifacts:
python3 scripts/update_build_identity.py
# Read-only check used by CI and operators:
python3 scripts/update_build_identity.py --check
python3 tests/test_backend_build_fingerprint.py
```

Manifest bytes and `config.js`'s pin are committed together. The pin itself is outside
the hash input, avoiding a circular hash. `.gitattributes` keeps Python/JSON/JS source
LF on Windows checkouts. Copying files with newline conversion will fail validation;
do not bypass the failure by switching to warning mode on an accepted trial.

The actual frontend/UI files, dependencies, interpreter, Git metadata, input datasets
and generated evidence are outside this runtime source fingerprint. Record their own
versions and checksums separately for release evidence. Editing source while an old
process remains alive requires stopping/restarting that owned trial; its loaded Python
code is not replaced merely because files on disk change.

`COMPATIBLE_WARN` is available for deliberate development interoperability, but is
not strict build admission. A controller embedded without any STCT configuration keeps
that historical API fallback. Neither mode supplies user authentication or makes an
untrusted local process safe. See `CURRENT_STATE.md` for remaining release blockers.
