#!/usr/bin/env python3
"""Bounded real-Chromium wait-path component A/B; never product acceptance."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import importlib.metadata
import json
import math
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
from urllib.parse import urlsplit

from enterprise_browser_soak_support import (
    EvidenceLog, ResourceMonitor, SoakDeadlineError, process_table, source_identity, supervise_process,
)

ROOT = Path(__file__).resolve().parents[1]
WAIT_TIMEOUT_MS = 25000
NEGATIVE_TIMEOUT_MS = 150
MAX_GENERATIONS = 32
ELEMENTS_PER_GENERATION = 512
CHECKPOINT_EVERY = 8
MAX_OBSERVATIONS = 9
PROTECTED_PORTS = {8787, 8877, 8791, 8766, 8788, 19095}
NETWORK_TYPES = ('Request', 'Response', 'Route')
SUCCESS_STATUSES = ('PASS_DIAGNOSTIC', 'COMPLETE_INCONCLUSIVE')
FIXTURE = '''<!doctype html><html><head><meta charset="utf-8">
<title>Synthetic wait-path component, not product acceptance</title>
<link rel="icon" href="data:,"><style>
body{font:14px sans-serif}#mount>section{width:600px;min-height:30px}
#mount span{display:inline-block;width:1px;height:1px}
</style></head><body><p>SYNTHETIC WAIT-PATH COMPONENT - NOT PRODUCT ACCEPTANCE</p>
<div id="mount"></div><div id="qualification"></div>
<script>
(() => {
  'use strict';
  const mount = document.getElementById('mount');
  const weakRoots = [];
  let created = 0, retired = 0;
  window.waitPathFixture = Object.freeze({
    create(generation) {
      if (generation !== created + 1 || generation > 32 || mount.childElementCount)
        throw Error('FIXTURE_GENERATION_BOUNDARY');
      const root = document.createElement('section');
      root.dataset.generation = String(generation);
      root.dataset.abTarget = 'visible';
      root.setAttribute('aria-label', 'Synthetic visible wait root');
      for (let i = 0; i < 511; i++) root.append(document.createElement('span'));
      mount.replaceChildren(root); created++;
      return {generation, elements: root.querySelectorAll('*').length + 1,
        targets: Number(root.matches('[data-ab-target]')) + root.querySelectorAll('[data-ab-target]').length};
    },
    retire(generation) {
      const root = mount.firstElementChild;
      if (!root || Number(root.dataset.generation) !== generation || generation !== retired + 1 || weakRoots.length >= 32)
        throw Error('FIXTURE_RETIREMENT_BOUNDARY');
      weakRoots.push({generation, ref: new WeakRef(root)});
      mount.replaceChildren(); retired++;
      return {generation, retired, weakRefCount: weakRoots.length, mountedRoots: mount.childElementCount};
    },
    snapshot() {
      const alive = [];
      for (const entry of weakRoots) {
        const root = entry.ref.deref();
        if (root) alive.push({generation: entry.generation, connected: root.isConnected,
          elements: root.querySelectorAll('*').length + 1});
      }
      return {created, retired, weakRefCount: weakRoots.length,
        mountedRoots: mount.childElementCount, alive};
    },
    qualification(kind) {
      const host = document.getElementById('qualification'); host.replaceChildren();
      if (kind !== 'missing') {
        const node = document.createElement('div'); node.id = 'qualification-target';
        node.style.cssText = 'width:40px;height:20px;background:blue';
        if (kind === 'transparent') node.style.opacity = '0';
        if (kind === 'hidden') node.style.visibility = 'hidden';
        if (kind === 'zero_size') node.style.cssText = 'width:0;height:0';
        host.append(node);
      }
      return {kind, targets: host.childElementCount};
    }
  });
})();
</script></body></html>'''


def identity():
    result = source_identity(ROOT)
    result['waitPathHarnessSHA256'] = {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in (Path(__file__), ROOT / 'tests/README-enterprise-wait-path-ab.md')}
    return result


def validate_snapshot(snapshot, generation):
    assert snapshot['created'] == snapshot['retired'] == snapshot['weakRefCount'] == generation, 'FIXTURE_COUNT_MISMATCH'
    assert snapshot['mountedRoots'] == 0, 'FIXTURE_ROOT_WAS_NOT_DETACHED'
    ids = [row['generation'] for row in snapshot['alive']]
    assert len(ids) == len(set(ids)) and all(1 <= value <= generation for value in ids), 'INVALID_WEAKREF_GENERATION'
    assert all(not row['connected'] and row['elements'] == ELEMENTS_PER_GENERATION for row in snapshot['alive']), 'DETACHED_FIXTURE_STRUCTURE_CHANGED'


def classify_checkpoint(generation, handle_deltas, snapshots, final=False):
    """Predetermined finite component criterion; not a product-leak classifier."""
    if generation < CHECKPOINT_EVERY:
        return {'outcome': 'CONTINUE', 'terminal': False}
    if handle_deltas != {'A': generation, 'B': 0}:
        return {'outcome': 'INCONCLUSIVE_PROTOCOL_PATTERN', 'terminal': True, 'handleDeltas': handle_deltas}
    a_live = {row['generation'] for row in snapshots['A']['alive']}
    b_live = {row['generation'] for row in snapshots['B']['alive']}
    witnesses = sorted(a_live - b_live)
    # Require at least four matched generations, rather than a single GC-timing difference.
    if len(a_live) == generation and len(witnesses) >= 4:
        return {'outcome': 'DETACHED_FIXTURE_RETENTION_DIFFERENCE_OBSERVED', 'terminal': True,
                'matchedGenerationsAliveOnlyInA': witnesses,
                'interpretation': 'Component-level waiting-path difference; not attribution of product DOM or all RSS'}
    return {'outcome': 'HANDLE_RETENTION_ONLY_DOM_INCONCLUSIVE' if final else 'CONTINUE',
            'terminal': final, 'matchedGenerationsAliveOnlyInA': witnesses}


def expected_visibility_exception(arm, error, timeout_error_type):
    return isinstance(error, timeout_error_type) if arm == 'A' else isinstance(error, AssertionError)


def checked_ephemeral_range(value):
    try:
        low, high = map(int, value.split())
    except (ValueError, TypeError) as error:
        raise EnvironmentError('Cannot verify Linux ephemeral port range') from error
    if not 1024 <= low <= high <= 65535 or any(low <= port <= high for port in PROTECTED_PORTS):
        raise EnvironmentError('Linux ephemeral port range overlaps a protected port or is invalid')
    return low, high


def finalize_supervisor_result(result, code, failure, cleanup):
    """A worker return code never leaves running, stale-success or unknown evidence."""
    result['ownedProcessCleanup'] = cleanup
    cleanup_ok = cleanup.get('status') == 'PASS' and not cleanup.get('remainingLiveProcesses') and not cleanup.get('signalErrors')
    terminal = (*SUCCESS_STATUSES, 'FAIL', 'BLOCKED_ENVIRONMENT')
    if failure or not cleanup_ok:
        result['status'] = 'FAIL'
        result['supervisor'] = failure
        result['terminalError'] = 'SUPERVISOR_STOP_OR_OWNED_CLEANUP_FAILURE'
    elif result.get('status') not in terminal:
        result['reportedWorkerStatus'] = result.get('status')
        result['status'] = 'FAIL'
        result['terminalError'] = 'NONTERMINAL_OR_UNKNOWN_SUMMARY'
    elif code != 0 and not (code == 78 and result['status'] == 'BLOCKED_ENVIRONMENT'):
        result['status'] = 'FAIL'
        result['terminalError'] = 'NONZERO_WORKER_EXIT'
    elif code == 0 and result['status'] == 'BLOCKED_ENVIRONMENT':
        result['status'] = 'FAIL'
        result['terminalError'] = 'WORKER_EXIT_STATUS_MISMATCH'
    result.update(productAcceptance='NOT_RUN', soakQualification='NOT_MUTATION_SOAK', workerExitCode=code)
    result['componentOutcomeAccepted'] = result['status'] == 'PASS_DIAGNOSTIC' and cleanup_ok
    return 0 if result['status'] in SUCCESS_STATUSES else 78 if result['status'] == 'BLOCKED_ENVIRONMENT' else 1


class WaitPathSuite:
    def __init__(self, args):
        self.args, self.evidence = args, args.evidence_dir
        self.runtime = Path(os.environ['STCT_AB_OWNED_RUNTIME'])
        self.profile = self.runtime / 'browser-profile'
        self.events = EvidenceLog(self.evidence / 'events.jsonl', self.scrub)
        self.monitor = ResourceMonitor(EvidenceLog(self.evidence / 'resources.jsonl', self.scrub),
            args.max_rss_mib, 1024, 1.0, self.evidence / 'abort-request.json')
        self.context = self.server = self.server_log = None
        self.pages, self.page_identity = {}, None
        self.server_ticks = None
        self.interrupted = None
        self.stage = 'DEPENDENCIES'
        self.started = time.monotonic()
        self.checkpoint_count = 0
        self.result = {'suite': 'ENTERPRISE_WAIT_PATH_AB', 'status': 'RUNNING',
            'classification': 'SYNTHETIC_BROWSER_COMPONENT_NOT_PRODUCT_ACCEPTANCE',
            'productAcceptance': 'NOT_RUN', 'soakQualification': 'NOT_MUTATION_SOAK',
            'source': identity(), 'requested': vars(args) | {'evidence_dir': '<evidence>'},
            'resourceLimits': {'aggregateRSSBytes': args.max_rss_mib * 1024 ** 2, 'aggregateFDs': 1024, 'tabs': 3},
            'fixture': {'sha256': hashlib.sha256(FIXTURE.encode()).hexdigest(),
                'elementsPerGeneration': ELEMENTS_PER_GENERATION, 'maximumWeakRefsPerArm': MAX_GENERATIONS,
                'strongRootReferencesRetainedByFixture': False},
            'mainArmWaitTimeoutMs': WAIT_TIMEOUT_MS, 'negativeQualificationTimeoutMs': NEGATIVE_TIMEOUT_MS,
            'negativeTimeoutIsMainArmTimeout': False, 'forcedGC': False,
            'privateRegistryMutation': False, 'continuousTrace': False,
            'pageErrors': [], 'blockedExternalOrigins': [], 'stages': {}, 'completedGenerations': 0}

    def scrub(self, value):
        for path, replacement in ((self.evidence, '<evidence>'), (self.runtime, '<runtime>'), (ROOT, '<checkout>')):
            value = value.replace(str(path), replacement)
        return value

    def write(self):
        self.result['elapsedSeconds'] = round(time.monotonic() - self.started, 3)
        pending = self.evidence / 'summary.pending'
        pending.write_text(self.scrub(json.dumps(self.result, ensure_ascii=False, indent=2)) + '\n')
        pending.replace(self.evidence / 'summary.json')

    def begin(self, stage):
        self.guard()
        self.stage = stage
        self.result['stages'][stage] = {'status': 'RUNNING'}
        self.events.emit('stage_start', stage=stage)
        self.write()
        print(json.dumps({'stage': stage, 'status': 'RUNNING'}), flush=True)

    def passed(self, **details):
        self.guard()
        self.result['stages'][self.stage] = {'status': 'PASS', **details}
        self.events.emit('stage_pass', stage=self.stage, details=details)
        self.write()

    def guard(self):
        if self.interrupted:
            raise SoakDeadlineError('WAIT_PATH_AB_COOPERATIVE_SIGNAL_' + str(self.interrupted))
        if self.monitor.violation:
            raise AssertionError(json.dumps(self.monitor.violation))
        if self.page_identity is not None:
            assert tuple(self.context.pages) == self.page_identity and len(self.context.pages) == 3, 'AB_PAGE_SET_CHANGED'
        assert not self.result['pageErrors'], self.result['pageErrors']
        assert not self.result['blockedExternalOrigins'], 'UNEXPECTED_EXTERNAL_REQUEST'
        assert self.checkpoint_count <= MAX_OBSERVATIONS, 'AB_OBSERVATION_BOUND_EXCEEDED'
        assert time.monotonic() - self.started <= self.args.max_wall_seconds, 'AB_WORKER_DEADLINE_EXCEEDED'

    def dependencies_and_server(self):
        self.begin('DEPENDENCIES')
        version = importlib.metadata.version('playwright')
        if version != '1.57.0':
            raise EnvironmentError('This experiment requires the approved Playwright 1.57.0, found ' + version)
        self.result['playwrightVersion'] = version
        self.passed(playwrightVersion=version, ortoolsRequired=False, nativeSolverStarted=False)
        self.begin('OWNED_FIXTURE_SERVER')
        # Check before binding port 0; do not first occupy a protected port on a
        # host whose administrator configured an unusual ephemeral range.
        ephemeral_range = checked_ephemeral_range(Path('/proc/sys/net/ipv4/ip_local_port_range').read_text())
        directory = self.runtime / 'fixture'
        directory.mkdir()
        (directory / 'fixture.html').write_text(FIXTURE)
        (self.evidence / 'synthetic-wait-fixture.html').write_text(FIXTURE)
        log_path = self.runtime / 'fixture-server.log'
        self.server_log = log_path.open('w')
        self.server = subprocess.Popen([sys.executable, '-u', '-m', 'http.server', '0', '--bind', '127.0.0.1',
                                        '--directory', str(directory)], stdout=self.server_log, stderr=subprocess.STDOUT)
        self.monitor.add_root(self.server.pid, kind='services_workers')
        self.server_ticks = self.monitor.roots[self.server.pid]
        receipt = {'runToken': self.runtime.name, 'services': [{'pid': self.server.pid, 'startTicks': self.server_ticks}]}
        pending = self.runtime / 'owned-processes.pending'
        pending.write_text(json.dumps(receipt)); pending.replace(self.runtime / 'owned-processes.json')
        deadline = time.monotonic() + 10
        port = None
        while time.monotonic() < deadline:
            self.guard()
            if self.server.poll() is not None:
                raise EnvironmentError('Owned fixture HTTP server exited during startup')
            match = re.search(r'Serving HTTP on 127\.0\.0\.1 port (\d+)', log_path.read_text())
            if match:
                port = int(match.group(1)); break
            time.sleep(.05)
        if port is None:
            raise EnvironmentError('Owned fixture server did not announce its ephemeral port')
        assert port >= 1024 and port not in PROTECTED_PORTS, 'PROTECTED_PORT_SELECTED'
        self.origin = f'http://127.0.0.1:{port}'
        self.passed(bind='127.0.0.1', ephemeralPort=port, serverPID=self.server.pid,
                    serverStartTicks=self.server_ticks, servesOnlySyntheticFixture=True,
                    readOnlyKernelPortRange=list(ephemeral_range))

    def browser(self, playwright):
        self.begin('BROWSER')
        executable = os.environ.get('STCT_CHROMIUM') or os.environ.get('STCT_BROWSER')
        try:
            self.context = playwright.chromium.launch_persistent_context(str(self.profile), headless=True,
                executable_path=executable, args=['--disable-webgl'], service_workers='block',
                viewport={'width': 1024, 'height': 768}, timeout=30000)
        except Exception as error:
            raise EnvironmentError('Approved Chromium launch unavailable: ' + str(error)) from error
        def restrict(route):
            parsed = urlsplit(route.request.url)
            if f'{parsed.scheme}://{parsed.netloc}' == self.origin or parsed.scheme in ('data', 'blob'):
                route.continue_()
            else:
                self.result['blockedExternalOrigins'].append(f'{parsed.scheme}://{parsed.netloc}')
                route.abort()
        self.context.route('**/*', restrict)
        self.context.route_web_socket('**/*', lambda route: route.close())
        initial = list(self.context.pages)
        assert len(initial) <= 1, 'UNEXPECTED_FRESH_CONTEXT_PAGES'
        self.pages['A'] = initial[0] if initial else self.context.new_page()
        self.pages['B'] = self.context.new_page()
        self.pages['control'] = self.context.new_page()
        self.page_identity = tuple(self.context.pages)
        for name, page in self.pages.items():
            page.set_default_timeout(WAIT_TIMEOUT_MS)
            page.on('pageerror', lambda error: self.result['pageErrors'].append(self.scrub(str(error))[:1000]))
            page.goto(self.origin + '/fixture.html?arm=' + name, wait_until='load')
            assert page.evaluate('() => typeof WeakRef === "function" && typeof waitPathFixture === "object"'), 'FIXTURE_NOT_READY'
        self.result['pageIdentities'] = {name: page._impl_obj._guid for name, page in self.pages.items()}
        self.result['browserVersion'] = self.context.browser.version
        self.passed(pages=3, freshPersistentProfile=True, sameFixtureSHA256=self.result['fixture']['sha256'])

    def wait_visible(self, arm, locator, timeout=WAIT_TIMEOUT_MS):
        if arm == 'A':
            locator.wait_for(state='visible', timeout=timeout)
        else:
            self.expect(locator).to_be_visible(timeout=timeout)

    def qualify_visibility(self):
        self.begin('VISIBILITY_SEMANTICS_AND_ERRORS')
        page = self.pages['control']
        records = []
        for kind, visible in (('visible', True), ('transparent', True), ('hidden', False),
                              ('zero_size', False), ('missing', False)):
            page.evaluate('(kind) => waitPathFixture.qualification(kind)', kind)
            for arm in ('A', 'B'):
                timeout = WAIT_TIMEOUT_MS if visible else NEGATIVE_TIMEOUT_MS
                started = time.monotonic(); caught = None
                try:
                    self.wait_visible(arm, page.locator('#qualification-target'), timeout)
                except Exception as error:
                    caught = error
                record = {'case': kind, 'arm': arm, 'expectedVisible': visible, 'timeoutMs': timeout,
                    'elapsedMs': round((time.monotonic() - started) * 1000, 3),
                    'exceptionClass': None if caught is None else type(caught).__module__ + '.' + type(caught).__name__,
                    'exceptionMessage': None if caught is None else self.scrub(str(caught))[:1000]}
                records.append(record)
                if visible:
                    assert caught is None, record
                else:
                    assert caught is not None and expected_visibility_exception(arm, caught, self.timeout_error), record
                self.guard()
        page.evaluate('() => waitPathFixture.qualification("missing")')
        self.result['visibilityQualification'] = records
        self.passed(cases=len(records), normalAndOpacityZeroVisible=True,
                    hiddenZeroSizeMissingInvisible=True, armANegative='Playwright TimeoutError',
                    armBNegative='AssertionError', sameConditionDoesNotMeanSameExceptionOrPolling=True)

    def protocol_counts(self):
        connection = self.pages['A']._impl_obj._connection
        guids = {page._impl_obj._guid: name for name, page in self.pages.items()}
        assert len(guids) == 3 and all(connection._objects.get(page._impl_obj._guid) is page._impl_obj
                                      for page in self.pages.values()), 'AB_PAGE_PROTOCOL_IDENTITY_UNVERIFIED'
        total = Counter(); by_page = {name: Counter() for name in self.pages}; unassigned = Counter()
        for value in connection._objects.values():
            total[value._type] += 1
            current, owner = value, None
            for _ in range(16):
                if current is None: break
                if current._guid in guids:
                    owner = guids[current._guid]; break
                current = current._parent
            if value._type in (*NETWORK_TYPES, 'ElementHandle'):
                assert owner is not None, 'AB_PROTOCOL_PAGE_ATTRIBUTION_FAILED:' + value._type
            (by_page[owner] if owner else unassigned)[value._type] += 1
        return {'method': 'READ_ONLY_PROTOCOL_PARENT_CHAIN_TO_PAGE_GUID_NO_REGISTRY_MUTATION',
            'totalByType': dict(sorted(total.items())),
            'byPage': {name: {'pageGUID': self.pages[name]._impl_obj._guid, 'byType': dict(sorted(counts.items()))}
                       for name, counts in by_page.items()},
            'unassignedByType': dict(sorted(unassigned.items())), 'pendingCallbacks': len(connection._callbacks)}

    def observe(self, label):
        self.guard()
        assert self.checkpoint_count < MAX_OBSERVATIONS, 'AB_OBSERVATION_BOUND_EXCEEDED'
        self.checkpoint_count += 1
        snapshots, metrics = {}, {}
        for name, page in self.pages.items():
            if name in ('A', 'B'):
                snapshots[name] = page.evaluate('() => waitPathFixture.snapshot()')
                validate_snapshot(snapshots[name], self.result['completedGenerations'])
            session = self.context.new_cdp_session(page)
            try:
                session.send('Performance.enable')
                values = {r['name']: r['value'] for r in session.send('Performance.getMetrics')['metrics']}
                metrics[name] = {'performance': {key: values[key] for key in
                    ('JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'Documents', 'JSEventListeners')},
                    'dom': session.send('Memory.getDOMCounters')}
            finally:
                session.detach()
        protocol = self.protocol_counts()
        assert protocol['totalByType'].get('Page') == 3 and protocol['totalByType'].get('BrowserContext') == 1, 'AB_PROTOCOL_PAGE_CONTEXT_CHANGED'
        assert protocol['totalByType'].get('CDPSession', 0) == 0, 'AB_CDP_SESSION_RETAINED'
        row = self.events.emit('object_checkpoint', label=label, generation=self.result['completedGenerations'],
            fixture=snapshots, protocol=protocol, pages=metrics,
            metricScope='CDP may include shared-renderer activity; WeakRefs and protocol Page ancestry provide arm attribution',
            resource=self.monitor.sample())
        if hasattr(self, 'baseline'):
            for kind in NETWORK_TYPES:
                assert protocol['totalByType'].get(kind, 0) == self.baseline['protocol']['totalByType'].get(kind, 0), 'AB_NETWORK_OBJECT_CONFOUND:' + kind
        self.result['lastCheckpoint'] = row
        self.write()
        return row

    def evaluate_checkpoint(self, row, final=False):
        deltas = {arm: row['protocol']['byPage'][arm]['byType'].get('ElementHandle', 0) -
                  self.baseline['protocol']['byPage'][arm]['byType'].get('ElementHandle', 0) for arm in ('A', 'B')}
        conclusion = classify_checkpoint(self.result['completedGenerations'], deltas, row['fixture'], final)
        conclusion.update(handleDeltas=deltas, generation=self.result['completedGenerations'],
                          outcomeAppliesTo='SYNTHETIC_DETACHED_FIXTURE_ROOTS_ONLY')
        self.result['conclusion'] = conclusion
        self.write()
        return conclusion['terminal']

    def run_comparison(self):
        self.begin('PAIRED_WAIT_PATH_REPLAY')
        self.baseline = self.observe('baseline_after_qualification_before_main_arms')
        self.result['baselineCheckpoint'] = self.baseline
        terminal = False
        for generation in range(1, self.args.generations + 1):
            self.guard()
            order = ('A', 'B') if generation % 2 else ('B', 'A')
            for arm in order:
                created = self.pages[arm].evaluate('(generation) => waitPathFixture.create(generation)', generation)
                assert created == {'generation': generation, 'elements': ELEMENTS_PER_GENERATION, 'targets': 1}
            for arm in order:
                self.wait_visible(arm, self.pages[arm].locator('[data-ab-target]'))
            for arm in order:
                retired = self.pages[arm].evaluate('(generation) => waitPathFixture.retire(generation)', generation)
                assert retired == {'generation': generation, 'retired': generation, 'weakRefCount': generation, 'mountedRoots': 0}
            self.result['completedGenerations'] = generation
            self.events.emit('paired_generation_pass', generation=generation, order=list(order),
                mainWaitTimeoutMs=WAIT_TIMEOUT_MS, identicalFixture=True, bothVisibleWaitsSucceeded=True)
            if generation % CHECKPOINT_EVERY == 0:
                terminal = self.evaluate_checkpoint(self.observe('generation_' + str(generation)))
                if terminal: break
        self.passed(completedGenerations=self.result['completedGenerations'], maximumGenerations=self.args.generations,
                    noHistoryOrProductMutation=True, alternatingOrder=True)
        self.result['naturalObservationSeconds'] = 0
        if not terminal:
            self.begin('BOUNDED_NATURAL_OBSERVATION')
            started = time.monotonic()
            targets = sorted({min(value, self.args.idle_seconds) for value in (5, 15, 30, 60)})
            next_index = 0
            while time.monotonic() - started < self.args.idle_seconds:
                self.guard()
                self.pages['control'].wait_for_timeout(min(250, max(0, self.args.idle_seconds - (time.monotonic() - started)) * 1000))
                elapsed = time.monotonic() - started
                if next_index < len(targets) and elapsed >= targets[next_index]:
                    terminal = self.evaluate_checkpoint(self.observe('natural_observation_' + str(round(elapsed, 3))))
                    while next_index < len(targets) and targets[next_index] <= elapsed:
                        next_index += 1
                    if terminal: break
            self.result['naturalObservationSeconds'] = round(time.monotonic() - started, 3)
            if not terminal:
                self.evaluate_checkpoint(self.result['lastCheckpoint'], final=True)
            self.passed(observedSeconds=self.result['naturalObservationSeconds'], maximumSeconds=self.args.idle_seconds,
                        pressureOperations=0, forcedGC=False)
        self.result['sourceAfter'] = identity()
        assert self.result['source'] == self.result['sourceAfter'], 'SOURCE_CHANGED_DURING_AB'
        self.result['status'] = 'PASS_DIAGNOSTIC' if self.result['conclusion']['outcome'] == 'DETACHED_FIXTURE_RETENTION_DIFFERENCE_OBSERVED' else 'COMPLETE_INCONCLUSIVE'
        self.result['resourceTrend'] = self.monitor.trend(self.baseline['resource']['elapsedSeconds'])
        self.result['stopReason'] = 'SUFFICIENT_COMPONENT_DIFFERENCE_OR_PROTOCOL_MISMATCH' if terminal else 'PREDECLARED_BOUNDS_REACHED_NO_EXPANSION'

    def stop_server(self):
        if self.server is None or self.server.poll() is not None:
            return {'status': 'ALREADY_STOPPED_OR_NOT_STARTED'}
        def signal_owned(number):
            table = process_table()
            assert table.get(self.server.pid, {}).get('startTicks') == self.server_ticks, 'SERVER_IDENTITY_CHANGED'
            if hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'):
                fd = os.pidfd_open(self.server.pid)
                try:
                    assert process_table().get(self.server.pid, {}).get('startTicks') == self.server_ticks, 'SERVER_IDENTITY_CHANGED'
                    signal.pidfd_send_signal(fd, number)
                finally: os.close(fd)
            else:
                self.server.send_signal(number)
        try:
            signal_owned(signal.SIGTERM)
            self.server.wait(timeout=5)
            return {'status': 'PASS', 'method': 'OWNED_CHILD_IDENTITY_CHECKED_TERM'}
        except subprocess.TimeoutExpired:
            signal_owned(signal.SIGKILL); self.server.wait(timeout=5)
            return {'status': 'FAIL', 'reason': 'OWNED_FIXTURE_SERVER_REQUIRED_KILL'}

    def cleanup(self):
        self.monitor.stop()
        errors = []
        if self.monitor.violation:
            self.result['status'] = 'FAIL'; self.result['resourceViolation'] = self.monitor.violation
        if self.context:
            try: self.context.close()
            except Exception as error: errors.append(self.scrub(str(error)))
        try:
            server = self.stop_server()
            if server['status'] == 'FAIL': errors.append(server['reason'])
        except Exception as error:
            server = {'status': 'FAIL', 'reason': self.scrub(str(error))}; errors.append(server['reason'])
        if self.server_log: self.server_log.close()
        log = self.runtime / 'fixture-server.log'
        if log.exists():
            (self.evidence / 'fixture-server.log').write_text(self.scrub(log.read_text(errors='replace')))
        self.result['stages']['CLEANUP'] = {'status': 'FAIL' if errors else 'PASS', 'errors': errors, 'fixtureServer': server}
        self.result['resourceTrendIncludingWarmup'] = self.monitor.trend()
        if errors: self.result['status'] = 'FAIL'
        if not errors: shutil.rmtree(self.runtime)
        self.write()

    def run(self):
        old = signal.signal(signal.SIGTERM, lambda number, _frame: setattr(self, 'interrupted', number))
        try:
            self.monitor.start()
            self.dependencies_and_server()
            from playwright.sync_api import sync_playwright, expect, TimeoutError as PlaywrightTimeoutError
            self.expect, self.timeout_error = expect, PlaywrightTimeoutError
            with sync_playwright() as playwright:
                try:
                    self.browser(playwright)
                    self.qualify_visibility()
                    self.run_comparison()
                except BaseException as error:
                    self.result['status'] = 'BLOCKED_ENVIRONMENT' if isinstance(error, EnvironmentError) and self.stage == 'BROWSER' else 'FAIL'
                    self.result['error'] = self.scrub(str(error))[:4000]
                    self.result['stages'][self.stage] = {'status': self.result['status'], 'error': self.result['error']}
                finally: self.cleanup()
        except BaseException as error:
            self.result['status'] = 'BLOCKED_ENVIRONMENT' if isinstance(error, (ImportError, EnvironmentError, importlib.metadata.PackageNotFoundError)) and self.stage in ('DEPENDENCIES', 'OWNED_FIXTURE_SERVER', 'BROWSER') else 'FAIL'
            self.result['error'] = self.scrub(str(error))[:4000]
            self.result['stages'][self.stage] = {'status': self.result['status'], 'error': self.result['error']}
            if self.result['stages'].get('CLEANUP', {}).get('status') != 'PASS':
                try: self.cleanup()
                except Exception as cleanup_error:
                    self.monitor.stop(); self.result['status'] = 'FAIL'
                    self.result['stages']['CLEANUP'] = {'status': 'FAIL', 'error': self.scrub(str(cleanup_error))}
        finally:
            signal.signal(signal.SIGTERM, old)
            self.write()
        print(json.dumps({'status': self.result['status'], 'conclusion': self.result.get('conclusion')}), flush=True)
        return 0 if self.result['status'] in SUCCESS_STATUSES else 78 if self.result['status'] == 'BLOCKED_ENVIRONMENT' else 1


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    parser.add_argument('--memory-profile', choices=('hosted-2gib',), default='hosted-2gib')
    parser.add_argument('--max-rss-mib', type=int, default=2048)
    parser.add_argument('--generations', type=int, choices=(8, 16, 24, 32), default=32)
    parser.add_argument('--idle-seconds', type=float, default=60)
    parser.add_argument('--max-wall-seconds', type=float, default=180)
    parser.add_argument('--self-test', action='store_true', help='Run pure guards only; no browser/server/native process')
    args = parser.parse_args(argv)
    if not 1 <= args.max_rss_mib <= 2048: parser.error('The aggregate 2 GiB cap cannot be enlarged')
    if not math.isfinite(args.idle_seconds) or not 0 <= args.idle_seconds <= 60:
        parser.error('Natural observation must be finite and 0..60 seconds')
    if not math.isfinite(args.max_wall_seconds) or not max(30, args.idle_seconds + 30) <= args.max_wall_seconds <= 180:
        parser.error('Watchdog must cover natural observation plus 30 seconds, capped at 180')
    evidence = args.evidence_dir.expanduser().resolve()
    if evidence == ROOT or ROOT in evidence.parents: parser.error('Evidence must be outside the checkout')
    evidence.mkdir(parents=True, exist_ok=True)
    if any(evidence.iterdir()): parser.error('Use a fresh empty evidence directory')
    args.evidence_dir = evidence
    return args


def supervised_run(args, argv):
    runtime = Path(tempfile.mkdtemp(prefix='stct-wait-path-ab-owned-'))
    env = {**os.environ, 'STCT_AB_WORKER': '1', 'STCT_AB_OWNED_RUNTIME': str(runtime),
           'STCT_SOAK_SUPERVISOR_PID': str(os.getpid()),
           'STCT_SOAK_SUPERVISOR_START_TICKS': str(process_table()[os.getpid()]['startTicks']),
           'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUNBUFFERED': '1'}
    child = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), *argv], cwd=ROOT, env=env, start_new_session=True)
    code, failure, cleanup = supervise_process(child, args.max_wall_seconds, args.evidence_dir / 'abort-request.json',
        lambda: {'status': 'SUPERVISED_CHILD_ONLY', 'externalLauncherOrNativeSolver': False},
        owned_roots_path=runtime / 'owned-processes.json', run_token=runtime.name)
    path = args.evidence_dir / 'summary.json'
    try: result = json.loads(path.read_text())
    except (OSError, ValueError): result = {'status': 'FAIL', 'error': 'AB_SUMMARY_MISSING_OR_INVALID', 'source': identity()}
    exit_code = finalize_supervisor_result(result, code, failure, cleanup)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    if runtime.exists() and not any(runtime.iterdir()): runtime.rmdir()
    return exit_code


class WaitPathGuardTests(unittest.TestCase):
    def parse(self, *flags):
        import contextlib
        import io
        with tempfile.TemporaryDirectory(prefix='wait-path-guard-') as root:
            with contextlib.redirect_stderr(io.StringIO()):
                return parse_args(['--evidence-dir', str(Path(root) / 'evidence'), *flags])

    def test_bounded_defaults(self):
        args = self.parse()
        self.assertEqual((args.generations, args.idle_seconds, args.max_wall_seconds, args.max_rss_mib), (32, 60, 180, 2048))
        self.assertEqual((WAIT_TIMEOUT_MS, NEGATIVE_TIMEOUT_MS, ELEMENTS_PER_GENERATION), (25000, 150, 512))

    def test_expanded_budgets_and_unbounded_values_are_rejected(self):
        for flag, value in (('--generations', '33'), ('--generations', '7'), ('--max-rss-mib', '2049'),
                            ('--idle-seconds', '61'), ('--idle-seconds', 'nan'), ('--max-wall-seconds', '181'),
                            ('--max-wall-seconds', '89')):
            with self.subTest(flag=flag), self.assertRaises(SystemExit): self.parse(flag, value)

    @staticmethod
    def snapshot(generation, alive):
        return {'created': generation, 'retired': generation, 'weakRefCount': generation, 'mountedRoots': 0,
                'alive': [{'generation': n, 'connected': False, 'elements': 512} for n in alive]}

    def test_requires_actual_matched_detached_roots_not_just_fewer_handles(self):
        snapshots = {arm: self.snapshot(8, range(1, 9)) for arm in ('A', 'B')}
        result = classify_checkpoint(8, {'A': 8, 'B': 0}, snapshots, final=True)
        self.assertEqual(result['outcome'], 'HANDLE_RETENTION_ONLY_DOM_INCONCLUSIVE')
        snapshots['B'] = self.snapshot(8, range(5, 9))
        result = classify_checkpoint(8, {'A': 8, 'B': 0}, snapshots)
        self.assertEqual(result['outcome'], 'DETACHED_FIXTURE_RETENTION_DIFFERENCE_OBSERVED')
        self.assertEqual(result['matchedGenerationsAliveOnlyInA'], [1, 2, 3, 4])

    def test_protocol_mismatch_stops_inconclusively(self):
        snapshots = {arm: self.snapshot(8, []) for arm in ('A', 'B')}
        result = classify_checkpoint(8, {'A': 8, 'B': 1}, snapshots)
        self.assertTrue(result['terminal']); self.assertEqual(result['outcome'], 'INCONCLUSIVE_PROTOCOL_PATTERN')

    def test_fixture_guard_rejects_connected_roots_wrong_counts_and_duplicates(self):
        good = self.snapshot(8, range(1, 9)); validate_snapshot(good, 8)
        for mutate in (lambda row: row.update(weakRefCount=33), lambda row: row.update(mountedRoots=1),
                       lambda row: row['alive'][0].update(connected=True),
                       lambda row: row['alive'][0].update(generation=2)):
            changed = json.loads(json.dumps(good)); mutate(changed)
            with self.assertRaises(AssertionError): validate_snapshot(changed, 8)

    def test_timeout_exception_semantics_are_distinct(self):
        class ControlledTimeoutError(Exception): pass
        self.assertTrue(expected_visibility_exception('A', ControlledTimeoutError(), ControlledTimeoutError))
        self.assertFalse(expected_visibility_exception('A', AssertionError(), ControlledTimeoutError))
        self.assertTrue(expected_visibility_exception('B', AssertionError(), ControlledTimeoutError))
        self.assertFalse(expected_visibility_exception('B', ControlledTimeoutError(), ControlledTimeoutError))

    def test_ephemeral_range_is_checked_before_server_bind(self):
        self.assertEqual(checked_ephemeral_range('32768 60999\n'), (32768, 60999))
        for value in ('8000 20000', '1024 65535', '60000 32768', 'invalid', '0 1023'):
            with self.subTest(value=value), self.assertRaises(EnvironmentError): checked_ephemeral_range(value)

    def test_page_attribution_is_verified_and_unknown_element_handle_fails(self):
        from types import SimpleNamespace
        connection = SimpleNamespace(_objects={}, _callbacks={})
        suite = WaitPathSuite.__new__(WaitPathSuite); suite.pages = {}
        for name in ('A', 'B', 'control'):
            page = SimpleNamespace(_guid='page-' + name, _type='Page', _parent=None, _connection=connection)
            connection._objects[page._guid] = page
            suite.pages[name] = SimpleNamespace(_impl_obj=page)
        frame = SimpleNamespace(_guid='frame-A', _type='Frame', _parent=suite.pages['A']._impl_obj)
        handle = SimpleNamespace(_guid='handle-A', _type='ElementHandle', _parent=frame)
        connection._objects.update({frame._guid: frame, handle._guid: handle})
        counts = suite.protocol_counts()
        self.assertEqual(counts['byPage']['A']['byType']['ElementHandle'], 1)
        self.assertNotIn('ElementHandle', counts['byPage']['B']['byType'])
        handle._parent = None
        with self.assertRaisesRegex(AssertionError, 'PAGE_ATTRIBUTION_FAILED'):
            suite.protocol_counts()

    def test_supervisor_rejects_nonterminal_unknown_and_stale_pass(self):
        clean = {'status': 'PASS', 'remainingLiveProcesses': [], 'signalErrors': []}
        cases = [('RUNNING', 0, None, clean, 'NONTERMINAL_OR_UNKNOWN_SUMMARY'),
                 ('unknown', 0, None, clean, 'NONTERMINAL_OR_UNKNOWN_SUMMARY'),
                 ('PASS_DIAGNOSTIC', 1, None, clean, 'NONZERO_WORKER_EXIT'),
                 ('PASS_DIAGNOSTIC', 0, None, {'status': 'FAIL'}, 'SUPERVISOR_STOP_OR_OWNED_CLEANUP_FAILURE'),
                 ('PASS_DIAGNOSTIC', 0, {'reason': 'DEADLINE'}, clean, 'SUPERVISOR_STOP_OR_OWNED_CLEANUP_FAILURE')]
        for status, code, failure, cleanup, reason in cases:
            with self.subTest(status=status, code=code, reason=reason):
                result = {'status': status, 'componentOutcomeAccepted': True}
                self.assertEqual(finalize_supervisor_result(result, code, failure, cleanup), 1)
                self.assertEqual(result['status'], 'FAIL')
                self.assertEqual(result['terminalError'], reason)
                self.assertFalse(result['componentOutcomeAccepted'])

    def test_supervisor_preserves_distinct_conclusive_inconclusive_and_blocked(self):
        clean = {'status': 'PASS', 'remainingLiveProcesses': [], 'signalErrors': []}
        for status, code, accepted in [('PASS_DIAGNOSTIC', 0, True), ('COMPLETE_INCONCLUSIVE', 0, False),
                                      ('BLOCKED_ENVIRONMENT', 78, False)]:
            result = {'status': status}
            self.assertEqual(finalize_supervisor_result(result, code, None, clean), code)
            self.assertEqual(result['status'], status)
            self.assertEqual(result['componentOutcomeAccepted'], accepted)


def run_self_tests(args):
    import io
    stream = io.StringIO()
    result = unittest.TextTestRunner(stream=stream, verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(WaitPathGuardTests))
    (args.evidence_dir / 'guard.log').write_text(stream.getvalue().replace(str(ROOT), '<checkout>'))
    summary = {'suite': 'ENTERPRISE_WAIT_PATH_AB_GUARDS', 'status': 'PASS' if result.wasSuccessful() else 'FAIL',
               'classification': 'PURE_GUARD_SELF_TEST_NOT_BROWSER', 'testsRun': result.testsRun,
               'failures': len(result.failures), 'errors': len(result.errors),
               'browserLaunched': False, 'serverLaunched': False, 'nativeSolverStarted': False,
               'source': identity(), 'productAcceptance': 'NOT_RUN'}
    (args.evidence_dir / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: summary[key] for key in ('status', 'classification', 'testsRun')}))
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    options = parse_args()
    sys.exit(run_self_tests(options) if options.self_test else
             WaitPathSuite(options).run() if os.environ.get('STCT_AB_WORKER') == '1' else supervised_run(options, sys.argv[1:]))
