#!/usr/bin/env python3
"""Build whitelist-only STCT v1.8 Overnight candidate or final artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import zipfile


REPO = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_RUN = pathlib.Path(tempfile.gettempdir()) / "stct-v18-overnight"
EXCLUDED_PARTS = {".git", ".claude", ".run", "logs", "__pycache__"}
TEXT_SUFFIXES = {".css", ".html", ".js", ".json", ".md", ".ndjson", ".patch", ".py", ".txt"}
OFFICIAL_SPEC_NAMES = {
    "Codex_Goal_STCT_Local_Demo_v1.8_OVERNIGHT_MARATHON.md",
    "STCT_v1.8_OVERNIGHT_Requirement_Registry.json",
    "STCT_v1.8_OVERNIGHT_Checkpoint_Template.json",
}
SECRET_PATTERN = re.compile(
    r"(?:sk-(?:proj-)?[A-Za-z0-9_-]{40,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY)"
)
PROPOSED_NAMES = {
    "1": "PROPOSED_COMMIT_1_V18_NETWORK_CORE.txt",
    "2": "PROPOSED_COMMIT_2_V18_EXECUTION_ENERGY_ROBUSTNESS.txt",
    "3": "PROPOSED_COMMIT_3_V18_VISUALS_SCENARIOS.txt",
    "4": "PROPOSED_COMMIT_4_V18_TESTS_DELIVERY.txt",
}


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
    resolved = path.resolve()
    if run_dir.resolve() not in resolved.parents:
        raise RuntimeError(f"Refusing to reset path outside run directory: {resolved}")
    if resolved.exists():
        shutil.rmtree(resolved)
    resolved.mkdir(parents=True)


def source_manifest(root: pathlib.Path) -> dict[str, dict[str, object]]:
    rows: dict[str, dict[str, object]] = {}
    for file in sorted(root.rglob("*")):
        if not file.is_file():
            continue
        relative = file.relative_to(root)
        if any(part in EXCLUDED_PARTS for part in relative.parts) or file.name == ".DS_Store" or file.suffix == ".pyc":
            continue
        rows[relative.as_posix()] = {"size": file.stat().st_size, "sha256": sha256(file)}
    return rows


def baseline_manifest(run_dir: pathlib.Path) -> dict[str, dict[str, object]]:
    source = json.loads((run_dir / "baseline/source-manifest.json").read_text(encoding="utf-8"))
    return {
        row["path"]: {"size": row["size"], "sha256": row["sha256"]}
        for row in source["entries"]
        if not any(part in EXCLUDED_PARTS for part in pathlib.PurePosixPath(row["path"]).parts)
        and pathlib.PurePosixPath(row["path"]).name != ".DS_Store"
    }


def changed_files(run_dir: pathlib.Path) -> list[dict[str, object]]:
    before = baseline_manifest(run_dir)
    after = source_manifest(REPO)
    rows = []
    for name in sorted(set(before) | set(after)):
        status = "ADDED" if name not in before else "REMOVED" if name not in after else "CHANGED" if before[name]["sha256"] != after[name]["sha256"] else "UNCHANGED"
        if status != "UNCHANGED":
            rows.append({"path": name, "status": status, "before": before.get(name), "after": after.get(name)})
    return rows


def commit_group(relative: str) -> str:
    value = relative.lower()
    if any(token in value for token in ["network-contract", "depot-assignment", "trip-chain", "pickup-custody", "dock-wave", "network-solver", "network-accounting", "secure-import"]):
        return "1"
    if any(token in value for token in ["network-execution", "energy-intelligence", "uncertainty", "decision-governance", "recovery", "execution", "offline-queue"]):
        return "2"
    if any(token in value for token in ["network-visualization", "network-command-center", "scenario-lab", "experience-v1", "v18_", "style.css", "index.html"]):
        return "3"
    return "4"


def sanitize_text(value: str, run_dir: pathlib.Path) -> str:
    replacements = [
        (str(REPO), "<REPO_ROOT>"),
        (str(run_dir), "<RUN_DIR>"),
        (str(pathlib.Path.home()), "<USER_HOME>"),
    ]
    for source, target in replacements:
        value = value.replace(source, target)
    value = re.sub(r"(?<!\\)file:///(?:Users|private/(?:tmp|var)|tmp)/[^\"'`\r\n<>\)\]\}]*", "<LOCAL_PATH>", value)
    value = re.sub(r"(?<!\\)/(?:Users|private/tmp|private/var|tmp)/[^\"'`\r\n<>\)\]\}]*", "<LOCAL_PATH>", value)
    return value


def copy_sanitized(source: pathlib.Path, destination: pathlib.Path, run_dir: pathlib.Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix.lower() in TEXT_SUFFIXES:
        destination.write_text(sanitize_text(source.read_text(encoding="utf-8", errors="replace"), run_dir), encoding="utf-8")
    else:
        shutil.copy2(source, destination)


def write_manifest(root: pathlib.Path, name: str = "MANIFEST.sha256") -> list[dict[str, object]]:
    rows = []
    for file in sorted(root.rglob("*")):
        if not file.is_file() or file.name == name:
            continue
        relative = file.relative_to(root).as_posix()
        rows.append({"path": relative, "size": file.stat().st_size, "sha256": sha256(file)})
    (root / name).write_text("".join(f"{row['sha256']}  {row['path']}\n" for row in rows), encoding="utf-8")
    return rows


def verify_manifest(root: pathlib.Path, name: str = "MANIFEST.sha256") -> bool:
    lines = (root / name).read_text(encoding="utf-8").splitlines()
    for line in lines:
        digest, relative = line.split("  ", 1)
        if pathlib.PurePosixPath(relative).is_absolute() or relative == name or not (root / relative).is_file() or sha256(root / relative) != digest:
            return False
    return True


def deterministic_zip(root: pathlib.Path, destination: pathlib.Path) -> None:
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file in sorted(root.rglob("*")):
            if not file.is_file():
                continue
            relative = file.relative_to(root).as_posix()
            if "__MACOSX" in pathlib.PurePosixPath(relative).parts or pathlib.PurePosixPath(relative).name.startswith("._"):
                continue
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, file.read_bytes())


def sidecar(path: pathlib.Path) -> pathlib.Path:
    result = path.with_name(path.name + ".sha256")
    result.write_text(f"{sha256(path)}  {path.name}\n", encoding="utf-8")
    return result


def zip_clean(path: pathlib.Path) -> bool:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
    return len(names) == len(set(names)) and all("__MACOSX" not in pathlib.PurePosixPath(name).parts and not pathlib.PurePosixPath(name).name.startswith("._") for name in names)


def build_source_evidence(run_dir: pathlib.Path, source_stage: pathlib.Path) -> dict[str, object]:
    source_stage.mkdir(parents=True)
    tracked = run(["git", "diff", "--binary", "--no-ext-diff", "--"]).stdout
    (source_stage / "TRACKED_DIFF.patch").write_text(tracked, encoding="utf-8")
    chunks = []
    for relative in run(["git", "ls-files", "--others", "--exclude-standard"]).stdout.splitlines():
        if relative:
            chunks.append(run(["git", "diff", "--no-index", "--binary", "--", "/dev/null", relative], allowed=(0, 1)).stdout)
    (source_stage / "UNTRACKED_DIFF.patch").write_text("".join(chunks), encoding="utf-8")
    head = run(["git", "rev-parse", "HEAD"]).stdout.strip()
    run(["git", "archive", "--format=zip", "-o", str(source_stage / "HEAD_SOURCE.zip"), head])
    manifest = source_manifest(REPO)
    (source_stage / "EXPECTED_SOURCE_MANIFEST.json").write_text(json.dumps({"head": head, "files": manifest}, indent=2) + "\n", encoding="utf-8")
    (source_stage / "README-SOURCE-RECONSTRUCTION.md").write_text(
        "# Source Reconstruction\n\n"
        "1. Extract `HEAD_SOURCE.zip` into a new empty directory.\n"
        "2. Run `git apply --binary TRACKED_DIFF.patch` from that directory.\n"
        "3. Run `git apply --binary UNTRACKED_DIFF.patch` from that directory.\n"
        "4. Recompute all non-generated source file SHA-256 values and compare them with `EXPECTED_SOURCE_MANIFEST.json`.\n"
        "5. Do not install dependencies or contact public routing/optimization services.\n",
        encoding="utf-8",
    )
    return {"head": head, "files": len(manifest)}


def build_dist(stage: pathlib.Path) -> dict[str, object]:
    html = (REPO / "index.html").read_text(encoding="utf-8")
    referenced = {
        match.split("?", 1)[0].removeprefix("./")
        for match in re.findall(r'(?:src|href)="([^"]+)"', html)
        if not re.match(r"^[a-z]+://", match)
    }
    whitelist = {
        "index.html", "NOTICE.md", "vendor/NOTICE.md", "DATA_CLASSIFICATION.md",
        "V18_ARCHITECTURE_DECISIONS.md", "V18_SECURITY_AND_LICENSE_BOUNDARY.md",
        "V18_FEATURE_EVIDENCE_MATRIX.md",
        "assets/demo/stct-synthetic-demo.json",
        "tests/fixtures/network-v18-fixture.js",
        "tests/smoke_release_v18.js",
        "tests/smoke_overnight_replay_v18.js",
        "tests/smoke_overnight_browser_v18.js",
        "tests/red_team_b_capsule_attacks_v18.js",
        "optimizer/network_contract_v18.py",
        "optimizer/network_solver_v18.py",
    }
    whitelist.update(relative for relative in referenced if relative != "templates/raw-dispatch-template.xlsx")
    whitelist.update(file.name for file in REPO.glob("*v18.js"))
    whitelist.update({"traceability-v18.js", "secure-import-v18.js"})
    copied = []
    for relative in sorted(whitelist):
        source = REPO / relative
        if source.is_file():
            destination = stage / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
            copied.append(relative)
    (stage / "README-DIST-V18-OVERNIGHT.md").write_text(
        "# STCT v1.8 Overnight Demo Distribution\n\n"
        "This is a local synthetic demonstration, not a production, certified, live-GPS, live-warehouse, or globally optimal system. "
        "Public routing and optimization calls are disabled. Run `node tests/smoke_overnight_replay_v18.js --root . --mode fallback` for a dependency-free local replay.\n",
        encoding="utf-8",
    )
    artifacts = stage / "artifacts"
    artifacts.mkdir()
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    release = run(
        ["node", "tests/smoke_overnight_replay_v18.js", "--root", ".", "--mode", "release", "--capsule-output", "artifacts/canonical-deep-capsule.json", "--html-output", "artifacts/no-webgl-reduced.html"],
        cwd=stage,
        env=env,
    )
    (artifacts / "release-smoke.json").write_text(release.stdout, encoding="utf-8")
    rows = write_manifest(stage)
    return {"whitelist": copied, "manifestRows": len(rows), "manifest": verify_manifest(stage), "release": json.loads(release.stdout)}


def build_corpus(run_dir: pathlib.Path, stage: pathlib.Path) -> dict[str, object]:
    catalog_source = run_dir / "STCT-v1.8-OVERNIGHT-SCENARIO-CATALOG.json"
    shutil.copy2(catalog_source, stage / catalog_source.name)
    scenarios = []
    for source in sorted((run_dir / "corpus/scenarios").glob("*.json")):
        value = json.loads(source.read_text(encoding="utf-8"))
        if value.get("dataClassification") != "SYNTHETIC":
            raise RuntimeError(f"Non-synthetic corpus entry: {source.name}")
        destination = stage / "scenarios" / source.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        scenarios.append({"path": f"scenarios/{source.name}", "sha256": sha256(destination)})
    catalog = json.loads(catalog_source.read_text(encoding="utf-8"))
    if catalog.get("dataClassification") != "SYNTHETIC" or catalog.get("originalExcelUsed") is not False:
        raise RuntimeError("Scenario catalog is not synthetic-only")
    rows = write_manifest(stage)
    return {"scenarioCount": len(scenarios), "manifestRows": len(rows), "manifest": verify_manifest(stage), "syntheticOnly": True}


def audit_sources(run_dir: pathlib.Path) -> list[tuple[pathlib.Path, pathlib.Path]]:
    rows: list[tuple[pathlib.Path, pathlib.Path]] = []
    root_names = [
        "Codex_Goal_STCT_Local_Demo_v1.8_OVERNIGHT_MARATHON.md",
        "STCT_v1.8_OVERNIGHT_Requirement_Registry.json",
        "STCT_v1.8_OVERNIGHT_Checkpoint_Template.json",
        "OVERNIGHT_EXECUTION_PLAN.md", "OVERNIGHT_PROGRESS.json", "OVERNIGHT_PROGRESS.md",
        "STCT-v1.8-OVERNIGHT-FINAL-REPORT.md", "STCT-v1.8-OVERNIGHT-CHAOS-SUMMARY.json",
        "STCT-v1.8-OVERNIGHT-RED-TEAM-A.md", "STCT-v1.8-OVERNIGHT-RED-TEAM-B.md",
        "STCT-v1.8-OVERNIGHT-PERFORMANCE.json", "STCT-v1.8-OVERNIGHT-SCENARIO-CATALOG.json",
        "STCT-v1.8-OVERNIGHT-DECISION-MEMO.md", "STCT-v1.8-OVERNIGHT-ARCHITECTURE-DECISIONS.md",
        "STCT-v1.8-OVERNIGHT-OPEN-SOURCE-INSPIRATION.md",
        "STCT-v1.8-OVERNIGHT-SOAK-SUMMARY.json", "STCT-v1.8-OVERNIGHT-SOAK-LOG.ndjson",
        "STCT-v1.8-OVERNIGHT-GATE-RESULTS.json", "STCT-v1.8-OVERNIGHT-TRACEABILITY.json",
        "STCT-v1.8-OVERNIGHT-MUTATION-SUMMARY.json",
    ]
    for name in root_names:
        source = run_dir / name
        if source.is_file():
            rows.append((source, pathlib.Path(name)))
    for source in sorted((run_dir / "checkpoints").glob("*.json")):
        rows.append((source, pathlib.Path("checkpoints") / source.name))
    for name in ["original-excel-inventory.json", "v17-artifact-inventory.json", "environment.json", "git-baseline.txt"]:
        source = run_dir / "baseline" / name
        if source.is_file():
            rows.append((source, pathlib.Path("baseline") / name))
    evidence_patterns = [
        "core-1067-final/STCT-v1.8-TEST-SUMMARY.json",
        "overnight-o*.json",
        "wave-h4-network-performance-raw-trace.json",
        "wave-h4-network-performance-semantic.json",
        "wave-h4-network-performance-browser.json",
        "o14a-network-performance-regression.json",
        "o13-traceability-regression.json",
    ]
    for pattern in evidence_patterns:
        for source in sorted((run_dir / "evidence").glob(pattern)):
            rows.append((source, pathlib.Path("evidence") / source.relative_to(run_dir / "evidence")))
    for directory in ["command-center-gate13", "visual-gate10", "o11-early-interruption-probe", "o11-failure-preservation-probe"]:
        for source in sorted((run_dir / "evidence" / directory).glob("*")):
            if source.is_file():
                rows.append((source, pathlib.Path("evidence") / directory / source.name))
    for name in ["stability-anchor.json", "resume-probe.json", "first-failure.json", "last-failure.json", "worst-performance-cycle.json"]:
        source = run_dir / "soak" / name
        if source.is_file():
            rows.append((source, pathlib.Path("soak") / name))
    o15 = run_dir / "evidence/overnight-o15-test.json"
    if o15.is_file():
        document = json.loads(o15.read_text(encoding="utf-8"))
        for replay in document.get("cleanRooms", []):
            index = replay.get("index")
            room = pathlib.Path(str(replay.get("directory", "")))
            output = room / "outputs"
            for source in sorted(output.rglob("*")) if output.is_dir() else []:
                if source.is_file() and source.suffix.lower() in {".html", ".json", ".png"}:
                    rows.append((source, pathlib.Path("clean-room-evidence") / f"replay-{index}" / source.relative_to(output)))
    unique: dict[str, tuple[pathlib.Path, pathlib.Path]] = {}
    for source, destination in rows:
        unique[destination.as_posix()] = (source, destination)
    return [unique[key] for key in sorted(unique)]


def scan_text(
    root: pathlib.Path,
    *,
    excluded_prefixes: tuple[str, ...] = (),
    excluded_names: frozenset[str] = frozenset(),
) -> dict[str, object]:
    local: list[dict[str, str]] = []
    secrets: list[dict[str, str]] = []
    scanned_files = 0
    for file in sorted(root.rglob("*")):
        if not file.is_file() or file.suffix.lower() not in TEXT_SUFFIXES:
            continue
        relative = file.relative_to(root).as_posix()
        if file.name in excluded_names or any(relative.startswith(prefix) for prefix in excluded_prefixes):
            continue
        scanned_files += 1
        value = file.read_text(encoding="utf-8", errors="replace")
        for match in re.findall(r"(?<!\\)(?:file://)?/(?:Users|private/tmp|private/var|tmp)/[^\"'`\r\n<>\)\]\}]*", value):
            local.append({"path": relative, "match": match})
        for match in SECRET_PATTERN.findall(value):
            secrets.append({"path": relative, "match": match[:12] + "..."})
    return {
        "scannedFiles": scanned_files,
        "noAbsolutePaths": not local,
        "absolutePathMatchCount": len(local),
        "absolutePathMatches": local[:10],
        "noSecrets": not secrets,
        "secretMatchCount": len(secrets),
        "secretMatches": secrets[:10],
    }


def inspect_exact_source_and_specs(root: pathlib.Path) -> dict[str, object]:
    files = [file for file in sorted((root / "source").rglob("*")) if file.is_file() and file.suffix.lower() in TEXT_SUFFIXES]
    files.extend(root / name for name in sorted(OFFICIAL_SPEC_NAMES) if (root / name).is_file())
    local: list[dict[str, str]] = []
    secrets: list[dict[str, str]] = []
    for file in files:
        relative = file.relative_to(root).as_posix()
        value = file.read_text(encoding="utf-8", errors="replace")
        for match in re.findall(r"(?<!\\)(?:file://)?/(?:Users|private/tmp|private/var|tmp)/[^\"'`\r\n<>\)\]\}]*", value):
            local.append({"path": relative, "match": match})
        for match in SECRET_PATTERN.findall(value):
            secrets.append({"path": relative, "match": match[:12] + "..."})
    return {
        "classification": "SOURCE_LITERAL_OR_OFFICIAL_SPEC",
        "filesInspected": len(files),
        "absolutePathLiteralCount": len(local),
        "absolutePathLiteralExamples": local[:10],
        "noSecretCandidates": not secrets,
        "secretCandidateCount": len(secrets),
        "secretCandidateExamples": secrets[:10],
        "note": "Exact reconstruction patches and official specifications are preserved byte-for-byte; path literals are classified separately from generated operational evidence.",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", default=str(DEFAULT_RUN))
    parser.add_argument("--phase", choices=["candidate", "final"], default="candidate")
    parser.add_argument("--output-dir")
    args = parser.parse_args()
    run_dir = pathlib.Path(args.run_dir).resolve()
    output = pathlib.Path(args.output_dir).resolve() if args.output_dir else run_dir / f"delivery-overnight-{args.phase}"
    staging = run_dir / "staging" / f"overnight-{args.phase}"
    reset_owned(output, run_dir)
    reset_owned(staging, run_dir)

    changes = changed_files(run_dir)
    groups = {key: [] for key in PROPOSED_NAMES}
    for row in changes:
        groups[commit_group(str(row["path"]))].append(str(row["path"]))
    for values in groups.values():
        values.sort()
    union = [relative for key in sorted(groups) for relative in groups[key]]
    if sorted(union) != sorted(str(row["path"]) for row in changes) or len(union) != len(set(union)):
        raise RuntimeError("Proposed commit manifests do not form an exact unique union")
    for key, name in PROPOSED_NAMES.items():
        (output / name).write_text("".join(f"{relative}\tKEEP\t保留\n" for relative in groups[key]), encoding="utf-8")
    disposition = [
        "# STCT v1.8 Overnight File Disposition",
        "",
        "| Path | Change | English action | 中文处理 |",
        "| --- | --- | --- | --- |",
    ]
    disposition.extend(f"| `{row['path']}` | {row['status']} | KEEP | 保留 |" for row in changes)
    (output / "FILE-DISPOSITION.md").write_text("\n".join(disposition) + "\n", encoding="utf-8")
    (output / "FINAL_CHANGED_FILE_MANIFEST.json").write_text(json.dumps({"changes": changes}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    dist_stage = staging / "demo-dist"
    audit_stage = staging / "audit"
    corpus_stage = staging / "corpus"
    dist_stage.mkdir()
    audit_stage.mkdir()
    corpus_stage.mkdir()
    dist_result = build_dist(dist_stage)
    corpus_result = build_corpus(run_dir, corpus_stage)
    source_result = build_source_evidence(run_dir, audit_stage / "source")
    for source, relative in audit_sources(run_dir):
        if relative.name in OFFICIAL_SPEC_NAMES:
            destination = audit_stage / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
        else:
            copy_sanitized(source, audit_stage / relative, run_dir)
    (audit_stage / "capsules").mkdir(parents=True, exist_ok=True)
    (audit_stage / "proposed-commits").mkdir(parents=True, exist_ok=True)
    shutil.copy2(dist_stage / "artifacts/canonical-deep-capsule.json", audit_stage / "capsules/canonical-deep-capsule.json")
    for name in PROPOSED_NAMES.values():
        shutil.copy2(output / name, audit_stage / "proposed-commits" / name)
    shutil.copy2(output / "FILE-DISPOSITION.md", audit_stage / "FILE-DISPOSITION.md")
    shutil.copy2(output / "FINAL_CHANGED_FILE_MANIFEST.json", audit_stage / "FINAL_CHANGED_FILE_MANIFEST.json")
    (audit_stage / "README-AUDIT-REPLAY.md").write_text(
        "# STCT v1.8 Overnight Audit Replay\n\n"
        "Verify `SHA256SUMS.txt`, reconstruct source from `source/`, validate the canonical deep Capsule read-only, "
        "compare traceability counts with executed assertions, and treat all performance, energy, carbon and uncertainty values as local synthetic evidence. "
        "No commit, push, deployment, dependency installation, public route service, or public optimizer call is required.\n",
        encoding="utf-8",
    )
    audit_rows = write_manifest(audit_stage, "SHA256SUMS.txt")
    operational_scan = scan_text(
        audit_stage,
        excluded_prefixes=("source/",),
        excluded_names=frozenset(OFFICIAL_SPEC_NAMES),
    )
    exact_inspection = inspect_exact_source_and_specs(audit_stage)
    if not all([
        dist_result["manifest"], corpus_result["manifest"],
        operational_scan["noAbsolutePaths"], operational_scan["noSecrets"],
        exact_inspection["noSecretCandidates"],
    ]):
        raise RuntimeError(json.dumps({
            "dist": dist_result,
            "corpus": corpus_result,
            "operationalArtifactScan": operational_scan,
            "exactSourceAndSpecInspection": exact_inspection,
        }, ensure_ascii=False))

    names = {
        "dist": "lospollos-v1.8-overnight-demo-dist.zip",
        "audit": "lospollos-v1.8-overnight-audit-bundle.zip",
        "corpus": "lospollos-v1.8-synthetic-scenario-corpus.zip",
    }
    packages = {}
    for key, stage in [("dist", dist_stage), ("audit", audit_stage), ("corpus", corpus_stage)]:
        archive = output / names[key]
        deterministic_zip(stage, archive)
        digest = sidecar(archive)
        packages[key] = {"path": archive.name, "sha256": sha256(archive), "size": archive.stat().st_size, "sidecar": digest.name, "zipClean": zip_clean(archive)}

    delivery = {
        "schemaVersion": "stct-v1.8-overnight-delivery-manifest-v1",
        "phase": args.phase,
        "status": "PASS",
        "whitelistBuilt": True,
        "source": source_result,
        "dist": dist_result,
        "audit": {
            "manifestRows": len(audit_rows),
            "manifest": verify_manifest(audit_stage, "SHA256SUMS.txt"),
            "operationalArtifactScan": operational_scan,
            "exactSourceAndSpecInspection": exact_inspection,
        },
        "corpus": corpus_result,
        "packages": packages,
        "changedFiles": len(changes),
        "commitManifestUnionExact": True,
        "externalActions": {"commit": 0, "push": 0, "deploy": 0, "dependencyInstall": 0, "binaryDownload": 0, "publicRouting": 0, "publicOptimizer": 0},
    }
    if not all(row["zipClean"] for row in packages.values()) or not delivery["audit"]["manifest"]:
        delivery["status"] = "FAIL"
    manifest_path = output / "DELIVERY_MANIFEST.json"
    manifest_path.write_text(json.dumps(delivery, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if delivery["status"] != "PASS":
        raise RuntimeError("Delivery package validation failed")
    print(json.dumps({"status": "PASS", "phase": args.phase, "output": str(output), "packages": packages, "distFiles": dist_result["manifestRows"], "auditFiles": len(audit_rows), "corpusFiles": corpus_result["manifestRows"], "changedFiles": len(changes)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
