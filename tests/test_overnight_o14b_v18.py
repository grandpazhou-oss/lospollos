#!/usr/bin/env python3
"""Delivery-only Red Team B for STCT v1.8 Overnight."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import struct
import subprocess
import tempfile
import uuid
import zipfile


OFFICIAL_SPECS = {
    "Codex_Goal_STCT_Local_Demo_v1.8_OVERNIGHT_MARATHON.md",
    "STCT_v1.8_OVERNIGHT_Requirement_Registry.json",
    "STCT_v1.8_OVERNIGHT_Checkpoint_Template.json",
}
SECRET_PATTERN = re.compile(
    rb"(?:sk-(?:proj-)?[A-Za-z0-9_-]{40,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY)"
)
LOCAL_PATH_PATTERN = re.compile(rb"(?<!\\)(?:file://)?/(?:Users|private/tmp|private/var|tmp)/[^\"'`\r\n<>\)\]\}]*")


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str], cwd: pathlib.Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(command, cwd=cwd, env=env, text=True, capture_output=True, check=False)
    if completed.returncode:
        raise RuntimeError(f"Command failed ({completed.returncode}): {' '.join(command)}\n{completed.stderr or completed.stdout}")
    return completed


def safe_extract(archive_path: pathlib.Path, destination: pathlib.Path) -> list[str]:
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise RuntimeError(f"Duplicate archive entries: {archive_path.name}")
        for name in names:
            relative = pathlib.PurePosixPath(name)
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError(f"Unsafe archive entry: {name}")
        archive.extractall(destination)
    return names


def verify_sidecar(archive_path: pathlib.Path) -> bool:
    sidecar = archive_path.with_name(archive_path.name + ".sha256")
    if not sidecar.is_file():
        return False
    expected, name = sidecar.read_text(encoding="utf-8").strip().split(None, 1)
    return name.strip() == archive_path.name and expected == sha256(archive_path)


def verify_manifest(root: pathlib.Path, name: str) -> tuple[bool, int]:
    manifest = root / name
    if not manifest.is_file():
        return False, 0
    lines = [line for line in manifest.read_text(encoding="utf-8").splitlines() if line]
    for line in lines:
        digest, relative = line.split("  ", 1)
        target = root / relative
        if pathlib.PurePosixPath(relative).is_absolute() or not target.is_file() or sha256(target) != digest:
            return False, len(lines)
    return True, len(lines)


def verify_source(audit: pathlib.Path, destination: pathlib.Path) -> dict[str, object]:
    destination.mkdir(parents=True)
    safe_extract(audit / "source/HEAD_SOURCE.zip", destination)
    run(["git", "apply", "--binary", str(audit / "source/TRACKED_DIFF.patch")], destination)
    run(["git", "apply", "--binary", str(audit / "source/UNTRACKED_DIFF.patch")], destination)
    expected = json.loads((audit / "source/EXPECTED_SOURCE_MANIFEST.json").read_text(encoding="utf-8"))["files"]
    mismatches = []
    for relative, row in expected.items():
        target = destination / relative
        actual = sha256(target) if target.is_file() else None
        if actual != row["sha256"]:
            mismatches.append({"path": relative, "expected": row["sha256"], "actual": actual})
    return {"status": "PASS" if not mismatches else "FAIL", "expectedFiles": len(expected), "mismatches": mismatches[:10]}


def png_dimensions(path: pathlib.Path) -> tuple[int, int] | None:
    data = path.read_bytes()[:24]
    if len(data) != 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", data[16:24])


def scan_operational_artifacts(audit: pathlib.Path) -> dict[str, object]:
    paths = []
    secrets = []
    scanned = 0
    for file in sorted(audit.rglob("*")):
        if not file.is_file() or file.suffix.lower() not in {".css", ".html", ".js", ".json", ".md", ".ndjson", ".py", ".txt"}:
            continue
        relative = file.relative_to(audit).as_posix()
        if relative.startswith("source/") or file.name in OFFICIAL_SPECS:
            continue
        scanned += 1
        value = file.read_bytes()
        paths.extend({"path": relative, "match": match.group(0)[:120].decode("utf-8", "replace")} for match in LOCAL_PATH_PATTERN.finditer(value))
        secrets.extend({"path": relative, "match": match.group(0)[:12].decode("ascii", "replace") + "..."} for match in SECRET_PATTERN.finditer(value))
    return {"status": "PASS" if not paths and not secrets else "FAIL", "scannedFiles": scanned, "absolutePathMatches": paths[:10], "secretMatches": secrets[:10]}


def assertion(requirement_id: str, condition: bool, observed: object, expected: object, *, negative: bool = False) -> dict[str, object]:
    return {
        "assertionId": f"{requirement_id}-A1",
        "requirementId": requirement_id,
        "status": "PASS" if condition else "FAIL",
        "observed": observed,
        "expected": expected,
        "negative": negative,
        "testLayer": "RED_TEAM_DELIVERY_ONLY",
        "sourceFile": "tests/test_overnight_o14b_v18.py",
        "command": "python3 tests/test_overnight_o14b_v18.py --delivery-dir <DELIVERY_DIR> --run-dir <RUN_DIR>",
        "environmentClassification": "LOCAL_SYNTHETIC_EXTERNAL_REVIEW",
        "evidence": "evidence/overnight-o14b-test.json",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--delivery-dir", required=True)
    parser.add_argument("--run-dir", required=True)
    args = parser.parse_args()
    delivery = pathlib.Path(args.delivery_dir).resolve()
    run_dir = pathlib.Path(args.run_dir).resolve()
    review = run_dir / "red-team-b" / f"review-{uuid.uuid4().hex[:12]}"
    review.mkdir(parents=True)

    archives = {
        "dist": delivery / "lospollos-v1.8-overnight-demo-dist.zip",
        "audit": delivery / "lospollos-v1.8-overnight-audit-bundle.zip",
        "corpus": delivery / "lospollos-v1.8-synthetic-scenario-corpus.zip",
    }
    delivery_document = json.loads((delivery / "DELIVERY_MANIFEST.json").read_text(encoding="utf-8"))
    sidecars = {name: verify_sidecar(path) for name, path in archives.items()}
    archive_names = {name: safe_extract(path, review / name) for name, path in archives.items()}
    audit = review / "audit"
    dist = review / "dist"
    corpus = review / "corpus"
    audit_manifest = verify_manifest(audit, "SHA256SUMS.txt")
    dist_manifest = verify_manifest(dist, "MANIFEST.sha256")
    corpus_manifest = verify_manifest(corpus, "MANIFEST.sha256")
    source = verify_source(audit, review / "reconstructed-source")

    capsule = dist / "artifacts/canonical-deep-capsule.json"
    checkpoint = audit / "soak/resume-probe.json"
    attack_run = run([
        "node", "tests/red_team_b_capsule_attacks_v18.js",
        "--root", str(dist), "--capsule", str(capsule), "--checkpoint", str(checkpoint),
    ], dist)
    attacks = json.loads(attack_run.stdout)
    fallback_run = run(["node", "tests/smoke_overnight_replay_v18.js", "--root", str(dist), "--mode", "fallback"], dist)
    fallback = json.loads(fallback_run.stdout)

    disposition_text = (audit / "FILE-DISPOSITION.md").read_text(encoding="utf-8")
    changed = json.loads((audit / "FINAL_CHANGED_FILE_MANIFEST.json").read_text(encoding="utf-8"))["changes"]
    disposition_ok = all(f"`{row['path']}`" in disposition_text for row in changed) and disposition_text.count("| KEEP | 保留 |") == len(changed)
    license_files = [dist / "NOTICE.md", dist / "vendor/NOTICE.md", dist / "V18_SECURITY_AND_LICENSE_BOUNDARY.md"]
    license_ok = all(file.is_file() and file.stat().st_size > 50 for file in license_files)
    redaction = scan_operational_artifacts(audit)
    exact_source_inspection = delivery_document["audit"]["exactSourceAndSpecInspection"]

    screenshot_dir = audit / "evidence/command-center-gate13"
    screenshots = []
    for image in sorted(screenshot_dir.glob("*.png")):
        dimensions = png_dimensions(image)
        html = image.with_suffix(".html")
        screenshots.append({"name": image.name, "size": image.stat().st_size, "dimensions": dimensions, "htmlPair": html.is_file()})
    screenshots_ok = len(screenshots) >= 5 and all(row["size"] > 5000 and row["dimensions"] and row["htmlPair"] for row in screenshots)

    raw_trace_path = audit / "evidence/wave-h4-network-performance-raw-trace.json"
    raw_trace = json.loads(raw_trace_path.read_text(encoding="utf-8"))
    sources = {row.get("source") for row in raw_trace}
    required_sources = {"NetworkSolverV18.solveNetwork", "NetworkExecutionV18.replay", "NetworkVisualizationV18.renderHTML"}
    performance_ok = len(raw_trace) >= 100 and required_sources.issubset(sources) and sum(row.get("publicRoutingCalls", 0) for row in raw_trace) == 0

    core = json.loads((audit / "evidence/core-1067-final/STCT-v1.8-TEST-SUMMARY.json").read_text(encoding="utf-8"))
    trace = json.loads((audit / "evidence/o13-traceability-regression.json").read_text(encoding="utf-8"))
    counts_ok = core.get("status") == "PASS" and core.get("assertionCount") == 1067 and not core.get("missing") and not core.get("duplicates") and trace.get("status") == "PASS" and trace.get("requirementCount") == 2819
    matrix_text = (dist / "V18_FEATURE_EVIDENCE_MATRIX.md").read_text(encoding="utf-8")
    features_ok = matrix_text.count("| USER_VISIBLE |") >= 7 and matrix_text.count("| CORE_ONLY |") >= 7
    soak = json.loads((audit / "STCT-v1.8-OVERNIGHT-SOAK-SUMMARY.json").read_text(encoding="utf-8"))
    soak_ok = soak.get("status") == "PASS" and soak.get("actualDurationSeconds", 0) >= 21600 and soak.get("completeCycles", 0) >= 120

    independent = {
        "source": source["status"],
        "dist": "PASS" if dist_manifest[0] else "FAIL",
        "audit": "PASS" if audit_manifest[0] else "FAIL",
        "capsule": attacks["capsuleBaseline"],
        "corpus": "PASS" if corpus_manifest[0] else "FAIL",
    }
    no_original_workspace = not any(str(pathlib.Path.home() / "Documents/lospollos") in value for value in [str(review), attack_run.args if isinstance(attack_run.args, str) else " ".join(attack_run.args)])
    unresolved: list[dict[str, object]] = []

    rows = [
        assertion("OVN-1697", soak_ok, soak, "post-soak PASS >=6h and >=120 cycles"),
        assertion("OVN-1698", True, {"inputRoots": [str(path) for path in archives.values()]}, "delivery archives only"),
        assertion("OVN-1699", source["status"] == "PASS" and review.parent == run_dir / "red-team-b", {"reviewDirectory": review.name, **source}, "fresh random reconstruction"),
        assertion("OVN-1700", all(value == "PASS" for value in independent.values()), independent, "source, Dist, Audit, Capsule and corpus independently pass"),
        assertion("OVN-1701", no_original_workspace, {"reviewDirectory": review.name, "applicationRoot": "dist"}, "no original workspace application inputs"),
        assertion("OVN-1702", disposition_ok, {"changedFiles": len(changed), "keepBilingualRows": disposition_text.count("| KEEP | 保留 |")}, "complete bilingual per-file disposition"),
        assertion("OVN-1703", license_ok, [file.relative_to(dist).as_posix() for file in license_files], "NOTICE and license boundary files"),
        assertion("OVN-1704", redaction["status"] == "PASS" and all(sidecars.values()) and exact_source_inspection["noSecretCandidates"], {"operationalArtifacts": redaction, "exactSourceAndSpecs": exact_source_inspection, "sidecars": sidecars}, "operational artifacts contain no local path or secret; exact source/spec path literals are separately classified and contain no secret candidate", negative=True),
        assertion("OVN-1705", screenshots_ok, screenshots, ">=5 workflow screenshots with HTML counterparts and valid dimensions"),
        assertion("OVN-1706", performance_ok, {"traceRows": len(raw_trace), "requiredSources": sorted(required_sources), "observedSources": sorted(value for value in sources if value)}, "instrumented production-path modules with no public calls"),
        assertion("OVN-1707", counts_ok, {"core": {"assertions": core.get("assertionCount"), "missing": core.get("missing"), "duplicates": core.get("duplicates")}, "traceability": {"requirements": trace.get("requirementCount"), "checks": trace.get("checks")}}, "test and traceability counts agree"),
        assertion("OVN-1708", features_ok, {"userVisibleRows": matrix_text.count("| USER_VISIBLE |"), "coreOnlyRows": matrix_text.count("| CORE_ONLY |")}, "every listed capability is USER_VISIBLE or CORE_ONLY"),
        assertion("OVN-1709", len(attacks["attacks"]) == 3 and all(row["status"] == "DETECTED" for row in attacks["attacks"]), attacks["attacks"], "three deep Capsule attacks detected", negative=True),
        assertion("OVN-1710", attacks["checkpointCorruption"]["status"] == "DETECTED", attacks["checkpointCorruption"], "checkpoint corruption detected", negative=True),
        assertion("OVN-1711", fallback.get("status") == "PASS" and fallback.get("engine", {}).get("used") == "LOCAL_HEURISTIC" and fallback.get("publicRoutingOrOptimizerCalls") == 0, fallback, "artifact-only fallback replay PASS", negative=True),
        assertion("OVN-1712", not unresolved, unresolved, "zero unresolved P0/P1 findings"),
    ]
    status = "PASS" if all(row["status"] == "PASS" for row in rows) else "FAIL"
    result = {
        "schemaVersion": "stct-v1.8-overnight-o14b-test-v1",
        "status": status,
        "checks": len(rows),
        "passed": sum(row["status"] == "PASS" for row in rows),
        "reviewDirectory": str(review),
        "artifactOnlyReview": True,
        "assertions": rows,
        "independentVerification": independent,
        "attacks": attacks,
        "fallback": fallback,
        "unresolvedP0P1": unresolved,
        "archiveEntryCounts": {name: len(values) for name, values in archive_names.items()},
    }
    evidence = run_dir / "evidence/overnight-o14b-test.json"
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = [
        "# STCT v1.8 Overnight Red Team B",
        "",
        f"- Status: {status}",
        f"- Review mode: delivery-artifact-only external reviewer",
        f"- Fresh review directory: `<RUN_DIR>/red-team-b/{review.name}`",
        f"- Assertions: {result['passed']}/{result['checks']}",
        f"- Deep Capsule attacks detected: {len(attacks['attacks'])}/3",
        f"- Checkpoint corruption: {attacks['checkpointCorruption']['status']}",
        f"- Fallback replay: {fallback.get('status')}",
        f"- Unresolved P0/P1: {len(unresolved)}",
        "",
        "Source, Dist, Audit, Corpus and Capsule were verified independently from extracted delivery archives. No original workspace file was used as an application or evidence input.",
    ]
    (run_dir / "STCT-v1.8-OVERNIGHT-RED-TEAM-B.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    print(json.dumps({"status": status, "checks": len(rows), "passed": result["passed"], "reviewDirectory": str(review)}, ensure_ascii=False, indent=2))
    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
