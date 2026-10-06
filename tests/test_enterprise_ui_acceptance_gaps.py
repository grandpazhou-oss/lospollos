#!/usr/bin/env python3
"""Two bounded synthetic public-UI acceptance gaps; one case per owned runtime.

Only the delayed-save case appends a declared test wrapper to the repository
script response. It delays one genuine commit/readback receipt, never business
state, an IndexedDB transaction, a solver response, or a disabled UI control.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

from enterprise_browser_soak_support import (
    EvidenceLog, ResourceMonitor, process_table, source_identity, supervise_process,
)
from test_enterprise_synthetic_full_ui import (
    ROOT, FORBIDDEN_PORTS, action, field, route_to, state, step,
)
from test_enterprise_ui_faults import FaultSuite, wait_ui

WALL_SECONDS = 240
CLEANUP_BOUND_SECONDS = 65
RSS_MIB = 2048
FD_LIMIT = 1024
PAGE_LIMIT = 2
SAVE_HOLD_MS = 5000
CASES = ('delayed-save', 'backend-restart')


def repository_script_pattern(port):
    return re.compile('^' + re.escape(f'http://127.0.0.1:{port}/platform-repository-v19.js') + r'(?:\?.*)?$')
CASE_REQUIRED_STAGES = {
    'delayed-save': ('B6_NATIVE_BASELINE', 'B6_PUBLIC_STUDY_SETUP',
                     'B6_DELAYED_DURABLE_RECEIPT_PUBLIC_SWITCH', 'B6_EXPORT_SAVE_REOPEN_IDENTITY'),
    'backend-restart': ('D8_LIVE_PAGE_REAL_BACKEND_RESTART', 'D8_SAME_PAGE_NATIVE_RETRY',
                        'D8_INTERRUPTION_EXPLANATION'),
}
COMMON_REQUIRED_STAGES = ('DEPENDENCIES', 'LAUNCHER', 'BROWSER', 'IMPORT_MAPPING_UNITS',
                          'MISSING_CRS_GUARD', 'BROWSER_ERROR_AUDIT', 'CLEANUP')

# Installed immediately AFTER the unchanged repository script has executed and
# BEFORE platform services create their repository. Frozen production objects
# are preserved; a test-owned wrapper delegates all real operations.
SAVE_RECEIPT_HOOK = r"""
(() => {
  'use strict';
  // The same script is imported by the snapshot worker using CommonJS exports.
  // Only the real Window receives the UI timing hook; workers stay untouched.
  if (typeof window === 'undefined' || window !== globalThis || !globalThis.document) return;
  const ns = globalThis.STCTPlatformV19, original = ns.platformRepository;
  if (globalThis.__acceptanceSaveReceipt || !original?.createRepository)
    throw Error('SAVE_RECEIPT_HOOK_INSTALL_INVALID');
  let armed = null, target = null, release = null, timer = null, restored = false;
  const info = {method:'DELAY_ONE_REAL_NATIVE_COMMIT_READBACK_RECEIPT',
    maxHoldMs:5000, armed:false, captured:false, released:false, expired:false,
    settled:false, matchedCount:0, targetSaveCount:0, restored:false};
  const copy = value => structuredClone(value);
  const snapshot = () => copy(info);
  function finish(expired) {
    if (!release) return snapshot();
    info.expired = info.expired || expired;
    info.released = true;
    info.releasedAt = performance.now();
    info.heldMs = info.releasedAt - info.capturedAt;
    clearTimeout(timer); timer = null;
    const done = release; release = null; done();
    return snapshot();
  }
  const wrapped = Object.freeze({...original, createRepository(options) {
    const real = original.createRepository(options);
    return Object.freeze({...real, async commit(batch) {
      if (restored) return real.commit(batch);
      if (target && batch.pointer?.id === target.id) info.targetSaveCount++;
      const selected = armed && batch.pointer?.id === armed.id &&
        batch.pointer.inputHash === armed.inputHash &&
        batch.expectedRevision === armed.expectedRevision;
      const expected = selected ? armed : null;
      if (selected) { armed = null; info.armed = false; info.matchedCount++; }
      const receipt = await real.commit(batch);
      if (!selected) return receipt;
      if (receipt.status !== 'SAVED' || receipt.pointer?.id !== expected.id ||
          receipt.pointer.inputHash !== expected.inputHash ||
          receipt.pointer.revision !== expected.expectedRevision + 1)
        throw Error('GENUINE_SAVE_RECEIPT_IDENTITY_MISMATCH');
      info.captured = true;
      info.capturedAt = performance.now();
      info.receipt = copy(receipt);
      info.requested = copy(expected);
      await new Promise(resolve => {
        release = resolve;
        timer = setTimeout(() => finish(true), 5000);
      });
      info.settled = true;
      return receipt;
    }});
  }});
  ns.platformRepository = wrapped;
  globalThis.__acceptanceSaveReceipt = Object.freeze({
    arm(value) {
      if (restored || info.matchedCount || armed || !value?.id ||
          !value.inputHash || !Number.isInteger(value.expectedRevision))
        throw Error('SAVE_RECEIPT_ARM_INVALID');
      armed = copy(value); target = copy(value); info.armed = true;
      return snapshot();
    },
    snapshot,
    release: () => finish(false),
    restore() {
      finish(false); restored = true; armed = null; info.armed = false;
      if (ns.platformRepository === wrapped) ns.platformRepository = original;
      info.restored = ns.platformRepository === original;
      return snapshot();
    }
  });
})();
"""


def validate_receipt_gate(value):
    """A timeout/release without a captured real receipt can never pass."""
    assert value.get('captured') and value.get('released') and value.get('settled'), value
    assert value.get('matchedCount') == value.get('targetSaveCount') == 1, value
    assert value.get('expired') is False, value
    held = value.get('heldMs')
    assert isinstance(held, (int, float)) and 0 <= held <= SAVE_HOLD_MS, value
    expected, receipt = value['requested'], value['receipt']
    assert receipt['status'] == 'SAVED'
    assert receipt['pointer']['id'] == expected['id']
    assert receipt['pointer']['inputHash'] == expected['inputHash']
    assert receipt['pointer']['revision'] == expected['expectedRevision'] + 1


def finalize(result, code, failure, cleanup):
    result['ownedProcessCleanup'] = cleanup
    result['workerExitCode'] = code
    clean = cleanup.get('status') == 'PASS' and cleanup.get('remainingLiveProcesses') == [] \
        and cleanup.get('remainingZombies') == [] and cleanup.get('signalErrors') == [] \
        and cleanup.get('forcedTerminationUsed') is False
    if failure or not clean:
        result['status'] = 'FAIL'
        result['supervisor'] = failure
        result['terminalError'] = 'SUPERVISOR_STOP_OR_OWNED_CLEANUP_FAILURE'
    elif result.get('status') not in ('PASS', 'FAIL', 'BLOCKED_ENVIRONMENT'):
        result['status'] = 'FAIL'
        result['terminalError'] = 'NONTERMINAL_OR_MISSING_SUMMARY'
    elif code != 0 and not (code == 78 and result['status'] == 'BLOCKED_ENVIRONMENT'):
        result['status'] = 'FAIL'
        result['terminalError'] = 'NONZERO_WORKER_EXIT'
    elif code == 0 and result['status'] == 'BLOCKED_ENVIRONMENT':
        result['status'] = 'FAIL'
        result['terminalError'] = 'WORKER_EXIT_STATUS_MISMATCH'
    if result['status'] == 'PASS':
        stages = result.get('stages', {})
        case = result.get('case')
        required = COMMON_REQUIRED_STAGES + CASE_REQUIRED_STAGES.get(case, ())
        if any(stages.get(name, {}).get('status') != 'PASS' for name in required) \
                or any(value.get('status') != 'PASS' for value in stages.values()) \
                or case not in CASE_REQUIRED_STAGES or result.get('caseCompleted') is not True:
            result['status'] = 'FAIL'
            result['terminalError'] = 'REQUIRED_UI_CASE_OR_CLEANUP_NOT_PASSED'
    return 0 if result['status'] == 'PASS' else 78 if result['status'] == 'BLOCKED_ENVIRONMENT' else 1


class GapSuite(FaultSuite):
    def __init__(self, args):
        super().__init__(args.evidence_dir)
        old_runtime = self.runtime
        self.runtime = Path(os.environ['STCT_GAP_OWNED_RUNTIME']).resolve()
        assert self.runtime.name == os.environ['STCT_GAP_RUN_TOKEN']
        old_runtime.rmdir()
        self.run_dir = self.runtime / 'launcher'
        self.env['STCT_RUN_DIR'] = str(self.run_dir)
        self.args = args
        self.started = time.monotonic()
        self.interruption_requested = None
        self.resource_roots = {}
        self.monitor = ResourceMonitor(EvidenceLog(self.evidence / 'resources.jsonl', self.scrub),
            RSS_MIB, FD_LIMIT, 1.0, self.evidence / 'abort-request.json')
        self.hook_route = None
        self.result.update(suite='ENTERPRISE_UI_ACCEPTANCE_GAPS', case=args.case,
            source=source_identity(ROOT), method='PUBLIC_UI_WITH_DECLARED_CONTROLLED_BOUNDARY',
            stages={name: {'status': 'NOT_RUN'} for name in (
                'DEPENDENCIES', 'LAUNCHER', 'BROWSER', 'IMPORT_MAPPING_UNITS',
                'MISSING_CRS_GUARD', 'BROWSER_ERROR_AUDIT', 'CLEANUP')},
            limits={'wallSeconds': WALL_SECONDS, 'exceptionCleanupSeconds': CLEANUP_BOUND_SECONDS,
                    'aggregateRSSBytes': RSS_MIB * 1024 ** 2, 'aggregateFDs': FD_LIMIT,
                    'maximumPages': PAGE_LIMIT, 'nativeAdmission': 1,
                    'saveReceiptMaximumHoldMs': SAVE_HOLD_MS},
            caseCompleted=False, noBusinessStateInjection=True, noDisabledControlOverride=True)
        self.result['source']['acceptanceHarnessSHA256'] = {
            name: hashlib.sha256((ROOT / 'tests' / name).read_bytes()).hexdigest()
            for name in ('test_enterprise_ui_acceptance_gaps.py', 'enterprise_backend_restart_case.py')
            if (ROOT / 'tests' / name).is_file()}

    def check_budget(self):
        assert not self.interruption_requested, 'Supervisor interruption requested'
        assert time.monotonic() - self.started < WALL_SECONDS, 'Case wall budget exhausted'
        assert not self.monitor.violation, self.monitor.violation
        assert not (self.evidence / 'abort-request.json').exists(), 'Resource stop requested'
        if self.browser:
            assert sum(len(c.pages) for c in self.browser.contexts) <= PAGE_LIMIT, 'Page limit exceeded'

    def begin(self, stage):
        if hasattr(self, 'monitor'):
            self.check_budget()
        return super().begin(stage)

    def register_service_roots(self, extra_roots=()):
        # The original launcher validates executable/root/start-time ownership.
        spec = importlib.util.spec_from_file_location('gap_owned_local_trial', ROOT / 'scripts/local_trial.py')
        launcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(launcher)
        table = process_table()
        for row in extra_roots:
            assert row['pid'] in table and table[row['pid']]['startTicks'] == row['startTicks'], \
                'Additional owned worker process identity changed'
            self.monitor.add_root(row['pid'], kind='services_workers')
            self.resource_roots[row['pid']] = row['startTicks']
        for kind in ('web', 'optimizer'):
            row = self.record[kind]
            assert row['port'] not in FORBIDDEN_PORTS
            assert launcher.ownership(row, kind) == 'OWNED', 'Launcher service ownership changed'
            self.monitor.add_root(row['pid'], kind='services_workers')
            self.resource_roots[row['pid']] = self.monitor.roots[row['pid']]
        receipt = {'runToken': self.runtime.name, 'services': [
            {'pid': pid, 'startTicks': ticks} for pid, ticks in sorted(self.resource_roots.items())]}
        pending = self.runtime / 'owned-processes.pending'
        pending.write_text(json.dumps(receipt))
        pending.replace(self.runtime / 'owned-processes.json')

    def new_page(self, context):
        self.check_budget()
        assert sum(len(c.pages) for c in self.browser.contexts) < PAGE_LIMIT
        return super().new_page(context)

    def install_save_receipt_hook(self):
        original = (ROOT / 'platform-repository-v19.js').read_text()
        def install(route):
            response = route.fetch(timeout=10000)
            assert response.ok and response.text() == original, 'Repository script source mismatch'
            route.fulfill(response=response, body=original + '\n' + SAVE_RECEIPT_HOOK)
        pattern = repository_script_pattern(self.web_port)
        self.hook_route = (pattern, install)
        self.context.route(pattern, install)
        self.result['saveReceiptHook'] = {'script': 'platform-repository-v19.js',
            'unmodifiedProductScriptSHA256': hashlib.sha256(original.encode()).hexdigest(),
            'testAppendixSHA256': hashlib.sha256(SAVE_RECEIPT_HOOK.encode()).hexdigest(),
            'scope': 'ONE_GENUINE_REPOSITORY_COMMIT_RECEIPT_ONLY',
            'maximumHoldMs': SAVE_HOLD_MS}

    def save_observation(self):
        return self.page.evaluate("""() => ({
          current: window.STCTPlatformV19.instance.studyContext.snapshot().current,
          header: document.querySelector('.sc-hero h1')?.textContent,
          messages: [...document.querySelectorAll('.sc-message,.sc-save-status')].map(e=>e.textContent),
          saveNotes: [...document.querySelectorAll('.sc-note')].map(e=>e.textContent)
        })""")

    def restore_save_hook(self):
        if self.page and not self.page.is_closed():
            result = self.page.evaluate("""() => globalThis.__acceptanceSaveReceipt?.restore() || null""")
            if result:
                assert result['restored'], 'Repository factory hook was not restored'
                self.result['saveReceiptHookFinal'] = result
        if self.hook_route and self.context:
            self.context.unroute(*self.hook_route)
            self.hook_route = None

    def delayed_save_case(self):
        original = self.native_retry('B6_NATIVE_BASELINE')
        self.begin('B6_PUBLIC_STUDY_SETUP')
        page = self.page
        pointer_a = original['savedPointer']['id']
        history_a = self.public_history(page, pointer_a)
        route_to(page, '/platform/scenarios')
        field_b_name = page.locator('[data-p5-field="scenarioName"]')
        field_b_name.fill('Synthetic B for delayed durable receipt')
        page.locator('[data-p5-action="save-copy"]').click()
        alternate = wait_ui(page, lambda s: s.get('study') and
            s['study']['studyId'] != original['study']['studyId'] and
            (s.get('savedPointer') or {}).get('id') == 'SUPPLY:' + s['study']['studyId'],
            'Public Save a copy must create B')
        pointer_b = alternate['savedPointer']['id']
        history_b = self.public_history(page, pointer_b)
        saved_a = self.reopen_public(page, pointer_a)
        assert saved_a['snapshot'] == original['snapshot']
        self.passed(studyA=pointer_a, studyB=pointer_b, separatePublicCopy=True)
        self.begin('B6_DELAYED_DURABLE_RECEIPT_PUBLIC_SWITCH')
        page.evaluate('(value) => __acceptanceSaveReceipt.arm(value)', {
            'id': pointer_a, 'inputHash': saved_a['study']['inputHash'],
            'expectedRevision': saved_a['savedPointer']['revision']})
        try:
            action(page, 'draft-save').click()
            page.wait_for_function('() => __acceptanceSaveReceipt.snapshot().captured', timeout=5000).dispose()
            captured = page.evaluate('() => __acceptanceSaveReceipt.snapshot()')
            assert not captured['expired'] and not captured['released']
            # This public route does not await the in-study save queue.
            page.set_default_timeout(4000)
            route_to(page, '/platform/scenarios')
            row = page.locator('tr[data-p5-entry="' + pointer_b + '"]')
            button = row.locator('[data-p5-action="open"]')
            assert button.is_enabled(), 'Public catalog Open is not reachable'
            button.click()
            page.locator('[data-design-route="/design/supply-chain-study"]').wait_for()
            selected = wait_ui(page, lambda s: (s.get('savedPointer') or {}).get('id') == pointer_b,
                               'B must become current before receipt release', timeout=4)
            step(page, 2)
            before = self.save_observation()
            gate = page.evaluate('() => __acceptanceSaveReceipt.snapshot()')
            assert gate['captured'] and not gate['released'] and not gate['expired'], gate
            self.screenshot('b6-b-selected-before-old-receipt')
            page.evaluate('() => __acceptanceSaveReceipt.release()')
            page.wait_for_function('() => __acceptanceSaveReceipt.snapshot().settled', timeout=2000).dispose()
            # Let the controller, queued save, and original click continuation drain.
            page.evaluate('() => new Promise(resolve => setTimeout(resolve, 0))')
            after = state(page)
            visible_after = self.save_observation()
            for key in ('study', 'scenario', 'snapshot', 'savedPointer', 'staleResult', 'lastError'):
                assert after.get(key) == selected.get(key), 'Late receipt changed B ' + key
            assert visible_after == before, 'Late A receipt changed B visible save/context state'
            assert after['savedPointer'] == alternate['savedPointer']
            assert before['current']['studyId'] == alternate['study']['studyId']
            assert before['current']['inputHash'] == alternate['study']['inputHash']
            gate = page.evaluate('() => __acceptanceSaveReceipt.snapshot()')
            validate_receipt_gate(gate)
            self.screenshot('b6-b-preserved-after-old-receipt')
            self.passed(method='REAL_NATIVE_IDB_COMMIT_READBACK_THEN_CONTROLLED_RECEIPT_DELAY',
                receipt=gate, newStudyPointer=after['savedPointer'],
                visibleBefore=before, visibleAfter=visible_after,
                publicSwitchRoute='global scenario library -> B row Open')
        finally:
            page.set_default_timeout(25000)
            self.restore_save_hook()
        self.begin('B6_EXPORT_SAVE_REOPEN_IDENTITY')
        step(page, 2)
        packed = json.loads(self.download('package-export', 'b6-current-b-draft.package.json'))
        assert packed['study']['studyId'] == alternate['study']['studyId']
        assert packed['study']['inputHash'] == alternate['study']['inputHash']
        assert packed.get('snapshot') is None
        revision_b = state(page)['savedPointer']['revision']
        action(page, 'draft-save').click()
        saved_b = wait_ui(page, lambda s: (s.get('savedPointer') or {}).get('revision', 0) == revision_b + 1,
                          'Public B save must receive its own revision')
        assert saved_b['savedPointer']['id'] == pointer_b
        reopened_a = self.reopen_public(page, pointer_a)
        expected_a = self.result['stages']['B6_DELAYED_DURABLE_RECEIPT_PUBLIC_SWITCH']['receipt']['receipt']['pointer']
        assert reopened_a['savedPointer'] == expected_a
        assert reopened_a['snapshot'] == original['snapshot']
        assert self.public_history(page, pointer_a) == history_a
        reopened_b = self.reopen_public(page, pointer_b)
        assert reopened_b['savedPointer'] == saved_b['savedPointer']
        assert reopened_b['study'] == alternate['study']
        assert self.public_history(page, pointer_b) == history_b
        self.reopen_public(page, pointer_b)
        self.screenshot('b6-a-and-b-durable-readback')
        self.passed(originalPointer=reopened_a['savedPointer'], originalHistoryUnchanged=True,
            newStudyPointer=reopened_b['savedPointer'], newStudyHistoryUnchanged=True,
            exportedStudyId=packed['study']['studyId'], exportedInputHash=packed['study']['inputHash'])

    def cleanup(self):
        errors = []
        try:
            if self.args.case == 'delayed-save':
                self.restore_save_hook()
        except Exception as error:
            errors.append('Storage timing hook cleanup: ' + self.scrub(str(error)))
        self.monitor.stop()
        self.result['resources'] = self.monitor.trend()
        if self.monitor.violation:
            errors.append('Resource monitor violation')
            self.result['resourceViolation'] = self.monitor.violation
        super().cleanup()
        if errors:
            self.result['status'] = 'FAIL'
            self.result['stages']['CLEANUP']['status'] = 'FAIL'
            self.result['stages']['CLEANUP']['errors'].extend(errors)
            self.write()

    def run(self):
        previous = signal.signal(signal.SIGTERM,
            lambda number, _frame: setattr(self, 'interruption_requested', number))
        try:
            self.monitor.start()
            self.launch()
            self.register_service_roots()
            from playwright.sync_api import sync_playwright
            with sync_playwright() as playwright:
                try:
                    self.begin('BROWSER')
                    try:
                        self.browser = playwright.chromium.launch(headless=True,
                            executable_path=os.environ.get('STCT_CHROMIUM') or os.environ.get('STCT_BROWSER'),
                            args=['--disable-webgl'])
                    except Exception as error:
                        raise EnvironmentError('Chromium launch unavailable: ' + str(error)) from error
                    self.context = self.make_context()
                    if self.args.case == 'delayed-save':
                        self.install_save_receipt_hook()
                    self.context.tracing.start(screenshots=True, snapshots=True, sources=False)
                    self.trace_started = True
                    self.page = self.new_page(self.context)
                    self.passed(browserVersion=self.browser.version, isolatedContext=True, maximumPages=PAGE_LIMIT)
                    self.import_workbook()
                    if self.args.case == 'delayed-save':
                        self.delayed_save_case()
                    else:
                        from enterprise_backend_restart_case import run_backend_restart_case
                        run_backend_restart_case(self)
                    self.check_budget()
                    self.result['caseCompleted'] = True
                    self.begin('BROWSER_ERROR_AUDIT')
                    assert not self.result['pageErrors'], self.result['pageErrors']
                    expected = self.result.get('expectedControlledHttpConsoleErrors', [])
                    unexpected = [message for message in self.result['consoleErrors'] if message not in expected]
                    assert not unexpected, unexpected
                    assert not self.result['externalBlocked'], self.result['externalBlocked']
                    self.passed(expectedConsoleErrors=expected, unexpectedConsoleErrors=[])
                    self.result['status'] = 'PASS'
                except Exception as error:
                    self.record_failure(error)
                finally:
                    self.cleanup()
        except Exception as error:
            self.record_failure(error)
            if not self.cleaned:
                try:
                    self.cleanup()
                except Exception as cleanup_error:
                    self.monitor.stop()
                    self.result['status'] = 'FAIL'
                    self.result['stages']['CLEANUP'] = {
                        'status': 'FAIL', 'error': self.scrub(str(cleanup_error))}
        finally:
            signal.signal(signal.SIGTERM, previous)
            self.write()
        print(json.dumps({'case': self.args.case, 'status': self.result['status'],
                          'stages': self.result['stages']}, ensure_ascii=False), flush=True)
        return 0 if self.result['status'] == 'PASS' else 78 if self.result['status'] == 'BLOCKED_ENVIRONMENT' else 1


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', choices=CASES, required=True)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    args = parser.parse_args(argv)
    evidence = args.evidence_dir.expanduser().resolve()
    if evidence == ROOT or ROOT in evidence.parents:
        parser.error('Evidence must be outside the source checkout')
    evidence.mkdir(parents=True, exist_ok=True)
    if any(evidence.iterdir()):
        parser.error('Use a fresh empty evidence directory for this one case')
    args.evidence_dir = evidence
    return args


def supervised_run(args, argv):
    runtime = Path(tempfile.mkdtemp(prefix='stct-ui-acceptance-owned-'))
    env = {**os.environ, 'STCT_GAP_WORKER': '1', 'STCT_GAP_OWNED_RUNTIME': str(runtime),
           'STCT_GAP_RUN_TOKEN': runtime.name, 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUNBUFFERED': '1',
           'STCT_SOAK_SUPERVISOR_PID': str(os.getpid()),
           'STCT_SOAK_SUPERVISOR_START_TICKS': str(process_table()[os.getpid()]['startTicks'])}
    child = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), *argv],
                             cwd=ROOT, env=env, start_new_session=True)
    def stop_owned_services():
        run_dir = runtime / 'launcher'
        if not (run_dir / 'trial.json').exists():
            return {'status': 'NO_OWNERSHIP_RECEIPT', 'foreignProcessesTouched': False}
        stopped = subprocess.run([sys.executable, str(ROOT / 'scripts/local_trial.py'), 'stop'],
            cwd=ROOT, env={**env, 'STCT_RUN_DIR': str(run_dir)}, capture_output=True,
            text=True, timeout=35)
        output = (stopped.stdout + stopped.stderr).replace(str(runtime), '<runtime>').replace(str(ROOT), '<checkout>')
        (args.evidence_dir / 'supervisor-launcher-stop.log').write_text(output)
        return {'status': 'PASS' if stopped.returncode == 0 and not (run_dir / 'trial.json').exists() else 'FAIL',
                'returnCode': stopped.returncode}
    # Shared supervisor max exceptional cleanup: 10 + 35 + 10 + 5 seconds,
    # within the declared 65-second allowance, with verified PID/startTicks only.
    code, failure, cleanup = supervise_process(child, WALL_SECONDS,
        args.evidence_dir / 'abort-request.json', stop_owned_services, grace_seconds=10,
        owned_roots_path=runtime / 'owned-processes.json', run_token=runtime.name)
    path = args.evidence_dir / 'summary.json'
    try:
        result = json.loads(path.read_text())
    except (OSError, ValueError):
        result = {'status': 'FAIL', 'case': args.case, 'source': source_identity(ROOT),
                  'error': 'UI_ACCEPTANCE_SUMMARY_MISSING_OR_INVALID'}
    exit_code = finalize(result, code, failure, cleanup)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    if runtime.exists() and not any(runtime.iterdir()):
        runtime.rmdir()
    return exit_code


class AcceptanceGapGuardTests(unittest.TestCase):
    def test_repository_hook_matches_versioned_owned_script_only(self):
        pattern = repository_script_pattern(8865)
        url = 'http://127.0.0.1:8865/platform-repository-v19.js'
        self.assertIsNotNone(pattern.fullmatch(url))
        self.assertIsNotNone(pattern.fullmatch(url + '?v=1.9.0-p8-pool'))
        for other in (url.replace('8865', '8887'), url.replace('127.0.0.1', 'example.invalid'),
                      url + '.unrelated', url.replace('http:', 'https:')):
            self.assertIsNone(pattern.fullmatch(other))

    def parse(self, *flags):
        with tempfile.TemporaryDirectory(prefix='acceptance-gap-guard-') as directory:
            with contextlib.redirect_stderr(io.StringIO()):
                return parse_args(['--case', 'delayed-save', '--evidence-dir', directory, *flags])

    def test_fixed_budgets_cannot_be_expanded(self):
        self.assertEqual((WALL_SECONDS, CLEANUP_BOUND_SECONDS, RSS_MIB, FD_LIMIT, PAGE_LIMIT, SAVE_HOLD_MS),
                         (240, 65, 2048, 1024, 2, 5000))
        for flags in (('--max-wall-seconds', '241'), ('--max-rss-mib', '2049'),
                      ('--save-hold-ms', '5001'), ('--case', 'all')):
            with self.subTest(flags=flags), self.assertRaises(SystemExit):
                self.parse(*flags)

    def test_nonempty_evidence_and_source_destination_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'existing').write_text('keep')
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                parse_args(['--case', 'backend-restart', '--evidence-dir', directory])
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            parse_args(['--case', 'delayed-save', '--evidence-dir', str(ROOT)])

    def test_failure_cleanup_and_missing_work_never_pass(self):
        clean = {'status': 'PASS', 'remainingLiveProcesses': [], 'remainingZombies': [],
                 'signalErrors': [], 'forcedTerminationUsed': False}
        for status, code, failure, cleanup in (
                ('PASS', 0, {'reason': 'DEADLINE'}, clean),
                ('RUNNING', 0, None, clean), ('PASS', 1, None, clean),
                ('PASS', 0, None, {**clean, 'status': 'FAIL'}),
                ('PASS', 0, None, {**clean, 'remainingLiveProcesses': [{'pid': 1}]}),
                ('PASS', 0, None, {**clean, 'remainingZombies': [{'pid': 1}]}),
                ('PASS', 0, None, {**clean, 'forcedTerminationUsed': True}),
                ('PASS', 0, None, clean)):
            value = {'status': status}
            self.assertEqual(finalize(value, code, failure, cleanup), 1)
            self.assertEqual(value['status'], 'FAIL')
        blocked = {'status': 'BLOCKED_ENVIRONMENT'}
        self.assertEqual(finalize(blocked, 78, None, clean), 78)
        complete = {'status': 'PASS', 'case': 'delayed-save', 'caseCompleted': True,
                    'stages': {name: {'status': 'PASS'} for name in
                               COMMON_REQUIRED_STAGES + CASE_REQUIRED_STAGES['delayed-save']}}
        self.assertEqual(finalize(complete, 0, None, clean), 0)
        for key in ('remainingLiveProcesses', 'remainingZombies', 'signalErrors', 'forcedTerminationUsed'):
            missing = {k: v for k, v in clean.items() if k != key}
            self.assertEqual(finalize({'status': 'PASS', 'case': 'delayed-save', 'caseCompleted': True,
                                      'stages': complete['stages']}, 0, None, missing), 1)
        for case, names in CASE_REQUIRED_STAGES.items():
            for stage in names:
                for bad_status in ('RUNNING', 'NOT_RUN', 'FAIL'):
                    stages = {name: {'status': 'PASS'} for name in COMMON_REQUIRED_STAGES + names}
                    stages[stage]['status'] = bad_status
                    candidate = {'status': 'PASS', 'case': case, 'caseCompleted': True, 'stages': stages}
                    self.assertEqual(finalize(candidate, 0, None, clean), 1)

    def test_expired_or_incomplete_receipts_are_rejected(self):
        good = {'captured': True, 'released': True, 'settled': True, 'expired': False,
                'matchedCount': 1, 'targetSaveCount': 1, 'heldMs': 4999,
                'requested': {'id': 'A', 'inputHash': 'hash', 'expectedRevision': 2},
                'receipt': {'status': 'SAVED', 'pointer': {'id': 'A', 'inputHash': 'hash', 'revision': 3}}}
        validate_receipt_gate(good)
        for patch in ({'expired': True}, {'heldMs': 5001}, {'captured': False},
                      {'settled': False}, {'matchedCount': 2}, {'targetSaveCount': 2}):
            with self.subTest(patch=patch), self.assertRaises(AssertionError):
                validate_receipt_gate({**good, **patch})

    def test_hook_delegates_real_operation_before_holding_and_restores(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('Node unavailable; pure hook guard not executed')
        fixture = r"""
const assert=require('node:assert/strict');
let clock=100, timeout, committed=false, complete;
globalThis.window=globalThis;globalThis.document={};
globalThis.performance={now:()=>clock};
globalThis.setTimeout=(fn,ms)=>{assert.equal(ms,5000);timeout=fn;return 1;};
globalThis.clearTimeout=()=>{};
const original=Object.freeze({createRepository:()=>Object.freeze({
  commit:async batch=>{await new Promise(resolve=>{complete=resolve;});committed=true;
    return {status:'SAVED',pointer:{...batch.pointer,revision:batch.expectedRevision+1}};}
})});
globalThis.STCTPlatformV19={platformRepository:original};
"""
        assertions = r"""
(async()=>{
 const repo=STCTPlatformV19.platformRepository.createRepository();
 const target={id:'A',inputHash:'hash',expectedRevision:2};
 __acceptanceSaveReceipt.arm(target);
 const saving=repo.commit({pointer:{id:'A',inputHash:'hash'},expectedRevision:2});
 assert.equal(__acceptanceSaveReceipt.snapshot().captured,false);
 complete();await new Promise(setImmediate);
 assert.equal(committed,true);assert.equal(__acceptanceSaveReceipt.snapshot().captured,true);
 assert.equal(__acceptanceSaveReceipt.snapshot().settled,false);
 clock=200;__acceptanceSaveReceipt.release();
 assert.equal((await saving).pointer.revision,3);
 assert.equal(__acceptanceSaveReceipt.snapshot().heldMs,100);
 assert.equal(__acceptanceSaveReceipt.snapshot().expired,false);
 assert.equal(__acceptanceSaveReceipt.restore().restored,true);
 assert.equal(STCTPlatformV19.platformRepository,original);
 assert.throws(()=>__acceptanceSaveReceipt.arm(target),/ARM_INVALID/);
 delete globalThis.__acceptanceSaveReceipt;eval(hookSource);
 const second=STCTPlatformV19.platformRepository.createRepository();
 __acceptanceSaveReceipt.arm(target);
 const expiry=second.commit({pointer:{id:'A',inputHash:'hash'},expectedRevision:2});
 complete();await new Promise(setImmediate);
 clock+=5000;timeout();
 assert.equal((await expiry).pointer.revision,3);
 assert.equal(__acceptanceSaveReceipt.snapshot().expired,true);
 assert.equal(__acceptanceSaveReceipt.snapshot().heldMs,5000);
 assert.equal(__acceptanceSaveReceipt.restore().restored,true);
 console.log('Pure receipt sequencing/deadline/restoration guards PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
"""
        script = fixture + '\nconst hookSource=' + json.dumps(SAVE_RECEIPT_HOOK) + ';\n' \
            + SAVE_RECEIPT_HOOK + assertions
        result = subprocess.run([node], input=script,
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_worker_import_preserves_real_repository_exports_without_hook(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('Node unavailable; pure worker-realm guard not executed')
        repository = (ROOT / 'platform-repository-v19.js').read_text()
        script = 'const repositorySource=' + json.dumps(repository) + ';\n' \
            + 'const hookSource=' + json.dumps(SAVE_RECEIPT_HOOK) + ';\n' + r"""
const assert=require('node:assert/strict'),vm=require('node:vm');
for (const existingNamespace of [false,true]) {
  const realm={module:{exports:{}},structuredClone,performance,
    require:name=>{assert.equal(name,'./network-contract-v18.js');return require(name);}};
  if(existingNamespace)realm.STCTPlatformV19={sentinel:'worker namespace'};
  const namespace=realm.STCTPlatformV19;
  realm.self=realm;vm.createContext(realm);
  vm.runInContext(repositorySource,realm,{filename:'platform-repository-v19.js'});
  const exports=realm.module.exports;
  assert.equal(typeof exports.createRepository,'function');
  assert.equal(realm.document,undefined);assert.equal(realm.window,undefined);
  vm.runInContext(hookSource,realm,{filename:'acceptance-window-only-hook.js'});
  assert.equal(realm.module.exports,exports);
  assert.equal(realm.STCTPlatformV19,namespace);
  assert.equal(realm.__acceptanceSaveReceipt,undefined);
}
console.log('Pure snapshot-worker import preserves real repository exports PASS');
"""
        result = subprocess.run([node], input=script, cwd=ROOT,
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_backend_restart_pure_guards(self):
        from enterprise_backend_restart_case import backend_restart_guard_checks
        checks = backend_restart_guard_checks()
        self.assertTrue(checks, 'Restart guard module must report completed pure checks')


def main():
    if '--self-test' in sys.argv[1:] or '--guard' in sys.argv[1:]:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(AcceptanceGapGuardTests)
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    args = parse_args()
    if os.environ.get('STCT_GAP_WORKER') == '1':
        return GapSuite(args).run()
    return supervised_run(args, sys.argv[1:])


if __name__ == '__main__':
    raise SystemExit(main())
