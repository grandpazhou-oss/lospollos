#!/usr/bin/env python3
"""Decide whether an unchanged, already verified native window needs repetition.

This selects only the additional 31-minute window. Core/native tests and both
native preflights still run on the current source. A skip is NOT_RUN, not PASS.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
VERIFIED_SOURCE = '2f29dc0a3348475953d70cac48038fc8648fe95f'
VERIFIED_RUN = 'https://github.com/grandpazhou-oss/lospollos/actions/runs/37418185263'
VERIFIED_ARTIFACT_SHA256 = '727f27875f8c726199d30f34915f443387dc48fa54d66cd14c8dc088130a3dd5'
NATIVE_CHECKS = {'config.js', 'tests/test_enterprise_native_soak.py',
                 'tests/enterprise_native_soak_payloads.py'}


def relevant_changes(paths, runtime_paths):
    protected = set(runtime_paths) | NATIVE_CHECKS
    return sorted(path for path in paths if path in protected or path.startswith(('optimizer/', 'shared/')))


def native_execution_contract(workflow):
    """Preserve native commands and the pinned runner/interpreter dependencies."""
    return [line.strip() for line in workflow.splitlines()
            if ('tests/test_enterprise_native_soak.py' in line
                or ('pip install' in line and 'ortools' in line)
                or line.strip().startswith(('runs-on:', 'python-version:', 'node-version:')))]


def decide():
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=ROOT, stderr=subprocess.DEVNULL)
    result = {'status': 'RUN_REQUIRED', 'nativeLongRequired': True,
              'sourceCommit': git('rev-parse', 'HEAD').decode().strip(),
              'verifiedNativeSource': VERIFIED_SOURCE, 'verifiedNativeRun': VERIFIED_RUN,
              'verifiedArtifactSha256': VERIFIED_ARTIFACT_SHA256,
              'currentCoreNativeAndPreflightsStillRequired': True}
    try:
        if git('status', '--porcelain=v1', '--untracked-files=all').strip():
            result['reason'] = 'DIRTY_SOURCE_CANNOT_REUSE_VERIFIED_WINDOW'
            return result
        git('cat-file', '-e', VERIFIED_SOURCE + '^{commit}')
        # Keep a protected deletion visible even when its replacement is outside
        # the native path set; rename-only output can otherwise hide the source.
        changed = git('diff', '--no-renames', '--name-only', '-z', VERIFIED_SOURCE, 'HEAD').decode().split('\0')
        runtime_paths = set()
        contracts = []
        for revision in (VERIFIED_SOURCE, 'HEAD'):
            manifest = json.loads(git('show', revision + ':optimizer/build-manifest.json'))
            runtime_paths.update(row['path'] for row in manifest['files'])
            contracts.append(native_execution_contract(git('show', revision + ':.github/workflows/enterprise-hardening.yml').decode()))
        relevant = relevant_changes(filter(None, changed), runtime_paths)
        result.update(changedNativePaths=relevant, comparedRuntimePaths=sorted(runtime_paths),
                      nativeExecutionContractUnchanged=contracts[0] == contracts[1],
                      comparison='GIT_BLOBS_AND_PATH_SET_AGAINST_IMMUTABLE_VERIFIED_COMMIT')
        if not relevant and contracts[0] == contracts[1]:
            result.update(status='NOT_RUN_UNCHANGED_VERIFIED_NATIVE_SOURCE', nativeLongRequired=False,
                          reason='No runtime or native harness change; this is not a current-commit long-window PASS')
    except (subprocess.CalledProcessError, ValueError, KeyError, TypeError):
        result['reason'] = 'COMPARISON_UNAVAILABLE_RUN_NATIVE_WINDOW'
    return result


def self_test():
    runtime = {'scripts/local_trial.py', 'scripts/local_web.py', 'public-resources.json'}
    assert not relevant_changes(['tests/test_enterprise_browser_soak.py', '.github/workflows/enterprise-hardening.yml'], runtime)
    for path in ('optimizer/new_runtime.py', 'optimizer/nested/added.py', 'shared/new-contract.json',
                 'scripts/local_trial.py', 'public-resources.json', *NATIVE_CHECKS):
        assert relevant_changes([path], runtime) == [path], path
    assert relevant_changes(['removed-runtime.py'], runtime | {'removed-runtime.py'}) == ['removed-runtime.py']
    before = '    runs-on: ubuntu-24.04\n    run: python tests/test_enterprise_native_soak.py --duration-seconds 1860'
    assert native_execution_contract(before) != native_execution_contract(before.replace('1860', '3600'))
    assert native_execution_contract(before) != native_execution_contract(before.replace('24.04', '26.04'))
    assert native_execution_contract(before) == native_execution_contract(before + '\n    run: python tests/test_enterprise_browser_soak.py')
    return {'status': 'SELF_TEST_PASS_SCOPE_ONLY', 'nativeExecutionVerified': False,
            'checks': ['browser_only_excluded', 'new_runtime_included', 'nested_runtime_included',
                       'shared_contract_included', 'manifest_union_included', 'native_harness_included',
                       'native_window_arguments_included', 'runner_version_included']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    result = self_test() if args.self_test else decide()
    if args.output:
        output = args.output.resolve()
        if output == ROOT or ROOT in output.parents:
            parser.error('Evidence must be outside the checkout')
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2) + '\n')
    if not args.self_test and os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write('native_long_required=' + str(result['nativeLongRequired']).lower() + '\n')
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
