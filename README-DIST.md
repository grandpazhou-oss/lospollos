# STCT Local Demo v1.5.1 Integrity Closed distribution

This is a local Demo distribution, not a production deployment.

```bash
WEB_PORT=19105 OPT_PORT=19107 ./start_demo.sh
```

Open the URL printed by the script and sign in with the local mock credentials `demo` / `demo123`.

Force the explicit offline fallback path when OR-Tools is unavailable:

```bash
DISABLE_ORTOOLS=1 WEB_PORT=19105 OPT_PORT=19107 ./start_demo.sh
```

Verify package integrity from inside the extracted directory:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

The manifest contains only relative paths and excludes itself. Every entry must report `OK`.

No Git metadata, test history, customer workbook, credentials, or audit evidence is included.
The bundled dataset is deterministic and fully synthetic; see `DATA_CLASSIFICATION.md` before external sharing.
Public map tiles require network access. OR-Tools is optional and pinned in `requirements-demo.txt`; this package does not install it. Mission Control simulations are based on verified plans and are not live GPS.

Recovery insertion metrics use the active MatrixContext. Full Reoptimization is intentionally `ADAPTER_ONLY / NOT_INTEGRATED` in this local Demo.
