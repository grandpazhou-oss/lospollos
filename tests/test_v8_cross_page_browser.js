#!/usr/bin/env node
'use strict';

// Full application journey through visible business controls. Snapshot reads below
// are supplementary assertions; they never load a study, navigate, or mutate state.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const XLSX = require('../vendor/xlsx/xlsx.full.min.js');

const root = path.resolve(__dirname, '..');
const sourcePath = process.env.STCT_UC_WORKBOOK || '/Users/gz/Downloads/经纬度追加-天津、沈阳、西安、东莞相关入、出库物量数据  202601~07-001 物量数据(1).xlsx';
const evidenceDir = process.env.STCT_V8_BROWSER_DIR || '/Users/gz/Documents/STCT_V8_EXEC_20260927/browser';
const chromePath = process.env.STCT_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidence = name => path.join(evidenceDir, name);
const write = (name, value) => fs.writeFileSync(evidence(name), JSON.stringify(value, null, 2) + '\n');
const near = (actual, expected, tolerance = 0.001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!target.startsWith(root + path.sep)) return response.writeHead(403).end();
  fs.readFile(target, (error, bytes) => error ? response.writeHead(404).end() : response.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(bytes));
});
const freePort = () => new Promise((resolve, reject) => { const socket = net.createServer(); socket.once('error', reject); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
async function ready(port, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Owned optimizer exited ${child.exitCode}`);
    try { const response = await fetch(`http://127.0.0.1:${port}/health`); if (response.ok && (await response.json()).available) return; } catch (_) {}
    await pause(100);
  }
  throw new Error('Owned optimizer health did not become available');
}

const adapter = page => page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.snapshot());
const supply = page => page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot());
async function clickRoute(page, route) {
  const button = page.locator(`button[data-platform-route="${route}"]:visible`).first();
  await button.click();
  await page.waitForFunction(expected => window.location.hash.split('?')[0] === `#${expected}`, route);
}
async function home(page) {
  if (!await page.locator('.platform-home').isVisible()) await clickRoute(page, '/');
  await page.locator('.platform-home').waitFor();
}
async function enterVisibleLogin(page) {
  const login = page.locator('#loginForm .login-btn');
  if (await login.isVisible()) await login.click();
}
async function loginAtHome(page, base) {
  await page.goto(`${base}#/`, { waitUntil: 'load' });
  await enterVisibleLogin(page);
  await page.locator('.platform-home').waitFor();
}
async function screenshot(page, name) { await page.screenshot({ path: evidence(name), fullPage: true }); }
async function download(page, action, name) {
  const control = page.locator(`[data-supply-action="${action}"]`);
  if (!await control.isVisible()) {
    const details = control.locator('xpath=ancestor::details[1]');
    if (await details.count() && !await details.evaluate(element => element.open)) await details.locator('summary').click();
  }
  const pending = page.waitForEvent('download');
  await control.click();
  const item = await pending;
  await item.saveAs(evidence(name));
  assert.ok(fs.statSync(evidence(name)).size > 0);
  return evidence(name);
}
async function waitSupply(page, predicate, timeout = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const current = await supply(page);
    if (predicate(current)) return current;
    if (current?.status === 'FAILED') throw new Error(`Supply failed: ${JSON.stringify(current.lastError)}`);
    await pause(150);
  }
  throw new Error('Supply browser state timed out');
}

async function assertSupplyComparisonMap(page, current, label) {
  const panel = page.locator('[data-supply-map-panel]');
  await panel.waitFor();
  await panel.locator('.p7-map-schematic svg').waitFor();
  assert.equal(await panel.getAttribute('data-map-selected-scenario'), await panel.locator('[data-supply-compare="scenarioId"]').inputValue());
  assert.ok(await panel.locator('.p7-map-schematic polyline').count() > 0, `${label}: no visible assignment relationships`);
  assert.doesNotMatch(await panel.locator('.sc-map-metric strong').first().innerText(), /—\s*→\s*—/, `${label}: weighted distances must come from the selected snapshot`);
  assert.match(await panel.locator('.p7-map-legend').innerText(), /不是道路路线|not road routes/i);
  const before = JSON.parse(await panel.locator('.p7-map-basis pre').textContent());
  assert.equal(before.snapshotHash, current.snapshot.snapshotHash);
  assert.equal(before.selectedScenarioId, await panel.getAttribute('data-map-selected-scenario'));
  await panel.locator('[data-supply-compare="mode"]').selectOption('CANDIDATE');
  assert.equal(JSON.parse(await panel.locator('.p7-map-basis pre').textContent()).mode, 'CANDIDATE');
  await panel.locator('[data-supply-compare="period"]').selectOption(current.study.periods[0]);
  assert.equal(JSON.parse(await panel.locator('.p7-map-basis pre').textContent()).period, current.study.periods[0]);
  await panel.locator('[data-supply-compare="mode"]').selectOption('BOTH');
  assert.equal(JSON.parse(await panel.locator('.p7-map-basis pre').textContent()).mode, 'BOTH');
  const candidates = await panel.locator('[data-supply-compare="scenarioId"] option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
  if (candidates.length > 1) {
    const alternate = candidates.find(id => id !== before.selectedScenarioId);
    await panel.locator('[data-supply-compare="scenarioId"]').selectOption(alternate);
    assert.equal(await panel.getAttribute('data-map-selected-scenario'), alternate);
    assert.equal(JSON.parse(await panel.locator('.p7-map-basis pre').textContent()).selectedScenarioId, alternate);
  }
  await page.setViewportSize({ width: 390, height: 1200 });
  assert.ok(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 2), `${label}: map panel overflows at 390px`);
  await panel.evaluate(node => node.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: evidence(`${label}-map-mobile.png`) });
  await page.setViewportSize({ width: 1280, height: 1200 });
  await panel.evaluate(node => node.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: evidence(`${label}-map-desktop.png`) });
  await page.setViewportSize({ width: 1280, height: 800 });
}

function syntheticWorkbook() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['role', 'coordinate', 'code', 'name'], ['FACTORY', '118,31', 'P', 'Factory Pine'], ['FACTORY', '119,31', 'Q', 'Factory Quartz'],
    ['FACTORY', '120,31', 'R', 'Factory River'], ['DC', '118.1,31', 'E', 'Depot Elm'],
    ['DC', '119.1,31', 'W', 'Depot Willow'], ['DC', '120.1,31', 'N', 'Depot North']
  ]), 'Asset register');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['2027/09', 'customer', 'coordinate', 'number', 'assignedDepot', '2027/03'],
    [8, 'Outlet Amber', '118.2,31', 'A', 'E', 5], [11, 'Outlet Blue', '119.2,31', 'B', 'W', 7],
    [12, 'Outlet Coral', '120.2,31', 'C', 'N', 3], [13, 'Outlet Dune', '118.3,31', 'D', 'E', 9]
  ]), 'Sales periods');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['2027/09', 'toNodeId', 'flowId', '2027/03', 'fromNodeId'], [21, 'E', 'IE', 14, 'P'],
    [11, 'W', 'IW', 7, 'Q'], [12, 'N', 'IN', 3, 'R']
  ]), 'Receipts periods');
  return XLSX.write(book, { bookType: 'xlsx', type: 'buffer' });
}

async function publicSupplyImport(page, file, studyName) {
  await home(page);
  await clickRoute(page, '/platform/data');
  await page.locator('select[data-v8-kind]').selectOption('SUPPLY_CHAIN_PERIOD');
  await page.locator('input[data-p5-upload]').setInputFiles(file);
  await page.locator('[data-design-route="/design/supply-chain-study"]').waitFor({ timeout: 30000 });
  await page.locator('[data-supply-action="profile-confirm"]').waitFor({ timeout: 30000 });
  await page.locator('[data-supply-field="studyName"]').fill(studyName);
  assert.equal(await page.locator('.sc-advanced textarea:visible').count(), 0, 'Normal import must not require JSON');
  await page.locator('[data-supply-action="profile-confirm"]').click();
  return waitSupply(page, current => current?.study && current.savedPointer?.status === 'DRAFT');
}

async function analyzeOutbound(page) {
  await page.locator('[data-supply-action="step"][data-supply-id="1"]').click();
  await page.locator('[data-supply-field="analysisScope"]').selectOption('OUTBOUND_ONLY');
  await page.locator('[data-supply-field="networkMode"]').selectOption('FIXED');
  await page.locator('[data-supply-field="geoConfirmed"]').check();
  await page.locator('[data-supply-action="analyze"]').click();
  return waitSupply(page, current => current?.snapshot?.rows?.length > 0);
}

async function catalogOpen(page, name) {
  await clickRoute(page, '/platform/scenarios');
  const search = page.locator('[data-p5-field="search"]');
  await search.fill(name);
  await search.press('Tab');
  const row = page.getByRole('link', { name, exact: true }).locator('xpath=ancestor::tr[1]');
  await row.waitFor();
  assert.equal(await row.count(), 1, `One exact catalog row for ${name}`);
  await row.locator('[data-p5-action="open"]').click();
  await page.locator('[data-design-route="/design/supply-chain-study"]').waitFor();
}

async function assertVisibleCurrent(page, name, route) {
  await clickRoute(page, route);
  const marker = page.locator('[data-v8-current-study]:visible').first();
  await marker.waitFor();
  assert.match(await marker.innerText(), new RegExp(name));
  return marker.getAttribute('data-study-id');
}
async function assertSupplyOverviewMap(page, current, snapshotHash) {
  await clickRoute(page, '/design/overview');
  const slot = page.locator('[data-design-route="/design/overview"] [data-v8-supply-map]');
  const map = slot.locator('.p7-map-workspace');
  await map.waitFor({ state: 'visible' });
  assert.equal(await map.getAttribute('data-map-mode'), 'SCHEMATIC', 'No-WebGL must show the mapped schematic');
  await map.locator('.p7-map-schematic svg').waitFor({ state: 'visible' });
  assert.equal(Number(await map.locator('[data-p7-kind="all"] strong').innerText()), current.study.nodes.length);
  const details = map.locator('.p7-map-basis');
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
  const basis = JSON.parse(await details.locator('pre').innerText());
  assert.equal(basis.studyId, current.study.studyId);
  assert.equal(basis.studyHash, current.study.inputHash);
  assert.equal(basis.snapshotHash, snapshotHash);
  assert.equal(basis.focusScenarioId, snapshotHash ? current.snapshot.decision.focusScenarioId : null);
  assert.equal(basis.geometry, 'BUSINESS_RELATION_ONLY_NOT_ROAD_ROUTE');
  if (snapshotHash) {
    assert.ok(await map.locator('.p7-map-schematic polyline').count() > 0, 'Current assignment relationships must render');
    assert.match(await map.locator('.p7-map-legend').innerText(), /不是道路路线/);
  } else {
    assert.equal(await map.locator('.p7-map-schematic polyline').count(), 0, 'Old result relationships must disappear');
    assert.match(await map.locator('.p7-map-legend').innerText(), /尚无当前有效结果/);
  }
  return { nodeCount: current.study.nodes.length, snapshotHash: basis.snapshotHash, focusScenarioId: basis.focusScenarioId, mode: await map.getAttribute('data-map-mode') };
}

(async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const originalHash = hash(sourcePath);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stct-v8-browser-'));
  const ucCopy = path.join(temp, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, ucCopy);
  assert.equal(hash(ucCopy), originalHash);
  const optimizerPort = await freePort();
  const optimizerBase = `http://127.0.0.1:${optimizerPort}`;
  const optimizer = spawn(process.env.STCT_PYTHON || 'python3', ['optimizer/ortools_service.py'], { cwd: root, env: { ...process.env, OPT_PORT: String(optimizerPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser, context, page, optimizerLog = '', staticPort = null, stage = 'STARTUP';
  const summary = { status: 'RUNNING', method: 'PLAYWRIGHT_VISIBLE_BUSINESS_CONTROLS', originalSha256: originalHash, stages: [], pageErrors: [], externalBlocked: [] };
  optimizer.stdout.on('data', chunk => { optimizerLog += chunk; });
  optimizer.stderr.on('data', chunk => { optimizerLog += chunk; });
  try {
    await ready(optimizerPort, optimizer);
    staticPort = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
    summary.services = { staticPort, optimizerPort, optimizerPid: optimizer.pid, loopbackOnly: true };
    browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-webgl'] });
    context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'blob:', 'file:'].includes(url.protocol)) return route.continue();
      summary.externalBlocked.push(url.origin);
      return route.abort();
    });
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => summary.pageErrors.push(error.message));
    const base = `http://127.0.0.1:${staticPort}/index.html?optPort=${optimizerPort}&noWebGL=1`;
    stage = 'HOME_DEMO_A';
    await loginAtHome(page, base);
    const routingGuard = await page.evaluate(() => window.fetchOsrmCoords([[120, 30], [121, 31]]).then(() => 'UNEXPECTED_SUCCESS', error => error.message));
    assert.equal(routingGuard, 'ROAD_COORDINATE_SYSTEM_UNCONFIRMED');
    assert.equal(summary.externalBlocked.filter(origin => origin.includes('project-osrm.org')).length, 0, 'Default configuration must not disclose coordinates to public OSRM');
    assert.equal(await page.locator('#overviewContent').innerHTML(), '', 'Home must not initialize the old dashboard');
    const startup = await page.evaluate(() => ({
      command: window.STCTPlatformV19.instance.commandAdapter.diagnostics().sharedAuthority,
      legacyDesign: window.STCTPlatformV19.instance.designAdapter.diagnostics().study,
      mapInstances: window.STCTPlatformV19.mapRuntime.diagnostics().mapInstances
    }));
    assert.equal(startup.command, null, 'Home must not create COMMAND context');
    assert.equal(startup.legacyDesign, null, 'Home must not create a Network study');
    assert.equal(startup.mapInstances, 0, 'Home must not construct an unused map');
    summary.startup = startup;
    await page.locator('.platform-home button[data-platform-workspace="DESIGN"]').click();
    await page.locator('[data-design-route="/design/overview"]').waitFor();
    if (await page.locator('[data-design-action="p7-demo"]').count()) await page.locator('[data-design-action="p7-demo"]').click();
    const demo = await adapter(page);
    assert.ok(demo.studyRef?.studyId, 'Demo A must be an explicit study');
    await clickRoute(page, '/platform/scenarios');
    await page.locator('[data-p5-field="scenarioName"]').fill('V8 Demo A');
    await page.locator('[data-p5-action="save-study"]').click();
    await page.locator('[data-p5-entry]').filter({ hasText: 'V8 Demo A' }).waitFor();
    summary.demoA = { studyId: demo.studyRef.studyId, inputHash: demo.studyRef.inputHash, name: 'V8 Demo A' };
    await screenshot(page, '01-demo-a.png');
    summary.stages.push(stage);

    stage = 'PUBLIC_IMPORT_UC_B';
    const ucName = 'V8 UC B';
    let current = await publicSupplyImport(page, ucCopy, ucName);
    assert.equal(current.study.periodDemand.length, 1799);
    assert.equal(current.study.observedInbound.length, 84);
    near(current.study.periodDemand.reduce((total, row) => total + row.quantity, 0), 115934.168);
    near(current.study.observedInbound.reduce((total, row) => total + row.quantity, 0), 97370.239);
    assert.match(await page.locator('.sc-panel').innerText(), /257|1,799/);
    const ucStudyId = current.study.studyId;
    const ucOriginalInputHash = current.study.inputHash;
    summary.ucB = { studyId: ucStudyId, inputHash: ucOriginalInputHash, pointerId: current.savedPointer.id, demandRecords: current.study.periodDemand.length, inboundRecords: current.study.observedInbound.length };
    await screenshot(page, '02-uc-b-import.png');
    summary.stages.push(stage);

    stage = 'UC_ANALYZE_AND_CATALOG';
    current = await analyzeOutbound(page);
    assert.ok(current.snapshot.rows.length);
    await assertSupplyComparisonMap(page, current, 'uc-outbound');
    const ucAnalyzedInputHash = current.study.inputHash;
    summary.ucB.analyzedInputHash = ucAnalyzedInputHash;
    summary.ucB.snapshotHash = current.snapshot.snapshotHash;
    await catalogOpen(page, ucName);
    current = await supply(page);
    assert.equal(current.study.studyId, ucStudyId);
    assert.equal(current.study.inputHash, ucAnalyzedInputHash);
    assert.equal(current.snapshot.snapshotHash, summary.ucB.snapshotHash);
    await screenshot(page, '03-uc-b-catalog-reopen.png');
    summary.ucB.overviewMap = await assertSupplyOverviewMap(page, current, current.snapshot.snapshotHash);
    await screenshot(page, '03-uc-b-overview-map.png');
    summary.stages.push(stage);

    stage = 'UC_COST_AND_GROWTH';
    const costId = await assertVisibleCurrent(page, ucName, '/design/cost-to-serve');
    const costText = await page.locator('[data-design-route="/design/cost-to-serve"]').innerText();
    assert.match(costText, /115,?934\.168/);
    assert.match(costText, /UNKNOWN.*(费率|费用)|费用.*(未知|缺失)|费率.*(未知|缺失)/);
    assert.doesNotMatch(costText, /30,?337\.744/, 'UC must not display Demo A synthetic cost');
    const growthId = await assertVisibleCurrent(page, ucName, '/design/demand-growth');
    assert.ok(costId && costId.includes(ucStudyId), 'Visible cost study ID must identify UC B');
    assert.equal(growthId, costId);
    await page.locator('[data-design-action="supply-demand-10"]').click();
    const derived = await waitSupply(page, state => state?.study?.studyId !== ucStudyId && state?.study?.periodDemand?.length === 1799);
    near(derived.study.periodDemand.reduce((total, row) => total + row.quantity, 0), 127527.5848);
    assert.notEqual(derived.study.inputHash, ucAnalyzedInputHash, 'Growth must create a new input version');
    await page.waitForFunction(() => /127,?527\.5848/.test(document.querySelector('[data-design-route="/design/demand-growth"]')?.textContent || ''));
    const growthText = await page.locator('[data-design-route="/design/demand-growth"]').innerText();
    assert.match(growthText, /127,?527\.5848/);
    assert.match(await page.locator('[data-v8-current-study]').first().innerText(), /\+10%/);
    summary.derivedB = { studyId: derived.study.studyId, inputHash: derived.study.inputHash, totalVolume: 127527.5848 };
    await screenshot(page, '04-uc-b-growth.png');
    summary.derivedB.overviewMap = await assertSupplyOverviewMap(page, derived, null);
    assert.notEqual(summary.derivedB.overviewMap.snapshotHash, summary.ucB.snapshotHash, 'Derived input cannot display the old result');
    await screenshot(page, '04-derived-b-overview-map.png');
    summary.stages.push(stage);

    stage = 'EXPLICIT_SWITCH_A_THEN_B';
    await clickRoute(page, '/platform/scenarios');
    await page.locator('[data-p5-field="search"]').fill('');
    await page.locator('[data-p5-field="search"]').press('Tab');
    const demoRow = page.locator('[data-p5-entry]').filter({ hasText: 'V8 Demo A' });
    await demoRow.waitFor();
    await demoRow.locator('[data-p5-action="open"]').click();
    await page.locator('[data-design-route="/design/network-scenarios"]').waitFor();
    const restoredDemo = await adapter(page);
    assert.equal(restoredDemo.studyRef.studyId, demo.studyRef.studyId);
    assert.equal(restoredDemo.studyRef.inputHash, demo.studyRef.inputHash);
    await catalogOpen(page, ucName);
    assert.equal((await supply(page)).study.inputHash, ucAnalyzedInputHash);
    near((await supply(page)).study.periodDemand.reduce((total, row) => total + row.quantity, 0), 115934.168);
    summary.stages.push(stage);

    stage = 'REFRESH_AND_REOPEN';
    await page.reload({ waitUntil: 'load' });
    await enterVisibleLogin(page);
    await page.locator('[data-design-route="/design/supply-chain-study"]').waitFor();
    await catalogOpen(page, ucName);
    assert.equal((await supply(page)).study.studyId, ucStudyId);
    assert.equal((await supply(page)).study.inputHash, ucAnalyzedInputHash);
    summary.stages.push(stage);

    stage = 'NON_UC_PUBLIC_IMPORT';
    const syntheticContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    await syntheticContext.route('**/*', route => {
      const url = new URL(route.request().url());
      if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'blob:', 'file:'].includes(url.protocol)) return route.continue();
      summary.externalBlocked.push(url.origin);
      return route.abort();
    });
    const syntheticPage = await syntheticContext.newPage();
    syntheticPage.on('pageerror', error => summary.pageErrors.push(error.message));
    try {
      await loginAtHome(syntheticPage, base);
      const synthetic = await publicSupplyImport(syntheticPage, { name: 'non-uc-different-layout.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(syntheticWorkbook()) }, 'V8 Synthetic C');
      assert.equal(synthetic.study.periodDemand.length, 8);
      assert.deepEqual(synthetic.study.periods, ['2027-03', '2027-09']);
      near(synthetic.study.periodDemand.reduce((total, row) => total + row.quantity, 0), 68);
      await syntheticPage.locator('[data-supply-action="step"][data-supply-id="1"]').click();
      await syntheticPage.locator('[data-supply-field="analysisScope"]').selectOption('FULL_CHAIN');
      await syntheticPage.locator('[data-supply-field="geoConfirmed"]').check();
      await syntheticPage.locator('[data-supply-field="homogeneousDemandConfirmed"]').check();
      await syntheticPage.locator('[data-supply-field="allowAllSupplierSiteEdgesConfirmed"]').check();
      await syntheticPage.locator('[data-supply-field="sourceMode"]').selectOption('FREE');
      await syntheticPage.locator('[data-supply-field="supplierTotalMode"]').selectOption('ADJUSTABLE');
      await syntheticPage.locator('[data-supply-field="networkMode"]').selectOption('MULTI');
      for (const row of await syntheticPage.locator('.sc-sites tbody tr:has(input[data-supply-site])').all()) await row.locator('input[value="adjust"]').check();
      await syntheticPage.locator('[data-supply-field="minSites"]').fill('1');
      await syntheticPage.locator('[data-supply-field="maxSites"]').fill('3');
      await syntheticPage.locator('.sc-supplements summary:has-text("费率与费用范围")').click();
      for (const [kind, amount] of [['INBOUND_TRANSPORT', '1'], ['OUTBOUND_TRANSPORT', '1'], ['FIXED_OPERATING', '10'], ['HANDLING', '.5']]) {
        await syntheticPage.locator(`[data-supply-rate="${kind}"][data-rate-key="amount"]`).fill(amount);
        await syntheticPage.locator(`[data-supply-rate="${kind}"][data-rate-key="status"]`).selectOption('KNOWN');
      }
      for (const key of ['inventoryHolding', 'transferTransport']) await syntheticPage.locator(`[data-supply-scope="${key}"]`).check();
      await syntheticPage.locator('.sc-supplements summary:has-text("各仓逐期容量")').click();
      for (const field of await syntheticPage.locator('[data-supply-capacity]').all()) await field.fill('100');
      await syntheticPage.locator('[data-supply-field="capacityPolicy"]').selectOption('PROVIDED');
      for (const field of await syntheticPage.locator('[data-supply-supplier-capacity]').all()) await field.fill('100');
      await syntheticPage.locator('[data-supply-field="conversionCost"]').fill('0');
      await syntheticPage.locator('[data-supply-action="analyze"]').click();
      const costStudy = await waitSupply(syntheticPage, s => s?.snapshot?.analysisScope === 'FULL_CHAIN' && s.snapshot.rows?.length > 0, 180000);
      assert.ok(costStudy.snapshot.rows.every(row => Number.isFinite(row.metrics.operatingCost)));
      await assertSupplyComparisonMap(syntheticPage, costStudy, 'synthetic-full-chain');
      await assertVisibleCurrent(syntheticPage, 'V8 Synthetic C', '/design/cost-to-serve');
      const amount = syntheticPage.locator('[data-v8-cost-amount]:visible').first();
      await amount.waitFor();
      const displayed = Number(await amount.getAttribute('data-value'));
      assert.ok(Number.isFinite(displayed) && displayed > 0, 'Known cost must be visible as a nonzero value');
      const ledgerValues = [costStudy.snapshot.baseline, costStudy.snapshot.planningReference, ...costStudy.snapshot.rows]
        .map(row => row?.metrics?.operatingCost).filter(Number.isFinite);
      assert.ok(ledgerValues.some(value => Math.abs(value - displayed) < 0.01), 'Cost page must show this study\'s calculated ledger value');
      await clickRoute(syntheticPage, '/design/supply-chain-study');
      const exportNames = { html: 'non-uc-full.html', csv: 'non-uc-full.csv', json: 'non-uc-full.json', md: 'non-uc-full.md', package: 'non-uc-full.package.json' };
      const exportPaths = {};
      for (const [format, name] of Object.entries(exportNames)) exportPaths[format] = await download(syntheticPage, format === 'package' ? 'package-export' : `export-${format}`, name);
      const reportJson = JSON.parse(fs.readFileSync(exportPaths.json, 'utf8'));
      const packed = JSON.parse(fs.readFileSync(exportPaths.package, 'utf8'));
      assert.equal((reportJson.snapshot || reportJson).snapshotHash, costStudy.snapshot.snapshotHash);
      assert.equal(packed.snapshot.snapshotHash, costStudy.snapshot.snapshotHash);
      assert.equal(packed.study.inputHash, costStudy.study.inputHash);
      for (const format of ['html', 'md']) assert.match(fs.readFileSync(exportPaths[format], 'utf8'), /V8 Synthetic C/);
      assert.match(fs.readFileSync(exportPaths.csv, 'utf8'), /scenarioId/);
      summary.nonUcExports = { snapshotHash: costStudy.snapshot.snapshotHash, studyHash: costStudy.study.inputHash, files: Object.values(exportNames).map(name => ({ name, bytes: fs.statSync(evidence(name)).size, sha256: hash(evidence(name)) })) };
      const reader = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      await reader.route('**/*', route => {
        const url = new URL(route.request().url());
        if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'blob:', 'file:'].includes(url.protocol)) return route.continue();
        summary.externalBlocked.push(url.origin);
        return route.abort();
      });
      try {
        const readerPage = await reader.newPage();
        readerPage.on('pageerror', error => summary.pageErrors.push(error.message));
        await loginAtHome(readerPage, base);
        await clickRoute(readerPage, '/platform/scenarios');
        await readerPage.locator('[data-p5-package]').setInputFiles(exportPaths.package);
        await readerPage.locator('[data-p5-action="import-package"]').waitFor({ state: 'visible' });
        await readerPage.locator('[data-p5-action="import-package"]').click();
        await readerPage.locator('[data-design-route="/design/supply-chain-study"]').waitFor();
        const reopened = await waitSupply(readerPage, value => value?.snapshot?.snapshotHash === costStudy.snapshot.snapshotHash);
        assert.equal(reopened.study.inputHash, costStudy.study.inputHash);
        await assertVisibleCurrent(readerPage, 'V8 Synthetic C', '/design/cost-to-serve');
        summary.nonUcExports.publicReadback = true;
        await readerPage.screenshot({ path: evidence('06-non-uc-package-readback.png'), fullPage: true });
      } finally { await reader.close(); }
      await screenshot(syntheticPage, '05-non-uc-public-import.png');
      summary.syntheticC = { studyId: synthetic.study.studyId, demandRecords: synthetic.study.periodDemand.length, periods: synthetic.study.periods, totalVolume: 68, classification: synthetic.study.classification, cost: displayed, snapshotHash: costStudy.snapshot.snapshotHash };
    } catch (error) {
      try { await screenshot(syntheticPage, 'failure-non-uc.png'); } catch (_) {}
      throw error;
    } finally { await syntheticContext.close(); }
    summary.stages.push(stage);

    stage = 'FINISH';
    assert.deepEqual(summary.pageErrors, []);
    assert.equal(hash(sourcePath), originalHash);
    summary.originalUnchanged = true;
    summary.status = 'PASS';
    await context.tracing.stop({ path: evidence('cross-page.trace.zip') });
    write('browser-summary.json', summary);
    console.log(JSON.stringify({ status: 'PASS', method: summary.method, stages: summary.stages, ucB: summary.ucB, syntheticC: summary.syntheticC, evidenceDir }));
  } catch (error) {
    summary.status = 'FAIL';
    summary.failedStage = stage;
    summary.error = String(error.stack || error);
    if (page) { try { await screenshot(page, 'failure.png'); } catch (_) {} }
    if (context) { try { await context.tracing.stop({ path: evidence('failure.trace.zip') }); } catch (_) {} }
    write('browser-summary.json', summary);
    console.error(JSON.stringify({ status: 'FAIL', stage, error: summary.error, evidenceDir }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (optimizer.exitCode === null && optimizer.signalCode === null) {
      const stopped = new Promise(resolve => optimizer.once('exit', resolve));
      optimizer.kill('SIGTERM');
      await Promise.race([stopped, pause(5000)]);
      if (optimizer.exitCode === null && optimizer.signalCode === null) { optimizer.kill('SIGKILL'); await stopped; }
    }
    fs.writeFileSync(evidence('optimizer-service.log'), optimizerLog);
    summary.cleanup = { optimizerPid: optimizer.pid, optimizerExitCode: optimizer.exitCode, optimizerSignalCode: optimizer.signalCode, staticClosed: !server.listening };
    summary.originalUnchanged = hash(sourcePath) === originalHash;
    write('browser-summary.json', summary);
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
