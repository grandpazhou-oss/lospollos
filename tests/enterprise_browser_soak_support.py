"""Bounded evidence and Linux /proc observation for the synthetic browser soak."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import threading
import time
from test_enterprise_native_soak import proc_snapshot


def source_identity(root):
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root, timeout=20)
    status = git('status', '--porcelain').decode().splitlines()
    files = [*root.glob('tests/*enterprise*soak*')]
    return {'actualSHA': git('rev-parse', 'HEAD').decode().strip(), 'dirty': bool(status),
            'dirtyPaths': status, 'dirtyDiffSHA256': hashlib.sha256(git('diff', 'HEAD', '--binary')).hexdigest(),
            'harnessSHA256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                              for p in sorted(files) if p.is_file()}}


class EvidenceLog:
    def __init__(self, path, scrub):
        self.path, self.scrub = path, scrub
        self.started = time.monotonic()
        self.lock = threading.Lock()

    def emit(self, kind, **fields):
        row = {'kind': kind, 'elapsedSeconds': round(time.monotonic() - self.started, 3), **fields}
        line = self.scrub(json.dumps(row, ensure_ascii=False, separators=(',', ':'))) + '\n'
        with self.lock, self.path.open('a', encoding='utf-8') as target:
            target.write(line)
            target.flush()
        return row


def process_table(proc=Path('/proc')):
    result = {}
    for entry in proc.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            value = (entry / 'stat').read_text()
            head, tail = value.rsplit(')', 1)
            fields = tail.split()
            result[int(entry.name)] = {'pid': int(entry.name), 'ppid': int(fields[1]),
                'startTicks': int(fields[19]), 'name': head.split('(', 1)[1], 'state': fields[0]}
        except (OSError, ValueError, IndexError):
            continue  # A process can exit between directory and stat reads.
    return result


def descendant_ids(table, roots):
    selected = {pid for pid, start in roots.items()
                if pid in table and table[pid]['startTicks'] == start}
    while True:
        found = {pid for pid, row in table.items() if row['ppid'] in selected}
        if found.issubset(selected):
            return selected
        selected.update(found)


class ResourceMonitor:
    """Observe only this test's verified PID roots and descendants, never kill them.

    A violation publishes a cooperative stop flag. An independent supervisor
    bounds shutdown without throwing exceptions into Playwright's dispatcher.
    No PID chosen by process name or service port is signalled.
    RSS is an intentionally conservative sum (shared pages can be double-counted).
    """
    def __init__(self, log, rss_mib=1024, fd_limit=1024, interval=1.0, abort_path=None):
        self.log, self.rss_limit = log, int(rss_mib * 1024 * 1024)
        self.fd_limit, self.interval = fd_limit, interval
        self.abort_path = abort_path
        self.roots, self.samples, self.violation = {}, [], None
        self.root_kinds = {}
        self.lock, self.stop_event = threading.Lock(), threading.Event()
        self.thread = None

    def add_root(self, pid, kind='harness'):
        table = process_table()
        if pid not in table:
            raise RuntimeError('Owned resource-monitor root disappeared: ' + str(pid))
        with self.lock:
            self.roots[pid] = table[pid]['startTicks']
            self.root_kinds[pid] = kind

    def sample(self):
        table, rows, state_only = process_table(), [], []
        with self.lock:
            roots = dict(self.roots)
            kinds = dict(self.root_kinds)
        service_ids = descendant_ids(table, {pid:ticks for pid,ticks in roots.items() if kinds.get(pid) == 'services_workers'})
        for pid in sorted(descendant_ids(table, roots)):
            expected = table[pid]
            observations = []
            # Reuse the already-tested bounded (20ms) identity-only exit check.
            # Persistent live denial and unreadable identity still raise.
            measured = proc_snapshot(pid, observe=observations.append)
            if measured is None and not observations:
                observations.append({**expected, 'observation': 'GONE_BEFORE_RESOURCE_READ'})
            if measured is not None and measured['startTicks'] != expected['startTicks']:
                observations.append({**expected, 'observation': 'DESCENDANT_PID_REUSED',
                                     'replacementStartTicks': measured['startTicks']})
                measured = None
            for observation in observations:
                entry = {**observation, 'expectedStartTicks': expected['startTicks'],
                         'resourcesReadable': False, 'rssBytes': None, 'fds': None, 'threads': None}
                state_only.append(entry)
                self.log.emit('resource_state_only', **entry)
            if measured is None or not measured['resourcesReadable']:
                continue
            name = expected['name'].lower()
            kind = ('chrome' if 'chrom' in name else 'services_workers' if pid in service_ids else
                    'driver' if 'playwright' in measured['command'] else 'harness')
            rows.append({'pid': pid, 'parentPID': measured['ppid'], 'startTicks': measured['startTicks'],
                         'kind': kind, **{key: measured[key] for key in ('rssBytes', 'fds', 'threads')}})
        if not rows:
            raise RuntimeError('Resource sample contains no owned process')
        value = {'rssBytes': sum(r['rssBytes'] for r in rows), 'fds': sum(r['fds'] for r in rows),
                 'threads': sum(r['threads'] for r in rows), 'processes': len(rows),
                 'browserRSSBytes': sum(r['rssBytes'] for r in rows if r['kind'] == 'chrome'),
                 'byProcess': rows, 'stateOnlyProcesses': state_only,
                 'measurementScope': 'READABLE_LIVE_OWNED_IDENTITIES_EXIT_STATES_HAVE_NO_RESOURCE_VALUES'}
        value['byKind'] = {}
        for kind in ('chrome', 'services_workers', 'driver', 'harness'):
            subset = [row for row in rows if row['kind'] == kind]
            value['byKind'][kind] = {key: sum(row[key] for row in subset) for key in ('rssBytes', 'fds', 'threads')}
            value['byKind'][kind]['processes'] = len(subset)
            value[kind + 'RSSBytes'] = value['byKind'][kind]['rssBytes']
        record = self.log.emit('resource_sample', **value)
        with self.lock:
            self.samples.append(record)
        if value['rssBytes'] > self.rss_limit or value['fds'] > self.fd_limit:
            self.violation = {'reason': 'RESOURCE_UPPER_BOUND_EXCEEDED', **value,
                              'rssLimitBytes': self.rss_limit, 'fdLimit': self.fd_limit}
            self.log.emit('resource_limit_failure', **self.violation)
        return record

    def start(self):
        if not Path('/proc/self/status').is_file():
            raise EnvironmentError('Linux /proc is required for resource evidence; no estimates substituted')
        self.add_root(os.getpid())
        supervisor = os.environ.get('STCT_SOAK_SUPERVISOR_PID')
        supervisor_ticks = os.environ.get('STCT_SOAK_SUPERVISOR_START_TICKS')
        if supervisor and supervisor_ticks:
            table = process_table()
            pid = int(supervisor)
            if pid not in table or table[pid]['startTicks'] != int(supervisor_ticks):
                raise RuntimeError('Supervisor resource identity changed')
            self.add_root(pid)
        self.sample()
        def loop():
            while not self.stop_event.wait(self.interval):
                try:
                    self.sample()
                except Exception as exc:
                    self.violation = {'reason': 'RESOURCE_OBSERVATION_FAILED', 'error': str(exc)}
                    self.log.emit('resource_observation_failure', **self.violation)
                if self.violation:
                    # Asynchronous exceptions can kill Playwright's dispatcher
                    # greenlet and make its next sync call spin forever. Publish
                    # a cooperative flag; the independent process supervisor can
                    # stop a wedged worker without invoking any Playwright API.
                    if self.abort_path:
                        pending = self.abort_path.with_suffix('.pending')
                        pending.write_text(json.dumps(self.violation), encoding='utf-8')
                        pending.replace(self.abort_path)
                    return
        self.thread = threading.Thread(target=loop, name='owned-soak-resource-monitor', daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=max(3, self.interval * 2))

    def trend(self, since=0):
        with self.lock:
            values = [s for s in self.samples if s['elapsedSeconds'] >= since]
        if not values:
            return {'sampleCount': 0}
        xs = [s['elapsedSeconds'] for s in values]
        mx = statistics.mean(xs)
        denominator = sum((x - mx) ** 2 for x in xs)
        output = {'sampleCount': len(values), 'firstElapsedSeconds': xs[0], 'lastElapsedSeconds': xs[-1],
                  'method': 'ALL_OWNED_PROCESS_SUM_RSS_CONSERVATIVE_SHARED_PAGES_DOUBLE_COUNTED'}
        for key in ('rssBytes', 'browserRSSBytes', 'fds', 'threads', 'processes',
                    'chromeRSSBytes', 'services_workersRSSBytes', 'driverRSSBytes', 'harnessRSSBytes'):
            ys = [s[key] for s in values]
            my = statistics.mean(ys)
            slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / denominator if denominator else 0
            output[key] = {'baseline': ys[0], 'last': ys[-1], 'peak': max(ys),
                           'delta': ys[-1] - ys[0], 'median': statistics.median(ys), 'minimum': min(ys),
                           'range': max(ys) - min(ys), 'stdDev': round(statistics.pstdev(ys), 3),
                           'linearSlopePerMinute': round(slope * 60, 3)}
        return output


class SoakDeadlineError(RuntimeError):
    pass


def supervise_process(process, timeout, abort_path, on_timeout, grace_seconds=10,
                      owned_roots_path=None, run_token=None):
    """Supervise only this invocation's PID/start-time identities and run token."""
    import signal
    start = time.monotonic()
    table = process_table()
    roots = {process.pid: table[process.pid]['startTicks']} if process.pid in table else {}
    identities, requested, old_handlers = dict(roots), [], {}
    report = {'signalMethod': 'PIDFD_WITH_START_TIME_RECHECK' if hasattr(os, 'pidfd_open') and
              hasattr(signal, 'pidfd_send_signal') else 'PID_WITH_START_TIME_RECHECK',
              'signals': [], 'signalErrors': [], 'remainingLiveProcesses': [], 'remainingZombies': []}
    for sig in (signal.SIGTERM, signal.SIGINT):
        old_handlers[sig] = signal.signal(sig, lambda number, _frame: requested.append(number))

    def remember():
        current = process_table()
        if owned_roots_path and owned_roots_path.exists():
            try:
                receipt = json.loads(owned_roots_path.read_text())
                if receipt.get('runToken') != run_token:
                    raise RuntimeError('Owned process receipt run token mismatch')
                for row in receipt.get('services', []):
                    pid, ticks = row['pid'], row['startTicks']
                    if pid in current and current[pid]['startTicks'] == ticks:
                        roots[pid] = ticks
            except (OSError, ValueError):
                pass
        for pid in descendant_ids(current, roots):
            identities[pid] = current[pid]['startTicks']
        return current

    def survivors():
        current = remember()
        live, zombies = [], []
        for pid, ticks in identities.items():
            if pid in current and current[pid]['startTicks'] == ticks:
                entry = {'pid': pid, 'startTicks': ticks, 'state': current[pid]['state']}
                (zombies if current[pid]['state'] == 'Z' else live).append(entry)
        return live, zombies

    def signal_one(pid, ticks, sig):
        fd = None
        try:
            if report['signalMethod'].startswith('PIDFD'):
                fd = os.pidfd_open(pid)
            current = process_table()
            if pid not in current or current[pid]['startTicks'] != ticks or current[pid]['state'] == 'Z':
                return
            if fd is not None:
                signal.pidfd_send_signal(fd, sig)
            else:
                os.kill(pid, sig)
            report['signals'].append({'pid': pid, 'startTicks': ticks, 'signal': sig})
        except ProcessLookupError:
            pass
        except OSError as exc:
            report['signalErrors'].append({'pid': pid, 'error': str(exc)})
        finally:
            if fd is not None:
                os.close(fd)

    def signal_owned(sig):
        live, _ = survivors()
        for row in sorted(live, key=lambda row: row['pid'] == process.pid):
            signal_one(row['pid'], row['startTicks'], sig)

    def wait_empty(seconds):
        deadline = time.monotonic() + seconds
        while True:
            process.poll()  # Reap our direct child so its zombie is not misreported.
            live, zombies = survivors()
            if not live or time.monotonic() >= deadline:
                return live, zombies
            time.sleep(.05)

    failure = None
    try:
        while process.poll() is None:
            remember()
            if requested:
                failure = {'reason': 'SUPERVISOR_INTERRUPTED', 'signal': requested[0]}
            elif abort_path.exists():
                try: failure = json.loads(abort_path.read_text())
                except (OSError, ValueError): pass
            elif time.monotonic() - start >= timeout:
                failure = {'reason': 'SOAK_WALL_CLOCK_DEADLINE_EXCEEDED', 'limitSeconds': timeout}
            if failure:
                break
            try: process.wait(timeout=.25)
            except subprocess.TimeoutExpired: pass
        if failure:
            failure['elapsedSecondsAtStop'] = round(time.monotonic() - start, 3)
            if process.pid in roots:
                signal_one(process.pid, roots[process.pid], signal.SIGTERM)
            try: process.wait(timeout=grace_seconds)
            except subprocess.TimeoutExpired: pass
        # This verification is mandatory on BOTH normal and abnormal worker exit.
        live, zombies = wait_empty(min(2, grace_seconds)) if not failure else survivors()
        if live and failure is None:
            failure = {'reason': 'OWNED_PROCESS_LEAK_AFTER_NORMAL_EXIT', 'unexpectedLiveProcesses': live}
        if failure:
            try: failure['ownedServiceCleanup'] = on_timeout()
            except Exception as exc: failure['ownedServiceCleanup'] = {'status': 'FAIL', 'error': str(exc)}
            signal_owned(signal.SIGTERM)
            live, zombies = wait_empty(grace_seconds)
            if live:
                signal_owned(signal.SIGKILL)
                live, zombies = wait_empty(5)
        report.update(observedOwnedProcessCount=len(identities), remainingLiveProcesses=live,
                      remainingZombies=zombies, finalCheckElapsedSeconds=round(time.monotonic() - start, 3),
                      status='PASS' if not live and not report['signalErrors'] else 'FAIL',
                      forcedTerminationUsed=bool(report['signals']))
        if failure:
            failure['processCleanup'] = report
        return process.poll(), failure, report
    finally:
        for sig, handler in old_handlers.items(): signal.signal(sig, handler)
