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
const freePort = () => new Promise((resolve, reject) => { const socket = net.createServer(); socket.once('error', reject); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
const server = http.createServer((request, response) => { const file = path.resolve(root, '.' + new URL(request.url, 'http://127.0.0.1').pathname); if (!file.startsWith(root + path.sep)) return response.writeHead(403).end(); fs.readFile(file, (error, bytes) => error ? response.writeHead(404).end() : response.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }).end(bytes)); });
function workbook() {
  const book = XLSX.utils.book_new();
  const places = [['name', 'code', 'role', 'coordinate'], ...Array.from({ length: 20 }, (_, i) => [`Warehouse ${i}`, `W${i}`, 'DC', `${120 + i * .1},30`])];
  const demand = [['customerNumber', 'customer', 'assignedDepot', 'coordinate', '2026-01'], ...Array.from({ length: 500 }, (_, i) => [`D${i}`, `Customer ${i}`, `W${i % 20}`, `${120 + i * .005},30.1`, 1])];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(places), 'Locations');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(demand), 'Demand');
  return Buffer.from(XLSX.write(book, { bookType: 'xlsx', type: 'buffer' }));
}
(async () => {
  const optimizerPort = await freePort(), optimizer = spawn('python3', ['optimizer/ortools_service.py'], { cwd: root, env: { ...process.env, OPT_PORT: String(optimizerPort) }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 100; i++) { if (optimizer.exitCode !== null) throw new Error('isolated optimizer exited'); try { if ((await fetch(`http://127.0.0.1:${optimizerPort}/health`)).ok) break; } catch (_) {} await new Promise(resolve => setTimeout(resolve, 100)); if (i === 99) throw new Error('isolated optimizer unavailable'); }
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({ headless: true, executablePath: process.env.STCT_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox', '--disable-webgl'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?optPort=${optimizerPort}&noWebGL=1#/design/supply-chain-study`);
    await page.locator('#loginForm .login-btn').click(); await page.waitForSelector('.supply-chain-study.sc-business');
    await page.locator('[data-supply-file="workbook"]').setInputFiles({ name: 'cancel-synthetic.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbook() });
    await page.locator('[data-supply-action="profile-confirm"]').click(); await page.waitForSelector('[data-supply-action="analyze"]');
    await page.locator('[data-supply-field="geoConfirmed"]').check();
    await page.locator('[data-supply-field="networkMode"]').selectOption('MULTI');
    for (const row of await page.locator('.sc-sites tbody tr:has(input[data-supply-site])').all()) await row.locator('input[value="adjust"]').check();
    await page.locator('[data-supply-field="minSites"]').fill('2'); await page.locator('[data-supply-field="maxSites"]').fill('19');
    await page.locator('[data-supply-action="analyze"]').click();
    await page.locator('[data-supply-action="cancel-run"]').waitFor({ timeout: 15000 }).catch(async error => { console.error('UI_STATE', JSON.stringify({ status: await page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot().status), lastError: await page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot().lastError), message: await page.locator('.sc-message').allTextContents() })); throw error; });
    const before = await page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot().job);
    assert.ok(before.jobId); assert.ok(await page.locator('[data-supply-action="cancel-run"]').isEnabled());
    assert.ok(await page.evaluate(() => sessionStorage.getItem('STCT_SUPPLY_JOB_V6')), 'pending run marker must be stored');
    const interruptedJob = before.jobId;
    await page.reload();
    if (await page.locator('#loginForm .login-btn').isVisible()) await page.locator('#loginForm .login-btn').click();
    await page.waitForSelector('.supply-chain-study.sc-business');
    assert.equal(await page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot().status), 'INTERRUPTED');
    assert.match(await page.locator('.sc-message.is-error').textContent(), /中断/);
    let interrupted;
    for (let i = 0; i < 100; i++) { interrupted = await (await fetch(`http://127.0.0.1:${optimizerPort}/supply-chain-jobs-v6/${interruptedJob}`)).json(); if (interrupted.status === 'CANCELLED') break; await new Promise(resolve => setTimeout(resolve, 20)); }
    assert.equal(interrupted.status, 'CANCELLED');
    await page.locator('[data-supply-action="step"][data-supply-id="0"]').click();
    await page.locator('[data-supply-action="study-list"]').click();
    await page.locator('[data-supply-action="study-open"]:has-text("cancel-synthetic")').click();
    await page.locator('[data-supply-action="analyze"]').click();
    await page.locator('[data-supply-action="cancel-run"]').waitFor({ timeout: 15000 });
    const active = await page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot().job);
    assert.ok(active.jobId);
    const started = Date.now(); await page.locator('[data-supply-action="cancel-run"]').click();
    await page.waitForFunction(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot().status === 'CANCELLED', null, { timeout: 10000 });
    const finished = Date.now() - started;
    const remote = await (await fetch(`http://127.0.0.1:${optimizerPort}/supply-chain-jobs-v6/${active.jobId}`)).json(); assert.equal(remote.status, 'CANCELLED');
    if (remote.pid) { for (let i = 0; i < 100; i++) { try { process.kill(remote.pid, 0); await new Promise(resolve => setTimeout(resolve, 20)); } catch (error) { if (error.code === 'ESRCH') break; throw error; } if (i === 99) throw new Error('orphan worker'); } }
    assert.equal((await (await fetch(`http://127.0.0.1:${optimizerPort}/health`)).json()).available, true);
    console.log(JSON.stringify({ suite: 'SUPPLY_CHAIN_V6_CANCEL_BROWSER', status: 'PASS', synthetic: true, browserCancelMs: finished, jobId: active.jobId, workerPid: remote.pid, refreshInterrupt: true, serviceHealthy: true }));
  } finally { if (browser) await browser.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); if (optimizer.exitCode === null) optimizer.kill('SIGTERM'); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
