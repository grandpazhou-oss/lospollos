"""Bounded evidence and Linux /proc observation for the synthetic browser soak."""
from __future__ import annotations

import _thread
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import threading
import time


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
                'startTicks': int(fields[19]), 'name': head.split('(', 1)[1]}
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

    A violation interrupts this test's main Python thread so its owned-launcher
    cleanup runs. No PID chosen by process name or service port is signalled.
    RSS is an intentionally conservative sum (shared pages can be double-counted).
    """
    def __init__(self, log, rss_mib=1024, fd_limit=1024, interval=1.0):
        self.log, self.rss_limit = log, int(rss_mib * 1024 * 1024)
        self.fd_limit, self.interval = fd_limit, interval
        self.roots, self.samples, self.violation = {}, [], None
        self.lock, self.stop_event = threading.Lock(), threading.Event()
        self.thread = None

    def add_root(self, pid):
        table = process_table()
        if pid not in table:
            raise RuntimeError('Owned resource-monitor root disappeared: ' + str(pid))
        with self.lock:
            self.roots[pid] = table[pid]['startTicks']

    def sample(self):
        table, rows = process_table(), []
        with self.lock:
            roots = dict(self.roots)
        for pid in sorted(descendant_ids(table, roots)):
            directory = Path('/proc') / str(pid)
            try:
                status = dict(line.split(':', 1) for line in (directory / 'status').read_text().splitlines()
                              if ':' in line)
                rss = int(status.get('VmRSS', '0 kB').split()[0]) * 1024
                fds = len(list((directory / 'fd').iterdir()))
                name = table[pid]['name'].lower()
                rows.append({'pid': pid, 'parentPID': table[pid]['ppid'], 'startTicks': table[pid]['startTicks'],
                    'kind': 'browser' if 'chrom' in name else 'owned_runner_driver_or_service',
                    'rssBytes': rss, 'fds': fds, 'threads': int(status.get('Threads', '0'))})
            except FileNotFoundError:
                continue
        if not rows:
            raise RuntimeError('Resource sample contains no owned process')
        value = {'rssBytes': sum(r['rssBytes'] for r in rows), 'fds': sum(r['fds'] for r in rows),
                 'threads': sum(r['threads'] for r in rows), 'processes': len(rows),
                 'browserRSSBytes': sum(r['rssBytes'] for r in rows if r['kind'] == 'browser'),
                 'byProcess': rows}
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
        self.sample()
        def loop():
            while not self.stop_event.wait(self.interval):
                try:
                    self.sample()
                except Exception as exc:
                    self.violation = {'reason': 'RESOURCE_OBSERVATION_FAILED', 'error': str(exc)}
                    self.log.emit('resource_observation_failure', **self.violation)
                if self.violation:
                    _thread.interrupt_main()
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
        for key in ('rssBytes', 'browserRSSBytes', 'fds', 'threads', 'processes'):
            ys = [s[key] for s in values]
            my = statistics.mean(ys)
            slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / denominator if denominator else 0
            output[key] = {'baseline': ys[0], 'last': ys[-1], 'peak': max(ys),
                           'delta': ys[-1] - ys[0], 'linearSlopePerMinute': round(slope * 60, 3)}
        return output
