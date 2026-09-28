'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const XLSX = require('../vendor/xlsx/xlsx.full.min.js');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.resolve(process.env.STCT_EVIDENCE_DIR || '/tmp/stct-supply-chain-v3-synthetic');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
  ['name', 'code', 'role', 'coordinate'],
  ['Depot One', 'DC1', 'DC', '120.0,30.0'],
  ['Depot Two', 'DC2', 'DC', '121.2,30.1'],
  ['Depot Three', 'DC3', 'DC', '120.5,30.5']
]), 'Locations');
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
  ['customerNumber', 'customer', 'assignedDepot', 'coordinate', '2026-01'],
  ['D1', 'Alpha', 'DC1', '120.1,30.1', 5],
  ['D2', 'Beta', 'DC1', '121.1,30.1', 7],
  ['D3', 'Gamma', 'DC1', '120.7,30.4', 6]
]), 'Demand');
const workbook = XLSX.write(book, { bookType: 'xlsx', type: 'buffer' });
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root + path.sep)) return response.writeHead(403).end('Forbidden');
  fs.readFile(file, (error, bytes) => error ? response.writeHead(404).end('Not found') : response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(bytes));
});
const freePort = () => new Promise((resolve, reject) => { const socket = net.createServer(); socket.once('error', reject); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
const listen = () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
const close = () => new Promise(resolve => server.close(resolve));
async function ready(port, child) { for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error('Optimizer exited'); try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok && (await r.json()).available) return; } catch (_) {} await new Promise(resolve => setTimeout(resolve, 150)); } throw new Error('Optimizer not ready'); }
async function download(page, action, filename) { const pending = page.waitForEvent('download'); await page.locator(`[data-supply-action="${action}"]`).click(); const result = await pending; assert.equal(result.suggestedFilename(), filename); const target = path.join(evidenceDir, filename); await result.saveAs(target); return target; }

(async () => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const optPort = await freePort(), optimizer = spawn(process.env.STCT_PYTHON || 'python3', ['optimizer/ortools_service.py'], { cwd: root, env: { ...process.env, OPT_PORT: String(optPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser, optLog = '';
  optimizer.stderr.on('data', chunk => { optLog = (optLog + chunk.toString()).slice(-1500); });
  optimizer.stdout.on('data', chunk => { optLog = (optLog + chunk.toString()).slice(-1500); });
  try {
    await ready(optPort, optimizer);
    const staticPort = await listen();
    browser = await chromium.launch({ headless: true, executablePath: process.env.STCT_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox', '--disable-webgl'] });
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const errors = [], requests = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/facility-optimize-v19')) requests.push(request.postDataJSON()); else if (request.url().endsWith('/supply-chain-jobs-v6') && request.method()==='POST') { const payload=request.postDataJSON().requests?.find(item=>item.kind==='FACILITY')?.payload; if(payload)requests.push(payload); } else if (!request.url().startsWith(`http://127.0.0.1:${staticPort}`) && !request.url().startsWith(`http://127.0.0.1:${optPort}`) && /(matrix|route\/v1|optimizer|openai)/i.test(request.url())) external.push(request.url()); });
    await page.goto(`http://127.0.0.1:${staticPort}/index.html?optPort=${optPort}&noWebGL=1&reduced-motion=1#/design/supply-chain-study`);
    await page.locator('#loginForm .login-btn').click();
    await page.waitForSelector('.supply-chain-study.sc-business');
    assert.equal(await page.locator('.sc-steps button').count(), 3);
    await page.locator('[data-supply-file="workbook"]').setInputFiles({ name: 'different-layout.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(workbook) });
    await page.waitForSelector('.sc-mapping[open]');
    assert.match(await page.locator('.sc-mapping').textContent(), /Locations/);
    assert.ok(await page.locator('[data-supply-map-field]').count() > 0);
    assert.equal(await page.locator('.sc-advanced textarea:visible').count(), 0);
    await page.locator('[data-supply-field="classification"]').selectOption('SYNTHETIC');
    await page.locator('[data-supply-field="blockIndex"]').selectOption('1');
    await page.locator('[data-supply-map-field="customerName"]').selectOption('2');
    await page.locator('[data-supply-map-period="0"][data-map-key="column"]').selectOption('5');
    await page.screenshot({ path: path.join(evidenceDir, 'synthetic-mapping.png'), fullPage: true });
    await page.locator('[data-supply-action="profile-confirm"]').click();
    await page.waitForSelector('[data-supply-action="analyze"]');
    await page.waitForFunction(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot()?.savedPointer?.status === 'DRAFT');
    let state = await page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot());
    assert.equal(state.study.periodDemand.length, 3);
    assert.equal(state.study.classification, 'SYNTHETIC');
    assert.equal(state.study.observedAssignments.length, 3);
    assert.equal(state.snapshot, null);
    await page.locator('[data-supply-field="distanceBasis"]').selectOption('VERIFIED_ROAD');
    await page.locator('[data-supply-action="analyze"]').click();
    assert.match(await page.locator('.sc-message.is-error').textContent(), /距离|distance/i);
    assert.doesNotMatch(await page.locator('.sc-message.is-error').textContent(), /SUPPLY_/);
    assert.equal((await page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot())).snapshot, null);
    await page.locator('[data-supply-field="distanceBasis"]').selectOption('GEOGRAPHIC_SCREENING');
    await page.locator('[data-supply-field="geoConfirmed"]').check();
    await page.locator('[data-supply-site="DC2"][value="adjust"]').check();
    await page.locator('[data-supply-site="DC3"][value="adjust"]').check();
    await page.locator('[data-supply-field="minSites"]').fill('2');
    await page.locator('[data-supply-field="maxSites"]').fill('2');
    await page.locator('[data-supply-field="maxSites"]').press('Tab');
    await page.waitForFunction(() => JSON.stringify(window.STCTPlatformV19.instance.designAdapter.supplySnapshot()?.scenario?.facilityCounts) === '[2]');
    await page.locator('[data-supply-field="maxSites"]').fill('3');
    await page.locator('[data-supply-field="minSites"]').fill('3');
    await page.screenshot({ path: path.join(evidenceDir, 'synthetic-conditions.png'), fullPage: true });
    await page.locator('[data-supply-action="analyze"]').click();
    await page.waitForFunction(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot()?.snapshot?.rows?.length > 0, null, { timeout: 90000 });
    state = await page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot());
    assert.match(await page.locator('.sc-save-status, .sc-note').last().textContent(), /结果已保存在本机/);
    assert.deepEqual(requests.at(-1).options.facilityCounts, [3]);
    assert.equal(requests.at(-1).sites.find(site => site.siteId === 'DC1').status, 'REQUIRED_OPEN');
    assert.equal(requests.at(-1).sites.find(site => site.siteId === 'DC2').status, 'OPTIONAL');
    assert.ok(state.candidates.some(row => row.solverEvidence?.engine));
    assert.equal(state.snapshot.studyHash, state.study.inputHash);
    assert.equal(state.snapshot.explanation.records.businessDemand, 3);
    assert.equal(state.snapshot.explanation.records.demandPeriod, 3);
    assert.ok(state.snapshot.explanation.rows[0].selectedSites.some(site => site.name === 'Depot One'));
    const html = fs.readFileSync(await download(page, 'export-html', 'supply-chain-study.html'), 'utf8');
    const csv = fs.readFileSync(await download(page, 'export-csv', 'supply-chain-study.csv'), 'utf8');
    assert.ok(html.includes('单方案对比'));
    assert.ok(!html.includes(state.snapshot.snapshotHash) && !html.includes('<th>运输段</th>'));
    assert.equal((html.match(/<section class="page">/g) || []).length, 4);
    assert.ok(csv.includes('GEOGRAPHIC_SCREENING'));
    await page.screenshot({ path: path.join(evidenceDir, 'synthetic-desktop.png'), fullPage: true });
    await page.locator('[data-supply-action="step"][data-supply-id="1"]').click();
    await page.locator('[data-supply-field="networkMode"]').selectOption('MULTI');
    await page.locator('[data-supply-site="DC1"][value="adjust"]').check();
    await page.locator('[data-supply-field="minSites"]').fill('1');
    await page.locator('[data-supply-field="maxSites"]').fill('3');
    await page.locator('[data-supply-action="analyze"]').click();
    await page.waitForFunction(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot()?.snapshot?.rows?.length >= 5, null, { timeout: 90000 });
    await page.waitForSelector('.sc-conclusion');
    state = await page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot());
    assert.deepEqual(requests.at(-1).options.facilityCounts, [1, 2, 3]);
    assert.ok(state.snapshot.explanation.rows.length >= 5);
    assert.ok(state.snapshot.explanation.rows.every(row => row.siteLoads.length === 3));
    assert.equal(new Set(state.snapshot.explanation.rows.map(row => row.selectedSites.map(site => site.siteId).sort().join('|'))).size, state.snapshot.explanation.rows.length);
    await page.screenshot({ path: path.join(evidenceDir, 'synthetic-multi.png'), fullPage: true });
    const multiHtml = fs.readFileSync(await download(page, 'export-html', 'supply-chain-study.html'), 'utf8');
    assert.ok(multiHtml.includes('多方案比较') && !multiHtml.includes('<th>运输段</th>'));
    await page.locator('[data-supply-action="step"][data-supply-id="1"]').click();
    await page.locator('[data-supply-field="planName"]').fill('Revised coverage plan');
    assert.equal((await page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot())).snapshot, null);
    await page.locator('[data-supply-action="step"][data-supply-id="2"]').click();
    assert.ok(await page.locator('[data-supply-action="export-html"]').isDisabled());
    await page.waitForFunction(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot()?.savedPointer?.status === 'DRAFT');
    await page.locator('[data-platform-locale]').selectOption('en');
    assert.match(await page.locator('.sc-steps button').first().textContent(), /Upload data/);
    await page.locator('[data-platform-locale]').selectOption('ja');
    assert.match(await page.locator('.sc-steps button').first().textContent(), /アップロード/);
    await page.locator('[data-platform-locale]').selectOption('zh');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator('.supply-chain-study').evaluate(element => element.getBoundingClientRect().width <= innerWidth + 1));
    await page.screenshot({ path: path.join(evidenceDir, 'synthetic-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    const result = { status: 'PASS', dataset: 'SYNTHETIC_DIFFERENT_LAYOUT', noJsonInput: true, demandRecords: state.study.periodDemand.length, candidates: state.candidates.length, requestFacilityCounts: requests[0].options.facilityCounts, requiredSite: requests[0].sites.find(site => site.status === 'REQUIRED_OPEN').siteId, multiFacilityCounts: requests.at(-1).options.facilityCounts, multiCandidates: state.candidates.length, snapshotHash: state.snapshot.snapshotHash, draftBeforeSolve: true, failedRoadRecovered: true, changedResultBlocked: true, locales: ['zh', 'en', 'ja'], evidenceDir };
    fs.writeFileSync(path.join(evidenceDir, 'summary.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.stack || error, optLog); process.exitCode = 1; }
  finally { if (browser) await browser.close(); if (server.listening) await close(); if (optimizer.exitCode === null) optimizer.kill('SIGTERM'); }
})();
