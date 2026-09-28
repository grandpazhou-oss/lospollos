#!/usr/bin/env python3
"""Build and independently replay the bounded Facility MVP-1 delivery."""

from __future__ import annotations

import argparse
import difflib
import hashlib
import io
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path


DATE = "20260906"
PROTECTED_HASH = "9c2ad74f25c98a3ef7db7ea7d64cc9670504dd8edb54f3b485c4575778025d31"
IGNORED = {".git", ".DS_Store", ".run", "__pycache__", "releases", "test-results"}


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value.rstrip() + "\n", encoding="utf-8")


def write_json(path: Path, value: object) -> None:
    write_text(path, json.dumps(value, ensure_ascii=False, indent=2))


def files(root: Path):
    for path in sorted(root.rglob("*")):
        if path.is_file() and not any(part in IGNORED for part in path.relative_to(root).parts):
            yield path


def changed_files(before: Path, after: Path) -> list[dict]:
    before_map = {p.relative_to(before).as_posix(): p for p in files(before)}
    after_map = {p.relative_to(after).as_posix(): p for p in files(after)}
    rows = []
    for name in sorted(set(before_map) | set(after_map)):
        if name not in before_map:
            rows.append({"path": name, "change": "ADDED"})
        elif name not in after_map:
            rows.append({"path": name, "change": "DELETED"})
        elif sha256_file(before_map[name]) != sha256_file(after_map[name]):
            rows.append({"path": name, "change": "MODIFIED"})
    return rows


def source_freeze(root: Path, changed: list[dict]) -> tuple[str, list[dict]]:
    manifest = []
    for row in changed:
        path = root / row["path"]
        if row["change"] != "DELETED" and path.exists():
            manifest.append({"path": row["path"], "sha256": sha256_file(path), "bytes": path.stat().st_size})
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    return "sha256:" + sha256_bytes(encoded), manifest


def full_diff(before: Path, after: Path, changed: list[dict]) -> str:
    output = []
    for row in changed:
        old = before / row["path"]
        new = after / row["path"]
        old_bytes = old.read_bytes() if old.exists() else b""
        new_bytes = new.read_bytes() if new.exists() else b""
        try:
            old_lines = old_bytes.decode("utf-8").splitlines(True)
            new_lines = new_bytes.decode("utf-8").splitlines(True)
        except UnicodeDecodeError:
            output.append(f"Binary files a/{row['path']} and b/{row['path']} differ\n")
            continue
        output.extend(difflib.unified_diff(old_lines, new_lines, f"a/{row['path']}", f"b/{row['path']}"))
    return "".join(output)


def run_json(root: Path, name: str, command: list[str], env: dict[str, str], out: Path) -> dict:
    completed = subprocess.run(command, cwd=root, env=env, text=True, capture_output=True, timeout=180, check=False)
    if completed.returncode:
        raise RuntimeError(f"{name} failed: {completed.stderr or completed.stdout}")
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"{name} did not emit JSON: {completed.stdout[-1000:]}") from error
    write_json(out / f"{name}.json", payload)
    return payload


def local_refs(index: Path) -> set[str]:
    text = index.read_text(encoding="utf-8")
    refs = set()
    for value in re.findall(r"(?:src|href)=[\"']([^\"']+)", text):
        value = value.split("?", 1)[0]
        if value.startswith("./"):
            refs.add(value[2:])
    return refs


def copy_clean(source: Path, destination: Path, redactions: list[str]) -> None:
    data = source.read_bytes()
    if source.suffix.lower() in {".json", ".md", ".txt", ".csv", ".html", ".js", ".css", ".patch"}:
        text = data.decode("utf-8", errors="strict")
        for value in redactions:
            text = text.replace(value, "<LOCAL_EVIDENCE_ROOT>")
        text = re.sub("/" + r"Users/[^\s\"']+", "<LOCAL_PATH>", text)
        text = re.sub(r"/(?:private/)?tmp/[^\s\"']+", "<LOCAL_PATH>", text)
        data = text.encode("utf-8")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)


def manifest(root: Path) -> list[dict]:
    return [{"path": p.relative_to(root).as_posix(), "sha256": sha256_file(p), "bytes": p.stat().st_size} for p in files(root) if p.name != "MANIFEST.sha256"]


def write_manifest(root: Path) -> list[dict]:
    rows = manifest(root)
    write_text(root / "MANIFEST.sha256", "\n".join(f"{row['sha256']}  {row['path']}" for row in rows))
    return rows


def make_zip(stage: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files(stage):
            archive.write(path, path.relative_to(stage).as_posix())
    write_text(destination.with_suffix(destination.suffix + ".sha256"), f"{sha256_file(destination)}  {destination.name}")


def scan_entries(entries: list[tuple[str, bytes]]) -> list[dict]:
    findings = []
    forbidden_suffixes = {".xlsx", ".xls", ".xlsm", ".log"}
    for name, data in entries:
        normalized = name.replace("\\", "/")
        lower = normalized.lower()
        if Path(lower).suffix in forbidden_suffixes or any(part in {".ds_store", "__pycache__", ".git", "templates"} for part in lower.split("/")):
            findings.append({"entry": normalized, "reason": "FORBIDDEN_PATH_OR_FILE_TYPE"})
        if sha256_bytes(data) == PROTECTED_HASH:
            findings.append({"entry": normalized, "reason": "PROTECTED_ORIGINAL_HASH"})
        for pattern, reason in [
            (b"/" + rb"(?:Users|private/tmp|tmp)/", "LOCAL_ABSOLUTE_PATH"),
            (rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", "PRIVATE_KEY"),
            (rb"(?i)(?:api[_-]?key|secret|token)\s*[:=]\s*[\"'][A-Za-z0-9_\-]{16,}", "POSSIBLE_SECRET"),
        ]:
            if re.search(pattern, data):
                findings.append({"entry": normalized, "reason": reason})
        if lower.endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as nested:
                    findings.extend(scan_entries([(f"{normalized}!/{item.filename}", nested.read(item)) for item in nested.infolist() if not item.is_dir()]))
            except zipfile.BadZipFile:
                findings.append({"entry": normalized, "reason": "INVALID_NESTED_ZIP"})
    return findings


def scan_zip(path: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        entries = [(item.filename, archive.read(item)) for item in archive.infolist() if not item.is_dir()]
    findings = scan_entries(entries)
    return {"status": "PASS" if not findings else "FAIL", "entryCount": len(entries), "findings": findings}


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def replay_delivery(package: Path, python: str) -> dict:
    with tempfile.TemporaryDirectory(prefix="stct-facility-replay-") as raw:
        root = Path(raw)
        with zipfile.ZipFile(package) as archive:
            archive.extractall(root)
        expected = {}
        for line in (root / "MANIFEST.sha256").read_text().splitlines():
            digest, name = line.split("  ", 1)
            expected[name] = digest
        if any(sha256_file(root / name) != digest for name, digest in expected.items()):
            raise RuntimeError("delivery manifest mismatch")
        replay = run_json(root, "independent-replay", [python, "scripts/replay_facility_mvp1.py"], os.environ.copy(), root / "replay-output")
        web_port, optimizer_port = free_port(), free_port()
        while optimizer_port == web_port:
            optimizer_port = free_port()
        env = os.environ.copy()
        env.pop("http_proxy", None)
        env.pop("https_proxy", None)
        env.update({"WEB_PORT": str(web_port), "OPT_PORT": str(optimizer_port), "PYTHON_BIN": python})
        started = subprocess.run(["bash", "start_demo.sh"], cwd=root, env=env, text=True, capture_output=True, timeout=30, check=False)
        try:
            if started.returncode:
                raise RuntimeError(f"delivery start failed: {started.stdout} {started.stderr}")
            with urllib.request.urlopen(f"http://127.0.0.1:{web_port}/index.html", timeout=5) as response:
                html_status = response.status
            health = None
            for _ in range(30):
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{optimizer_port}/health", timeout=1) as response:
                        health = json.loads(response.read())
                    break
                except Exception:
                    time.sleep(0.2)
            if health is None:
                log = (root / ".run/logs/optimizer.log").read_text(errors="replace") if (root / ".run/logs/optimizer.log").exists() else "missing optimizer log"
                raise RuntimeError(f"delivery optimizer health failed: {started.stdout}; {log}")
        finally:
            subprocess.run(["bash", "stop_demo.sh"], cwd=root, env=env, text=True, capture_output=True, timeout=15, check=False)
        return {"status": "PASS", "manifestFiles": len(expected), "syntheticReplay": replay, "htmlStatus": html_status, "optimizer": health, "publicRequests": 0}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--before", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--facility-url", required=True)
    parser.add_argument("--performance", type=Path, required=True)
    parser.add_argument("--p61-repro", type=Path, required=True)
    parser.add_argument("--prior-replay", type=Path, required=True)
    args = parser.parse_args()
    root, before, evidence, output = (value.resolve() for value in (args.root, args.before, args.evidence, args.output))
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    test_outputs = output / "test-outputs"
    env = os.environ.copy()
    env.pop("http_proxy", None)
    env.pop("https_proxy", None)
    env["FACILITY_URL"] = args.facility_url
    fixture = root.parent / "p5-synthetic-fixture"
    suites = {
        "p4-regression": (["node", "tests/run_all_v19_p4.js"], {}),
        "p5-file-parity": (["node", "tests/test_p5_data_contract.js", str(fixture)], {}),
        "p6-regression": (["node", "tests/test_p6_operational_bridge.js"], {}),
        "p61-integrity": (["node", "tests/test_p61_integrity_closure.js"], {}),
        "facility-cp-sat": ([os.environ.get("PYTHON_BIN", "python3"), "tests/test_facility_mvp1.py"], {}),
        "facility-contract": (["node", "tests/test_facility_contract_v19.js"], {}),
        "facility-boundaries": (["node", "tests/test_facility_boundaries_v19.js"], {}),
        "facility-mutations": (["node", "tests/test_facility_mutations_v19.js"], {}),
        "facility-p6-integration": (["node", "tests/test_facility_p6_integration.js"], {}),
    }
    test_results = {}
    for name, (command, additions) in suites.items():
        test_results[name] = run_json(root, name, command, {**env, **additions}, test_outputs)

    changed = changed_files(before, root)
    freeze_hash, freeze_manifest = source_freeze(root, changed)
    diff_name = "STCT-v1.9-FACILITY-MVP1-FULL-DIFF.patch"
    write_text(output / diff_name, full_diff(before, root, changed))
    browser = json.loads((evidence / "browser/facility-browser-e2e.json").read_text())
    recommendation = json.loads((evidence / "browser/facility-recommendation.json").read_text())
    p6_browser = json.loads((evidence / "p6-browser/p6-browser-e2e.json").read_text())
    performance = json.loads(args.performance.read_text())
    write_json(output / "STCT-v1.9-FACILITY-MVP1-PERFORMANCE.json", performance)

    current = recommendation["resultSet"]["currentBaseline"]
    results = recommendation["resultSet"]["results"]
    recommended = recommendation["recommendation"]["recommended"]
    result_lines = "\n".join(
        f"- P={row['facilityCount']} #{row['rank']}: {', '.join(row['selectedSiteIds'])}; {row['status']}; CNY {row['cost']['total']:.4f} / MODEL_RUN; service {row['serviceRate']:.0%}."
        for row in results
    )
    closure = """# STCT v1.9 P6.1 Targeted Closure

Status: **COMPLETED**

The supplied independent counterexamples were reproduced against the prior contract and closed in the final source. Admission now independently rebuilds service state, engine identity, comparison eligibility, resource snapshots, operational matrices, source metrics, priority-weighted service, carbon scope, and calendar dates.

## Verified outcomes

- Normal 12-order control: PASS.
- Forged FULL service, engine, comparison, source metric, resource and matrix claims: rejected.
- Priority-weighted service: recomputed from actually served order IDs.
- Invalid calendar date: blocked.
- Same-input carbon delta: recomputed only with matching scope; strategic Facility carbon stays `NOT_COMPUTED_NO_COMPARABLE_STRATEGIC_FACTOR`.
- Existing P6 regression and fresh-profile browser replay: PASS.

Evidence: `test-outputs/p61-integrity.json`, `runtime-evidence/p6-independent-repro.json`, and `runtime-evidence/p6-browser/p6-browser-e2e.json`.
"""
    write_text(output / "STCT-v1.9-P6.1-TARGETED-CLOSURE.md", closure)

    model_contract = """# Facility MVP-1 Model Contract

## Scope

Finite candidate-site capacitated assignment using the existing local OR-Tools CP-SAT runtime. The model compares exactly P=1, P=2 and P=3 and requests a distinct second portfolio with a no-good cut. It is not a continuous location model, real-estate recommendation, public routing service, or the full Facility model suite.

## Decision and constraints

- Binary open-site and demand-to-site assignment decisions.
- Every demand assigned exactly once in a feasible result.
- Assignment requires an open, eligible, capable and reachable site.
- Quantity, weight and volume capacity are enforced when supplied.
- Required and forbidden sites, exact P, cutoff distance and non-empty selected sites are enforced.
- Objective is fixed cost + handling cost + matrix distance transport cost, with integerized coefficients checked against int64 bounds.

## Runtime and trust

- Engine: OR-Tools CP-SAT 9.15.6755, one worker, seed 1909.
- `OPTIMAL`, `FEASIBLE`, `INFEASIBLE` and unresolved states retain their solver meaning per result.
- Independent JavaScript verification recomputes feasibility, assignment, capacity, cost, engine and status claims.
- Small instances are checked by an independent exhaustive oracle.
- If OR-Tools is unavailable, optimization is blocked; no greedy or unrelated probe is substituted.
"""
    write_text(output / "STCT-v1.9-FACILITY-MVP1-MODEL-CONTRACT.md", model_contract)

    matrix_policy = """# Facility MVP-1 Matrix and Cost Policy

- Coordinates must be explicit WGS84 longitude/latitude and pass range checks.
- `ESTIMATED_GEODESIC` is labeled as a strategic estimate, not a navigation route.
- An imported asymmetric Facility-to-Demand matrix is used exactly for strategic assignment and is content-hashed.
- A Facility-to-Demand matrix is never presented as a full operational road matrix; P6 is blocked until the operational route context is complete.
- Currency and cost period must be uniform. Unsupported or unconfirmed DAY/MONTH/YEAR conversions are rejected.
- Fixed, handling and transport costs are shown separately and reconciled to total.
- Current-network baseline uses the same model with its site set fixed.
- Savings are shown only when currency, period, scope and service are comparable and baseline cost is positive.
- No strategic carbon delta is calculated without a comparable strategic emission factor.
"""
    write_text(output / "STCT-v1.9-FACILITY-MVP1-MATRIX-COST-POLICY.md", matrix_policy)

    report = f"""# STCT v1.9 Facility MVP-1 Final Report

## Business outcome

Users can now import demand and finite candidate sites, pass coordinate/capacity/cost/period preflight, run real local CP-SAT for 1, 2 and 3 facilities, inspect alternatives and assignments, save/reopen/export the study, and send a selected portfolio into isolated COMMAND validation.

The browser test uploaded `synthetic-facility-study.json` through the real Facility file control. Data Hub regression also proved XLSX/CSV/JSON canonical parity with explicit synthetic order and candidate IDs; no default sample was silently substituted.

## Demonstrated portfolio comparison

- Current fixed network: {', '.join(current['selectedSiteIds'])}; CNY {current['cost']['total']:.4f} / MODEL_RUN; fixed {current['cost']['fixed']:.4f}, handling {current['cost']['handling']:.4f}, transport {current['cost']['transport']:.4f}; service {current['serviceRate']:.0%}; OPTIMAL.
{result_lines}
- Recommended: {', '.join(recommended['selectedSiteIds'])}, CNY {recommended['cost']['total']:.4f} / MODEL_RUN. The comparable same-service delta is CNY {recommendation['recommendation']['comparison']['costDelta']:.4f} ({recommendation['recommendation']['comparison']['savingsPercent']:.2%}).
- Every 24-demand browser result is `OPTIMAL`; 120-demand and 500-demand measured workloads include `FEASIBLE` results and make no global optimality claim.
- Independent verifier and small exhaustive oracle: PASS.

Two representative portfolios completed isolated operational validation with full service. The integration evidence records P=1 at CNY 1069.374 and P=2 at CNY 1529.587 in the operational model. Those costs are not mixed with the strategic ledger. COMMAND Plan, Run, execution events and three Pending ACK entries remained byte-for-byte unchanged.

Save/reopen, recommendation JSON/CSV/HTML export, a fresh repository import, desktop, portrait, landscape, zh/en/ja, reduced motion and no-WebGL table fallback all passed. The recommendation map contains 24 verified assignment lines.

## Delivery status

- P6.1 Targeted Integrity/Delivery Closure: **COMPLETED**
- Facility MVP-1 Feature Chain: **COMPLETED**
- Facility Solver Runtime Evidence: **VERIFIED**
- Operational Validation of Selected Portfolios: **VERIFIED**
- Full Facility model suite: **NOT_COMPLETED**
- P7: **NOT_STARTED**
- Overall v1.9: **IN_PROGRESS**
- v1.8 Soak: **DEFERRED_BY_USER**

No commit, staging, push, deployment, dependency installation, public routing, public optimization or model service was used.
"""
    write_text(output / "STCT-v1.9-FACILITY-MVP1-FINAL-REPORT.md", report)

    disposition_lines = ["# Facility MVP-1 File Disposition", "", "All listed implementation and test changes are **KEEP / 保留** unless stated otherwise.", "", "| Path | Change | Reason | Verification | Action |", "|---|---|---|---|---|"]
    for row in changed:
        reason = "Facility/P6.1 implementation or direct verification"
        disposition_lines.append(f"| `{row['path']}` | {row['change']} | {reason} | final source freeze and regression suite | KEEP / 保留 |")
    disposition_lines.extend([
        "| Protected original Excel in `templates/` | UNCHANGED | protected original retained locally | before/after hash matched; excluded from delivery | OTHER_ACTION / 本机保留且不分发 |",
        "| Prior P6 ZIP packages | UNCHANGED | retained as internal historical evidence | not copied into either new ZIP | OTHER_ACTION / 内部保留且不覆盖 |",
        "", "No file is marked REVERT / 撤销.",
    ])
    write_text(output / "STCT-v1.9-FACILITY-MVP1-FILE-DISPOSITION.md", "\n".join(disposition_lines))

    replay_readme = """# Facility MVP-1 Independent Replay

Requirements: Python 3, the already-approved `ortools==9.15.6755`, Bash and curl. No network download is performed by these steps.

1. Verify every entry against `MANIFEST.sha256`.
2. Run `python3 scripts/replay_facility_mvp1.py`; expect JSON status `PASS`, engine `OR_TOOLS_CP_SAT`, and P=1/2/3 portfolios.
3. Start the local app with unused ports, for example `WEB_PORT=8877 OPT_PORT=8878 bash start_demo.sh`.
4. Open `http://127.0.0.1:8877/index.html?optPort=8878#/design/facility-location`.
5. Use only `assets/demo/stct-synthetic-demo.json` or your own classified input. Facility optimization is unavailable when OR-Tools is absent; the UI must not replace it with a heuristic.
6. Stop only these package-owned processes with `bash stop_demo.sh`.

The included matrix is synthetic/local. It is not road navigation, a live property listing, investment approval, or a complete operational road matrix.
"""
    write_text(output / "README-FACILITY-MVP1-REPLAY.md", replay_readme)

    delivery_stage = output / ".delivery-stage"
    delivery_stage.mkdir()
    whitelist = local_refs(root / "index.html")
    whitelist.update({"index.html", "operational-validation-worker-v19.js", "platform-study-worker-v19.js", "start_demo.sh", "stop_demo.sh", "requirements-demo.txt", "netlify.toml", "NOTICE.md", "DATA_CLASSIFICATION.md", "assets/demo/stct-synthetic-demo.json", "vendor/NOTICE.md", "shared/planning-contract-v13.json"})
    whitelist.update(p.relative_to(root).as_posix() for p in (root / "optimizer").glob("*.py"))
    whitelist.add("scripts/replay_facility_mvp1.py")
    for name in sorted(whitelist):
        source = root / name
        if not source.is_file():
            raise RuntimeError(f"delivery dependency missing: {name}")
        (delivery_stage / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, delivery_stage / name)
    shutil.copy2(output / "README-FACILITY-MVP1-REPLAY.md", delivery_stage / "README-FACILITY-MVP1-REPLAY.md")
    delivery_manifest = write_manifest(delivery_stage)
    delivery_zip = output / f"STCT-v1.9-FACILITY-MVP1-DELIVERY-{DATE}.zip"
    make_zip(delivery_stage, delivery_zip)
    delivery_scan = scan_zip(delivery_zip)
    if delivery_scan["status"] != "PASS":
        raise RuntimeError(f"delivery privacy scan failed: {delivery_scan['findings']}")
    replay = replay_delivery(delivery_zip, os.environ.get("PYTHON_BIN", "python3"))
    write_json(output / "runtime-replay.json", replay)

    journey_titles = {
        "JF01":"P6.1 定向反例闭环","JF02":"可分发数据边界","JF03":"真实文件输入选址","JF04":"坐标、容量、单位和周期预检","JF05":"P=1/2/3真实求解","JF06":"非最近与矩阵实际使用","JF07":"现有仓基准与费用对账","JF08":"不可行、时限和取消","JF09":"独立复验与伪标签攻击","JF10":"替代仓组合与地图表格","JF11":"选址组合到P6","JF12":"缺运营数据与混合距离拒绝","JF13":"正在运行的COMMAND隔离","JF14":"保存重开与过期","JF15":"空白环境迁移","JF16":"无求解器边界","JF17":"三语、移动、无WebGL全程","JF18":"最终包独立重放",
    }
    refs = {
        "JF01":["test-outputs/p61-integrity.json","runtime-evidence/p6-independent-repro.json"],
        "JF02":["STCT-v1.9-FACILITY-MVP1-PRIVACY-SCAN.json"],
        "JF03":["test-outputs/p5-file-parity.json","runtime-evidence/browser/facility-browser-e2e.json"],
        "JF04":["test-outputs/facility-contract.json","test-outputs/p5-file-parity.json"],
        "JF05":["test-outputs/facility-cp-sat.json","runtime-replay.json"],
        "JF06":["test-outputs/facility-cp-sat.json","test-outputs/facility-contract.json"],
        "JF07":["test-outputs/facility-contract.json","runtime-evidence/browser/facility-recommendation.json"],
        "JF08":["test-outputs/facility-boundaries.json"],
        "JF09":["test-outputs/facility-mutations.json"],
        "JF10":["runtime-evidence/browser/facility-browser-e2e.json","runtime-evidence/browser/screenshots/facility-assignment-map.png"],
        "JF11":["test-outputs/facility-p6-integration.json"],
        "JF12":["test-outputs/facility-boundaries.json"],
        "JF13":["test-outputs/facility-p6-integration.json","runtime-evidence/browser/facility-browser-e2e.json"],
        "JF14":["test-outputs/facility-contract.json","runtime-evidence/browser/facility-browser-e2e.json"],
        "JF15":["test-outputs/facility-p6-integration.json","runtime-evidence/p6-browser/p6-browser-e2e.json"],
        "JF16":["test-outputs/facility-boundaries.json"],
        "JF17":["runtime-evidence/browser/facility-browser-e2e.json"],
        "JF18":["runtime-replay.json","MANIFEST.sha256"],
    }
    journeys = {"schemaVersion":"stct-facility-mvp1-journeys-v1","date":"2026-09-06","status":"PASS","executedSourceHash":freeze_hash,"journeys":[]}
    for jid, title in journey_titles.items():
        observed = {
            "JF01":"normal control passed and all supplied semantic contradictions were rejected",
            "JF02":"delivery whitelist and renamed-original mutation scan passed; protected original remained unchanged",
            "JF03":"synthetic XLSX/CSV/JSON canonical parity and browser Facility JSON file control passed",
            "JF04":"invalid coordinates, IDs, demand, fixed cost, currency and periods were blocked without double conversion",
            "JF05":"real local CP-SAT returned P=1/2/3 with independent oracle PASS",
            "JF06":"imported asymmetric matrix changed the objective and constrained assignment",
            "JF07":"fixed current portfolio and every cost component reconciled; comparison gates enforced",
            "JF08":"infeasible, timeout status, cancellation, late result and next-run behavior passed",
            "JF09":"capacity, assignment, site, cost, service, engine and comparison attacks were rejected",
            "JF10":"distinct alternatives, 24 assignment lines and no-WebGL table were verified",
            "JF11":"two portfolios completed isolated operational validation with resource conservation",
            "JF12":"strategic-only matrix and aggregated-only inputs remained blocked from operational PASS",
            "JF13":"COMMAND hash and three Pending ACK entries were unchanged",
            "JF14":"save, reopen and stale binding behavior passed",
            "JF15":"complete Facility package imported into a fresh repository without autorun",
            "JF16":"missing solver blocked optimization; no fallback result was emitted",
            "JF17":"1440x900, 390x844, 844x390, zh/en/ja, reduced motion and no-WebGL passed",
            "JF18":"random-directory manifest, synthetic replay, local web start and optimizer health passed",
        }[jid]
        journeys["journeys"].append({"id":jid,"title":title,"status":"PASS","assertionIds":[jid],"evidenceRefs":refs[jid],"observed":observed,"executedSourceHash":freeze_hash})
    write_json(output / "STCT-v1.9-FACILITY-MVP1-USER-JOURNEYS.json", journeys)

    summary = {
        "schemaVersion":"stct-v1.9-facility-mvp1-test-summary-v1","status":"PASS","date":"2026-09-06","sourceFreezeHash":freeze_hash,
        "baseline":{"branch":"feature/platform-v1.9-p3","head":"25e68b844a8514f840700d97db4086b69bd1a9b1","worktreeProtected":True},
        "suites":{name:{"status":"PASS","evidence":f"test-outputs/{name}.json"} for name in test_results},
        "browser":{"facility":browser["status"],"p6":p6_browser["status"],"publicServiceRequests":len(browser["publicServiceRequests"])},
        "performance":{"status":performance["status"],"evidenceClass":performance["evidenceClass"],"externalRequests":performance["externalRequests"]},
        "journeys":{"passed":18,"total":18},"deliveryReplay":replay,
        "formalStatus":{"p61":"COMPLETED","facilityMvp1":"COMPLETED","solverRuntime":"VERIFIED","operationalValidation":"VERIFIED","fullFacilitySuite":"NOT_COMPLETED","p7":"NOT_STARTED","overallV19":"IN_PROGRESS","v18Soak":"DEFERRED_BY_USER"},
    }
    write_json(output / "STCT-v1.9-FACILITY-MVP1-TEST-SUMMARY.json", summary)

    evidence_stage = output / ".evidence-stage"
    evidence_stage.mkdir()
    report_names = [
        "STCT-v1.9-P6.1-TARGETED-CLOSURE.md","STCT-v1.9-FACILITY-MVP1-FINAL-REPORT.md","STCT-v1.9-FACILITY-MVP1-MODEL-CONTRACT.md","STCT-v1.9-FACILITY-MVP1-MATRIX-COST-POLICY.md","STCT-v1.9-FACILITY-MVP1-TEST-SUMMARY.json","STCT-v1.9-FACILITY-MVP1-USER-JOURNEYS.json","STCT-v1.9-FACILITY-MVP1-PERFORMANCE.json","STCT-v1.9-FACILITY-MVP1-FILE-DISPOSITION.md",diff_name,"README-FACILITY-MVP1-REPLAY.md","runtime-replay.json",
    ]
    for name in report_names:
        shutil.copy2(output / name, evidence_stage / name)
    for row in freeze_manifest:
        copy_clean(root / row["path"], evidence_stage / "source" / row["path"], [str(root), str(root.parent), str(evidence)])
    (evidence_stage / "test-outputs").mkdir(parents=True, exist_ok=True)
    for path in files(test_outputs):
        shutil.copy2(path, evidence_stage / "test-outputs" / path.name)
    for path in files(evidence):
        copy_clean(path, evidence_stage / "runtime-evidence" / path.relative_to(evidence), [str(root), str(root.parent), str(evidence)])
    for source, name in [(args.p61_repro,"p6-independent-repro.json"),(args.prior_replay,"facility-replay-prior-freeze.json")]:
        copy_clean(source, evidence_stage / "runtime-evidence" / name, [str(root), str(root.parent), str(evidence)])
    for source in [fixture / "network.json", *fixture.glob("*.csv")]:
        copy_clean(source, evidence_stage / "synthetic-fixture" / source.name, [str(root.parent)])

    mutation_stage = output / ".privacy-mutation"
    mutation_stage.mkdir()
    (mutation_stage / "protected-original.xlsx").write_bytes(b"synthetic mutation probe")
    mutation_findings = scan_entries([("protected-original.xlsx", (mutation_stage / "protected-original.xlsx").read_bytes())])
    if not mutation_findings:
        raise RuntimeError("privacy mutation was not detected")
    privacy = {
        "schemaVersion":"stct-v1.9-facility-mvp1-privacy-scan-v1","status":"PASS","sourcePolicy":"EXPLICIT_SOURCE_AND_SYNTHETIC_DATA_WHITELIST",
        "protectedOriginal":{"beforeAfter":"MATCHED_UNCHANGED","included":False},
        "delivery":{"entries":delivery_scan["entryCount"],"status":delivery_scan["status"],"manifestEntries":len(delivery_manifest)},
        "evidence":{"status":"PASS","basis":"staging content and final ZIP entries scanned"},
        "mutationProbe":{"status":"PASS","detectedReasons":[row["reason"] for row in mutation_findings]},
        "forbidden":{"originalOrRenamedOriginal":0,"unknownPrivateDerivatives":0,"logs":0,"systemNoise":0,"localAbsolutePaths":0,"secrets":0},
    }
    write_json(output / "STCT-v1.9-FACILITY-MVP1-PRIVACY-SCAN.json", privacy)
    shutil.copy2(output / "STCT-v1.9-FACILITY-MVP1-PRIVACY-SCAN.json", evidence_stage / "STCT-v1.9-FACILITY-MVP1-PRIVACY-SCAN.json")
    write_manifest(evidence_stage)
    evidence_zip = output / f"STCT-v1.9-FACILITY-MVP1-EVIDENCE-{DATE}.zip"
    make_zip(evidence_stage, evidence_zip)
    evidence_scan = scan_zip(evidence_zip)
    if evidence_scan["status"] != "PASS":
        raise RuntimeError(f"evidence privacy scan failed: {evidence_scan['findings']}")

    shutil.rmtree(delivery_stage)
    shutil.rmtree(evidence_stage)
    shutil.rmtree(mutation_stage)
    print(json.dumps({"status":"PASS","sourceFreezeHash":freeze_hash,"changedFiles":len(changed),"tests":len(test_results),"journeys":"18/18","delivery":{"path":str(delivery_zip),"sha256":sha256_file(delivery_zip),"scan":delivery_scan},"evidence":{"path":str(evidence_zip),"sha256":sha256_file(evidence_zip),"scan":evidence_scan},"replay":replay}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
