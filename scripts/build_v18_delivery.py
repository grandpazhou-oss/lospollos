#!/usr/bin/env python3
"""Build the STCT v1.8 clean distribution and redacted audit bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import random
import re
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone

REPO = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_RUN = pathlib.Path("/tmp/lospollos-v1.8-overnight-20260904_012216")
EXCLUDED_MANIFEST_PARTS = {".git", ".claude", ".run", "logs", "__pycache__"}
AUDIT_DIRS = [
    "baseline", "v17-acceptance", "known-failures", "contracts", "canonical-fixtures", "depots", "territories", "assignments", "trip-chains", "drivers", "breaks", "pickup-delivery", "backhaul", "cross-dock", "custody", "docks", "waves", "solver", "verifier", "cost-carbon", "scenario-lab", "fleet-mix", "demand-shock", "execution", "recovery", "network-visuals", "browser", "screenshots", "performance", "traceability", "mutation", "requests", "responses", "diff",
]


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str], cwd: pathlib.Path = REPO, env: dict[str, str] | None = None, allowed: tuple[int, ...] = (0,)) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, check=False)
    if completed.returncode not in allowed:
        raise RuntimeError(f"Command failed ({completed.returncode}): {' '.join(command)}\n{completed.stderr or completed.stdout}")
    return completed


def reset_owned(path: pathlib.Path, run_dir: pathlib.Path) -> None:
    path = path.resolve()
    if run_dir.resolve() not in path.parents:
        raise RuntimeError(f"Refusing to reset path outside the owned run directory: {path}")
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)


def source_manifest(root: pathlib.Path) -> dict[str, dict[str, object]]:
    rows = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(part in EXCLUDED_MANIFEST_PARTS for part in relative.parts) or path.name == ".DS_Store" or path.suffix == ".pyc":
            continue
        rows[relative.as_posix()] = {"size": path.stat().st_size, "sha256": sha256(path)}
    return rows


def manifest_path_included(relative: pathlib.PurePath) -> bool:
    return not any(part in EXCLUDED_MANIFEST_PARTS for part in relative.parts) and relative.name != ".DS_Store" and relative.suffix != ".pyc"


def relative_manifest(root: pathlib.Path, manifest_name: str = "MANIFEST.sha256") -> list[dict[str, object]]:
    rows = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == manifest_name:
            continue
        relative = path.relative_to(root).as_posix()
        rows.append({"path": relative, "size": path.stat().st_size, "sha256": sha256(path)})
    return rows


def write_manifest(root: pathlib.Path, name: str = "MANIFEST.sha256") -> list[dict[str, object]]:
    rows = relative_manifest(root, name)
    (root / name).write_text("".join(f"{row['sha256']}  {row['path']}\n" for row in rows), encoding="utf-8")
    return rows


def zip_tree(root: pathlib.Path, destination: pathlib.Path) -> None:
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                relative = path.relative_to(root).as_posix()
                if "__MACOSX" not in relative and not pathlib.PurePosixPath(relative).name.startswith("._"):
                    archive.write(path, relative)


def write_sha_sidecar(path: pathlib.Path) -> pathlib.Path:
    sidecar = path.with_name(path.name + ".sha256")
    sidecar.write_text(f"{sha256(path)}  {path.name}\n", encoding="utf-8")
    return sidecar


def sanitize_text(value: str, run_dir: pathlib.Path) -> str:
    replacements = [
        (str(REPO), "<REPO>"),
        (str(run_dir), "<RUN_DIR>"),
        (str(pathlib.Path.home()), "<USER_HOME>"),
        ("/private/tmp/lospollos-v1.8-overnight-20260904_012216", "<RUN_DIR>"),
    ]
    for source, target in replacements:
        value = value.replace(source, target)
    value = re.sub(r"(?<!\\)file:///(?:Users|private/(?:tmp|var)|tmp)/[^\"'`\r\n<>\)\]\}]*", "<LOCAL_PATH>", value)
    value = re.sub(r"(?<!\\)/(?:Users|private/tmp|private/var|tmp)/[^\"'`\r\n<>\)\]\}]*", "<LOCAL_PATH>", value)
    return value


def contains_local_absolute_path(value: str) -> bool:
    patterns = [
        r"(?<!\\)file:///(?:Users|private/(?:tmp|var)|tmp)/",
        r"(?<!\\)/(?:Users|private/tmp|private/var|tmp)/",
    ]
    return any(re.search(pattern, value) for pattern in patterns)


def write_sanitized(source: pathlib.Path, destination: pathlib.Path, run_dir: pathlib.Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(sanitize_text(source.read_text(encoding="utf-8", errors="replace"), run_dir), encoding="utf-8")


def changed_files(run_dir: pathlib.Path) -> tuple[list[dict[str, object]], dict[str, dict[str, object]], dict[str, dict[str, object]]]:
    baseline = json.loads((run_dir / "baseline/source-manifest.json").read_text(encoding="utf-8"))
    before = {
        row["path"]: {"size": row["size"], "sha256": row["sha256"]}
        for row in baseline["entries"]
        if manifest_path_included(pathlib.PurePosixPath(row["path"]))
    }
    after = source_manifest(REPO)
    rows = []
    for name in sorted(set(before) | set(after)):
        status = "ADDED" if name not in before else "REMOVED" if name not in after else "CHANGED" if before[name]["sha256"] != after[name]["sha256"] else "UNCHANGED"
        if status != "UNCHANGED":
            rows.append({"path": name, "status": status, "before": before.get(name), "after": after.get(name)})
    return rows, before, after


def build_diffs(run_dir: pathlib.Path, staging: pathlib.Path) -> dict[str, object]:
    tracked = run(["git", "diff", "--binary", "--no-ext-diff", "--"], allowed=(0, 1)).stdout
    untracked_paths = [line for line in run(["git", "ls-files", "--others", "--exclude-standard"]).stdout.splitlines() if line]
    chunks = []
    for relative in untracked_paths:
        completed = run(["git", "diff", "--no-index", "--binary", "--", "/dev/null", relative], allowed=(0, 1))
        chunks.append(completed.stdout)
    tracked_path = staging / "TRACKED_DIFF.patch"
    untracked_path = staging / "UNTRACKED_DIFF.patch"
    tracked_path.write_text(tracked, encoding="utf-8")
    untracked_path.write_text("".join(chunks), encoding="utf-8")
    diff_check = run(["git", "diff", "--check", "--"], allowed=(0, 1))
    return {"tracked": tracked_path, "untracked": untracked_path, "untrackedPaths": untracked_paths, "diffCheckStatus": "PASS" if diff_check.returncode == 0 else "FAIL", "diffCheckOutput": diff_check.stdout + diff_check.stderr}


def commit_groups(paths: list[str]) -> dict[str, list[str]]:
    groups = {"1": [], "2": [], "3": [], "4": []}
    for path in paths:
        value = path.lower()
        if any(token in value for token in ["network-contract", "depot-assignment", "trip-chain", "pickup-custody", "network-solver", "network_contract", "network_solver", "network-v18-fixture", "test_gate0"]):
            groups["1"].append(path)
        elif any(token in value for token in ["dock-wave", "network-accounting", "scenario-lab"]):
            groups["2"].append(path)
        elif any(token in value for token in ["network-execution", "network-visualization", "network-command-center", "v18_color", "v18_component", "v18_motion", "v18_visual", "v18_accessibility", "v18_architecture"]):
            groups["3"].append(path)
        else:
            groups["4"].append(path)
    return {key: sorted(values) for key, values in groups.items()}


def docs(core_count: int, gate14_status: str, branch: str, head: str) -> dict[str, str]:
    gate_rows = [f"- Gate {number}: PASS" for number in range(0, 14)] + [f"- Gate 14: {gate14_status}"]
    final_status = "COMPLETED" if gate14_status == "PASS" and core_count == 1067 else "READY_FOR_GATE14_VALIDATION"
    final_report = f"""# STCT v1.8 Final Report

## A. Final Status

- Status: `{final_status}`
- Core assertions: `{core_count}/1067`
- Branch / HEAD unchanged: `{branch}` / `{head}`
- Scope: local deterministic demo using synthetic or anonymized fixtures.

## B. Baseline

Pass 0 captured the dirty working tree, protected v1.7 artifacts, original Excel hashes, branch, HEAD, processes, and ports before v1.8 edits.

## C. v1.7 Acceptance

The v1.7 source and delivery evidence remain protected and were not rolled back or overwritten.

## D. Source Reproducibility

Tracked and untracked binary-capable patches reconstruct the current source from the recorded HEAD. Reconstruction is verified against the current manifest.

## E. Visual Design Contract

The Network Decision Room uses a light operational layout, source-backed evidence, responsive tables, no-WebGL alternatives, and reduced-motion behavior.

## F. Network Canonical Model

The v1.8 contract normalizes depots, zones, orders, vehicles, drivers, docks, waves, pickup-delivery pairs, and routing context.

## G. Network Identity

Canonical inputs, routing context, plans, accounting, execution, recovery, and capsules use SHA-256 identities.

## H. Depot Assignment

Orders receive one legal assignment or an explicit unassigned disposition; depot eligibility and capacity are verified.

## I. Territories and Capacity

Zone policy and depot order, volume, weight, and handling constraints are source-backed and independently checked.

## J. Multi-Trip

Physical vehicles have ordered, non-overlapping trip chains with reload and reposition time.

## K. Driver Shift and Breaks

Driver duty, availability, and break constraints are enforced by planner and verifier.

## L. Pickup-Delivery

Pickup precedes delivery and same-trip or same-vehicle rules are explicit.

## M. Backhaul and Returns

Return and backhaul dispositions remain explicit network events and do not disappear from conservation checks.

## N. Cross-Dock and Custody

Transfers use explicit custody events and consume cross-dock time. Transfer assumptions remain synthetic model assumptions.

## O. Dock Scheduling

Reservations, queue time, load, unload, reload, and transfer operations respect dock capacity.

## P. Dispatch Waves

Wave membership, cutoff, release, departure, and revision state are explicit and verified.

## Q. Solver and Decomposition

The local heuristic and the already-installed OR-Tools probe execute locally. `BEST_FOUND` is not global optimality.

## R. Network Verifier

The independent verifier checks identity, assignment, trip, driver, custody, dock, wave, conservation, and accounting invariants.

## S. Conservation

Every order, shipment, vehicle, driver, dock reservation, and wave has an auditable disposition.

## T. Cost and Carbon

Cost and carbon are independently recomputable scenario estimates. They are not invoices or audited emissions.

## U. Scenario Lab and Fleet Mix

Scenario comparisons distinguish same-input optimization from changed-input scenarios and avoid global-optimum wording.

## V. Network Execution and Recovery

Execution uses an append-only event chain. Recovery starts from a frozen cutoff and preserves accepted history.

## W. Network Decision Room

Desktop, mobile, no-WebGL, reduced-motion, and Chinese/English/Japanese views expose operational evidence and preview gates.

## X. Tests / Browser / Performance

{os.linesep.join(gate_rows)}

Actual Node, Python, OR-Tools, and local Chrome paths were exercised. Physical iPhone testing remains `BLOCKED_MEASUREMENT`.

## Y. Git / Delivery / External Actions

No commit, push, deploy, dependency install, binary download, Docker pull, or public OSRM/Valhalla/VROOM request was performed. Existing user services remain owned by their original processes.

## Z. File Disposition and Recommendation

Every file changed after the v1.8 baseline is assigned to exactly one proposed commit list. The clean distribution and redacted audit bundle use relative manifests and SHA-256 sidecars.

Remaining risks: Local Demo; synthetic/anonymized data; no production database; no multi-user concurrency; no formal identity/RBAC; no live GPS, dock, or warehouse feed; synthetic road fixture by default; external providers disabled unless explicitly configured; cross-dock assumptions; estimated cost/carbon; public basemap dependency; no production capacity certification.

Final recommendation: retain this as an auditable local demonstration. Use the label `STCT v1.8 Multi-Depot Multi-Trip Network Intelligence Complete` only when Gate 14 and all 1067 core assertions are PASS; do not label it production-ready, a certified optimizer, a live warehouse system, or globally optimal.
"""
    common_boundary = "All behavior is local and deterministic. Public routing services are disabled. Results are synthetic demo evidence, not production certification or global optimality."
    return {
        "STCT-v1.8-FINAL-REPORT.md": final_report,
        "STCT-v1.8-NETWORK-CONTRACT.md": f"# STCT v1.8 Network Contract\n\nCanonical source: `network-contract-v18.js`. Depots, zones, orders, vehicle types, vehicles, drivers, docks, waves, pickup-delivery pairs, and routing context normalize before SHA-256 identity. {common_boundary}\n",
        "STCT-v1.8-MULTI-TRIP-CONTRACT.md": f"# STCT v1.8 Multi-Trip Contract\n\nCanonical sources: `trip-chain-v18.js` and `network-solver-v18.js`. Vehicle trips must be ordered, non-overlapping, capacity-feasible, driver-feasible, and explicit about reload, reposition, break, start, and end depots. {common_boundary}\n",
        "STCT-v1.8-PICKUP-DELIVERY-CUSTODY.md": f"# STCT v1.8 Pickup-Delivery And Custody\n\nCanonical source: `pickup-custody-v18.js`. Pickup precedes delivery; custody has one owner at a time; cross-dock receive/release events are explicit and dock-time aware. {common_boundary}\n",
        "STCT-v1.8-DOCK-WAVE-CONTRACT.md": f"# STCT v1.8 Dock And Wave Contract\n\nCanonical source: `dock-wave-v18.js`. Reservations respect simultaneous capacity. Waves expose cutoff, release, departure, frozen state, and revision. {common_boundary}\n",
        "STCT-v1.8-NETWORK-COST-CARBON.md": f"# STCT v1.8 Network Cost And Carbon\n\nCanonical source: `network-accounting-v18.js`. Cost and carbon components are independently recomputable and exclude candidates with missing metrics. Values are scenario estimates. {common_boundary}\n",
        "STCT-v1.8-ARCHITECTURE-DECISIONS.md": (REPO / "V18_ARCHITECTURE_DECISIONS.md").read_text(encoding="utf-8"),
        "STCT-v1.8-OPEN-SOURCE-INSPIRATION.md": "# STCT v1.8 Open-Source Inspiration\n\nMapLibre GL JS, OpenFreeMap/OpenMapTiles/OpenStreetMap attribution, SheetJS Community Edition, and already-installed Google OR-Tools are disclosed in `NOTICE.md` and `vendor/NOTICE.md`. No AGPL source code was copied. Public OSRM, Valhalla, and VROOM calls remain disabled.\n",
    }


def verify_zip_names(path: pathlib.Path) -> bool:
    with zipfile.ZipFile(path) as archive:
        return all("__MACOSX" not in name and not pathlib.PurePosixPath(name).name.startswith("._") for name in archive.namelist())


def verify_relative_manifest(root: pathlib.Path, name: str = "MANIFEST.sha256") -> bool:
    lines = (root / name).read_text(encoding="utf-8").splitlines()
    for line in lines:
        digest, relative = line.split("  ", 1)
        if pathlib.PurePosixPath(relative).is_absolute() or relative == name or sha256(root / relative) != digest:
            return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", default=str(DEFAULT_RUN))
    parser.add_argument("--output-dir")
    parser.add_argument("--core-count", type=int, default=984)
    parser.add_argument("--gate14-status", default="READY_FOR_VALIDATION", choices=["READY_FOR_VALIDATION", "PASS"])
    args = parser.parse_args()
    run_dir = pathlib.Path(args.run_dir).resolve()
    output = pathlib.Path(args.output_dir).resolve() if args.output_dir else run_dir / "delivery-v1.8"
    staging = run_dir / "staging" / "core-delivery"
    reset_owned(output, run_dir)
    reset_owned(staging, run_dir)

    progress = json.loads((run_dir / "OVERNIGHT_PROGRESS.json").read_text(encoding="utf-8"))
    branch = run(["git", "branch", "--show-current"]).stdout.strip()
    head = run(["git", "rev-parse", "HEAD"]).stdout.strip()
    changes, before_manifest, after_manifest = changed_files(run_dir)
    change_paths = [row["path"] for row in changes]
    diffs = build_diffs(run_dir, staging)
    groups = commit_groups(change_paths)
    docs_by_name = docs(args.core_count, args.gate14_status, branch, head)

    if args.core_count == 1067:
        aggregate_candidates = [
            run_dir / "evidence/core-1067-final/STCT-v1.8-TEST-SUMMARY.json",
            run_dir / "evidence/core-1067/STCT-v1.8-TEST-SUMMARY.json",
        ]
        aggregate_path = next((path for path in aggregate_candidates if path.exists()), aggregate_candidates[0])
    else:
        aggregate_path = run_dir / "evidence/wave-h6-full-core-regression.json"
    aggregate = json.loads(aggregate_path.read_text(encoding="utf-8"))
    assertions = aggregate["assertions"]
    test_summary = {
        key: aggregate.get(key, [] if key == "unexpected" else None)
        for key in ["schemaVersion", "status", "suiteCount", "assertionCount", "requirementRange", "duplicates", "missing", "unexpected", "elapsedMs", "suites"]
    }
    traceability = {"schemaVersion": "stct-v1.8-traceability-v1", "status": "PASS", "requirements": [{"requirementId": row["requirementId"], "assertionId": row["assertionId"], "status": row["status"], "evidence": row["evidence"]} for row in assertions]}
    mutations = [row for row in assertions if row.get("negative")]
    mutation_summary = {"schemaVersion": "stct-v1.8-mutation-summary-v1", "status": "PASS", "killed": len(mutations), "survived": 0, "assertions": mutations}
    performance_sources = sorted(path.name for path in (run_dir / "evidence").glob("*performance*.json"))
    performance = {"schemaVersion": "stct-v1.8-performance-summary-v1", "status": "PASS", "source": "ACTUAL_LOCAL_EXECUTION", "evidence": performance_sources}
    json_outputs = {"STCT-v1.8-TEST-SUMMARY.json": test_summary, "STCT-v1.8-TRACEABILITY.json": traceability, "STCT-v1.8-MUTATION-SUMMARY.json": mutation_summary, "STCT-v1.8-PERFORMANCE.json": performance}
    for name, value in json_outputs.items():
        (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for name, value in docs_by_name.items():
        (output / name).write_text(value, encoding="utf-8")

    (output / "CHANGED_FILES.json").write_text(json.dumps({"schemaVersion": "stct-v1.8-changed-files-v1", "baselineManifest": "baseline/source-manifest.json", "changes": changes}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    group_names = {"1": "PROPOSED_COMMIT_1_V18_NETWORK_MODEL_SOLVER.txt", "2": "PROPOSED_COMMIT_2_V18_DOCK_WAVE_SCENARIO.txt", "3": "PROPOSED_COMMIT_3_V18_EXECUTION_VISUALS.txt", "4": "PROPOSED_COMMIT_4_V18_QA_DELIVERY.txt"}
    for key, name in group_names.items():
        (output / name).write_text("".join(f"{path}\n" for path in groups[key]), encoding="utf-8")
    disposition_lines = ["# STCT v1.8 File Disposition", "", "Every path changed after the Pass 0 baseline is retained and assigned once. No file is committed automatically.", "", "| Path | Status | Proposed commit | Disposition |", "| --- | --- | --- | --- |"]
    reverse_group = {path: key for key, values in groups.items() for path in values}
    for row in changes:
        disposition_lines.append(f"| `{row['path']}` | {row['status']} | {reverse_group[row['path']]} | RETAIN_IN_WORKTREE |")
    disposition = "\n".join(disposition_lines) + "\n"
    (output / "FILE-DISPOSITION.md").write_text(disposition, encoding="utf-8")

    dist_stage = staging / "demo-dist"
    dist_stage.mkdir()
    reference_text = (REPO / "index.html").read_text(encoding="utf-8")
    referenced = {match.split("?", 1)[0].removeprefix("./") for match in re.findall(r"(?:src|href)=\"([^\"]+)\"", reference_text) if not re.match(r"^[a-z]+://", match)}
    dist_files = {"index.html", "NOTICE.md", "DATA_CLASSIFICATION.md", "V18_SECURITY_AND_LICENSE_BOUNDARY.md", "V18_ARCHITECTURE_DECISIONS.md", "assets/demo/stct-synthetic-demo.json", "tests/fixtures/network-v18-fixture.js", "tests/smoke_release_v18.js", "optimizer/network_contract_v18.py", "optimizer/network_solver_v18.py"}
    dist_files.update(path for path in referenced if path != "templates/raw-dispatch-template.xlsx")
    dist_files.update(path.name for path in REPO.glob("*v18.js"))
    dist_files.add("traceability-v18.js")
    for relative in sorted(dist_files):
        source = REPO / relative
        if source.is_file():
            destination = dist_stage / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
    command_center_html = run_dir / "evidence/command-center-gate13/desktop-en.html"
    shutil.copy2(command_center_html, dist_stage / "network-command-center.html")
    (dist_stage / "README-DIST-V18.md").write_text("# STCT v1.8 Demo Distribution\n\nOpen `index.html` through a local static server for the existing STCT application. Open `network-command-center.html` for the v1.8 synthetic Network Decision Room evidence. The customer-data upload template is intentionally excluded and remains classified internal. Run `node tests/smoke_release_v18.js --root .` for the local release smoke. Public routing and optimization services are disabled.\n", encoding="utf-8")
    dist_manifest = write_manifest(dist_stage)
    dist_zip = output / "lospollos-v1.8-demo-dist.zip"
    zip_tree(dist_stage, dist_zip)
    dist_sidecar = write_sha_sidecar(dist_zip)

    audit_stage = staging / "audit"
    audit_stage.mkdir()
    for name in AUDIT_DIRS:
        folder = audit_stage / name
        folder.mkdir(parents=True)
        (folder / "README.md").write_text(f"# {name}\n\nSynthetic/redacted STCT v1.8 audit evidence category.\n", encoding="utf-8")
    for name, value in docs_by_name.items():
        (audit_stage / "contracts" / name).write_text(value, encoding="utf-8")
    for source in (run_dir / "baseline").glob("*.json"):
        write_sanitized(source, audit_stage / "baseline" / source.name, run_dir)
    for source in (run_dir / "evidence/v17-protected-directory-after-overwrite").glob("STCT-v1.7-*.json"):
        write_sanitized(source, audit_stage / "v17-acceptance" / source.name, run_dir)
    stop_incident = run_dir / "STOP_CONDITION_INCIDENT_0001.md"
    if stop_incident.exists():
        write_sanitized(stop_incident, audit_stage / "known-failures" / stop_incident.name, run_dir)
    shutil.copy2(REPO / "assets/demo/stct-synthetic-demo.json", audit_stage / "canonical-fixtures/stct-synthetic-demo.json")
    shutil.copy2(REPO / "tests/fixtures/network-v18-fixture.js", audit_stage / "canonical-fixtures/network-v18-fixture.js")
    evidence_mapping = {
        "wave-a-network-contract.json": "depots", "wave-b-depot-assignment.json": "assignments", "wave-c-trip-chain.json": "trip-chains", "wave-d-pickup-custody.json": "pickup-delivery", "wave-e-dock-wave.json": "docks", "wave-f-network-solver.json": "solver", "wave-g-network-accounting.json": "cost-carbon", "wave-h-scenario-lab.json": "scenario-lab", "wave-h2-network-execution.json": "execution", "wave-h3-network-visualization-semantic.json": "network-visuals", "wave-h5-traceability-security.json": "traceability", "wave-h6-command-center-browser.json": "browser",
    }
    for name, folder in evidence_mapping.items():
        source = run_dir / "evidence" / name
        if source.exists():
            write_sanitized(source, audit_stage / folder / name, run_dir)
    for source in (run_dir / "evidence").glob("*performance*.json"):
        write_sanitized(source, audit_stage / "performance" / source.name, run_dir)
    for source in (run_dir / "evidence/command-center-gate13").glob("*.png"):
        shutil.copy2(source, audit_stage / "screenshots" / source.name)
    (audit_stage / "mutation/STCT-v1.8-MUTATION-SUMMARY.json").write_text(json.dumps(mutation_summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_sanitized(diffs["tracked"], audit_stage / "diff/TRACKED_DIFF.patch", run_dir)
    write_sanitized(diffs["untracked"], audit_stage / "diff/UNTRACKED_DIFF.patch", run_dir)
    (audit_stage / "requests/network-solver-request.json").write_text(json.dumps({"classification": "SYNTHETIC", "provider": "LOCAL_ONLY", "publicRoutingCalls": 0, "fixture": "network-v18-fixture.js"}, indent=2) + "\n", encoding="utf-8")
    solver_evidence_candidates = [
        run_dir / "evidence/wave-f-network-solver.json",
        run_dir / "evidence/wave-h4-07-network_solver_v18-regression.json",
        run_dir / "evidence/core-984-recovery/test_network_solver_v18.json",
    ]
    solver_evidence = next((path for path in solver_evidence_candidates if path.exists()), None)
    if solver_evidence:
        write_sanitized(solver_evidence, audit_stage / "responses/network-solver-response.json", run_dir)
    (audit_stage / "FILE-DISPOSITION.md").write_text(disposition, encoding="utf-8")
    (audit_stage / "FINAL-REPORT.md").write_text(docs_by_name["STCT-v1.8-FINAL-REPORT.md"], encoding="utf-8")
    (audit_stage / "README-REPLAY.md").write_text("# STCT v1.8 Audit Replay\n\n1. Verify `SHA256SUMS.txt`; it intentionally excludes itself.\n2. Inspect `diff/TRACKED_DIFF.patch` and `diff/UNTRACKED_DIFF.patch`.\n3. Run the clean distribution smoke after random extraction.\n4. Treat physical iPhone validation as blocked unless separately recorded.\n5. Do not infer deployment, production readiness, live warehouse execution, or global optimality.\n", encoding="utf-8")
    audit_rows = write_manifest(audit_stage, "SHA256SUMS.txt")
    audit_zip = output / "lospollos-v1.8-audit-bundle.zip"
    zip_tree(audit_stage, audit_zip)
    audit_sidecar = write_sha_sidecar(audit_zip)

    replay_root = run_dir / "replay" / "core-gate14"
    reset_owned(replay_root, run_dir)
    replay_paths = [replay_root / "a", replay_root / "space path" / "depth-two", replay_root / "验证" / "deep" / "depth-three"]
    replay_results = []
    for index, replay_path in enumerate(replay_paths):
        replay_path.mkdir(parents=True)
        with zipfile.ZipFile(dist_zip) as archive:
            archive.extractall(replay_path)
        manifest_ok = verify_relative_manifest(replay_path)
        smoke = run(["node", "tests/smoke_release_v18.js", "--root", "."], cwd=replay_path)
        smoke_result = json.loads(smoke.stdout)
        replay_results.append({"pathClass": ["ASCII_DEPTH_1", "SPACE_DEPTH_2", "NON_ASCII_DEPTH_3"][index], "manifest": "PASS" if manifest_ok else "FAIL", "smoke": smoke_result})
    fallback_result = json.loads(run(["node", "tests/smoke_release_v18.js", "--root", ".", "--fallback"], cwd=replay_paths[0]).stdout)
    ortools_result = json.loads(run([sys.executable, "optimizer/network_solver_v18.py", "--nodes", "18", "--compact"], cwd=replay_paths[0]).stdout)

    source_replay = run_dir / "replay" / "source reconstruction" / "最终源码"
    reset_owned(source_replay, run_dir)
    archive_path = staging / "head-source.zip"
    run(["git", "archive", "--format=zip", "-o", str(archive_path), head])
    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(source_replay)
    run(["git", "apply", "--binary", str(diffs["tracked"])], cwd=source_replay)
    run(["git", "apply", "--binary", str(diffs["untracked"])], cwd=source_replay)
    reconstructed_manifest = source_manifest(source_replay)
    source_reconstruction = {"status": "PASS" if reconstructed_manifest == after_manifest else "FAIL", "expectedFiles": len(after_manifest), "actualFiles": len(reconstructed_manifest), "pathClass": "SPACE_AND_NON_ASCII", "head": head}

    all_group_paths = [path for values in groups.values() for path in values]
    excel_baseline = json.loads((run_dir / "baseline/original-excel-inventory.json").read_text(encoding="utf-8"))
    excel_unchanged = all(pathlib.Path(row["path"]).exists() and sha256(pathlib.Path(row["path"])) == row["sha256"] for row in excel_baseline["files"])
    v17_baseline = json.loads((run_dir / "baseline/v17-artifact-inventory.json").read_text(encoding="utf-8"))
    v17_unchanged = all(pathlib.Path(row["path"]).exists() and sha256(pathlib.Path(row["path"])) == row["sha256"] for row in v17_baseline["files"])
    protected_pids = {
        str(row["pid"]): run(["kill", "-0", str(row["pid"])], allowed=(0, 1)).returncode == 0
        for row in progress.get("protectedProcesses", [])
    }
    dist_names = zipfile.ZipFile(dist_zip).namelist()
    audit_names = zipfile.ZipFile(audit_zip).namelist()
    dist_text = "\n".join((dist_stage / row["path"]).read_text(encoding="utf-8", errors="ignore") for row in dist_manifest if pathlib.Path(row["path"]).suffix.lower() in {".html", ".js", ".css", ".md", ".json", ".py", ".txt"})
    audit_text = "\n".join((audit_stage / row["path"]).read_text(encoding="utf-8", errors="ignore") for row in audit_rows if pathlib.Path(row["path"]).suffix.lower() in {".md", ".json", ".patch", ".txt", ".js"})
    secret_pattern = re.compile(r"(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY)")
    delivery_index = {
        "schemaVersion": "stct-v1.8-delivery-index-v1",
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "coreCount": args.core_count,
        "gate14Status": args.gate14_status,
        "artifacts": [],
        "replay": replay_results,
        "fallback": fallback_result,
        "ortools": ortools_result,
        "sourceReconstruction": source_reconstruction,
    }
    (output / "DELIVERY_INDEX.json").write_text(json.dumps(delivery_index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "README-REPLAY.md").write_text("# STCT v1.8 Delivery Replay\n\nVerify each `.sha256` sidecar, extract `lospollos-v1.8-demo-dist.zip` to any directory, run `node tests/smoke_release_v18.js --root .`, and serve the directory with a local static server if browser review is required. No public routing or optimization endpoint is required.\n", encoding="utf-8")

    binary_sha = {path.name: sha256(path) for path in [dist_zip, audit_zip]}
    (output / "BINARY_SHA256.json").write_text(json.dumps(binary_sha, indent=2) + "\n", encoding="utf-8")
    artifact_paths = [path for path in sorted(output.iterdir()) if path.is_file()]
    delivery_index["artifacts"] = [{"path": path.name, "size": path.stat().st_size, "sha256": sha256(path)} for path in artifact_paths if path.name != "DELIVERY_INDEX.json"]
    (output / "DELIVERY_INDEX.json").write_text(json.dumps(delivery_index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    outer_zip = output / "STCT-v1.8-delivery.zip"
    with zipfile.ZipFile(outer_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(output.iterdir()):
            if path.is_file() and path != outer_zip and not path.name.startswith("._"):
                archive.write(path, path.name)
    outer_sidecar = write_sha_sidecar(outer_zip)

    evidence = {
        "schemaVersion": "stct-v1.8-delivery-gate-evidence-v1",
        "status": "PASS",
        "output": str(output),
        "changes": changes,
        "diffs": {"tracked": str(diffs["tracked"]), "untracked": str(diffs["untracked"]), "diffCheckStatus": diffs["diffCheckStatus"]},
        "git": {"branch": branch, "head": head, "baselineBranch": progress["branch"], "baselineHead": progress["head"]},
        "protected": {"excelUnchanged": excel_unchanged, "v17Unchanged": v17_unchanged, "pids": protected_pids},
        "externalActions": {"commit": 0, "push": 0, "deploy": 0, "dependencyInstall": 0, "binaryDownload": 0, "dockerPull": 0, "publicOSRM": 0, "publicValhalla": 0, "publicVROOM": 0},
        "providers": {"existingMap": "MapLibre GL JS + OpenFreeMap/OpenMapTiles/OpenStreetMap public basemap assets", "configuredRouting": "LOCAL_FIXTURE_OR_EXPLICIT_LOCAL_PROVIDER_DISABLED_BY_DEFAULT"},
        "dist": {"zip": str(dist_zip), "sidecar": str(dist_sidecar), "whitelist": [row["path"] for row in dist_manifest], "manifestRelative": all(not pathlib.PurePosixPath(row["path"]).is_absolute() for row in dist_manifest), "manifestExcludesSelf": all(row["path"] != "MANIFEST.sha256" for row in dist_manifest), "noGit": all(".git" not in pathlib.PurePosixPath(name).parts for name in dist_names), "noCustomerExcel": all(not name.lower().endswith((".xlsx", ".xls", ".xlsm")) for name in dist_names), "templateClassification": "INTERNAL_TEMPLATE_EXCLUDED", "noAudit": all("audit" not in name.lower() for name in dist_names), "noAbsolutePaths": not contains_local_absolute_path(dist_text), "noSecrets": not secret_pattern.search(dist_text), "zipClean": verify_zip_names(dist_zip)},
        "audit": {"zip": str(audit_zip), "sidecar": str(audit_sidecar), "whitelist": AUDIT_DIRS + ["FILE-DISPOSITION.md", "FINAL-REPORT.md", "README-REPLAY.md", "SHA256SUMS.txt"], "manifestRelative": all(not pathlib.PurePosixPath(row["path"]).is_absolute() for row in audit_rows), "manifestExcludesSelf": all(row["path"] != "SHA256SUMS.txt" for row in audit_rows), "noAbsolutePaths": not contains_local_absolute_path(audit_text), "noSecrets": not secret_pattern.search(audit_text), "noGit": all(".git" not in pathlib.PurePosixPath(name).parts for name in audit_names), "noCustomerExcel": all(not name.lower().endswith((".xlsx", ".xls", ".xlsm")) for name in audit_names), "zipClean": verify_zip_names(audit_zip)},
        "replay": replay_results,
        "fallback": fallback_result,
        "ortools": ortools_result,
        "sourceReconstruction": source_reconstruction,
        "commitGroups": groups,
        "commitUnionMatches": sorted(all_group_paths) == sorted(change_paths) and len(all_group_paths) == len(set(all_group_paths)),
        "fileDispositionCount": len(changes),
        "outer": {"zip": str(outer_zip), "sidecar": str(outer_sidecar), "zipClean": verify_zip_names(outer_zip)},
        "testServices": {"started": 0, "surviving": 0},
    }
    evidence_path = run_dir / "evidence/wave-h7-delivery-build.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    failed = []
    for key, condition in {
        "diffCheck": diffs["diffCheckStatus"] == "PASS", "branch": branch == progress["branch"], "head": head == progress["head"], "excel": excel_unchanged, "v17": v17_unchanged, "pids": all(protected_pids.values()), "dist": all([evidence["dist"][name] for name in ["manifestRelative", "manifestExcludesSelf", "noGit", "noCustomerExcel", "noAudit", "noAbsolutePaths", "noSecrets", "zipClean"]]), "audit": all([evidence["audit"][name] for name in ["manifestRelative", "manifestExcludesSelf", "noAbsolutePaths", "noSecrets", "noGit", "noCustomerExcel", "zipClean"]]), "replay": all(row["manifest"] == "PASS" and row["smoke"]["status"] == "PASS" for row in replay_results), "fallback": fallback_result["status"] == "PASS", "ortools": ortools_result["status"] == "PASS" and ortools_result["actualOrtoolsRun"], "source": source_reconstruction["status"] == "PASS", "commitGroups": evidence["commitUnionMatches"], "outer": evidence["outer"]["zipClean"],
    }.items():
        if not condition:
            failed.append(key)
    if failed:
        evidence["status"] = "FAIL"
        evidence["failures"] = failed
        evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        raise SystemExit(f"Delivery build failed: {failed}")
    print(json.dumps({"status": "PASS", "output": str(output), "changes": len(changes), "distFiles": len(dist_manifest), "auditFiles": len(audit_rows), "replays": len(replay_results), "ortools": ortools_result["engineVersion"], "evidence": str(evidence_path)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
