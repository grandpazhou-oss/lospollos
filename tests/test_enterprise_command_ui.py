#!/usr/bin/env python3
"""Visible COMMAND integration with real native /optimize and labeled network controls.

Requires existing OR-Tools, Python Playwright and Chromium. Installs nothing.
The production launcher owns isolated services. All browser writes use public UI;
page evaluation only observes application state. No customer or external data.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import sys
import time

from test_enterprise_synthetic_full_ui import Suite, ROOT, login, route_to, upload

DATE = '2026-10-01'
PLANNING = '() => window.STCTPlanning?.state'
STAGES = ('DEPENDENCIES', 'LAUNCHER', 'BROWSER', 'LOCAL_RECOVERY_UI',
          'FULL_REOPTIMIZATION_UI_BOUNDARY', 'ORIGINAL_DISPATCH_IMPORT',
          'CONTROLLED_HTTP_429_GUARD', 'NATIVE_DISPATCH_GENERATE',
          'MANUAL_ADJUST_UNDO_APPLY', 'MULTI_DAY_CANCEL_LATE_NATIVE_RESPONSE', 'CLEANUP')


def fixture():
    """New invented, two-date input; one capacious vehicle keeps edit cases feasible."""
    raw = {
        'meta': {'id': 'COMMAND-UI-SYNTHETIC', 'synthetic': True,
                 'dataClassification': 'SYNTHETIC_TEST', 'notice': 'Invented test data only'},
        'depot': {'id': 'DEPOT-SYNTHETIC', 'code': 'DEPOT-SYNTHETIC', 'name': 'Synthetic test depot',
                  'address': 'Invented address', 'lon': 120.0, 'lat': 30.0},
        'vehicles': [{'id': 'VEH-SYNTHETIC', 'vehicleId': 'VEH-SYNTHETIC',
                      'name': 'Synthetic test van', 'vehicleName': 'Synthetic test van', 'type': 'van',
                      'maxVolume': 20, 'maxWeight': 100, 'start': '08:00', 'end': '18:00',
                      'fixedCost': 10, 'perKmCost': 1, 'perMinuteCost': .1,
                      'perStopCost': 1, 'emissionFactor': .2, 'enabled': True}],
        'orders': [],
        'constraints': {'workStart': '08:00', 'workEnd': '18:00', 'maxWaitingMinutes': 90,
                        'maxStops': 20, 'maxRouteMinutes': 600, 'roadDistanceFactor': 1.35,
                        'averageSpeedKmh': 30, 'defaultServiceMinutes': 1},
    }
    for day, count in ((DATE, 6), ('2026-10-02', 2)):
        for number in range(1, count + 1):
            ident = f'SYN-{day}-{number}'
            raw['orders'].append({'id': ident, 'code': ident, 'name': f'Synthetic stop {number}',
                'address': 'Invented address', 'date': day, 'lon': 120 + number * .002,
                'lat': 30 + (number % 2) * .002, 'count': 1, 'volume': 1, 'weight': 1,
                'serviceMin': 1, 'twStart': '08:00', 'twEnd': '18:00',
                'priority': 'normal', 'priorityWeight': 1, 'prioritySource': 'mapped',
                'orderType': 'SYNTHETIC_TEST', 'requiredVehicleType': ''})
    return {'__rawUpload': True, 'raw': raw}


def planning(page):
    return page.evaluate(PLANNING)


def current_plan(value):
    if (value.get('manual') or {}).get('active'):
        return value['manual']['plan']
    return next((p for p in value.get('candidates', [])
                 if p['planId'] == value.get('selectedPlanId')), None)


def applied_identity(page):
    return page.evaluate('''() => {
      const d=window.STCTCore.getData();
      return {planHash:d.planHash || null, inputHash:d.inputHash || null,
              routes:d.routes, manualAdjustmentAudit:d.meta?.manualAdjustmentAudit || [],
              verification:d.verification?.status || null};
    }''')


def last_action(page):
    return page.evaluate('() => window.STCTPlatformV19.instance.commandAdapter.diagnostics().lastDomainAction')


def plan_hash_in_ribbon(page):
    return page.locator('.command-context-ribbon dt').filter(has_text=re.compile('^PLAN$')).locator(
        'xpath=following-sibling::dd[1]').text_content().strip()


class CommandSuite(Suite):
    def __init__(self, evidence):
        super().__init__(evidence)
        self.result.update(method='ACTUAL_COMMAND_UI_NATIVE_DISPATCH_WITH_LABELED_NETWORK_CONTROLS',
            stages={name: {'status': 'NOT_RUN'} for name in STAGES},
            controlledNetworkInterventions=[],
            notCovered=['PHYSICAL_WINDOWS', 'PRIVATE_BUSINESS_DATA', 'REAL_OSRM',
                'FULL_REOPTIMIZATION_NATIVE_UI_NOT_WIRED', 'SINGLE_DAY_HARD_CANCEL_NOT_EXPOSED',
                'MULTI_DAY_CANCEL_IS_NOT_NATIVE_COMPUTATION_TERMINATION', 'HUMAN_VISUAL_APPROVAL'])
        self.held = []

    def wait(self, predicate, timeout=120):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            value = planning(self.page)
            if predicate(value):
                return value
            self.page.wait_for_timeout(50)
        raise AssertionError('COMMAND UI condition timed out; phase=' + str((value or {}).get('phase')))

    def shot(self, name):
        self.page.screenshot(path=str(self.evidence / (name + '.png')), full_page=True)

    def local_recovery(self):
        self.begin('LOCAL_RECOVERY_UI')
        page = self.page
        login(page, self.base)
        page.locator('.platform-home button[data-platform-workspace="COMMAND"]').click()
        route_to(page, '/command/recovery')
        local = page.locator('.command-candidate-list article').filter(has_text='LOCAL_REPAIR')
        local.wait_for(state='visible')
        before = plan_hash_in_ribbon(page)
        preview = local.locator('[data-command-action="recovery-preview"]')
        candidate_hash = preview.get_attribute('data-command-id')
        apply = page.locator(f'[data-command-action="recovery-apply"][data-command-id="{candidate_hash}"]')
        assert apply.is_disabled(), 'Local recovery must require visible preview first'
        preview.click()
        self.wait(lambda _: (last_action(page) or {}).get('type') == 'recovery-preview')
        assert not apply.is_disabled()
        assert plan_hash_in_ribbon(page) == before, 'Preview must not apply a plan'
        self.shot('local-recovery-preview')
        apply.click()
        self.wait(lambda _: (last_action(page) or {}).get('result', {}).get('status') == 'APPLIED')
        assert plan_hash_in_ribbon(page) == candidate_hash
        self.shot('local-recovery-applied')
        page.locator('[data-command-action="recovery-undo"]').click()
        self.wait(lambda _: (last_action(page) or {}).get('result', {}).get('status') == 'UNDONE')
        assert plan_hash_in_ribbon(page) == before
        self.passed(method='BUILT_IN_LOCAL_DETERMINISTIC_OPERATIONS_DEMO_NOT_NATIVE_SOLVER',
                    previewRequired=True, appliedHash=candidate_hash, undoRestoredHash=before)

        self.begin('FULL_REOPTIMIZATION_UI_BOUNDARY')
        health = self.context.request.get(f'http://127.0.0.1:{self.opt_port}/health').json()
        assert health['available'] and health['actualOrtoolsVersion'] == '9.15.6755'
        full = page.locator('[data-command-action="recovery-full"]')
        assert full.is_visible() and full.is_disabled()
        assert 'ORTOOLS_UNAVAILABLE' in page.locator('[data-command-route="/command/recovery"]').inner_text()
        assert not any(r['path'] == '/reoptimize-v16' for r in self.result['nativeRequests'])
        self.shot('full-reoptimization-disabled-boundary')
        self.passed(boundaryVerified=True, backendNativeReady=True,
            nativeUIExecution='NOT_RUN_NOT_EXPOSED',
            reason='COMMAND creates its operational context without fullRecoveryEngine; no public configuration wires it',
            displayedReason='ORTOOLS_UNAVAILABLE', backendVersion=health['actualOrtoolsVersion'])

    def import_dispatch(self):
        self.begin('ORIGINAL_DISPATCH_IMPORT')
        page = self.page
        route_to(page, '/command/dispatch')
        details = page.locator('details.command-native-tools')
        if not details.evaluate('(element) => element.open'):
            details.locator(':scope > summary').click()
        content = json.dumps(fixture(), ensure_ascii=False).encode()
        (self.evidence / 'command-synthetic-input.json').write_bytes(content)
        upload(page.locator('#uploadFile'), 'command-synthetic-input.json', content, 'application/json')
        page.locator('#applyBatchBtn').wait_for(state='visible')
        assert not page.locator('#applyBatchBtn').is_disabled()
        page.locator('#applyBatchBtn').click()
        self.wait(lambda s: s and s.get('phase') == 'raw-awaiting-plan')
        page.locator('#optimizerView.command-native-panel').wait_for(state='visible')
        page.locator('#optimizerDate').select_option(DATE)
        page.locator('#optimizerLimit').select_option('ALL')
        page.locator('#scenarioTimeLimit').select_option('4')
        raw = planning(page)['raw']
        assert len(raw['orders']) == 8 and raw['meta']['synthetic'] is True
        assert {r['date'] for r in raw['orders']} == {DATE, '2026-10-02'}
        self.shot('original-dispatch-imported')
        self.passed(importRoute='COMMAND -> dispatch -> original dispatch tools -> file preview -> apply input',
                    orders=8, dates=2, vehicles=1, classification='NEW_INVENTED_SYNTHETIC_ONLY')

    def busy_guard(self):
        self.begin('CONTROLLED_HTTP_429_GUARD')
        page = self.page
        endpoint = f'http://127.0.0.1:{self.opt_port}/optimize'
        before = applied_identity(page)
        faults = []
        def busy(route):
            faults.append(route.request.method)
            route.fulfill(status=429, content_type='application/json', body=json.dumps({
                'error': {'code': 'SUPPLY_JOB_BUSY', 'message': 'Controlled test: solver admission busy',
                          'details': {'retryable': True}}}))
        page.route(endpoint, busy, times=1)
        try:
            page.locator('#generateScenarioBtn').click()
            failed = self.wait(lambda s: s and s['phase'] == 'error' and not s['generating'])
            assert faults == ['POST'] and failed['candidates'] == []
            assert 'Controlled test: solver admission busy' in failed['staleReason']
            assert applied_identity(page) == before, '429 must not apply or synthesize a successful plan'
            assert page.locator('#applyScenarioBtn').is_disabled()
            self.shot('controlled-busy-no-false-success')
        finally:
            page.unroute(endpoint, busy)
        self.result['controlledNetworkInterventions'].append({'stage': self.stage, 'kind': 'ONE_SYNTHETIC_HTTP_429',
            'path': '/optimize', 'nativeConcurrencyClaim': False})
        self.passed(noCandidates=True, noAppliedMutation=True, heuristicFallback=False,
                    method='CONTROLLED_HTTP_FAULT_NOT_NATIVE_SATURATION')

    def native_dispatch(self):
        self.begin('NATIVE_DISPATCH_GENERATE')
        page = self.page
        request_start = len(self.result['nativeRequests'])
        page.locator('#generateScenarioBtn').click()
        solved = self.wait(lambda s: s and not s['generating'] and s['phase'] in ('candidates', 'candidate-warning'))
        assert len(solved['sourceCandidates']) == 6
        assert solved['candidates'] and solved['engineHealth']['available']
        for plan in solved['sourceCandidates']:
            assert plan['engine'] == 'OR-Tools' and plan['serverHashVerified'] is True
            assert plan['inputHash'] == solved['scenario']['inputHash']
            assert plan['meta']['engineVersion'] == '9.15.6755'
        selected = current_plan(solved)
        assert selected['verification']['status'] == 'PASS'
        assigned = [ident for route in selected['routes'] for ident in route['orderIds']]
        assert len(assigned) == 6 and len(set(assigned)) == 6
        assert set(assigned) == {r['id'] for r in fixture()['raw']['orders'] if r['date'] == DATE}
        assert not selected.get('unassignedOrderIds') and not selected.get('blockedOrderIds')
        native_posts = self.result['nativeRequests'][request_start:]
        assert len(native_posts) == 6 and all(r['path'] == '/optimize' for r in native_posts)
        assert not page.locator('#applyScenarioBtn').is_disabled()
        self.shot('native-dispatch-candidate-pool')
        self.passed(method='REAL_NATIVE_HTTP_OPTIMIZE', sourceCandidates=6,
            deduplicatedCandidates=len(solved['candidates']), inputHash=solved['scenario']['inputHash'],
            selectedPlanHash=selected['planHash'], verifier='PASS', independentlyCountedAssigned=6)
        return selected

    def manual_apply(self, selected):
        self.begin('MANUAL_ADJUST_UNDO_APPLY')
        page = self.page
        page.locator('#startManualBtn').click()
        value = self.wait(lambda s: bool(s.get('manual', {}).get('active')) if s.get('manual') else False)
        base_hash = value['manual']['plan']['planHash']
        assert base_hash == selected['planHash']
        route = next(r for r in value['manual']['plan']['routes'] if len(r['orderIds']) >= 2)
        order = route['orderIds'][1]
        page.locator(f'[data-lock-route="{route["routeId"]}"]').click()
        locked = self.wait(lambda s: route['routeId'] in s['manual']['lockedRouteIds'])
        assert locked['manual']['plan']['planHash'] == base_hash
        page.locator('#manualOrderSelect').select_option(order)
        page.locator('#manualRemoveBtn').click()
        # The visible rejection message is required; a no-op alone is insufficient.
        page.get_by_text('来源路线已锁定。', exact=False).last.wait_for(state='visible')
        assert planning(page)['manual']['plan']['planHash'] == base_hash
        page.locator('#manualUndoBtn').click()
        self.wait(lambda s: not s['manual']['lockedRouteIds'])
        page.locator('#manualOrderSelect').select_option(order)
        page.locator('#manualUpBtn').click()
        changed = self.wait(lambda s: s['manual']['revision'] == 1)
        changed_hash = changed['manual']['plan']['planHash']
        assert changed_hash != base_hash
        assert changed['manual']['plan']['verification']['status'] == 'PASS'
        assert changed['manual']['plan']['routes'][0]['orderIds'][:2] == list(reversed(route['orderIds'][:2]))
        self.shot('manual-adjustment-verified')
        page.locator('#manualUndoBtn').click()
        self.wait(lambda s: s['manual']['revision'] == 0 and s['manual']['plan']['planHash'] == base_hash)
        page.locator('#manualOrderSelect').select_option(order)
        page.locator('#manualUpBtn').click()
        final = self.wait(lambda s: s['manual']['revision'] == 1)
        manual_hash = final['manual']['plan']['planHash']
        page.locator('#applyScenarioBtn').click()
        self.wait(lambda s: s['phase'] == 'applied' and
                  (last_action(page) or {}).get('result', {}).get('status') == 'APPLIED_AND_ADOPTED')
        applied = applied_identity(page)
        assert applied['planHash'] == manual_hash and applied['verification'] == 'PASS'
        assert applied['inputHash'] == final['scenario']['inputHash']
        assert plan_hash_in_ribbon(page) == manual_hash
        assert any(a['actionType'] == 'REORDER_STOP' for a in applied['manualAdjustmentAudit'])
        assert len([o for r in applied['routes'] for o in r['orderIds']]) == 6
        self.shot('manual-plan-applied-to-command')
        self.passed(baseHash=base_hash, manualPlanHash=manual_hash, lockedEditRejected=True,
            exactUndo=True, verifier='PASS', originalDispatchAndOperationalContextBothAdopted=True)
        return applied

    def cancel_batch(self, applied):
        self.begin('MULTI_DAY_CANCEL_LATE_NATIVE_RESPONSE')
        page = self.page
        endpoint = f'http://127.0.0.1:{self.opt_port}/optimize'
        request_start = len(self.result['nativeRequests'])
        audit_start = len(planning(page)['auditEvents'])
        def delay_real_response(route):
            response = route.fetch(timeout=60000)
            body = response.json()
            assert response.status == 200 and body['engine'] == 'OR-Tools'
            assert body['serverHashVerified'] is True and body['actualEngineVersion'] == '9.15.6755'
            self.held.append((route, response, body))
            # Deliberately retain a genuine backend response, then return control
            # to the UI test so the visible cancel can be clicked before delivery.
        page.route(endpoint, delay_real_response, times=1)
        try:
            page.locator('#planningModeSelect').select_option('MULTI_DAY_BATCH')
            page.locator('#multiDayLimit').select_option('ALL')
            page.locator('#runMultiDayBtn').click()
            running = self.wait(lambda s: bool(self.held) and s['generating'] and
                bool(s.get('multiDay')) and any(c['status'] == 'RUNNING' for c in s['multiDay']['childScenarios']))
            assert running['multiDay']['dateCount'] == 2
            assert not page.locator('#cancelMultiDayBtn').is_disabled()
            page.locator('#cancelMultiDayBtn').click()
            self.wait(lambda s: s['phase'] == 'multi-day-cancelled' and not s['generating'])
            assert page.locator('#cancelMultiDayBtn').is_disabled()
            self.shot('multi-day-cancel-before-late-response')
            held_route, response, body = self.held.pop()
            held_route.fulfill(response=response)
            finished = self.wait(lambda s: s['phase'] == 'multi-day-cancelled' and
                s['multiDay']['childScenarios'][0]['status'] == 'FAIL')
            assert finished['multiDay']['cancelled'] is True and finished['candidates'] == []
            assert finished['multiDay']['completedDates'] == 0
            assert finished['multiDay']['childScenarios'][1]['status'] == 'READY'
            assert finished['multiDay']['childScenarios'][0]['error'] == 'STALE_RESPONSE'
            assert any(e['type'] == 'STALE_RESPONSE_REJECTED' for e in finished['auditEvents'][audit_start:])
            assert applied_identity(page) == applied
            assert plan_hash_in_ribbon(page) == applied['planHash']
            assert len(self.result['nativeRequests'][request_start:]) == 1, 'Cancellation must not submit later dates'
            self.shot('multi-day-cancel-late-native-result-rejected')
        finally:
            for held_route, _, _ in self.held:
                held_route.abort()
            self.held.clear()
            page.unroute(endpoint, delay_real_response)
        self.result['controlledNetworkInterventions'].append({'stage': self.stage,
            'kind': 'DELAY_DELIVERY_OF_REAL_NATIVE_RESPONSE_UNTIL_UI_CANCEL', 'path': '/optimize',
            'fabricatedSolverResponse': False})
        self.passed(realLateResponsePlanHash=body['planHash'], staleResponseRejected=True,
            appliedPlanRetained=applied['planHash'], laterDatesSubmitted=False,
            boundary='Cancel remaining dates invalidates results; it does not abort an in-flight synchronous native solve')

    def record_failure(self, exc):
        super().record_failure(exc)
        if self.page:
            try:
                value = planning(self.page) or {}
                self.result['commandFailureDiagnostics'] = {
                    'phase': value.get('phase'), 'staleReason': value.get('staleReason'),
                    'generating': value.get('generating'), 'progress': value.get('progress'),
                    'lastAction': last_action(self.page),
                    'text': self.page.locator('#platformRouteOutlet').inner_text()[-6000:]}
            except Exception:
                pass

    def run(self):
        try:
            self.launch()
            from playwright.sync_api import sync_playwright
            with sync_playwright() as playwright:
                try:
                    self.begin('BROWSER')
                    executable = os.environ.get('STCT_CHROMIUM') or os.environ.get('STCT_BROWSER')
                    try:
                        self.browser = playwright.chromium.launch(headless=True, executable_path=executable,
                            args=['--disable-webgl'])
                    except Exception as exc:
                        raise EnvironmentError('Chromium launch blocked/unavailable: ' + str(exc)) from exc
                    self.context = self.make_context()
                    self.context.tracing.start(screenshots=True, snapshots=True, sources=False)
                    self.trace_started = True
                    self.page = self.new_page(self.context)
                    self.passed(browserVersion=self.browser.version, isolatedContext=True, noStateInjection=True)
                    self.local_recovery()
                    self.import_dispatch()
                    self.busy_guard()
                    selected = self.native_dispatch()
                    applied = self.manual_apply(selected)
                    self.cancel_batch(applied)
                    assert not self.result['pageErrors'], self.result['pageErrors']
                    self.result['status'] = 'PASS'
                except Exception as exc:
                    self.record_failure(exc)
                finally:
                    self.cleanup()
        except Exception as exc:
            self.record_failure(exc)
            if not self.cleaned:
                try:
                    self.cleanup()
                except Exception as cleanup_error:
                    self.result['status'] = 'FAIL'
                    self.result['stages']['CLEANUP'] = {'status': 'FAIL', 'error': self.scrub(str(cleanup_error))}
        self.result['externalBlocked'] = sorted(set(self.result['externalBlocked']))
        self.write()
        print(self.scrub(json.dumps({'status': self.result['status'], 'stages': self.result['stages']}, ensure_ascii=False)))
        return 0 if self.result['status'] == 'PASS' else 78 if self.result['status'] == 'BLOCKED_ENVIRONMENT' else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    args = parser.parse_args()
    evidence = args.evidence_dir.expanduser().resolve()
    if evidence == ROOT or ROOT in evidence.parents:
        parser.error('Evidence must be outside the checkout')
    evidence.mkdir(parents=True, exist_ok=True)
    if any(evidence.iterdir()):
        parser.error('Use an empty evidence directory; prior evidence must not be overwritten')
    return CommandSuite(evidence).run()


if __name__ == '__main__':
    sys.exit(main())
