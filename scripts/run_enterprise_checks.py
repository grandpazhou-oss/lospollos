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
    'test_v86_cost_contract.js', 'test_v82_quantity.js',
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
        status = 'PASS' if code == 0 else 'BLOCKED_ENVIRONMENT' if dependency or code == 127 else 'FAIL'
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
        for name in ('test_backend_build_fingerprint.py', 'test_enterprise_admission.py'):
            run(name, [sys.executable, 'tests/' + name])
    if args.mode in ('native', 'all'):
        ready = run('ortools-dependency', [sys.executable, '-c',
                    'import ortools; assert ortools.__version__ == "9.15.6755", ortools.__version__; print(ortools.__version__)'], dependency=True)
        if ready:
            for name in NATIVE_JS:
                run(name, ['node', 'tests/' + name])
            for name in NATIVE_PY:
                run(name, [sys.executable, 'tests/' + name], timeout=300)
    if args.mode in ('browser', 'all'):
        ready = run('playwright-dependency', [sys.executable, '-c',
                    'from playwright.sync_api import sync_playwright; print("playwright import ready; browser launch checked separately")'], dependency=True)
        if ready:
            run('native-indexeddb', [sys.executable, 'tests/test_enterprise_indexeddb.py'])
    status = 'PASS' if rows and all(row['status'] == 'PASS' for row in rows) else 'FAIL'
    summary = {'schemaVersion': 'stct-enterprise-checks-v1', 'mode': args.mode, 'status': status,
               'sourceCommit': os.environ.get('GITHUB_SHA'),
               'scope': 'EXPLICIT_SYNTHETIC_SELECTION_NOT_FULL_HISTORICAL_SUITE', 'tests': rows,
               'notCovered': ['physical Windows machine', 'real OSRM network', 'private business workbooks',
                              'full UI end-to-end', 'multi-user security', 'soak']}
    (output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    print(f'{status}: {len(rows)} commands; evidence={output}', flush=True)
    return 0 if status == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
