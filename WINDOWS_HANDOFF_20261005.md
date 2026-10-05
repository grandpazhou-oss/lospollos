# Windows handoff — 2026-10-05

This branch packages the latest running STCT UI snapshot, the optional MapLibre flow/plan-change presentation, and the Windows OSRM helper scripts. It is an internal trial branch, not a production release. The repository is private.

## Get the branch safely

Use a clean clone or separate worktree so an existing Windows checkout and its OSRM data remain untouched:

```bat
git fetch origin
git worktree add ..\lospollos-handoff codex/windows-handoff-map-showcase-20261005
cd ..\lospollos-handoff
```

If Git reports that the branch is not available yet, verify the exact repository and remote permissions before changing the current checkout.

## Start the local application

Read `README-WINDOWS-LOCAL-TRIAL.md` and `README-ENTERPRISE-CANDIDATE.md`. Start with `start_windows.cmd`; stop only this launcher's processes with `stop_windows.cmd`. The documented defaults are the local web port 8865 and optimizer port 8887. Python and OR-Tools must already be installed in the selected Windows environment; these scripts do not install or upgrade dependencies.

OSRM helper scripts are under `tools/osrm-windows/`. Docker images and China OSM extracts/preprocessed routing data are not included; prepare those separately on Windows and follow the toolkit README. The flow-pulse and scenario-change map presentation does not invoke OSRM and does not represent actual vehicle GPS, road paths, or travel-time evidence.

## Validate before using business data

Run the repository's focused tests first, then validate local startup, map display, OSRM matrix generation, research import/export, and solver availability on the target Windows machine. Mac browser evidence is not Windows acceptance. Keep UC-derived files and original workbooks inside the approved private environment.
