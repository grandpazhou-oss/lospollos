#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const freePort = () => new Promise((resolve, reject) => { const socket = net.createServer(); socket.once('error', reject); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
const server = http.createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = path.resolve(root, `.${name === '/' ? '/index.html' : name}`);
  if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  fs.readFile(file, (error, bytes) => error ? response.writeHead(404).end() : response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }).end(bytes));
});

(async () => {
  const port = await freePort();
  let browser;
  try {
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.STCT_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'tiles.openfreemap.org' && url.pathname.startsWith('/styles/liberty')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9eef7' } }] }) });
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      return route.abort();
    });
    await page.goto(`http://127.0.0.1:${port}/index.html#/`);
    await page.waitForFunction(() => Boolean(window.STCTPlatformV19?.mapRuntime && window.STCTPlatformV19?.supplyMap));
    await page.evaluate(() => {
      const slot = document.createElement('div'); slot.style.cssText = 'width:1000px;height:760px;margin:40px auto'; document.body.append(slot);
      const study = { studyId: 'MAP-SYNTHETIC', inputHash: 'MAP-HASH', coordinateUse: 'CONFIRMED_WGS84', unit: 'm3', periods: ['P1'], nodes: [
        { nodeId: 'S', role: 'SUPPLIER', name: 'Source', coordinateSystem: 'WGS84', coordinate: [118, 31] },
        { nodeId: 'A', role: 'DC', name: 'Site A', coordinateSystem: 'WGS84', coordinate: [119, 31] },
        { nodeId: 'B', role: 'DC', name: 'Site B', coordinateSystem: 'WGS84', coordinate: [120, 31] },
        { nodeId: 'C', role: 'CUSTOMER', name: 'Customer', coordinateSystem: 'WGS84', coordinate: [121, 31] }
      ] };
      const leg = (fromNodeId, toNodeId) => ({ fromNodeId, toNodeId, period: 'P1', quantity: 10 });
      const snapshot = { schemaVersion: 'stct-supply-chain-v5-snapshot-v1', studyHash: 'MAP-HASH', snapshotHash: 'MAP-SNAPSHOT', analysisScope: 'FULL_CHAIN', distanceBasis: 'GEOGRAPHIC_SCREENING', planningReference: { inbound: [leg('S', 'A')], outbound: [leg('A', 'C')] }, rows: [{ scenarioId: 'CANDIDATE', selectedSiteIds: ['B'], inbound: [leg('S', 'B')], outbound: [leg('B', 'C')] }], decision: { focusScenarioId: 'CANDIDATE' } };
      const model = window.STCTPlatformV19.supplyMap.projectComparison(study, snapshot, { mode: 'BOTH', leg: 'BOTH', period: 'ALL' }, 'zh');
      window.STCTPlatformV19.mapRuntime.mount(slot, model, { locale: 'zh', route: '/design/supply-chain-study', noWebGL: false });
    });
    await page.waitForFunction(() => { const d = window.STCTPlatformV19.mapRuntime.diagnostics(); return d.layers.some(id => id.endsWith('-relations-reference')) && d.layers.some(id => id.endsWith('-relations-candidate')); }, null, { timeout: 20000 });
    const diagnostics = await page.evaluate(() => window.STCTPlatformV19.mapRuntime.diagnostics());
    assert.equal(diagnostics.owner, 'SUPPLY');
    assert.equal(diagnostics.mode, 'MAPLIBRE_BASEMAP');
    assert.ok(diagnostics.sources.includes('p7-supply'));
    assert.equal(diagnostics.provenance.referenceRelations, 2);
    assert.equal(diagnostics.provenance.candidateRelations, 2);
    assert.equal(await page.locator('.p7-map-workspace .maplibregl-canvas').count(), 1);
    await page.evaluate(() => document.querySelector('[data-p7-basemap-retry]').click());
    await page.waitForFunction(() => { const d = window.STCTPlatformV19.mapRuntime.diagnostics(); return d.layers.some(id => id.endsWith('-relations-reference')) && d.layers.some(id => id.endsWith('-relations-candidate')); }, null, { timeout: 20000 });
    assert.equal((await page.evaluate(() => window.STCTPlatformV19.mapRuntime.diagnostics())).mode, 'MAPLIBRE_BASEMAP');
    console.log(JSON.stringify({ status: 'PASS', mode: diagnostics.mode, source: 'p7-supply', relationLayers: diagnostics.layers.filter(id => id.includes('relations')), styleReload: 'PASS' }));
  } finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
