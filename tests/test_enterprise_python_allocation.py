#!/usr/bin/env python3
"""Two bounded fresh-profile Python allocation arms; no mutation-soak qualification."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import importlib.metadata
import json
import math
import os
import platform
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from enterprise_browser_soak_support import process_table, source_identity, supervise_process
from enterprise_python_allocation_support import AllocationDiagnosticError, PythonAllocationProbe
from test_enterprise_browser_soak import BrowserSoakSuite
from test_enterprise_synthetic_full_ui import ROOT, login, state

SCHEDULE_PATH = ROOT / 'tests/enterprise_python_allocation_schedule.json'
SCHEDULE_SHA256 = '24cfff3614e5d29298080c08db03899d480b2968b1783b9046c30f2f68835960'
ARM_WALL_SECONDS, PAIR_WALL_SECONDS, ACTIVITY_SECONDS = 240, 660, 150
RSS_STOP_BYTES, EXPORT_BYTES = 1856 * 1024**2, 8 * 1024**2
MAX_LATENESS_SECONDS = 2.0
KINDS = {'ui': 'complete_public_ui_cycle', 'component': 'native_indexeddb_component_cycle',
         'probe': 'public_ui_and_native_history_probe', 'native': 'controlled_busy_and_native_retry'}
SEMANTIC_POLICY = {
    'version': 1,
    'compared': ['all five complete draft packages after listed symbolic substitutions',
                 'complete endpoint study/scenario/profile/savedPointer after listed substitutions',
                 'all 100 component winner hashes, revisions, counts and fault outcomes',
                 'complete initial and periodic independent native oracle receipts'],
    'substitutions': ['study.studyId: checked root study identity', 'study.inputHash: checked SHA256 binding',
        'profile.profileId: checked MAPPING numeric identity', 'packageHash: checked SHA256 binding',
        'staleResult.snapshotHash/studyHash: checked SHA256 bindings',
        'savedPointer.id/projectId: checked root-derived identities',
        'savedPointer.inputHash/snapshotHash/historySnapshotHashes/refs[].id: checked SHA256 bindings',
        'savedPointer.savedAt: checked ISO timestamp'],
    'notCompared': ['native transport/job envelope: jobId, timestamps, elapsed timing and runtime identity',
                    'snapshot envelope hashes/signatures; full native business oracle receipts are compared',
                    'generated branch IDs; unchanged cycle_ui assertions verify exact branch lineage within each arm',
                    'fresh component database name; all component revisions/winners/counts/fault outcomes are compared'],
    'noArbitraryFieldRemoval': True}


class DiagnosticStop(RuntimeError):
    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def load_schedule():
    raw = SCHEDULE_PATH.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SCHEDULE_SHA256:
        raise DiagnosticStop('FROZEN_SCHEDULE_HASH_MISMATCH')
    value = json.loads(raw)
    operations = value['operations']
    assert Counter(kind for kind, _ in operations) == {'ui': 5, 'component': 100, 'probe': 219, 'native': 1}
    assert [target for kind, target in operations if kind == 'ui'] == [0, 24, 48, 72, 96]
    assert all(kind in KINDS and math.isfinite(target) and 0 <= target < ACTIVITY_SECONDS for kind, target in operations)
    assert all(a[1] <= b[1] for a, b in zip(operations, operations[1:]))
    return value


def timing_gate(target, actual):
    if actual - target > MAX_LATENESS_SECONDS:
        raise DiagnosticStop('FROZEN_SCHEDULE_START_LATE')
    if actual < target - .001:
        raise DiagnosticStop('FROZEN_SCHEDULE_STARTED_EARLY')


def finish_status(summary, code, failure, cleanup):
    summary['soakQualification'] = 'NOT_MUTATION_SOAK'
    summary['productAcceptance'] = 'NOT_RUN'
    summary['explainsAllPythonOrRSS'] = False
    summary['ownedProcessCleanup'] = cleanup
    reasons = [summary['stopReason']] if summary.get('stopReason') else []
    if failure:
        summary['status'] = 'INCONCLUSIVE_STOP'
        summary['stopReason'] = failure.get('reason', 'SUPERVISOR_STOP')
        summary['supervisor'] = failure
        reasons.append(summary['stopReason'])
    if cleanup.get('status') != 'PASS' or cleanup.get('remainingLiveProcesses') or cleanup.get('remainingZombies') or cleanup.get('forcedTerminationUsed'):
        summary['status'] = 'INCONCLUSIVE_STOP'
        summary.setdefault('stopReason', 'OWNED_PROCESS_CLEANUP_NOT_NORMAL')
        reasons.append('OWNED_PROCESS_CLEANUP_NOT_NORMAL')
    if summary.get('status') not in ('PASS_DIAGNOSTIC', 'INCONCLUSIVE_STOP', 'BLOCKED_ENVIRONMENT'):
        summary['status'] = 'INCONCLUSIVE_STOP'
        summary['stopReason'] = 'NONTERMINAL_OR_UNKNOWN_SUMMARY'
        reasons.append(summary['stopReason'])
    if code != 0 and summary['status'] == 'PASS_DIAGNOSTIC':
        summary['status'] = 'INCONCLUSIVE_STOP'
        summary['stopReason'] = 'NONZERO_EXIT_AFTER_SUCCESS'
        reasons.append(summary['stopReason'])
    summary['stopReasons'] = list(dict.fromkeys(reasons))
    return 0 if summary['status'] == 'PASS_DIAGNOSTIC' else 78 if summary['status'] == 'BLOCKED_ENVIRONMENT' else 1


def write_json(path, value):
    data = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
    if len(data) > 1024**2:
        raise DiagnosticStop('SCALAR_METADATA_FILE_EXCEEDED_1MIB')
    path.write_bytes(data)


def check_export_budget(directory):
    if sum(p.stat().st_size for p in directory.rglob('*') if p.is_file()) > EXPORT_BYTES:
        raise DiagnosticStop('DIAGNOSTIC_EXPORT_EXCEEDED_8MIB')


def write_final_summary(directory, summary):
    write_json(directory/'summary.json', summary)
    try:
        check_export_budget(directory)
    except DiagnosticStop as exc:
        summary.update(status='INCONCLUSIVE_STOP', stopReason=exc.reason)
        write_json(directory/'summary.json', summary)


def verified_ownership_roots(sample, table, worker_pid, service_pids, require_browser):
    selected = [row for row in sample['byProcess'] if row['pid'] in {worker_pid, *service_pids}
                or row['kind'] in ('driver','chrome')]
    selected = [row for row in selected if row['pid'] in table and table[row['pid']]['startTicks'] == row['startTicks']]
    if not {worker_pid, *service_pids}.issubset({row['pid'] for row in selected}):
        raise DiagnosticStop('OWNERSHIP_REQUIRED_ROOT_UNVERIFIED')
    if require_browser and not {'driver','chrome'}.issubset({row['kind'] for row in selected}):
        raise DiagnosticStop('OWNERSHIP_DRIVER_OR_BROWSER_ROOT_UNVERIFIED')
    return [{'pid':row['pid'],'startTicks':row['startTicks'],'role':row['kind']} for row in selected]


def publish_receipt(path, token, roots):
    pending = path.with_suffix('.pending')
    write_json(pending, {'runToken':token,'services':roots})
    pending.replace(path)


def publish_startup_arm_root(pair_runtime, child_pid):
    table = process_table()
    if child_pid not in table:
        raise DiagnosticStop('STARTUP_ARM_PID_IDENTITY_UNVERIFIED')
    publish_receipt(pair_runtime/'owned-processes.json',pair_runtime.name,
        [{'pid':child_pid,'startTicks':table[child_pid]['startTicks'],'role':'arm_worker'}])


def descriptive_owner_census(arm):
    output = {}
    for label in ('baseline', 'endpoint'):
        counts = arm[label+'Protocol']['byType']
        categories = arm['checkpoints'][label]['census']['categories']
        output[label] = {}
        for kind in ('Request','Response','Route','Artifact','Stream','Worker'):
            count = counts.get(kind, 0)
            category = ('network.' if kind in ('Request','Response','Route') else 'auxiliary.') + kind
            if count and category not in categories:
                raise DiagnosticStop('CENSUS_OWNER_CATEGORY_MISSING')
            amount = categories.get(category, {}).get('directBytes', 0)
            output[label][kind] = {'registeredOwnerCount':count, 'declaredSubsetDirectBytes':amount,
                                   'subsetBytesPerRegisteredOwner':amount/count if count else None}
    return output


def safe_failure(exc, stage):
    reason = getattr(exc, 'reason', None)
    if reason is None:
        message = str(exc)
        reason = message if re.fullmatch(r'[A-Z][A-Z0-9_]{3,120}', message) else 'BUSINESS_OR_RUNTIME_CHECK_FAILED'
    frames = traceback.extract_tb(exc.__traceback__)
    last = frames[-1] if frames else None
    return {'reason': reason, 'exceptionType': type(exc).__module__ + '.' + type(exc).__name__, 'stage': stage,
            'sourceModule': Path(last.filename).name if last else None, 'sourceLine': last.lineno if last else None,
            'messageSHA256': hashlib.sha256(str(exc).encode()).hexdigest(), 'payloadOrTracebackExported': False}


class SemanticBindings:
    def __init__(self):
        self.hashes, self.root, self.mapping = {}, None, None

    def hash(self, value):
        if value is None:
            return None
        if not isinstance(value, str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', value):
            raise DiagnosticStop('SEMANTIC_HASH_FORMAT_UNEXPECTED')
        return self.hashes.setdefault(value, 'HASH_' + str(len(self.hashes) + 1))

    def study(self, value):
        value = json.loads(json.dumps(value))
        root = value['studyId']
        if not re.fullmatch(r'SUPPLY-\d+', root):
            raise DiagnosticStop('SEMANTIC_ROOT_ID_FORMAT_UNEXPECTED')
        if self.root is not None and self.root != root:
            raise DiagnosticStop('SEMANTIC_ROOT_ID_CHANGED')
        self.root = root
        value['studyId'] = 'ROOT_STUDY'
        value['inputHash'] = self.hash(value['inputHash'])
        return value

    def profile(self, value):
        value = json.loads(json.dumps(value))
        mapping = value['profileId']
        if not re.fullmatch(r'MAPPING-\d+', mapping):
            raise DiagnosticStop('SEMANTIC_MAPPING_ID_FORMAT_UNEXPECTED')
        if self.mapping is not None and self.mapping != mapping:
            raise DiagnosticStop('SEMANTIC_MAPPING_ID_CHANGED')
        self.mapping = mapping
        value['profileId'] = 'ROOT_MAPPING'
        return value

    def stale(self, value):
        if value is None:
            return None
        value = dict(value)
        for key in ('snapshotHash', 'studyHash'):
            if key in value:
                value[key] = self.hash(value[key])
        return value

    def package(self, value):
        value = json.loads(json.dumps(value))
        value['study'] = self.study(value['study'])
        value['profile'] = self.profile(value['profile'])
        value['staleResult'] = self.stale(value.get('staleResult'))
        value['packageHash'] = self.hash(value['packageHash'])
        return value

    def endpoint(self, value):
        value = json.loads(json.dumps(value))
        value['study'] = self.study(value['study'])
        value['profile'] = self.profile(value['profile'])
        pointer = value['savedPointer']
        assert pointer['id'] == 'SUPPLY:' + self.root and pointer['projectId'] == 'PROJECT:' + self.root
        pointer['id'], pointer['projectId'] = 'ROOT_POINTER', 'ROOT_PROJECT'
        assert re.fullmatch(r'\d{4}-\d{2}-\d{2}T[0-9:.]+Z', pointer['savedAt'])
        pointer['savedAt'] = 'VALID_ISO_SAVE_TIMESTAMP'
        for key in ('inputHash', 'snapshotHash'):
            pointer[key] = self.hash(pointer[key])
        pointer['historySnapshotHashes'] = [self.hash(h) for h in pointer['historySnapshotHashes']]
        for ref in pointer['refs']:
            ref['id'] = self.hash(ref['id'])
        pointer['staleResult'] = self.stale(pointer.get('staleResult'))
        return value


def semantic_receipt(work):
    bindings = SemanticBindings()
    packages = [digest(bindings.package(json.loads((work / f'cycle-{i:03d}-retained.package.json').read_text()))) for i in range(1, 6)]
    endpoint = bindings.endpoint(json.loads((work / 'endpoint-business.json').read_text()))
    events = [json.loads(line) for line in (work / 'cycles.jsonl').read_text().splitlines() if line]
    components = [{key: r[key] for key in ('cycle', 'revision', 'winnerHash', 'faultStage', 'quotaRollbacks',
                  'transactionAborts', 'casConflicts', 'immutableHistoryReadbacks', 'counts')}
                  for r in events if r['kind'] == 'component_cycle_pass']
    assert [r['cycle'] for r in components] == list(range(1, 101))
    native = [r['details']['verification'] for r in events if r['kind'] == 'stage_pass' and
              r['stage'] in ('INITIAL_NATIVE_RETRY', 'PERIODIC_NATIVE_RETRY')]
    assert len(native) == 2
    return {'policySHA256': digest(SEMANTIC_POLICY), 'packagesSHA256': packages,
            'endpointSHA256': digest(endpoint), 'componentReceiptsSHA256': digest(components),
            'nativeOracleReceiptsSHA256': digest(native), 'componentCount': 100, 'nativeCount': 2,
            'boundDistinctHashCount': len(bindings.hashes)}


class AllocationArm(BrowserSoakSuite):
    def __init__(self, work, export, enabled):
        args = SimpleNamespace(max_rss_mib=2048, max_fds=1024, sample_seconds=1., memory_profile='hosted-2gib',
            duration_seconds=120., ui_cycles=5, storage_cycles=100, native_every=5, workload_profile='mutation-soak',
            max_wall_seconds=ARM_WALL_SECONDS, smoke=True)
        super().__init__(work, args)
        self.export, self.enabled = export, enabled
        self.probe = PythonAllocationProbe(export, enabled=enabled)
        self.allocation_started, self.activity_ended = False, False
        self.operation_clock = []
        self.activity_timer = None
        self.arm_summary = {'status': 'RUNNING', 'arm': 'on' if enabled else 'off',
            'soakQualification': 'NOT_MUTATION_SOAK', 'productAcceptance': 'NOT_RUN',
            'traceEnabled': enabled, 'scheduleSHA256': SCHEDULE_SHA256, 'source': source_identity(ROOT),
            'limits': {'activitySeconds': 150, 'wallSeconds': 240, 'aggregateRSSBytes': 2147483648,
                       'instrumentStopRSSBytes': RSS_STOP_BYTES, 'fds': 1024, 'pages': 3,
                       'maximumStartLatenessSeconds': 2, 'allocationArtifactBytes': 1024**2},
            'checkpoints': {}, 'operationClock': self.operation_clock}
        self.arm_summary['runtimeVersions'] = {'python':platform.python_version(),
            'pythonImplementation':platform.python_implementation(),
            'platform':{'system':platform.system(),'release':platform.release(),'machine':platform.machine()},
            'playwright':None,'chromium':None,'playwrightDriverNode':None,'ortools':None}

    def guard(self):
        super().guard()
        if self.activity_ended:
            return
        if self.monitor.samples and self.monitor.samples[-1]['rssBytes'] >= RSS_STOP_BYTES:
            raise DiagnosticStop('INSTRUMENT_RSS_PREVENTIVE_STOP_1856MIB')
        if self.allocation_started:
            self.probe.poll()
        if self.soak_started is not None and time.monotonic() - self.soak_started > ACTIVITY_SECONDS:
            raise DiagnosticStop('ARM_ACTIVITY_EXCEEDED_150_SECONDS')

    def operate_until(self, deadline):
        # storage_batch(1, now) may reach this expired boundary. Never generate probes here.
        if deadline > time.monotonic():
            raise DiagnosticStop('UNSCHEDULED_THROUGHPUT_PROBE_PATH')

    def publish_owned_roots(self, require_browser=False):
        sample = self.monitor.sample()
        roots = verified_ownership_roots(sample, process_table(), os.getpid(),
            {self.record[k]['pid'] for k in ('web','optimizer')}, require_browser)
        publish_receipt(self.runtime/'owned-processes.json',self.runtime.name,roots)
        pair_runtime = Path(os.environ['STCT_ALLOC_PAIR_RUNTIME'])
        publish_receipt(pair_runtime/'owned-processes.json',pair_runtime.name,roots)
        self.arm_summary['publishedOwnershipRoots'] = roots

    def start_activity_deadline(self):
        deadline = self.soak_started + ACTIVITY_SECONDS
        self.arm_summary['activityDeadline'] = {'limitSeconds':ACTIVITY_SECONDS,'triggered':False}
        def expire():
            if self.activity_ended:
                return
            value = {'reason':'ARM_ACTIVITY_DEADLINE_150_SECONDS','limitSeconds':ACTIVITY_SECONDS,
                     'activityElapsedSecondsAtTrigger':round(time.monotonic()-self.soak_started,6)}
            self.arm_summary['activityDeadline'].update(triggered=True,**value)
            path = self.evidence/'abort-request.json'
            pending = path.with_suffix('.activity-pending')
            write_json(pending,value)
            pending.replace(path)
        self.activity_timer = threading.Timer(max(0,deadline-time.monotonic()),expire)
        self.activity_timer.daemon = True
        self.activity_timer.start()

    def stop_activity_deadline(self):
        self.activity_ended = True
        if self.activity_timer is not None:
            self.activity_timer.cancel()
            self.activity_timer.join(timeout=1)

    def checkpoint(self, label):
        self.guard()
        resource = self.monitor.sample()
        if resource['rssBytes'] >= RSS_STOP_BYTES:
            raise DiagnosticStop('INSTRUMENT_RSS_PREVENTIVE_STOP_1856MIB')
        started = time.monotonic()
        try:
            receipt = self.probe.checkpoint(label, protocol_objects=self.page._impl_obj._connection._objects.values(),
                resource_samples=self.monitor.samples, result_metadata=self.result)
        except BaseException as exc:
            elapsed = time.monotonic() - started
            self.arm_summary['checkpoints'][label] = {'status': 'INCOMPLETE', 'outerCallSeconds': elapsed,
                'reason': getattr(exc, 'reason', 'CHECKPOINT_CALL_FAILED'), 'partialReceipt': getattr(exc, 'receipt', {})}
            if elapsed > 2:
                raise DiagnosticStop('CHECKPOINT_TOTAL_CALL_EXCEEDED_2_SECONDS') from exc
            raise
        elapsed = time.monotonic() - started
        receipt = {**receipt, 'outerCallSeconds': elapsed}
        self.arm_summary['checkpoints'][label] = receipt
        if elapsed > 2:
            receipt.update(status='INCOMPLETE', reason='CHECKPOINT_TOTAL_CALL_EXCEEDED_2_SECONDS')
            raise DiagnosticStop('CHECKPOINT_TOTAL_CALL_EXCEEDED_2_SECONDS')
        self.arm_summary[label + 'Resource'] = {key: resource[key] for key in ('rssBytes', 'fds', 'processes', 'byKind')}
        self.arm_summary[label + 'Protocol'] = self.protocol_object_counts()

    def replay(self):
        self.next_memory_observation = math.inf  # Same fixed two census checkpoints; no throughput-selected CDP probes.
        self.soak_started = time.monotonic()
        self.start_activity_deadline()
        self.events.emit('allocation_replay_start', scheduledOperations=325)
        seen = Counter()
        for index, (kind, target) in enumerate(load_schedule()['operations'], 1):
            self.guard()
            while (remaining := self.soak_started + target - time.monotonic()) > 0:
                self.page.wait_for_timeout(min(250, remaining * 1000))
                self.guard()
            actual = time.monotonic() - self.soak_started
            row = {'index': index, 'kind': kind, 'targetSeconds': target, 'actualStartSeconds': round(actual, 6),
                   'latenessSeconds': round(actual-target, 6), 'status': 'NOT_STARTED', 'operationRan': False}
            self.operation_clock.append(row)
            timing_gate(target, actual)
            row.update(status='RUNNING', operationRan=True)
            seen[kind] += 1
            if kind == 'ui':
                self.current_cycle = seen[kind]
                self.measured(KINDS[kind], lambda: self.cycle_ui(self.current_cycle))
            elif kind == 'component':
                self.storage_batch(1, time.monotonic())
            elif kind == 'probe':
                self.measured(KINDS[kind], self.durability_probe)
            else:
                self.measured(KINDS[kind], self.native_round)
            row.update(status='PASS', actualEndSeconds=round(time.monotonic()-self.soak_started, 6))
            if kind == 'component' and seen['component'] == 20:
                self.page.screenshot(path=str(self.evidence / 'checkpoint-001.png'), full_page=True)
            self.guard()
        assert seen == {'ui': 5, 'component': 100, 'probe': 219, 'native': 1}
        self.checked_seed_coverage()
        self.validate_selected_wait_retention()
        assert self.result['coverage']['uiDurabilityReopens'] == self.result['coverage']['componentFullHistoryProbes'] == 219
        unexpected = [m for m in self.result['consoleErrors'] if not re.search(r'(?:status of 429|429 \(Too Many Requests\))', m)]
        assert not unexpected and not self.result['externalBlocked'] and not self.result['pageErrors']
        self.arm_summary['activitySeconds'] = round(time.monotonic()-self.soak_started, 6)
        self.guard()
        self.stop_activity_deadline()

    def run_arm(self):
        old_handler = signal.signal(signal.SIGTERM, lambda number, frame: setattr(self, 'interruption_requested', number))
        stop = None
        try:
            from playwright.sync_api import sync_playwright
            from playwright._impl._driver import compute_driver_executable
            versions = self.arm_summary['runtimeVersions']
            versions['playwright'] = importlib.metadata.version('playwright')
            if versions['playwright'] != '1.57.0':
                raise EnvironmentError('APPROVED_PLAYWRIGHT_157_REQUIRED')
            versions['ortools'] = importlib.metadata.version('ortools')
            driver_node, _ = compute_driver_executable()
            try:
                node_version = subprocess.run([driver_node,'--version'],capture_output=True,text=True,timeout=5,check=True).stdout.strip()
            except (OSError,subprocess.SubprocessError) as error:
                raise EnvironmentError('PLAYWRIGHT_DRIVER_NODE_VERSION_UNAVAILABLE') from error
            if not re.fullmatch(r'v\d+\.\d+\.\d+',node_version):
                raise EnvironmentError('PLAYWRIGHT_DRIVER_NODE_VERSION_UNVERIFIED')
            versions['playwrightDriverNode'] = node_version
            versions['driverNodeVersionMethod'] = 'PLAYWRIGHT_SELECTED_EXECUTABLE_VERSION_NO_PATH_SEARCH'
            self.monitor.start()
            outer_pid = int(os.environ['STCT_ALLOC_OUTER_SUPERVISOR_PID'])
            assert process_table()[outer_pid]['startTicks'] == int(os.environ['STCT_ALLOC_OUTER_SUPERVISOR_START_TICKS']), \
                'PAIR_SUPERVISOR_IDENTITY_CHANGED'
            self.monitor.add_root(outer_pid)
            self.launch()
            for kind in ('web', 'optimizer'):
                self.monitor.add_root(self.record[kind]['pid'], kind='services_workers')
            self.publish_owned_roots()
            with sync_playwright() as playwright:
                try:
                    self.open_browser(playwright)
                    self.publish_owned_roots(require_browser=True)
                    versions['chromium'] = self.result['stages']['BROWSER']['browserVersion']
                    self.setup_component()
                    self.import_workbook()
                    self.result['coverage']['workbookPublicImports'] = 1
                    initial = self.native_round(initial=True)
                    self.master_id = initial['savedPointer']['id']
                    login(self.secondary, self.base)
                    self.reopen_public(self.secondary, self.master_id)
                    self.qualify_selected_visible_wait()
                    self.handle_lifetime_control()
                    self.probe.start(); self.allocation_started = True
                    self.idle_baseline()
                    self.publish_owned_roots(require_browser=True)
                    self.page.screenshot(path=str(self.evidence/'baseline-ui.png'), full_page=True)
                    self.checkpoint('baseline')
                    self.replay()
                    self.checkpoint('endpoint')
                    self.arm_summary['allocationProbeFinal'] = self.probe.finish(); self.allocation_started = False
                    endpoint = state(self.page)
                    write_json(self.evidence/'endpoint-business.json',
                        {key: endpoint[key] for key in ('study','profile','scenario','savedPointer')})
                    self.result['status'] = 'PASS'
                    self.arm_summary['status'] = 'PASS_DIAGNOSTIC'
                finally:
                    self.stop_activity_deadline()
                    self.arm_summary['allocationProbeFinal'] = self.probe.finish(); self.allocation_started = False
                    self.cleanup()
        except BaseException as exc:
            stop = safe_failure(exc, self.stage)
            if self.monitor.violation:
                stop['reason'] = self.monitor.violation['reason']
            if self.operation_clock and self.operation_clock[-1]['status'] != 'PASS':
                self.operation_clock[-1].update(status='STOPPED', stopReason=stop['reason'])
            self.arm_summary.update(status='BLOCKED_ENVIRONMENT' if isinstance(exc, (EnvironmentError, ModuleNotFoundError, importlib.metadata.PackageNotFoundError))
                                    and self.soak_started is None else 'INCONCLUSIVE_STOP', failure=stop, stopReason=stop['reason'])
            self.result['stages'][self.stage] = {'status': 'INCONCLUSIVE_STOP', 'reason': stop['reason']}
            self.result['status'] = 'FAIL'
            self.stop_activity_deadline()
            self.arm_summary['allocationProbeFinal'] = self.probe.finish(); self.allocation_started = False
            if not self.cleaned:
                try:
                    self.cleanup()
                except BaseException as cleanup_error:
                    self.arm_summary['cleanupFailure'] = safe_failure(cleanup_error, 'CLEANUP')
        finally:
            signal.signal(signal.SIGTERM, old_handler)
            self.monitor.stop()
        self.arm_summary.update(sourceAfter=source_identity(ROOT), coverage=self.result['coverage'],
            completedOperations=len([r for r in self.operation_clock if r['status']=='PASS']),
            scheduledOperations=325, uncompletedOperations=325-len([r for r in self.operation_clock if r['status']=='PASS']),
            unstartedOperations=325-len([r for r in self.operation_clock if r['operationRan']]),
            businessStageStatuses={name: value.get('status','UNKNOWN') for name,value in self.result['stages'].items()},
            selectedWaitCounts=self.result.get('selectedVisibleWaits'),
            waitRetention=self.result.get('selectedWaitRetentionValidation',{}).get('elementHandleDeltaByPage'),
            resources=[{key:r[key] for key in ('elapsedSeconds','rssBytes','fds','byKind')} for r in self.monitor.samples],
            temporaryBusinessMaterialExported=False, explainsAllPythonOrRSS=False,
            allocationInstrumentScope='ARM_WORKER_PYTHON_ONLY_NOT_SUPERVISORS_NODE_OR_CHROME')
        complete = self.arm_summary['completedOperations']
        self.arm_summary['nextUncompletedOperation'] = None if complete == 325 else {
            'index': complete + 1, 'kind': load_schedule()['operations'][complete][0],
            'targetSeconds': load_schedule()['operations'][complete][1]}
        if self.arm_summary['sourceAfter'] != self.arm_summary['source'] or self.arm_summary['source']['dirty']:
            self.arm_summary.update(status='INCONCLUSIVE_STOP', stopReason='SOURCE_IDENTITY_CHANGED_OR_DIRTY')
        if self.result['stages'].get('CLEANUP',{}).get('status') != 'PASS':
            self.arm_summary.update(status='INCONCLUSIVE_STOP', stopReason='BUSINESS_CLEANUP_FAILED')
        write_json(self.export/'summary.json', self.arm_summary)
        return 0 if self.arm_summary['status']=='PASS_DIAGNOSTIC' else 78 if self.arm_summary['status']=='BLOCKED_ENVIRONMENT' else 1


def stop_launcher(runtime):
    run_dir = runtime/'launcher'
    if not (run_dir/'trial.json').exists():
        return {'status':'NO_OWNERSHIP_RECEIPT','foreignProcessesTouched':False}
    stopped = subprocess.run([sys.executable,str(ROOT/'scripts/local_trial.py'),'stop'], cwd=ROOT,
        env={**os.environ,'STCT_RUN_DIR':str(run_dir)}, capture_output=True, timeout=40)
    return {'status':'PASS' if stopped.returncode==0 and not (run_dir/'trial.json').exists() else 'FAIL',
            'returnCode':stopped.returncode}


def read_summary(path):
    try:
        return json.loads(path.read_text())
    except (OSError,ValueError):
        return {'status':'INCONCLUSIVE_STOP','stopReason':'MISSING_OR_INVALID_SUMMARY'}


def scalar_progress(work, export, summary):
    """Post-exit projection, including partial evidence after a hard worker stop."""
    source = work/'cycles.jsonl'
    stages, timings = [], []
    start = None
    recovery_complete, recovery_reason = True, None
    if source.exists():
        with source.open() as stream:
            for line in stream:
                try:
                    row = json.loads(line)
                except ValueError:
                    recovery_complete, recovery_reason = False, 'PARTIAL_OR_INVALID_PRIVATE_EVENT_LINE'
                    break
                if row['kind'] == 'allocation_replay_start':
                    start = row['elapsedSeconds']
                elif row['kind'] in ('stage_start','stage_pass'):
                    stages.append({key:row[key] for key in ('kind','elapsedSeconds','stage','uiCycle')})
                elif row['kind'] == 'operation_timing' and start is not None:
                    timings.append({key:row[key] for key in ('elapsedSeconds','operation','seconds')})
                if len(stages)>512 or len(timings)>325:
                    recovery_complete, recovery_reason = False, 'SCALAR_PROGRESS_BOUNDS_EXCEEDED'
                    stages, timings = stages[:512], timings[:325]
                    break
    write_json(export/'stage-progress.json', {'stages':stages,'failure':summary.get('failure'),
        'recoveredCompletedOperationTimings':timings if not summary.get('operationClock') else [],
        'replayStartElapsedSeconds':start,
        'recoveredTimingIsFullBoundaryEvidence':False,
        'eventProjectionComplete':recovery_complete,'recoveryReason':recovery_reason})


def run_supervised_arm(pair_runtime, export, arm):
    root=pair_runtime/('arm-'+arm);runtime=root/'runtime';work=root/'work'
    runtime.mkdir(parents=True);work.mkdir();export.mkdir()
    write_json(pair_runtime/'current-arm.json',{'arm':arm})
    env={**os.environ,'STCT_ALLOC_ARM':arm,'STCT_SOAK_WORKER':'1','STCT_SOAK_OWNED_RUNTIME':str(runtime),
         'STCT_ALLOC_WORK_EVIDENCE':str(work),'STCT_ALLOC_PAIR_RUNTIME':str(pair_runtime),
         'STCT_SOAK_SUPERVISOR_PID':str(os.getpid()),
         'STCT_SOAK_SUPERVISOR_START_TICKS':str(process_table()[os.getpid()]['startTicks']),
         'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1'}
    child=subprocess.Popen([sys.executable,'-B',str(Path(__file__).resolve()),'--evidence-dir',str(export)],
                           cwd=ROOT,env=env,start_new_session=True)
    startup_failure = None
    try:
        publish_startup_arm_root(pair_runtime,child.pid)
    except BaseException as exc:
        startup_failure = safe_failure(exc,'STARTUP_OWNERSHIP')
    code,failure,cleanup=supervise_process(child,ARM_WALL_SECONDS if startup_failure is None else 0,work/'abort-request.json',
        lambda:stop_launcher(runtime),owned_roots_path=runtime/'owned-processes.json',run_token=runtime.name)
    if startup_failure:
        failure = {**(failure or {}),'reason':'STARTUP_ARM_OWNERSHIP_UNVERIFIED','startupOwnershipFailure':startup_failure}
    summary=read_summary(export/'summary.json')
    summary['abortRequestPresent'] = (work/'abort-request.json').exists()
    if summary['abortRequestPresent'] or summary.get('activityDeadline',{}).get('triggered',False):
        summary.update(status='INCONCLUSIVE_STOP',stopReason='ARM_ABORT_REQUEST_OR_DEADLINE_TRIGGER_RECORDED')
        code=1
    returned=finish_status(summary,code,failure,cleanup)
    write_json(export/'summary.json',summary)  # Persist terminal state before any post-exit projection.
    try:
        scalar_progress(work,export,summary)
    except BaseException as exc:
        summary.update(status='INCONCLUSIVE_STOP',stopReason='SCALAR_PROGRESS_PROJECTION_FAILED',
                       failure=safe_failure(exc,'POST_EXIT_PROJECTION'))
        returned=1
    if returned==0:
        try:
            summary['semanticReceipt']=semantic_receipt(work)
        except BaseException as exc:
            summary.update(status='INCONCLUSIVE_STOP',stopReason='SEMANTIC_RECEIPT_INVALID',failure=safe_failure(exc,'SEMANTIC_COMPARISON'))
            returned=1
    write_json(export/'summary.json',summary)
    if cleanup['status']=='PASS' and not cleanup['remainingLiveProcesses'] and not cleanup['remainingZombies']:
        shutil.rmtree(root)
    return returned,summary


def compare_arms(off,on):
    if off.get('status')!='PASS_DIAGNOSTIC' or on.get('status')!='PASS_DIAGNOSTIC':
        raise DiagnosticStop('BOTH_ARMS_NOT_COMPLETE')
    for key in ('scheduleSHA256','coverage','semanticReceipt','source','runtimeVersions'):
        if off[key]!=on[key]:
            raise DiagnosticStop('PAIRED_'+key.upper()+'_MISMATCH')
    if off['traceEnabled'] or not on['traceEnabled']:
        raise DiagnosticStop('TRACE_ARM_ASSIGNMENT_MISMATCH')
    expected=load_schedule()['operations']
    for arm in (off,on):
        if arm['activityDeadline']['triggered'] or arm['abortRequestPresent']:
            raise DiagnosticStop('PAIRED_ARM_ABORT_OR_DEADLINE_TRIGGER_RECORDED')
        if len(arm['operationClock'])!=325 or arm['activitySeconds']>150:
            raise DiagnosticStop('PAIRED_OPERATION_COVERAGE_OR_DURATION_MISMATCH')
        for row,(kind,target) in zip(arm['operationClock'],expected):
            if row['kind']!=kind or row['targetSeconds']!=target or row['status']!='PASS':
                raise DiagnosticStop('PAIRED_OPERATION_SEQUENCE_MISMATCH')
            timing_gate(target,row['actualStartSeconds'])
        for label in ('baseline','endpoint'):
            receipt=arm['checkpoints'][label]
            if receipt['status']!='PASS' or not receipt['census']['complete'] or not receipt['snapshot']['complete'] or \
                    receipt['durationSeconds']>2 or receipt['outerCallSeconds']>2:
                raise DiagnosticStop('PAIRED_CHECKPOINT_NOT_VALID')
    owners = {'off':descriptive_owner_census(off),'on':descriptive_owner_census(on)}
    owners_equal = all(owners['off'][label][kind]['registeredOwnerCount'] == owners['on'][label][kind]['registeredOwnerCount']
                       for label in ('baseline','endpoint') for kind in owners['off'][label])
    return {'status':'PASS','sameSemanticData':True,'sameOperationKindsOrderTargets':True,
            'operationsPerArm':325,'uiCyclesPerArm':5,'componentCyclesPerArm':100,'readonlyProbesPerArm':219,
            'initialNativeRoundsPerArm':1,'periodicNativeRoundsPerArm':1,
            'exclusionPolicy':SEMANTIC_POLICY,'explainsAllPythonOrRSS':False,
            'ownerCensus':owners,'ownerInventoriesMatch':owners_equal,
            'crossArmTotalByteCausalAttribution':'NOT_CLAIMED' if owners_equal else 'INCONCLUSIVE_OWNER_COUNTS_DIFFER',
            'ownerAverageMeaning':'DESCRIPTIVE_ORDER_DEPENDENT_SHARED_DEDUP_SUBSET_AVERAGE_NOT_EXCLUSIVE_RETAINED_BYTES',
            'networkOwnerEqualityIsCompletionGate':False}


def pair_worker(export,pair_runtime):
    result={'status':'RUNNING','soakQualification':'NOT_MUTATION_SOAK','productAcceptance':'NOT_RUN',
            'source':source_identity(ROOT),'armOrder':['off','on'],'scheduleSHA256':SCHEDULE_SHA256,
            'semanticComparisonPolicy':SEMANTIC_POLICY,
            'limits':{'pairWatchdogSeconds':660,'armWatchdogSeconds':240,'armActivitySeconds':150,
                      'cleanupMaximumSecondsPerSupervisor':65,'scalarExportBytes':EXPORT_BYTES},'arms':{},
            'unexecutedArms':['off','on']}
    write_json(export/'summary.json',result)
    try:
        load_schedule()
        for arm in ('off','on'):
            result['activeArm']=arm
            result['arms'][arm]={'status':'RUNNING'}
            result['unexecutedArms']=[name for name in ('off','on') if name not in result['arms']]
            write_json(export/'summary.json',result)
            code,summary=run_supervised_arm(pair_runtime,export/arm,arm)
            result['arms'][arm]={'status':summary['status'],'stopReason':summary.get('stopReason'),
                                 'completedOperations':summary.get('completedOperations',0)}
            write_json(export/'summary.json',result)
            check_export_budget(export)
            if code:
                result.update(status=summary['status'],stopReason='ARM_'+arm.upper()+'_DID_NOT_COMPLETE',
                              unexecutedArms=['on'] if arm=='off' else [])
                break
        else:
            result['comparison']=compare_arms(read_summary(export/'off/summary.json'),read_summary(export/'on/summary.json'))
            result['status']='PASS_DIAGNOSTIC'
    except BaseException as exc:
        result.update(status='INCONCLUSIVE_STOP',stopReason=getattr(exc,'reason','PAIR_CHECK_FAILED'),failure=safe_failure(exc,'PAIR'))
    result['sourceAfter']=source_identity(ROOT)
    if result['sourceAfter']!=result['source'] or result['source']['dirty']:
        result.update(status='INCONCLUSIVE_STOP',stopReason='SOURCE_IDENTITY_CHANGED_OR_DIRTY')
    write_final_summary(export,result)
    return 0 if result['status']=='PASS_DIAGNOSTIC' else 78 if result['status']=='BLOCKED_ENVIRONMENT' else 1


def parse_args(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir',type=Path)
    parser.add_argument('--self-test',action='store_true')
    args=parser.parse_args(argv)
    if not args.self_test and args.evidence_dir is None:
        parser.error('--evidence-dir is required')
    if args.evidence_dir:
        args.evidence_dir=args.evidence_dir.resolve()
        if args.evidence_dir==ROOT or ROOT in args.evidence_dir.parents:
            parser.error('Evidence must be outside the checkout')
    return args


def main(argv=None):
    args=parse_args(argv)
    if args.self_test:
        result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(AllocationHarnessGuardTests))
        return 0 if result.wasSuccessful() else 1
    if os.environ.get('STCT_ALLOC_ARM') in ('off','on'):
        work=Path(os.environ['STCT_ALLOC_WORK_EVIDENCE'])
        return AllocationArm(work,args.evidence_dir,os.environ['STCT_ALLOC_ARM']=='on').run_arm()
    if os.environ.get('STCT_ALLOC_PAIR_WORKER')=='1':
        return pair_worker(args.evidence_dir,Path(os.environ['STCT_ALLOC_PAIR_RUNTIME']))
    if args.evidence_dir.exists() and any(args.evidence_dir.iterdir()):
        raise ValueError('Evidence directory must be fresh and empty')
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    runtime=Path(tempfile.mkdtemp(prefix='stct-python-allocation-pair-'))
    env={**os.environ,'STCT_ALLOC_PAIR_WORKER':'1','STCT_ALLOC_PAIR_RUNTIME':str(runtime),
         'STCT_ALLOC_OUTER_SUPERVISOR_PID':str(os.getpid()),
         'STCT_ALLOC_OUTER_SUPERVISOR_START_TICKS':str(process_table()[os.getpid()]['startTicks']),
         'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1'}
    child=subprocess.Popen([sys.executable,'-B',str(Path(__file__).resolve()),'--evidence-dir',str(args.evidence_dir)],
                           cwd=ROOT,env=env,start_new_session=True)
    def stop_current():
        current=read_summary(runtime/'current-arm.json').get('arm')
        return stop_launcher(runtime/('arm-'+current)/'runtime') if current in ('off','on') else {'status':'NO_OWNERSHIP_RECEIPT'}
    code,failure,cleanup=supervise_process(child,PAIR_WALL_SECONDS,args.evidence_dir/'abort-request.json',
        stop_current,owned_roots_path=runtime/'owned-processes.json',run_token=runtime.name)
    summary=read_summary(args.evidence_dir/'summary.json')
    returned=finish_status(summary,code,failure,cleanup)
    write_final_summary(args.evidence_dir,summary)
    try:
        for arm in ('off','on'):
            work=runtime/('arm-'+arm)/'work'
            if work.exists() and (args.evidence_dir/arm).exists():
                scalar_progress(work,args.evidence_dir/arm,read_summary(args.evidence_dir/arm/'summary.json'))
    except BaseException as exc:
        summary.update(status='INCONCLUSIVE_STOP',stopReason='SCALAR_PROGRESS_PROJECTION_FAILED',
                       failure=safe_failure(exc,'OUTER_POST_EXIT_PROJECTION'))
    write_final_summary(args.evidence_dir,summary)
    if summary['status'] != 'PASS_DIAGNOSTIC':
        returned = 78 if summary['status']=='BLOCKED_ENVIRONMENT' else 1
    if cleanup['status']=='PASS' and not cleanup['remainingLiveProcesses'] and not cleanup['remainingZombies']:
        shutil.rmtree(runtime)
    print(json.dumps({'status':summary['status'],'stopReason':summary.get('stopReason'),
                      'soakQualification':'NOT_MUTATION_SOAK'}),flush=True)
    return returned


class AllocationHarnessGuardTests(unittest.TestCase):
    def test_frozen_schedule_counts_cadence_and_hash(self):
        value=load_schedule()
        self.assertEqual(len(value['operations']),325)
        self.assertEqual(value['expectedCounts'],{'ui':5,'component':100,'probe':219,'native':1})
    def test_late_or_early_operation_stops_without_relaxation(self):
        timing_gate(24,25.999)
        for actual in (26.001,23.9):
            with self.assertRaises(DiagnosticStop): timing_gate(24,actual)
    def test_failure_status_never_retains_success_or_soak_qualification(self):
        cleanup={'status':'PASS','remainingLiveProcesses':[],'remainingZombies':[],'forcedTerminationUsed':False}
        for status,code in [('RUNNING',0),('PASS_DIAGNOSTIC',1),('UNKNOWN',0)]:
            summary={'status':status,'soakQualification':'PASS'}
            self.assertEqual(finish_status(summary,code,None,cleanup),1)
            self.assertEqual(summary['status'],'INCONCLUSIVE_STOP')
            self.assertEqual(summary['soakQualification'],'NOT_MUTATION_SOAK')
        summary={'status':'PASS_DIAGNOSTIC'}
        self.assertEqual(finish_status(summary,0,None,{**cleanup,'remainingZombies':[1]}),1)
    def test_trace_resource_stop_is_not_environment_or_product_failure(self):
        summary={'status':'PASS_DIAGNOSTIC'}
        cleanup={'status':'PASS','remainingLiveProcesses':[],'remainingZombies':[],'forcedTerminationUsed':False}
        finish_status(summary,1,{'reason':'INSTRUMENT_RSS_PREVENTIVE_STOP_1856MIB'},cleanup)
        self.assertEqual(summary['status'],'INCONCLUSIVE_STOP')
        self.assertEqual(summary['productAcceptance'],'NOT_RUN')
    def test_generated_ids_and_hash_relations_are_checked_not_business_fields_removed(self):
        def study(root,hash_value):return {'studyId':root,'inputHash':hash_value,'name':'synthetic','quantity':45.5}
        h='sha256:'+'a'*64
        a,b=SemanticBindings(),SemanticBindings()
        self.assertEqual(a.study(study('SUPPLY-1',h)),b.study(study('SUPPLY-2','sha256:'+'b'*64)))
        with self.assertRaises(DiagnosticStop):a.study(study('SUPPLY-3',h))
        changed=study('SUPPLY-2','sha256:'+'b'*64);changed['quantity']=99
        self.assertNotEqual(digest(a.study(study('SUPPLY-1',h))),digest(b.study(changed)))
    def test_failure_export_has_location_but_no_message_values(self):
        try:raise AssertionError('private payload or URL should never be exported')
        except AssertionError as exc: result=safe_failure(exc,'UI_SOAK')
        self.assertNotIn('private payload',json.dumps(result))
        self.assertEqual(result['reason'],'BUSINESS_OR_RUNTIME_CHECK_FAILED')
        self.assertIsInstance(result['sourceLine'],int)
    def test_pair_rejects_partial_and_semantic_mismatch(self):
        with self.assertRaises(DiagnosticStop):compare_arms({'status':'INCONCLUSIVE_STOP'},{'status':'PASS_DIAGNOSTIC'})
        a={'status':'PASS_DIAGNOSTIC','scheduleSHA256':'same','coverage':{},'semanticReceipt':{'hash':'one'},'source':{}}
        b={**a,'semanticReceipt':{'hash':'two'}}
        with self.assertRaisesRegex(DiagnosticStop,'SEMANTICRECEIPT'):compare_arms(a,b)
    def test_no_throughput_filler_is_available(self):
        suite=AllocationArm.__new__(AllocationArm)
        suite.operate_until(time.monotonic()-1)
        with self.assertRaises(DiagnosticStop):suite.operate_until(time.monotonic()+1)
    def test_preventive_rss_stop_does_not_take_checkpoint(self):
        from unittest.mock import Mock
        suite=AllocationArm.__new__(AllocationArm)
        suite.guard=Mock();suite.monitor=SimpleNamespace(sample=Mock(return_value={'rssBytes':RSS_STOP_BYTES}))
        suite.probe=Mock()
        with self.assertRaisesRegex(DiagnosticStop,'RSS_PREVENTIVE'):
            suite.checkpoint('endpoint')
        suite.probe.checkpoint.assert_not_called()
    def test_outer_checkpoint_timer_includes_returned_call_cost(self):
        from unittest.mock import Mock
        suite=AllocationArm.__new__(AllocationArm)
        suite.guard=Mock();suite.monitor=SimpleNamespace(sample=Mock(return_value={'rssBytes':100}),samples=[])
        suite.page=SimpleNamespace(_impl_obj=SimpleNamespace(_connection=SimpleNamespace(_objects={})))
        suite.result={};suite.arm_summary={'checkpoints':{}}
        suite.probe=SimpleNamespace(checkpoint=Mock(return_value={'status':'PASS','durationSeconds':.1}))
        with patch(__name__+'.time.monotonic',side_effect=[0.,2.01]),self.assertRaisesRegex(DiagnosticStop,'TOTAL_CALL'):
            suite.checkpoint('baseline')
        self.assertEqual(suite.arm_summary['checkpoints']['baseline']['status'],'INCOMPLETE')
        self.assertEqual(suite.arm_summary['checkpoints']['baseline']['outerCallSeconds'],2.01)
    def test_pair_rechecks_full_sequence_and_checkpoint_validity(self):
        import copy
        good={'status':'PASS_DIAGNOSTIC','scheduleSHA256':SCHEDULE_SHA256,'coverage':{},'semanticReceipt':{},'source':{},
              'runtimeVersions':{},'baselineProtocol':{'byType':{}},'endpointProtocol':{'byType':{}},
              'activityDeadline':{'triggered':False},'abortRequestPresent':False,
              'traceEnabled':False,'activitySeconds':123.,
              'operationClock':[{'kind':kind,'targetSeconds':target,'status':'PASS','actualStartSeconds':target}
                                for kind,target in load_schedule()['operations']],
              'checkpoints':{label:{'status':'PASS','census':{'complete':True,'categories':{}},'snapshot':{'complete':True},
                                     'durationSeconds':.1,'outerCallSeconds':.2} for label in ('baseline','endpoint')}}
        on=copy.deepcopy(good);on['traceEnabled']=True
        self.assertEqual(compare_arms(good,on)['status'],'PASS')
        on['operationClock'][20]['actualStartSeconds']+=2.01
        with self.assertRaisesRegex(DiagnosticStop,'START_LATE'):compare_arms(good,on)
        on=copy.deepcopy(good);on['traceEnabled']=True;on['checkpoints']['endpoint']['census']['complete']=False
        with self.assertRaisesRegex(DiagnosticStop,'CHECKPOINT_NOT_VALID'):compare_arms(good,on)
        on=copy.deepcopy(good);on['traceEnabled']=True
        on['endpointProtocol']['byType']['Request']=1
        on['checkpoints']['endpoint']['census']['categories']['network.Request']={'directBytes':100}
        result=compare_arms(good,on)
        self.assertEqual(result['status'],'PASS')
        self.assertEqual(result['crossArmTotalByteCausalAttribution'],'INCONCLUSIVE_OWNER_COUNTS_DIFFER')
        self.assertEqual(result['ownerCensus']['on']['endpoint']['Request']['subsetBytesPerRegisteredOwner'],100)
        for key in ('deadline','abort'):
            stopped=copy.deepcopy(good);stopped['traceEnabled']=True
            if key=='deadline':stopped['activityDeadline']['triggered']=True
            else:stopped['abortRequestPresent']=True
            with self.assertRaisesRegex(DiagnosticStop,'ABORT_OR_DEADLINE'):
                compare_arms(good,stopped)
    def test_final_artifact_budget_cannot_leave_success(self):
        with tempfile.TemporaryDirectory() as root:
            directory=Path(root);(directory/'bounded-test-data').write_bytes(b'x'*100)
            result={'status':'PASS_DIAGNOSTIC'}
            with patch(__name__+'.EXPORT_BYTES',100):write_final_summary(directory,result)
            self.assertEqual(result['status'],'INCONCLUSIVE_STOP')
            self.assertEqual(json.loads((directory/'summary.json').read_text())['stopReason'],'DIAGNOSTIC_EXPORT_EXCEEDED_8MIB')
    def test_partial_private_event_recovery_exports_no_payload(self):
        with tempfile.TemporaryDirectory() as root:
            directory=Path(root);work=directory/'work';export=directory/'out';work.mkdir();export.mkdir()
            stage={'kind':'stage_pass','elapsedSeconds':1,'stage':'UI_SOAK','uiCycle':1,'details':{'secretPayload':'NOT_EXPORTED'}}
            (work/'cycles.jsonl').write_text(json.dumps(stage)+'\n{"unfinished":')
            scalar_progress(work,export,{})
            result=json.loads((export/'stage-progress.json').read_text())
            self.assertFalse(result['eventProjectionComplete'])
            self.assertNotIn('NOT_EXPORTED',json.dumps(result))
    def test_owner_bytes_never_substitute_zero_for_missing_category(self):
        arm={'baselineProtocol':{'byType':{'Request':1}},'endpointProtocol':{'byType':{}},
             'checkpoints':{'baseline':{'census':{'categories':{}}},'endpoint':{'census':{'categories':{}}}}}
        with self.assertRaisesRegex(DiagnosticStop,'CATEGORY_MISSING'):descriptive_owner_census(arm)
    def test_outer_receipt_contains_verified_worker_driver_and_browser_roots(self):
        rows=[{'pid':pid,'startTicks':pid*10,'kind':kind} for pid,kind in
              ((10,'harness'),(11,'services_workers'),(12,'services_workers'),(20,'driver'),(30,'chrome'),(31,'chrome'))]
        table={r['pid']:{'startTicks':r['startTicks']} for r in rows}
        roots=verified_ownership_roots({'byProcess':rows},table,10,{11,12},True)
        self.assertEqual({r['pid'] for r in roots},{10,11,12,20,30,31})
        table[20]['startTicks']=999
        with self.assertRaisesRegex(DiagnosticStop,'DRIVER_OR_BROWSER'):
            verified_ownership_roots({'byProcess':rows},table,10,{11,12},True)
        del table[10]
        with self.assertRaisesRegex(DiagnosticStop,'REQUIRED_ROOT'):
            verified_ownership_roots({'byProcess':rows},table,10,{11,12},False)
    def test_activity_timer_uses_existing_abort_flag_even_without_business_guard(self):
        from unittest.mock import Mock
        with tempfile.TemporaryDirectory() as root:
            suite=AllocationArm.__new__(AllocationArm)
            suite.evidence=Path(root);suite.soak_started=1000.;suite.activity_ended=False;suite.arm_summary={}
            timer=Mock()
            with patch(__name__+'.threading.Timer',return_value=timer) as create, \
                    patch(__name__+'.time.monotonic',side_effect=[1000.,1150.]):
                suite.start_activity_deadline()
                self.assertEqual(create.call_args.args[0],150)
                create.call_args.args[1]()
            receipt=json.loads((suite.evidence/'abort-request.json').read_text())
            self.assertEqual(receipt['reason'],'ARM_ACTIVITY_DEADLINE_150_SECONDS')
            self.assertEqual(receipt['activityElapsedSecondsAtTrigger'],150)
            suite.stop_activity_deadline()
            timer.cancel.assert_called_once();timer.join.assert_called_once_with(timeout=1)
    def test_terminal_summary_is_saved_before_failing_post_exit_projection(self):
        with tempfile.TemporaryDirectory() as root:
            pair=Path(root)/'pair';pair.mkdir();export=Path(root)/'export'
            cleanup={'status':'PASS','remainingLiveProcesses':[],'remainingZombies':[],'forcedTerminationUsed':False}
            def failed_projection(work,path,summary):
                self.assertEqual(json.loads((path/'summary.json').read_text())['status'],'INCONCLUSIVE_STOP')
                raise OSError('projection unavailable')
            with patch(__name__+'.subprocess.Popen',return_value=SimpleNamespace(pid=99)), \
                    patch(__name__+'.process_table',return_value={os.getpid():{'startTicks':1},99:{'startTicks':99}}), \
                    patch(__name__+'.supervise_process',return_value=(1,{'reason':'ARM_ACTIVITY_DEADLINE_150_SECONDS'},cleanup)), \
                    patch(__name__+'.read_summary',return_value={'status':'RUNNING'}), \
                    patch(__name__+'.scalar_progress',side_effect=failed_projection):
                code,summary=run_supervised_arm(pair,export,'off')
            self.assertEqual(code,1)
            saved=json.loads((export/'summary.json').read_text())
            self.assertEqual(saved['status'],'INCONCLUSIVE_STOP')
            self.assertEqual(saved['stopReason'],'SCALAR_PROGRESS_PROJECTION_FAILED')
            self.assertIn('ARM_ACTIVITY_DEADLINE_150_SECONDS',saved['stopReasons'])
    def test_startup_arm_root_is_published_before_launcher_descendants_exist(self):
        with tempfile.TemporaryDirectory() as root:
            pair=Path(root)
            with patch(__name__+'.process_table',return_value={99:{'startTicks':1234}}):
                publish_startup_arm_root(pair,99)
            receipt=json.loads((pair/'owned-processes.json').read_text())
            self.assertEqual(receipt,{'runToken':pair.name,'services':[{'pid':99,'startTicks':1234,'role':'arm_worker'}]})
            with patch(__name__+'.process_table',return_value={}),self.assertRaisesRegex(DiagnosticStop,'IDENTITY_UNVERIFIED'):
                publish_startup_arm_root(pair,100)
            self.assertEqual(json.loads((pair/'owned-processes.json').read_text()),receipt)


if __name__=='__main__':
    sys.exit(main())
