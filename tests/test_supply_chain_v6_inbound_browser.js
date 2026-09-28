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
const evidence = process.env.STCT_V6_EVIDENCE_DIR || '/tmp/stct-v6-inbound-browser';
function workbook() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['name', 'code', 'role', 'coordinate'],
    ['Source One', 'S1', 'SUPPLIER', '120,30'], ['Source Two', 'S2', 'SUPPLIER', '121,30'],
    ['Warehouse One', 'W1', 'DC', '120.1,30'], ['Warehouse Two', 'W2', 'DC', '121.1,30'],
    ['External unknown', 'X', 'EXTERNAL', ''],
  ]), 'Locations');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['flowId', 'fromNodeId', 'toNodeId', '2026-01'],
    ['I1', 'S1', 'W1', 10], ['I2', 'S2', 'W2', 2], ['IX', 'X', 'W2', 10],
  ]), 'Inbound');
  return Buffer.from(XLSX.write(book, { bookType: 'xlsx', type: 'buffer' }));
}
const server = http.createServer((request, response) => {
  const file = path.resolve(root, '.' + new URL(request.url, 'http://127.0.0.1').pathname);
  if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
  const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/html';
  fs.readFile(file, (error, bytes) => error ? response.writeHead(404).end() : response.writeHead(200, { 'content-type': type }).end(bytes));
});
const freePort = () => new Promise((resolve, reject) => { const socket = net.createServer(); socket.once('error', reject); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
const listen = () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
const state = page => page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot());
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const optimizerPort = await freePort(), optimizer = spawn('python3', ['optimizer/ortools_service.py'], { cwd: root, env: { ...process.env, OPT_PORT: String(optimizerPort) }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 100; i++) { if (optimizer.exitCode !== null) throw new Error('optimizer exited'); try { const response = await fetch(`http://127.0.0.1:${optimizerPort}/health`); if (response.ok && (await response.json()).available) break; } catch (_) {} await new Promise(resolve => setTimeout(resolve, 150)); if (i === 99) throw new Error('optimizer unavailable'); }
    const webPort = await listen();
    browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox', '--disable-webgl'] });
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${webPort}/index.html?optPort=${optimizerPort}&noWebGL=1#/design/supply-chain-study`);
    await page.locator('#loginForm .login-btn').click();
    await page.waitForSelector('.supply-chain-study.sc-business');
    await page.locator('[data-supply-file="workbook"]').setInputFiles({ name: 'inbound-only-synthetic.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbook() });
    await page.locator('[data-supply-action="profile-confirm"]').click();
    await page.waitForSelector('[data-supply-action="analyze"]');
    let current = await state(page);
    assert.equal(current.study.periodDemand.length, 0);
    assert.equal(current.study.observedInbound.length, 3);
    assert.equal(await page.locator('[data-supply-field="analysisScope"]').inputValue(), 'UPSTREAM_ONLY');
    await page.locator('[data-supply-field="geoConfirmed"]').check();
    await page.locator('[data-supply-field="homogeneousDemandConfirmed"]').check();
    await page.locator('[data-supply-field="allowAllSupplierSiteEdgesConfirmed"]').check();
    await page.locator('.sc-supplements summary:has-text("各仓逐期容量")').click();
    await page.locator('[data-supply-capacity="W1|2026-01"]').fill('20');
    await page.locator('[data-supply-capacity="W2|2026-01"]').fill('12');
    await page.locator('[data-supply-action="analyze"]').click();
    await page.waitForFunction(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot()?.snapshot?.analysisScope === 'UPSTREAM_ONLY', null, { timeout: 90000 });
    current = await state(page);
    assert.equal(current.snapshot.baseline.metrics.inbound.totalVolume, 22);
    assert.equal(current.snapshot.rows[0].capacityByPeriod.find(row => row.siteId === 'W2').throughput, 12);
    assert.equal(current.snapshot.rows[0].capacityByPeriod.find(row => row.siteId === 'W2').frozenThroughput, 10);
    assert.equal(current.snapshot.rows[0].capacityStatus, 'PASS');
    const pending = page.waitForEvent('download'); await page.locator('[data-supply-action="export-html"]').click();
    const download = await pending, report = path.join(evidence, 'inbound-only-native-report.html'); await download.saveAs(report);
    assert.match(fs.readFileSync(report, 'utf8'), /固定仓网的上游覆盖/);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', syntheticInboundOnly: true, demandRecords: 0, inboundRecords: 3, frozenVolume: 10, optimizerPid: optimizer.pid, optimizerPort, webPort, report }));
  } finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (optimizer.exitCode === null) optimizer.kill('SIGTERM');
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
