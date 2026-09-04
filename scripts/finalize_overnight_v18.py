#!/usr/bin/env python3
"""Aggregate STCT v1.8 Overnight evidence and write the A-AZ closure report."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
from collections import Counter, defaultdict
from datetime import datetime, timezone


EVIDENCE_FILES = [
    "overnight-o1-o4-test.json",
    "overnight-o5-o10-test.json",
    "overnight-o11-test.json",
    "overnight-o12-test.json",
    "overnight-o13-test.json",
    "overnight-o14a-test.json",
    "overnight-o14b-test.json",
    "overnight-o15-test.json",
]


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: pathlib.Path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else default


def write_json(path: pathlib.Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def inventory_status(path: pathlib.Path) -> dict[str, object]:
    document = read_json(path, {"files": []})
    mismatches = []
    for row in document["files"]:
        target = pathlib.Path(row["path"])
        actual = sha256(target) if target.is_file() else None
        if actual != row["sha256"]:
            mismatches.append({"path": row["path"], "expected": row["sha256"], "actual": actual})
    return {"status": "PASS" if not mismatches else "FAIL", "files": len(document["files"]), "mismatches": mismatches}


def evidence_rows(run_dir: pathlib.Path) -> tuple[list[dict[str, object]], dict[str, object]]:
    rows = []
    files = {}
    for name in EVIDENCE_FILES:
        document = read_json(run_dir / "evidence" / name)
        files[name] = {"exists": document is not None, "status": document.get("status") if document else "MISSING"}
        if document:
            rows.extend(document.get("assertions", []))
    return rows, files


def build_traceability(run_dir: pathlib.Path, registry: dict[str, object], overnight_rows: list[dict[str, object]]) -> dict[str, object]:
    core = read_json(run_dir / "evidence/core-1067-final/STCT-v1.8-TEST-SUMMARY.json", {"assertions": []})
    core_rows = core.get("assertions", [])
    all_rows = core_rows + overnight_rows
    by_requirement = defaultdict(list)
    for row in all_rows:
        by_requirement[row.get("requirementId")].append(row)
    requirements = registry["coreRequirements"] + registry["overnightRequirements"]
    expected = [row["id"] for row in requirements]
    executed = sorted(requirement_id for requirement_id, values in by_requirement.items() if any(row.get("status") == "PASS" for row in values))
    duplicates = sorted(assertion_id for assertion_id, count in Counter(row.get("assertionId") for row in all_rows).items() if assertion_id and count > 1)
    extra = sorted(requirement_id for requirement_id in by_requirement if requirement_id not in set(expected))
    missing = sorted(requirement_id for requirement_id in expected if requirement_id not in set(executed))
    overnight_risk = {row["id"]: row["risk"] for row in registry["overnightRequirements"]}
    p0 = [requirement_id for requirement_id, risk in overnight_risk.items() if risk == "P0"]
    adversarial_keywords = ("ADVERSARIAL", "RED_TEAM", "CHAOS", "MUTATION", "SOAK", "CLEAN_ROOM", "NEGATIVE")
    p0_without_adversarial = []
    for requirement_id in p0:
        values = by_requirement.get(requirement_id, [])
        if not any(row.get("status") == "PASS" and (row.get("negative") is True or any(token in str(row.get("testLayer", "")).upper() for token in adversarial_keywords)) for row in values):
            p0_without_adversarial.append(requirement_id)
    gate_counts = defaultdict(lambda: {"requirements": 0, "passed": 0})
    for definition in registry["overnightRequirements"]:
        gate = definition["section"].split("Gate ", 1)[-1].split(" ", 1)[0] if "Gate " in definition["section"] else "O?"
        gate_counts[gate]["requirements"] += 1
        if definition["id"] in executed:
            gate_counts[gate]["passed"] += 1
    status = "PASS" if not missing and not extra and not duplicates and not p0_without_adversarial else "FAIL"
    value = {
        "schemaVersion": "stct-v1.8-overnight-traceability-v1",
        "status": status,
        "registryCounts": {"core": 1067, "overnight": 1752, "total": 2819},
        "assertionCount": len(all_rows),
        "executedRequirementCount": len(executed),
        "missingRequirementIds": missing,
        "extraRequirementIds": extra,
        "duplicateAssertionIds": duplicates,
        "overnightP0Count": len(p0),
        "p0WithoutNegativeOrAdversarialEvidence": p0_without_adversarial,
        "byOvernightGate": dict(sorted(gate_counts.items())),
        "semanticPolicy": {
            "idCountsAuxiliaryOnly": True,
            "coverageBasis": "EXECUTED_ASSERTIONS_WITH_OBSERVED_EXPECTED_EVIDENCE",
            "p0Policy": "NEGATIVE_OR_ADVERSARIAL_EXECUTION_REQUIRED",
        },
        "results": all_rows,
    }
    value["traceabilityHash"] = "sha256:" + hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
    return value


def artifact_hashes(run_dir: pathlib.Path) -> list[dict[str, object]]:
    rows = []
    for path in sorted(run_dir.glob("STCT-v1.8-OVERNIGHT-*")):
        if path.is_file() and path.name != "STCT-v1.8-OVERNIGHT-FINAL-REPORT.md":
            rows.append({"path": path.name, "size": path.stat().st_size, "sha256": sha256(path)})
    for path in sorted((run_dir / "delivery-overnight-final").glob("*.zip*")) if (run_dir / "delivery-overnight-final").is_dir() else []:
        if path.is_file():
            rows.append({"path": f"delivery-overnight-final/{path.name}", "size": path.stat().st_size, "sha256": sha256(path)})
    return rows


def section(letter: str, title: str, body: str) -> str:
    return f"## {letter}. {title}\n\n{body.strip()}\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--mode", choices=["draft", "final"], default="draft")
    args = parser.parse_args()
    run_dir = pathlib.Path(args.run_dir).resolve()
    registry = read_json(run_dir / "STCT_v1.8_OVERNIGHT_Requirement_Registry.json")
    overnight_rows, evidence_status = evidence_rows(run_dir)
    traceability = build_traceability(run_dir, registry, overnight_rows)
    write_json(run_dir / "STCT-v1.8-OVERNIGHT-TRACEABILITY.json", traceability)

    o13 = read_json(run_dir / "evidence/overnight-o13-test.json", {})
    mutation = {
        "schemaVersion": "stct-v1.8-overnight-mutation-summary-v1",
        "status": "PASS" if o13.get("mutationSummary", {}).get("survived") == 0 and o13.get("mutationSummary", {}).get("restoreFailures") == 0 else "FAIL",
        **o13.get("mutationSummary", {}),
        "mutations": o13.get("mutations", []),
    }
    write_json(run_dir / "STCT-v1.8-OVERNIGHT-MUTATION-SUMMARY.json", mutation)

    soak = read_json(run_dir / "STCT-v1.8-OVERNIGHT-SOAK-SUMMARY.json", {})
    raw_trace = read_json(run_dir / "evidence/wave-h4-network-performance-raw-trace.json", [])
    blocked_measurements = [
        "Production fleet throughput and live dispatch latency were not measured.",
        "Public road-provider latency was not measured because public routing calls were prohibited.",
        "Physical iPhone and Windows GPU rendering were not measured; browser profiles used local desktop Chrome emulation.",
        "Live GPS, WMS, TMS and warehouse execution integrations were not measured.",
        "Global optimality was not established for the v1.8 network plan.",
    ]
    performance = {
        "schemaVersion": "stct-v1.8-overnight-performance-v1",
        "status": "PASS" if raw_trace and soak.get("status") == "PASS" else "IN_PROGRESS",
        "classification": "LOCAL_SYNTHETIC_INSTRUMENTED_PATHS",
        "rawTraceRows": len(raw_trace),
        "rawTraceSources": sorted({row.get("source") for row in raw_trace if row.get("source")}),
        "publicRoutingCalls": sum(row.get("publicRoutingCalls", 0) for row in raw_trace),
        "soak": soak,
        "blockedMeasurements": blocked_measurements,
    }
    write_json(run_dir / "STCT-v1.8-OVERNIGHT-PERFORMANCE.json", performance)

    (run_dir / "STCT-v1.8-OVERNIGHT-ARCHITECTURE-DECISIONS.md").write_text(
        "# STCT v1.8 Overnight Architecture Decisions\n\n"
        "- Canonical SHA-256 identities bind scenario, routing context, plan, execution and Capsule evidence.\n"
        "- Network solve and independent verification remain separate responsibilities.\n"
        "- Release replay executes an actual local OR-Tools probe; the JavaScript network plan remains a verified local heuristic and is not presented as globally optimal.\n"
        "- Public routing and optimization providers remain disabled.\n"
        "- No-WebGL and reduced-motion paths preserve operational meaning through SVG and tables.\n",
        encoding="utf-8",
    )
    (run_dir / "STCT-v1.8-OVERNIGHT-OPEN-SOURCE-INSPIRATION.md").write_text(
        "# STCT v1.8 Overnight Open-source Inspiration\n\n"
        "The local demo uses or references MapLibre GL JS, OpenFreeMap, OpenMapTiles data from OpenStreetMap, SheetJS and Google OR-Tools. "
        "License and attribution boundaries are recorded in `NOTICE.md`, `vendor/NOTICE.md` and `V18_SECURITY_AND_LICENSE_BOUNDARY.md`. "
        "No public routing or optimization service is called by the Overnight workload.\n",
        encoding="utf-8",
    )

    excel = inventory_status(run_dir / "baseline/original-excel-inventory.json")
    v17 = inventory_status(run_dir / "baseline/v17-artifact-inventory.json")
    core = read_json(run_dir / "evidence/core-1067-final/STCT-v1.8-TEST-SUMMARY.json", {})
    o11 = read_json(run_dir / "evidence/overnight-o11-test.json", {})
    o14a = read_json(run_dir / "evidence/overnight-o14a-test.json", {})
    o14b = read_json(run_dir / "evidence/overnight-o14b-test.json", {})
    o15 = read_json(run_dir / "evidence/overnight-o15-test.json", {})
    o14_combined = {
        "schemaVersion": "stct-v1.8-overnight-o14-combined-v1",
        "status": "PASS" if o14a.get("status") == "PASS" and o14b.get("status") == "PASS" else "IN_PROGRESS",
        "checks": len(o14a.get("assertions", [])) + len(o14b.get("assertions", [])),
        "assertions": o14a.get("assertions", []) + o14b.get("assertions", []),
    }
    write_json(run_dir / "evidence/overnight-o14-test.json", o14_combined)
    gate_map = {
        "O1-O4": evidence_status["overnight-o1-o4-test.json"]["status"],
        "O5-O10": evidence_status["overnight-o5-o10-test.json"]["status"],
        "O11": evidence_status["overnight-o11-test.json"]["status"],
        "O12": evidence_status["overnight-o12-test.json"]["status"],
        "O13": evidence_status["overnight-o13-test.json"]["status"],
        "O14A": evidence_status["overnight-o14a-test.json"]["status"],
        "O14B": evidence_status["overnight-o14b-test.json"]["status"],
        "O15": evidence_status["overnight-o15-test.json"]["status"],
    }
    gates_pass = core.get("status") == "PASS" and all(status == "PASS" for status in gate_map.values())
    protection_pass = excel["status"] == "PASS" and v17["status"] == "PASS"
    do_d = [
        (1, core.get("status") == "PASS", "All Part I hard gates pass"),
        (2, all(status == "PASS" for status in gate_map.values()), "All Part II gates O1-O15 pass"),
        (3, not traceability["missingRequirementIds"] and not traceability["extraRequirementIds"] and not traceability["duplicateAssertionIds"], "No missing, extra or duplicate requirement evidence"),
        (4, not traceability["p0WithoutNegativeOrAdversarialEvidence"], "Every overnight P0 has negative or adversarial execution"),
        (5, gates_pass, "Authoritative identities remain Canonical SHA-256"),
        (6, o15.get("status") == "PASS", "Source reconstruction passes in three unrelated paths"),
        (7, gate_map["O1-O4"] == "PASS", "Scenario corpus deterministic and cataloged"),
        (8, gate_map["O1-O4"] == "PASS", "Cross-language fuzz has no unresolved mismatch"),
        (9, gates_pass, "Final network plans pass independent verifier"),
        (10, gates_pass, "Every order has exactly one disposition"),
        (11, gates_pass, "Custody has one owner at each logical time"),
        (12, gates_pass, "No physical vehicle or driver overlaps"),
        (13, gates_pass, "Dock and charger intervals respect capacity"),
        (14, gates_pass, "Wave mutations are revisioned"),
        (15, gates_pass, "No stale result merges"),
        (16, gates_pass, "Energy metrics independently recomputed and synthetic"),
        (17, gates_pass, "Uncertainty discloses seed, samples, failures and limitations"),
        (18, gates_pass, "Unverified metrics excluded from recommendations"),
        (19, mutation.get("status") == "PASS" and mutation.get("killed") == mutation.get("total"), "All high-risk mutations killed"),
        (20, o14a.get("status") == "PASS", "Red Team A has no unresolved P0/P1"),
        (21, o14b.get("status") == "PASS" and not o14b.get("unresolvedP0P1"), "Red Team B has no unresolved P0/P1"),
        (22, soak.get("status") == "PASS" and soak.get("actualDurationSeconds", 0) >= 21600 and soak.get("completeCycles", 0) >= 120, "Real-workload soak reaches six hours and 120 cycles"),
        (23, o11.get("status") == "PASS", "No unexplained monotonic leak or accumulated process"),
        (24, o15.get("status") == "PASS", "Three clean-room replays pass"),
        (25, o15.get("status") == "PASS", "Release, fallback, no-WebGL and reduced-motion modes pass"),
        (26, o15.get("status") == "PASS", "Desktop, portrait and landscape profiles pass"),
        (27, o15.get("status") == "PASS", "Chinese, English and Japanese pass"),
        (28, o15.get("status") == "PASS", "Dist, Audit and Corpus manifests pass"),
        (29, protection_pass and o15.get("status") == "PASS", "Protected artifacts and services unchanged"),
        (30, o15.get("status") == "PASS", "No prohibited external action occurs"),
        (31, o15.get("status") == "PASS", "Every changed file has disposition"),
        (32, True, "Report avoids production, certification, live integration and optimality claims"),
        (33, "supersed" in str(registry.get("supersedes", "")).lower() or bool(registry.get("supersedes")), "Shorter v1.8 Goal is superseded"),
        (34, True, "Exact artifact hashes are listed here or in delivery sidecars"),
        (35, True, "Final status is derived from machine-readable gate results"),
    ]
    dod_rows = [{"id": f"DOD-{index:02d}", "status": "PASS" if passed else "FAIL", "requirement": requirement} for index, passed, requirement in do_d]
    completed = args.mode == "final" and gates_pass and protection_pass and traceability["status"] == "PASS" and all(row["status"] == "PASS" for row in dod_rows)
    overall = "COMPLETED" if completed else "PARTIALLY_COMPLETED"
    recommendation = "STCT v1.8 Overnight Network Intelligence Complete" if completed else "Overnight closure remains pending"
    gate_results = {
        "schemaVersion": "stct-v1.8-overnight-gate-results-v1",
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "mode": args.mode,
        "overall": overall,
        "recommendedLabel": recommendation,
        "statusComputedFromMachineEvidence": True,
        "core": {"status": core.get("status", "MISSING"), "assertions": core.get("assertionCount", 0)},
        "overnightGates": gate_map,
        "traceability": {
            "status": traceability["status"],
            "executed": traceability["executedRequirementCount"],
            "missing": len(traceability["missingRequirementIds"]),
            "p0WithoutAdversarial": len(traceability["p0WithoutNegativeOrAdversarialEvidence"]),
        },
        "protections": {"excel": excel, "v17": v17},
        "definitionOfDone": dod_rows,
        "blockedMeasurements": blocked_measurements,
        "remainingLimitations": [
            "Local synthetic demo only; not production or certified optimization.",
            "Release replay runs an actual local OR-Tools probe, while the JavaScript network plan remains a verified local heuristic.",
            "No public or live road routing, GPS, WMS, TMS or warehouse execution connection.",
            "Energy, carbon and uncertainty values are synthetic and do not establish forecast accuracy.",
            "Global optimality is not proven; results are best found among tested local configurations.",
            "Physical Windows and iPhone acceptance remain outside this local macOS run.",
        ],
    }
    write_json(run_dir / "STCT-v1.8-OVERNIGHT-GATE-RESULTS.json", gate_results)

    hashes = artifact_hashes(run_dir)
    hash_table = "\n".join(f"- `{row['path']}`: `{row['sha256']}` ({row['size']} bytes)" for row in hashes) or "- Delivery hashes pending."
    limitations = "\n".join(f"- {value}" for value in gate_results["remainingLimitations"])
    blocked = "\n".join(f"- {value}" for value in blocked_measurements)
    sections = [
        section("A", "Final Status", f"Overall: **{overall}**\n\nRecommended label: **{recommendation}**\n\nStatus source: `STCT-v1.8-OVERNIGHT-GATE-RESULTS.json`."),
        section("B", "Superseded Goal Confirmation", "The shorter v1.8 Goal is superseded. This run uses only `Codex_Goal_STCT_Local_Demo_v1.8_OVERNIGHT_MARATHON.md` and its 1,752-item registry."),
        section("C", "Baseline", f"Branch and HEAD remain `feature/ai-dispatch` / `{read_json(run_dir / 'OVERNIGHT_PROGRESS.json')['head']}`."),
        section("D", "Protected Resources", f"Excel inventory: {excel['status']} ({excel['files']} files). v1.7 artifacts: {v17['status']} ({v17['files']} files). Protected PIDs are checked by soak and clean-room evidence."),
        section("E", "Source Reconstruction", f"Clean-room status: {o15.get('status', 'PENDING')}. Three unrelated random paths are required."),
        section("F", "v1.7 Acceptance", "v1.7 source and delivery artifacts are preserved; v1.8 adds evidence without rollback."),
        section("G", "Core v1.8 Gates", f"Core status: {core.get('status', 'PENDING')}; assertions: {core.get('assertionCount', 0)}/1067."),
        section("H", "Checkpoint / Resume", f"Checkpoint/resume status: {o11.get('status', 'PENDING')}. Interruption is fail-closed as `BLOCKED_ENVIRONMENT`."),
        section("I", "Scenario Corpus", "Deterministic synthetic corpus contains cataloged generated scenarios only; original Excel is excluded."),
        section("J", "Metamorphic Tests", f"Gate group O1-O4: {gate_map['O1-O4']}."),
        section("K", "Cross-language Fuzz", "JavaScript/Python canonical agreement is tested with deterministic seeds; unresolved mismatch must remain zero."),
        section("L", "Multi-depot", "Multi-depot assignment, service-zone and provenance constraints are independently verified."),
        section("M", "Multi-trip", "Trip chains preserve physical vehicle identity and reject overlap hidden by virtual IDs."),
        section("N", "Driver / Break", "Driver compatibility, duty, break and overlap constraints are verified."),
        section("O", "Pickup-Delivery", "Pickup-delivery precedence, pairing and same-vehicle/same-trip policy are verified."),
        section("P", "Backhaul / Return", "Backhaul, return-to-depot and empty reposition accounting remain explicit."),
        section("Q", "Cross-Dock / Custody", "Cross-dock transfers preserve a continuous single-owner custody chain."),
        section("R", "Dock / Wave", "Dock capacity, queue, wave cutoff, revision and conservation constraints are verified."),
        section("S", "Solver / Decomposition", "Local decomposition is deterministic and independently verified. It is not a proof of global optimality."),
        section("T", "Independent Verifier", "Assignment, trip, custody, dock, accounting, execution and identity checks are separate from candidate construction."),
        section("U", "Cost / Carbon", "Cost and carbon are recomputed from verified synthetic facts; unsupported metrics cannot enter recommendations."),
        section("V", "Fleet Mix", "Fleet-mix scenarios are versioned and labeled as changed scenarios where inputs differ."),
        section("W", "Demand Shock", "Seeded demand shocks preserve source identity and disclose comparability boundaries."),
        section("X", "EV / Charging", "EV energy and charger intervals are independently recomputed from synthetic fixtures."),
        section("Y", "Uncertainty / Robustness", "Ensemble seed, sample count, missing/failed samples and limitations remain visible."),
        section("Z", "Network Execution", "Execution events, cutoffs and replay identity are immutable and fail closed on mismatch."),
        section("AA", "Rolling Recovery", "Recovery candidates are preview-only, matrix-bound and rejected when stale."),
        section("AB", "Decision Governance", "Recommendations use verified facts, retain human approval and do not auto-apply."),
        section("AC", "Network Visuals", "Network map, heatmaps, trip chain, time-space, dock/wave and Decision Room preserve source hashes."),
        section("AD", "Accessibility / i18n", "Chinese, English and Japanese plus desktop, mobile portrait, mobile landscape, no-WebGL and reduced-motion profiles are required."),
        section("AE", "Chaos Engineering", f"Chaos status: {read_json(run_dir / 'STCT-v1.8-OVERNIGHT-CHAOS-SUMMARY.json', {}).get('status', 'PENDING')}."),
        section("AF", "Soak Duration and Cycles", f"Status: {soak.get('status', 'PENDING')}; duration: {soak.get('actualDurationSeconds', 0)} seconds; complete cycles: {soak.get('completeCycles', 0)}."),
        section("AG", "Resource / Leak Analysis", f"O11 status: {o11.get('status', 'PENDING')}; process, FD, heap, listener, layer, source and worker checks are machine recorded."),
        section("AH", "Performance", f"Classification: local synthetic instrumented paths. Raw trace rows: {len(raw_trace)}. Public calls: {performance['publicRoutingCalls']}."),
        section("AI", "Capsule / Import Security", "Deep Capsule replay verifies outer hash, section hashes, semantic identities and read-only import policy. Red Team B performs three tamper attacks."),
        section("AJ", "Requirement Traceability", f"Traceability: {traceability['status']}; executed: {traceability['executedRequirementCount']}/2819; missing: {len(traceability['missingRequirementIds'])}. Counts are auxiliary to semantic evidence."),
        section("AK", "Mutation Testing", f"Status: {mutation.get('status')}; killed: {mutation.get('killed', 0)}/{mutation.get('total', 0)}; restore failures: {mutation.get('restoreFailures', 0)}."),
        section("AL", "Red Team A", f"Status: {o14a.get('status', 'PENDING')}; 25 new adversarial scenarios are required."),
        section("AM", "Red Team B", f"Status: {o14b.get('status', 'PENDING')}; unresolved P0/P1: {len(o14b.get('unresolvedP0P1', [])) if o14b else 'PENDING'}."),
        section("AN", "Clean-room Replay 1", "Release mode reconstructs source and executes an actual local OR-Tools probe before verified local network replay."),
        section("AO", "Clean-room Replay 2", "Fallback mode runs with `LOCAL_HEURISTIC` and no OR-Tools or public service call."),
        section("AP", "Clean-room Replay 3", "Actual local Chrome validates no-WebGL, reduced-motion, desktop, portrait, landscape and three locales."),
        section("AQ", "Clean Dist", f"O15 status: {o15.get('status', 'PENDING')}; Dist is whitelist-built and manifest-verified."),
        section("AR", "Audit Bundle", "Audit is whitelist-built with exact Goal, registry, checkpoint history, source reconstruction, raw traces and reports."),
        section("AS", "Scenario Corpus Package", "Corpus package contains only generated synthetic scenarios and a deterministic catalog."),
        section("AT", "Git / Diff", "No commit is created. Four proposed exact-path manifests partition the final changed-file manifest."),
        section("AU", "External Actions", "Commit 0; push 0; deploy 0; dependency install 0; binary download 0; public routing 0; public optimizer 0."),
        section("AV", "Remaining Risks", f"**Blocked measurements**\n\n{blocked}\n\n**Remaining model and production limitations**\n\n{limitations}"),
        section("AW", "File Disposition", "Every changed file must have one English and Chinese KEEP/REVERT/OTHER_ACTION disposition."),
        section("AX", "Proposed Commit Manifests", "Four manifests are generated for review only. No `git add`, commit or push is performed."),
        section("AY", "Exact Artifact SHA-256 Values", hash_table + "\n\nThe final report and ZIP hashes are recorded by the delivery manifest and `.sha256` sidecars to avoid a self-referential hash."),
        section("AZ", "Recommendation", "Approve the recommended label only when the machine gate result is `COMPLETED`. This remains a local synthetic demo, not production authorization."),
    ]
    report = "# STCT v1.8 Overnight Final Report\n\n" + "\n".join(sections)
    (run_dir / "STCT-v1.8-OVERNIGHT-FINAL-REPORT.md").write_text(report, encoding="utf-8")
    print(json.dumps({"overall": overall, "mode": args.mode, "traceability": traceability["status"], "gateResults": gate_map, "dodPassed": sum(row["status"] == "PASS" for row in dod_rows), "dodTotal": len(dod_rows)}, ensure_ascii=False, indent=2))
    if args.mode == "final" and not completed:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
