"""Actual HTTP endpoints with controlled compute; does not claim native solver execution."""
import concurrent.futures
import json
from pathlib import Path
import sys
import threading
import time
import unittest
import urllib.request
import urllib.error
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'optimizer'))
import ortools_service as service
import supply_chain_jobs_v6 as jobs
from solve_admission import SOLVE_ADMISSION, SolveAdmission, SolverBusy
sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_supply_chain_v7_jobs import spec


class AdmissionTests(unittest.TestCase):
    def assert_admission_released(self):
        # Reading an HTTP response may precede the handler's finally by a scheduling tick.
        deadline = time.monotonic() + 2
        while SOLVE_ADMISSION.busy and time.monotonic() < deadline:
            time.sleep(.005)
        self.assertFalse(SOLVE_ADMISSION.busy, 'handler did not release its completed lease')

    def test_owner_cannot_release_someone_elses_lease(self):
        gate=SolveAdmission();gate.acquire('one');gate.release('two')
        with self.assertRaises(SolverBusy):gate.acquire('two')
        gate.release('one');gate.acquire('two');gate.release('two')
        self.assertFalse(gate.busy)

    def test_jobs_and_service_really_share_one_gate(self):
        self.assertIs(jobs.JOBS.admission, SOLVE_ADMISSION)
        manager=jobs.JobManager();SOLVE_ADMISSION.acquire('legacy-test')
        try:
            with patch.object(jobs,'check_dependencies'), self.assertRaises(jobs.JobError) as raised:manager.start(spec())
            self.assertEqual(raised.exception.status,429)
            self.assertEqual(manager.jobs,{})
        finally:SOLVE_ADMISSION.release('legacy-test')

    def test_start_failure_releases_admission(self):
        gate=SolveAdmission();manager=jobs.JobManager(admission=gate)
        with patch.object(jobs,'check_dependencies'), patch.object(threading.Thread,'start',side_effect=RuntimeError('injected')):
            with self.assertRaises(RuntimeError):manager.start(spec())
        self.assertFalse(gate.busy);self.assertEqual(manager.jobs,{})

    def test_all_legacy_routes_reject_overlap_and_recover(self):
        server=service.ThreadingHTTPServer(('127.0.0.1',0),service.Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base='http://127.0.0.1:'+str(server.server_port)
        def post(route):
            request=urllib.request.Request(base+route,data=b'{}',headers={'Content-Type':'application/json'})
            try:
                with urllib.request.urlopen(request,timeout=5) as result:return result.status,json.load(result)
            except urllib.error.HTTPError as result:return result.code,json.load(result)
        entered=threading.Event();release=threading.Event();deadlines=[]
        def compute(*args,**kwargs):
            if 'deadline' in kwargs:deadlines.append(kwargs['deadline'])
            entered.set()
            if not release.wait(3):raise RuntimeError('test compute timeout')
            return {}
        try:
            with patch.object(service,'pywrapcp',object()),patch.object(service,'cp_model',object()),patch.object(service,'solve_joint',side_effect=compute),patch.object(service,'solve_facility',side_effect=compute),patch.object(service,'solve',side_effect=compute),patch.object(service,'solve_rolling',side_effect=compute):
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                    future=pool.submit(post,'/supply-chain-optimize-v19');self.assertTrue(entered.wait(2))
                    for route in ['/optimize','/reoptimize-v16','/facility-optimize-v19','/supply-chain-optimize-v19']:
                        status,body=post(route);self.assertEqual(status,429);self.assertEqual(body['error']['code'],'SUPPLY_JOB_BUSY')
                    with patch.object(jobs,'check_dependencies'),self.assertRaises(jobs.JobError):jobs.JobManager().start(spec())
                    release.set();self.assertEqual(future.result()[0],200)
                self.assert_admission_released()
                for route in ['/optimize','/reoptimize-v16','/facility-optimize-v19','/supply-chain-optimize-v19']:
                    self.assertEqual(post(route)[0],200);self.assert_admission_released()
                self.assertTrue(deadlines)
                self.assertTrue(all(value<=time.monotonic()+service.MAX_SOLVE_SECONDS for value in deadlines))
                self.assertEqual(post('/optimize-not-an-endpoint')[0],404)
            with patch.object(service,'pywrapcp',object()),patch.object(service,'solve',side_effect=ValueError('invalid')):
                self.assertEqual(post('/optimize')[0],400);self.assert_admission_released()
            SOLVE_ADMISSION.acquire('job-simulated')
            try:
                with patch.object(service,'pywrapcp',object()):self.assertEqual(post('/optimize')[0],429)
            finally:SOLVE_ADMISSION.release('job-simulated')
        finally:
            release.set();server.shutdown();server.server_close();thread.join(2)


if __name__=='__main__':unittest.main()
