#!/usr/bin/env python3
"""Explicit synthetic regression selection, not a claim of full historical coverage.

Logs default outside the checkout. Missing dependencies fail the selected mode.
Native tests use real OR-Tools; browser tests use native IndexedDB in a component harness.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
CORE_JS = (
    'test_enterprise_storage_races.cjs',
    'test_enterprise_draft_view_import.cjs',
    'test_cancel_view_status.cjs',
    'test_command_applied_geometry.cjs', 'test_command_apply_transaction.cjs',
    'test_enterprise_road_report_truthfulness.js',
    'test_platform_study_context_v8.js', 'test_v8_supply_view_bridge.js', 'test_v8_supply_views.js',
    'test_enterprise_hardening_v1.cjs', 'test_enterprise_hardening.js', 'test_supply_chain_v71_health.js',
    'test_enterprise_snapshot_integrity.js', 'test_v86_roads.js',
    'test_road_client_row_roundtrip_w1.js', 'test_supply_chain_draft_v19.js',
    'test_supply_chain_v6_csv_security.js', 'test_supply_chain_v7_review_guards.js',
    'test_v86_hash_bytes.js', 'test_canonical_v13.js', 'test_canonical_closure_v131.js',
    'test_verifier_v13.js', 'test_manual_v13.js', 'test_priority_v13.js',
    'test_p2_integrity_closure_v19.js', 'test_v81_core_regression.js',
    'test_v87_map_comparison.js',
)
NATIVE_JS = (
    'test_supply_chain_v6_boundaries.js', 'test_supply_chain_v7_contracts.js',
    'test_v86_cost_contract.js', 'test_v82_quantity.js', 'test_rolling_reoptimization_v16.js',
)
NATIVE_PY = (
    'test_supply_chain_v7_jobs.py', 'test_optimizer_v13.py',
    'test_facility_null_capacity.py', 'test_v86_backend_contract.py',
    'test_canonical_v13.py', 'test_local_trial.py',
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=('core', 'native', 'browser', 'all'), default='core')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    output = (args.output or Path(tempfile.mkdtemp(prefix='stct-enterprise-checks-'))).resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error('Evidence output must be outside the source checkout')
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    env = {**os.environ, 'PYTHONUTF8': '1', 'PYTHONDONTWRITEBYTECODE': '1'}

    def not_run(name, command, reason):
        rows.append({'name': name, 'status': 'NOT_RUN', 'reason': reason, 'command': command})
        print(f'NOT_RUN: {name} ({reason})', flush=True)

    def run(name, command, timeout=240, dependency=False):
        start = time.monotonic()
        try:
            result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True,
                                    encoding='utf-8', errors='replace', timeout=timeout)
            code, text = result.returncode, result.stdout + result.stderr
        except subprocess.TimeoutExpired:
            code, text = 124, 'TIMEOUT: test process exceeded its explicit budget\n'
        except OSError as exc:
            code, text = 127, f'BLOCKED_ENVIRONMENT: {type(exc).__name__}\n'
        (output / (name + '.log')).write_text(text, encoding='utf-8')
        status = 'PASS' if code == 0 else 'BLOCKED_ENVIRONMENT' if dependency or code in (78, 127) else 'FAIL'
        row = {'name': name, 'status': status, 'exitCode': code,
               'elapsedSeconds': round(time.monotonic() - start, 3), 'command': command}
        rows.append(row)
        print(f'{status}: {name}', flush=True)
        if code:
            print(text[-2500:], flush=True)
        return code == 0

    if args.mode in ('core', 'all'):
        run('build-identity', [sys.executable, 'scripts/update_build_identity.py', '--check'])
        for name in CORE_JS:
            run(name, ['node', 'tests/' + name])
        for name in ('test_backend_build_fingerprint.py', 'test_checkout_line_endings.py', 'test_required_public_assets.py', 'test_enterprise_admission.py',
                     'test_enterprise_solver_lifecycle.py', 'test_enterprise_facility_deadline.py', 'test_enterprise_check_reporting.py'):
            run(name, [sys.executable, 'tests/' + name])
    if args.mode in ('native', 'all'):
        ready = run('ortools-dependency', [sys.executable, '-c',
                    'import ortools; assert ortools.__version__ == "9.15.6755", ortools.__version__; print(ortools.__version__)'], dependency=True)
        if ready:
            for name in NATIVE_JS:
                run(name, ['node', 'tests/' + name])
            for name in NATIVE_PY:
                run(name, [sys.executable, 'tests/' + name], timeout=300)
        else:
            for name in NATIVE_JS:
                not_run(name, ['node', 'tests/' + name], 'ORTOOLS_DEPENDENCY_UNAVAILABLE')
            for name in NATIVE_PY:
                not_run(name, [sys.executable, 'tests/' + name], 'ORTOOLS_DEPENDENCY_UNAVAILABLE')
    if args.mode in ('browser', 'all'):
        ready = run('playwright-dependency', [sys.executable, '-c',
                    'from playwright.sync_api import sync_playwright; print("playwright import ready; browser launch checked separately")'], dependency=True)
        if ready:
            ready = run('chromium-launch', [sys.executable, '-c',
                'import os,shutil; from playwright.sync_api import sync_playwright; '
                'p=sync_playwright().start(); executable=os.environ.get("STCT_CHROMIUM") or shutil.which("chromium"); '
                'b=p.chromium.launch(headless=True,**({"executable_path":executable} if executable else {}),args=["--no-sandbox"]); '
                'print(b.version); b.close(); p.stop()'], dependency=True)
        if ready:
            run('native-indexeddb', [sys.executable, 'tests/test_enterprise_indexeddb.py'])
            run('native-storage-faults', [sys.executable, 'tests/test_enterprise_storage_native.py'])
        else:
            not_run('native-indexeddb', [sys.executable, 'tests/test_enterprise_indexeddb.py'], 'BROWSER_DEPENDENCY_UNAVAILABLE')
            not_run('native-storage-faults', [sys.executable, 'tests/test_enterprise_storage_native.py'], 'BROWSER_DEPENDENCY_UNAVAILABLE')
    status = ('FAIL' if not rows or any(row['status'] == 'FAIL' for row in rows) else
              'BLOCKED_ENVIRONMENT' if any(row['status'] == 'BLOCKED_ENVIRONMENT' for row in rows) else
              'NOT_RUN' if any(row['status'] == 'NOT_RUN' for row in rows) else 'PASS')
    try:
        source_commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        source_changes = subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).splitlines()
        source_dirty = bool(source_changes)
    except (OSError, subprocess.CalledProcessError):
        source_commit, source_dirty, source_changes = None, None, None
    summary = {'schemaVersion': 'stct-enterprise-checks-v1', 'mode': args.mode, 'status': status,
               'sourceCommit': source_commit, 'sourceDirty': source_dirty,
               'sourceChanges': source_changes,
               'ciEventCommit': os.environ.get('GITHUB_SHA'),
               'scope': 'EXPLICIT_SYNTHETIC_SELECTION_NOT_FULL_HISTORICAL_SUITE', 'tests': rows,
               'notCovered': ['physical Windows machine', 'real OSRM network', 'private business workbooks',
                              'full UI end-to-end', 'multi-user security', 'soak']}
    (output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    print(f'{status}: {len(rows)} commands; evidence={output}', flush=True)
    return 0 if status == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
