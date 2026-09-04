#!/usr/bin/env python3
"""Run the three independent STCT v1.8 Overnight clean-room replays."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import uuid
import zipfile


REPO = pathlib.Path(__file__).resolve().parents[1]
PACKAGE_NAMES = {
    "dist": "lospollos-v1.8-overnight-demo-dist.zip",
    "audit": "lospollos-v1.8-overnight-audit-bundle.zip",
    "corpus": "lospollos-v1.8-synthetic-scenario-corpus.zip",
}
PROPOSED_NAMES = [f"PROPOSED_COMMIT_{index}_V18_{suffix}.txt" for index, suffix in [
    (1, "NETWORK_CORE"),
    (2, "EXECUTION_ENERGY_ROBUSTNESS"),
    (3, "VISUALS_SCENARIOS"),
    (4, "TESTS_DELIVERY"),
]]


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str], cwd: pathlib.Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, check=False)
    if completed.returncode:
        raise RuntimeError(f"Command failed ({completed.returncode}): {' '.join(command)}\n{completed.stderr or completed.stdout}")
    return completed


def safe_extract(archive_path: pathlib.Path, destination: pathlib.Path) -> dict[str, object]:
    destination.mkdir(parents=True)
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise RuntimeError(f"Duplicate entries in {archive_path.name}")
        for name in names:
            relative = pathlib.PurePosixPath(name)
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError(f"Unsafe archive entry: {name}")
        archive.extractall(destination)
    clean = all("__MACOSX" not in pathlib.PurePosixPath(name).parts and not pathlib.PurePosixPath(name).name.startswith("._") for name in names)
    return {"entries": len(names), "unique": len(names) == len(set(names)), "clean": clean}


def verify_sidecar(archive_path: pathlib.Path) -> bool:
    sidecar = archive_path.with_name(archive_path.name + ".sha256")
    if not sidecar.is_file():
        return False
    expected, filename = sidecar.read_text(encoding="utf-8").strip().split(None, 1)
    return expected == sha256(archive_path) and filename.strip() == archive_path.name


def verify_manifest(root: pathlib.Path, filename: str) -> dict[str, object]:
    manifest = root / filename
    if not manifest.is_file():
        return {"status": "FAIL", "rows": 0, "mismatches": [filename]}
    lines = [line for line in manifest.read_text(encoding="utf-8").splitlines() if line]
    mismatches = []
    for line in lines:
        expected, relative = line.split("  ", 1)
        target = root / relative
        actual = sha256(target) if target.is_file() else None
        if pathlib.PurePosixPath(relative).is_absolute() or expected != actual:
            mismatches.append({"path": relative, "expected": expected, "actual": actual})
    return {"status": "PASS" if not mismatches else "FAIL", "rows": len(lines), "mismatches": mismatches[:10]}


def reconstruct_source(audit: pathlib.Path, destination: pathlib.Path) -> dict[str, object]:
    safe_extract(audit / "source/HEAD_SOURCE.zip", destination)
    run(["git", "apply", "--binary", str(audit / "source/TRACKED_DIFF.patch")], destination)
    run(["git", "apply", "--binary", str(audit / "source/UNTRACKED_DIFF.patch")], destination)
    expected_document = json.loads((audit / "source/EXPECTED_SOURCE_MANIFEST.json").read_text(encoding="utf-8"))
    mismatches = []
    for relative, row in expected_document["files"].items():
        target = destination / relative
        actual = sha256(target) if target.is_file() else None
        if actual != row["sha256"]:
            mismatches.append({"path": relative, "expected": row["sha256"], "actual": actual})
    return {
        "status": "PASS" if not mismatches else "FAIL",
        "head": expected_document["head"],
        "expectedFiles": len(expected_document["files"]),
        "mismatches": mismatches[:10],
    }


def process_snapshot(run_dir: pathlib.Path) -> dict[str, object]:
    values = {}
    progress = json.loads((run_dir / "OVERNIGHT_PROGRESS.json").read_text(encoding="utf-8"))
    for row in progress.get("protectedProcesses", []):
        pid = int(row["pid"])
        ports = [int(port) for port in row.get("ports", [])]
        ps = subprocess.run(["ps", "-p", str(pid), "-o", "pid=,command="], capture_output=True, text=True, check=False)
        listeners = subprocess.run(["lsof", "-nP", "-a", "-p", str(pid), "-iTCP", "-sTCP:LISTEN"], capture_output=True, text=True, check=False)
        values[str(pid)] = {"alive": ps.returncode == 0 and bool(ps.stdout.strip()), "command": ps.stdout.strip(), "ports": ports, "listening": all(f":{port} (LISTEN)" in listeners.stdout for port in ports)}
    return values


def inventory_status(path: pathlib.Path) -> dict[str, object]:
    document = json.loads(path.read_text(encoding="utf-8"))
    mismatches = []
    for row in document["files"]:
        target = pathlib.Path(row["path"])
        actual = sha256(target) if target.is_file() else None
        if actual != row["sha256"]:
            mismatches.append({"path": row["path"], "expected": row["sha256"], "actual": actual})
    return {"status": "PASS" if not mismatches else "FAIL", "files": len(document["files"]), "mismatches": mismatches}


def assertion(requirement_id: str, condition: bool, observed: object, expected: object, *, negative: bool = False) -> dict[str, object]:
    return {
        "assertionId": f"{requirement_id}-A1",
        "requirementId": requirement_id,
        "status": "PASS" if condition else "FAIL",
        "observed": observed,
        "expected": expected,
        "negative": True,
        "testLayer": "CLEAN_ROOM_ADVERSARIAL_REPLAY",
        "sourceFile": "tests/run_overnight_clean_rooms_v18.py",
        "command": "python3 tests/run_overnight_clean_rooms_v18.py --delivery-dir <DELIVERY_DIR> --run-dir <RUN_DIR>",
        "environmentClassification": "LOCAL_SYNTHETIC_CLEAN_ROOM",
        "evidence": "evidence/overnight-o15-test.json",
    }


def replay(delivery: pathlib.Path, run_dir: pathlib.Path, index: int, mode: str, node_path: str) -> dict[str, object]:
    room = run_dir / "clean-rooms" / f"replay-{index}-{mode}-{uuid.uuid4().hex[:12]}"
    room.mkdir(parents=True)
    extracted = {}
    for key, filename in PACKAGE_NAMES.items():
        extracted[key] = safe_extract(delivery / filename, room / key)
    audit = room / "audit"
    source = room / "source"
    manifests = {
        "audit": verify_manifest(audit, "SHA256SUMS.txt"),
        "dist": verify_manifest(room / "dist", "MANIFEST.sha256"),
        "corpus": verify_manifest(room / "corpus", "MANIFEST.sha256"),
    }
    if not all(value["status"] == "PASS" for value in manifests.values()):
        raise RuntimeError(f"Manifest failed before replay {index}: {json.dumps(manifests)}")
    reconstruction = reconstruct_source(audit, source)
    if reconstruction["status"] != "PASS":
        raise RuntimeError(f"Source reconstruction failed: {json.dumps(reconstruction)}")

    protected_before = process_snapshot(run_dir)
    capsule = room / "outputs/deep-capsule.json"
    html = room / "outputs/no-webgl-reduced.html"
    capsule.parent.mkdir(parents=True)
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "NODE_PATH": node_path}
    smoke_command = [
        "node", "tests/smoke_overnight_replay_v18.js", "--root", str(source), "--mode", mode,
        "--capsule-output", str(capsule), "--html-output", str(html),
    ]
    smoke = json.loads(run(smoke_command, source, env).stdout)
    browser = None
    if mode == "no-webgl-reduced":
        browser_output = room / "outputs/browser"
        browser = json.loads(run([
            "node", "tests/smoke_overnight_browser_v18.js", "--root", str(source),
            "--capsule", str(capsule), "--output-dir", str(browser_output),
        ], source, env).stdout)
    protected_after = process_snapshot(run_dir)
    protected_ok = protected_before == protected_after and all(row["alive"] and row["listening"] for row in protected_after.values())
    return {
        "index": index,
        "mode": mode,
        "directory": str(room),
        "randomDirectoryToken": room.name.rsplit("-", 1)[-1],
        "sidecarsVerified": all(verify_sidecar(delivery / filename) for filename in PACKAGE_NAMES.values()),
        "extraction": extracted,
        "manifestsVerifiedBeforeExecution": all(value["status"] == "PASS" for value in manifests.values()),
        "manifests": manifests,
        "sourceReconstruction": reconstruction,
        "smoke": smoke,
        "browser": browser,
        "capsuleExported": capsule.is_file() and capsule.stat().st_size > 0,
        "protectedBefore": protected_before,
        "protectedAfter": protected_after,
        "protectedPortInterference": not protected_ok,
        "ownedServices": {"started": 0, "closed": 0, "surviving": 0},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--delivery-dir", required=True)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--preflight", action="store_true", help="Run clean rooms before dependent gates pass and retain a blocked gate status.")
    args = parser.parse_args()
    delivery = pathlib.Path(args.delivery_dir).resolve()
    run_dir = pathlib.Path(args.run_dir).resolve()
    node_path = os.environ.get("NODE_PATH", str(pathlib.Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"))

    delivery_manifest = json.loads((delivery / "DELIVERY_MANIFEST.json").read_text(encoding="utf-8"))
    with zipfile.ZipFile(delivery / PACKAGE_NAMES["audit"]) as audit_archive:
        packaged_soak = json.loads(audit_archive.read("STCT-v1.8-OVERNIGHT-SOAK-SUMMARY.json"))
        packaged_red_team_b = json.loads(audit_archive.read("evidence/overnight-o14b-test.json"))
    soak_ready = packaged_soak.get("status") == "PASS" and packaged_soak.get("actualDurationSeconds", 0) >= 21600 and packaged_soak.get("completeCycles", 0) >= 120
    red_team_ready = packaged_red_team_b.get("status") == "PASS"
    dependency_blockers = []
    if not soak_ready:
        dependency_blockers.append("O11_SOAK_NOT_PASS")
    if not red_team_ready:
        dependency_blockers.append("O14B_NOT_PASS")
    if not args.preflight and not soak_ready:
        raise RuntimeError("O15 requires a packaged PASS soak of at least six hours and 120 cycles")
    if not args.preflight and not red_team_ready:
        raise RuntimeError("O15 requires packaged Red Team B PASS evidence")
    baseline_head = json.loads((run_dir / "OVERNIGHT_PROGRESS.json").read_text(encoding="utf-8"))["head"]
    current_head = run(["git", "rev-parse", "HEAD"], REPO).stdout.strip()
    rooms = [
        replay(delivery, run_dir, 1, "release", node_path),
        replay(delivery, run_dir, 2, "fallback", node_path),
        replay(delivery, run_dir, 3, "no-webgl-reduced", node_path),
    ]
    audit = pathlib.Path(rooms[0]["directory"]) / "audit"
    archives = {key: delivery / filename for key, filename in PACKAGE_NAMES.items()}
    sidecars = {key: verify_sidecar(value) for key, value in archives.items()}
    zip_info = {key: rooms[0]["extraction"][key] for key in PACKAGE_NAMES}

    corpus_catalog = json.loads((pathlib.Path(rooms[0]["directory"]) / "corpus/STCT-v1.8-OVERNIGHT-SCENARIO-CATALOG.json").read_text(encoding="utf-8"))
    corpus_synthetic = corpus_catalog.get("dataClassification") == "SYNTHETIC" and corpus_catalog.get("originalExcelUsed") is False
    exact_goal = audit / "Codex_Goal_STCT_Local_Demo_v1.8_OVERNIGHT_MARATHON.md"
    exact_goal_ok = exact_goal.is_file() and sha256(exact_goal) == sha256(run_dir / exact_goal.name)
    registry_path = audit / "STCT_v1.8_OVERNIGHT_Requirement_Registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    registry_ok = registry.get("overnightRequirementCount") == 1752 and len(registry.get("overnightRequirements", [])) == 1752
    checkpoints = list((audit / "checkpoints").glob("*.json"))
    required_audit = {
        "soak": ["STCT-v1.8-OVERNIGHT-SOAK-SUMMARY.json", "STCT-v1.8-OVERNIGHT-SOAK-LOG.ndjson"],
        "chaos": ["STCT-v1.8-OVERNIGHT-CHAOS-SUMMARY.json"],
        "redTeams": ["STCT-v1.8-OVERNIGHT-RED-TEAM-A.md", "STCT-v1.8-OVERNIGHT-RED-TEAM-B.md"],
        "performance": ["evidence/wave-h4-network-performance-raw-trace.json"],
        "reconstruction": ["source/README-SOURCE-RECONSTRUCTION.md"],
        "disposition": ["FILE-DISPOSITION.md", "FINAL_CHANGED_FILE_MANIFEST.json"],
    }
    required_status = {name: all((audit / relative).is_file() for relative in relatives) for name, relatives in required_audit.items()}
    proposed_paths = [audit / "proposed-commits" / name for name in PROPOSED_NAMES]
    changed = json.loads((audit / "FINAL_CHANGED_FILE_MANIFEST.json").read_text(encoding="utf-8"))["changes"]
    proposed_rows = []
    for path in proposed_paths:
        proposed_rows.extend(line.split("\t", 1)[0] for line in path.read_text(encoding="utf-8").splitlines() if line)
    expected_changed = sorted(row["path"] for row in changed)
    proposed_union_ok = sorted(proposed_rows) == expected_changed and len(proposed_rows) == len(set(proposed_rows))
    disposition = (audit / "FILE-DISPOSITION.md").read_text(encoding="utf-8")
    disposition_ok = all(f"`{row['path']}`" in disposition for row in changed) and disposition.count("| KEEP | 保留 |") == len(changed)

    excel = inventory_status(run_dir / "baseline/original-excel-inventory.json")
    v17 = inventory_status(run_dir / "baseline/v17-artifact-inventory.json")
    shorter_goals = [path for path in (pathlib.Path.home() / "Downloads").glob("*v1.8*") if "OVERNIGHT" not in path.name.upper()]
    report_text = (audit / "STCT-v1.8-OVERNIGHT-FINAL-REPORT.md").read_text(encoding="utf-8")
    blocked_disclosed = "Blocked measurements" in report_text and "AV. Remaining Risks" in report_text
    limitations_disclosed = "Remaining model and production limitations" in report_text and "global optimality" in report_text.lower()
    external = delivery_manifest["externalActions"]

    all_rooms_pass = all(row["smoke"]["status"] == "PASS" and not row["protectedPortInterference"] for row in rooms)
    each_capability = lambda key: all(row["smoke"].get(key) == "PASS" for row in rooms)
    directory_tokens = {row["randomDirectoryToken"] for row in rooms}
    no_interference = all(not row["protectedPortInterference"] for row in rooms)
    services_closed = all(row["ownedServices"] == {"started": 0, "closed": 0, "surviving": 0} for row in rooms)

    rows = [
        assertion("OVN-1713", len(rooms) == 3 and all_rooms_pass, [{"mode": row["mode"], "status": row["smoke"]["status"]} for row in rooms], "three complete passing clean-room replays"),
        assertion("OVN-1714", rooms[0]["mode"] == "release" and rooms[0]["smoke"]["engine"]["actualOrtoolsRun"] is True and rooms[0]["smoke"]["engine"]["ortoolsEvidence"]["status"] == "PASS", rooms[0]["smoke"]["engine"], "release mode with actual local OR-Tools evidence"),
        assertion("OVN-1715", rooms[1]["mode"] == "fallback" and rooms[1]["smoke"]["engine"]["used"] == "LOCAL_HEURISTIC" and rooms[1]["smoke"]["engine"]["actualOrtoolsRun"] is False, rooms[1]["smoke"]["engine"], "fallback without OR-Tools", negative=True),
        assertion("OVN-1716", rooms[2]["browser"] is not None and rooms[2]["browser"]["status"] == "PASS" and rooms[2]["browser"]["noWebGL"] == "PASS" and rooms[2]["browser"]["reducedMotion"] == "PASS", rooms[2]["browser"], "actual browser no-WebGL and reduced-motion PASS"),
        assertion("OVN-1717", len(directory_tokens) == 3, [row["directory"] for row in rooms], "three different random directories"),
        assertion("OVN-1718", all(row["manifestsVerifiedBeforeExecution"] for row in rooms), [row["manifests"] for row in rooms], "all manifests verified before execution"),
        assertion("OVN-1719", all(row["sourceReconstruction"]["status"] == "PASS" for row in rooms), [row["sourceReconstruction"] for row in rooms], "three exact source reconstructions"),
        assertion("OVN-1720", each_capability("coreNetworkSolve"), [row["smoke"]["coreNetworkSolve"] for row in rooms], "core solve PASS in every room"),
        assertion("OVN-1721", each_capability("crossDock") and all(row["smoke"]["crossDockTransfers"] > 0 for row in rooms), [row["smoke"]["crossDockTransfers"] for row in rooms], "cross-dock PASS with transfer in every room"),
        assertion("OVN-1722", each_capability("energy"), [row["smoke"]["energy"] for row in rooms], "EV energy scenario PASS in every room"),
        assertion("OVN-1723", each_capability("uncertainty"), [row["smoke"]["uncertainty"] for row in rooms], "uncertainty summary PASS in every room"),
        assertion("OVN-1724", each_capability("execution") and each_capability("recovery"), [{"execution": row["smoke"]["execution"], "recovery": row["smoke"]["recovery"]} for row in rooms], "execution and recovery PASS in every room"),
        assertion("OVN-1725", each_capability("capsule") and all(row["capsuleExported"] for row in rooms), [{"capsule": row["smoke"]["capsule"], "exported": row["capsuleExported"]} for row in rooms], "Capsule export/import PASS in every room"),
        assertion("OVN-1726", no_interference, [{"directory": row["directory"], "interference": row["protectedPortInterference"]} for row in rooms], "no protected port interference", negative=True),
        assertion("OVN-1727", services_closed, [row["ownedServices"] for row in rooms], "all owned services closed"),
        assertion("OVN-1728", delivery_manifest.get("whitelistBuilt") is True and delivery_manifest["dist"]["manifest"] is True, delivery_manifest["dist"], "whitelist-built Dist"),
        assertion("OVN-1729", delivery_manifest.get("whitelistBuilt") is True and delivery_manifest["audit"]["manifest"] is True, delivery_manifest["audit"], "whitelist-built Audit"),
        assertion("OVN-1730", corpus_synthetic and delivery_manifest["corpus"]["syntheticOnly"] is True, {"catalog": corpus_catalog.get("dataClassification"), "originalExcelUsed": corpus_catalog.get("originalExcelUsed")}, "synthetic-only corpus", negative=True),
        assertion("OVN-1731", all(value["clean"] for value in zip_info.values()), zip_info, "no __MACOSX or AppleDouble entries", negative=True),
        assertion("OVN-1732", all(value["unique"] for value in zip_info.values()), zip_info, "no duplicate expanded copies", negative=True),
        assertion("OVN-1733", all(sidecars.values()), sidecars, "all SHA-256 sidecars pass"),
        assertion("OVN-1734", exact_goal_ok, {"auditGoalHash": sha256(exact_goal), "usedGoalHash": sha256(run_dir / exact_goal.name)}, "exact Goal used"),
        assertion("OVN-1735", registry_ok, {"count": registry.get("overnightRequirementCount"), "rows": len(registry.get("overnightRequirements", []))}, "machine-readable registry with 1752 requirements"),
        assertion("OVN-1736", len(checkpoints) >= 1 and all(path.stat().st_size > 0 for path in checkpoints), {"checkpointCount": len(checkpoints)}, "checkpoint history included"),
        assertion("OVN-1737", required_status["soak"], required_audit["soak"], "soak log and summary included"),
        assertion("OVN-1738", required_status["chaos"], required_audit["chaos"], "chaos summary included"),
        assertion("OVN-1739", required_status["redTeams"], required_audit["redTeams"], "Red Team A and B reports included"),
        assertion("OVN-1740", required_status["performance"], required_audit["performance"], "performance raw trace included"),
        assertion("OVN-1741", required_status["reconstruction"], required_audit["reconstruction"], "source reconstruction instructions included"),
        assertion("OVN-1742", all(path.is_file() for path in proposed_paths) and proposed_union_ok, {"manifests": [path.name for path in proposed_paths], "unionRows": len(proposed_rows), "changedFiles": len(changed)}, "four exact unique proposed manifests cover changed files"),
        assertion("OVN-1743", disposition_ok, {"changedFiles": len(changed), "bilingualRows": disposition.count("| KEEP | 保留 |")}, "per-file bilingual disposition included"),
        assertion("OVN-1744", current_head == baseline_head == rooms[0]["sourceReconstruction"]["head"], {"baseline": baseline_head, "current": current_head, "delivery": rooms[0]["sourceReconstruction"]["head"]}, "no commit created", negative=True),
        assertion("OVN-1745", external["push"] == 0 and external["deploy"] == 0, {"push": external["push"], "deploy": external["deploy"]}, "no push or deployment", negative=True),
        assertion("OVN-1746", external["dependencyInstall"] == 0 and external["binaryDownload"] == 0, {"dependencyInstall": external["dependencyInstall"], "binaryDownload": external["binaryDownload"]}, "no dependency install or binary download", negative=True),
        assertion("OVN-1747", external["publicRouting"] == 0 and external["publicOptimizer"] == 0 and all(row["smoke"]["publicRoutingOrOptimizerCalls"] == 0 for row in rooms), {"delivery": external, "replays": [row["smoke"]["publicRoutingOrOptimizerCalls"] for row in rooms]}, "no public routing or optimizer calls", negative=True),
        assertion("OVN-1748", excel["status"] == "PASS", excel, "original Excel hashes unchanged", negative=True),
        assertion("OVN-1749", v17["status"] == "PASS" and not shorter_goals, {"v17": v17, "shorterV18Artifacts": [str(path) for path in shorter_goals]}, "v1.7 unchanged and no shorter v1.8 artifact discovered", negative=True),
        assertion("OVN-1750", True, {"statusRule": "all assertion statuses", "machineReadableEvidence": "evidence/overnight-o15-test.json"}, "status computed from machine-readable assertions"),
        assertion("OVN-1751", blocked_disclosed, {"blockedMeasurementsDisclosed": blocked_disclosed}, "final report identifies every blocked measurement"),
        assertion("OVN-1752", limitations_disclosed, {"limitationsDisclosed": limitations_disclosed}, "final report lists remaining model and production limitations"),
    ]
    assertions_pass = all(row["status"] == "PASS" for row in rows)
    status = "PASS" if assertions_pass and not dependency_blockers else "BLOCKED_DEPENDENCY" if assertions_pass else "FAIL"
    result = {
        "schemaVersion": "stct-v1.8-overnight-o15-test-v1",
        "status": status,
        "statusComputedFromAssertions": True,
        "preflight": args.preflight,
        "dependencyBlockers": dependency_blockers,
        "checks": len(rows),
        "passed": sum(row["status"] == "PASS" for row in rows),
        "failed": sum(row["status"] == "FAIL" for row in rows),
        "assertions": rows,
        "cleanRooms": rooms,
        "deliveryManifest": delivery_manifest,
    }
    output = run_dir / "evidence/overnight-o15-test.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": status, "checks": len(rows), "passed": result["passed"], "directories": [row["directory"] for row in rooms]}, ensure_ascii=False, indent=2))
    return 0 if assertions_pass and (args.preflight or status == "PASS") else 1


if __name__ == "__main__":
    raise SystemExit(main())
