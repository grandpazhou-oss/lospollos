"""Controlled processes/HTTP only: these tests do NOT execute native OR-Tools.

The worker-entrypoint tests replace its solver imports with explicit controlled
functions. Resource ownership, real process exit, HTTP status and restart identity
are tested independently of solver mathematics. All servers bind a free loopback
port; all processes are created and cleaned up by these tests.
"""
from contextlib import ExitStack
import concurrent.futures
import json
from pathlib import Path
import queue
import socket
import subprocess
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'optimizer'), str(ROOT / 'tests')]
import supply_chain_jobs_v6 as jobs
from solve_admission import SolveAdmission, SolverBusy
from test_supply_chain_v7_jobs import (REAL_POPEN, await_done, controlled, program,
                                      result_events, spec)


# Only the dependency and computation imports are replaced. The actual worker
# entrypoint, request validation, ownership watcher and event loop are executed.
WORKER_BOOTSTRAP = '''import runpy,sys,time,types
sys.path.insert(0,sys.argv[1])
for name in ('ortools','ortools.sat','ortools.sat.python','ortools.sat.python.cp_model'):
 sys.modules[name]=types.ModuleType(name)
sys.modules['ortools'].__version__='CONTROLLED_TEST_NOT_NATIVE'
def controlled_solve(payload,*args,**kwargs):
 if sys.argv[2]=='block':
  time.sleep(30)
  raise RuntimeError('Controlled computation must not complete')
 return {'schemaVersion':'stct-facility-solve-result-v1.9-mvp1',
         'requestId':payload['requestId'],'studyHash':payload['studyHash'],
         'results':[],'feasible':0,'engine':{'id':'CONTROLLED_TEST_NOT_NATIVE'}}
for name,function in [('facility_mvp1','solve_facility'),('supply_chain_joint_v19','solve_joint')]:
 module=types.ModuleType(name);setattr(module,function,controlled_solve);sys.modules[name]=module
runpy.run_path(sys.argv[1]+'/supply_chain_job_worker_v6.py',run_name='__main__')
'''


def wait_for(predicate, timeout=3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.005)
    raise AssertionError('Controlled lifecycle condition did not become true')


class OwnershipPipeTests(unittest.TestCase):
    def run_worker(self, behavior):
        process = REAL_POPEN([sys.executable, '-c', WORKER_BOOTSTRAP,
                              str(ROOT / 'optimizer'), behavior],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True,
                             **jobs.worker_process_options())
        events = queue.Queue()
        def read():
            for line in process.stdout:
                events.put(json.loads(line))
            events.put(None)
        reader = threading.Thread(target=read, daemon=True)
        reader.start()
        def cleanup():
            if process.poll() is None:
                process.kill()
            process.wait(timeout=3)
            reader.join(timeout=2)
            for stream in (process.stdin, process.stdout, process.stderr):
                stream.close()
        self.addCleanup(cleanup)
        process.stdin.write(json.dumps(spec()) + '\n')
        process.stdin.flush()
        return process, events

    def test_actual_worker_exits_nonzero_when_parent_pipe_is_lost(self):
        process, events = self.run_worker('block')
        self.assertEqual(events.get(timeout=3)['event'], 'STARTED')
        self.assertEqual(events.get(timeout=3)['event'], 'PHASE')
        self.assertIsNone(process.poll())
        process.stdin.close()  # Same EOF caused by abrupt backend termination.
        self.assertNotEqual(process.wait(timeout=3), 0)
        self.assertIsNone(events.get(timeout=3), 'lost owner must not emit COMPLETE')

    def test_actual_worker_completes_cleanly_with_owner_pipe_open(self):
        process, events = self.run_worker('complete')
        self.assertEqual(process.wait(timeout=3), 0, process.stderr.read())
        self.assertFalse(process.stdin.closed)
        actual = []
        while True:
            event = events.get(timeout=3)
            if event is None:
                break
            actual.append(event)
        self.assertEqual([event['event'] for event in actual],
                         ['STARTED', 'PHASE', 'RESULT', 'COMPLETE'])
        self.assertEqual(actual[2]['result']['engine']['id'], 'CONTROLLED_TEST_NOT_NATIVE')

    def test_manager_and_actual_worker_share_ownership_pipe_protocol(self):
        gate = SolveAdmission()
        manager = jobs.JobManager(gate)
        with patch.object(jobs, 'check_dependencies'), patch.object(
                jobs.subprocess, 'Popen', side_effect=lambda *args, **kwargs:
                REAL_POPEN([sys.executable, '-c', WORKER_BOOTSTRAP,
                            str(ROOT / 'optimizer'), 'complete'], **kwargs)):
            first = manager.start(spec())
            final = await_done(manager, first['jobId'])
        self.assertEqual(final['status'], 'COMPLETE', final)
        self.assertEqual(final['exitCode'], 0)
        self.assertEqual(final['results']['CANDIDATES']['engine']['id'], 'CONTROLLED_TEST_NOT_NATIVE')
        self.assertFalse(gate.busy)


class ResourceLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.dependencies = patch.object(jobs, 'check_dependencies')
        self.dependencies.start()
        self.addCleanup(self.dependencies.stop)

    def test_repeat_pre_spawn_cancel_keeps_lease_until_finalizer(self):
        gate = SolveAdmission()
        manager = jobs.JobManager(gate)
        with patch.object(jobs.threading.Thread, 'start'):
            first = manager.start(spec())
        for _ in range(3):
            self.assertEqual(manager.cancel(first['jobId'])['status'], 'CANCELLED')
            self.assertTrue(gate.busy)
            with self.assertRaises(SolverBusy):
                gate.acquire('retained-sync-endpoint')
        changed = spec()
        changed['scenarioHash'] = 'sha256:' + 'd' * 64
        with self.assertRaises(jobs.JobError) as raised:
            manager.start(changed)
        self.assertEqual(raised.exception.status, 429)
        with patch.object(jobs.subprocess, 'Popen') as popen:
            manager._run(manager.jobs[first['jobId']], spec())
            popen.assert_not_called()
        self.assertFalse(gate.busy)
        self.assertIsNone(manager.active_id)
        self.assertIsNone(manager.get(first['jobId'])['pid'])

    def test_cancellation_during_process_creation_never_releases_early(self):
        gate = SolveAdmission()
        manager = jobs.JobManager(gate)
        spawning, spawn_allowed = threading.Event(), threading.Event()
        def spawn(*args, **kwargs):
            spawning.set()
            if not spawn_allowed.wait(3):
                raise RuntimeError('test spawn release missing')
            return REAL_POPEN([sys.executable, '-c', 'import time;time.sleep(30)'], **kwargs)
        try:
            with patch.object(jobs.subprocess, 'Popen', side_effect=spawn):
                first = manager.start(spec())
                self.assertTrue(spawning.wait(3))
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(manager.cancel, first['jobId'])
                    self.assertTrue(gate.busy)
                    with self.assertRaises(SolverBusy):
                        gate.acquire('sync-during-spawn')
                    spawn_allowed.set()
                    self.assertEqual(future.result(timeout=4)['status'], 'CANCELLED')
                final = await_done(manager, first['jobId'])
                self.assertEqual(final['status'], 'CANCELLED')
                self.assertIsNotNone(final['exitCode'])
                self.assertFalse(gate.busy)
        finally:
            spawn_allowed.set()
            if manager.active_id:
                manager.cancel(manager.active_id)
                await_done(manager, manager.active_id or first['jobId'])

    def test_abnormal_exit_and_timeout_recover_without_false_success(self):
        gate = SolveAdmission()
        manager = jobs.JobManager(gate)
        for code, status, error in [
            ('import sys;sys.exit(19)', 'FAILED', 'SUPPLY_JOB_WORKER_EXITED'),
            (program(result_events(), 'sys.exit(19)'), 'FAILED', 'SUPPLY_JOB_WORKER_EXITED'),
            ('import time;time.sleep(30)', 'PARTIAL', 'SUPPLY_JOB_BUDGET_EXHAUSTED'),
        ]:
            with self.subTest(expected=status, error=error), controlled(code):
                value = spec()
                value['budgetSeconds'] = 1
                first = manager.start(value)
                final = await_done(manager, first['jobId'])
                self.assertEqual(final['status'], status, final)
                self.assertEqual(final['error']['code'], error)
                self.assertIsNotNone(final['exitCode'])
                self.assertFalse(gate.busy)
        with controlled(program(result_events())):
            first = manager.start(spec())
            self.assertEqual(await_done(manager, first['jobId'])['status'], 'COMPLETE')
        self.assertFalse(gate.busy)

    def test_broken_stdin_close_does_not_skip_other_pipe_cleanup(self):
        gate = SolveAdmission()
        manager = jobs.JobManager(gate)
        processes = []
        class BrokenInput:
            def __init__(self, stream):
                self.stream = stream
            def write(self, value):
                raise BrokenPipeError('controlled early worker exit')
            def close(self):
                self.stream.close()
                raise BrokenPipeError('controlled buffered close failure')
        def spawn(*args, **kwargs):
            process = REAL_POPEN([sys.executable, '-c', 'import sys;sys.exit(19)'], **kwargs)
            process.stdin = BrokenInput(process.stdin)
            processes.append(process)
            return process
        with patch.object(jobs.subprocess, 'Popen', side_effect=spawn):
            first = manager.start(spec())
            final = await_done(manager, first['jobId'])
            wait_for(lambda: processes[0].stdout.closed and processes[0].stderr.closed)
        self.assertEqual(final['status'], 'FAILED')
        self.assertFalse(gate.busy)


class ControlledHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Preserve the real runtime-manifest verification; no stale-pin bypass.
        import ortools_service
        cls.service = ortools_service

    def setUp(self):
        service = self.service
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.gate = SolveAdmission()
        self.manager = jobs.JobManager(self.gate)
        for name, value in [('JOBS', self.manager), ('SOLVE_ADMISSION', self.gate),
                            ('pywrapcp', object()), ('cp_model', object())]:
            self.stack.enter_context(patch.object(service, name, value))
        self.stack.enter_context(patch.object(jobs, 'check_dependencies'))
        self.server = service.ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = 'http://127.0.0.1:' + str(self.server.server_port)
        def cleanup():
            active = self.manager.active_id
            if active:
                self.manager.cancel(active)
                await_done(self.manager, active)
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(3)
        self.addCleanup(cleanup)

    def request(self, path, payload=None):
        request = urllib.request.Request(self.base + path,
            data=None if payload is None else json.dumps(payload).encode(),
            headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as response:
            return response.code, json.load(response)

    def test_actual_job_rejects_all_sync_routes_and_recovers_after_cancel(self):
        routes = ['/optimize', '/reoptimize-v16', '/facility-optimize-v19',
                  '/supply-chain-optimize-v19']
        with controlled(program([{'event': 'STARTED'}], 'time.sleep(30)')):
            status, first = self.request('/supply-chain-jobs-v6', spec())
            self.assertEqual(status, 202)
            wait_for(lambda: self.manager.get(first['jobId'])['status'] == 'SOLVING')
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                responses = list(pool.map(lambda path: self.request(path, {}), routes * 2))
            self.assertTrue(all(status == 429 and body['error']['code'] == 'SUPPLY_JOB_BUSY'
                                for status, body in responses), responses)
            for _ in range(3):
                status, body = self.request('/supply-chain-jobs-v6/' + first['jobId'] + '/cancel', {})
                self.assertEqual((status, body['status']), (200, 'CANCELLED'))
            final = await_done(self.manager, first['jobId'])
            self.assertEqual(final['status'], 'CANCELLED')
            self.assertFalse(self.gate.busy)
        with controlled(program(result_events())):
            status, next_job = self.request('/supply-chain-jobs-v6', spec())
            self.assertEqual(status, 202)
            self.assertNotEqual(next_job['jobId'], first['jobId'])
            self.assertEqual(await_done(self.manager, next_job['jobId'])['status'], 'COMPLETE')

    def test_sync_disconnect_holds_lease_until_computation_finishes(self):
        entered, release = threading.Event(), threading.Event()
        def compute(*args, **kwargs):
            entered.set()
            if not release.wait(3):
                raise RuntimeError('test did not release controlled compute')
            return {'controlledNotNative': True}
        with patch.object(self.service, 'solve_facility', side_effect=compute):
            connection = socket.create_connection(self.server.server_address, timeout=3)
            try:
                connection.sendall(('POST /facility-optimize-v19 HTTP/1.1\r\nHost: ' +
                    str(self.server.server_address[0]) + '\r\nContent-Length: 2\r\n\r\n{}').encode())
                self.assertTrue(entered.wait(3))
                connection.shutdown(socket.SHUT_RDWR)
                connection.close()
                self.assertTrue(self.gate.busy)
                self.assertEqual(self.request('/supply-chain-jobs-v6', spec())[0], 429)
            finally:
                release.set()
                connection.close()
            wait_for(lambda: not self.gate.busy)
            self.assertEqual(self.request('/facility-optimize-v19', {})[0], 200)

    def test_response_disconnect_does_not_attempt_another_response(self):
        for stage in ('headers', 'body'):
            with self.subTest(stage=stage):
                handler = object.__new__(self.service.Handler)
                handler.headers = {}
                handler.send_response = Mock()
                handler.send_header = Mock()
                handler.end_headers = Mock(side_effect=BrokenPipeError() if stage == 'headers' else None)
                handler.wfile = Mock()
                handler.wfile.write.side_effect = ConnectionResetError()
                handler._send(200, {'controlledNotNative': True})
                handler.send_response.assert_called_once_with(200)
                self.assertTrue(handler.close_connection)

    def test_cooperative_sync_deadline_does_not_claim_forced_preemption(self):
        entered, release = threading.Event(), threading.Event()
        deadlines = []
        def compute(*args, **kwargs):
            deadlines.append(kwargs['deadline'])
            entered.set()
            if not release.wait(3):
                raise RuntimeError('test did not release controlled compute')
            return {'controlledNotNative': True}
        try:
            with patch.object(self.service, 'MAX_SOLVE_SECONDS', .04), patch.object(
                    self.service, 'solve_facility', side_effect=compute):
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    result = pool.submit(self.request, '/facility-optimize-v19', {})
                    self.assertTrue(entered.wait(3))
                    wait_for(lambda: time.monotonic() > deadlines[0])
                    self.assertTrue(self.gate.busy, 'cooperative deadline must not release live computation')
                    self.assertFalse(result.done())
                    self.assertEqual(self.request('/optimize', {})[0], 429)
                    release.set()
                    self.assertEqual(result.result(timeout=3)[0], 200)
                wait_for(lambda: not self.gate.busy)
        finally:
            release.set()

    def test_fresh_backend_identity_cannot_return_old_in_memory_job(self):
        with controlled(program(result_events())):
            _, first = self.request('/supply-chain-jobs-v6', spec())
            await_done(self.manager, first['jobId'])
        old_instance = first['backendInstanceId']
        with patch.object(self.service, 'INSTANCE_ID', old_instance + '-new-test-instance'), \
                patch.object(self.service, 'JOBS', jobs.JobManager(SolveAdmission())):
            status, health = self.request('/health')
            self.assertEqual(status, 200)
            self.assertNotEqual(health['instanceId'], old_instance)
            status, body = self.request('/supply-chain-jobs-v6/' + first['jobId'] + '?results=1')
            self.assertEqual(status, 404)
            self.assertEqual(body['error']['code'], 'SUPPLY_JOB_NOT_FOUND')
            self.assertNotIn('results', body)


if __name__ == '__main__':
    unittest.main(verbosity=2)
