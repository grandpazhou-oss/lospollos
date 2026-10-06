#!/usr/bin/env python3
"""Controlled HTTP fault/timing UI checks, with separate real-native retries.

No solver response is fabricated as a successful native result. The timing gate
only delays a genuine response or presents a controlled nonterminal job status;
cancel requests and retry solves still reach the owned native service.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit

from test_enterprise_synthetic_full_ui import (
    ROOT, TOTAL, Suite, action, field, independent_verify, ledger, near, route_to, state, step,
)


def wait_ui(page, predicate, label, timeout=25):
    """Fault cases intentionally enter FAILED/CANCELLED, so do not use wait_state."""
    end = time.monotonic() + timeout
    current = None
    while time.monotonic() < end:
        current = state(page) or {}
        if predicate(current):
            return current
        page.wait_for_timeout(50)
    raise AssertionError(label + ': ' + json.dumps({
        'status': (current or {}).get('status'), 'lastError': (current or {}).get('lastError'),
        'messages': page.locator('.sc-message').all_text_contents()}, ensure_ascii=False))


class RealResponseGate:
    """A controlled HTTP view of a genuine job; never a mocked successful solve."""
    def __init__(self, suite, hold_creation=False):
        self.suite, self.page = suite, suite.page
        self.hold_creation = hold_creation
        self.created = None
        self.pending = []
        self.controls = []
        self.cancel_requests = 0
        self.installed = False
        self.creation_captured_at = None
        self.creation_failure = None
        self.creation_response_received = False

    def request_failed(self, request):
        if request.method == 'POST' and request.url == self.suite.job_base:
            self.creation_failure = request.failure

    def response_received(self, response):
        if response.request.method == 'POST' and response.url == self.suite.job_base:
            self.creation_response_received = True

    def create(self, route):
        if route.request.method != 'POST':
            route.fallback()
            return
        response = route.fetch(timeout=10000)
        body = response.json()
        assert response.ok and body.get('jobId'), body
        self.created = body
        self.creation_captured_at = time.monotonic()
        self.suite.owned_jobs[body['jobId']] = body
        if self.hold_creation:
            self.pending.append((route, response, body))
            self.controls.append('DELAY_GENUINE_CREATION_RESPONSE')
            return
        # The tiny native fixture can finish before a human-speed click. Present
        # an explicitly controlled in-progress HTTP status and hold the first poll.
        # The actual backend is untouched and its real terminal status is reported.
        pending = {**body, 'status': 'SOLVING', 'phase': 'CANDIDATES',
                   'completedAt': None, 'error': None, 'resultPhases': []}
        self.controls.append('CONTROLLED_NONTERMINAL_CREATION_STATUS')
        route.fulfill(response=response, json=pending)

    def job(self, route):
        if route.request.method == 'POST' and urlsplit(route.request.url).path.endswith('/cancel'):
            self.cancel_requests += 1
            route.fallback()
            return
        if route.request.method == 'GET' and not urlsplit(route.request.url).query and not self.pending:
            response = route.fetch(timeout=10000)
            self.pending.append((route, response, response.json()))
            self.controls.append('DELAY_GENUINE_STATUS_RESPONSE')
            return
        route.fallback()

    def install(self):
        self.page.on('requestfailed', self.request_failed)
        self.page.on('response', self.response_received)
        self.page.route(self.suite.job_base, self.create)
        self.page.route(self.suite.job_base + '/**', self.job)
        self.installed = True
        return self

    def wait_pending(self):
        wait_ui(self.page, lambda _: bool(self.pending), 'Expected controlled pending HTTP response', 12)
        assert self.created is not None
        return self.created

    def release(self, refreshed=False):
        pending, self.pending = self.pending, []
        for route, response, body in pending:
            if refreshed:
                body = self.suite.remote_job(self.created['jobId'])
            route.fulfill(response=response, json=body)

    def remove(self, navigated=False):
        if self.installed:
            self.page.unroute(self.suite.job_base, self.create)
            self.page.unroute(self.suite.job_base + '/**', self.job)
            self.installed = False
            self.page.remove_listener('requestfailed', self.request_failed)
            self.page.remove_listener('response', self.response_received)
        # Navigation normally aborts its pending poll. Abort any remaining route;
        # do not release a stale result during cleanup as if it were a valid solve.
        for route, _, _ in self.pending:
            try:
                route.abort()
            except Exception:
                if not navigated and not self.page.is_closed():
                    raise
        self.pending = []


class FaultSuite(Suite):
    def __init__(self, evidence):
        super().__init__(evidence)
        self.result.update(method='ACTUAL_UI_CONTROLLED_HTTP_FAULTS_WITH_SEPARATE_NATIVE_RETRIES',
            classification='SYNTHETIC_CONTROLLED_UI_FAULT_TEST',
            stages={name: {'status': 'NOT_RUN'} for name in (
                'DEPENDENCIES', 'LAUNCHER', 'BROWSER', 'IMPORT_MAPPING_UNITS', 'MISSING_CRS_GUARD',
                'HEALTH_WRONG_BUILD', 'HEALTH_MISSING_INSTANCE', 'OLD_INSTANCE_JOB_REJECTION',
                'CONTROLLED_429_BUSY', 'NATIVE_RETRY_AFTER_429', 'CANCEL_PENDING_POLL_TWICE',
                'NATIVE_RETRY_AFTER_CANCEL', 'REFRESH_INTERRUPTED', 'NATIVE_RETRY_AFTER_REFRESH',
                'LATE_RESPONSE_STUDY_SWITCH', 'BROWSER_ERROR_AUDIT', 'CLEANUP')},
            notCovered=['NATIVE_WORKER_CANCEL_WIN_GUARANTEE', 'PRE_POST_REJECTION_OF_VALID_DIFFERENT_INSTANCE_ID',
                'REAL_OSRM', 'WINDOWS_REAL_MACHINE', 'PRIVATE_WORKBOOK', 'LOAD_TEST', 'EXHAUSTIVE_RACES'],
            faultEvidence=[], genuineNativeSuccesses=[])
        self.owned_jobs = {}
        self.active_gate = None

    @property
    def job_base(self):
        return f'http://127.0.0.1:{self.opt_port}/supply-chain-jobs-v6'

    def solve_posts(self):
        return [r for r in self.result['nativeRequests'] if r['path'] == '/supply-chain-jobs-v6']

    def remote_job(self, job_id):
        response = self.context.request.get(self.job_base + '/' + job_id, timeout=10000)
        assert response.ok, response.status
        body = response.json()
        owned = self.owned_jobs[job_id]
        assert body['jobId'] == job_id and body['runSpecHash'] == owned['runSpecHash']
        assert body['backendInstanceId'] == owned['backendInstanceId']
        assert body['backendBuildFingerprint'] == self.record['backendBuildFingerprint']
        return body

    def screenshot(self, name):
        self.page.screenshot(path=str(self.evidence / (name + '.png')), full_page=True)

    def visible_error(self, code):
        self.page.locator('.sc-message.is-error').first.wait_for(state='visible')
        text = self.page.locator('.supply-chain-study').text_content()
        assert code in text, {'expectedCode': code, 'visibleMessages': self.page.locator('.sc-message').all_text_contents()}
        return self.page.locator('.sc-message').all_text_contents()

    def health_fault(self, stage, mutate, reason, pre_post=True):
        self.begin(stage)
        self.configure('OUTBOUND_ONLY')
        health_url = f'http://127.0.0.1:{self.opt_port}/health'
        seen = []
        def altered(route):
            response = route.fetch(timeout=10000)
            body = response.json()
            assert body['buildFingerprint'] == self.record['backendBuildFingerprint']
            seen.append({'realInstanceId': body['instanceId'], 'realBuildFingerprint': body['buildFingerprint']})
            mutate(body)
            route.fulfill(response=response, json=body)
        self.page.route(health_url, altered)
        before = len(self.solve_posts())
        try:
            action(self.page, 'analyze').click()
            if pre_post:
                wait_ui(self.page, lambda _: bool(seen) and reason in
                    (self.page.locator('.supply-chain-study').text_content() or '') and
                    self.page.locator('.sc-message.is-error').first.is_visible(),
                    'Expected the current health rejection, not a prior error')
                messages = self.visible_error(reason)
                assert len(self.solve_posts()) == before, 'Health rejection sent a solve POST'
                assert not state(self.page).get('snapshot') and not state(self.page).get('job')
            else:
                value = wait_ui(self.page, lambda s: (s.get('lastError') or {}).get('code') == reason,
                                'Old instance must reject the real job response')
                messages = self.visible_error(reason)
                assert len(self.solve_posts()) == before + 1
                assert value.get('snapshot') is None
            assert seen
            self.screenshot(stage.lower())
            self.result['faultEvidence'].append({'stage': stage, 'method': 'CONTROLLED_HEALTH_HTTP_RESPONSE',
                'reason': reason, 'solvePosts': len(self.solve_posts()) - before})
            self.passed(method='CONTROLLED_HEALTH_HTTP_RESPONSE', rejectionReason=reason,
                solvePosts=len(self.solve_posts()) - before, visibleMessages=messages,
                prePostRejection=pre_post, nativeSuccessClaim=False)
        finally:
            self.page.unroute(health_url, altered)

    def busy(self):
        self.begin('CONTROLLED_429_BUSY')
        self.configure('OUTBOUND_ONLY')
        intercepted = []
        def unavailable(route):
            if route.request.method != 'POST':
                route.fallback()
                return
            intercepted.append(True)
            route.fulfill(status=429, content_type='application/json',
                body=json.dumps({'error': {'code': 'SUPPLY_JOB_BUSY', 'details': {'retryable': True}}}),
                headers={'access-control-allow-origin': f'http://127.0.0.1:{self.web_port}'})
        self.page.route(self.job_base, unavailable)
        try:
            action(self.page, 'analyze').click()
            value = wait_ui(self.page, lambda s: (s.get('lastError') or {}).get('code') == 'SUPPLY_JOB_BUSY',
                            'Expected visible busy rejection')
            messages = self.visible_error('SUPPLY_JOB_BUSY')
            assert len(intercepted) == 1 and value.get('snapshot') is None
            assert value.get('job') is None
            action(self.page, 'analyze').wait_for(state='visible')
            assert action(self.page, 'analyze').is_enabled()
            self.screenshot('controlled-429-busy')
            self.passed(method='CONTROLLED_HTTP_429_NO_NATIVE_JOB_CREATED', visibleMessages=messages,
                        retryControlEnabled=True, nativeSuccessClaim=False)
        finally:
            self.page.unroute(self.job_base, unavailable)

    def native_retry(self, stage):
        self.begin(stage)
        self.configure('OUTBOUND_ONLY')
        before = len(self.solve_posts())
        action(self.page, 'analyze').click()
        wait_ui(self.page, lambda s: s.get('status') == 'SNAPSHOT_READY' and bool((s.get('snapshot') or {}).get('rows')),
                'Genuine native retry', timeout=90)
        action(self.page, 'export-html').wait_for(state='visible')
        current = state(self.page)
        assert len(self.solve_posts()) == before + 1
        assert current['job']['status'] == 'COMPLETE'
        assert current['snapshot']['backendIdentity']['buildFingerprint'] == self.record['backendBuildFingerprint']
        assert all(r['engine']['id'] == 'OR_TOOLS_CP_SAT' for r in current['snapshot']['solverRuns'])
        verification = independent_verify(current, 'OUTBOUND_ONLY')
        self.result['genuineNativeSuccesses'].append({'stage': stage, 'jobId': current['job']['jobId'],
            'snapshotHash': current['snapshot']['snapshotHash']})
        self.screenshot(stage.lower())
        self.passed(method='UNALTERED_REAL_NATIVE_HTTP_AND_INDEPENDENT_LEDGER',
            jobId=current['job']['jobId'], snapshotHash=current['snapshot']['snapshotHash'], verification=verification)
        return current

    def cancel_pending(self):
        self.begin('CANCEL_PENDING_POLL_TWICE')
        self.configure('OUTBOUND_ONLY')
        gate = self.active_gate = RealResponseGate(self).install()
        try:
            action(self.page, 'analyze').click()
            created = gate.wait_pending()
            action(self.page, 'cancel-run').wait_for(state='visible')
            assert state(self.page)['job']['jobId'] == created['jobId']
            # Hold the poll while exercising the actual cancel control twice.
            cancellation_messages = []
            for _ in range(2):
                before = gate.cancel_requests
                action(self.page, 'cancel-run').click()
                wait_ui(self.page, lambda _: gate.cancel_requests > before, 'Cancel request was not sent')
                receipt = wait_ui(self.page, lambda s: (s.get('job') or {}).get('status') in ('CANCELLED', 'COMPLETE', 'PARTIAL'),
                        'Native cancellation did not return a terminal response')
                terminal = receipt['job']['status']
                expected_message = {'CANCELLED': '计算已取消', 'COMPLETE': '任务已完成，取消未生效',
                                    'PARTIAL': '任务已结束并保留部分结果，未确认取消'}[terminal]
                wait_ui(self.page, lambda _: expected_message in '\n'.join(
                    self.page.locator('.sc-message:visible').all_text_contents()),
                    'Visible cancel message did not match the native terminal receipt')
                messages = self.page.locator('.sc-message:visible').all_text_contents()
                if terminal != 'CANCELLED':
                    assert not any('计算已取消；' in message for message in messages)
                cancellation_messages.append({'nativeStatus': terminal, 'visibleMessages': messages})
            remote = self.remote_job(created['jobId'])
            assert remote['status'] in ('CANCELLED', 'COMPLETE', 'PARTIAL') and remote.get('completedAt')
            self.screenshot('cancel-control-pending-poll')
            gate.release(refreshed=True)
            value = wait_ui(self.page, lambda s: s.get('status') in ('CANCELLED', 'SNAPSHOT_READY'),
                            'Held cancellation did not settle', 30)
            wait_ui(self.page, lambda _: not action(self.page, 'cancel-run').is_visible(), 'Cancel UI remained busy')
            value = state(self.page)  # Re-read after the pending run continuation settles.
            assert value['job']['status'] == remote['status']
            retained_rows = 0
            if remote['status'] == 'CANCELLED' and not value.get('snapshot'):
                assert value['status'] == 'CANCELLED'
            elif remote['status'] in ('CANCELLED', 'PARTIAL'):
                # Cancellation may retain already-verified subresults. Verify each
                # ledger without claiming global optimality or completed coverage.
                assert value['status'] == 'SNAPSHOT_READY'
                retained_rows = self.verify_retained_candidates(value)
            else:
                # A tiny real solve can beat the click; report that race honestly.
                assert value['status'] == 'SNAPSHOT_READY'
                independent_verify(value, 'OUTBOUND_ONLY')
            self.passed(method='CONTROLLED_NONTERMINAL_HTTP_AND_HELD_POLL_REAL_CANCEL_REQUESTS',
                cancelClicks=2, cancelPosts=gate.cancel_requests, jobId=created['jobId'],
                actualBackendStatus=remote['status'], nativeCancellationWon=remote['status'] == 'CANCELLED',
                finalUiStatus=value['status'], heldResponseReleased=True, nativeSuccessClaim=False,
                cancellationMessages=cancellation_messages, retainedVerifiedCandidateCount=retained_rows,
                globalOracleClaimForPartialResults=False)
        finally:
            gate.remove()
            self.active_gate = None

    def verify_retained_candidates(self, current):
        rows = current['snapshot']['rows']
        assert rows, 'A retained partial snapshot needs independently verified candidates'
        required = {(d['demandId'], d['period']): d for d in current['study']['periodDemand']}
        for item in rows:
            row = item['result']
            values = ledger(row, current['study'])
            assert not row['inbound']
            near(values['outbound']['quantity'], TOTAL)
            assert {(r['demandId'], r['period']) for r in row['outbound']} == set(required)
            for leg in row['outbound']:
                assert leg['fromNodeId'] in row['selectedSiteIds']
                near(leg['quantity'], required[leg['demandId'], leg['period']]['quantity'])
            assert all(r['status'] == 'PASS' and r['throughput'] <= r['capacity'] for r in row['capacityByPeriod'])
            assert row['solverEvidence']['engine']['id'] == 'OR_TOOLS_CP_SAT'
            assert row['solverEvidence']['status'] in ('OPTIMAL', 'FEASIBLE')
            near(row['solverEvidence']['objectiveValue'], values['outbound']['volumeKm'], .1)
        return len(rows)

    def refresh_interrupted(self):
        self.begin('REFRESH_INTERRUPTED')
        self.configure('OUTBOUND_ONLY')
        gate = self.active_gate = RealResponseGate(self).install()
        navigated = False
        before = len(self.solve_posts())
        try:
            action(self.page, 'analyze').click()
            created = gate.wait_pending()
            marker = self.page.evaluate('() => JSON.parse(sessionStorage.getItem("STCT_SUPPLY_JOB_V6"))')
            assert marker['jobId'] == created['jobId']
            self.page.reload(wait_until='load')
            navigated = True
            button = self.page.locator('#loginForm .login-btn')
            if button.is_visible():
                button.click()
            self.page.locator('[data-design-route="/design/supply-chain-study"]').wait_for()
            value = wait_ui(self.page, lambda s: s.get('status') == 'INTERRUPTED', 'Refresh must show interruption')
            assert value['lastError']['code'] == 'SUPPLY_RUN_INTERRUPTED'
            assert value['lastError']['detail']['jobId'] == created['jobId']
            assert value.get('snapshot') is None
            assert self.page.locator('.sc-message.is-error').first.is_visible()
            assert self.page.evaluate('() => sessionStorage.getItem("STCT_SUPPLY_JOB_V6")') is None
            wait_ui(self.page, lambda _: gate.cancel_requests > 0, 'Refresh did not request cancel')
            assert len(self.solve_posts()) == before + 1, 'Refresh silently resumed/created a solve'
            remote = self.remote_job(created['jobId'])
            assert remote['status'] in ('CANCELLED', 'COMPLETE', 'PARTIAL')
            self.screenshot('refresh-interrupted')
            self.passed(method='ACTUAL_RELOAD_DURING_CONTROLLED_HTTP_PENDING_JOB',
                interruptedJobId=created['jobId'], uiStatus=value['status'], markerCleared=True,
                solvePostsAfterRefresh=0, realBackendStatus=remote['status'], nativeSuccessClaim=False)
        finally:
            gate.remove(navigated=navigated)
            self.active_gate = None

    def delayed_switch(self, original):
        self.begin('LATE_RESPONSE_STUDY_SWITCH')
        original_pointer = original['savedPointer']['id']
        route_to(self.page, '/platform/scenarios')
        self.page.locator('[data-p5-field="scenarioName"]').fill('Synthetic alternate study for delayed response')
        self.page.locator('[data-p5-action="save-copy"]').click()
        alternate = wait_ui(self.page, lambda s: s.get('study') and s['study']['studyId'] != original['study']['studyId'] and
            (s.get('savedPointer') or {}).get('id') == 'SUPPLY:' + s['study']['studyId'], 'Create alternate study')
        alternate_pointer = alternate['savedPointer']['id']
        self.reopen_public(self.page, original_pointer)
        self.configure('OUTBOUND_ONLY')
        gate = self.active_gate = RealResponseGate(self, hold_creation=True).install()
        try:
            action(self.page, 'analyze').click()
            created = gate.wait_pending()
            # In-study list/open buttons are disabled while the view is busy.
            # The global catalog remains usable and performs the same bound reopen.
            route_to(self.page, '/platform/scenarios')
            row = self.page.locator(f'tr[data-p5-entry="{alternate_pointer}"]')
            row.locator('[data-p5-action="open"]').click()
            self.page.locator('[data-design-route="/design/supply-chain-study"]').wait_for()
            selected = wait_ui(self.page, lambda s: (s.get('savedPointer') or {}).get('id') == alternate_pointer,
                               'Public catalog did not switch to the alternate study')
            held_seconds = time.monotonic() - gate.creation_captured_at
            assert gate.creation_failure is None, 'Held POST aborted before the intended late response: ' + str(gate.creation_failure)
            assert held_seconds < 8, 'Public switch exceeded the safe window before the real 10-second request deadline'
            selected_identity = (selected['study']['studyId'], selected['study']['inputHash'])
            selected_snapshot = selected.get('snapshot')
            gate.release()
            wait_ui(self.page, lambda _: gate.creation_response_received and gate.cancel_requests > 0,
                    'Delivered old late response did not request detached cancellation')
            assert gate.creation_failure is None, gate.creation_failure
            # Drain the original HTTP continuation, then inspect via actual visible UI.
            self.page.wait_for_timeout(300)
            after = state(self.page)
            assert (after['study']['studyId'], after['study']['inputHash']) == selected_identity
            assert after.get('snapshot') == selected_snapshot
            assert after.get('lastError') is None
            assert after['savedPointer'] == selected['savedPointer']
            assert not self.page.locator('.sc-message.is-error').count()
            remote = self.remote_job(created['jobId'])
            assert remote['status'] in ('CANCELLED', 'COMPLETE', 'PARTIAL')
            self.screenshot('late-response-new-study-preserved')
            self.passed(method='CONTROLLED_DELAY_OF_GENUINE_JOB_POST_RESPONSE_PUBLIC_STUDY_SWITCH',
                oldJobId=created['jobId'], newStudyId=after['study']['studyId'],
                newStudyHash=after['study']['inputHash'], newStudyPreserved=True,
                oldResultAdopted=False, backendStatus=remote['status'], nativeSuccessClaim=False,
                publicSwitchRoute='global scenario library -> alternate row Open', heldSeconds=round(held_seconds, 3),
                lateHttpResponseReceived=gate.creation_response_received, creationRequestFailure=gate.creation_failure,
                detachedCancellationPosts=gate.cancel_requests)
        finally:
            gate.remove()
            self.active_gate = None

    def cleanup(self):
        if self.active_gate:
            try:
                self.active_gate.remove(navigated=True)
            except Exception:
                pass
            self.active_gate = None
        # Cancel only jobs whose ID, run spec and service identity are verified.
        if self.context:
            for job_id in self.owned_jobs:
                try:
                    remote = self.remote_job(job_id)
                    if remote['status'] not in ('COMPLETE', 'PARTIAL', 'CANCELLED', 'FAILED'):
                        response = self.context.request.post(self.job_base + '/' + job_id + '/cancel', timeout=10000)
                        assert response.ok
                except Exception as error:
                    self.result.setdefault('jobCleanupWarnings', []).append(self.scrub(str(error)))
        if self.result.get('jobCleanupWarnings'):
            self.result['status'] = 'FAIL'
        super().cleanup()

    def run(self):
        try:
            self.launch()
            from playwright.sync_api import sync_playwright
            with sync_playwright() as playwright:
                try:
                    self.begin('BROWSER')
                    try:
                        self.browser = playwright.chromium.launch(headless=True,
                            executable_path=os.environ.get('STCT_CHROMIUM') or os.environ.get('STCT_BROWSER'),
                            args=['--disable-webgl'])
                    except Exception as exc:
                        raise EnvironmentError('Chromium launch blocked/unavailable: ' + str(exc)) from exc
                    self.context = self.make_context()
                    self.context.tracing.start(screenshots=True, snapshots=True, sources=False)
                    self.trace_started = True
                    self.page = self.new_page(self.context)
                    self.passed(browserVersion=self.browser.version, isolatedContext=True)
                    self.import_workbook()
                    self.health_fault('HEALTH_WRONG_BUILD', lambda body: body.update(buildFingerprint='0'*64),
                                      'BUILD_FINGERPRINT_MISMATCH')
                    self.health_fault('HEALTH_MISSING_INSTANCE', lambda body: body.update(instanceId=''),
                                      'INSTANCE_IDENTITY_MISSING')
                    self.health_fault('OLD_INSTANCE_JOB_REJECTION',
                        lambda body: body.update(instanceId='synthetic-old-instance-controlled-http'),
                        'SUPPLY_JOB_PROTOCOL_INVALID', pre_post=False)
                    self.busy()
                    self.native_retry('NATIVE_RETRY_AFTER_429')
                    self.cancel_pending()
                    self.native_retry('NATIVE_RETRY_AFTER_CANCEL')
                    self.refresh_interrupted()
                    latest = self.native_retry('NATIVE_RETRY_AFTER_REFRESH')
                    self.delayed_switch(latest)
                    self.begin('BROWSER_ERROR_AUDIT')
                    assert not self.result['pageErrors'], self.result['pageErrors']
                    expected_errors = [message for message in self.result['consoleErrors']
                        if re.search(r'(?:status of 429|429 \(Too Many Requests\)|net::ERR_ABORTED)', message)]
                    unexpected = [message for message in self.result['consoleErrors'] if message not in expected_errors]
                    self.result['expectedControlledHttpConsoleErrors'] = expected_errors
                    assert not unexpected, unexpected
                    self.passed(expectedHttpConsoleErrors=expected_errors, unexpectedConsoleErrors=[])
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
        parser.error('Use an empty evidence directory')
    return FaultSuite(evidence).run()


if __name__ == '__main__':
    sys.exit(main())
