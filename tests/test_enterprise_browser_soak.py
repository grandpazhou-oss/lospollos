#!/usr/bin/env python3
"""Bounded 12-minute synthetic public-UI + separately labeled IndexedDB soak.

Uses existing Python Playwright, Chromium, Node and OR-Tools; installs nothing.
All evidence and the fresh persistent browser profile are outside the checkout.
The default qualification requires >=600 seconds, >=20 UI and >=300 component
cycles. --smoke explicitly exercises the harness without claiming soak coverage.
"""
from __future__ import annotations

import argparse
from collections import Counter
from functools import partial
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import sys
import time
import unittest
import uuid
from urllib.parse import urlsplit

from enterprise_browser_soak_support import EvidenceLog, ResourceMonitor, source_identity, supervise_process, SoakDeadlineError, process_table
from test_enterprise_storage_native import MODULES
from test_enterprise_synthetic_full_ui import (
    ROOT, TOTAL, action, field, login, near, reveal, state, step, upload, wait_state,
)
from test_enterprise_ui_faults import FaultSuite


MEMORY_PROFILES = {'standard-1gib': 1024, 'hosted-2gib': 2048}
DIAGNOSTIC_PROFILES = {
    'fixed-history-recovery': {'seedCadenceSeconds': 0, 'seedMaxSeconds': 300,
                               'phaseBudgetSeconds': 900, 'wallCapSeconds': 960},
    'paced-history-recovery': {'seedCadenceSeconds': 720, 'seedMaxSeconds': 900,
                               'phaseBudgetSeconds': 1470, 'wallCapSeconds': 1500},
}
WORKLOAD_PROFILES = ('mutation-soak', *DIAGNOSTIC_PROFILES)
VISIBLE_WAIT_TIMEOUT_MS = 25000
SELECTED_WAITS_PER_CYCLE = {'capacity_primary': 1, 'capacity_secondary': 1, 'conflict_controls': 3,
                          'package_export': 1, 'package_import': 1, 'history': 1, 'reload': 1}
PRIOR_1GIB_EVIDENCE = {
    'checkout': 'bd9c019', 'artifact': 'enterprise-soak-preflight/browser/resources.jsonl',
    'archiveReference': 'ci-bd9c019/preflight/browser', 'elapsedSeconds': 2.196,
    'aggregateRSSBytes': 1093218304, 'browserRSSBytes': 747298816, 'limitBytes': 1073741824,
    'uiCycles': 0, 'componentCycles': 0,
    'conclusion': 'INITIAL_AGGREGATE_BUDGET_BLOCK_AND_OLD_HARNESS_INTERRUPT_HANG; '
                  'NOT_BROWSER_ALONE_ABOVE_1GIB_AND_NOT_APPLICATION_LEAK_EVIDENCE'}


def finalize_diagnostic_qualification(summary):
    """Keep diagnostic qualification consistent with the latest terminal status."""
    if summary.get('workloadProfile') not in DIAGNOSTIC_PROFILES:
        return
    summary['soakQualification'] = 'NOT_MUTATION_SOAK'
    summary['diagnosticQualification'] = {
        'PASS_DIAGNOSTIC': 'PASS_DIAGNOSTIC',
        'PASS_DIAGNOSTIC_SMOKE': 'NOT_QUALIFIED_SHORT_RUN',
        'BLOCKED_ENVIRONMENT': 'BLOCKED_ENVIRONMENT',
        'FAIL': 'FAIL', 'RUNNING': 'RUNNING',
    }.get(summary.get('status'), 'NOT_RUN')


def expect_visible_without_handles(locator, *, timeout_ms=VISIBLE_WAIT_TIMEOUT_MS):
    """Only the visibility assertion's AssertionError adapts to the prior public timeout type."""
    from playwright.sync_api import expect, TimeoutError as PlaywrightTimeoutError
    try:
        expect(locator).to_be_visible(timeout=timeout_ms)
    except AssertionError as error:
        raise PlaywrightTimeoutError('Selected visibility wait exceeded ' + str(timeout_ms) + 'ms: ' + str(error)) from error


def element_handle_delta(before, after):
    """Require verified, unchanged page ownership before treating absent handles as zero."""
    names = {'primary', 'secondary', 'component'}
    for snapshot in (before, after):
        assert set(snapshot['byPage']) == names, 'WAIT_PROTOCOL_PAGE_SET_MISMATCH'
        assert not snapshot['unassignedByType'].get('ElementHandle'), 'WAIT_HANDLE_OWNER_UNKNOWN'
        assert sum(page['byType'].get('ElementHandle', 0) for page in snapshot['byPage'].values()) == \
            snapshot['byType'].get('ElementHandle', 0), 'WAIT_HANDLE_ATTRIBUTION_INCOMPLETE'
    assert all(before['byPage'][name]['pageGUID'] == after['byPage'][name]['pageGUID']
               for name in names), 'WAIT_PROTOCOL_PAGE_IDENTITY_CHANGED'
    return {name: after['byPage'][name]['byType'].get('ElementHandle', 0) -
                  before['byPage'][name]['byType'].get('ElementHandle', 0) for name in sorted(names)}


def check_selected_wait_coverage(counts, ui_cycles):
    assert set(counts) == {str(number) for number in range(1, ui_cycles + 1)}, 'SELECTED_WAIT_CYCLE_SET_MISMATCH'
    assert all(value == SELECTED_WAITS_PER_CYCLE for value in counts.values()), 'SELECTED_WAIT_CYCLE_COVERAGE_MISMATCH'
    return sum(sum(value.values()) for value in counts.values())


class BrowserSoakSuite(FaultSuite):
    def __init__(self, evidence, args):
        super().__init__(evidence)
        owned_runtime = os.environ.get('STCT_SOAK_OWNED_RUNTIME')
        if os.environ.get('STCT_SOAK_WORKER') == '1' and owned_runtime:
            shutil.rmtree(self.runtime)  # This constructor's still-empty temporary directory.
            self.runtime = Path(owned_runtime)
            self.run_dir = self.runtime / 'launcher'
            self.env['STCT_RUN_DIR'] = str(self.run_dir)
        self.args = args
        self.events = EvidenceLog(evidence / 'cycles.jsonl', self.scrub)
        self.monitor = ResourceMonitor(EvidenceLog(evidence / 'resources.jsonl', self.scrub),
                                       args.max_rss_mib, args.max_fds, args.sample_seconds, evidence / 'abort-request.json')
        self.profile = self.runtime / 'browser-profile'
        self.secondary = self.component = None
        self.current_cycle = 0
        self.soak_started = None
        self.baseline_elapsed = 0
        self.previous_sigterm_handler = None
        self.interruption_requested = None
        self.activity_seconds = {}
        self.activity_buckets = {}
        self.controlled_interval_seconds = 0.0
        self.next_memory_observation = 0.0
        self.diagnostic_phase = None
        self.phase_started = None
        self.phase_activity_buckets = {}
        self.diagnostic_pages = None
        self.selected_wait_counts = {}
        self.native_wait_records = []
        self.wait_protocol_baseline = None
        self.result.update(suite='ENTERPRISE_BROWSER_STORAGE_SOAK', source=source_identity(ROOT),
            workloadProfile=args.workload_profile,
            method='BOUNDED_PUBLIC_UI_SOAK_PLUS_SEPARATE_NATIVE_INDEXEDDB_COMPONENT',
            requested={'durationSeconds': args.duration_seconds, 'uiCycles': args.ui_cycles,
                       'componentCycles': args.storage_cycles, 'nativeEveryUiCycles': args.native_every},
            memoryProfile={'name': args.memory_profile, 'profileCapMiB': MEMORY_PROFILES[args.memory_profile],
                'effectiveLimitMiB': args.max_rss_mib,
                'calibrationReason': 'Explicit independent hosted-runner budget calibration; the original 1GiB result remains blocked'
                    if args.memory_profile == 'hosted-2gib' else 'Original conservative aggregate 1GiB qualification budget',
                'original1GiBEvidence': PRIOR_1GIB_EVIDENCE, 'productMemoryGuaranteeChanged': False},
            resourceLimits={'aggregateRSSBytes': args.max_rss_mib * 1024 * 1024,
                            'aggregateFDs': args.max_fds, 'tabs': 3},
            coverage={'workbookPublicImports': 0, 'uiCycles': 0, 'uiSaves': 0,
                      'uiCrossTabConflicts': 0, 'uiBranchSaves': 0, 'uiPackageExports': 0,
                      'uiPackageReimports': 0, 'uiReloadReopens': 0, 'uiHistoryChecks': 0,
                      'componentCycles': 0, 'componentCASConflicts': 0,
                      'componentQuotaRollbacks': 0, 'componentTransactionAborts': 0,
                      'componentHistoryReadbacks': 0, 'controlledBusyRejections': 0,
                      'genuineNativeRetries': 0, 'uiDurabilityReopens': 0,
                      'componentFullHistoryProbes': 0},
            stages={name: {'status': 'NOT_RUN'} for name in (
                'DEPENDENCIES', 'LAUNCHER', 'BROWSER', 'IMPORT_MAPPING_UNITS', 'MISSING_CRS_GUARD',
                'COMPONENT_SETUP', 'INITIAL_NATIVE_RETRY', 'SELECTED_WAIT_ADAPTER_QUALIFICATION', 'HANDLE_LIFETIME_CONTROL', 'IDLE_BASELINE', 'UI_SOAK', 'COMPONENT_SOAK',
                'CONTROLLED_429_BUSY', 'PERIODIC_NATIVE_RETRY', 'FINAL_INVARIANTS', 'CLEANUP')},
            notCovered=['COMMAND_MANUAL_APPLY_CANCEL_NOT_REPEATED_THIS_SUITE', 'REAL_DISK_QUOTA_EXHAUSTION',
                'REAL_OSRM', 'PRIVATE_DATA', 'WINDOWS_OR_MACOS_REAL_MACHINE', 'BROWSER_PROCESS_RESTART',
                'LONGER_THAN_CONFIGURED_OBSERVATION_WINDOW', 'HUMAN_VISUAL_APPROVAL'],
            storageGrowthPolicy={'componentDatabases': 1, 'componentPointers': 1,
                'componentExpectedStudyAndAuditRecords': args.storage_cycles + 1,
                'maximumUiBranchPointers': args.ui_cycles,
                'interpretation': 'Successful distinct edits intentionally retain immutable versions and audit. '
                                  'Bounded history/database bytes are reported separately from process-resource trends; '
                                  'no automatic leak-free claim or disk-filling quota test.'})
        if self.is_diagnostic:
            self.result.update(method='SEEDED_FIXED_HISTORY_READBACK_AND_NATURAL_IDLE_RECOVERY',
                soakQualification='NOT_MUTATION_SOAK', diagnosticQualification='NOT_RUN',
                diagnostic={'seedMaxSeconds': args.seed_max_seconds,
                    'seedCadenceSeconds': args.duration_seconds,
                    'fixedHistorySeconds': args.fixed_history_seconds, 'recoverySeconds': args.recovery_seconds,
                    'seedMutationPacing': 'PACED_EXISTING_COMPLETE_UI_AND_COMPONENT_CHECKS' if args.duration_seconds else
                                         'UNPACED_EXISTING_COMPLETE_UI_AND_COMPONENT_CHECKS',
                    'idleIsPressureActivity': False, 'phases': {}})
            self.result['stages'].update({name: {'status': 'NOT_RUN'} for name in
                                         ('FIXED_HISTORY_READBACK', 'NATURAL_IDLE_RECOVERY')})

    @property
    def is_diagnostic(self):
        return self.args.workload_profile in DIAGNOSTIC_PROFILES

    def write(self):
        finalize_diagnostic_qualification(self.result)
        if hasattr(self, 'selected_wait_counts'):
            self.result['selectedVisibleWaits'] = {'mainTimeoutMs': VISIBLE_WAIT_TIMEOUT_MS,
                'expectedPerCycle': dict(SELECTED_WAITS_PER_CYCLE), 'successfulByCycle': self.selected_wait_counts,
                'successfulTotal': sum(sum(counts.values()) for counts in self.selected_wait_counts.values()),
                'expectedTotal': 9 * self.args.ui_cycles, 'failedWaitsAreNotCounted': True,
                'sharedDefaultPathChanged': False}
            self.result['unchangedNativeVisibleWaits'] = {'expectedElementHandlesPerRound': 5,
                'rounds': self.native_wait_records,
                'expectedPeriodicContribution': 5 * (self.args.ui_cycles // self.args.native_every)}
        if hasattr(self, 'activity_seconds'):
            self.result['soakWindowStarted'] = self.soak_started is not None
            self.result['activityTiming'] = {
                'operationSecondsByKind': {k: round(v, 3) for k, v in self.activity_seconds.items()},
                'totalOperationSeconds': round(sum(self.activity_seconds.values()), 3),
                'controlledIntervalSeconds': round(self.controlled_interval_seconds, 3),
                'maximumRequestedCadenceWaitSeconds': .25,
                'operationCountsByMinute': self.activity_buckets,
                'meaning': 'Measured UI/component/native operations include normal response waits. '
                           'Explicit cadence intervals are separate, not pressure activity.'}
            if self.soak_started is not None and not self.result.get('observationWindowEnded'):
                key = 'observedDiagnosticSeconds' if self.is_diagnostic else 'observedSoakSeconds'
                self.result[key] = round(time.monotonic() - self.soak_started, 3)
        super().write()

    def begin(self, stage):
        self.guard()
        super().begin(stage)
        self.events.emit('stage_start', stage=stage, uiCycle=self.current_cycle)
        print(json.dumps({'stage': stage, 'status': 'RUNNING', 'uiCycle': self.current_cycle}), flush=True)

    def passed(self, **details):
        self.guard()
        super().passed(**details)
        self.events.emit('stage_pass', stage=self.stage, uiCycle=self.current_cycle, details=details)

    def guard(self):
        if self.interruption_requested is not None:
            raise SoakDeadlineError(f'SOAK_COOPERATIVE_SIGNAL_{self.interruption_requested}')
        if self.monitor.violation:
            raise AssertionError(json.dumps(self.monitor.violation))
        if self.context:
            tabs = sum(len(context.pages) for context in self.browser.contexts) if self.browser else len(self.context.pages)
            assert tabs <= 3, f'TAB_LIMIT_EXCEEDED: {tabs}'
            if self.diagnostic_pages is not None:
                assert tabs == 3 and tuple(self.context.pages) == self.diagnostic_pages, 'DIAGNOSTIC_PAGE_SET_CHANGED'
        assert not self.result['pageErrors'], self.result['pageErrors']
        # A minimum operating window is requested, with a finite overrun allowance
        # for the last bounded UI transaction, not an unbounded hang.
        if self.soak_started:
            elapsed = time.monotonic() - self.soak_started
            if self.is_diagnostic:
                if self.diagnostic_phase == 'seed':
                    assert elapsed <= self.args.seed_max_seconds, 'DIAGNOSTIC_SEED_DEADLINE_EXCEEDED'
                limit = self.args.seed_max_seconds + self.args.fixed_history_seconds + self.args.recovery_seconds + 30
                assert elapsed <= limit, 'DIAGNOSTIC_OPERATION_DEADLINE_EXCEEDED'
            elif elapsed > self.args.duration_seconds + 180:
                raise AssertionError('SOAK_OPERATION_DEADLINE_EXCEEDED')

    def open_browser(self, playwright):
        self.begin('BROWSER')
        self.profile.mkdir()
        executable = os.environ.get('STCT_CHROMIUM') or os.environ.get('STCT_BROWSER')
        try:
            self.context = playwright.chromium.launch_persistent_context(
                user_data_dir=str(self.profile), headless=True, executable_path=executable,
                args=['--disable-webgl'], accept_downloads=True,
                viewport={'width': 1440, 'height': 950}, reduced_motion='reduce', service_workers='block', timeout=30000)
        except Exception as exc:
            raise EnvironmentError('Chromium launch blocked/unavailable: ' + str(exc)) from exc
        self.browser = self.context.browser
        def restrict(route):
            parsed = urlsplit(route.request.url)
            if f'{parsed.scheme}://{parsed.netloc}' in self.origins or parsed.scheme in ('data', 'blob'):
                route.continue_()
            else:
                self.result['externalBlocked'].append(f'{parsed.scheme}://{parsed.netloc}')
                route.abort()
        self.context.route('**/*', restrict)
        self.context.route_web_socket('**/*', lambda socket: socket.close())
        # Keep a live page while replacing the owned persistent-context blank tab.
        # Closing its only page first is unnecessary and can end a persistent session.
        initial_pages = list(self.context.pages)
        self.page = self.new_page(self.context)
        for page in initial_pages:
            page.close()
        self.secondary = self.new_page(self.context)
        self.component = self.new_page(self.context)
        self.passed(browserVersion=self.browser.version if self.browser else 'persistent-context',
                    freshPersistentProfile=True, tabs=3, externalNetwork='EXACT_OWNED_LOOPBACK_ORIGINS_ONLY',
                    continuousTrace=False, traceReason='Avoid unbounded tracing overhead; JSONL, packages and checkpoints retained')

    def setup_component(self):
        self.begin('COMPONENT_SETUP')
        endpoint = f'http://127.0.0.1:{self.web_port}/__synthetic_browser_storage_soak__'
        self.component.route(endpoint, lambda route: route.fulfill(status=200, content_type='text/html',
            body='<!doctype html><title>Synthetic native IndexedDB component, not UI</title>'))
        self.component.goto(endpoint, wait_until='load')
        for name in MODULES:
            self.component.add_script_tag(content=(ROOT / name).read_text(encoding='utf-8'))
        self.component.add_script_tag(content=(ROOT / 'tests/enterprise_browser_storage_soak.js').read_text())
        result = self.component.evaluate('(name) => enterpriseStorageSoak.bounded("init", name)',
                                         'enterprise-soak-component-' + uuid.uuid4().hex)
        self.result['componentBaseline'] = result
        self.passed(**result)

    def edit_capacity(self, page, value, name):
        step(page, 1)
        control = page.locator('[data-supply-capacity]').first
        assert page is self.page or page is self.secondary, 'SELECTED_WAIT_UNKNOWN_CAPACITY_PAGE'
        label = 'capacity_primary' if page is self.page else 'capacity_secondary'
        reveal(control, visible_wait=partial(self.selected_visible_wait, label=label))
        key = control.get_attribute('data-supply-capacity')
        control.fill(str(value))
        control.press('Tab')
        field(page, 'planName').fill(name)
        field(page, 'planName').press('Tab')
        current = wait_state(page, lambda s: not s.get('snapshot') and
                             (s.get('scenario') or {}).get('scenarioId') == name)
        site, period = key.split('|')
        near(next(n for n in current['study']['nodes'] if n['nodeId'] == site)['capacityByPeriod'][period], value)
        return current

    def cycle_ui(self, number):
        self.begin('UI_SOAK')
        wait_protocol_before = self.protocol_object_counts()
        start = time.monotonic()
        primary, secondary = self.page, self.secondary
        before = self.reopen_public(primary, self.master_id)
        stale_base = self.reopen_public(secondary, self.master_id)
        assert before['savedPointer'] == stale_base['savedPointer']
        old_pointer, old_hash = before['savedPointer'], before['study']['inputHash']
        edited = self.edit_capacity(primary, 110 + number, f'Synthetic winner cycle {number}')
        action(primary, 'draft-save').click()
        winner = wait_state(primary, lambda s: (s.get('savedPointer') or {}).get('revision', 0) > old_pointer['revision'] and
            (s.get('savedPointer') or {}).get('inputHash') == edited['study']['inputHash'] and
            (s.get('savedPointer') or {}).get('scenario') == edited['scenario'])
        assert winner['savedPointer']['inputHash'] == edited['study']['inputHash']
        assert winner['savedPointer']['scenario'] == edited['scenario']
        assert winner['savedPointer']['status'] == 'DRAFT' and winner.get('snapshot') is None
        self.guard()
        stale = self.edit_capacity(secondary, 210 + number, f'Synthetic retained cycle {number}')
        assert stale['savedPointer'] == old_pointer
        action(secondary, 'draft-save').click()
        recovery = self.conflict_controls(secondary,
            visible_wait=partial(self.selected_visible_wait, label='conflict_controls'))
        rejected = state(secondary)
        assert rejected['savedPointer'] == old_pointer, 'Stale UI reported a false successful save'
        assert rejected['study']['inputHash'] == stale['study']['inputHash']
        assert rejected['scenario'] == stale['scenario']
        text = self.download('package-export', f'cycle-{number:03d}-retained.package.json', page=secondary,
                             control=recovery.locator('[data-supply-action="package-export"]'),
                             visible_wait=partial(self.selected_visible_wait, label='package_export'))
        packed = json.loads(text)
        assert packed['schemaVersion'] == 'stct-supply-chain-draft-v1'
        assert packed['study']['inputHash'] == stale['study']['inputHash'] and packed['scenario'] == stale['scenario']
        recovery.locator('[data-supply-action="save-as-branch"]').click()
        branch = wait_state(secondary, lambda s: s.get('study') and
            s['study']['studyId'] != stale['study']['studyId'] and
            (s.get('savedPointer') or {}).get('id') == 'SUPPLY:' + s['study']['studyId'])
        assert branch['savedPointer']['status'] == 'DRAFT'
        assert branch['scenario'] == stale['scenario']
        assert branch['study']['assumptions']['branchOf'] == {
            'studyId': stale['study']['studyId'], 'inputHash': stale['study']['inputHash']}
        near(sum(r['quantity'] for r in branch['study']['periodDemand']), TOTAL)
        branch_pointer = branch['savedPointer']
        # Reimport the actual downloaded bytes through the visible study-file input.
        # It is intentionally an unsaved same-ID draft, never adopted as saved.
        step(secondary, 0)
        control = secondary.locator('[data-supply-file="study"]')
        reveal(control, visible_wait=partial(self.selected_visible_wait, label='package_import'))
        upload(control, f'synthetic-cycle-{number}.json', text.encode(), 'application/json')
        imported = wait_state(secondary, lambda s: s.get('savedPointer') is None and
            (s.get('study') or {}).get('inputHash') == stale['study']['inputHash'])
        readback = {'cycle': number, 'studyHash': imported['study']['inputHash'],
            'expectedScenario': packed['scenario'], 'actualScenario': imported.get('scenario'),
            'expectedStaleResult': packed.get('staleResult'), 'actualStaleResult': imported.get('staleResult'),
            'savedPointer': imported.get('savedPointer'), 'snapshotAbsent': imported.get('snapshot') is None}
        self.result['latestDraftRoundtrip'] = readback
        self.events.emit('draft_roundtrip_readback', **readback)
        self.write()
        if imported.get('scenario') != packed['scenario'] or imported.get('staleResult') != packed.get('staleResult'):
            secondary.screenshot(path=str(self.evidence / 'failure-secondary-import.png'), full_page=True)
        assert imported['scenario'] == stale['scenario'] and imported.get('snapshot') is None, readback
        assert imported.get('staleResult') == packed.get('staleResult'), readback
        reopened_branch = self.reopen_public(secondary, branch_pointer['id'])
        assert reopened_branch['savedPointer'] == branch_pointer
        assert reopened_branch['study']['inputHash'] == branch['study']['inputHash']
        assert reopened_branch['scenario'] == stale['scenario']
        history = self.public_history(primary, self.master_id,
            visible_wait=partial(self.selected_visible_wait, label='history'))
        assert old_hash in history and winner['study']['inputHash'] in history
        restored = self.reopen_public(primary, self.master_id)
        assert restored['savedPointer'] == winner['savedPointer'], 'Conflict/branch/import overwrote original'
        primary.reload(wait_until='load')
        button = primary.locator('#loginForm .login-btn')
        if button.is_visible():
            button.click()
        self.selected_visible_wait(primary.locator('[data-design-route="/design/supply-chain-study"]'), label='reload')
        restored = self.reopen_public(primary, self.master_id)
        assert restored['savedPointer'] == winner['savedPointer']
        assert restored['study']['inputHash'] == winner['study']['inputHash']
        assert restored['scenario'] == winner['scenario']
        assert restored.get('snapshot') is None
        assert self.selected_wait_counts.get(str(number)) == SELECTED_WAITS_PER_CYCLE, 'SELECTED_WAIT_CYCLE_COVERAGE_MISMATCH'
        self.validate_ui_wait_retention(number, wait_protocol_before)
        self.events.emit('selected_visible_wait_cycle_pass', cycle=number,
            successfulByKind=self.selected_wait_counts[str(number)], successfulCount=9)
        self.result['coverage']['uiCycles'] += 1
        for key in ('uiSaves', 'uiCrossTabConflicts', 'uiBranchSaves', 'uiPackageExports',
                    'uiPackageReimports', 'uiReloadReopens', 'uiHistoryChecks'):
            self.result['coverage'][key] += 1
        self.passed(cycle=number, elapsedSeconds=round(time.monotonic() - start, 3),
                    method='VISIBLE_CONTROLS_REAL_TABS_NATIVE_INDEXEDDB_NOT_COMPONENT',
                    masterId=self.master_id, previousRevision=old_pointer['revision'],
                    revision=winner['savedPointer']['revision'], studyHash=winner['study']['inputHash'],
                    branchId=branch_pointer['id'], branchRevision=branch_pointer['revision'],
                    historyVersions=len(history), originalPreserved=True, importedDraftUnsaved=True)

    def validate_ui_wait_retention(self, number, before):
        after = self.protocol_object_counts()
        delta = element_handle_delta(before, after)
        expected = {'primary': 0, 'secondary': 0, 'component': 0}
        ordered = number == self.result.get('uiWaitRetentionCheckedCycles', 0) + 1
        receipt = {'cycle': number, 'status': 'PASS' if delta == expected and ordered else 'FAIL',
                   'before': before, 'after': after, 'elementHandleDeltaByPage': delta,
                   'expectedDeltaByPage': expected, 'successfulSelectedWaits': 9, 'cycleOrderMatched': ordered}
        # Snapshots contain only serialized counts/identities. Keep one receipt
        # in memory; the bounded per-cycle history is written directly to JSONL.
        self.result['latestUiWaitRetention'] = receipt
        self.events.emit('ui_wait_retention', **receipt)
        assert delta == expected, 'UI_CYCLE_WAIT_HANDLE_DELTA_MISMATCH'
        assert ordered, 'UI_WAIT_RETENTION_CYCLE_ORDER_MISMATCH'
        self.result['uiWaitRetentionCheckedCycles'] = number

    def selected_visible_wait(self, locator, *, label):
        assert self.current_cycle > 0 and self.stage == 'UI_SOAK', 'SELECTED_WAIT_OUTSIDE_UI_CYCLE'
        assert label in SELECTED_WAITS_PER_CYCLE, 'SELECTED_WAIT_UNKNOWN_LABEL'
        self.guard()
        expect_visible_without_handles(locator, timeout_ms=VISIBLE_WAIT_TIMEOUT_MS)
        self.guard()
        counts = self.selected_wait_counts.setdefault(str(self.current_cycle), {})
        counts[label] = counts.get(label, 0) + 1

    def measured(self, kind, operation):
        start = time.monotonic()
        value = operation()
        elapsed = time.monotonic() - start
        self.activity_seconds[kind] = self.activity_seconds.get(kind, 0) + elapsed
        bucket = int(max(0, start - self.soak_started) // 60)
        counts = self.activity_buckets.setdefault(str(bucket), {})
        counts[kind] = counts.get(kind, 0) + 1
        if self.diagnostic_phase and self.phase_started is not None:
            phase_bucket = str(int(max(0, start - self.phase_started) // 60))
            phase_counts = self.phase_activity_buckets.setdefault(self.diagnostic_phase, {})
            phase_counts[phase_bucket] = phase_counts.get(phase_bucket, 0) + 1
        self.events.emit('operation_timing', operation=kind, seconds=round(elapsed, 4), minuteBucket=bucket,
                         diagnosticPhase=self.diagnostic_phase)
        if time.monotonic() >= self.next_memory_observation:
            self.memory_observation(kind)
        return value

    def protocol_object_counts(self):
        # Read-only diagnostic of this installed Playwright version. These are
        # protocol-object counts, not Python heap bytes or application objects.
        connection = self.page._impl_obj._connection
        pages = {'primary': self.page, 'secondary': self.secondary, 'component': self.component}
        guids = {page._impl_obj._guid: name for name, page in pages.items()}
        assert len(guids) == 3 and all(connection._objects.get(page._impl_obj._guid) is page._impl_obj
                                      for page in pages.values()), 'WAIT_PROTOCOL_PAGE_IDENTITY_UNVERIFIED'
        counts = Counter()
        by_page = {name: Counter() for name in pages}
        unassigned = Counter()
        for value in connection._objects.values():
            counts[value._type] += 1
            current, owner = value, None
            for _ in range(16):
                if current is None:
                    break
                if current._guid in guids:
                    owner = guids[current._guid]
                    break
                current = current._parent
            if value._type in ('ElementHandle', 'JSHandle'):
                assert owner is not None, 'WAIT_PROTOCOL_PAGE_ATTRIBUTION_FAILED:' + value._type
            (by_page[owner] if owner else unassigned)[value._type] += 1
        return {'total': sum(counts.values()), 'byType': dict(sorted(counts.items())),
                'pendingCallbacks': len(connection._callbacks),
                'byPage': {name: {'pageGUID': pages[name]._impl_obj._guid, 'byType': dict(sorted(values.items()))}
                           for name, values in by_page.items()},
                'unassignedByType': dict(sorted(unassigned.items())),
                'method': 'READ_ONLY_PLAYWRIGHT_PROTOCOL_REGISTRY_PARENT_CHAIN_NO_MUTATION'}

    def qualify_selected_visible_wait(self):
        """Five bounded adapter cases on the existing component page, before the soak clock."""
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        self.begin('SELECTED_WAIT_ADAPTER_QUALIFICATION')
        before = self.protocol_object_counts()
        records = []
        selector = '#enterprise-selected-wait-qualification'
        assert self.component.locator(selector).count() == 0, 'WAIT_QUALIFICATION_HOST_ALREADY_EXISTS'
        try:
            for kind in ('visible', 'opacity_zero', 'hidden', 'zero_size', 'missing'):
                self.guard()
                self.component.evaluate('''({selector, kind}) => {
                    document.querySelector(selector)?.remove();
                    const host = document.createElement('div'); host.id = selector.slice(1);
                    host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647';
                    if (kind !== 'missing') {
                        const node = document.createElement('div'); node.dataset.waitTarget = 'true';
                        node.style.cssText = 'display:block;width:20px;height:20px';
                        if (kind === 'opacity_zero') node.style.opacity = '0';
                        if (kind === 'hidden') node.style.visibility = 'hidden';
                        if (kind === 'zero_size') { node.style.width = '0'; node.style.height = '0'; }
                        host.append(node);
                    }
                    document.body.append(host);
                }''', {'selector': selector, 'kind': kind})
                positive = kind in ('visible', 'opacity_zero')
                timeout = VISIBLE_WAIT_TIMEOUT_MS if positive else 150
                record = {'case': kind, 'timeoutMs': timeout, 'mainArmTimeout': positive,
                          'errorClass': None, 'causeClass': None}
                try:
                    expect_visible_without_handles(self.component.locator(selector + ' [data-wait-target]'),
                                                   timeout_ms=timeout)
                except PlaywrightTimeoutError as error:
                    assert not positive, 'VISIBLE_ADAPTER_POSITIVE_CASE_TIMED_OUT:' + kind
                    assert isinstance(error.__cause__, AssertionError), 'VISIBLE_ADAPTER_TIMEOUT_CAUSE_MISSING'
                    record.update(errorClass=type(error).__module__ + '.' + type(error).__name__,
                                  causeClass=type(error.__cause__).__module__ + '.' + type(error.__cause__).__name__)
                else:
                    assert positive, 'VISIBLE_ADAPTER_NEGATIVE_CASE_SUCCEEDED:' + kind
                records.append(record)
        finally:
            self.component.evaluate('(selector) => document.querySelector(selector)?.remove()', selector)
        after = self.protocol_object_counts()
        assert element_handle_delta(before, after) == {'primary': 0, 'secondary': 0, 'component': 0}, \
            'VISIBLE_ADAPTER_QUALIFICATION_RETAINED_ELEMENT_HANDLE'
        self.result['selectedVisibleWaitQualification'] = {'status': 'PASS', 'cases': records,
            'before': before, 'after': after, 'mainTimeoutMs': VISIBLE_WAIT_TIMEOUT_MS,
            'negativeTimeoutMs': 150, 'negativeTimeoutIsMainWaitTimeout': False,
            'componentPageOnly': True, 'applicationDataWritten': False, 'selectedCycleCountsIncluded': False,
            'existingABQualification': {'sourceCommit': 'a1bd7afcc88b92fa6a501cd809191c2eb0ea8cfc',
                                      'cases': 10, 'scope': 'VISIBLE_CONDITION_ONLY_NOT_ALL_WAIT_TYPES'}}
        self.passed(**self.result['selectedVisibleWaitQualification'])

    def handle_lifetime_control(self):
        self.begin('HANDLE_LIFETIME_CONTROL')
        before = self.protocol_object_counts()
        handles = []
        try:
            for _ in range(32):
                handles.append(self.page.wait_for_function('() => true'))
            retained = self.protocol_object_counts()
            assert retained['byType'].get('JSHandle', 0) == before['byType'].get('JSHandle', 0) + 32
        finally:
            for handle in handles:
                handle.dispose()
        released = self.protocol_object_counts()
        assert released['byType'].get('JSHandle', 0) == before['byType'].get('JSHandle', 0), \
            'Disposing consumed wait handles did not restore the protocol registry'
        self.result['handleLifetimeControl'] = {'createdHandles': 32, 'before': before,
            'retained': retained, 'released': released, 'forcedGC': False,
            'interpretation': 'Proves handle registration/release only; does not attribute total RSS growth'}
        self.passed(**self.result['handleLifetimeControl'])

    def memory_observation(self, label):
        pages = {}
        for name, page in (('primary', self.page), ('secondary', self.secondary), ('component', self.component)):
            session = self.context.new_cdp_session(page)
            try:
                session.send('Performance.enable')
                metrics = {row['name']: row['value'] for row in session.send('Performance.getMetrics')['metrics']}
                selected = ('JSHeapUsedSize', 'JSHeapTotalSize', 'Documents', 'Nodes', 'JSEventListeners')
                pages[name] = {'performance': {key: metrics[key] for key in selected if key in metrics},
                               'dom': session.send('Memory.getDOMCounters')}
            finally:
                session.detach()
        self.events.emit('memory_diagnostic', label=label, uiCycle=self.current_cycle,
            diagnosticPhase=self.diagnostic_phase,
            componentCycles=self.result['coverage']['componentCycles'],
            protocolObjects=self.protocol_object_counts(), pages=pages,
            collector={'retainedResourceSamples': len(self.monitor.samples),
                       'resourceJsonlBytes': self.monitor.log.path.stat().st_size,
                       'cycleJsonlBytes': self.events.path.stat().st_size,
                       'continuousTrace': False},
            forcedGC=False, interpretation='Read-only counters; DOM/heap metrics may include shared renderer work')
        self.next_memory_observation = time.monotonic() + 60

    def durability_probe(self):
        before = state(self.page)
        pointer = before['savedPointer']
        after = self.reopen_public(self.page, self.master_id)
        assert after['savedPointer'] == pointer, 'Read-only UI reopen changed the durable pointer'
        assert after['study']['inputHash'] == before['study']['inputHash']
        assert after['scenario'] == before['scenario'] and after.get('snapshot') == before.get('snapshot')
        checked = self.component.evaluate('() => enterpriseStorageSoak.bounded("finish")')
        assert checked['completed'] == self.result['coverage']['componentCycles']
        self.result['coverage']['uiDurabilityReopens'] += 1
        self.result['coverage']['componentFullHistoryProbes'] += 1
        self.events.emit('durability_probe_pass', pointerRevision=pointer['revision'],
            uiMethod='PUBLIC_SAVED_STUDY_REOPEN', componentMethod='NATIVE_FULL_HISTORY_READBACK',
            componentCycles=checked['completed'])
        self.write()

    def operate_until(self, deadline):
        # Unfilled schedule intervals perform real UI and native-IDB readback.
        # They are not reported as more complete UI mutation or component CAS rounds.
        while time.monotonic() < deadline:
            self.guard()
            self.measured('public_ui_and_native_history_probe', self.durability_probe)
            remaining = deadline - time.monotonic()
            if remaining > 0:
                started = time.monotonic()
                self.page.wait_for_timeout(min(250, remaining * 1000))
                self.controlled_interval_seconds += time.monotonic() - started

    def storage_batch(self, count, window_end):
        self.begin('COMPONENT_SOAK')
        batch_start = time.monotonic()
        for index in range(count):
            scheduled = batch_start + max(0, window_end - batch_start) * index / max(1, count)
            self.operate_until(scheduled)
            self.guard()
            number = self.result['coverage']['componentCycles'] + 1
            self.events.emit('component_cycle_start', cycle=number,
                             method='NATIVE_INDEXEDDB_COMPONENT_NOT_PUBLIC_UI')
            result = self.measured('native_indexeddb_component_cycle',
                lambda: self.component.evaluate('() => enterpriseStorageSoak.bounded("cycle")'))
            assert result['cycle'] == number
            coverage = self.result['coverage']
            coverage['componentCycles'] += 1
            coverage['componentCASConflicts'] += result['casConflicts']
            coverage['componentQuotaRollbacks'] += result['quotaRollbacks']
            coverage['componentTransactionAborts'] += result['transactionAborts']
            coverage['componentHistoryReadbacks'] += result['immutableHistoryReadbacks']
            self.events.emit('component_cycle_pass', method='NATIVE_INDEXEDDB_COMPONENT_NOT_PUBLIC_UI', **result)
            self.write()
        self.passed(batchCycles=count, totalComponentCycles=self.result['coverage']['componentCycles'])

    def native_round(self, initial=False):
        before = self.protocol_object_counts()
        self.busy()
        self.result['coverage']['controlledBusyRejections'] += 1
        current = self.native_retry('INITIAL_NATIVE_RETRY' if initial else 'PERIODIC_NATIVE_RETRY')
        self.result['coverage']['genuineNativeRetries'] += 1
        self.events.emit('genuine_native_retry', jobId=current['job']['jobId'],
            snapshotHash=current['snapshot']['snapshotHash'],
            pointerRevision=current['savedPointer']['revision'], uiCycle=self.current_cycle,
            method='UNALTERED_NATIVE_RESPONSE_WITH_INDEPENDENT_HAVERSINE_ORACLE')
        after = self.protocol_object_counts()
        delta = element_handle_delta(before, after)
        record = {'initialBeforeBaseline': initial, 'uiCycle': self.current_cycle,
                  'before': before, 'after': after, 'elementHandleDeltaByPage': delta,
                  'expectedDeltaByPage': {'primary': 5, 'secondary': 0, 'component': 0},
                  'waitImplementationChanged': False}
        self.native_wait_records.append(record)
        self.events.emit('unchanged_native_visible_waits', **record)
        assert delta == record['expectedDeltaByPage'], 'UNCHANGED_NATIVE_WAIT_HANDLE_DELTA_MISMATCH'
        return current

    def storage_observation(self):
        return self.page.evaluate('''async () => {
          const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
          const dbs = indexedDB.databases ? await indexedDB.databases() : [];
          const uiName = 'stct-platform-v19-p5';
          let uiStoreCounts = null;
          if (dbs.some(db=>db.name===uiName)) {
            uiStoreCounts = await new Promise((resolve,reject)=>{
              const request=indexedDB.open(uiName);
              request.onerror=()=>reject(Error('UI database observation failed'));
              request.onsuccess=()=>{
                const db=request.result, names=['supplyStudies','supplySnapshots','pointers','audit'];
                const tx=db.transaction(names,'readonly'), counts={};
                for(const name of names){const read=tx.objectStore(name).count();read.onsuccess=()=>counts[name]=read.result;}
                tx.oncomplete=()=>{db.close();resolve(counts);};
                tx.onerror=tx.onabort=()=>{db.close();reject(Error('UI database count aborted'));};
              };
            });
          }
          return {usageBytes:estimate.usage ?? null, quotaBytes:estimate.quota ?? null,
            databaseCount:dbs.length, observedDatabaseNames:dbs.map(d=>d.name), uiStoreCounts};
        }''')

    def idle_baseline(self):
        self.begin('IDLE_BASELINE')
        started = time.monotonic()
        first = self.monitor.sample()
        while time.monotonic() - started < 10:
            self.guard()
            self.page.wait_for_timeout(250)
        last = self.monitor.sample()
        baseline = self.monitor.trend(first['elapsedSeconds'])
        assert baseline['sampleCount'] >= 3, 'Idle baseline needs multiple actual resource samples'
        median = baseline['rssBytes']['median']
        baseline.update(observedIdleSeconds=round(time.monotonic() - started, 3),
            rssRangeFractionOfMedian=round(baseline['rssBytes']['range'] / max(1, median), 6),
            noForcedGC=True, noApplicationMutation=True, noLimitAdjustment=True,
            interpretation='Measured idle median and variability; stability is reported, not assumed')
        self.result['idleResourceBaseline'] = baseline
        self.result['resourceBaseline'] = last
        self.baseline_elapsed = last['elapsedSeconds']
        self.wait_protocol_baseline = self.protocol_object_counts()
        self.result['selectedWaitProtocolBaseline'] = self.wait_protocol_baseline
        self.memory_observation('idle_baseline_end')
        self.passed(**baseline)

    def checked_seed_coverage(self):
        component = self.component.evaluate('() => enterpriseStorageSoak.bounded("finish")')
        self.result['componentFinal'] = component
        coverage = self.result['coverage']
        assert coverage['uiCycles'] == self.args.ui_cycles
        assert coverage['componentCycles'] == self.args.storage_cycles
        assert component['counts']['supplyStudies'] == self.args.storage_cycles + 1
        assert component['counts']['audit'] == self.args.storage_cycles + 1
        for name in ('uiSaves', 'uiCrossTabConflicts', 'uiBranchSaves', 'uiPackageExports',
                     'uiPackageReimports', 'uiReloadReopens', 'uiHistoryChecks'):
            assert coverage[name] == self.args.ui_cycles, (name, coverage[name])
        for name in ('componentCASConflicts', 'componentQuotaRollbacks', 'componentTransactionAborts',
                     'componentHistoryReadbacks'):
            assert coverage[name] == self.args.storage_cycles, (name, coverage[name])
        expected_native = 1 + self.args.ui_cycles // self.args.native_every
        assert coverage['genuineNativeRetries'] == coverage['controlledBusyRejections'] == expected_native
        return coverage

    def final_invariants(self):
        self.begin('FINAL_INVARIANTS')
        coverage = self.checked_seed_coverage()
        self.validate_selected_wait_retention()
        expected_errors = [message for message in self.result['consoleErrors']
                           if re.search(r'(?:status of 429|429 \(Too Many Requests\))', message)]
        unexpected = [message for message in self.result['consoleErrors'] if message not in expected_errors]
        assert not unexpected, unexpected
        self.result['expectedControlledHttpConsoleErrors'] = expected_errors
        self.result['sourceAfter'] = source_identity(ROOT)
        assert self.result['sourceAfter'] == self.result['source'], 'SOURCE_CHANGED_DURING_RUN'
        self.result['storageFinal'] = self.storage_observation()
        elapsed = time.monotonic() - self.soak_started
        qualified = False
        if self.is_diagnostic:
            phases = self.result['diagnostic']['phases']
            assert all(phases.get(name, {}).get('status') == 'PASS' for name in
                       ('seed', 'fixed_history', 'idle_recovery')), 'DIAGNOSTIC_PHASE_MISSING'
            assert phases['fixed_history']['observedSeconds'] >= self.args.fixed_history_seconds
            assert phases['idle_recovery']['observedSeconds'] >= self.args.recovery_seconds
            self.result['observedDiagnosticSeconds'] = round(elapsed, 3)
            self.result['soakQualification'] = 'NOT_MUTATION_SOAK'
            self.result['diagnosticQualification'] = 'NOT_QUALIFIED_SHORT_RUN' if self.args.smoke else 'PASS_DIAGNOSTIC'
        else:
            assert elapsed >= self.args.duration_seconds, 'Requested observation window was shortened'
            qualified = elapsed >= 600 and coverage['uiCycles'] >= 20 and coverage['componentCycles'] >= 300
            for minute in range(int(self.args.duration_seconds // 60)):
                assert self.activity_buckets.get(str(minute)), f'No actual operation in minute {minute}'
            self.result['observedSoakSeconds'] = round(elapsed, 3)
            self.result['soakQualification'] = 'PASS' if qualified and not self.args.smoke else 'NOT_QUALIFIED_SHORT_RUN'
            if not self.args.smoke:
                assert qualified
        self.result['activityTiming'] = {
            'operationSecondsByKind': {k: round(v, 3) for k, v in self.activity_seconds.items()},
            'totalOperationSeconds': round(sum(self.activity_seconds.values()), 3),
            'controlledIntervalSeconds': round(self.controlled_interval_seconds, 3),
            'maximumRequestedCadenceWaitSeconds': .25,
            'operationCountsByMinute': self.activity_buckets,
            'meaning': 'Measured UI/component/native operations include normal response waits. '
                       'Explicit cadence intervals are separate, not pressure activity.'}
        self.result['observationWindowEnded'] = True
        self.result['resourceTrend'] = self.monitor.trend(self.baseline_elapsed)
        self.memory_observation('final_invariants')
        self.page.screenshot(path=str(self.evidence / 'final-ui.png'), full_page=True)
        self.passed(coverage=coverage, observedSeconds=round(elapsed, 3), soakQualified=qualified and not self.args.smoke,
                    componentAndPublicUiEvidenceSeparate=True, evidenceOfNoLeak='NOT_CLAIMED_FROM_FINITE_WINDOW')

    def validate_selected_wait_retention(self):
        selected = check_selected_wait_coverage(self.selected_wait_counts, self.args.ui_cycles)
        assert self.result.get('uiWaitRetentionCheckedCycles') == self.args.ui_cycles, 'UI_WAIT_RETENTION_COVERAGE_MISMATCH'
        periodic = [record for record in self.native_wait_records if not record['initialBeforeBaseline']]
        assert len([record for record in self.native_wait_records if record['initialBeforeBaseline']]) == 1, \
            'INITIAL_NATIVE_WAIT_RECORD_MISSING'
        assert [record['uiCycle'] for record in periodic] == \
            list(range(self.args.native_every, self.args.ui_cycles + 1, self.args.native_every)), \
            'PERIODIC_NATIVE_WAIT_RECORD_MISMATCH'
        expected = {'primary': 5 * len(periodic), 'secondary': 0, 'component': 0}
        assert all(record['elementHandleDeltaByPage'] == {'primary': 5, 'secondary': 0, 'component': 0}
                   for record in self.native_wait_records), 'NATIVE_WAIT_CONTRIBUTION_MISMATCH'
        final = self.protocol_object_counts()
        delta = element_handle_delta(self.wait_protocol_baseline, final)
        record = {'status': 'PASS' if delta == expected else 'FAIL',
                  'successfulSelectedWaits': selected, 'expectedSelectedWaits': 9 * self.args.ui_cycles,
                  'periodicNativeRounds': len(periodic), 'baseline': self.wait_protocol_baseline,
                  'final': final, 'elementHandleDeltaByPage': delta, 'expectedDeltaByPage': expected,
                  'unchangedNativeExpectedContribution': 5 * len(periodic),
                  'interpretation': 'The gate compares final handle growth with the independently observed unchanged native waits. '
                                    'Passing does not attribute all DOM or RSS growth or prove absence of a product leak.'}
        self.result['selectedWaitRetentionValidation'] = record
        self.events.emit('selected_wait_retention_validation', **record)
        assert delta == expected, 'SELECTED_WAIT_FINAL_HANDLE_DELTA_MISMATCH'

    def run_mutation_cycles(self, duration):
        for number in range(1, self.args.ui_cycles + 1):
            self.current_cycle = number
            scheduled = self.soak_started + duration * (number - 1) / self.args.ui_cycles
            self.operate_until(scheduled)
            self.measured('complete_public_ui_cycle', lambda: self.cycle_ui(number))
            target = math.floor(self.args.storage_cycles * number / self.args.ui_cycles)
            window_end = self.soak_started + duration * number / self.args.ui_cycles
            self.storage_batch(target - self.result['coverage']['componentCycles'], window_end)
            if number % self.args.native_every == 0:
                self.measured('controlled_busy_and_native_retry', self.native_round)
            self.events.emit('ui_cycle_checkpoint', uiCycle=number, coverage=self.result['coverage'],
                storage=self.storage_observation(), resources=self.monitor.trend(self.baseline_elapsed))
            if number in {1, math.ceil(self.args.ui_cycles / 2), self.args.ui_cycles}:
                self.page.screenshot(path=str(self.evidence / f'checkpoint-{number:03d}.png'), full_page=True)

    def durable_fingerprint(self):
        """Read-only counts and SHA-256 of every durable row in both history graphs."""
        return self.page.evaluate('''async (names) => {
          const observe = async () => {
            const present = (await indexedDB.databases()).map(row => row.name).sort();
            if (JSON.stringify(present) !== JSON.stringify([...names].sort()))
              throw Error('DIAGNOSTIC_DATABASE_SET_CHANGED');
            const output = {};
            for (const name of [...names].sort()) {
              const records = await new Promise((resolve, reject) => {
                const request = indexedDB.open(name);
                let upgradeRejected = false;
                // Enumeration and open are separate operations: a vanished DB
                // would otherwise be recreated by open(). Abort that upgrade.
                request.onupgradeneeded = () => {
                  upgradeRejected = true;
                  const db = request.result;
                  try { request.transaction.abort(); }
                  finally { db.close(); reject(Error('DIAGNOSTIC_DATABASE_DISAPPEARED')); }
                };
                request.onerror = () => reject(Error('DIAGNOSTIC_DATABASE_READ_FAILED'));
                request.onsuccess = () => {
                  const db = request.result, stores = ['supplyStudies', 'supplySnapshots', 'pointers', 'audit'];
                  if (upgradeRejected) { db.close(); return; }
                  const tx = db.transaction(stores, 'readonly'), result = {};
                  for (const store of stores) {
                    const read = tx.objectStore(store).getAll();
                    read.onsuccess = () => result[store] = read.result;
                  }
                  tx.oncomplete = () => { db.close(); resolve(result); };
                  tx.onerror = tx.onabort = () => { db.close(); reject(Error('DIAGNOSTIC_READ_ABORTED')); };
                };
              });
              output[name] = {};
              for (const store of Object.keys(records).sort()) {
                const bytes = new TextEncoder().encode(JSON.stringify(records[store]));
                const digest = await crypto.subtle.digest('SHA-256', bytes);
                output[name][store] = {count: records[store].length,
                  sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')};
              }
            }
            return output;
          };
          let timer;
          try {
            return await Promise.race([observe(), new Promise((_, reject) => {
              timer = setTimeout(() => reject(Error('DIAGNOSTIC_FINGERPRINT_TIMEOUT')), 15000);
            })]);
          } finally { clearTimeout(timer); }
        }''', ['stct-platform-v19-p5', self.result['componentBaseline']['database']])

    @staticmethod
    def assert_fixed_history(before, after, phase):
        assert before == after, f'DIAGNOSTIC_DURABLE_HISTORY_CHANGED:{phase}'

    def diagnostic_controls(self):
        self.checked_seed_coverage()
        self.guard()
        seed_seconds = time.monotonic() - self.soak_started
        assert seed_seconds >= self.args.duration_seconds, 'DIAGNOSTIC_SEED_CADENCE_SHORTENED'
        seed_counts = self.phase_activity_buckets.get('seed', {})
        for minute in range(int(self.args.duration_seconds // 60)):
            assert seed_counts.get(str(minute), 0) > 0, f'DIAGNOSTIC_SEED_MINUTE_EMPTY:{minute}'
        self.result['diagnostic']['phases']['seed'] = {'status': 'PASS',
            'observedSeconds': round(seed_seconds, 3), 'uiCycles': self.args.ui_cycles,
            'componentCycles': self.args.storage_cycles, 'qualifiesMutationSoak': False,
            'requestedCadenceSeconds': self.args.duration_seconds, 'operationCountsByMinute': dict(seed_counts)}
        self.diagnostic_phase = 'fixed_history'
        self.begin('FIXED_HISTORY_READBACK')
        baseline = self.durable_fingerprint()
        self.result['diagnostic']['durableBaseline'] = baseline
        self.phase_started = time.monotonic()
        first = self.monitor.sample()
        self.memory_observation('fixed_history_start')
        before_probes = self.result['coverage']['uiDurabilityReopens']
        self.operate_until(self.phase_started + self.args.fixed_history_seconds)
        observed = time.monotonic() - self.phase_started
        after_readback = self.durable_fingerprint()
        self.assert_fixed_history(baseline, after_readback, 'fixed_history')
        self.monitor.sample()
        self.memory_observation('fixed_history_end')
        counts = self.phase_activity_buckets.get('fixed_history', {})
        for minute in range(max(1, int(self.args.fixed_history_seconds // 60))):
            assert counts.get(str(minute), 0) > 0, f'DIAGNOSTIC_READBACK_MINUTE_EMPTY:{minute}'
        self.result['diagnostic']['phases']['fixed_history'] = {'status': 'PASS',
            'observedSeconds': round(observed, 3), 'publicReopens': self.result['coverage']['uiDurabilityReopens'] - before_probes,
            'operationCountsByMinute': dict(counts), 'durableFingerprintUnchanged': True,
            'durableAfter': after_readback,
            'resourceTrend': self.monitor.trend(first['elapsedSeconds'])}
        self.passed(**self.result['diagnostic']['phases']['fixed_history'])

        self.diagnostic_phase = 'idle_recovery'
        self.begin('NATURAL_IDLE_RECOVERY')
        self.phase_started = time.monotonic()
        first = self.monitor.sample()
        self.memory_observation('idle_recovery_start')
        before_coverage = dict(self.result['coverage'])
        while time.monotonic() - self.phase_started < self.args.recovery_seconds:
            self.guard()
            self.page.wait_for_timeout(min(250, max(0, self.args.recovery_seconds - (time.monotonic() - self.phase_started)) * 1000))
            if time.monotonic() >= self.next_memory_observation:
                self.memory_observation('idle_recovery_observation')
        observed = time.monotonic() - self.phase_started
        self.monitor.sample()
        self.memory_observation('idle_recovery_end')
        recovery_trend = self.monitor.trend(first['elapsedSeconds'])
        after_recovery = self.durable_fingerprint()
        self.assert_fixed_history(baseline, after_recovery, 'idle_recovery')
        assert before_coverage == self.result['coverage'], 'IDLE_RECOVERY_MUST_NOT_COUNT_PRESSURE_OPERATIONS'
        self.result['diagnostic']['phases']['idle_recovery'] = {'status': 'PASS',
            'observedSeconds': round(observed, 3), 'pressureOperations': 0,
            'durableFingerprintUnchanged': True, 'durableAfter': after_recovery,
            'forcedGC': False, 'resourceTrend': recovery_trend}
        self.passed(**self.result['diagnostic']['phases']['idle_recovery'])

    def record_failure(self, exc):
        if not self.monitor.violation and not isinstance(exc, SoakDeadlineError):
            super().record_failure(exc)
            return
        # Do not allocate a full-page screenshot or huge application snapshot
        # after a resource-limit interrupt; retain the synthetic profile instead.
        blocked = self.soak_started is None and self.monitor.violation is not None
        self.result['status'] = 'BLOCKED_ENVIRONMENT' if blocked else 'FAIL'
        self.result['error'] = self.scrub(str(exc))
        self.result['stages'][self.stage] = {'status': self.result['status'],
            'reason': 'COOPERATIVE_STOP_REQUESTED' if isinstance(exc, SoakDeadlineError) and not self.monitor.violation else
                      'ISOLATED_BASELINE_RESOURCE_BUDGET_OR_OBSERVATION_BLOCKED' if blocked else
                      'SUSTAINED_RESOURCE_LIMIT_OR_OBSERVATION_FAILED',
            'details': self.monitor.violation}
        if blocked:
            self.result['soakQualification'] = 'NOT_RUN_RESOURCE_BASELINE_BLOCKED'

    def cleanup(self):
        self.monitor.stop()
        self.result['resourceTrendIncludingWarmup'] = self.monitor.trend()
        if self.monitor.violation:
            self.result['resourceViolation'] = self.monitor.violation
            if self.soak_started is not None:
                self.result['status'] = 'FAIL'
        # Finish application fault/job cleanup while the context remains usable.
        # Base cleanup closes our browser and uses the launcher's ownership checks.
        # Move (not duplicate) the synthetic profile before base deletes runtime.
        if self.result['status'] == 'FAIL' and self.context:
            try:
                self.context.close()
                if self.profile.exists():
                    shutil.move(str(self.profile), str(self.evidence / 'failed-synthetic-browser-profile'))
                    self.result['reproductionProfileRetained'] = True
            except Exception as exc:
                self.result['profileRetentionError'] = self.scrub(str(exc))
        # No held jobs are used by this suite, so FaultSuite has no owned job
        # cancellation to perform after a failed context has closed.
        super().cleanup()

    def run(self):
        def terminated(signum, _frame):
            # Never raise inside the Playwright dispatcher greenlet.
            self.interruption_requested = signum
        self.previous_sigterm_handler = signal.signal(signal.SIGTERM, terminated)
        try:
            self.monitor.start()
            self.launch()
            for kind in ('web', 'optimizer'):
                self.monitor.add_root(self.record[kind]['pid'], kind='services_workers')
            owned = {'runToken': self.runtime.name, 'services': [
                {'pid': self.record[kind]['pid'], 'startTicks': self.monitor.roots[self.record[kind]['pid']]}
                for kind in ('web', 'optimizer')]}
            pending = self.runtime / 'owned-processes.pending'
            pending.write_text(json.dumps(owned))
            pending.replace(self.runtime / 'owned-processes.json')
            from playwright.sync_api import sync_playwright
            with sync_playwright() as playwright:
                try:
                    self.open_browser(playwright)
                    self.setup_component()
                    self.import_workbook()
                    self.result['coverage']['workbookPublicImports'] = 1
                    initial = self.native_round(initial=True)
                    self.master_id = initial['savedPointer']['id']
                    login(self.secondary, self.base)
                    self.reopen_public(self.secondary, self.master_id)
                    self.result['storageBaseline'] = self.storage_observation()
                    self.qualify_selected_visible_wait()
                    self.handle_lifetime_control()
                    self.idle_baseline()
                    self.page.screenshot(path=str(self.evidence / 'baseline-ui.png'), full_page=True)
                    self.soak_started = time.monotonic()
                    self.diagnostic_phase = 'seed' if self.is_diagnostic else None
                    self.diagnostic_pages = tuple(self.context.pages) if self.is_diagnostic else None
                    self.phase_started = self.soak_started
                    self.events.emit('diagnostic_seed_start' if self.is_diagnostic else 'soak_window_start',
                                     coverage=self.result['coverage'])
                    self.run_mutation_cycles(self.args.duration_seconds)
                    if self.is_diagnostic:
                        self.operate_until(self.soak_started + self.args.duration_seconds)
                        self.diagnostic_controls()
                    else:
                        # Continue actual readonly operations through the requested window.
                        self.operate_until(self.soak_started + self.args.duration_seconds)
                    self.final_invariants()
                    self.result['status'] = ('PASS_DIAGNOSTIC_SMOKE' if self.args.smoke else 'PASS_DIAGNOSTIC') \
                        if self.is_diagnostic else 'PASS'
                except BaseException as exc:
                    if isinstance(exc, (KeyboardInterrupt, SystemExit)) and self.monitor.violation:
                        exc = AssertionError(json.dumps(self.monitor.violation))
                    self.record_failure(exc)
                    self.write()
                    self.events.emit('failure', stage=self.stage, uiCycle=self.current_cycle,
                                     error=str(exc), coverage=self.result['coverage'])
                finally:
                    self.cleanup()
        except BaseException as exc:
            if isinstance(exc, (KeyboardInterrupt, SystemExit)) and self.monitor.violation:
                exc = AssertionError(json.dumps(self.monitor.violation))
            self.record_failure(exc)
            self.write()
            self.events.emit('failure', stage=self.stage, error=str(exc), coverage=self.result['coverage'])
            if not self.cleaned:
                try:
                    self.cleanup()
                except Exception as cleanup_error:
                    self.monitor.stop()
                    self.result['status'] = 'FAIL'
                    self.result['stages']['CLEANUP'] = {'status': 'FAIL', 'error': self.scrub(str(cleanup_error))}
        signal.signal(signal.SIGTERM, self.previous_sigterm_handler)
        self.result['externalBlocked'] = sorted(set(self.result['externalBlocked']))
        artifacts = [p for p in self.evidence.rglob('*') if p.is_file()]
        self.result['evidenceStorage'] = {'fileCount': len(artifacts),
            'bytesBeforeFinalSummaryWrite': sum(p.stat().st_size for p in artifacts),
            'continuousTrace': False, 'separateFromApplicationStorageEstimate': True}
        self.write()
        print(self.scrub(json.dumps({'status': self.result['status'], 'source': self.result['source'],
            'coverage': self.result['coverage'], 'soakQualification': self.result.get('soakQualification', 'NOT_RUN')})))
        return 0 if self.result['status'] in ('PASS', 'PASS_DIAGNOSTIC', 'PASS_DIAGNOSTIC_SMOKE') \
            else 78 if self.result['status'] == 'BLOCKED_ENVIRONMENT' else 1


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    parser.add_argument('--workload-profile', choices=WORKLOAD_PROFILES, default='mutation-soak')
    parser.add_argument('--duration-seconds', type=float, default=None)
    parser.add_argument('--fixed-history-seconds', type=float, default=None)
    parser.add_argument('--recovery-seconds', type=float, default=None)
    parser.add_argument('--seed-max-seconds', type=float, default=None)
    parser.add_argument('--ui-cycles', type=int, default=30)
    parser.add_argument('--storage-cycles', type=int, default=600)
    parser.add_argument('--native-every', type=int, default=5)
    parser.add_argument('--sample-seconds', type=float, default=1)
    parser.add_argument('--memory-profile', choices=tuple(MEMORY_PROFILES), default='standard-1gib')
    parser.add_argument('--max-rss-mib', type=int, default=None,
                        help='Optional tighter limit within the explicitly selected memory profile')
    parser.add_argument('--max-fds', type=int, default=1024)
    parser.add_argument('--max-wall-seconds', type=float, default=None,
                        help='Independent watchdog: smoke 180s, mutation duration+120s, fast diagnostic 960s, paced diagnostic 1500s')
    parser.add_argument('--smoke', action='store_true', help='Allow short harness check; never qualifies as soak evidence')
    args = parser.parse_args(argv)
    diagnostic = DIAGNOSTIC_PROFILES.get(args.workload_profile)
    if args.duration_seconds is None:
        args.duration_seconds = diagnostic['seedCadenceSeconds'] if diagnostic else 720
    if diagnostic:
        args.fixed_history_seconds = 360 if args.fixed_history_seconds is None else args.fixed_history_seconds
        args.recovery_seconds = 180 if args.recovery_seconds is None else args.recovery_seconds
        args.seed_max_seconds = diagnostic['seedMaxSeconds'] if args.seed_max_seconds is None else args.seed_max_seconds
        values = (args.fixed_history_seconds, args.recovery_seconds, args.seed_max_seconds)
        if not all(math.isfinite(value) and value > 0 for value in values) or sum(values) > diagnostic['phaseBudgetSeconds']:
            parser.error(f"Diagnostic seed/readback/recovery bounds must be positive, finite and total <={diagnostic['phaseBudgetSeconds']} seconds")
        if args.seed_max_seconds > diagnostic['seedMaxSeconds'] or args.seed_max_seconds < args.duration_seconds:
            parser.error(f"Diagnostic seed-max-seconds must cover its cadence and may not exceed {diagnostic['seedMaxSeconds']}")
        if args.workload_profile == 'fixed-history-recovery' and args.duration_seconds != 0:
            parser.error('Fast diagnostic seed must be unpaced (--duration-seconds 0)')
        if args.workload_profile == 'paced-history-recovery' and (
                not math.isfinite(args.duration_seconds) or not 0 < args.duration_seconds <= 720 or
                (not args.smoke and args.duration_seconds != 720)):
            parser.error('Paced diagnostic requires the original 720-second cadence; only smoke may use a shorter positive cadence')
        if not args.smoke and (args.ui_cycles != 30 or args.storage_cycles != 600 or args.native_every != 5 or
                               args.fixed_history_seconds < 360 or args.recovery_seconds < 180):
            parser.error('Diagnostic requires exactly 30 UI/600 component seed, native-every 5, >=360s readback and >=180s recovery')
    elif any(value is not None for value in (args.fixed_history_seconds, args.recovery_seconds, args.seed_max_seconds)):
        parser.error('Diagnostic phase options require a named history-recovery workload profile')
    if not 1 <= args.ui_cycles <= 50 or not 1 <= args.storage_cycles <= 1000:
        parser.error('Bounded repetitions require 1..50 UI cycles and 1..1000 component cycles')
    if not math.isfinite(args.duration_seconds) or not 0 <= args.duration_seconds <= 900:
        parser.error('Duration must be a finite value from 0 to 900 seconds')
    if not diagnostic and not args.smoke and (args.duration_seconds < 600 or args.ui_cycles < 20 or args.storage_cycles < 300):
        parser.error('Soak requires >=600 seconds, >=20 UI cycles, >=300 components; use --smoke for a short check')
    if not 1 <= args.native_every <= args.ui_cycles:
        parser.error('native-every must be within 1..ui-cycles')
    profile_limit = MEMORY_PROFILES[args.memory_profile]
    if args.max_rss_mib is None:
        args.max_rss_mib = profile_limit
    if not 1 <= args.max_rss_mib <= profile_limit or not 1 <= args.max_fds <= 1024:
        parser.error('RSS may not exceed the named profile cap; aggregate FD limit remains 1024')
    if not math.isfinite(args.sample_seconds) or not .25 <= args.sample_seconds <= 5:
        parser.error('Resource sampling must be every .25..5 seconds')
    if args.max_wall_seconds is None:
        args.max_wall_seconds = 180 if args.smoke else diagnostic['wallCapSeconds'] if diagnostic else args.duration_seconds + 120
    if not math.isfinite(args.max_wall_seconds) or args.max_wall_seconds < max(30, args.duration_seconds):
        parser.error('max-wall-seconds must be finite and >= max(30, duration-seconds)')
    if diagnostic and (args.max_wall_seconds > diagnostic['wallCapSeconds'] or
                       args.max_wall_seconds < sum(values) + 30):
        parser.error(f"Diagnostic watchdog must cover all configured phase budgets plus 30 seconds, and may not exceed {diagnostic['wallCapSeconds']}")
    evidence = args.evidence_dir.expanduser().resolve()
    if evidence == ROOT or ROOT in evidence.parents:
        parser.error('Evidence must be outside the checkout')
    evidence.mkdir(parents=True, exist_ok=True)
    if any(evidence.iterdir()):
        parser.error('Use a fresh empty evidence directory; previous evidence is never overwritten')
    args.evidence_dir = evidence
    return args


# Run without launching services/browser: python -m unittest discover -s tests
# -p test_enterprise_browser_soak.py. These checks exercise the qualification
# boundaries and tamper detection, not a substitute browser implementation.
class DiagnosticProfileGuardTests(unittest.TestCase):
    def parse(self, *flags):
        import contextlib
        import io
        with tempfile.TemporaryDirectory(prefix='browser-profile-guard-') as root:
            with contextlib.redirect_stderr(io.StringIO()):
                return parse_args(['--evidence-dir', str(Path(root) / 'evidence'), *flags])

    def test_original_defaults_and_minimums_are_preserved(self):
        args = self.parse()
        self.assertEqual((args.workload_profile, args.duration_seconds, args.ui_cycles, args.storage_cycles),
                         ('mutation-soak', 720, 30, 600))
        self.assertEqual((args.max_rss_mib, args.max_wall_seconds), (1024, 840))
        with self.assertRaises(SystemExit):
            self.parse('--duration-seconds', '599')

    def test_full_diagnostic_is_unpaced_and_has_bounded_controls(self):
        args = self.parse('--workload-profile', 'fixed-history-recovery', '--memory-profile', 'hosted-2gib')
        self.assertEqual((args.duration_seconds, args.fixed_history_seconds, args.recovery_seconds), (0, 360, 180))
        self.assertEqual((args.ui_cycles, args.storage_cycles, args.native_every), (30, 600, 5))
        self.assertEqual((args.seed_max_seconds, args.max_wall_seconds, args.max_rss_mib), (300, 960, 2048))

    def test_short_controls_cannot_qualify_without_smoke(self):
        for option, value in (('--fixed-history-seconds', '359'), ('--recovery-seconds', '179'),
                              ('--ui-cycles', '29'), ('--storage-cycles', '599'), ('--native-every', '6')):
            with self.subTest(option=option), self.assertRaises(SystemExit):
                self.parse('--workload-profile', 'fixed-history-recovery', option, value)

    def test_tiny_diagnostic_requires_explicit_smoke(self):
        args = self.parse('--workload-profile', 'fixed-history-recovery', '--smoke', '--ui-cycles', '1',
                          '--storage-cycles', '10', '--native-every', '1', '--fixed-history-seconds', '2',
                          '--recovery-seconds', '2', '--seed-max-seconds', '60', '--max-wall-seconds', '180')
        self.assertTrue(args.smoke)
        self.assertEqual(args.duration_seconds, 0)

    def test_paced_profile_preserves_original_cadence_and_separate_bounds(self):
        args = self.parse('--workload-profile', 'paced-history-recovery', '--memory-profile', 'hosted-2gib')
        self.assertEqual((args.duration_seconds, args.seed_max_seconds, args.max_wall_seconds), (720, 900, 1500))
        self.assertEqual((args.ui_cycles, args.storage_cycles, args.native_every), (30, 600, 5))
        self.assertEqual((args.fixed_history_seconds, args.recovery_seconds, args.max_rss_mib), (360, 180, 2048))
        fast = self.parse('--workload-profile', 'fixed-history-recovery')
        self.assertEqual((fast.duration_seconds, fast.seed_max_seconds, fast.max_wall_seconds), (0, 300, 960))
        with self.assertRaises(SystemExit):
            self.parse('--workload-profile', 'fixed-history-recovery', '--max-wall-seconds', '1500')

    def test_paced_tiny_qualification_requires_explicit_smoke(self):
        flags = ('--workload-profile', 'paced-history-recovery', '--duration-seconds', '2',
                 '--ui-cycles', '1', '--storage-cycles', '10', '--native-every', '1',
                 '--fixed-history-seconds', '2', '--recovery-seconds', '2', '--seed-max-seconds', '60',
                 '--max-wall-seconds', '180')
        with self.assertRaises(SystemExit):
            self.parse(*flags)
        args = self.parse(*flags, '--smoke')
        self.assertTrue(args.smoke)
        self.assertEqual((args.duration_seconds, args.max_wall_seconds), (2, 180))

    def test_paced_profile_rejects_shortened_full_cadence_and_expanded_budgets(self):
        for option, value in (('--duration-seconds', '0'), ('--duration-seconds', '719'),
                              ('--duration-seconds', '721'), ('--duration-seconds', 'nan'),
                              ('--seed-max-seconds', '901'), ('--seed-max-seconds', '719'),
                              ('--max-wall-seconds', '1501'), ('--max-wall-seconds', '1469'),
                              ('--fixed-history-seconds', '1000'), ('--fixed-history-seconds', '359'),
                              ('--recovery-seconds', '179'), ('--storage-cycles', '599'),
                              ('--max-rss-mib', '2049')):
            with self.subTest(option=option, value=value), self.assertRaises(SystemExit):
                self.parse('--workload-profile', 'paced-history-recovery', '--memory-profile', 'hosted-2gib', option, value)
        with self.assertRaises(SystemExit):
            self.parse('--workload-profile', 'paced-history-recovery', '--smoke', '--duration-seconds', '0')

    def test_diagnostic_cannot_relax_resource_or_time_bounds(self):
        for option, value in (('--max-rss-mib', '2049'), ('--max-wall-seconds', '961'),
                              ('--max-wall-seconds', '800'), ('--seed-max-seconds', '301'),
                              ('--fixed-history-seconds', 'nan'), ('--recovery-seconds', '0'),
                              ('--duration-seconds', '720'), ('--fixed-history-seconds', '600')):
            with self.subTest(option=option, value=value), self.assertRaises(SystemExit):
                self.parse('--workload-profile', 'fixed-history-recovery', '--memory-profile', 'hosted-2gib', option, value)

    def test_diagnostic_options_cannot_modify_mutation_profile(self):
        with self.assertRaises(SystemExit):
            self.parse('--fixed-history-seconds', '360')

    def test_durable_checks_reject_count_hash_and_pointer_changes(self):
        before = {'ui': {'supplyStudies': {'count': 62, 'sha256': 'studies'},
                         'pointers': {'count': 32, 'sha256': 'pointers'},
                         'audit': {'count': 84, 'sha256': 'audit'}}}
        BrowserSoakSuite.assert_fixed_history(before, json.loads(json.dumps(before)), 'unchanged')
        for store, field_name, value in (('supplyStudies', 'count', 63), ('supplyStudies', 'sha256', 'mutated'),
                                         ('pointers', 'sha256', 'changed-revision'), ('audit', 'count', 85)):
            changed = json.loads(json.dumps(before))
            changed['ui'][store][field_name] = value
            with self.subTest(store=store, field=field_name), self.assertRaisesRegex(AssertionError, 'DURABLE_HISTORY_CHANGED'):
                BrowserSoakSuite.assert_fixed_history(before, changed, 'control')

    def test_missing_after_enumeration_aborts_controlled_upgrade_event(self):
        """Controlled request events, explicitly not native-IDB/browser evidence."""
        import ast
        import inspect
        import textwrap
        method = ast.parse(textwrap.dedent(inspect.getsource(BrowserSoakSuite.durable_fingerprint)))
        expression = next(node.args[0].value for node in ast.walk(method) if isinstance(node, ast.Call)
                          and isinstance(node.func, ast.Attribute) and node.func.attr == 'evaluate')
        fixture = '''
          const names = ['component-test-only', 'ui-test-only'];
          let opens = 0, aborts = 0, closes = 0, transactions = 0;
          globalThis.indexedDB = {
            databases: async () => names.map(name => ({name})),
            open: name => {
              opens++;
              const request = {result: {close() { closes++; }, transaction() { transactions++; }},
                transaction: {abort() { aborts++; queueMicrotask(() => request.onerror()); }}};
              queueMicrotask(() => {
                if (typeof request.onupgradeneeded !== 'function') throw Error('MISSING_UPGRADE_ABORT_GUARD');
                request.onupgradeneeded({target: request});
              });
              return request;
            }
          };
          fingerprint(names).then(() => { throw Error('MISSING_DATABASE_FALSE_SUCCESS'); }, error => {
            if (error.message !== 'DIAGNOSTIC_DATABASE_DISAPPEARED' || opens !== 1 || aborts !== 1 || closes !== 1 || transactions !== 0)
              throw Error(JSON.stringify({message: error.message, opens, aborts, closes, transactions}));
            console.log('PASS_CONTROLLED_REQUEST_EVENT_NOT_NATIVE_IDB');
          }).catch(error => { console.error(error); process.exitCode = 1; });
        '''
        checked = subprocess.run(['node', '-e', 'const fingerprint = ' + expression + ';\n' + fixture],
                                 capture_output=True, text=True, timeout=10)
        self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)
        self.assertIn('PASS_CONTROLLED_REQUEST_EVENT_NOT_NATIVE_IDB', checked.stdout)

    def test_final_qualification_follows_terminal_status(self):
        expected = {'PASS_DIAGNOSTIC': 'PASS_DIAGNOSTIC', 'PASS_DIAGNOSTIC_SMOKE': 'NOT_QUALIFIED_SHORT_RUN',
                    'FAIL': 'FAIL', 'BLOCKED_ENVIRONMENT': 'BLOCKED_ENVIRONMENT', 'RUNNING': 'RUNNING'}
        for profile, status, qualification in ((profile, status, value) for profile in DIAGNOSTIC_PROFILES
                                                for status, value in expected.items()):
            with self.subTest(profile=profile, status=status):
                result = {'workloadProfile': profile, 'status': status,
                          'diagnosticQualification': 'PASS_DIAGNOSTIC', 'soakQualification': 'FAIL_WATCHDOG_OR_INTERRUPTION'}
                finalize_diagnostic_qualification(result)
                self.assertEqual(result['diagnosticQualification'], qualification)
                self.assertEqual(result['soakQualification'], 'NOT_MUTATION_SOAK')
        original = {'workloadProfile': 'mutation-soak', 'status': 'FAIL', 'soakQualification': 'FAIL_WATCHDOG_OR_INTERRUPTION'}
        unchanged = dict(original)
        finalize_diagnostic_qualification(original)
        self.assertEqual(original, unchanged)

    def test_worker_write_clears_stale_diagnostic_pass(self):
        with tempfile.TemporaryDirectory(prefix='browser-final-status-') as root:
            suite = BrowserSoakSuite.__new__(BrowserSoakSuite)
            suite.evidence = Path(root)
            suite.scrub = lambda value: value
            suite.result = {'workloadProfile': 'fixed-history-recovery', 'status': 'FAIL',
                            'diagnosticQualification': 'PASS_DIAGNOSTIC', 'soakQualification': 'PASS'}
            suite.write()
            result = json.loads((suite.evidence / 'summary.json').read_text())
            self.assertEqual((result['status'], result['diagnosticQualification'], result['soakQualification']),
                             ('FAIL', 'FAIL', 'NOT_MUTATION_SOAK'))

    def test_supervisor_diagnostic_failure_and_blocked_paths(self):
        import contextlib
        import io
        from types import SimpleNamespace
        from unittest.mock import patch
        cases = (
            ('FAIL', 1, None, 'FAIL'),
            ('PASS_DIAGNOSTIC', 1, 'SOAK_WALL_CLOCK_DEADLINE_EXCEEDED', 'FAIL'),
            ('RUNNING', 1, 'RESOURCE_UPPER_BOUND_EXCEEDED', 'BLOCKED_ENVIRONMENT'),
            ('BLOCKED_ENVIRONMENT', 78, None, 'BLOCKED_ENVIRONMENT'),
            (None, 1, None, 'FAIL'),
        )
        for profile, initial_status, code, reason, expected_status in (
                (profile, *case) for profile in DIAGNOSTIC_PROFILES for case in cases):
            with self.subTest(profile=profile, initial_status=initial_status, reason=reason), tempfile.TemporaryDirectory(prefix='browser-supervisor-status-') as root:
                evidence, runtime = Path(root) / 'evidence', Path(root) / 'runtime'
                evidence.mkdir(); runtime.mkdir()
                if initial_status is not None:
                    (evidence / 'summary.json').write_text(json.dumps({'status': initial_status,
                        'workloadProfile': profile, 'diagnosticQualification': 'PASS_DIAGNOSTIC',
                        'soakQualification': 'PASS', 'soakWindowStarted': False, 'stages': {}}))
                failure = {'reason': reason, 'ownedServiceCleanup': {'status': 'PASS'}} if reason else None
                cleanup = {'status': 'PASS', 'remainingLiveProcesses': [], 'signals': []}
                args = SimpleNamespace(workload_profile=profile, evidence_dir=evidence,
                                       max_wall_seconds=DIAGNOSTIC_PROFILES[profile]['wallCapSeconds'])
                with patch(__name__ + '.tempfile.mkdtemp', return_value=str(runtime)), \
                     patch(__name__ + '.subprocess.Popen', return_value=SimpleNamespace(pid=999999)), \
                     patch(__name__ + '.supervise_process', return_value=(code, failure, cleanup)), \
                     contextlib.redirect_stdout(io.StringIO()):
                    returned = supervised_run(args, [])
                result = json.loads((evidence / 'summary.json').read_text())
                self.assertEqual(result['status'], expected_status)
                self.assertEqual(result['diagnosticQualification'], expected_status)
                self.assertEqual(result['soakQualification'], 'NOT_MUTATION_SOAK')
                self.assertEqual(returned, 78 if expected_status == 'BLOCKED_ENVIRONMENT' else 1)


def main():
    args = parse_args()
    if os.environ.get('STCT_SOAK_WORKER') == '1':
        return BrowserSoakSuite(args.evidence_dir, args).run()
    return supervised_run(args, sys.argv[1:])


def supervised_run(args, argv):
    """The supervisor never starts a browser or invokes a Playwright API itself."""
    runtime = Path(tempfile.mkdtemp(prefix='stct-browser-soak-owned-'))
    env = {**os.environ, 'STCT_SOAK_WORKER': '1', 'STCT_SOAK_OWNED_RUNTIME': str(runtime),
           'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUNBUFFERED': '1',
           'STCT_SOAK_SUPERVISOR_PID': str(os.getpid()),
           'STCT_SOAK_SUPERVISOR_START_TICKS': str(process_table()[os.getpid()]['startTicks'])}
    child = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), *argv],
                             cwd=ROOT, env=env, start_new_session=True)
    def stop_owned_services():
        run_dir = runtime / 'launcher'
        if not (run_dir / 'trial.json').exists():
            return {'status': 'NO_OWNERSHIP_RECEIPT', 'foreignProcessesTouched': False}
        stopped = subprocess.run([sys.executable, str(ROOT / 'scripts/local_trial.py'), 'stop'],
            cwd=ROOT, env={**env, 'STCT_RUN_DIR': str(run_dir)}, capture_output=True, text=True, timeout=40)
        # Preserve the launcher's own identity checks, without using a browser connection.
        (args.evidence_dir / 'supervisor-launcher-stop.log').write_text(
            (stopped.stdout + stopped.stderr).replace(str(runtime), '<runtime>').replace(str(ROOT), '<checkout>'))
        return {'status': 'PASS' if stopped.returncode == 0 and not (run_dir / 'trial.json').exists() else 'FAIL',
                'returnCode': stopped.returncode}
    code, failure, process_cleanup = supervise_process(child, args.max_wall_seconds,
        args.evidence_dir / 'abort-request.json', stop_owned_services,
        owned_roots_path=runtime / 'owned-processes.json', run_token=runtime.name)
    if failure:
        summary_path = args.evidence_dir / 'summary.json'
        try:
            summary = json.loads(summary_path.read_text())
        except (OSError, ValueError):
            summary = {'status': 'FAIL', 'source': source_identity(ROOT), 'stages': {}}
        summary.setdefault('workloadProfile', args.workload_profile)
        baseline_budget = failure.get('reason') in ('RESOURCE_UPPER_BOUND_EXCEEDED', 'RESOURCE_OBSERVATION_FAILED') \
                          and not summary.get('soakWindowStarted', False)
        cleanup_ok = failure.get('ownedServiceCleanup', {}).get('status') in ('PASS', 'NO_OWNERSHIP_RECEIPT') and process_cleanup['status'] == 'PASS'
        summary['status'] = 'BLOCKED_ENVIRONMENT' if baseline_budget and cleanup_ok else 'FAIL'
        failure['runToken'] = runtime.name
        summary['supervisor'] = failure
        summary['ownedProcessCleanup'] = process_cleanup
        if summary.get('workloadProfile') not in DIAGNOSTIC_PROFILES:
            summary['soakQualification'] = 'NOT_RUN_RESOURCE_BASELINE_BLOCKED' if baseline_budget else 'FAIL_WATCHDOG_OR_INTERRUPTION'
        summary.setdefault('stages', {})['SUPERVISOR'] = {'status': summary['status'], 'reason': failure['reason']}
        if not cleanup_ok:
            summary['stages']['CLEANUP'] = {'status': 'FAIL', 'details': failure['ownedServiceCleanup']}
        profile = runtime / 'browser-profile'
        if profile.exists():
            destination = args.evidence_dir / 'failed-synthetic-browser-profile'
            if not destination.exists():
                shutil.move(str(profile), str(destination))
                summary['reproductionProfileRetained'] = True
                summary['profileMayRequireCrashRecovery'] = True
        for name in ('web.log', 'optimizer.log'):
            source = runtime / 'launcher' / name
            if source.exists():
                (args.evidence_dir / ('supervisor-' + name)).write_text(
                    source.read_text(errors='replace').replace(str(runtime), '<runtime>').replace(str(ROOT), '<checkout>'))
        finalize_diagnostic_qualification(summary)
        summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'status': summary['status'], 'supervisor': failure}), flush=True)
        return 78 if summary['status'] == 'BLOCKED_ENVIRONMENT' else 1
    summary_path = args.evidence_dir / 'summary.json'
    try:
        summary = json.loads(summary_path.read_text())
        summary.setdefault('workloadProfile', args.workload_profile)
        summary['ownedProcessCleanup'] = process_cleanup
        if args.workload_profile in DIAGNOSTIC_PROFILES and code != 0 and summary.get('status') not in ('FAIL', 'BLOCKED_ENVIRONMENT'):
            summary['status'] = 'FAIL'
        finalize_diagnostic_qualification(summary)
        summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    except (OSError, ValueError):
        (args.evidence_dir / 'supervisor-process-cleanup.json').write_text(json.dumps(process_cleanup, indent=2) + '\n')
        if args.workload_profile in DIAGNOSTIC_PROFILES:
            summary = {'status': 'FAIL', 'workloadProfile': args.workload_profile,
                       'error': 'DIAGNOSTIC_SUMMARY_MISSING_OR_INVALID', 'ownedProcessCleanup': process_cleanup}
            finalize_diagnostic_qualification(summary)
            summary_path.write_text(json.dumps(summary, indent=2) + '\n')
            code = 1
    if runtime.exists() and not any(runtime.iterdir()):
        runtime.rmdir()
    return code


if __name__ == '__main__':
    sys.exit(main())
