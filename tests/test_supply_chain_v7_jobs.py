"""Controlled real-process lifecycle tests; native OR-Tools checks are named separately."""
import copy
import json
import os
from pathlib import Path
import signal
import socket
import tempfile
import urllib.error
import urllib.request
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'optimizer'))
import supply_chain_jobs_v6 as jobs

REAL_POPEN = subprocess.Popen
HASH = 'sha256:' + 'a' * 64


def spec():
    payload = {'schemaVersion': 'stct-facility-solve-request-v1.9-mvp1', 'requestId': 'SYNTHETIC-JOB', 'studyHash': HASH,
               'sites': [{'siteId': 'W', 'status': 'OPTIONAL', 'capacity': {'volume': None}, 'fixedCost': 0, 'handlingCostPerUnit': 0}],
               'demands': [{'demandId': 'D', 'demand': {'volume': 1}}],
               'matrix': {'rows': [{'siteId': 'W', 'demandId': 'D', 'distanceMeters': 1000, 'travelSeconds': 60}]},
               'options': {'facilityCounts': [1], 'timeLimitSeconds': 1, 'transportBasis': 'volume', 'transportCostPerUnitKm': 1, 'currency': 'CNY'}}
    return {'schemaVersion': 'stct-supply-chain-run-v6', 'studyHash': HASH, 'scenarioHash': 'sha256:' + 'b' * 64,
            'modelVersion': 'v6-cp-sat-1', 'budgetSeconds': 2, 'runSpecHash': 'sha256:' + 'c' * 64,
            'requests': [{'kind': 'FACILITY', 'phase': 'CANDIDATES', 'payload': payload}]}


def result_events(value=None):
    value = value or spec()
    result = {'schemaVersion': 'stct-facility-solve-result-v1.9-mvp1', 'requestId': value['requests'][0]['payload']['requestId'],
              'studyHash': value['studyHash'], 'results': [{'status': 'OPTIMAL'}], 'feasible': 1}
    return [{'event': 'STARTED'}, {'event': 'PHASE', 'phase': 'CANDIDATES'},
            {'event': 'RESULT', 'phase': 'CANDIDATES', 'result': result}, {'event': 'COMPLETE'}]


def program(events, suffix=''):
    return 'import json,sys,time\n' + ''.join(f'print({json.dumps(json.dumps(event))},flush=True)\n' for event in events) + suffix


def controlled(code):
    return patch.object(jobs.subprocess, 'Popen', side_effect=lambda *args, **kwargs: REAL_POPEN([sys.executable, '-c', code], **kwargs))


def await_done(manager, job_id, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = manager.get(job_id, True)
        assert value['completedAt'] is None or value['status'] in jobs.TERMINAL, value
        if value['completedAt'] and manager.jobs[job_id]['process'] is None:
            return value
        time.sleep(.01)
    raise AssertionError('worker did not reach reaped terminal state')


def assert_gone(pid):
    if pid is not None:
        with unittest.TestCase().assertRaises(OSError if os.name == 'nt' else ProcessLookupError):
            os.kill(pid, 0)


class ContractTests(unittest.TestCase):
    def test_worker_process_options_keep_host_specific_flags(self):
        self.assertEqual(jobs.worker_process_options('darwin'), {'start_new_session': True})
        with patch.object(jobs.subprocess, 'CREATE_NEW_PROCESS_GROUP', 512, create=True), patch.object(jobs.subprocess, 'CREATE_NO_WINDOW', 134217728, create=True):
            self.assertEqual(jobs.worker_process_options('win32'), {'creationflags': 134218240})

    def test_strict_envelope_adversarial_vectors(self):
        bad = [None, [], 'bad']
        for patch_value in [ {'requests': [None]}, {'requests': ['bad']}, {'requests': []}, {'studyHash': None}, {'studyHash': 'not-sha'},
                            {'scenarioHash': 2}, {'modelVersion': None}, {'modelVersion': 'unknown'}, {'budgetSeconds': True},
                            {'budgetSeconds': float('nan')}, {'budgetSeconds': float('inf')}, {'budgetSeconds': 0}, {'budgetSeconds': 301},
                            {'declaredBudgetSeconds': 3}, {'preparationSeconds': -1}, {'declaredBudgetSeconds': 3, 'preparationSeconds': .5}]:
            bad.append({**spec(), **patch_value})
        for patch_value in [{'kind': []}, {'kind': 'UNKNOWN'}, {'phase': 'UNKNOWN'}, {'payload': []}, {'phase': 'PLANNING_REFERENCE'}]:
            value = spec(); value['requests'][0].update(patch_value); bad.append(value)
        for patch_value in [{'schemaVersion': 'wrong'}, {'requestId': ''}, {'requestId': 3}, {'studyHash': 'wrong'}, {'reference': True}]:
            value = spec(); value['requests'][0]['payload'].update(patch_value); bad.append(value)
        value = spec(); value['requests'] *= 2; bad.append(value)
        value = spec(); value['requests'][0]['payload']['demands'] = [None]; bad.append(value)
        value = spec(); value['requests'][0]['payload']['demands'][0]['demand']['volume'] = float('nan'); bad.append(value)
        for value in bad:
            with self.subTest(spec=value), self.assertRaises(jobs.JobError):
                jobs.JobManager().start(value)
        print(json.dumps({'test': 'ADVERSARIAL_JOB_ENVELOPES', 'vectors': len(bad)}))

    def test_dependency_unavailable_rejected_before_acceptance(self):
        manager = jobs.JobManager()
        with patch.dict(os.environ, {'DISABLE_ORTOOLS': '1'}), self.assertRaises(jobs.JobError) as raised:
            manager.start(spec())
        self.assertEqual(raised.exception.code, 'ORTOOLS_UNAVAILABLE')
        self.assertEqual(raised.exception.status, 503)
        self.assertEqual(manager.jobs, {})


class ControlledLifecycleTests(unittest.TestCase):
    def run_program(self, code, value=None):
        manager = jobs.JobManager()
        with controlled(code):
            first = manager.start(value or spec())
            final = await_done(manager, first['jobId'])
        assert_gone(final['pid'])
        self.assertIsNone(manager.active_id)
        return final

    def test_pre_started_exit_terminal_with_bounded_redacted_stderr(self):
        code = 'import sys\nsys.stderr.write("SECRET_ADDRESS=private customer street\\n"*2000 + "ValueError: token-secret\\n")\nsys.exit(17)'
        final = self.run_program(code)
        self.assertEqual(final['status'], 'FAILED')
        self.assertEqual(final['exitCode'], 17)
        self.assertEqual(final['error']['code'], 'SUPPLY_JOB_WORKER_EXITED')
        self.assertEqual(final['error']['detail']['stage'], 'PREPARING')
        self.assertNotIn('SECRET_ADDRESS', json.dumps(final))
        self.assertNotIn('private customer street', json.dumps(final))
        self.assertNotIn('token-secret', json.dumps(final))
        self.assertIn('ValueError', final['stderrTail'])
        self.assertLessEqual(len(final['stderrTail']), 4096)

    def test_success_exit_without_complete_or_result_fails(self):
        for events in [[], [{'event': 'STARTED'}], [{'event': 'STARTED'}, {'event': 'COMPLETE'}], result_events()[:-1]]:
            with self.subTest(events=events):
                final = self.run_program(program(events))
                self.assertEqual(final['status'], 'FAILED')
                self.assertEqual(final['error']['code'], 'SUPPLY_JOB_WORKER_PROTOCOL_INCOMPLETE')

    def test_malformed_protocol_stops_owned_worker(self):
        codes = ['print("not-json",flush=True)\n', 'print("null",flush=True)\n', program([{'event': 'STARTED'}, {'event': 'SURPRISE'}]),
                 program([{'event': 'STARTED'}, {'event': 'PHASE', 'phase': 'PLANNING_REFERENCE'}]), program(result_events() + [{'event': 'STARTED'}])]
        for code in codes:
            with self.subTest(code=code):
                final = self.run_program(code + '\nimport time;time.sleep(30)')
                self.assertEqual(final['status'], 'FAILED')
                self.assertEqual(final['error']['code'], 'SUPPLY_JOB_WORKER_PROTOCOL_INVALID')

    def test_result_identity_failure_does_not_accept_result(self):
        events = result_events(); events[2]['result']['studyHash'] = 'wrong'
        final = self.run_program(program(events))
        self.assertEqual(final['error']['code'], 'SUPPLY_JOB_WORKER_RESULT_INVALID')
        self.assertEqual(final['resultPhases'], [])

    def test_failed_event_before_started_has_terminal(self):
        final = self.run_program(program([{'event': 'FAILED', 'error': {'code': 'SUPPLY_CONTROLLED_IMPORT_FAILURE', 'detail': {'secret': 'do-not-echo'}}}], 'sys.exit(1)'))
        self.assertEqual(final['status'], 'FAILED')
        self.assertEqual(final['error']['code'], 'SUPPLY_CONTROLLED_IMPORT_FAILURE')
        self.assertNotIn('do-not-echo', json.dumps(final))

    def test_actual_worker_import_failure_after_acceptance(self):
        manager = jobs.JobManager()
        worker = Path(jobs.__file__).with_name('supply_chain_job_worker_v6.py')
        with patch.object(jobs.subprocess, 'Popen', side_effect=lambda *args, **kwargs: REAL_POPEN([sys.executable, '-S', str(worker)], **kwargs)):
            first = manager.start(spec())
            final = await_done(manager, first['jobId'])
        self.assertEqual(final['status'], 'FAILED')
        self.assertEqual(final['exitCode'], 1)
        self.assertEqual(final['error']['detail']['exception'], 'ModuleNotFoundError')
        self.assertEqual(final['error']['detail']['stage'], 'PREPARING')
        assert_gone(final['pid'])

    def test_complete_protocol_and_nonzero_after_complete(self):
        self.assertEqual(self.run_program(program(result_events()))['status'], 'COMPLETE')
        final = self.run_program(program(result_events(), 'sys.exit(9)'))
        self.assertEqual(final['status'], 'FAILED')
        self.assertEqual(final['exitCode'], 9)

    def test_worker_signal_during_preparation_is_failure(self):
        final = self.run_program('import os,signal;os.kill(os.getpid(),signal.SIGTERM)')
        self.assertEqual(final['status'], 'FAILED')
        if os.name == 'nt':
            self.assertNotEqual(final['exitCode'], 0)
        else:
            self.assertEqual(final['exitCode'], -signal.SIGTERM)

    def test_cancel_preparing_solving_and_partial_retention(self):
        for events in [[], [{'event': 'STARTED'}], result_events()[:-1]]:
            manager = jobs.JobManager()
            sentinel = REAL_POPEN([sys.executable, '-c', 'import time;time.sleep(30)'])
            try:
                with controlled(program(events, 'time.sleep(30)')):
                    first = manager.start(spec())
                    for _ in range(200):
                        live = manager.get(first['jobId'], True)
                        if live['pid'] and (not events or live['status'] == 'SOLVING') and (len(events) < 3 or live['results']): break
                        time.sleep(.01)
                    start = time.monotonic()
                    cancelled = manager.cancel(first['jobId'])
                    final = await_done(manager, first['jobId'])
                self.assertEqual(cancelled['status'], 'CANCELLED')
                self.assertEqual(final['status'], 'CANCELLED')
                self.assertLess(time.monotonic()-start, 3)
                self.assertEqual(len(final['results']), 1 if len(events) >= 3 else 0)
                self.assertEqual(final['runSpecHash'], spec()['runSpecHash'])
                self.assertIsNone(sentinel.poll(), 'cancellation killed an unrelated process')
                assert_gone(final['pid'])
            finally:
                sentinel.terminate(); sentinel.wait(timeout=3)

    def test_budget_timeout_terminal_with_and_without_prior_result(self):
        for events in [[], result_events()[:-1]]:
            value = spec(); value['budgetSeconds'] = 1
            final = self.run_program(program(events, 'time.sleep(30)'), value)
            self.assertEqual(final['status'], 'PARTIAL')
            self.assertEqual(final['phase'], 'BUDGET_EXHAUSTED')
            self.assertEqual(final['error']['code'], 'SUPPLY_JOB_BUDGET_EXHAUSTED')
            self.assertEqual(len(final['results']), 1 if events else 0)

    def test_dedupe_ignores_measured_preparation_but_declared_budget_changes_identity(self):
        manager = jobs.JobManager(); value = spec()
        value.update(declaredBudgetSeconds=3, preparationSeconds=1)
        with controlled('import time;time.sleep(30)'):
            first = manager.start(value)
            second = copy.deepcopy(value); second.update(preparationSeconds=1.1, budgetSeconds=1.9, displayLanguage='ja')
            second['requests'][0]['payload']['requestId'] = 'NEW-TRANSPORT-ID'
            self.assertEqual(manager.start(second)['jobId'], first['jobId'])
            self.assertEqual(manager.get(first['jobId'])['acceptedRequestIds']['CANDIDATES'], 'SYNTHETIC-JOB')
            changed = copy.deepcopy(second); changed.update(declaredBudgetSeconds=4, budgetSeconds=2.9)
            with self.assertRaises(jobs.JobError) as caught:
                manager.start(changed)
            self.assertEqual(caught.exception.code, 'SUPPLY_JOB_BUSY')
            manager.cancel(first['jobId']); await_done(manager, first['jobId'])

    def test_pre_spawn_cancel_does_not_create_worker(self):
        manager = jobs.JobManager()
        with patch.object(jobs.threading.Thread, 'start'):
            first = manager.start(spec())
        manager.cancel(first['jobId'])
        with patch.object(jobs.subprocess, 'Popen') as popen:
            manager._run(manager.jobs[first['jobId']], spec())
            popen.assert_not_called()
        self.assertEqual(manager.get(first['jobId'])['status'], 'CANCELLED')


class NativeOrtoolsTests(unittest.TestCase):
    def test_native_facility_small_case_completes(self):
        manager = jobs.JobManager(); value = spec(); value['budgetSeconds'] = 5
        first = manager.start(value); final = await_done(manager, first['jobId'])
        self.assertEqual(final['status'], 'COMPLETE', final['error'])
        result = final['results']['CANDIDATES']
        self.assertEqual(result['engine']['id'], 'OR_TOOLS_CP_SAT')
        self.assertEqual(result['results'][0]['status'], 'OPTIMAL')
        self.assertEqual(result['results'][0]['selectedSiteIds'], ['W'])
        assert_gone(final['pid'])
        print(json.dumps({'test': 'NATIVE_ORTOOLS_FACILITY', 'engine': result['engine'], 'status': final['status'], 'elapsedSeconds': final['elapsedSeconds'], 'objectiveValue': result['results'][0].get('objectiveValue')}))


class HTTPAdmissionTests(unittest.TestCase):
    def test_http_admission_is_structured_and_local(self):
        for disabled in (False, True):
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0))
                port = listener.getsockname()[1]
            root = Path(__file__).resolve().parents[1]
            base = f'http://127.0.0.1:{port}'
            env = {**os.environ, 'OPT_PORT': str(port), 'DISABLE_ORTOOLS': '1' if disabled else '0'}
            with tempfile.TemporaryFile(mode='w+') as log:
                service = REAL_POPEN([sys.executable, 'optimizer/ortools_service.py'], cwd=root, env=env, stdout=log, stderr=log)
                def request(path, value=None, origin=None):
                    headers = {'Content-Type': 'application/json'}
                    if origin: headers['Origin'] = origin
                    req = urllib.request.Request(base + path, data=None if value is None else json.dumps(value).encode(), headers=headers)
                    try:
                        response = urllib.request.urlopen(req, timeout=5)
                    except urllib.error.HTTPError as error:
                        response = error
                    with response:
                        return response.status, json.load(response)
                try:
                    for _ in range(100):
                        if service.poll() is not None: raise AssertionError('owned service exited before health')
                        try:
                            status, health = request('/health')
                            if status == 200: break
                        except (OSError, urllib.error.URLError): time.sleep(.05)
                    else: raise AssertionError('owned service unavailable')
                    status, body = request('/supply-chain-jobs-v6', spec()) if disabled else (None, None)
                    if disabled:
                        self.assertEqual(status, 503)
                        self.assertEqual(body['error']['code'], 'ORTOOLS_UNAVAILABLE')
                    else:
                        for override in [{'requests': [None]}, {'requests': ['bad']}, {'studyHash': None}, {'budgetSeconds': -1}]:
                            status, body = request('/supply-chain-jobs-v6', {**spec(), **override})
                            self.assertEqual(status, 400)
                            self.assertIsInstance(body['error']['code'], str)
                        status, body = request('/supply-chain-jobs-v6', spec(), 'https://foreign.invalid')
                        self.assertEqual(status, 403)
                        self.assertEqual(request('/health')[0], 200)
                    print(json.dumps({'test': 'HTTP_JOB_ADMISSION', 'dependencyDisabled': disabled, 'servicePid': service.pid, 'confirmedFreeLoopbackPort': port, 'status': 'PASS'}))
                finally:
                    if service.poll() is None: service.terminate()
                    service.wait(timeout=5)
                assert_gone(service.pid)


if __name__ == '__main__':
    unittest.main(verbosity=2)
