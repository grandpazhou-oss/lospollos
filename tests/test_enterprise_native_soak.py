#!/usr/bin/env python3
"""Owned Linux native solver soak. Never substitutes a mock solver or installs dependencies."""
from __future__ import annotations

import argparse
from collections import Counter, deque
import concurrent.futures
import copy
import hashlib
import http.client
import importlib.metadata
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import threading
import time
import traceback
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from enterprise_native_soak_payloads import make_payloads, make_job, validate_result, self_test as payload_self_test

ROUTES = ('/optimize', '/reoptimize-v16', '/facility-optimize-v19', '/supply-chain-optimize-v19')
JOB_ROUTE = '/supply-chain-jobs-v6'
TERMINAL = {'COMPLETE', 'PARTIAL', 'CANCELLED', 'FAILED'}
PROTECTED_PORTS = {8787, 8877, 8791, 8766, 8788, 19095}
LIMITS = {'rssBytes': 1024 ** 3, 'fds': 512, 'threads': 64, 'workers': 1}

# Observation only: no solver, gate, request or result functions are replaced.
# Each process uses the real entrypoint. flock gives cross-process total ordering
# of boundary events without changing admission logic or solver return values.
PROFILE_SOURCE = '''import fcntl,json,os,sys,threading,time
_path=os.environ.get("STCT_SOAK_BOUNDARIES")
_root=os.environ.get("STCT_SOAK_ROOT")
_targets={(_root or '')+"/optimizer/"+name:function for name,function in {"ortools_service.py":"solve","facility_mvp1.py":"solve_facility","supply_chain_joint_v19.py":"solve_joint","rolling_solver_v16.py":"solve_rolling"}.items()}
if _path and _root:
 _fd=os.open(_path,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
 _event_lock=threading.Lock()
 _raw=open("/proc/self/stat").read();_start=int(_raw[_raw.rfind(")")+2:].split()[19])
 def _profile(frame,event,arg):
  if event not in ("call","return"): return
  code=frame.f_code
  filename=code.co_filename
  if _targets.get(filename)!=code.co_name: return
  _event_lock.acquire()
  try:
   fcntl.flock(_fd,fcntl.LOCK_EX)
   row={"event":"enter" if event=="call" else "exit","pid":os.getpid(),"startTicks":_start,"thread":threading.get_ident(),"function":code.co_name,"monoNs":time.monotonic_ns()}
   os.write(_fd,(json.dumps(row,separators=(",",":"))+"\\n").encode())
  except BaseException as error:
   try:
    marker=os.open(_path+".observer-error",os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
    os.write(marker,(type(error).__name__+"\\n").encode());os.close(marker)
   finally: raise
  finally:
   fcntl.flock(_fd,fcntl.LOCK_UN)
   _event_lock.release()
 sys.setprofile(_profile)
 threading.setprofile(_profile)
'''


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def proc_snapshot(pid):
    """Read only; pid/startTicks pairs are the immutable ownership identity."""
    try:
        base = Path('/proc') / str(pid)
        raw = (base / 'stat').read_text()
        fields = raw[raw.rfind(')') + 2:].split()
        status = {}
        for line in (base / 'status').read_text().splitlines():
            key, _, value = line.partition(':')
            status[key] = value.strip()
        command = (base / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace').strip()
        return {'pid': pid, 'ppid': int(fields[1]), 'startTicks': int(fields[19]),
                'state': fields[0], 'command': command,
                'rssBytes': int(status.get('VmRSS', '0 kB').split()[0]) * 1024,
                'threads': int(status.get('Threads', '0')), 'fds': len(list((base / 'fd').iterdir()))}
    except (FileNotFoundError, ProcessLookupError):
        return None


def descendants(pid):
    """Children can belong to any task/thread, not only the main Linux thread."""
    found = set()
    todo = [pid]
    while todo:
        current = todo.pop()
        try:
            paths = list((Path('/proc') / str(current) / 'task').glob('*/children'))
        except FileNotFoundError:
            continue
        for path in paths:
            try:
                children = map(int, path.read_text().split())
                for child in children:
                    if child not in found:
                        found.add(child)
                        todo.append(child)
            except FileNotFoundError:
                pass
    return found


def same_process(identity, current=None):
    current = current if current is not None else proc_snapshot(identity['pid'])
    return bool(current and current['startTicks'] == identity['startTicks'])


def choose_port(requested):
    require(requested not in PROTECTED_PORTS, 'Refusing a protected port')
    require(0 <= requested <= 65535, 'Invalid port')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', requested))
        port = sock.getsockname()[1]
    require(port not in PROTECTED_PORTS, 'Kernel selected a protected port; retry with --port 0')
    return port


class BoundaryLedger:
    """Thread spans count once when solver entrypoints nest in one request."""
    def __init__(self):
        self.active = {}
        self.active_started = {}
        self.completed_spans = deque(maxlen=64)
        self.verified_exits = {}
        self.last_ns = 0
        self.maximum = 0
        self.entries = self.exits = 0

    def process_exited(self, pid, start_ticks, at_ns):
        self.verified_exits[(pid, start_ticks)] = at_ns
        # Closure uses a verified exit, never merely a kill/cancel intention.
        self._close_exited(at_ns)

    def _close_exited(self, at_ns):
        for key in list(self.active):
            ended = self.verified_exits.get(key[:2])
            if ended is not None and ended <= at_ns:
                self.active.pop(key)
                self.active_started.pop(key, None)

    def feed(self, row):
        require(row['monoNs'] >= self.last_ns, 'Non-monotonic native boundary evidence')
        self.last_ns = row['monoNs']
        self._close_exited(row['monoNs'])
        key = (row['pid'], row['startTicks'], row['thread'])
        if row['event'] == 'enter':
            require(key[:2] not in self.verified_exits or row['monoNs'] < self.verified_exits[key[:2]],
                    'Native entry after verified process exit')
            if key not in self.active:
                self.active_started[key] = row['monoNs']
            self.active.setdefault(key, []).append(row['function'])
            self.maximum = max(self.maximum, len(self.active))
            require(len(self.active) <= 1, 'GLOBAL_NATIVE_CONCURRENCY_EXCEEDED: ' + str(list(self.active)))
            self.entries += 1
        elif row['event'] == 'exit':
            require(key in self.active and self.active[key][-1] == row['function'],
                    'Native solver exit without matching nested entry')
            self.active[key].pop()
            if not self.active[key]:
                self.active.pop(key)
                self.completed_spans.append({'pid': key[0], 'startTicks': key[1], 'thread': key[2],
                                             'beginNs': self.active_started.pop(key), 'endNs': row['monoNs']})
            self.exits += 1
        else:
            raise AssertionError('Invalid native boundary event')

    def active_span(self, identity):
        for key, begun in self.active_started.items():
            if key[:2] == (identity['pid'], identity['startTicks']):
                return {'pid': key[0], 'startTicks': key[1], 'thread': key[2], 'beginNs': begun}
        return None

    def disconnect_witness(self, observed, closed_ns):
        if observed is None:
            return None
        return next((row for row in self.completed_spans
                     if all(row[key] == observed[key] for key in ('pid', 'startTicks', 'thread', 'beginNs'))
                     and row['beginNs'] <= closed_ns <= row['endNs']), None)


class BlockedEnvironment(RuntimeError):
    """The requested native test could not run in this environment."""


class Evidence:
    def __init__(self, directory):
        self.directory = directory.resolve()
        require(self.directory != ROOT and ROOT not in self.directory.parents,
                '--evidence-dir must be outside the checkout')
        self.directory.mkdir(parents=True, exist_ok=True)
        # Never replace a prior acceptance/soak evidence run.
        require(not any(self.directory.iterdir()), 'Evidence directory must be empty or new')
        self.lock = threading.RLock()
        self.stream = (self.directory / 'events.jsonl').open('x', encoding='utf-8', buffering=1)
        self.sample_stream = (self.directory / 'resources.jsonl').open('x', encoding='utf-8', buffering=1)
        self.start = time.monotonic()
        self.counts = Counter()
        source_changes = subprocess.check_output(['git', 'status', '--porcelain=v1', '--untracked-files=all'], cwd=ROOT, text=True).splitlines()
        self.summary = {'suite': 'ENTERPRISE_NATIVE_SOAK', 'status': 'RUNNING',
                        'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                        'sourceDirty': bool(source_changes), 'sourceChanges': source_changes,
                        'method': 'INSTRUMENTED_REAL_NATIVE_EXECUTION', 'limits': LIMITS,
                        'retentionPolicy': '15 completed jobs retained before a new admission; at most 16 including latest',
                        'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                        'nativeExecutionVerified': False, 'maxima': {}, 'coverage': {},
                        'observerSha256': hashlib.sha256(PROFILE_SOURCE.encode()).hexdigest(),
                        'observerOverhead': 'Python call/return filename filtering and locked append at exact solver boundaries; overhead is not calibrated, and instrumented latency is not an uninstrumented SLA'}
        self.save()

    def event(self, kind, **data):
        with self.lock:
            row = {'event': kind, 'elapsedSeconds': round(time.monotonic() - self.start, 3), **data}
            self.stream.write(json.dumps(row, sort_keys=True, allow_nan=False) + '\n')
            self.stream.flush()

    def increment(self, key, amount=1):
        with self.lock:
            self.counts[key] += amount

    def save(self, **changes):
        with self.lock:
            self.summary.update(changes)
            self.summary['coverage'] = dict(sorted(self.counts.items()))
            self.summary['elapsedSeconds'] = round(time.monotonic() - self.start, 3)
            destination = self.directory / 'summary.json'
            temporary = self.directory / 'summary.tmp'
            temporary.write_text(json.dumps(self.summary, indent=2, sort_keys=True, allow_nan=False) + '\n')
            temporary.replace(destination)

    def sample(self, value):
        with self.lock:
            self.sample_stream.write(json.dumps(value, sort_keys=True) + '\n')
            self.sample_stream.flush()
            for key in LIMITS:
                self.summary['maxima'][key] = max(self.summary['maxima'].get(key, 0), value[key])
            self.counts['resource_samples'] += 1


class NativeSoak:
    def __init__(self, args, evidence):
        self.args, self.evidence = args, evidence
        self.port = choose_port(args.port)
        self.backend = None
        self.backend_identity = None
        self.backend_started = None
        self.instance = None
        self.generations = []
        self.owned = {}
        self.owned_lock = threading.RLock()
        self.monitor_stop = threading.Event()
        self.failed = threading.Event()
        self.failure = None
        self.sequence = 0
        self.pending_jobs = set()
        self.job_ids = []
        self.idle_samples = []
        self.boundary_offset = 0
        self.boundary_pending = b''
        self.boundaries = BoundaryLedger()
        self.boundary_lock = threading.RLock()
        self.fault_exit_times = {}
        self.last_boundary_ns = 0
        self.boundary_path = self.evidence.directory / 'native-boundaries.jsonl'
        self.boundary_path.touch()
        instrumentation = self.evidence.directory / 'instrumentation'
        instrumentation.mkdir()
        (instrumentation / 'sitecustomize.py').write_text(PROFILE_SOURCE)
        self.environment = {**os.environ, 'OPT_PORT': str(self.port),
                            'MAX_SOLVE_SECONDS': '5', 'PYTHONDONTWRITEBYTECODE': '1',
                            'PYTHONPATH': os.pathsep.join((str(instrumentation), str(ROOT / 'optimizer'))),
                            'STCT_SOAK_BOUNDARIES': str(self.boundary_path), 'STCT_SOAK_ROOT': str(ROOT),
                            'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1',
                            'NUMEXPR_NUM_THREADS': '1'}
        self.monitor = threading.Thread(target=self._monitor, name='owned-resource-monitor', daemon=True)

    def check(self):
        require(not self.failed.is_set(), self.failure or 'Safety monitor stopped the run')

    def next_sequence(self):
        self.sequence += 1
        return self.sequence

    def request(self, route, payload=None, timeout=12):
        self.check()
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=timeout)
        try:
            body = None if payload is None else json.dumps(payload, separators=(',', ':'), allow_nan=False)
            connection.request('GET' if payload is None else 'POST', route, body,
                               {'Content-Type': 'application/json', 'Connection': 'close'})
            response = connection.getresponse()
            raw = response.read()
            require(len(raw) <= 20_000_000, 'Unbounded HTTP response')
            return response.status, json.loads(raw)
        finally:
            connection.close()

    def register(self, pid, role):
        value = proc_snapshot(pid)
        if value is None:
            return None
        expected = str(ROOT / 'optimizer' / ('ortools_service.py' if role == 'backend' else 'supply_chain_job_worker_v6.py'))
        require(expected in value['command'], 'Refusing ownership of an unexpected process command')
        with self.owned_lock:
            old = self.owned.get(pid)
            if role == 'worker' and (not old or old['startTicks'] != value['startTicks']):
                require(self.backend_identity is not None and same_process(self.backend_identity)
                        and value['ppid'] == self.backend_identity['pid'],
                        'Refusing ownership of a worker not parented by our verified backend')
            if old and old['startTicks'] != value['startTicks']:
                require(not same_process(old), 'Process identity collision')
            if not old or old['startTicks'] != value['startTicks']:
                self.owned[pid] = {**value, 'role': role}
                self.evidence.event('owned_process', pid=pid, startTicks=value['startTicks'], role=role)
        return value

    def signal_owned(self, pid, sig, reason):
        with self.owned_lock:
            identity = self.owned.get(pid)
            require(identity is not None, 'Refusing to signal an unowned PID')
            if not same_process(identity):
                return False
            descriptor = os.pidfd_open(pid)
            try:
                require(same_process(identity), 'PID identity changed before signal')
                now = time.monotonic_ns()
                if sig in (signal.SIGTERM, signal.SIGKILL):
                    self.fault_exit_times[pid] = now
                signal.pidfd_send_signal(descriptor, sig)
                self.evidence.event('owned_signal', pid=pid, signal=int(sig), reason=reason,
                                    startTicks=identity['startTicks'], monoNs=now)
                return True
            except ProcessLookupError:
                return False
            finally:
                os.close(descriptor)

    def start_backend(self, instrumented=True):
        self.check()
        # Check free again immediately before spawn; health below validates our
        # own living process and instance before any business/fault request.
        require(choose_port(self.port) == self.port, 'Loopback port changed')
        log = (self.evidence.directory / f'backend-{len(self.generations) + 1}.log').open('xb', buffering=0)
        environment = dict(self.environment)
        if not instrumented:
            environment.pop('STCT_SOAK_BOUNDARIES', None)
            environment['PYTHONPATH'] = str(ROOT / 'optimizer')
        self.backend = subprocess.Popen([sys.executable, '-u', str(ROOT / 'optimizer' / 'ortools_service.py')],
                                        cwd=ROOT, env=environment, stdin=subprocess.DEVNULL,
                                        stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        log.close()
        self.backend_identity = self.register(self.backend.pid, 'backend')
        require(self.backend_identity is not None, 'Backend exited before ownership could be recorded')
        self.backend_started = time.monotonic()
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            self.check()
            require(self.backend.poll() is None, 'Owned backend exited during startup')
            try:
                status, health = self.request('/health')
                if status == 200:
                    if health.get('dependencies', {}).get('supplyChainReady') is not True:
                        raise BlockedEnvironment('Native OR-Tools runtime could not load; no native execution occurred')
                    require(health.get('actualOrtoolsVersion') == self.args.expected_ortools,
                            'Unexpected OR-Tools version: ' + str(health.get('actualOrtoolsVersion')))
                    require(health.get('endpoint') == f'http://127.0.0.1:{self.port}', 'Unexpected backend endpoint')
                    old = self.instance
                    self.instance = health['instanceId']
                    require(self.instance != old, 'Backend instanceId did not change across restart')
                    self.generations.append({'pid': self.backend.pid, 'instanceId': self.instance,
                                             'startedMono': self.backend_started, 'health': health, 'instrumented': instrumented})
                    self.evidence.event('backend_ready', generation=len(self.generations), health=health, pid=self.backend.pid)
                    return
            except (ConnectionError, OSError, http.client.HTTPException):
                pass
            time.sleep(.05)
        raise AssertionError('Owned backend startup timed out')

    def capture_workers(self):
        if self.backend_identity and same_process(self.backend_identity):
            for pid in descendants(self.backend_identity['pid']):
                self.register(pid, 'worker')
        with self.owned_lock:
            return [current for identity in self.owned.values()
                    if identity['role'] == 'worker' and (current := proc_snapshot(identity['pid']))
                    and same_process(identity, current)]

    def verify_exit(self, pid):
        identity = self.owned.get(pid)
        require(identity is not None and not same_process(identity), 'Process exit is not verified')
        with self.boundary_lock:
            # Consume earlier boundaries before adding the verified exit point.
            self.inspect_boundaries()
            if (pid, identity['startTicks']) not in self.boundaries.verified_exits:
                now = time.monotonic_ns()
                self.boundaries.process_exited(pid, identity['startTicks'], now)
                self.evidence.event('owned_exit_verified', pid=pid, startTicks=identity['startTicks'], monoNs=now)

    def inspect_boundaries(self):
        with self.boundary_lock:
            with self.boundary_path.open('rb') as stream:
                stream.seek(self.boundary_offset)
                value = stream.read()
                self.boundary_offset = stream.tell()
            lines = (self.boundary_pending + value).split(b'\n')
            self.boundary_pending = lines.pop()
            for line in lines:
                row = json.loads(line)
                self.boundaries.feed(row)
                self.evidence.increment('native_boundary_entries' if row['event'] == 'enter' else 'native_boundary_exits')
            self.evidence.summary['maxNativeConcurrency'] = self.boundaries.maximum

    def _monitor(self):
        try:
            while not self.monitor_stop.is_set():
                require(not self.boundary_path.with_name(self.boundary_path.name + '.observer-error').exists(),
                        'NATIVE_OBSERVER_ERROR: inspect the external observer marker')
                workers = self.capture_workers()
                self.inspect_boundaries()
                with self.owned_lock:
                    processes = [current for identity in self.owned.values()
                                 if (current := proc_snapshot(identity['pid'])) and same_process(identity, current)]
                sample = {'elapsedSeconds': round(time.monotonic() - self.evidence.start, 3),
                          'monoNs': time.monotonic_ns(), 'instanceId': self.instance,
                          'rssBytes': sum(p['rssBytes'] for p in processes),
                          'fds': sum(p['fds'] for p in processes),
                          'threads': sum(p['threads'] for p in processes),
                          'workers': sum(p['state'] != 'Z' for p in workers),
                          'pids': [{k: p[k] for k in ('pid', 'ppid', 'startTicks', 'state', 'rssBytes', 'fds', 'threads')}
                                   for p in processes]}
                self.evidence.sample(sample)
                for key, limit in LIMITS.items():
                    require(sample[key] <= limit, f'SAFETY_LIMIT_{key}: {sample[key]} > {limit}')
                self.monitor_stop.wait(.2)
        except BaseException as exc:
            self.failure = str(exc)
            self.evidence.event('safety_stop', reason=self.failure)
            self.failed.set()
            self.evidence.save(status='FAIL', failure=self.failure)
            # Stop owned compute immediately even if main thread is awaiting HTTP.
            self.emergency_stop()

    def emergency_stop(self):
        try:
            self.capture_workers()
        except (OSError, AssertionError):
            pass
        with self.owned_lock:
            identities = list(self.owned.values())
        for identity in sorted(identities, key=lambda row: row['role'] == 'backend'):
            try:
                self.signal_owned(identity['pid'], signal.SIGKILL, 'safety_or_final_cleanup')
            except (OSError, AssertionError):
                pass
        if self.backend:
            try:
                self.backend.wait(timeout=4)
            except subprocess.TimeoutExpired:
                pass

    def await_idle(self, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.check()
            live = self.capture_workers()
            if not live:
                current = proc_snapshot(self.backend.pid) if self.backend else None
                if current and current['threads'] <= 3:
                    self.idle_samples.append({'instanceId': self.instance, 'elapsedSeconds': time.monotonic()-self.evidence.start,
                                              **{key: current[key] for key in ('rssBytes', 'fds', 'threads')}})
                    self.evidence.event('idle_recovered', **self.idle_samples[-1])
                    self.evidence.increment('idle_recoveries')
                    return
            time.sleep(.02)
        raise AssertionError('OWNED_WORKER_OR_IDLE_RESOURCE_RECLAIM_TIMEOUT')

    def await_job(self, job_id, timeout=12):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            status, value = self.request(JOB_ROUTE + '/' + job_id + '?results=1')
            require(status == 200, 'Accepted job disappeared before terminal state')
            if value.get('pid'):
                self.register(value['pid'], 'worker')
            if value['status'] in TERMINAL and value.get('completedAt'):
                pid = value.get('pid')
                identity = self.owned.get(pid)
                if not pid or not identity or not same_process(identity):
                    if identity:
                        self.verify_exit(pid)
                    self.pending_jobs.discard(job_id)
                    return value
            time.sleep(.02)
        raise AssertionError('Native job did not reach reaped terminal state')

    def accepted_job(self, payload):
        status, value = self.request(JOB_ROUTE, payload)
        if status == 202:
            job_id = value['jobId']
            self.pending_jobs.add(job_id)
            self.job_ids.append(job_id)
            if value.get('pid'):
                self.register(value['pid'], 'worker')
        return status, value

    def validate_job(self, spec, final, shape):
        require(final['status'] in {'COMPLETE', 'PARTIAL'}, 'Native job failed: ' + json.dumps(final.get('error')))
        require(final.get('exitCode') == 0, 'Successful native job has nonzero exit')
        require(final.get('runSpecHash') == spec['runSpecHash'], 'Job identity drift')
        checks = []
        for item in spec['requests']:
            result = final.get('results', {}).get(item['phase'])
            require(result is not None, 'Native job returned no independently checkable result')
            route = '/facility-optimize-v19' if item['kind'] == 'FACILITY' else '/supply-chain-optimize-v19'
            checks.append(validate_result(route, item['payload'], result))
            self.evidence.increment(f'native_success:job:{item["kind"]}:{shape}')
        self.evidence.event('native_math_verified', transport='job', shape=shape, jobId=final['jobId'],
                            status=final['status'], checks=checks)
        self.evidence.increment('native_job_successes')
        self.evidence.summary['nativeExecutionVerified'] = True

    def execute_work(self, item, shape):
        route, payload, is_job = item
        start = time.monotonic()
        status, result = self.accepted_job(payload) if is_job else self.request(route, payload)
        if status == 429:
            require(result.get('error', {}).get('code') == 'SUPPLY_JOB_BUSY', 'Unstructured 429 response')
            self.evidence.increment('429:' + route)
            self.evidence.event('backpressure_429', route=route, shape=shape)
            return False
        require(status == (202 if is_job else 200), f'Unexpected HTTP {status} for {route}: {result}')
        if is_job:
            self.validate_job(payload, self.await_job(result['jobId']), shape)
        else:
            checks = validate_result(route, payload, result)
            self.evidence.increment(f'native_success:{route}:{shape}')
            self.evidence.increment('native_sync_successes')
            self.evidence.event('native_math_verified', transport='sync', route=route, shape=shape,
                                durationSeconds=round(time.monotonic() - start, 3), checks=checks)
            self.evidence.summary['nativeExecutionVerified'] = True
        return True

    def load_cycle(self, demands, sites, clients):
        shape = f'{demands}x{sites}'
        sequence = self.next_sequence()
        values = make_payloads(demands, sites, sequence)
        self.evidence.event('synthetic_payload_identity', sequence=sequence, shape=shape,
                            hashes={route: value.get('claimedRequestHash', value.get('studyHash')) for route, value in values.items()})
        items = [(route, values[route], False) for route in ROUTES]
        for route in ROUTES[2:]:
            items.append((JOB_ROUTE, make_job(values[route], self.next_sequence()), True))
        # The finite FIFO retries genuine 429s; no busy-spin or abandoned accepted jobs.
        pending = deque(items)
        deadline = time.monotonic() + 75
        while pending:
            self.check()
            require(time.monotonic() < deadline, 'Mixed batch made insufficient progress')
            batch = [pending.popleft() for _ in range(min(clients, len(pending)))]
            with concurrent.futures.ThreadPoolExecutor(max_workers=clients) as pool:
                futures = [pool.submit(self.execute_work, item, shape) for item in batch]
                for item, future in zip(batch, futures):
                    if not future.result():
                        pending.append(item)
            if pending and len(pending) == len(batch):
                time.sleep(.005)  # scheduling backoff, never substitutes for the load window
        require(self.evidence.counts['native_boundary_entries'] > 0, 'Native observer did not record real solver entry')
        self.evidence.increment('cycles')
        self.evidence.increment(f'client_level:{clients}')
        self.evidence.increment(f'shape_cycles:{shape}')
        self.await_idle()
        self.check_retention()

    def new_fault_job(self, demands=200, sites=10):
        value = make_payloads(demands, sites, self.next_sequence())['/facility-optimize-v19']
        spec = make_job(value, self.next_sequence())
        status, started = self.accepted_job(spec)
        require(status == 202, 'Fault setup could not acquire an idle job slot')
        return spec, started

    def wait_worker(self, job_id, solving=False):
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            status, value = self.request(JOB_ROUTE + '/' + job_id)
            require(status == 200, 'Fault job unavailable')
            pid = value.get('pid')
            current = self.register(pid, 'worker') if pid else None
            if current and value['status'] not in TERMINAL and (not solving or value['status'] == 'SOLVING'):
                return value
            if value['status'] in TERMINAL:
                return None
            time.sleep(.002)
        raise AssertionError('Could not observe owned worker startup')

    def cancel_race(self, solving=False):
        spec, started = self.new_fault_job()
        job_id = started['jobId']
        before = self.wait_worker(job_id, solving=True) if solving else started
        if before is None:
            self.validate_job(spec, self.await_job(job_id), 'fault_setup')
            self.evidence.event('fault_window_missed', method='cancel_solving', reason='completed_before_solving_observation')
            self.evidence.increment('cancel_window_misses')
            self.await_idle()
            return False
        self.capture_workers()
        # Record cancellation intent before the backend is asked to stop its worker.
        now = time.monotonic_ns()
        with self.owned_lock:
            for identity in self.owned.values():
                if identity['role'] == 'worker' and same_process(identity):
                    self.fault_exit_times[identity['pid']] = now
        status, value = self.request(JOB_ROUTE + '/' + job_id + '/cancel', {})
        require(status == 200, 'First cancellation HTTP request failed')
        if value['status'] in {'COMPLETE', 'PARTIAL'}:
            final = self.await_job(job_id)
            self.validate_job(spec, final, 'fault_setup')
            self.evidence.event('fault_window_missed', method='cancel_solving' if solving else 'cancel_start_race',
                                jobId=job_id, reason='native_completion_won_first_cancel', status=final['status'])
            self.evidence.increment('cancel_window_misses')
            self.await_idle()
            return False
        require(value['status'] == 'CANCELLED', 'First cancellation returned an unexpected terminal state')
        for attempt in range(2):
            status, value = self.request(JOB_ROUTE + '/' + job_id + '/cancel', {})
            require(status == 200 and value['status'] == 'CANCELLED', 'Repeated cancel did not stay cancelled')
        final = self.await_job(job_id)
        require(final['status'] == 'CANCELLED', 'Cancel produced a false success')
        self.evidence.increment('cancel_solving' if solving else 'cancel_start_race')
        self.evidence.increment('repeat_cancel', 2)
        self.evidence.event('fault_verified', method='HTTP_CANCEL_SOLVING' if solving else 'HTTP_CANCEL_START_RACE',
                            jobId=job_id, pid=final.get('pid'), status=final['status'])
        self.await_idle()
        return True

    def collide_and_kill(self, clients):
        spec, started = self.new_fault_job()
        job_id = started['jobId']
        value = self.wait_worker(job_id)
        require(value is not None, 'Worker vanished before deterministic fault window')
        pid = value['pid']
        # Explicit fault injection freezes only our worker, creating a deterministic
        # admission collision. This is NEVER counted as a native math success.
        require(self.signal_owned(pid, signal.SIGSTOP, 'deterministic_busy_fault_window'), 'Worker exited before stop')
        other = make_payloads(10, 2, self.next_sequence())
        try:
            for route in ROUTES:
                status, reply = self.request(route, other[route])
                require(status == 429 and reply.get('error', {}).get('code') == 'SUPPLY_JOB_BUSY',
                        f'{route} accepted a competing solve during active owned job')
                self.evidence.increment('429:' + route)
            alternate = make_job(other['/facility-optimize-v19'], self.next_sequence())
            require(alternate['scenarioHash'] != spec['scenarioHash'], 'Collision scenario identity was not distinct')
            status, reply = self.accepted_job(alternate)
            require(status == 429 and reply.get('error', {}).get('code') == 'SUPPLY_JOB_BUSY', 'Distinct job collision was accepted')
            self.evidence.increment('429:' + JOB_ROUTE)
            # Same-request dedupe is separately required and must not spawn a worker.
            status, same = self.accepted_job(spec)
            require(status == 202 and same['jobId'] == job_id, 'Identical active job did not dedupe')
            self.evidence.increment('active_deduplications')
        finally:
            self.signal_owned(pid, signal.SIGKILL, 'real_owned_worker_abnormal_exit')
        final = self.await_job(job_id)
        require(final['status'] == 'FAILED' and final.get('exitCode') not in (None, 0),
                'Killed native worker was not a nonzero FAILED job')
        self.evidence.increment('worker_abnormal_exits')
        self.evidence.event('fault_verified', method='SIGSTOP_ADMISSION_COLLISION_THEN_SIGKILL_OWNED_WORKER',
                            pid=pid, jobId=job_id, exitCode=final['exitCode'], error=final.get('error'), clients=clients)
        self.await_idle()

    def disconnect(self):
        payload = make_payloads(10, 2, self.next_sequence())['/optimize']
        raw = json.dumps(payload, separators=(',', ':')).encode()
        request = (f'POST /optimize HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n'
                   f'Content-Type: application/json\r\nContent-Length: {len(raw)}\r\nConnection: close\r\n\r\n').encode() + raw
        sock = socket.create_connection(('127.0.0.1', self.port), timeout=5)
        observed = None
        closed_ns = None
        try:
            sock.sendall(request)
            # Read fresh boundary evidence, not an entry counter that may
            # already include a completed request. Observe our exact backend.
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                self.check()
                with self.boundary_lock:
                    self.inspect_boundaries()
                    observed = self.boundaries.active_span(self.backend_identity)
                if observed is not None:
                    break
                time.sleep(.01)
        finally:
            sock.close()
            closed_ns = time.monotonic_ns()
        self.evidence.event('client_connection_closed', observedActiveSpan=observed, closedMonoNs=closed_ns)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            status, result = self.request('/optimize', payload)
            if status == 200:
                checks = validate_result('/optimize', payload, result)
                self.await_idle()
                with self.boundary_lock:
                    self.inspect_boundaries()
                    witness = self.boundaries.disconnect_witness(observed, closed_ns)
                if witness is None:
                    self.evidence.event('fault_window_missed', method='CLIENT_DISCONNECT_DURING_NATIVE_SOLVE',
                                        reason='no_active_owned_span_at_close_or_solve_completed_before_close',
                                        observedActiveSpan=observed, closedMonoNs=closed_ns, recoveryChecks=checks)
                    self.evidence.increment('disconnect_window_misses')
                    return False
                self.evidence.event('fault_verified', method='CLIENT_DISCONNECT_DURING_NATIVE_SOLVE', checks=checks,
                                    boundaryWitness=witness, closedMonoNs=closed_ns)
                self.evidence.increment('disconnect_recoveries')
                return True
            require(status == 429, 'Unexpected response while disconnect solve drains')
            time.sleep(.05)
        raise AssertionError('Disconnected native solve did not release admission')

    def restart(self):
        spec, started = self.new_fault_job()
        job_id = started['jobId']
        value = self.wait_worker(job_id)
        require(value is not None, 'Restart fault missed the owned worker')
        old_instance = self.instance
        self.capture_workers()
        # The worker remains running: its real parent-ownership pipe must close
        # and force its exit when the backend is SIGKILLed.
        now = time.monotonic_ns()
        with self.owned_lock:
            for identity in self.owned.values():
                if same_process(identity):
                    self.fault_exit_times[identity['pid']] = now
        self.signal_owned(self.backend.pid, signal.SIGKILL, 'real_owned_backend_restart')
        self.backend.wait(timeout=4)
        self.generations[-1]['uptimeSeconds'] = time.monotonic() - self.backend_started
        deadline = time.monotonic() + 4
        while self.capture_workers() and time.monotonic() < deadline:
            self.check()
            time.sleep(.02)
        require(not self.capture_workers(), 'ORPHAN_NATIVE_WORKER_AFTER_BACKEND_EXIT')
        for identity in list(self.owned.values()):
            if not same_process(identity):
                self.verify_exit(identity['pid'])
        self.pending_jobs.clear()
        self.start_backend()
        status, result = self.request(JOB_ROUTE + '/' + job_id)
        require(status == 404 and result.get('error', {}).get('code') == 'SUPPLY_JOB_NOT_FOUND', 'Old job survived backend restart')
        self.job_ids.clear()
        self.evidence.increment('backend_restarts')
        self.evidence.increment('old_job_404_after_restart')
        self.evidence.event('fault_verified', method='SIGKILL_OWNED_BACKEND_AND_OWNERSHIP_PIPE_EXIT',
                            oldInstanceId=old_instance, newInstanceId=self.instance, oldJobId=job_id)
        recovery = make_payloads(10, 2, self.next_sequence())['/facility-optimize-v19']
        require(self.execute_work((JOB_ROUTE, make_job(recovery, self.next_sequence()), True), 'restart_recovery'),
                'New native request did not recover after restart')
        self.await_idle()

    def check_retention(self):
        unique = list(dict.fromkeys(self.job_ids))
        if len(unique) < 20:
            return
        probes = unique[-22:]
        present = []
        for job_id in probes:
            status, reply = self.request(JOB_ROUTE + '/' + job_id)
            require(status in (200, 404), 'Job retention lookup failed')
            if status == 200:
                present.append(job_id)
            else:
                require(reply.get('error', {}).get('code') == 'SUPPLY_JOB_NOT_FOUND', 'Unexpected old-job error')
        require(len(present) <= 16, 'Completed job retention exceeded bounded platform window')
        require(probes[0] not in present, 'Old completed job was not evicted')
        self.evidence.increment('bounded_retention_checks')
        self.evidence.event('retention_verified', lookedUp=len(probes), present=len(present), oldestEvicted=True)
        # The harness itself retains only bounded IDs; the counter records full throughput.
        self.job_ids = unique[-32:]

    def assert_coverage(self, active_seconds):
        counts = self.evidence.counts
        full = self.args.duration_seconds >= 1800
        require(active_seconds >= self.args.duration_seconds, 'Active workload window ended early')
        require(counts['cycles'] >= (30 if full else 3), 'Insufficient mixed business load cycles')
        for label in ('10x2', '50x5', '200x10'):
            for route in ROUTES:
                require(counts[f'native_success:{route}:{label}'] >= (3 if full else 1), 'Missing native route/shape success: ' + route + ':' + label)
            for kind in ('FACILITY', 'JOINT'):
                require(counts[f'native_success:job:{kind}:{label}'] >= (3 if full else 1), 'Missing native job/shape success: ' + kind + ':' + label)
        for clients in (1, 2, 4):
            require(counts[f'client_level:{clients}'] > 0, 'Missing client concurrency level')
        for route in (*ROUTES, JOB_ROUTE):
            require(counts['429:' + route] >= (3 if full else 1), 'Missing actual HTTP429 coverage: ' + route)
        for key, minimum in {'cancel_start_race': 6 if full else 1, 'cancel_solving': 3 if full else 1,
                             'worker_abnormal_exits': 3 if full else 1, 'disconnect_recoveries': 3 if full else 1,
                             'backend_restarts': 1, 'old_job_404_after_restart': 1,
                             'bounded_retention_checks': 3 if full else 1}.items():
            require(counts[key] >= minimum, f'Missing fault/retention coverage {key}: {counts[key]} < {minimum}')
        require(counts['resource_samples'] >= int(self.args.duration_seconds * 2), 'Insufficient resource sample coverage')
        if full:
            require(max(row.get('uptimeSeconds', 0) for row in self.generations) >= 900,
                    'No uninterrupted backend segment lasted at least 15 minutes')
        require(self.evidence.summary.get('maxNativeConcurrency') == 1, 'Native solver boundary observation missing')
        require(not self.boundaries.active, 'Unclosed native solver observation after final idle')

    def plateau_report(self):
        reports = []
        for generation in self.generations:
            samples = [row for row in self.idle_samples if row['instanceId'] == generation['instanceId']]
            if not samples:
                continue
            # Compare warm steady-state windows; do not compare pre-cache baseline
            # to a filled 16-result retention table and mislabel it as a leak.
            warm = samples[min(20, len(samples)//2):]
            first, last = warm[:min(10, len(warm))], warm[-min(10, len(warm)):]
            mean = lambda rows, key: round(sum(row[key] for row in rows) / len(rows), 2)
            reports.append({'instanceId': generation['instanceId'], 'idleSamples': len(samples),
                            'uptimeSeconds': generation.get('uptimeSeconds'),
                            'warmFirstMeanRssBytes': mean(first, 'rssBytes'), 'warmLastMeanRssBytes': mean(last, 'rssBytes'),
                            'warmRssGrowthBytes': mean(last, 'rssBytes') - mean(first, 'rssBytes'),
                            'maxIdleFds': max(row['fds'] for row in samples),
                            'maxIdleThreads': max(row['threads'] for row in samples)})
        return reports

    def run(self):
        # A same-checkout, unobserved real-native success establishes that the
        # observer is not replacing computation. These are not timing SLA claims.
        self.start_backend(instrumented=False)
        control = make_payloads(10, 2, self.next_sequence())['/facility-optimize-v19']
        started = time.monotonic()
        status, result = self.request('/facility-optimize-v19', control)
        require(status == 200, 'Uninstrumented native control failed')
        checks = validate_result('/facility-optimize-v19', control, result)
        self.evidence.event('uninstrumented_native_control', checks=checks,
                            durationSeconds=time.monotonic()-started, instanceId=self.instance)
        self.evidence.increment('uninstrumented_native_controls')
        self.signal_owned(self.backend.pid, signal.SIGTERM, 'finish_uninstrumented_native_control')
        self.backend.wait(timeout=4)
        self.generations[-1]['uptimeSeconds'] = time.monotonic()-self.backend_started
        self.verify_exit(self.backend.pid)
        self.start_backend()
        self.monitor.start()
        active_start = time.monotonic()
        self.evidence.event('active_window_started', targetSeconds=self.args.duration_seconds)
        iteration = 0
        restarted = False
        while time.monotonic() - active_start < self.args.duration_seconds or iteration < 3:
            elapsed = time.monotonic() - active_start
            stage = min(2, int(elapsed / max(1, self.args.duration_seconds / 3)))
            # A short smoke still visits all three scales; no shortened run claims 30-minute PASS.
            if self.args.duration_seconds < 1800:
                stage = iteration % 3
            demands, sites, clients = ((10, 2, 1), (50, 5, 2), (200, 10, 4))[stage]
            self.evidence.event('cycle_started', cycle=iteration + 1, demands=demands, sites=sites, clients=clients)
            self.load_cycle(demands, sites, clients)
            if iteration % 3 == 0:
                self.cancel_race()
            if iteration % 5 == 1:
                self.cancel_race(solving=True)
            if iteration % 7 == 2:
                self.collide_and_kill(clients)
                self.disconnect()
            if not restarted and elapsed >= self.args.duration_seconds * .75:
                self.restart()
                restarted = True
            iteration += 1
            self.evidence.save(activeSeconds=round(time.monotonic()-active_start, 3), cycles=iteration)
        # Complete missing bounded fault observations, never replace load with sleep.
        if not restarted:
            self.restart()
        for key, callback in [('cancel_start_race', self.cancel_race), ('cancel_solving', lambda: self.cancel_race(solving=True)),
                              ('worker_abnormal_exits', lambda: self.collide_and_kill(4)), ('disconnect_recoveries', self.disconnect)]:
            deadline = time.monotonic() + 30
            while self.evidence.counts[key] < 1:
                require(time.monotonic() < deadline, 'Could not observe required fault window: ' + key)
                callback()
        if self.evidence.counts['bounded_retention_checks'] < 1:
            # A shortened native smoke still fills the real retained-result table.
            # These are active native requests, not a substituted fixed wait.
            for _ in range(20):
                value = make_payloads(10, 2, self.next_sequence())['/facility-optimize-v19']
                require(self.execute_work((JOB_ROUTE, make_job(value, self.next_sequence()), True), 'retention_probe'),
                        'Retention probe unexpectedly encountered backpressure')
                self.await_idle()
            self.check_retention()
        self.await_idle()
        # Monitor is the sole reader of boundary state. Wait for pending evidence,
        # then stop/join it before final assertions and owned cleanup.
        self.monitor_stop.set()
        self.monitor.join(timeout=3)
        self.inspect_boundaries()
        self.generations[-1]['uptimeSeconds'] = time.monotonic() - self.backend_started
        active_seconds = time.monotonic() - active_start
        self.assert_coverage(active_seconds)
        self.evidence.event('active_window_finished', activeSeconds=round(active_seconds, 3), cycles=iteration)
        return {'status': 'PASS' if self.args.duration_seconds >= 1800 else 'SMOKE_PASS_NOT_30_MINUTE_SOAK',
                'activeSeconds': round(active_seconds, 3), 'generations': self.generations,
                'idlePlatformWindows': self.plateau_report(), 'minimumUninterruptedBackendSeconds': 900 if self.args.duration_seconds >= 1800 else 0,
                'coverageAssertionsPassed': True}

    def cleanup(self):
        self.monitor_stop.set()
        if self.monitor.is_alive():
            self.monitor.join(timeout=3)
        # Failure cleanup must still occur when normal HTTP checks are disabled.
        self.emergency_stop()
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            alive = [row for row in self.owned.values() if same_process(row)]
            if not alive:
                self.evidence.event('cleanup_verified', remainingOwnedPids=[])
                return
            time.sleep(.05)
        raise AssertionError('Owned PID remains after final cleanup: ' + str([row['pid'] for row in alive]))


def controlled_race_self_test():
    """Pure state-machine fixtures, never a native solver or transport claim."""
    class ControlledEvidence:
        def __init__(self):
            self.counts, self.events = Counter(), []
        def event(self, kind, **values):
            self.events.append({'event': kind, **values})
        def increment(self, key, amount=1):
            self.counts[key] += amount

    def runner_for(responses, final_status):
        runner = NativeSoak.__new__(NativeSoak)
        runner.evidence = ControlledEvidence()
        runner.owned_lock, runner.owned, runner.fault_exit_times = threading.RLock(), {}, {}
        runner.new_fault_job = lambda: ({}, {'jobId': 'CONTROLLED', 'status': 'PREPARING'})
        runner.wait_worker = lambda *args, **kwargs: {'jobId': 'CONTROLLED', 'status': 'SOLVING'}
        runner.capture_workers = lambda: []
        runner.calls, runner.validated, runner.idles = [], [], []
        final = {'jobId': 'CONTROLLED', 'status': final_status, 'pid': None}
        def request(route, payload):
            runner.calls.append(route)
            return 200, {'status': responses[len(runner.calls)-1]}
        runner.request = request
        runner.await_job = lambda *args: final
        runner.validate_job = lambda *args: runner.validated.append(args)
        runner.await_idle = lambda: runner.idles.append(True)
        return runner

    checked = []
    for status in ('COMPLETE', 'PARTIAL'):
        runner = runner_for([status], status)
        require(runner.cancel_race(solving=True) is False, 'Completed-before-cancel race counted as cancellation')
        require(len(runner.calls) == 1 and len(runner.validated) == 1 and len(runner.idles) == 1,
                'Completed-before-cancel race skipped validation/reclamation or repeated cancel')
        require(runner.evidence.counts['cancel_solving'] == 0 and runner.evidence.counts['repeat_cancel'] == 0,
                'Missed cancellation window changed genuine coverage')
        checked.append('first_cancel_' + status.lower() + '_is_verified_miss')
    runner = runner_for(['CANCELLED']*3, 'CANCELLED')
    require(runner.cancel_race() is True and len(runner.calls) == 3, 'Real cancellation coverage missing')
    require(runner.evidence.counts['cancel_start_race'] == 1 and runner.evidence.counts['repeat_cancel'] == 2,
            'Stable repeat cancellation counts changed')
    checked.append('actual_cancel_requires_two_stable_repeats')
    for bad in ('COMPLETE', 'PARTIAL', 'FAILED'):
        runner = runner_for(['CANCELLED', bad], bad)
        try:
            runner.cancel_race()
        except AssertionError:
            pass
        else:
            raise AssertionError('Unstable repeat cancellation was accepted')
        require(not runner.evidence.counts['cancel_start_race'], 'Failed race received coverage')
    checked.append('cancelled_cannot_later_complete_or_fail')
    return {'evidenceClass': 'CONTROLLED_STATE_MACHINE_NOT_NATIVE', 'checks': checked}


def self_test():
    result = payload_self_test()
    require('/optimizer/' in str(ROOT / 'optimizer' / 'ortools_service.py'), 'Bad repository root')
    compile(PROFILE_SOURCE, '<soak-sitecustomize>', 'exec')
    current = proc_snapshot(os.getpid())
    require(current is not None and same_process(current), 'Linux /proc identity unavailable')
    require(not same_process({**current, 'startTicks': current['startTicks'] + 1}), 'PID reuse guard failed')
    for port in PROTECTED_PORTS:
        try:
            choose_port(port)
        except AssertionError:
            continue
        raise AssertionError('Protected port was allowed')
    require(choose_port(0) not in PROTECTED_PORTS, 'Free port selection failed')
    def boundary(event, ns, pid=100, start=1, thread=1, function='solve'):
        return {'event': event, 'monoNs': ns, 'pid': pid, 'startTicks': start,
                'thread': thread, 'function': function}
    ledger = BoundaryLedger()
    ledger.feed(boundary('enter', 1))
    ledger.feed(boundary('enter', 2, function='solve_rolling'))
    ledger.feed(boundary('exit', 3, function='solve_rolling'))
    require(ledger.maximum == 1 and len(ledger.active) == 1, 'Nested spans counted as concurrency')
    ledger.feed(boundary('exit', 4))
    ledger.feed(boundary('enter', 5))
    ledger.process_exited(100, 1, 6)
    ledger.feed(boundary('enter', 7, start=2))
    ledger.feed(boundary('exit', 8, start=2))
    require(not ledger.active, 'Verified abnormal exit or PID reuse closure failed')
    for events in ([boundary('enter', 1), boundary('enter', 2, pid=101)],
                   [boundary('enter', 2), boundary('exit', 1)],
                   [boundary('exit', 1)]):
        invalid = BoundaryLedger()
        try:
            for row in events:
                invalid.feed(row)
        except AssertionError:
            continue
        raise AssertionError('Boundary observer missed overlap, disorder, or unmatched exit')
    spans = BoundaryLedger()
    spans.feed(boundary('enter', 10))
    require(spans.active_span({'pid': 100, 'startTicks': 2}) is None, 'PID reuse masqueraded as active solve')
    active = spans.active_span({'pid': 100, 'startTicks': 1})
    require(active is not None, 'Live owned outer span not observed')
    spans.feed(boundary('enter', 12, function='solve_rolling'))
    spans.feed(boundary('exit', 15, function='solve_rolling'))
    spans.feed(boundary('exit', 20))
    require(spans.active_span({'pid': 100, 'startTicks': 1}) is None, 'Completed entry counted as active')
    require(spans.disconnect_witness(active, 17) is not None, 'Disconnect within outer span lacked witness')
    require(spans.disconnect_witness(active, 21) is None, 'Completed-before-close race counted as fault')
    require(spans.disconnect_witness(None, 17) is None, 'Unobserved span counted as fault')
    race_checks = controlled_race_self_test()
    return {'status': 'SELF_TEST_PASS_NOT_NATIVE', 'nativeExecutionVerified': False,
            'payloadContracts': result, 'controlledRaceChecks': race_checks, 'checks': ['profile_compiles', 'proc_identity', 'pid_reuse_guard', 'protected_ports', 'free_loopback_port', 'nested_span_deduplication', 'verified_abrupt_exit', 'pid_reuse_restart', 'overlap_rejected', 'nonmonotonic_rejected', 'unmatched_exit_rejected', 'disconnect_requires_owned_active_outer_span', 'disconnect_close_inside_span', 'completed_before_close_is_missed']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--duration-seconds', type=float, default=1800)
    parser.add_argument('--evidence-dir', type=Path)
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--expected-ortools', default='9.15.6755')
    parser.add_argument('--self-test', action='store_true', help='Pure contract/guard checks only; never a native PASS')
    args = parser.parse_args()
    if args.evidence_dir is None and args.self_test:
        # stdout-only self-tests remain convenient for CI contract checks.
        if not sys.platform.startswith('linux') or not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
            print(json.dumps({'status': 'BLOCKED_ENVIRONMENT', 'coverageStatus': 'NOT_RUN',
                              'nativeExecutionVerified': False, 'reason': 'Linux /proc and pidfd are required'}))
            return 78
        print(json.dumps(self_test(), sort_keys=True))
        return 0
    require(args.evidence_dir is not None, '--evidence-dir is required for native execution')
    require(0 < args.duration_seconds <= 7200, '--duration-seconds must be between 0 and 7200')
    evidence = Evidence(args.evidence_dir)
    runner = None
    status = 1
    try:
        if not sys.platform.startswith('linux') or not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
            raise BlockedEnvironment('This harness requires Linux /proc and pidfd identity-safe signaling')
        if args.self_test:
            result = self_test()
            evidence.event('self_test', result=result)
            evidence.save(**result, method='PURE_HARNESS_SELF_TEST_NOT_NATIVE')
            print(json.dumps(result, sort_keys=True))
            return 0
        if os.environ.get('DISABLE_ORTOOLS', '').strip().lower() in {'1', 'true', 'yes'}:
            raise BlockedEnvironment('DISABLE_ORTOOLS explicitly disables native execution; policy was preserved')
        try:
            installed = importlib.metadata.version('ortools')
        except importlib.metadata.PackageNotFoundError:
            raise BlockedEnvironment('OR-Tools is not installed; no dependency installation was attempted') from None
        if installed != args.expected_ortools:
            raise BlockedEnvironment(f'Expected OR-Tools {args.expected_ortools}; installed {installed}')
        evidence.event('preflight', payloadContracts=payload_self_test(), durationSeconds=args.duration_seconds,
                       sourceCommit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                       resourceScope='aggregate owned backend and workers, including separate worker sessions',
                       profileMethod='read-only Python solver function entry/exit hooks; unchanged native implementation',
                       observerSha256=hashlib.sha256(PROFILE_SOURCE.encode()).hexdigest(),
                       observerOverhead='Every Python call/return passes a filename filter; matched boundaries append one locked JSON line. Runtime overhead is not calibrated; these results are not an uninstrumented latency SLA.')
        runner = NativeSoak(args, evidence)
        result = runner.run()
        runner.cleanup()
        evidence.save(**result, cleanupVerified=True)
        status = 0
    except BlockedEnvironment as exc:
        evidence.event('environment_blocked', reason=str(exc))
        evidence.save(status='BLOCKED_ENVIRONMENT', failure=str(exc), coverageStatus='NOT_RUN',
                      nativeExecutionVerified=False, cleanupVerified=runner is None)
        if runner:
            try:
                runner.cleanup()
                evidence.save(cleanupVerified=True)
            except BaseException as cleanup_error:
                evidence.save(status='FAIL', cleanupVerified=False, cleanupFailure=str(cleanup_error))
                status = 1
        if evidence.summary['status'] == 'BLOCKED_ENVIRONMENT':
            status = 78
    except BaseException as exc:
        evidence.event('run_failed', exception=type(exc).__name__, reason=str(exc))
        evidence.save(status='FAIL', failure=str(exc), traceback=traceback.format_exc(limit=8))
        if runner:
            try:
                runner.cleanup()
                evidence.save(cleanupVerified=True)
            except BaseException as cleanup_error:
                evidence.save(cleanupVerified=False, cleanupFailure=str(cleanup_error))
    print(json.dumps({'status': evidence.summary['status'], 'evidenceDir': str(evidence.directory),
                      'nativeExecutionVerified': evidence.summary['nativeExecutionVerified'],
                      'coverage': dict(evidence.counts), 'failure': evidence.summary.get('failure')}, sort_keys=True))
    return status


if __name__ == '__main__':
    raise SystemExit(main())
