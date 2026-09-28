#!/usr/bin/env node
'use strict';

// Native UC acceptance from the public Data Hub. Page actions use visible
// business controls; state reads are assertions only.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const sourcePath = process.env.STCT_UC_WORKBOOK || '/Users/gz/Downloads/经纬度追加-天津、沈阳、西安、东莞相关入、出库物量数据  202601~07-001 物量数据(1).xlsx';
const evidenceDir = process.env.STCT_V8_UC_SCOPES_DIR || '/Users/gz/Documents/STCT_V8_EXEC_20260927/browser/uc-scopes';
const chromePath = process.env.STCT_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const file = name => path.join(evidenceDir, name);
const hash = name => crypto.createHash('sha256').update(fs.readFileSync(name)).digest('hex');
const write = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const near = (actual, expected, tolerance = 0.03) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (±${tolerance})`);
const state = page => page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot());
const action = (page, name) => page.locator(`[data-supply-action="${name}"]`);
const field = (page, name) => page.locator(`[data-supply-field="${name}"]`);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!target.startsWith(root + path.sep)) return response.writeHead(403).end();
  fs.readFile(target, (error, bytes) => error ? response.writeHead(404).end() : response.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(bytes));
});
const freePort = () => new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
});
async function ready(port, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Owned optimizer exited ${child.exitCode}`);
    try { const response = await fetch(`http://127.0.0.1:${port}/health`); if (response.ok && (await response.json()).available) return; } catch (_) {}
    await pause(100);
  }
  throw new Error('Owned optimizer health did not become available');
}
async function login(page, base) {
  await page.goto(`${base}#/`, { waitUntil: 'load' });
  const button = page.locator('#loginForm .login-btn');
  if (await button.isVisible()) await button.click();
  await page.locator('.platform-home').waitFor();
}
async function clickRoute(page, route) {
  await page.locator(`button[data-platform-route="${route}"]:visible`).first().click();
  await page.waitForFunction(expected => window.location.hash.split('?')[0] === `#${expected}`, route);
}
async function waitSupply(page, predicate, timeout = 240000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const current = await state(page);
    if (predicate(current)) return current;
    if (current?.status === 'FAILED') throw new Error(`Supply failed: ${JSON.stringify(current.lastError)}`);
    await pause(150);
  }
  throw new Error('Supply browser state timed out');
}
async function download(page, name, output) {
  const control = action(page, name);
  if (!await control.isVisible()) {
    const details = control.locator('xpath=ancestor::details[1]');
    if (await details.count() && !await details.evaluate(element => element.open)) await details.locator('summary').click();
  }
  const pending = page.waitForEvent('download', { timeout: 30000 });
  await control.click();
  await (await pending).saveAs(file(output));
  assert.ok(fs.statSync(file(output)).size > 0);
  return fs.readFileSync(file(output), 'utf8');
}
async function setScope(page, scope, counts = null) {
  await page.locator('[data-supply-action="step"][data-supply-id="1"]').click();
  await field(page, 'analysisScope').selectOption(scope);
  await field(page, 'geoConfirmed').check();
  if (scope !== 'OUTBOUND_ONLY') {
    await field(page, 'homogeneousDemandConfirmed').check();
    await field(page, 'allowAllSupplierSiteEdgesConfirmed').check();
    await field(page, 'sourceMode').selectOption('FREE');
    await field(page, 'supplierTotalMode').selectOption(scope === 'UPSTREAM_ONLY' ? 'FIXED_OBSERVED' : 'ADJUSTABLE');
  }
  if (counts) {
    await field(page, 'networkMode').selectOption('MULTI');
    for (const row of await page.locator('.sc-sites tbody tr:has(input[data-supply-site])').all()) await row.locator('input[value="adjust"]').check();
    await field(page, 'minSites').fill(String(counts[0]));
    await field(page, 'maxSites').fill(String(counts[1]));
  } else if (scope === 'OUTBOUND_ONLY') await field(page, 'networkMode').selectOption('FIXED');
}
async function analyze(page, scope, previousHash = null) {
  assert.equal(await page.locator('.sc-advanced textarea:visible').count(), 0);
  await action(page, 'analyze').click();
  const current = await waitSupply(page, value => value?.snapshot?.rows?.length > 0 &&
    value.snapshot.snapshotHash !== previousHash && (value.snapshot.analysisScope || 'OUTBOUND_ONLY') === scope);
  await action(page, 'export-html').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.sc-business-brief li').count(), 5);
  const ranked = current.snapshot.decision?.rankedScenarioIds || [];
  const expected = [...ranked, ...current.snapshot.rows.map(row => row.scenarioId).filter(id => !ranked.includes(id))];
  const actual = await page.locator('.sc-compare tbody tr[data-scenario-id]').evaluateAll(rows => rows.map(row => row.dataset.scenarioId));
  assert.deepEqual(actual, expected, `${scope} visible candidate order`);
  return current;
}
async function exportScope(page, label, current) {
  const snapshotHash = current.snapshot.snapshotHash;
  const names = { html: `${label}.html`, csv: `${label}.csv`, json: `${label}.json`, md: `${label}.md`, package: `${label}.package.json` };
  const html = await download(page, 'export-html', names.html);
  const csv = await download(page, 'export-csv', names.csv);
  const json = JSON.parse(await download(page, 'export-json', names.json));
  const md = await download(page, 'export-md', names.md);
  const packed = JSON.parse(await download(page, 'package-export', names.package));
  assert.equal((json.snapshot || json).snapshotHash, snapshotHash);
  assert.equal(packed.snapshot.snapshotHash, snapshotHash);
  assert.equal(packed.study.inputHash, current.study.inputHash);
  assert.match(html, /<html lang="zh"/);
  assert.match(html, new RegExp(current.study.name));
  assert.match(csv, /scenarioId/);
  assert.match(md, new RegExp(current.study.name));
  const expected = [...current.snapshot.decision.rankedScenarioIds, ...current.snapshot.rows.map(row => row.scenarioId).filter(id => !current.snapshot.decision.rankedScenarioIds.includes(id))];
  const visible = [...html.matchAll(/<tr data-scenario-id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(visible, expected, `${label} native HTML candidate order`);
  await page.screenshot({ path: file(`${label}-app.png`), fullPage: true });
  return { snapshotHash, studyHash: current.study.inputHash, names, files: Object.values(names).map(name => ({ name, size: fs.statSync(file(name)).size, sha256: hash(file(name)) })) };
}
async function assertFullChainMap(page, current, oldHashes) {
  await clickRoute(page, '/design/network-scenarios');
  const map = page.locator('[data-design-route="/design/network-scenarios"] [data-v8-supply-map] .p7-map-workspace');
  await map.waitFor({ state: 'visible' });
  assert.equal(await map.getAttribute('data-map-mode'), 'SCHEMATIC');
  await map.locator('.p7-map-schematic svg').waitFor({ state: 'visible' });
  assert.ok(await map.locator('.p7-map-schematic polyline').count() > 0, 'Full-chain relationships must be drawn');
  assert.equal(Number(await map.locator('[data-p7-kind="all"] strong').innerText()), current.study.nodes.length);
  const details = map.locator('.p7-map-basis');
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
  const basis = JSON.parse(await details.locator('pre').innerText());
  assert.equal(basis.studyId, current.study.studyId);
  assert.equal(basis.studyHash, current.study.inputHash);
  assert.equal(basis.snapshotHash, current.snapshot.snapshotHash);
  assert.equal(basis.focusScenarioId, current.snapshot.decision.focusScenarioId);
  assert.equal(basis.geometry, 'BUSINESS_RELATION_ONLY_NOT_ROAD_ROUTE');
  for (const oldHash of oldHashes) assert.notEqual(basis.snapshotHash, oldHash, 'Map cannot display a previous scope result');
  assert.match(await map.locator('.p7-map-legend').innerText(), /业务分配关系，不是道路路线/);
  assert.ok((await map.locator('.p7-map-legend').innerText()).includes(current.snapshot.decision.focusScenarioId));
  const selected = {};
  for (const kind of ['supplier', 'facility', 'customer']) {
    await map.locator(`[data-p7-kind="${kind}"]`).click();
    const row = map.locator(`.p7-map-list button[data-kind="${kind}"]`).first();
    await row.waitFor({ state: 'visible' });
    const id = await row.getAttribute('data-p7-entity');
    const node = current.study.nodes.find(value => value.nodeId === id);
    assert.ok(node, `${kind} map list must identify a study node`);
    await row.click();
    const inspector = map.locator('.p7-map-inspector');
    assert.equal(await inspector.locator('h2').innerText(), node.name || node.nodeId);
    assert.ok((await inspector.innerText()).includes(current.snapshot.decision.focusScenarioId));
    assert.equal(await map.locator(`.p7-map-list button[data-p7-entity="${id}"]`).getAttribute('aria-pressed'), 'true');
    assert.equal(JSON.parse(await details.locator('pre').innerText()).snapshotHash, current.snapshot.snapshotHash);
    await page.screenshot({ path: file(`uc-full-map-${kind}.png`), fullPage: true });
    selected[kind] = { nodeId: id, name: node.name || node.nodeId };
  }
  return { mode: 'SCHEMATIC', nodeCount: current.study.nodes.length, snapshotHash: basis.snapshotHash, focusScenarioId: basis.focusScenarioId, selected };
}

(async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const originalHash = hash(sourcePath), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stct-v8-uc-scopes-'));
  const workbookCopy = path.join(temp, path.basename(sourcePath)); fs.copyFileSync(sourcePath, workbookCopy); assert.equal(hash(workbookCopy), originalHash);
  const optimizerPort = await freePort();
  const optimizer = spawn(process.env.STCT_PYTHON || 'python3', ['optimizer/ortools_service.py'], { cwd: root, env: { ...process.env, OPT_PORT: String(optimizerPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser, context, page, staticPort = null, serviceLog = '', stage = 'STARTUP';
  const summary = { status: 'RUNNING', method: 'PLAYWRIGHT_PUBLIC_IMPORT_VISIBLE_CONTROLS_NATIVE_ORTOOLS', originalSha256: originalHash, stages: [], scopes: [], pageErrors: [], externalBlocked: [] };
  optimizer.stdout.on('data', chunk => { serviceLog += chunk; }); optimizer.stderr.on('data', chunk => { serviceLog += chunk; });
  try {
    await ready(optimizerPort, optimizer);
    staticPort = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
    summary.services = { staticPort, optimizerPort, optimizerPid: optimizer.pid, loopbackOnly: true };
    browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-webgl'] });
    context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    await context.route('**/*', route => { const url = new URL(route.request().url()); if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'blob:', 'file:'].includes(url.protocol)) return route.continue(); summary.externalBlocked.push(url.origin); return route.abort(); });
    page = await context.newPage(); page.setDefaultTimeout(25000); page.on('pageerror', error => summary.pageErrors.push(error.message));
    const base = `http://127.0.0.1:${staticPort}/index.html?optPort=${optimizerPort}&noWebGL=1`;
    stage = 'HOME_PUBLIC_IMPORT';
    await login(page, base);
    await clickRoute(page, '/platform/data');
    await page.locator('select[data-v8-kind]').selectOption('SUPPLY_CHAIN_PERIOD');
    await page.locator('input[data-p5-upload]').setInputFiles(workbookCopy);
    await page.locator('[data-design-route="/design/supply-chain-study"]').waitFor();
    await action(page, 'profile-confirm').waitFor();
    await field(page, 'studyName').fill('UC V8 three-scope native acceptance');
    assert.equal(await page.locator('.sc-advanced textarea:visible').count(), 0);
    await action(page, 'profile-confirm').click();
    let current = await waitSupply(page, value => value?.study && value.savedPointer?.status === 'DRAFT');
    assert.equal(current.imported.summary.demandBusinessRows, 257);
    assert.equal(current.imported.summary.inboundBusinessRows, 12);
    assert.equal(current.study.periodDemand.length, 1799);
    assert.equal(current.study.observedInbound.length, 84);
    assert.equal(current.study.periods.length, 7);
    near(current.study.periodDemand.reduce((sum, row) => sum + row.quantity, 0), 115934.168, 1e-6);
    near(current.study.observedInbound.reduce((sum, row) => sum + row.quantity, 0), 97370.239, 1e-6);
    summary.import = { studyId: current.study.studyId, pointerId: current.savedPointer.id, demandBusinessRows: 257, inboundBusinessRows: 12, periodDemand: 1799, periodInbound: 84, periods: 7 };
    summary.stages.push(stage);

    stage = 'OUTBOUND_ONLY';
    await setScope(page, stage, [1, 4]);
    current = await analyze(page, stage);
    assert.ok(current.snapshot.rows.length >= 5);
    const outboundFocus = current.snapshot.explanation.rows.find(row => row.scenarioId === current.snapshot.decision.focusScenarioId);
    near(outboundFocus.outbound.before.weightedKm, 213.5389735747, 0.0001);
    near(outboundFocus.outbound.after.weightedKm, 204.3504057652, 0.0001);
    const outboundExport = await exportScope(page, 'uc-outbound', current);
    summary.scopes.push({ scope: stage, candidateCount: current.snapshot.rows.length, beforeWeightedKm: outboundFocus.outbound.before.weightedKm, afterWeightedKm: outboundFocus.outbound.after.weightedKm, ...outboundExport });
    summary.stages.push(stage);

    stage = 'UPSTREAM_ONLY';
    await setScope(page, stage);
    current = await analyze(page, stage, outboundExport.snapshotHash);
    near(current.snapshot.observedKnownInbound.volume, 96668.039);
    near(current.snapshot.excludedObservedInbound.reduce((sum, row) => sum + row.quantity, 0), 702.2);
    near(current.snapshot.observedKnownInbound.volumeKm, 92334005.534344);
    const upstreamFocus = current.snapshot.rows.find(row => row.scenarioId === current.snapshot.decision.focusScenarioId);
    near(upstreamFocus.metrics.inbound.volumeKm, 83662974.264281, Math.max(0.03, upstreamFocus.solver.objectiveRoundingBound || 0));
    assert.equal(upstreamFocus.outbound.length, 0);
    const upstreamChanges = upstreamFocus.relationRows.filter(row => row.change !== 'UNCHANGED');
    assert.equal(new Set(upstreamChanges.map(row => JSON.stringify([row.supplierId, row.siteId]))).size, 12);
    assert.equal(upstreamChanges.length, 84);
    const upstreamExport = await exportScope(page, 'uc-upstream', current);
    summary.scopes.push({ scope: stage, candidateCount: current.snapshot.rows.length, observedVolumeKm: current.snapshot.observedKnownInbound.volumeKm, candidateVolumeKm: upstreamFocus.metrics.inbound.volumeKm, excludedUnknownVolume: 702.2, changedRelationships: 12, changedPeriodRows: 84, ...upstreamExport });
    summary.stages.push(stage);

    stage = 'FULL_CHAIN';
    await setScope(page, stage, [2, 4]);
    current = await analyze(page, stage, upstreamExport.snapshotHash);
    assert.ok(current.snapshot.rows.length >= 3);
    assert.ok(current.snapshot.planningReference);
    const fullFocus = current.snapshot.rows.find(row => row.scenarioId === current.snapshot.decision.focusScenarioId);
    near(fullFocus.comparison.totalVolumeKmBefore, 63186326.642, 0.05);
    near(fullFocus.comparison.totalVolumeKmAfter, 60418467.888, Math.max(0.05, fullFocus.solver.objectiveRoundingBound || 0));
    assert.ok(fullFocus.comparison.outbound.changeRate > 0, 'Full-chain outbound distance must show the adverse tradeoff');
    assert.ok(fullFocus.comparison.inbound.changeRate < 0, 'Full-chain inbound distance must show the improvement');
    const fullChanges = fullFocus.relationRows.filter(row => row.change !== 'UNCHANGED');
    assert.equal(new Set(fullChanges.map(row => JSON.stringify([row.supplierId, row.siteId]))).size, 3);
    assert.equal(fullChanges.length, 21);
    const fullExport = await exportScope(page, 'uc-full', current);
    summary.scopes.push({ scope: stage, candidateCount: current.snapshot.rows.length, planningReferenceVolumeKm: fullFocus.comparison.totalVolumeKmBefore, candidateVolumeKm: fullFocus.comparison.totalVolumeKmAfter, outboundChangeRate: fullFocus.comparison.outbound.changeRate, inboundChangeRate: fullFocus.comparison.inbound.changeRate, changedRelationships: 3, changedPeriodRows: 21, ...fullExport });
    summary.stages.push(stage);

    stage = 'FULL_CHAIN_MAP';
    summary.fullChainMap = await assertFullChainMap(page, current, [outboundExport.snapshotHash, upstreamExport.snapshotHash]);
    summary.stages.push(stage);

    stage = 'STALE_MAP_HIDES_OLD_RESULT';
    await clickRoute(page, '/design/supply-chain-study');
    await page.locator('[data-supply-action="step"][data-supply-id="1"]').click();
    await field(page, 'maxSites').fill('3');
    const stale = await waitSupply(page, value => !value?.snapshot && value?.staleResult?.snapshotHash === fullExport.snapshotHash);
    await clickRoute(page, '/design/overview');
    const staleMap = page.locator('[data-design-route="/design/overview"] [data-v8-supply-map] .p7-map-workspace');
    await staleMap.waitFor({ state: 'visible' });
    const staleDetails = staleMap.locator('.p7-map-basis');
    if (!await staleDetails.evaluate(element => element.open)) await staleDetails.locator('summary').click();
    const staleBasis = JSON.parse(await staleDetails.locator('pre').innerText());
    assert.equal(staleBasis.snapshotHash, null);
    assert.equal(staleBasis.focusScenarioId, null);
    assert.equal(await staleMap.locator('.p7-map-schematic polyline').count(), 0);
    assert.match(await staleMap.locator('.p7-map-legend').innerText(), /尚无当前有效结果/);
    summary.staleMap = { expiredSnapshotHash: stale.staleResult.snapshotHash, displayedSnapshotHash: staleBasis.snapshotHash, relationshipLines: 0 };
    await page.screenshot({ path: file('uc-full-map-stale.png'), fullPage: true });
    summary.stages.push(stage);

    stage = 'PUBLIC_PACKAGE_READBACK';
    const reader = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await reader.route('**/*', route => { const url = new URL(route.request().url()); if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'blob:', 'file:'].includes(url.protocol)) return route.continue(); summary.externalBlocked.push(url.origin); return route.abort(); });
    const readerPage = await reader.newPage(); readerPage.on('pageerror', error => summary.pageErrors.push(error.message));
    try {
      await login(readerPage, base);
      await clickRoute(readerPage, '/platform/scenarios');
      await readerPage.locator('[data-p5-package]').setInputFiles(file(fullExport.names.package));
      await readerPage.locator('[data-p5-action="import-package"]').waitFor({ state: 'visible' });
      await readerPage.locator('[data-p5-action="import-package"]').click();
      await readerPage.locator('[data-design-route="/design/supply-chain-study"]').waitFor();
      const reopened = await waitSupply(readerPage, value => value?.snapshot?.snapshotHash === fullExport.snapshotHash);
      assert.equal(reopened.study.inputHash, fullExport.studyHash);
      await readerPage.screenshot({ path: file('uc-full-public-package-readback.png'), fullPage: true });
      await clickRoute(readerPage, '/platform/scenarios');
      await readerPage.locator('[data-p5-field="scenarioName"]').fill('UC V8 catalog copy');
      await readerPage.locator('[data-p5-action="save-copy"]').click();
      await readerPage.locator('[data-design-route="/design/supply-chain-study"]').waitFor();
      const copied = await waitSupply(readerPage, value => value?.study?.studyId !== reopened.study.studyId && value.savedPointer?.id === `SUPPLY:${value.study.studyId}`);
      assert.notEqual(copied.study.inputHash, reopened.study.inputHash);
      near(copied.study.periodDemand.reduce((sum, row) => sum + row.quantity, 0), 115934.168, 1e-6);
      await clickRoute(readerPage, '/platform/scenarios');
      let copyRow = readerPage.locator(`tr[data-p5-entry="${copied.savedPointer.id}"]`);
      await copyRow.waitFor();
      await readerPage.locator(`tr[data-p5-entry="SUPPLY:${reopened.study.studyId}"]`).waitFor();
      readerPage.once('dialog', dialog => dialog.accept('UC V8 catalog renamed'));
      await copyRow.locator('[data-p5-action="rename"]').click();
      await readerPage.getByRole('link', { name: 'UC V8 catalog renamed', exact: true }).waitFor();
      copyRow = readerPage.locator(`tr[data-p5-entry="${copied.savedPointer.id}"]`);
      await copyRow.locator('[data-p5-action="archive"]').click();
      await copyRow.waitFor({ state: 'hidden' });
      await readerPage.locator('[data-p5-archives]').check();
      await copyRow.waitFor();
      assert.match(await copyRow.innerText(), /ARCHIVED/);
      await copyRow.locator('[data-p5-action="archive"]').click();
      await readerPage.locator('[data-p5-archives]').uncheck();
      await copyRow.waitFor();
      summary.catalogActions = { copiedStudyId: copied.study.studyId, originalStudyId: reopened.study.studyId, renamed: true, archivedAndRestored: true };
      const tampered = JSON.parse(fs.readFileSync(file(fullExport.names.package), 'utf8'));
      tampered.snapshot.snapshotHash = 'sha256:' + '0'.repeat(64);
      await readerPage.locator('[data-p5-package]').setInputFiles({ name: 'tampered-uc-package.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tampered)) });
      await readerPage.locator('[data-p5-message]').waitFor();
      await readerPage.waitForFunction(() => /SUPPLY_PACKAGE_INVALID/.test(document.querySelector('[data-p5-message]')?.textContent || ''));
      assert.equal(await readerPage.locator('[data-p5-action="import-package"]').count(), 0);
      summary.packageReadback = { source: fullExport.names.package, snapshotHash: reopened.snapshot.snapshotHash, tamperedRejected: true };
    } finally { await reader.close(); }
    summary.stages.push(stage);

    stage = 'FINISH';
    assert.deepEqual(summary.pageErrors, []);
    assert.equal(hash(sourcePath), originalHash);
    summary.originalUnchanged = true; summary.status = 'PASS';
    await context.tracing.stop({ path: file('uc-scopes.trace.zip') });
    write('browser-summary.json', summary);
    console.log(JSON.stringify({ status: 'PASS', stages: summary.stages, scopes: summary.scopes.map(row => ({ scope: row.scope, candidateCount: row.candidateCount, snapshotHash: row.snapshotHash })), packageReadback: summary.packageReadback, evidenceDir }));
  } catch (error) {
    summary.status = 'FAIL'; summary.failedStage = stage; summary.error = String(error.stack || error);
    if (page) {
      try { summary.routeDiagnostics = await page.evaluate(() => window.STCTPlatformV19?.instance?.diagnostics?.()); } catch (_) {}
      try { await page.screenshot({ path: file('failure.png'), fullPage: true }); } catch (_) {}
    }
    if (context) { try { await context.tracing.stop({ path: file('failure.trace.zip') }); } catch (_) {} }
    write('browser-summary.json', summary);
    console.error(JSON.stringify({ status: 'FAIL', stage, error: summary.error, evidenceDir }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (optimizer.exitCode === null && optimizer.signalCode === null) {
      const stopped = new Promise(resolve => optimizer.once('exit', resolve)); optimizer.kill('SIGTERM');
      await Promise.race([stopped, pause(5000)]);
      if (optimizer.exitCode === null && optimizer.signalCode === null) { optimizer.kill('SIGKILL'); await stopped; }
    }
    fs.writeFileSync(file('optimizer-service.log'), serviceLog);
    summary.cleanup = { optimizerPid: optimizer.pid, optimizerExitCode: optimizer.exitCode, optimizerSignalCode: optimizer.signalCode, staticClosed: !server.listening };
    summary.originalUnchanged = hash(sourcePath) === originalHash;
    write('browser-summary.json', summary);
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
