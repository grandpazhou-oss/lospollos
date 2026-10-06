#!/usr/bin/env python3
"""Synthetic, real-UI/native-solver DESIGN acceptance on an isolated local trial.

Run: python tests/test_enterprise_synthetic_full_ui.py --evidence-dir /tmp/stct-full-ui
Requires existing Node, OR-Tools and Python Playwright/Chromium. Installs nothing.
All writes go outside the checkout; only local_trial.py owns service lifecycle.
This is geographic-screening acceptance, not OSRM, private-data or Windows proof.
"""
from __future__ import annotations

import argparse
import importlib.util
import itertools
import json
import math
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SCOPES = ('OUTBOUND_ONLY', 'UPSTREAM_ONLY', 'FULL_CHAIN')
FORBIDDEN_PORTS = {8787, 8877, 8791, 8766, 8788, 19095}
TOTAL = 45.5
PERIODS = ['2026-01', '2026-02']
STATE = '() => window.STCTPlatformV19?.instance?.designAdapter?.supplySnapshot()'
# Every row here is newly invented for this suite. No workbook discovery or copy.
SHEETS = [
    ['Locations', [['name', 'code', 'role', 'coordinate'],
                   ['Synthetic Origin A', 'S-A', 'FACTORY', '120,30'],
                   ['Synthetic Origin B', 'S-B', 'FACTORY', '121,30'],
                   ['Synthetic Hub East', 'W-E', 'DC', '120.1,30'],
                   ['Synthetic Hub West', 'W-W', 'DC', '121.1,30']]],
    ['Demand', [['customerNumber', 'customer', 'assignedDepot', 'coordinate', *PERIODS],
                ['D-A', 'Synthetic Shop Alpha', 'W-W', '120.2,30', 10.25, 12.5],
                ['D-B', 'Synthetic Shop Beta', 'W-E', '121.2,30', 10.25, 12.5]]],
    ['Inbound', [['flowId', 'fromNodeId', 'toNodeId', *PERIODS],
                 ['F-A', 'S-B', 'W-E', 10.25, 12.5],
                 ['F-B', 'S-A', 'W-W', 10.25, 12.5]]],
]


def near(actual, expected, tolerance=1e-6):
    assert isinstance(actual, (int, float)) and math.isfinite(actual), (actual, expected)
    assert abs(actual - expected) <= tolerance, (actual, expected, tolerance)


def distance(a, b):
    """Independent Python Haversine; no production calculation is called."""
    lon1, lat1, lon2, lat2 = map(math.radians, [*a, *b])
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 12742 * math.atan2(math.sqrt(h), math.sqrt(max(0, 1-h)))


def port_available(port):
    with socket.socket() as sock:
        # Match local_trial's bind check: a closed HTTP listener can leave TIME_WAIT.
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(('127.0.0.1', port))
        except OSError:
            return False
    return True


def choose_port(preferred, exclude):
    if preferred not in exclude and port_available(preferred):
        return preferred
    for _ in range(30):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            value = sock.getsockname()[1]
        if value >= 1024 and value not in exclude:
            return value
    raise RuntimeError('No free, non-protected loopback port found')


def state(page):
    return page.evaluate(STATE)


def wait_state(page, predicate, timeout=120):
    end = time.monotonic() + timeout
    current = None
    while time.monotonic() < end:
        current = state(page)
        if current and predicate(current):
            return current
        if current and current.get('status') == 'FAILED':
            raise AssertionError('Application failed: ' + json.dumps(current.get('lastError')))
        page.wait_for_timeout(100)
    messages = page.locator('.sc-message, [data-supply-preflight]').all_text_contents()
    raise AssertionError('Application wait expired: ' + json.dumps({
        'status': (current or {}).get('status'), 'error': (current or {}).get('lastError'),
        'messages': messages}, ensure_ascii=False))


def action(page, name):
    return page.locator(f'[data-supply-action="{name}"]')


def field(page, name):
    return page.locator(f'[data-supply-field="{name}"]')


def reveal(locator):
    if not locator.is_visible():
        details = locator.locator('xpath=ancestor::details[1]')
        if details.count() and not details.evaluate('(e) => e.open'):
            details.locator('summary').first.click()
    locator.wait_for(state='visible')


def step(page, index):
    page.locator(f'[data-supply-action="step"][data-supply-id="{index}"]').click()


def route_to(page, route):
    page.locator(f'button[data-platform-route="{route}"]:visible').first.click()
    # Playwright retains returned JSHandles until explicitly disposed, even when
    # the caller only needed the wait and discards its boolean result.
    page.wait_for_function('(r) => location.hash.split("?")[0] === "#" + r', arg=route).dispose()


def login(page, url):
    page.goto(url, wait_until='load')
    button = page.locator('#loginForm .login-btn')
    if button.is_visible():
        button.click()
    page.locator('.platform-home').wait_for()


def upload(locator, name, contents, mime):
    # FilePayload prevents a local filesystem path from reaching the application/trace.
    locator.set_input_files({'name': name, 'mimeType': mime, 'buffer': contents})


def ledger(result, study):
    nodes = {n['nodeId']: n for n in study['nodes']}
    output = {}
    for kind in ('inbound', 'outbound'):
        rows = result.get(kind, [])
        independent = 0
        for row in rows:
            km = distance(nodes[row['fromNodeId']]['coordinate'], nodes[row['toNodeId']]['coordinate'])
            near(row['distanceKm'], km)
            near(row['volumeKm'], row['quantity'] * km)
            assert row['quantity'] >= 0 and row['unit'] == 'm3'
            independent += row['quantity'] * km
        metric = result['metrics'].get(kind)
        quantity = sum(r['quantity'] for r in rows)
        if rows:
            assert metric is not None
            near(metric.get('volume', metric.get('totalVolume')), quantity)
            near(metric.get('volumeKm', metric.get('numeratorVolumeKm')), independent)
            near(metric.get('weightedKm', metric.get('weightedDistanceKm')), independent/quantity)
        output[kind] = {'quantity': quantity, 'volumeKm': independent}
    return output


def independent_verify(current, scope):
    study, snap = current['study'], current['snapshot']
    assert study['coordinateUse'] == 'ASSUMED_WGS84_SCREENING'
    assert study['classification'] == 'SYNTHETIC'
    assert study['periods'] == PERIODS and study['unit'] == 'm3'
    assert len(study['periodDemand']) == len(study['observedInbound']) == 4
    near(sum(r['quantity'] for r in study['periodDemand']), TOTAL)
    near(sum(r['quantity'] for r in study['observedInbound']), TOTAL)
    assert snap['studyHash'] == study['inputHash']
    base = snap['baseline']
    assert base['scenarioType'] == 'OBSERVED_BASELINE'
    original = {(r['demandId'], r['period']): r for r in study['periodDemand']}
    observed = {(r['fromNodeId'], r['toNodeId'], r['period']): r['quantity']
                for r in study['observedInbound']}
    assert {(r['fromNodeId'], r['toNodeId'], r['period']): r['quantity']
            for r in base['inbound']} == observed
    for leg in base['outbound']:
        raw = original[leg['demandId'], leg['period']]
        assert leg['fromNodeId'] == raw['currentSiteId']
        near(leg['quantity'], raw['quantity'])
    baseline = ledger(base, study)
    near(baseline['outbound']['quantity'], TOTAL)
    near(baseline['inbound']['quantity'], TOTAL)
    nodes = {n['nodeId']: n for n in study['nodes']}
    suppliers = [n['nodeId'] for n in study['nodes'] if n['role'] in ('FACTORY', 'SUPPLIER')]
    candidates = []
    assert snap['rows'], 'No native candidates'
    for item in snap['rows']:
        row = item.get('result', item)
        values = ledger(row, study)
        selected = row.get('selectedSiteIds') or [s['nodeId'] for s in row['selectedSites']]
        assert 1 <= len(selected) <= 2 and len(set(selected)) == len(selected)
        assert row['capacityByPeriod'] and all(r['status'] == 'PASS' for r in row['capacityByPeriod'])
        assert all(r['throughput'] <= 100 for r in row['capacityByPeriod'])
        if scope == 'OUTBOUND_ONLY':
            evidence = row['solverEvidence']
            assert evidence['engine']['id'] == 'OR_TOOLS_CP_SAT'
            assert evidence['status'] in ('OPTIMAL', 'FEASIBLE')
            assert row['inbound'] == [], 'Outbound-only must not invent supply flows'
            near(values['outbound']['quantity'], TOTAL)
        else:
            assert row['solver']['engine'] == 'OR_TOOLS_CP_SAT'
            assert row['status'] in ('OPTIMAL', 'FEASIBLE')
            near(row['solver']['verifiedObjectiveValue'], values['inbound']['volumeKm'] + values['outbound']['volumeKm'])
            near(values['inbound']['quantity'], TOTAL)
            if scope == 'UPSTREAM_ONLY':
                assert row['outbound'] == [] and row['assignments'] == []
                for period in PERIODS:
                    for supplier in suppliers:
                        before = sum(q for (s, _, p), q in observed.items() if s == supplier and p == period)
                        after = sum(r['quantity'] for r in row['inbound'] if r['fromNodeId'] == supplier and r['period'] == period)
                        near(after, before)
                    for site in selected:
                        before = sum(q for (_, w, p), q in observed.items() if w == site and p == period)
                        after = sum(r['quantity'] for r in row['inbound'] if r['toNodeId'] == site and r['period'] == period)
                        near(after, before)
            else:
                near(values['outbound']['quantity'], TOTAL)
                near(row['metrics']['operatingCost'], values['inbound']['volumeKm'] + values['outbound']['volumeKm'])
                first_cost = sum(r['quantity'] * distance(nodes[r['fromNodeId']]['coordinate'],
                    nodes[r['toNodeId']]['coordinate']) for r in row['inbound'] + row['outbound']
                    if r['period'] == PERIODS[0])
                near(row['metrics']['firstPeriodCost'], first_cost)
                for period in PERIODS:
                    for site in selected:
                        received = sum(r['quantity'] for r in row['inbound'] if r['toNodeId'] == site and r['period'] == period)
                        delivered = sum(r['quantity'] for r in row['outbound'] if r['fromNodeId'] == site and r['period'] == period)
                        near(received, delivered)
        if scope != 'UPSTREAM_ONLY':
            assert {(r['demandId'], r['period']) for r in row['outbound']} == set(original)
            for leg in row['outbound']:
                assert leg['fromNodeId'] in selected
                near(leg['quantity'], original[leg['demandId'], leg['period']]['quantity'])
        candidates.append({'scenarioId': item['scenarioId'], 'sites': selected, **values})
    # Independent finite oracle on this tiny fixture. Each supplier has excess capacity;
    # full-chain sources are adjustable, so each selected site's cheapest source is exact.
    sites = ['W-E', 'W-W']
    def km(a, b):
        return distance(nodes[a]['coordinate'], nodes[b]['coordinate'])
    if scope == 'UPSTREAM_ONLY':
        # Equal supplier/site totals in each period make either permutation exhaustive
        # for this 2x2 transportation problem's extrema.
        oracle = min(sum(r['quantity'] * km(suppliers[i], assignment[i])
                         for i in range(2) for r in study['observedInbound']
                         if r['fromNodeId'] == suppliers[i])
                     for assignment in itertools.permutations(sites))
    else:
        options = []
        for count in (1, 2):
            for chosen in itertools.combinations(sites, count):
                options.append(sum(d['quantity'] * min(km(w, d['customerNodeId']) +
                    (min(km(s, w) for s in suppliers) if scope == 'FULL_CHAIN' else 0)
                    for w in chosen) for d in study['periodDemand']))
        oracle = min(options)
    best = min(v['inbound']['volumeKm'] + v['outbound']['volumeKm'] for v in candidates)
    # Native objective coefficients may be rounded; oracle is unrounded geography.
    near(best, oracle, .1)
    if scope == 'FULL_CHAIN':
        reference = snap['planningReference']
        assert reference and reference['solver']['engine'] == 'OR_TOOLS_CP_SAT'
        reference_ledger = ledger(reference, study)
        near(reference_ledger['inbound']['quantity'], TOTAL)
        near(reference_ledger['outbound']['quantity'], TOTAL)
        near(reference['metrics']['operatingCost'], sum(v['volumeKm'] for v in reference_ledger.values()))
    return {'method': 'INDEPENDENT_PYTHON_HAVERSINE_CONSERVATION_AND_TINY_EXHAUSTIVE_ORACLE',
            'baseline': baseline, 'candidates': candidates, 'oracleBestVolumeKm': oracle,
            'nativeBestVolumeKm': best, 'oracleTolerance': .1}


class Suite:
    def __init__(self, evidence):
        self.evidence = evidence
        self.runtime = Path(tempfile.mkdtemp(prefix='stct-synthetic-full-ui-'))
        self.run_dir = self.runtime / 'launcher'
        self.env = {**os.environ, 'STCT_RUN_DIR': str(self.run_dir),
                    'PYTHONUTF8': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
        self.result = {'status': 'NOT_RUN', 'classification': 'SYNTHETIC_TEST',
            'method': 'ACTUAL_LOCAL_TRIAL_PUBLIC_UI_NATIVE_ORTOOLS_NO_STATE_INJECTION',
            'stages': {k: {'status': 'NOT_RUN'} for k in ('DEPENDENCIES', 'LAUNCHER', 'BROWSER', 'IMPORT_MAPPING_UNITS',
                'MISSING_CRS_GUARD', *[f'{s}:{part}' for s in SCOPES for part in
                ('SOLVE_VERIFY', 'COMPARISON_MAP_REPORT', 'SAVE_RELOAD', 'EXPORT_REIMPORT')],
                'SAME_ID_CONFLICT_RECOVERY', 'CROSS_TAB_EDIT_RECOVERY', 'STALE_RESULT_GUARD', 'CLEANUP')},
            'notCovered': ['WINDOWS_REAL_MACHINE', 'MACOS_EXISTING_LAUNCHERS', 'REAL_OSRM',
                'PRIVATE_WORKBOOK', 'PRODUCTION_AUTHENTICATION', 'HUMAN_OBSERVATION'],
            'pageErrors': [], 'consoleErrors': [], 'externalBlocked': [], 'nativeRequests': []}
        self.stage = 'DEPENDENCIES'
        self.browser = self.context = self.page = None
        self.services_started = False
        self.trace_started = False
        self.cleaned = False
        self.launcher_timeout = False

    def scrub(self, value):
        # Public logs contain filenames and error details but no local absolute paths.
        for path, replacement in ((self.runtime, '<runtime>'), (self.evidence, '<evidence>'),
                                  (ROOT, '<checkout>'), (Path.home(), '<home>')):
            value = value.replace(str(path), replacement).replace(str(path).replace('\\', '\\\\'), replacement)
        value = re.sub(r'/(?:Users|home|workspace|opt|tmp|usr)/[^\s\"\'<>:]+', '<local-path>', value)
        value = re.sub(r'(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s\"\'<>]+', '<local-path>', value)
        return value

    def write(self):
        (self.evidence / 'summary.json').write_text(self.scrub(json.dumps(self.result, ensure_ascii=False, indent=2)) + '\n', encoding='utf-8')

    def begin(self, stage):
        self.stage = stage
        self.result['status'] = 'RUNNING'
        self.result['stages'][stage] = {'status': 'RUNNING'}
        self.write()

    def passed(self, **details):
        self.result['stages'][self.stage] = {'status': 'PASS', **details}
        self.write()

    def launch(self):
        self.begin('DEPENDENCIES')
        missing = [name for name in ('ortools', 'playwright') if importlib.util.find_spec(name) is None]
        if not shutil.which('node'):
            missing.append('node')
        if missing:
            raise EnvironmentError('Missing existing dependencies: ' + ', '.join(missing) + '; nothing installed')
        from ortools.sat.python import cp_model  # noqa: F401: checks actual native import
        self.passed()
        self.begin('LAUNCHER')
        self.web_port = choose_port(8865, FORBIDDEN_PORTS)
        self.opt_port = choose_port(8887, FORBIDDEN_PORTS | {self.web_port})
        try:
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/local_trial.py'), 'start',
                '--web-port', str(self.web_port), '--opt-port', str(self.opt_port)], cwd=ROOT,
                env=self.env, capture_output=True, text=True, timeout=45)
        except subprocess.TimeoutExpired:
            self.launcher_timeout = True
            raise
        (self.evidence / 'launcher-start.log').write_text(self.scrub(result.stdout + result.stderr), encoding='utf-8')
        assert result.returncode == 0, 'Actual local_trial start failed; see launcher-start.log and service logs'
        self.services_started = True
        record = json.loads((self.run_dir / 'trial.json').read_text(encoding='utf-8'))
        assert record['root'] == str(ROOT) and record['schema'] == 'stct-local-trial-v1'
        assert record['web']['port'] == self.web_port and record['optimizer']['port'] == self.opt_port
        self.record = record
        self.base = f'http://127.0.0.1:{self.web_port}/index.html?optPort={self.opt_port}&noWebGL=1#/'
        self.origins = {f'http://127.0.0.1:{p}' for p in (self.web_port, self.opt_port)}
        self.passed(webPort=self.web_port, optimizerPort=self.opt_port,
                    backendBuildFingerprint=record['backendBuildFingerprint'])

    def make_context(self):
        context = self.browser.new_context(accept_downloads=True, viewport={'width': 1440, 'height': 950},
            reduced_motion='reduce', service_workers='block')
        def restrict(route):
            url = urlsplit(route.request.url)
            if f'{url.scheme}://{url.netloc}' in self.origins or url.scheme in ('data', 'blob'):
                route.continue_()
            else:
                self.result['externalBlocked'].append(f'{url.scheme}://{url.netloc}')
                route.abort()
        context.route('**/*', restrict)
        # No websockets or other loopback services are permitted.
        context.route_web_socket('**/*', lambda socket: socket.close())
        return context

    def new_page(self, context):
        page = context.new_page()
        page.set_default_timeout(25000)
        page.on('pageerror', lambda error: self.result['pageErrors'].append(self.scrub(str(error))))
        page.on('console', lambda message: self.result['consoleErrors'].append(self.scrub(message.text))
                if message.type == 'error' else None)
        def native(request):
            parsed = urlsplit(request.url)
            if parsed.port == self.opt_port and request.method == 'POST':
                self.result['nativeRequests'].append({'path': parsed.path, 'method': request.method,
                    'stage': self.stage})
        page.on('request', native)
        return page

    def workbook(self):
        generator = """const X=require('./vendor/xlsx/xlsx.full.min.js');
const input=JSON.parse(require('fs').readFileSync(0,'utf8')),b=X.utils.book_new();
for(const [name,rows] of input)X.utils.book_append_sheet(b,X.utils.aoa_to_sheet(rows),name);
process.stdout.write(X.write(b,{type:'buffer',bookType:'xlsx'}));"""
        process = subprocess.run(['node', '-e', generator], cwd=ROOT,
            input=json.dumps(SHEETS).encode(), capture_output=True, check=True, timeout=20)
        (self.evidence / 'synthetic-input.xlsx').write_bytes(process.stdout)
        return process.stdout

    def import_workbook(self):
        self.begin('IMPORT_MAPPING_UNITS')
        page = self.page
        login(page, self.base)
        route_to(page, '/platform/data')
        page.locator('[data-v8-kind]').select_option('SUPPLY_CHAIN_PERIOD')
        upload(page.locator('[data-p5-upload]'), 'synthetic-input.xlsx', self.workbook(),
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        action(page, 'profile-confirm').wait_for()
        assert '/design/supply-chain-study' in page.url
        for index in (1, 2):
            page.locator(f'[data-supply-action="mapping-select"][data-supply-id="{index}"]').click()
            field(page, 'blockUnit').select_option('m3')
            if index == 1:
                page.locator('[data-supply-map-field="demandId"]').select_option('1')
                page.locator('[data-supply-map-field="currentSiteId"]').select_option('3')
        field(page, 'studyName').fill('Synthetic enterprise three-scope acceptance')
        field(page, 'classification').select_option('SYNTHETIC')
        assert page.locator('.sc-advanced textarea:visible').count() == 0
        action(page, 'profile-confirm').click()
        current = wait_state(page, lambda s: s.get('study') and (s.get('savedPointer') or {}).get('status') == 'DRAFT')
        assert current['study']['periods'] == PERIODS
        assert len(current['study']['periodDemand']) == len(current['study']['observedInbound']) == 4
        near(sum(r['quantity'] for r in current['study']['periodDemand']), TOTAL)
        assert current['study']['coordinateUse'] == 'UNCONFIRMED'
        assert {r['unit'] for r in current['study']['periodDemand'] + current['study']['observedInbound']} == {'m3'}
        page.screenshot(path=str(self.evidence / 'import-mapping-units.png'), full_page=True)
        self.passed(periods=PERIODS, quantityUnit='m3', outboundQuantity=TOTAL, inboundQuantity=TOTAL,
                    demandPeriods=4, inboundPeriods=4, classification='SYNTHETIC')
        self.begin('MISSING_CRS_GUARD')
        field(page, 'analysisScope').select_option('OUTBOUND_ONLY')
        before = len(self.result['nativeRequests'])
        action(page, 'analyze').click()
        page.locator('[data-supply-preflight]').wait_for()
        page.wait_for_timeout(300)
        assert not state(page).get('snapshot')
        assert not state(page).get('job')
        assert len(self.result['nativeRequests']) == before
        assert page.locator('[data-supply-preflight]').inner_text().strip()
        self.passed(nativeRequestCount=0, resultCreated=False, coordinateAssumption='UNCONFIRMED')

    def configure(self, scope):
        page = self.page
        step(page, 1)
        field(page, 'analysisScope').select_option(scope)
        field(page, 'geoConfirmed').check()
        field(page, 'objective').select_option('DISTANCE')
        if scope != 'UPSTREAM_ONLY':
            field(page, 'networkMode').select_option('MULTI')
            for row in page.locator('.sc-sites tbody tr:has(input[data-supply-site])').all():
                row.locator('input[value="adjust"]').check()
            field(page, 'minSites').fill('1')
            field(page, 'maxSites').fill('2')
        if scope != 'OUTBOUND_ONLY':
            field(page, 'homogeneousDemandConfirmed').check()
            field(page, 'allowAllSupplierSiteEdgesConfirmed').check()
            field(page, 'sourceMode').select_option('FREE')
            field(page, 'supplierTotalMode').select_option('FIXED_OBSERVED' if scope == 'UPSTREAM_ONLY' else 'ADJUSTABLE')
        capacities = page.locator('[data-supply-capacity]')
        reveal(capacities.first)
        for control in capacities.all():
            control.fill('100')
            control.press('Tab')
        if scope == 'FULL_CHAIN':
            field(page, 'capacityPolicy').select_option('PROVIDED')
            for control in page.locator('[data-supply-supplier-capacity]').all():
                control.fill('100')
        if scope == 'FULL_CHAIN':
            rate = page.locator('[data-supply-rate="INBOUND_TRANSPORT"][data-rate-key="amount"]')
            reveal(rate)
            for kind in ('INBOUND_TRANSPORT', 'OUTBOUND_TRANSPORT'):
                page.locator(f'[data-supply-rate="{kind}"][data-rate-key="amount"]').fill('1')
                page.locator(f'[data-supply-rate="{kind}"][data-rate-key="status"]').select_option('KNOWN')
            for kind in ('FIXED_OPERATING', 'HANDLING'):
                page.locator(f'[data-supply-rate="{kind}"][data-rate-key="status"]').select_option('CONFIRMED_ZERO')
            for kind in ('inventoryHolding', 'transferTransport'):
                page.locator(f'[data-supply-scope="{kind}"]').check()
            field(page, 'objective').select_option('COST')
            field(page, 'costMode').select_option('ACTUAL')
            field(page, 'conversionCost').fill('0')

    def solve(self, scope):
        self.begin(f'{scope}:SOLVE_VERIFY')
        self.configure(scope)
        assert self.page.locator('.sc-advanced textarea:visible').count() == 0
        before = len(self.result['nativeRequests'])
        action(self.page, 'analyze').click()
        current = wait_state(self.page, lambda s: bool((s.get('snapshot') or {}).get('rows')) and
            (s['snapshot'].get('analysisScope') or 'OUTBOUND_ONLY') == scope)
        action(self.page, 'export-html').wait_for()
        current = state(self.page)  # Includes the completed post-solve durable save.
        assert len(self.result['nativeRequests']) > before, 'No real optimizer POST observed'
        runs = current['snapshot']['solverRuns']
        assert runs and all(r['engine']['id'] == 'OR_TOOLS_CP_SAT' for r in runs)
        assert current['snapshot']['backendIdentity']['buildFingerprint'] == self.record['backendBuildFingerprint']
        assert current['snapshot']['backendIdentity']['runSpecHash']
        assert (current.get('job') or {}).get('status') == 'COMPLETE'
        verified = independent_verify(current, scope)
        self.passed(snapshotHash=current['snapshot']['snapshotHash'], studyHash=current['study']['inputHash'],
                    nativeJob=current['job']['jobId'], candidateCount=len(current['snapshot']['rows']), verification=verified)
        return current

    def map_report(self, scope, current):
        self.begin(f'{scope}:COMPARISON_MAP_REPORT')
        page, snap = self.page, current['snapshot']
        ranked = snap['decision']['rankedScenarioIds']
        expected = ranked + [r['scenarioId'] for r in snap['rows'] if r['scenarioId'] not in ranked]
        actual = page.locator('.sc-compare tbody tr[data-scenario-id]').evaluate_all('(es) => es.map(e => e.dataset.scenarioId)')
        assert actual == expected, (actual, expected)
        panel = page.locator('[data-supply-map-panel]')
        panel.locator('.p7-map-schematic svg').wait_for()
        assert panel.get_attribute('data-map-selected-scenario') == snap['decision']['focusScenarioId']
        basis = json.loads(panel.locator('.p7-map-basis pre').text_content())
        assert basis['snapshotHash'] == snap['snapshotHash']
        assert basis['studyHash'] == current['study']['inputHash']
        assert panel.locator('.p7-map-schematic polyline').count() > 0
        expected_reference = {'OUTBOUND_ONLY': 'OBSERVED_BASELINE', 'UPSTREAM_ONLY': 'OBSERVED_KNOWN_INBOUND',
                              'FULL_CHAIN': 'SAME_CONDITION_PLANNING_REFERENCE'}[scope]
        assert panel.get_attribute('data-reference') == expected_reference
        if scope == 'UPSTREAM_ONLY':
            assert panel.locator('[data-supply-compare="leg"] option[value="OUTBOUND"]').count() == 0
        page.screenshot(path=str(self.evidence / f'{scope.lower()}-comparison-map.png'), full_page=True)
        action(page, 'report-open').click()
        overlay = page.locator('.scro-overlay')
        overlay.wait_for()
        assert overlay.locator('.rp-table tr[data-scenario-id]').evaluate_all('(es) => es.map(e => e.dataset.scenarioId)') == expected
        assert current['study']['name'] in overlay.inner_text()
        page.screenshot(path=str(self.evidence / f'{scope.lower()}-report.png'), full_page=True)
        overlay.locator('[data-scro-close]').click()
        overlay.wait_for(state='hidden')
        self.passed(candidateOrder=expected, reference=expected_reference, geometry='SCHEMATIC_NOT_ROAD_ROUTE')

    def save_reload(self, scope, current):
        self.begin(f'{scope}:SAVE_RELOAD')
        page = self.page
        prior_revision = (state(page).get('savedPointer') or {}).get('revision', 0)
        action(page, 'draft-save').click()
        saved = wait_state(page, lambda s: (s.get('savedPointer') or {}).get('status') == 'COMPLETE' and
                           (s.get('savedPointer') or {}).get('revision', 0) > prior_revision)
        pointer, expected = saved['savedPointer'], current['snapshot']['snapshotHash']
        page.reload(wait_until='load')
        button = page.locator('#loginForm .login-btn')
        if button.is_visible():
            button.click()
        page.locator('[data-design-route="/design/supply-chain-study"]').wait_for()
        step(page, 0)
        action(page, 'study-list').click()
        page.locator(f'[data-supply-action="study-open"][data-supply-id="{pointer["id"]}"]').click()
        restored = wait_state(page, lambda s: (s.get('snapshot') or {}).get('snapshotHash') == expected)
        assert restored['study']['inputHash'] == current['study']['inputHash']
        assert restored['savedPointer']['revision'] >= pointer['revision']
        assert restored['snapshot']['rows'] == current['snapshot']['rows']
        self.passed(snapshotHash=expected, revision=restored['savedPointer']['revision'], mechanism='PAGE_RELOAD_NATIVE_INDEXEDDB_PUBLIC_REOPEN')

    def download(self, name, filename, page=None, control=None):
        page = page or self.page
        control = control if control is not None else action(page, name)
        reveal(control)
        with page.expect_download() as pending:
            control.click()
        destination = self.evidence / filename
        pending.value.save_as(str(destination))
        assert destination.stat().st_size > 0
        text = destination.read_text(encoding='utf-8-sig')
        assert str(ROOT) not in text and str(self.runtime) not in text and str(self.evidence) not in text
        return text

    def export_reimport(self, scope, current):
        self.begin(f'{scope}:EXPORT_REIMPORT')
        prefix = scope.lower()
        files = {}
        for key, extension in (('html', 'html'), ('csv', 'csv'), ('json', 'json'), ('md', 'md')):
            name = f'{prefix}.{extension}'
            files[extension] = self.download('export-' + key, name)
        name = prefix + '.package.json'
        package_text = self.download('package-export', name)
        packed = json.loads(package_text)
        exported = json.loads(files['json'])
        assert exported.get('snapshot', exported)['snapshotHash'] == current['snapshot']['snapshotHash']
        assert packed['snapshot']['snapshotHash'] == current['snapshot']['snapshotHash']
        assert packed['study']['inputHash'] == current['study']['inputHash']
        assert current['study']['name'] in files['html'] and 'scenarioId' in files['csv']
        assert current['study']['name'] in files['md']
        ranked = current['snapshot']['decision']['rankedScenarioIds']
        expected = ranked + [r['scenarioId'] for r in current['snapshot']['rows'] if r['scenarioId'] not in ranked]
        assert re.findall(r'<tr data-scenario-id="([^"]+)"', files['html']) == expected
        reader = self.make_context()
        try:
            page = self.new_page(reader)
            login(page, self.base)
            route_to(page, '/platform/scenarios')
            upload(page.locator('[data-p5-package]'), name, package_text.encode(), 'application/json')
            page.locator('[data-p5-action="import-package"]').click()
            reopened = wait_state(page, lambda s: (s.get('snapshot') or {}).get('snapshotHash') == current['snapshot']['snapshotHash'])
            assert reopened['study']['inputHash'] == current['study']['inputHash']
            assert reopened['snapshot']['rows'] == current['snapshot']['rows']
            independent_verify(reopened, scope)
            page.screenshot(path=str(self.evidence / f'{prefix}-reimport.png'), full_page=True)
            # Public import must reject a tampered package without replacing current state.
            route_to(page, '/platform/scenarios')
            tampered = json.loads(package_text)
            tampered['snapshot']['snapshotHash'] = 'sha256:' + '0'*64
            upload(page.locator('[data-p5-package]'), 'synthetic-tampered-package.json',
                   json.dumps(tampered).encode(), 'application/json')
            page.wait_for_function('() => /SUPPLY_PACKAGE_INVALID/.test(document.querySelector("[data-p5-message]")?.textContent || "")')
            assert page.locator('[data-p5-action="import-package"]').count() == 0
            assert state(page)['snapshot']['snapshotHash'] == current['snapshot']['snapshotHash']
        finally:
            reader.close()
        self.passed(snapshotHash=current['snapshot']['snapshotHash'], newIsolatedContext=True,
                    formats=['html', 'csv', 'json', 'md', 'package.json'], tamperedPackageRejected=True)

    def reopen_public(self, page, pointer_id):
        if '/design/supply-chain-study' not in page.url:
            route_to(page, '/design/supply-chain-study')
        step(page, 0)
        action(page, 'study-list').click()
        page.locator(f'[data-supply-action="study-open"][data-supply-id="{pointer_id}"]').click()
        page.wait_for_function('''() => {
            const tab = document.querySelector('[data-supply-action="step"][aria-current="step"]');
            return tab && tab.dataset.supplyId !== '0';
        }''').dispose()
        return wait_state(page, lambda s: (s.get('savedPointer') or {}).get('id') == pointer_id)

    def public_history(self, page, pointer_id):
        step(page, 0)
        action(page, 'study-list').click()
        button = page.locator(f'[data-supply-action="study-history"][data-supply-id="{pointer_id}"]')
        button.click()
        versions = page.locator('.sc-versions [data-supply-action="study-version-open"]')
        versions.first.wait_for()
        values = versions.evaluate_all('(es) => es.map(e => e.dataset.supplyId).sort()')
        button.click()
        return values

    def conflict_controls(self, page):
        recovery = page.locator('.sc-recovery-actions')
        recovery.wait_for(state='visible')
        recovery.locator('[data-supply-action="save-as-branch"]').wait_for(state='visible')
        recovery.locator('[data-supply-action="package-export"]').wait_for(state='visible')
        # Save-as-branch is rendered only for a revision conflict, not generic errors.
        assert 'REVISION_CONFLICT' in page.locator('.sc-advanced').last.text_content()
        assert page.locator('.sc-message.is-error').is_visible()
        return recovery

    def same_id_conflict(self, current):
        self.begin('SAME_ID_CONFLICT_RECOVERY')
        page = self.page
        original = self.reopen_public(page, current['savedPointer']['id'])
        pointer = original['savedPointer']
        original_history = self.public_history(page, pointer['id'])
        package = (self.evidence / 'full_chain.package.json').read_bytes()
        # Visible study-file import is deliberately used: it keeps the imported
        # content in the editor so the actual save-conflict recovery UI can be used.
        control = page.locator('[data-supply-file="study"]')
        reveal(control)
        upload(control, 'synthetic-same-id-package.json', package, 'application/json')
        imported = wait_state(page, lambda s: s.get('savedPointer') is None and
                              (s.get('snapshot') or {}).get('snapshotHash') == current['snapshot']['snapshotHash'])
        assert imported['study']['studyId'] == original['study']['studyId']
        action(page, 'draft-save').click()
        recovery = self.conflict_controls(page)
        retained = state(page)
        assert retained['savedPointer'] is None
        assert retained['snapshot']['snapshotHash'] == original['snapshot']['snapshotHash']
        complete_download = json.loads(self.download('package-export', 'same-id-retained-result.package.json',
            control=recovery.locator('[data-supply-action="package-export"]')))
        assert complete_download['snapshot']['snapshotHash'] == original['snapshot']['snapshotHash']
        page.screenshot(path=str(self.evidence / 'same-id-save-conflict.png'), full_page=True)
        # Preserve a genuine unsaved draft through the same recovery controls.
        step(page, 1)
        field(page, 'planName').fill('Synthetic same-ID retained draft')
        field(page, 'planName').press('Tab')
        draft = wait_state(page, lambda s: not s.get('snapshot') and
                           (s.get('scenario') or {}).get('scenarioId') == 'Synthetic same-ID retained draft')
        action(page, 'draft-save').click()
        recovery = self.conflict_controls(page)
        draft_download = json.loads(self.download('package-export', 'same-id-retained-draft.package.json',
            control=recovery.locator('[data-supply-action="package-export"]')))
        assert draft_download['schemaVersion'] == 'stct-supply-chain-draft-v1'
        assert draft_download['scenario'] == draft['scenario']
        assert draft_download['study']['inputHash'] == original['study']['inputHash']
        recovery.locator('[data-supply-action="save-as-branch"]').click()
        branch = wait_state(page, lambda s: s.get('study') and s['study']['studyId'] != original['study']['studyId'] and
                            (s.get('savedPointer') or {}).get('id') == 'SUPPLY:' + s['study']['studyId'])
        assert branch['savedPointer']['status'] == 'DRAFT' and branch['snapshot'] is None
        assert branch['scenario']['scenarioId'] == 'Synthetic same-ID retained draft'
        assert branch['study']['assumptions']['branchOf'] == {
            'studyId': original['study']['studyId'], 'inputHash': original['study']['inputHash']}
        near(sum(r['quantity'] for r in branch['study']['periodDemand']), TOTAL)
        page.screenshot(path=str(self.evidence / 'same-id-saved-as-branch.png'), full_page=True)
        reopened = self.reopen_public(page, pointer['id'])
        assert reopened['savedPointer'] == pointer, 'Branch recovery mutated the original pointer'
        assert reopened['snapshot'] == original['snapshot'], 'Original complete result changed'
        assert self.public_history(page, pointer['id']) == original_history
        self.reopen_public(page, pointer['id'])
        self.passed(originalPointerId=pointer['id'], originalRevision=pointer['revision'],
            originalSnapshotHash=original['snapshot']['snapshotHash'], originalHistoryPreserved=True,
            originalHistoryVersions=len(original_history), retainedCompletePackage=True, retainedDraft=True,
            branchPointerId=branch['savedPointer']['id'], branchStatus='DRAFT',
            openExistingRoute='step 0 -> study-list -> study-open', dedicatedOpenExistingConflictButton=False)
        return branch['savedPointer']['id']

    def cross_tab_conflict(self, original_current, branch_pointer):
        self.begin('CROSS_TAB_EDIT_RECOVERY')
        primary, secondary = self.page, self.new_page(self.context)
        try:
            first = self.reopen_public(primary, branch_pointer)
            first_history = self.public_history(primary, branch_pointer)
            self.reopen_public(primary, branch_pointer)
            login(secondary, self.base)
            second = self.reopen_public(secondary, branch_pointer)
            assert first['savedPointer']['revision'] == second['savedPointer']['revision']
            revision = first['savedPointer']['revision']
            initial_hash = first['study']['inputHash']
            for page in (primary, secondary):
                step(page, 1)
            # These are true study-data edits, not controller calls or DOM injection.
            capacity_a = primary.locator('[data-supply-capacity]').first
            reveal(capacity_a)
            capacity_key = capacity_a.get_attribute('data-supply-capacity')
            capacity_a.fill('111')
            capacity_a.press('Tab')
            field(primary, 'planName').fill('Synthetic winning tab')
            field(primary, 'planName').press('Tab')
            action(primary, 'draft-save').click()
            winner = wait_state(primary, lambda s: (s.get('savedPointer') or {}).get('revision', 0) > revision and
                                ((s.get('savedPointer') or {}).get('scenario') or {}).get('scenarioId') == 'Synthetic winning tab')
            assert winner['study']['inputHash'] != initial_hash
            assert state(secondary)['savedPointer']['revision'] == revision
            capacity_b = secondary.locator(f'[data-supply-capacity="{capacity_key}"]')
            reveal(capacity_b)
            capacity_b.fill('222')
            capacity_b.press('Tab')
            field(secondary, 'planName').fill('Synthetic stale tab retained')
            field(secondary, 'planName').press('Tab')
            action(secondary, 'draft-save').click()
            recovery = self.conflict_controls(secondary)
            stale = state(secondary)
            assert stale['savedPointer']['revision'] == revision
            assert stale['scenario']['scenarioId'] == 'Synthetic stale tab retained'
            assert stale['study']['inputHash'] not in (initial_hash, winner['study']['inputHash'])
            site, period = capacity_key.split('|')
            def capacity(value):
                return next(n for n in value['study']['nodes'] if n['nodeId'] == site)['capacityByPeriod'][period]
            near(capacity(winner), 111)
            near(capacity(stale), 222)
            retained = json.loads(self.download('package-export', 'cross-tab-retained-draft.package.json',
                page=secondary, control=recovery.locator('[data-supply-action="package-export"]')))
            assert retained['scenario'] == stale['scenario']
            assert retained['study']['inputHash'] == stale['study']['inputHash']
            secondary.screenshot(path=str(self.evidence / 'cross-tab-save-conflict.png'), full_page=True)
            recovery.locator('[data-supply-action="save-as-branch"]').click()
            branch = wait_state(secondary, lambda s: s.get('study') and s['study']['studyId'] != stale['study']['studyId'] and
                                (s.get('savedPointer') or {}).get('id') == 'SUPPLY:' + s['study']['studyId'])
            near(capacity(branch), 222)
            assert branch['scenario']['scenarioId'] == 'Synthetic stale tab retained'
            winner_reopened = self.reopen_public(primary, branch_pointer)
            near(capacity(winner_reopened), 111)
            assert winner_reopened['savedPointer'] == winner['savedPointer'], 'Stale tab overwrote winner'
            assert winner_reopened['scenario']['scenarioId'] == 'Synthetic winning tab'
            history = self.public_history(primary, branch_pointer)
            assert set(first_history).issubset(history) and initial_hash in history
            assert winner['study']['inputHash'] in history
            # Open the older study through its actual visible history control, then
            # reopen current. Reading a version must not alter the current pointer.
            action(primary, 'study-list').click()
            primary.locator(f'[data-supply-action="study-history"][data-supply-id="{branch_pointer}"]').click()
            primary.locator(f'[data-supply-action="study-version-open"][data-supply-id="{initial_hash}"]').click()
            historical = wait_state(primary, lambda s: s.get('study') and s['study']['inputHash'] == initial_hash)
            assert historical['snapshot'] is None
            winner_again = self.reopen_public(primary, branch_pointer)
            assert winner_again['savedPointer'] == winner['savedPointer']
            near(capacity(winner_again), 111)
            secondary.screenshot(path=str(self.evidence / 'cross-tab-recovered-branch.png'), full_page=True)
            original = self.reopen_public(primary, original_current['savedPointer']['id'])
            assert original['snapshot'] == original_current['snapshot']
            self.passed(sharedBrowserContext=True, independentTabs=2, originalRevision=revision,
                winnerRevision=winner['savedPointer']['revision'], winningCapacity=111, retainedCapacity=222,
                staleDraftDownloaded=True, staleBranchPointerId=branch['savedPointer']['id'],
                winnerPointerPreserved=True, historyVersions=len(history), publicHistoryOpened=True,
                originalFullChainSnapshotPreserved=True, lateSaveReceiptRace='NOT_RUN_IN_UI_COMPONENT_ONLY')
        finally:
            secondary.close()

    def stale_guard(self, current):
        self.begin('STALE_RESULT_GUARD')
        page = self.page
        step(page, 1)
        field(page, 'maxSites').fill('1')
        field(page, 'maxSites').press('Tab')
        expired = wait_state(page, lambda s: not s.get('snapshot') and
                            (s.get('staleResult') or {}).get('snapshotHash') == current['snapshot']['snapshotHash'])
        route_to(page, '/design/overview')
        panel = page.locator('[data-design-route="/design/overview"] [data-v8-supply-map] .p7-map-workspace')
        panel.wait_for()
        basis = json.loads(panel.locator('.p7-map-basis pre').text_content())
        assert basis['snapshotHash'] is None and basis['selectedScenarioId'] is None
        assert panel.locator('.p7-map-schematic polyline').count() == 0
        page.screenshot(path=str(self.evidence / 'stale-result-hidden.png'), full_page=True)
        route_to(page, '/design/supply-chain-study')
        step(page, 2)
        for name in ('export-html', 'export-csv', 'export-json', 'export-md', 'report-open'):
            controls = action(page, name)
            assert controls.count() == 0 or all(not e.is_visible() or e.is_disabled() for e in controls.all()), name
        self.passed(expiredSnapshotHash=expired['staleResult']['snapshotHash'], currentSnapshotHash=None,
                    relationshipLines=0, staleExportsUnavailable=True)

    def cleanup(self):
        errors = []
        if self.launcher_timeout and not (self.run_dir / 'trial.json').exists():
            errors.append('Launcher timed out without an ownership receipt; no unverified process was signalled')
        if self.context and self.trace_started:
            try:
                raw_trace = self.runtime / 'trace.zip'
                self.context.tracing.stop(path=str(raw_trace))
                with zipfile.ZipFile(raw_trace) as source, zipfile.ZipFile(self.evidence / 'synthetic-ui.trace.zip', 'w', zipfile.ZIP_DEFLATED) as target:
                    for info in source.infolist():
                        data = source.read(info.filename)
                        if info.filename.endswith(('.trace', '.network', '.stacks')):
                            data = self.scrub(data.decode('utf-8')).encode('utf-8')
                        target.writestr(info.filename, data)
            except Exception as exc:
                errors.append('Trace cleanup: ' + str(exc))
        if self.browser:
            try:
                self.browser.close()
            except Exception as exc:
                errors.append('Browser cleanup: ' + str(exc))
        if (self.run_dir / 'trial.json').exists():
            # Production stop verifies process command, root, start time and process group.
            # It never targets another process by port or uses pkill/taskkill by image.
            stopped = subprocess.run([sys.executable, str(ROOT / 'scripts/local_trial.py'), 'stop'],
                cwd=ROOT, env=self.env, capture_output=True, text=True, timeout=35)
            (self.evidence / 'launcher-stop.log').write_text(self.scrub(stopped.stdout + stopped.stderr), encoding='utf-8')
            if stopped.returncode or (self.run_dir / 'trial.json').exists():
                errors.append('Owned launcher stop was not confirmed; runtime record retained')
        for name in ('web.log', 'optimizer.log'):
            if (self.run_dir / name).exists():
                (self.evidence / name).write_text(self.scrub((self.run_dir / name).read_text(errors='replace')), encoding='utf-8')
        if not errors and self.services_started:
            if not all(port_available(p) for p in (self.web_port, self.opt_port)):
                errors.append('Owned service port still occupied after stop; no foreign process touched')
        self.result['stages']['CLEANUP'] = {'status': 'FAIL' if errors else 'PASS', 'errors': errors,
            'servicesStarted': self.services_started, 'browserCreated': self.browser is not None}
        if errors:
            self.result['status'] = 'FAIL'
        else:
            shutil.rmtree(self.runtime)
        self.cleaned = True
        self.write()

    def record_failure(self, exc):
        blocked = isinstance(exc, (ImportError, EnvironmentError)) and self.stage in ('DEPENDENCIES', 'LAUNCHER', 'BROWSER')
        self.result['status'] = 'BLOCKED_ENVIRONMENT' if blocked else 'FAIL'
        self.result['stages'][self.stage] = {'status': self.result['status'], 'error': self.scrub(str(exc))}
        self.result['error'] = self.scrub(traceback.format_exc())
        if self.page:
            try:
                current = state(self.page) or {}
                self.result['failureDiagnostics'] = {
                    'status': current.get('status'), 'lastError': current.get('lastError'),
                    'studyId': (current.get('study') or {}).get('studyId'),
                    'savedPointer': current.get('savedPointer'),
                    'snapshotHash': (current.get('snapshot') or {}).get('snapshotHash'),
                    'messages': self.page.locator('.sc-message, [data-supply-preflight]').all_text_contents(),
                    'visibleStep': self.page.locator('[data-supply-action="step"][aria-current="step"]').get_attribute('data-supply-id'),
                    'route': urlsplit(self.page.url).fragment}
            except Exception:
                pass
            try:
                self.page.screenshot(path=str(self.evidence / 'failure.png'), full_page=True)
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
                    self.passed(browserVersion=self.browser.version, isolatedContext=True, serviceWorkersBlocked=True)
                    self.import_workbook()
                    for scope in SCOPES:
                        current = self.solve(scope)
                        self.map_report(scope, current)
                        self.save_reload(scope, current)
                        self.export_reimport(scope, current)
                    branch_pointer = self.same_id_conflict(current)
                    self.cross_tab_conflict(current, branch_pointer)
                    self.stale_guard(current)
                    assert not self.result['pageErrors'], self.result['pageErrors']
                    assert not self.result['consoleErrors'], self.result['consoleErrors']
                    self.result['status'] = 'PASS'
                except Exception as exc:
                    self.record_failure(exc)
                finally:
                    # Preserve screenshots and traces while the Playwright driver is live.
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
    return Suite(evidence).run()


if __name__ == '__main__':
    sys.exit(main())
