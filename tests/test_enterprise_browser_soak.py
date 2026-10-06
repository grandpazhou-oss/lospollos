#!/usr/bin/env python3
"""Bounded 12-minute synthetic public-UI + separately labeled IndexedDB soak.

Uses existing Python Playwright, Chromium, Node and OR-Tools; installs nothing.
All evidence and the fresh persistent browser profile are outside the checkout.
The default qualification requires >=600 seconds, >=20 UI and >=300 component
cycles. --smoke explicitly exercises the harness without claiming soak coverage.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import time
import uuid
from urllib.parse import urlsplit

from enterprise_browser_soak_support import EvidenceLog, ResourceMonitor, source_identity
from test_enterprise_storage_native import MODULES
from test_enterprise_synthetic_full_ui import (
    ROOT, TOTAL, action, field, login, near, reveal, state, step, upload, wait_state,
)
from test_enterprise_ui_faults import FaultSuite


class BrowserSoakSuite(FaultSuite):
    def __init__(self, evidence, args):
        super().__init__(evidence)
        self.args = args
        self.events = EvidenceLog(evidence / 'cycles.jsonl', self.scrub)
        self.monitor = ResourceMonitor(EvidenceLog(evidence / 'resources.jsonl', self.scrub),
                                       args.max_rss_mib, args.max_fds, args.sample_seconds)
        self.profile = self.runtime / 'browser-profile'
        self.secondary = self.component = None
        self.current_cycle = 0
        self.soak_started = None
        self.baseline_elapsed = 0
        self.previous_sigterm_handler = None
        self.activity_seconds = {}
        self.activity_buckets = {}
        self.controlled_interval_seconds = 0.0
        self.result.update(suite='ENTERPRISE_BROWSER_STORAGE_SOAK', source=source_identity(ROOT),
            method='BOUNDED_PUBLIC_UI_SOAK_PLUS_SEPARATE_NATIVE_INDEXEDDB_COMPONENT',
            requested={'durationSeconds': args.duration_seconds, 'uiCycles': args.ui_cycles,
                       'componentCycles': args.storage_cycles, 'nativeEveryUiCycles': args.native_every},
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
                'COMPONENT_SETUP', 'INITIAL_NATIVE_RETRY', 'UI_SOAK', 'COMPONENT_SOAK',
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

    def write(self):
        if hasattr(self, 'activity_seconds'):
            self.result['activityTiming'] = {
                'operationSecondsByKind': {k: round(v, 3) for k, v in self.activity_seconds.items()},
                'totalOperationSeconds': round(sum(self.activity_seconds.values()), 3),
                'controlledIntervalSeconds': round(self.controlled_interval_seconds, 3),
                'maximumRequestedCadenceWaitSeconds': .25,
                'operationCountsByMinute': self.activity_buckets,
                'meaning': 'Measured UI/component/native operations include normal response waits. '
                           'Explicit cadence intervals are separate, not pressure activity.'}
            if self.soak_started is not None and not self.result.get('observationWindowEnded'):
                self.result['observedSoakSeconds'] = round(time.monotonic() - self.soak_started, 3)
        super().write()

    def begin(self, stage):
        self.guard()
        super().begin(stage)
        self.events.emit('stage_start', stage=stage, uiCycle=self.current_cycle)

    def passed(self, **details):
        self.guard()
        super().passed(**details)
        self.events.emit('stage_pass', stage=self.stage, uiCycle=self.current_cycle, details=details)

    def guard(self):
        if self.monitor.violation:
            raise AssertionError(json.dumps(self.monitor.violation))
        if self.context:
            tabs = sum(len(context.pages) for context in self.browser.contexts) if self.browser else len(self.context.pages)
            assert tabs <= 3, f'TAB_LIMIT_EXCEEDED: {tabs}'
        assert not self.result['pageErrors'], self.result['pageErrors']
        # A minimum operating window is requested, with a finite overrun allowance
        # for the last bounded UI transaction, not an unbounded hang.
        if self.soak_started and time.monotonic() - self.soak_started > self.args.duration_seconds + 180:
            raise AssertionError('SOAK_OPERATION_DEADLINE_EXCEEDED')

    def open_browser(self, playwright):
        self.begin('BROWSER')
        self.profile.mkdir()
        executable = os.environ.get('STCT_CHROMIUM') or os.environ.get('STCT_BROWSER')
        try:
            self.context = playwright.chromium.launch_persistent_context(
                user_data_dir=str(self.profile), headless=True, executable_path=executable,
                args=['--disable-webgl'], accept_downloads=True,
                viewport={'width': 1440, 'height': 950}, reduced_motion='reduce', service_workers='block')
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
        # The persistent-context initial blank tab is ours; close it before creating
        # the three explicitly instrumented pages, never touch any existing profile.
        for page in self.context.pages:
            page.close()
        self.page = self.new_page(self.context)
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
        result = self.component.evaluate('(name) => enterpriseStorageSoak.init(name)',
                                         'enterprise-soak-component-' + uuid.uuid4().hex)
        self.result['componentBaseline'] = result
        self.passed(**result)

    def edit_capacity(self, page, value, name):
        step(page, 1)
        control = page.locator('[data-supply-capacity]').first
        reveal(control)
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
        recovery = self.conflict_controls(secondary)
        rejected = state(secondary)
        assert rejected['savedPointer'] == old_pointer, 'Stale UI reported a false successful save'
        assert rejected['study']['inputHash'] == stale['study']['inputHash']
        assert rejected['scenario'] == stale['scenario']
        text = self.download('package-export', f'cycle-{number:03d}-retained.package.json', page=secondary,
                             control=recovery.locator('[data-supply-action="package-export"]'))
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
        reveal(control)
        upload(control, f'synthetic-cycle-{number}.json', text.encode(), 'application/json')
        imported = wait_state(secondary, lambda s: s.get('savedPointer') is None and
            (s.get('study') or {}).get('inputHash') == stale['study']['inputHash'])
        assert imported['scenario'] == stale['scenario'] and imported.get('snapshot') is None
        reopened_branch = self.reopen_public(secondary, branch_pointer['id'])
        assert reopened_branch['savedPointer'] == branch_pointer
        assert reopened_branch['study']['inputHash'] == branch['study']['inputHash']
        assert reopened_branch['scenario'] == stale['scenario']
        history = self.public_history(primary, self.master_id)
        assert old_hash in history and winner['study']['inputHash'] in history
        restored = self.reopen_public(primary, self.master_id)
        assert restored['savedPointer'] == winner['savedPointer'], 'Conflict/branch/import overwrote original'
        primary.reload(wait_until='load')
        button = primary.locator('#loginForm .login-btn')
        if button.is_visible():
            button.click()
        primary.locator('[data-design-route="/design/supply-chain-study"]').wait_for()
        restored = self.reopen_public(primary, self.master_id)
        assert restored['savedPointer'] == winner['savedPointer']
        assert restored['study']['inputHash'] == winner['study']['inputHash']
        assert restored['scenario'] == winner['scenario']
        assert restored.get('snapshot') is None
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

    def measured(self, kind, operation):
        start = time.monotonic()
        value = operation()
        elapsed = time.monotonic() - start
        self.activity_seconds[kind] = self.activity_seconds.get(kind, 0) + elapsed
        bucket = int(max(0, start - self.soak_started) // 60)
        counts = self.activity_buckets.setdefault(str(bucket), {})
        counts[kind] = counts.get(kind, 0) + 1
        self.events.emit('operation_timing', operation=kind, seconds=round(elapsed, 4), minuteBucket=bucket)
        return value

    def durability_probe(self):
        before = state(self.page)
        pointer = before['savedPointer']
        after = self.reopen_public(self.page, self.master_id)
        assert after['savedPointer'] == pointer, 'Read-only UI reopen changed the durable pointer'
        assert after['study']['inputHash'] == before['study']['inputHash']
        assert after['scenario'] == before['scenario'] and after.get('snapshot') == before.get('snapshot')
        checked = self.component.evaluate('() => enterpriseStorageSoak.finish()')
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
                lambda: self.component.evaluate('() => enterpriseStorageSoak.cycle()'))
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
        self.busy()
        self.result['coverage']['controlledBusyRejections'] += 1
        current = self.native_retry('INITIAL_NATIVE_RETRY' if initial else 'PERIODIC_NATIVE_RETRY')
        self.result['coverage']['genuineNativeRetries'] += 1
        self.events.emit('genuine_native_retry', jobId=current['job']['jobId'],
            snapshotHash=current['snapshot']['snapshotHash'],
            pointerRevision=current['savedPointer']['revision'], uiCycle=self.current_cycle,
            method='UNALTERED_NATIVE_RESPONSE_WITH_INDEPENDENT_HAVERSINE_ORACLE')
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

    def final_invariants(self):
        self.begin('FINAL_INVARIANTS')
        component = self.component.evaluate('() => enterpriseStorageSoak.finish()')
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
        expected_errors = [message for message in self.result['consoleErrors']
                           if re.search(r'(?:status of 429|429 \(Too Many Requests\))', message)]
        unexpected = [message for message in self.result['consoleErrors'] if message not in expected_errors]
        assert not unexpected, unexpected
        self.result['expectedControlledHttpConsoleErrors'] = expected_errors
        self.result['sourceAfter'] = source_identity(ROOT)
        assert self.result['sourceAfter'] == self.result['source'], 'SOURCE_CHANGED_DURING_RUN'
        self.result['storageFinal'] = self.storage_observation()
        elapsed = time.monotonic() - self.soak_started
        assert elapsed >= self.args.duration_seconds, 'Requested observation window was shortened'
        qualified = elapsed >= 600 and coverage['uiCycles'] >= 20 and coverage['componentCycles'] >= 300
        self.result['activityTiming'] = {
            'operationSecondsByKind': {k: round(v, 3) for k, v in self.activity_seconds.items()},
            'totalOperationSeconds': round(sum(self.activity_seconds.values()), 3),
            'controlledIntervalSeconds': round(self.controlled_interval_seconds, 3),
            'maximumRequestedCadenceWaitSeconds': .25,
            'operationCountsByMinute': self.activity_buckets,
            'meaning': 'Measured UI/component/native operations include normal response waits. '
                       'Explicit cadence intervals are separate, not pressure activity.'}
        for minute in range(int(self.args.duration_seconds // 60)):
            assert self.activity_buckets.get(str(minute)), f'No actual operation in minute {minute}'
        self.result['observedSoakSeconds'] = round(elapsed, 3)
        self.result['observationWindowEnded'] = True
        self.result['soakQualification'] = 'PASS' if qualified and not self.args.smoke else 'NOT_QUALIFIED_SHORT_RUN'
        if not self.args.smoke:
            assert qualified
        self.result['resourceTrend'] = self.monitor.trend(self.baseline_elapsed)
        self.page.screenshot(path=str(self.evidence / 'final-ui.png'), full_page=True)
        self.passed(coverage=coverage, observedSeconds=round(elapsed, 3), soakQualified=qualified and not self.args.smoke,
                    componentAndPublicUiEvidenceSeparate=True, evidenceOfNoLeak='NOT_CLAIMED_FROM_FINITE_WINDOW')

    def record_failure(self, exc):
        if not self.monitor.violation:
            super().record_failure(exc)
            return
        # Do not allocate a full-page screenshot or huge application snapshot
        # after a resource-limit interrupt; retain the synthetic profile instead.
        blocked = self.soak_started is None
        self.result['status'] = 'BLOCKED_ENVIRONMENT' if blocked else 'FAIL'
        self.result['error'] = self.scrub(str(exc))
        self.result['stages'][self.stage] = {'status': self.result['status'],
            'reason': 'ISOLATED_BASELINE_RESOURCE_BUDGET_OR_OBSERVATION_BLOCKED' if blocked else
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
        if self.component and not self.component.is_closed():
            try:
                self.component.evaluate('() => window.enterpriseStorageSoak?.close()')
            except Exception:
                pass
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
            raise RuntimeError(f'SOAK_INTERRUPTED_SIGNAL_{signum}: preserve evidence and clean only owned services')
        self.previous_sigterm_handler = signal.signal(signal.SIGTERM, terminated)
        try:
            self.monitor.start()
            self.launch()
            for kind in ('web', 'optimizer'):
                self.monitor.add_root(self.record[kind]['pid'])
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
                    baseline = self.monitor.sample()
                    self.baseline_elapsed = baseline['elapsedSeconds']
                    self.result['resourceBaseline'] = baseline
                    self.page.screenshot(path=str(self.evidence / 'baseline-ui.png'), full_page=True)
                    self.soak_started = time.monotonic()
                    self.events.emit('soak_window_start', coverage=self.result['coverage'])
                    for number in range(1, self.args.ui_cycles + 1):
                        self.current_cycle = number
                        scheduled = self.soak_started + self.args.duration_seconds * (number - 1) / self.args.ui_cycles
                        self.operate_until(scheduled)
                        self.measured('complete_public_ui_cycle', lambda: self.cycle_ui(number))
                        target = math.floor(self.args.storage_cycles * number / self.args.ui_cycles)
                        window_end = self.soak_started + self.args.duration_seconds * number / self.args.ui_cycles
                        self.storage_batch(target - self.result['coverage']['componentCycles'], window_end)
                        if number % self.args.native_every == 0:
                            self.measured('controlled_busy_and_native_retry', self.native_round)
                        self.events.emit('ui_cycle_checkpoint', uiCycle=number, coverage=self.result['coverage'],
                            storage=self.storage_observation(), resources=self.monitor.trend(self.baseline_elapsed))
                        if number in {1, math.ceil(self.args.ui_cycles / 2), self.args.ui_cycles}:
                            self.page.screenshot(path=str(self.evidence / f'checkpoint-{number:03d}.png'), full_page=True)
                    # Extra public reopens and component history checks continue
                    # actual operations through the end, without growing history.
                    self.operate_until(self.soak_started + self.args.duration_seconds)
                    self.final_invariants()
                    self.result['status'] = 'PASS'
                except BaseException as exc:
                    if isinstance(exc, (KeyboardInterrupt, SystemExit)) and self.monitor.violation:
                        exc = AssertionError(json.dumps(self.monitor.violation))
                    self.record_failure(exc)
                    self.events.emit('failure', stage=self.stage, uiCycle=self.current_cycle,
                                     error=str(exc), coverage=self.result['coverage'])
                finally:
                    self.cleanup()
        except BaseException as exc:
            if isinstance(exc, (KeyboardInterrupt, SystemExit)) and self.monitor.violation:
                exc = AssertionError(json.dumps(self.monitor.violation))
            self.record_failure(exc)
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
        return 0 if self.result['status'] == 'PASS' else 78 if self.result['status'] == 'BLOCKED_ENVIRONMENT' else 1


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    parser.add_argument('--duration-seconds', type=float, default=720)
    parser.add_argument('--ui-cycles', type=int, default=30)
    parser.add_argument('--storage-cycles', type=int, default=600)
    parser.add_argument('--native-every', type=int, default=5)
    parser.add_argument('--sample-seconds', type=float, default=1)
    parser.add_argument('--max-rss-mib', type=int, default=1024)
    parser.add_argument('--max-fds', type=int, default=1024)
    parser.add_argument('--smoke', action='store_true', help='Allow short harness check; never qualifies as soak evidence')
    args = parser.parse_args(argv)
    if not 1 <= args.ui_cycles <= 50 or not 1 <= args.storage_cycles <= 1000:
        parser.error('Bounded repetitions require 1..50 UI cycles and 1..1000 component cycles')
    if not math.isfinite(args.duration_seconds) or not 0 <= args.duration_seconds <= 900:
        parser.error('Duration must be a finite value from 0 to 900 seconds')
    if not args.smoke and (args.duration_seconds < 600 or args.ui_cycles < 20 or args.storage_cycles < 300):
        parser.error('Soak requires >=600 seconds, >=20 UI cycles, >=300 components; use --smoke for a short check')
    if not 1 <= args.native_every <= args.ui_cycles:
        parser.error('native-every must be within 1..ui-cycles')
    if not 1 <= args.max_rss_mib <= 1024 or not 1 <= args.max_fds <= 1024:
        parser.error('Resource limits cannot exceed 1024 MiB aggregate RSS / 1024 aggregate fds')
    if not math.isfinite(args.sample_seconds) or not .25 <= args.sample_seconds <= 5:
        parser.error('Resource sampling must be every .25..5 seconds')
    evidence = args.evidence_dir.expanduser().resolve()
    if evidence == ROOT or ROOT in evidence.parents:
        parser.error('Evidence must be outside the checkout')
    evidence.mkdir(parents=True, exist_ok=True)
    if any(evidence.iterdir()):
        parser.error('Use a fresh empty evidence directory; previous evidence is never overwritten')
    args.evidence_dir = evidence
    return args


def main():
    args = parse_args()
    return BrowserSoakSuite(args.evidence_dir, args).run()


if __name__ == '__main__':
    sys.exit(main())
