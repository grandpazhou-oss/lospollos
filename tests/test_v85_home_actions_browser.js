#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-results/v85-home-actions');
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (error, body) => error
    ? res.writeHead(404).end()
    : res.writeHead(200, { 'content-type': ({ '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.json':'application/json' })[path.extname(file)] || 'application/octet-stream' }).end(body));
});

(async () => {
  let browser;
  const evidence = { status: 'RUNNING', routes: [], locales: [], pageErrors: [] };
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.STCT_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', request => new URL(request.request().url()).hostname === '127.0.0.1' ? request.continue() : request.abort());
    const page = await context.newPage();
    page.on('pageerror', error => evidence.pageErrors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?forceHeuristic=1&noWebGL=1#/`);
    await page.locator('#loginForm .login-btn').click();
    await page.locator('.platform-home-actions').waitFor();
    assert.equal(await page.locator('.platform-home-network').count(), 0);
    const expected = [
      ['/platform/data', '导入业务数据'],
      ['/design/supply-chain-study', '测算供应链方案'],
      ['/command/dispatch', '处理运输订单'],
    ];
    for (const [route, label] of expected) {
      const action = page.locator(`.platform-home-action[data-platform-route="${route}"]`);
      assert.equal(await action.locator('strong').textContent(), label);
      await action.click();
      await page.waitForFunction(value => location.hash === '#' + value, route);
      evidence.routes.push({ route, label });
      await page.locator('.platform-v19-sidebar .platform-display-home').click();
      await page.locator('.platform-home-actions').waitFor();
    }
    await page.screenshot({ path: path.join(out, 'home-desktop.png') });
    for (const [locale, label] of [['en', 'Import business data'], ['ja', '業務データを取り込む']]) {
      const localized = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await localized.route('**/*', request => new URL(request.request().url()).hostname === '127.0.0.1' ? request.continue() : request.abort());
      const localePage = await localized.newPage();
      await localePage.goto(`http://127.0.0.1:${server.address().port}/index.html?forceHeuristic=1&noWebGL=1#/`);
      await localePage.locator('#loginLang').selectOption(locale);
      await localePage.locator('#loginForm .login-btn').click();
      await localePage.locator('.platform-home-action').first().waitFor();
      assert.equal(await localePage.locator('.platform-home-action strong').first().textContent(), label);
      evidence.locales.push(locale);
      await localized.close();
    }
    evidence.locales.push('zh');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.equal(await page.locator('.platform-home-action:visible').count(), 3);
    await page.screenshot({ path: path.join(out, 'home-mobile-390.png'), fullPage: true });
    assert.deepEqual(evidence.pageErrors, []);
    evidence.status = 'PASS';
  } catch (error) {
    evidence.status = 'FAIL';
    evidence.error = error.stack;
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  }
})();
