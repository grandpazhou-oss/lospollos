#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const XLSX = require('../vendor/xlsx/xlsx.full.min.js');
const root = path.resolve(__dirname, '..'), out = process.env.STCT_ANALYSIS_EVIDENCE || path.join(os.tmpdir(), 'stct-analysis-browser');
fs.mkdirSync(out, { recursive: true });
const results = { status: 'RUNNING', checks: [], pageErrors: [], method: 'Business controls with native CP-SAT; delay fault injected only into IndexedDB transaction completion, no research-state injection.' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = http.createServer((request, response) => {
  const file = path.resolve(root, '.' + (new URL(request.url, 'http://localhost').pathname === '/' ? '/index.html' : decodeURIComponent(new URL(request.url, 'http://localhost').pathname)));
  if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(file)] || 'application/octet-stream';
  fs.readFile(file, (error, data) => error ? response.writeHead(404).end() : response.writeHead(200, { 'content-type': type + ';charset=utf-8', 'cache-control': 'no-store' }).end(data));
});
const freePort = () => new Promise(resolve => { const socket = net.createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
const state = page => page.evaluate(() => window.STCTPlatformV19.instance.designAdapter.supplySnapshot());
const record = check => { results.checks.push(check); fs.writeFileSync(path.join(out, 'progress.json'), JSON.stringify(results, null, 2)); };
async function waitState(page, predicate, timeout = 40000) { const start = Date.now(); let last; while (Date.now() - start < timeout) { last = await state(page); if (predicate(last)) return last; if (last?.lastError) throw new Error(JSON.stringify(last.lastError)); await pause(100); } throw new Error('Timed out: ' + JSON.stringify(last)); }
async function login(page, url) { await page.goto(url); const button = page.locator('#loginForm .login-btn'); if (await button.isVisible()) await button.click(); }
async function route(page, value) { await page.locator(`button[data-platform-route="${value}"]:visible`).first().click(); }
function workbook() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['role', 'coordinate', 'code', 'name'], ['FACTORY', '118,31', 'P', 'Factory Pine'], ['DC', '118.1,31', 'E', 'Depot Elm'], ['DC', '119.1,31', 'W', 'Depot Willow']]), 'Asset register');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['2027/09', 'customer', 'coordinate', 'number', 'assignedDepot', '2027/03'], [8, 'Outlet Amber', '118.2,31', 'A', 'E', 5], [11, 'Outlet Blue', '119.2,31', 'B', 'W', 7]]), 'Sales periods');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['2027/09', 'toNodeId', 'flowId', '2027/03', 'fromNodeId'], [8, 'E', 'IE', 5, 'P'], [11, 'W', 'IW', 7, 'P']]), 'Receipts periods');
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}
(async () => {
  let browser, child, page, serviceLog = '';
  try {
    const optPort = await freePort(); child = spawn(process.env.STCT_PYTHON || 'python3', ['optimizer/ortools_service.py'], { cwd: root, env: { ...process.env, OPT_PORT: String(optPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
    results.optimizerPid = child.pid; child.stdout.on('data', data => { serviceLog += data; }); child.stderr.on('data', data => { serviceLog += data; });
    for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error('Owned optimizer exited'); try { if ((await (await fetch(`http://127.0.0.1:${optPort}/health`)).json()).available) break; } catch (_) {} await pause(100); }
    const port = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
    results.ports = { static: port, optimizer: optPort };
    browser = await chromium.launch({ executablePath: process.env.STCT_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-webgl'] });
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    await context.route('**/*', handler => { const url = new URL(handler.request().url()); return ['localhost', '127.0.0.1'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol) ? handler.continue() : handler.abort(); });
    page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => results.pageErrors.push(error.message)); let jobPosts = 0;
    page.on('request', request => { if (request.method() === 'POST' && /\/supply-chain-jobs-v6$/.test(new URL(request.url()).pathname)) jobPosts++; });
    const url = `http://127.0.0.1:${port}/index.html?optPort=${optPort}&noWebGL=1`;
    await login(page, url); await page.locator('.platform-home button[data-platform-workspace="DESIGN"]').click(); await route(page, '/platform/data'); await page.locator('select[data-v8-kind]').selectOption('SUPPLY_CHAIN_PERIOD');
    await page.locator('[data-p5-upload]').setInputFiles({ name: 'Synthetic save-flow.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbook() });
    for(const index of [1,2]){await page.locator('[data-supply-field="blockIndex"]').selectOption(String(index));await page.locator('[data-supply-field="blockUnit"]').selectOption('m3');if(index===1)await page.locator('[data-supply-map-field="currentSiteId"]').selectOption('5');}
    await page.locator('[data-supply-field="studyName"]').fill('Synthetic Save Flow'); await page.locator('[data-supply-action="profile-confirm"]').click();
    await page.locator('[data-supply-preflight]').waitFor(); assert.match(await page.locator('[data-supply-preflight]').innerText(), /地理筛选|坐标/);
    await page.locator('[data-supply-action="analyze"]').click(); assert.equal(jobPosts, 0); assert.equal(await page.locator('.sc-message.is-error').count(), 0);
    await page.locator('[data-supply-preflight] [data-supply-action="condition-focus"]').first().click();
    await page.waitForFunction(() => document.activeElement?.dataset.supplyField === 'geoConfirmed');
    await page.locator('[data-supply-field="geoConfirmed"]').check(); await page.locator('[data-supply-action="draft-save"]').click();
    assert.match(await page.locator('[data-supply-preflight]').innerText(), /条件已就绪/); record('PRECONDITIONS_VISIBLE_BEFORE_RUN_AND_FOCUSABLE');

    // Fault at the storage layer: transaction is durable, but its completion callback is delayed.
    await page.evaluate(() => {
      window.__storageDelay = { armed: true, durable: false };
      const original = IDBDatabase.prototype.transaction, complete = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
      IDBDatabase.prototype.transaction = function (...args) {
        const tx = original.apply(this, args); let selected = false;
        const objectStore = tx.objectStore.bind(tx);
        tx.objectStore = name => { const store = objectStore(name); if (name === 'pointers' && tx.mode === 'readwrite') { const put = store.put.bind(store); store.put = (value, ...rest) => { if (value.type === 'SUPPLY_CHAIN_STUDY' && window.__storageDelay.armed) { selected = true; window.__storageDelay.armed = false; window.__storageDelay.revision = value.revision; } return put(value, ...rest); }; } return store; };
        Object.defineProperty(tx, 'oncomplete', { set(callback) { complete.set.call(tx, function (event) { if (selected) { window.__storageDelay.durable = true; setTimeout(() => callback.call(tx, event), 1200); } else callback.call(tx, event); }); } });
        return tx;
      };
    });
    await page.locator('[data-supply-field="planName"]').fill('Edited during auto-save');
    await page.waitForFunction(() => window.__storageDelay.durable);
    await page.locator('[data-supply-field="networkMode"]').selectOption('MULTI');
    for (const site of await page.locator('.sc-sites tbody input[value="adjust"]').all()) await site.check();
    await page.locator('[data-supply-field="minSites"]').fill('1'); await page.locator('[data-supply-field="maxSites"]').fill('2');
    await page.locator('[data-supply-action="analyze"]').click();
    const solved = await waitState(page, value => value?.snapshot && value.savedPointer?.status === 'COMPLETE');
    assert.deepEqual(solved.scenario.facilityCounts, [1, 2]); assert.equal(jobPosts, 1); assert.equal(await page.locator('.sc-message.is-error').count(), 0); assert.ok(solved.solverRuns.length);
    fs.writeFileSync(path.join(out, 'native-result.json'), JSON.stringify(solved.snapshot, null, 2)); await page.screenshot({ path: path.join(out, 'same-page-success.png'), fullPage: true }); record('DURABLE_AUTO_SAVE_EDIT_ANALYZE_NO_FALSE_CONFLICT_NATIVE_SOLVE');

    await page.locator('[data-supply-action="step"][data-supply-id="1"]').click();
    const second = await context.newPage(); second.setDefaultTimeout(15000); await login(second, url);
    await second.locator('.platform-home button[data-platform-workspace="DESIGN"]').click(); await route(second, '/platform/scenarios');
    await second.locator('[data-p5-field="search"]').fill('Synthetic Save Flow'); await second.locator('[data-p5-field="search"]').press('Tab');
    await second.getByRole('link', { name: 'Synthetic Save Flow', exact: true }).locator('xpath=ancestor::tr[1]').locator('[data-p5-action="open"]').click();
    await second.locator('[data-supply-action="step"][data-supply-id="1"]').click(); const revision = (await state(second)).savedPointer.revision;
    await page.locator('[data-supply-field="planName"]').fill('First tab newer revision'); await page.locator('[data-supply-action="draft-save"]').click(); await waitState(page, value => value?.savedPointer?.revision > revision);
    await second.locator('[data-supply-field="planName"]').fill('Second tab unsaved inputs'); await second.locator('[data-supply-action="draft-save"]').click();
    await second.locator('.sc-recovery-actions').waitFor(); assert.match(await second.locator('.sc-message.is-error').innerText(), /保存版本冲突/);
    await second.screenshot({ path: path.join(out, 'real-conflict-recovery.png'), fullPage: true });
    const download = second.waitForEvent('download'); await second.locator('.sc-recovery-actions [data-supply-action="package-export"]').click(); await (await download).saveAs(path.join(out, 'conflict.draft.json'));
    const before = await state(second); await second.locator('.sc-recovery-actions [data-supply-action="save-as-branch"]').click(); const branch = await waitState(second, value => value?.study?.studyId.includes('-BRANCH-') && value.savedPointer?.status === 'DRAFT');
    assert.deepEqual(branch.study.periodDemand, before.study.periodDemand); assert.deepEqual(branch.scenario.facilityCounts, [1, 2]); assert.equal(branch.scenario.scenarioId, 'Second tab unsaved inputs'); assert.equal((await state(page)).scenario.scenarioId, 'First tab newer revision'); record('REAL_TWO_TAB_CONFLICT_PROTECTS_NEWER_VERSION_DRAFT_AND_BRANCH_RECOVERY');
    await second.close();

    await page.locator('[data-supply-field="analysisScope"]').selectOption('FULL_CHAIN');
    assert.match(await page.locator('[data-supply-preflight]').innerText(), /同单位同质/);
    await page.locator('[data-supply-field="homogeneousDemandConfirmed"]').check(); assert.match(await page.locator('[data-supply-preflight]').innerText(), /供货关系/);
    await page.locator('[data-supply-field="allowAllSupplierSiteEdgesConfirmed"]').check(); assert.match(await page.locator('[data-supply-preflight]').innerText(), /条件已就绪/);
    await page.locator('[data-supply-field="distanceBasis"]').selectOption('VERIFIED_ROAD'); assert.match(await page.locator('[data-supply-preflight]').innerText(), /距离/); await page.locator('[data-supply-action="analyze"]').click(); assert.equal(jobPosts, 1);
    await page.locator('[data-supply-field="distanceBasis"]').selectOption('GEOGRAPHIC_SCREENING'); await page.locator('[data-supply-field="objective"]').selectOption('COST'); assert.match(await page.locator('[data-supply-preflight]').innerText(), /费用/);
    await page.locator('[data-supply-preflight] [data-supply-action="condition-focus"]').first().click(); await page.waitForFunction(() => document.activeElement?.dataset.supplyField === 'costMode');
    await page.locator('[data-supply-field="costMode"]').selectOption('ASSUMED'); assert.match(await page.locator('[data-supply-preflight]').innerText(), /费用补充中声明/);
    await page.locator('[data-supply-preflight] [data-supply-action="condition-focus"]').first().click(); await page.waitForFunction(() => document.activeElement?.dataset.supplyScope === 'inventoryHolding');
    assert.equal(await page.locator('[data-supply-scope="inventoryHolding"]').isVisible(), true); record('SOURCE_ROAD_COST_PREFLIGHT_USES_VISIBLE_CONTROLS_WITHOUT_SOLVER_POST');
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(out, 'mobile-preflight.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); record('390PX_CHECKLIST_AND_RECOVERY_FIT');
    assert.deepEqual(results.pageErrors, []); results.status = 'PASS';
  } catch (error) { results.status = 'FAIL'; results.error = error.stack; if (page) { fs.writeFileSync(path.join(out, 'failure-dom.html'), await page.content()); await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }); } process.exitCode = 1; }
  finally { if (browser) await browser.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); if (child && child.exitCode === null) { const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await Promise.race([stopped, pause(3000)]); if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await stopped; } } results.cleanup = { optimizerExitCode: child?.exitCode, optimizerSignal: child?.signalCode, staticClosed: !server.listening }; fs.writeFileSync(path.join(out, 'optimizer.log'), serviceLog); fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results)); }
})();
