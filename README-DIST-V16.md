# STCT v1.6 Local Demo Distribution

This bundle is a local demonstration with deterministic synthetic road, execution, alert, driver, and recovery fixtures. It is not production-ready and does not provide real GPS, real traffic, or a globally optimal routing guarantee.

Start the static application:

```bash
./start_demo.sh
```

Open the URL printed by the script, sign in with the mock login, and choose **Dynamic Ops** in the left navigation. The v1.6 experience starts paused and labelled **Synthetic Fixture / Not Live**.

The deterministic Road Fixture works without an external routing provider. OR-Tools-backed Full Reoptimization requires the already-installed Python environment described by `requirements-demo.txt`; when unavailable, the feature is explicitly reported as `SKIPPED_DEPENDENCY`. OSRM-compatible and Valhalla-compatible providers are disabled by default and require explicit local configuration and coordinate-transmission approval.

Verify package integrity from this directory:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

The existing OpenFreeMap base map may require network access. The v1.6 deterministic SVG Road Fixture and no-WebGL operational fallback do not rely on that online map.
