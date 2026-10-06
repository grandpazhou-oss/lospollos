"""One real-backend restart with the existing synthetic UI page kept alive.

Only the genuine creation response is delayed. No health, job status, solver
result, error response or application state is manufactured. The interrupted
worker is witnessed alive, not claimed to have entered a native solver call.
The enclosing harness owns the browser, resource monitor and external watchdog.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

from enterprise_browser_soak_support import process_table
from test_enterprise_synthetic_full_ui import ROOT, action, state
from test_enterprise_ui_faults import wait_ui


TERMINAL = {'COMPLETE', 'PARTIAL', 'CANCELLED', 'FAILED'}
EXPECTED_404_CONSOLE = 'Failed to load resource: the server responded with a status of 404 (Not Found)'


def _require_identity(table, identity, parent=None):
    row = table.get(identity['pid'])
    assert row is not None, 'D8_OWNED_PROCESS_DISAPPEARED'
    assert row['startTicks'] == identity['startTicks'], 'D8_PID_REUSED'
    assert row['state'] != 'Z', 'D8_OWNED_PROCESS_ALREADY_ZOMBIE'
    if parent is not None:
        assert row['ppid'] == parent, 'D8_WORKER_PARENT_MISMATCH'
    return row


def _require_job(body, created, build):
    for field in ('jobId', 'runSpecHash', 'studyHash', 'backendInstanceId'):
        assert body.get(field) == created.get(field) and body.get(field), 'D8_JOB_IDENTITY_MISMATCH:' + field
    assert body.get('backendBuildFingerprint') == build, 'D8_JOB_BUILD_MISMATCH'
    assert body.get('status') not in TERMINAL, 'D8_RESTART_WINDOW_MISSED_JOB_ALREADY_TERMINAL'


def _require_new_health(body, old, build, origin):
    assert body.get('available') is True and body.get('dependencies', {}).get('supplyChainReady') is True
    assert body.get('buildFingerprint') == build, 'D8_RESTART_CHANGED_TRUSTED_BUILD'
    assert body.get('endpoint') == origin, 'D8_RESTART_CHANGED_ENDPOINT'
    assert body.get('instanceId') and body['instanceId'] != old['instanceId'], 'D8_INSTANCE_DID_NOT_CHANGE'


def _require_old_job_missing(status, body):
    assert status == 404 and body.get('error', {}).get('code') == 'SUPPLY_JOB_NOT_FOUND', 'D8_OLD_JOB_SURVIVED_RESTART'
    assert 'results' not in body, 'D8_MISSING_JOB_RETURNED_RESULTS'


def _require_expected_http_errors(rows, job_url):
    assert rows, 'D8_REAL_BROWSER_OLD_JOB_404_NOT_OBSERVED'
    allowed = {('GET', job_url), ('POST', job_url + '/cancel')}
    assert all(row['status'] == 404 and (row['method'], row['url']) in allowed
               for row in rows), 'D8_UNEXPECTED_HTTP_ERROR:' + json.dumps(rows)
    assert any(row['method'] == 'GET' and row['url'] == job_url for row in rows), 'D8_OLD_JOB_POLL_404_MISSING'


def _interruption_guidance(messages):
    text = ' '.join(messages).lower()
    lost = bool(re.search(r'(任务|计算).{0,28}(不存在|丢失|无法继续|不能继续|不可继续|不再可用)|'
                          r'(job|computation|run).{0,60}(lost|no longer exists|cannot continue|not available)|'
                          r'(ジョブ|計算).{0,28}(失われ|存在し|継続でき)', text))
    retry = any(token in text for token in ('重试', '重新分析', '重新计算', 'retry', 'rerun', '再試行', '再分析'))
    return {'lostTaskExplained': lost, 'retryExplained': retry, 'complete': lost and retry}


def _launcher_module():
    spec = importlib.util.spec_from_file_location('_stct_restart_launcher', ROOT / 'scripts/local_trial.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _verify_command(identity, expected):
    _require_identity(process_table(), identity)
    args = (Path('/proc') / str(identity['pid']) / 'cmdline').read_bytes().split(b'\0')
    assert os.fsencode(str(expected)) in args, 'D8_OWNED_PROCESS_COMMAND_MISMATCH'
    _require_identity(process_table(), identity)


def _signal_exact(identity):
    """Signal one previously owned backend using Linux PIDFD and start ticks."""
    assert hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'), 'D8_PIDFD_REQUIRED'
    _require_identity(process_table(), identity)
    fd = os.pidfd_open(identity['pid'])
    try:
        _require_identity(process_table(), identity)
        signal.pidfd_send_signal(fd, signal.SIGKILL)
    finally:
        os.close(fd)


def _wait_exited(suite, identities, seconds=4):
    deadline = time.monotonic() + seconds
    while True:
        suite.check_budget()
        table = process_table()
        remaining = [row for row in identities if row['pid'] in table and
                     table[row['pid']]['startTicks'] == row['startTicks']]
        if not remaining:
            return
        assert time.monotonic() < deadline, 'D8_OWNED_PROCESS_EXIT_NOT_CONFIRMED:' + json.dumps(remaining)
        suite.page.wait_for_timeout(20)


class GenuineCreationGate:
    """Delay one unchanged real 202 while an owned worker is interrupted."""
    def __init__(self, suite):
        self.suite = suite
        self.pending = None
        self.created = None
        self.captured_at = None
        self.received = False
        self.failed = None
        self.installed = False

    def _create(self, route):
        if route.request.method != 'POST':
            route.fallback()
            return
        assert self.pending is None and self.created is None, 'D8_UNEXPECTED_EXTRA_CREATION_REQUEST'
        response = route.fetch(timeout=5000)
        body = response.json()
        assert response.status == 202 and body.get('jobId'), 'D8_REAL_JOB_NOT_ACCEPTED'
        assert body.get('status') not in TERMINAL, 'D8_RESTART_WINDOW_MISSED_AT_CREATION'
        self.created = body
        self.pending = (route, response, response.body())
        self.captured_at = time.monotonic()
        self.suite.owned_jobs[body['jobId']] = body

    def _received(self, response):
        if response.request.method == 'POST' and response.url == self.suite.job_base:
            self.received = True

    def _failed(self, request):
        if request.method == 'POST' and request.url == self.suite.job_base:
            self.failed = request.failure

    def install(self):
        self.suite.page.route(self.suite.job_base, self._create)
        self.suite.page.on('response', self._received)
        self.suite.page.on('requestfailed', self._failed)
        self.installed = True
        return self

    def release(self):
        assert self.pending is not None
        held_seconds = time.monotonic() - self.captured_at
        assert held_seconds < 8.5, 'D8_RESTART_TIMING_EXCEEDED_CREATION_TIMEOUT_MARGIN'
        route, response, raw = self.pending
        route.fulfill(response=response, body=raw)
        self.pending = None
        return {'heldSeconds': round(held_seconds, 3),
                'creationResponseSHA256': hashlib.sha256(raw).hexdigest(),
                'creationResponseBodyUnchanged': True}

    def remove(self, navigated=False):
        if self.installed:
            self.suite.page.unroute(self.suite.job_base, self._create)
            self.suite.page.remove_listener('response', self._received)
            self.suite.page.remove_listener('requestfailed', self._failed)
            self.installed = False
        if self.pending:
            route, _, _ = self.pending
            self.pending = None
            route.abort()


def run_backend_restart_case(suite):
    """Needs FaultSuite after import_workbook plus budget/ownership hooks."""
    suite.begin('D8_LIVE_PAGE_REAL_BACKEND_RESTART')
    suite.configure('OUTBOUND_ONLY')
    suite.check_budget()
    assert suite.result['consoleErrors'] == [], 'D8_PREEXISTING_CONSOLE_ERROR'
    assert len(suite.context.pages) <= 2
    page = suite.page
    page_url = page.url
    realm_started = page.evaluate('performance.timeOrigin')
    frame_navigations = []
    http_errors = []
    def frame_navigated(frame):
        if frame == page.main_frame:
            frame_navigations.append(frame.url)
    page.on('framenavigated', frame_navigated)
    def observed_response(response):
        if response.status >= 400:
            http_errors.append({'url': response.url, 'method': response.request.method,
                                'status': response.status})
    page.on('response', observed_response)
    origin = f'http://127.0.0.1:{suite.opt_port}'
    old_health_response = suite.context.request.get(origin + '/health', timeout=3000)
    assert old_health_response.ok
    old_health = old_health_response.json()
    build = suite.record['backendBuildFingerprint']
    assert old_health['buildFingerprint'] == build
    old_record = json.loads(json.dumps(suite.record))
    launcher = _launcher_module()
    for kind in ('web', 'optimizer'):
        assert launcher.ownership(old_record[kind], kind) == 'OWNED', 'D8_LAUNCHER_OWNERSHIP_MISMATCH'
    table = process_table()
    backend = {'pid': old_record['optimizer']['pid'],
               'startTicks': suite.monitor.roots[old_record['optimizer']['pid']]}
    _require_identity(table, backend)
    _verify_command(backend, ROOT / 'optimizer/ortools_service.py')
    detail = suite.result['backendRestart'] = {
        'method': 'REAL_OWNED_BACKEND_SIGKILL_SAME_PAGE_GENUINE_HTTP_TIMING',
        'oldBackend': backend, 'oldInstanceId': old_health['instanceId'],
        'samePage': True, 'reloads': 0, 'fabricatedResponses': False,
        'workerStageClaim': 'REAL_WORKER_STARTED_NOT_PROOF_OF_CP_SAT_ENTRY',
        'status': 'RUNNING'}
    suite.write()
    gate = suite.active_gate = GenuineCreationGate(suite).install()
    try:
        before_posts = len(suite.solve_posts())
        action(page, 'analyze').click()
        wait_ui(page, lambda _: gate.pending is not None, 'D8 genuine creation response held', timeout=8)
        created = gate.created
        detail['oldJobId'] = created['jobId']
        assert created['backendInstanceId'] == old_health['instanceId']
        pending_state = state(page)
        assert pending_state['study']['inputHash'] == created['studyHash']
        assert pending_state.get('snapshot') is None
        assert len(suite.solve_posts()) == before_posts + 1
        worker_deadline = time.monotonic() + 2
        while True:
            suite.check_budget()
            response = suite.context.request.get(suite.job_base + '/' + created['jobId'], timeout=1000)
            assert response.ok
            live_job = response.json()
            _require_job(live_job, created, build)
            if live_job.get('pid'):
                break
            assert time.monotonic() < worker_deadline, 'D8_WORKER_DID_NOT_START'
            page.wait_for_timeout(10)
        table = process_table()
        worker = {'pid': live_job['pid'], 'startTicks': table[live_job['pid']]['startTicks']}
        _require_identity(table, worker, parent=backend['pid'])
        _verify_command(worker, ROOT / 'optimizer/supply_chain_job_worker_v6.py')
        suite.register_service_roots(extra_roots=[worker])
        detail.update(oldWorker=worker, actualWorkerStatus=live_job['status'],
                      actualWorkerPhase=live_job['phase'], acceptedRunSpecHash=created['runSpecHash'],
                      inputHashBeforeRestart=pending_state['study']['inputHash'],
                      savedPointerBeforeRestart=pending_state.get('savedPointer'))
        suite.write()
        # Keep the capture-to-signal window short. Do not wait for a human-speed
        # UI poll or change the tiny solver payload merely to make it run longer.
        _require_identity(process_table(), worker, parent=backend['pid'])
        _signal_exact(backend)
        detail['backendSignal'] = 'SIGKILL_PIDFD_START_TICKS_VERIFIED'
        _wait_exited(suite, [backend, worker])
        detail['oldBackendAndWorkerExited'] = True

        # The production launcher refuses a half-running instance. Stop its
        # remaining owned web process and restart both on their unchanged ports.
        # The already-loaded page and JS realm stay alive; this is not a reload.
        for name, command in (
            ('stop', ['stop']),
            ('start', ['start', '--web-port', str(suite.web_port), '--opt-port', str(suite.opt_port)]),
        ):
            suite.check_budget()
            done = subprocess.run([sys.executable, str(ROOT / 'scripts/local_trial.py'), *command],
                                  cwd=ROOT, env=suite.env, capture_output=True, text=True, timeout=16)
            (suite.evidence / f'd8-launcher-{name}.log').write_text(suite.scrub(done.stdout + done.stderr), encoding='utf-8')
            assert done.returncode == 0, 'D8_OWNED_LAUNCHER_' + name.upper() + '_FAILED'
        new_record = json.loads((suite.run_dir / 'trial.json').read_text(encoding='utf-8'))
        assert new_record['schema'] == old_record['schema'] and new_record['root'] == str(ROOT)
        assert new_record['backendBuildFingerprint'] == build
        assert new_record['web']['port'] == suite.web_port and new_record['optimizer']['port'] == suite.opt_port
        suite.record = new_record
        suite.register_service_roots()
        restarted_health = suite.context.request.get(origin + '/health', timeout=2000)
        assert restarted_health.ok
        new_health = restarted_health.json()
        _require_new_health(new_health, old_health, build, origin)
        missing = suite.context.request.get(suite.job_base + '/' + created['jobId'] + '?results=1', timeout=2000)
        _require_old_job_missing(missing.status, missing.json())
        suite.owned_jobs.pop(created['jobId'])  # Its verified old instance is gone.
        detail.update(newInstanceId=new_health['instanceId'], oldJobHttpStatus=missing.status,
                      oldJobError=missing.json()['error']['code'],
                      newBackend={'pid': new_record['optimizer']['pid'],
                                  'startTicks': suite.monitor.roots[new_record['optimizer']['pid']]},
                      staticWebAlsoRestarted=True, sameOptimizerPort=suite.opt_port)
        detail.update(gate.release())
        failed_state = wait_ui(page, lambda s: s.get('status') == 'FAILED' and
                              (s.get('lastError') or {}).get('code') == 'SUPPLY_JOB_NOT_FOUND',
                              'D8 same live page must reject actual missing old job', timeout=12)
        assert gate.received and gate.failed is None, 'D8_GENUINE_CREATION_RESPONSE_NOT_RECEIVED'
        assert failed_state['study'] == pending_state['study'], 'D8_STUDY_CHANGED_DURING_RESTART'
        assert failed_state.get('savedPointer') == pending_state.get('savedPointer'), 'D8_SAVED_AUTHORITY_CHANGED'
        assert failed_state.get('snapshot') is None and not failed_state.get('candidates'), 'D8_FALSE_CURRENT_RESULT'
        assert failed_state['job']['jobId'] == created['jobId']
        assert failed_state['job']['status'] not in ('COMPLETE', 'PARTIAL'), 'D8_OLD_JOB_FAKED_TERMINAL_SUCCESS'
        assert page.url == page_url and page.evaluate('performance.timeOrigin') == realm_started
        assert frame_navigations == [], 'D8_PAGE_RELOADED_OR_NAVIGATED'
        assert len(suite.solve_posts()) == before_posts + 1, 'D8_OLD_JOB_AUTOMATICALLY_RESUBMITTED'
        messages = page.locator('.sc-message.is-error:visible').all_text_contents()
        assert messages and any(text.strip() for text in messages), 'D8_FAILURE_NOT_VISIBLE'
        assert action(page, 'analyze').is_enabled(), 'D8_RETRY_CONTROL_NOT_AVAILABLE'
        detail.update(uiStatus=failed_state['status'], uiError=failed_state['lastError']['code'],
                      visibleMessages=messages, noFalseSuccess=True, studyPreserved=True,
                      savedAuthorityPreserved=True, automaticResubmission=False, retryEnabled=True,
                      interruptionExplanation=_interruption_guidance(messages))
        _require_expected_http_errors(http_errors, suite.job_base + '/' + created['jobId'])
        detail['actualBrowserHttpErrors'] = http_errors
        suite.screenshot('d8-restart-old-job-rejected')
        suite.passed(**{key: value for key, value in detail.items() if key != 'status'})
    finally:
        gate.remove()
        suite.active_gate = None
        page.remove_listener('framenavigated', frame_navigated)
        suite.result['expectedControlledHttpConsoleErrors'] = sorted(set(
            suite.result.get('expectedControlledHttpConsoleErrors', []) + [EXPECTED_404_CONSOLE]))

    # An unmodified real native retry on the retained page is independently
    # verified by the same Python ledger/oracle used in ordinary acceptance.
    current = suite.native_retry('D8_SAME_PAGE_NATIVE_RETRY')
    assert current['job']['jobId'] != detail['oldJobId']
    assert current['snapshot']['backendIdentity']['instanceId'] == detail['newInstanceId']
    assert current['study']['inputHash'] == detail['inputHashBeforeRestart']
    assert page.url == page_url and page.evaluate('performance.timeOrigin') == realm_started
    _require_expected_http_errors(http_errors, suite.job_base + '/' + detail['oldJobId'])
    page.remove_listener('response', observed_response)
    detail.update(status='PASS', newJobId=current['job']['jobId'],
                  newSnapshotHash=current['snapshot']['snapshotHash'],
                  independentNativeRetry=True, noReloadBeforeOrAfterRetry=True)
    suite.write()
    # Complete the real safety/recovery chain before deciding the separate
    # user-facing clarity requirement. FAILED is a valid internal state; the
    # visible message must explain why the old in-memory job cannot continue.
    suite.begin('D8_INTERRUPTION_EXPLANATION')
    if not detail['interruptionExplanation']['complete']:
        detail['status'] = 'SAFETY_AND_NATIVE_RETRY_PASS_EXPLANATION_FAIL'
        suite.write()
        raise AssertionError('D8_INTERRUPTION_EXPLANATION_INCOMPLETE:' + json.dumps(
            {'uiError': detail['uiError'], 'visibleMessages': detail['visibleMessages'],
             'retryEnabled': detail['retryEnabled']}, ensure_ascii=False))
    suite.passed(visibleMessages=detail['visibleMessages'], **detail['interruptionExplanation'])


def backend_restart_guard_checks():
    """Pure negative controls; no process, browser, socket, or signal is used."""
    checked = []
    identity = {'pid': 7, 'startTicks': 10}
    row = {'pid': 7, 'startTicks': 10, 'ppid': 3, 'state': 'S'}
    assert _require_identity({7: row}, identity, parent=3) == row
    def rejects(name, callback):
        try:
            callback()
        except AssertionError:
            checked.append(name)
        else:
            raise AssertionError('Guard admitted ' + name)
    rejects('missing_owned_pid', lambda: _require_identity({}, identity))
    rejects('pid_reuse', lambda: _require_identity({7: {**row, 'startTicks': 11}}, identity))
    rejects('zombie_is_not_live_worker', lambda: _require_identity({7: {**row, 'state': 'Z'}}, identity))
    rejects('foreign_worker_parent', lambda: _require_identity({7: row}, identity, parent=4))
    job = {'jobId': 'j', 'runSpecHash': 'r', 'studyHash': 's', 'backendInstanceId': 'i',
           'backendBuildFingerprint': 'pin', 'status': 'PREPARING'}
    _require_job(job, job, 'pin')
    for field in ('jobId', 'runSpecHash', 'studyHash', 'backendInstanceId', 'backendBuildFingerprint'):
        rejects('changed_' + field, lambda field=field: _require_job({**job, field: 'other'}, job, 'pin'))
    for status in sorted(TERMINAL):
        rejects('terminal_' + status, lambda status=status: _require_job({**job, 'status': status}, job, 'pin'))
    health = {'available': True, 'dependencies': {'supplyChainReady': True},
              'instanceId': 'new', 'endpoint': 'origin', 'buildFingerprint': 'pin'}
    _require_new_health(health, {'instanceId': 'old'}, 'pin', 'origin')
    rejects('same_instance_after_restart', lambda: _require_new_health(health, {'instanceId': 'new'}, 'pin', 'origin'))
    rejects('changed_pin_after_restart', lambda: _require_new_health(health, {'instanceId': 'old'}, 'other', 'origin'))
    rejects('changed_endpoint_after_restart', lambda: _require_new_health(health, {'instanceId': 'old'}, 'pin', 'different'))
    missing = {'error': {'code': 'SUPPLY_JOB_NOT_FOUND'}}
    _require_old_job_missing(404, missing)
    rejects('old_job_200', lambda: _require_old_job_missing(200, missing))
    rejects('unrelated_404', lambda: _require_old_job_missing(404, {'error': {'code': 'NOT_FOUND'}}))
    rejects('missing_job_has_results', lambda: _require_old_job_missing(404, {**missing, 'results': {}}))
    http = {'status': 404, 'method': 'GET', 'url': 'origin/jobs/old'}
    _require_expected_http_errors([http], 'origin/jobs/old')
    rejects('browser_404_not_observed', lambda: _require_expected_http_errors([], 'origin/jobs/old'))
    rejects('unrelated_browser_404', lambda: _require_expected_http_errors(
        [{**http, 'url': 'origin/static/missing.js'}], 'origin/jobs/old'))
    rejects('other_browser_error', lambda: _require_expected_http_errors(
        [{**http, 'status': 500}], 'origin/jobs/old'))
    rejects('cancel_only_404_is_insufficient', lambda: _require_expected_http_errors(
        [{**http, 'method': 'POST', 'url': 'origin/jobs/old/cancel'}], 'origin/jobs/old'))
    assert not _interruption_guidance(['本次操作未完成，当前结果未更新。请核对数据和本地求解服务后重试。'])['complete']
    assert _interruption_guidance(['原任务已不存在，无法继续；当前输入保留，请重新分析。'])['complete']
    checked.append('lost_job_explanation_distinguished_from_generic_retry')
    return checked
