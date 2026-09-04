# STCT v1.7 Local Demo Distribution

This is a local, deterministic demonstration of multi-vehicle execution, verified synthetic telemetry, offline driver projection, recovery, Operational Capsule replay, Shift Review, and Flight Recorder workflows.

It is not a production control tower, a live GPS or traffic feed, a real driver application, or proof of globally optimal routing. It has no production database or multi-user concurrency control. The included road and telemetry fixtures are synthetic.

Start the application:

```bash
./start_demo.sh
```

Open the printed local URL, sign in with the mock credentials, and choose **Operational Truth**. The experience starts paused and labels synthetic/partial state explicitly.

Verify package integrity:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

The existing OpenFreeMap base map may require network access. The deterministic SVG fleet view, tables, No-WebGL mode, and synthetic road fixture remain available without online map tiles. Public OSRM, Valhalla, and VROOM endpoints are not called. OR-Tools-backed optimization is used only when the already-installed local dependency is available and does not guarantee global optimality.
