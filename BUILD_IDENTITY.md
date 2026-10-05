# Local backend build identity

`buildFingerprint` is a narrowly scoped identity for the bundled optimizer and
supply-chain protocol implementation. It is not a complete application, dependency,
environment or transitive source integrity attestation.

The ordered scope is `optimizer/ortools_service.py`, `canonical_contract.py`,
`facility_mvp1.py`, `supply_chain_joint_v19.py`, and `supply_chain_jobs_v6.py`.
Compute SHA-256 over each relative filename encoded as UTF-8, one NUL byte, and
that file's exact bytes, concatenated in this order. The frontend configuration,
launcher, documentation, generated evidence and the fingerprint value itself are
outside the hashed input, so updating the pin does not create a circular hash.

The service exposes this value and its file scope in `/health`; jobs expose the
same value as `backendBuildFingerprint` with the current backend instance ID.
The local launcher checks health against the source-derived fingerprint before
recording readiness. The supply-chain controller checks endpoint, instance,
protocol, model and capabilities, then verifies every job response against that
health identity. A compatible build difference is still reported as
`COMPATIBLE_BUILD_DIFFERS`; the corrected frontend pin removes the unintended
difference for this bundled source.

Run `python3 tests/test_backend_build_fingerprint.py` after editing any file in
the scope. Recompute the pin from those files and verify a newly started isolated
backend, since an already running process retains its startup fingerprint.

The historical optimizer fixture suite now submits the current canonical
envelope. Valid distance, cost, carbon, capacity, priority, time-window and
conservation expectations retain their original fixture values. The current
contract rejects excessive time limits, duplicate canonical IDs, missing
coordinates and invalid time strings before solving; those cases assert the
current explicit rejection instead of expecting an obsolete raw-payload fallback.
Order permutation is canonical, while an actual change to the order set must
invalidate the claimed hash. No solver or production guard is altered.
