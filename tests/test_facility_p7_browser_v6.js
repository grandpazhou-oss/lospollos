'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const Data = require('../design-data-adapter-v19.js');
const Facility = require('../facility-location-mvp1-v19.js');

const root = path.resolve(__dirname, '..');
const evidence = path.resolve(process.env.STCT_EVIDENCE_DIR || '/tmp/stct-facility-p7-v6');
fs.mkdirSync(evidence, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
  fs.readFile(file, (error, bytes) => error ? response.writeHead(404).end() : response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(bytes));
});
const port = () => new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const value = socket.address().port; socket.close(() => resolve(value)); });
});
const listen = () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
const close = () => new Promise(resolve => server.close(resolve));
async function ready(value, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Isolated optimizer exited');
    try { if ((await fetch(`http://127.0.0.1:${value}/health`)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Isolated optimizer unavailable');
}

(async () => {
  const optPort = await port(), webPort = await listen();
  const optimizer = spawn('python3', ['optimizer/ortools_service.py'], { cwd: root, env: { ...process.env, OPT_PORT: String(optPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    await ready(optPort, optimizer);
    const study = Facility.fromScenario(Data.createSyntheticStudy({ orderCount: 24, depotCount: 6, vehicleCount: 18, seed: 1910 }).scenario, { facilityCounts: [1, 2, 3], timeLimitSeconds: 10 });
    const input = path.join(evidence, 'synthetic-facility-study.json');
    fs.writeFileSync(input, JSON.stringify(study, null, 2) + '\n');
    browser = await chromium.launch({ headless: true, executablePath: process.env.STCT_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${webPort}/index.html?optPort=${optPort}#/design/facility-location`);
    await page.waitForFunction(() => window.STCTPlatformV19?.instance);
    await page.locator('#loginForm .login-btn').click();
    if (await page.locator('.p7-empty').count()) await page.locator('[data-design-action="p7-demo"]').click();
    await page.waitForSelector('.p7-facility-workbench[data-step="1"]');
    await page.locator('[data-facility-upload]').setInputFiles(input);
    await page.waitForFunction(() => window.STCTPlatformV19.instance.designAdapter.facilitySnapshot()?.study?.demands.length === 24);
    await page.locator('.p7-steps [data-design-action="p7-step"][data-design-id="2"]').click();
    await page.waitForSelector('.p7-facility-workbench[data-step="2"]');
    assert.equal(await page.locator('[data-p7-option="facilityCounts"]').inputValue(), '1,2,3');
    await page.locator('.p7-steps [data-design-action="p7-step"][data-design-id="3"]').click();
    await page.locator('[data-design-action="facility-run"]:not([disabled])').click();
    await page.waitForSelector('.p7-facility-workbench[data-step="4"]', { timeout: 120000 });
    const result = await page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.facilitySnapshot());
    assert.equal(result.status, 'RESULT_READY');
    assert.equal(result.verification.status, 'PASS');
    assert.ok(result.resultSet.results.some(row => row.facilityCount === 1));
    assert.ok(result.resultSet.results.some(row => row.facilityCount === 2));
    assert.ok(result.resultSet.results.some(row => row.facilityCount === 3));
    assert.ok(await page.locator('[data-p7-map-slot]').count());
    await page.screenshot({ path: path.join(evidence, 'facility-p7-desktop.png'), fullPage: true });
    await page.locator('.p7-steps [data-design-action="p7-step"][data-design-id="5"]').click();
    await page.locator('[data-design-action="facility-save"]:not([disabled])').click();
    await page.waitForSelector('[data-design-action="facility-reopen"]');
    await page.locator('[data-design-action="facility-reopen"]').click();
    const download = page.waitForEvent('download');
    await page.locator('.p7-step-panel details summary').click();
    await page.locator('[data-design-action="facility-export-html"]').click();
    const item = await download, report = path.join(evidence, 'facility-p7-native-report.html');
    await item.saveAs(report); assert.ok(fs.statSync(report).size > 1000);
    await page.evaluate(() => { window.STCTPlatformV19.instance.setNoWebGL(true); window.STCTPlatformV19.instance.setReducedMotion(true); });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth, noWebGL: window.STCTPlatformV19.instance.snapshot().noWebGL, reducedMotion: window.STCTPlatformV19.instance.snapshot().reducedMotion }));
    assert.ok(mobile.scrollWidth <= mobile.viewport + 1); assert.equal(mobile.noWebGL, true); assert.equal(mobile.reducedMotion, true);
    await page.screenshot({ path: path.join(evidence, 'facility-p7-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    const output = { status: 'PASS', steps: [1, 2, 3, 4, 5], demands: 24, sites: 6, counts: [1, 2, 3], verification: result.verification.status, report, mobile, pageErrors: errors, optimizerPort: optPort, webPort };
    fs.writeFileSync(path.join(evidence, 'facility-p7-browser.json'), JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify(output));
  } finally {
    if (browser) await browser.close();
    optimizer.kill('SIGTERM');
    await Promise.race([new Promise(resolve => optimizer.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
    if (optimizer.exitCode === null) optimizer.kill('SIGKILL');
    await close();
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
