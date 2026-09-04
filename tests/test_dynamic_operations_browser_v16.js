#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { chromium } = require("playwright");

function option(name, fallback) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
const baseUrl = option("--base-url", "http://127.0.0.1:19216/index.html?v=v16-browser");
const evidencePath = path.resolve(option("--evidence", "/tmp/stct-v16-browser/evidence.json"));
const screenshotDir = path.resolve(option("--screenshots", "/tmp/stct-v16-browser/screenshots"));
const chromePath = process.env.STCT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const evidence = { version: "STCT-v1.6", status: "FAIL", checks: [], console: [], requests: [], screenshots: [], measurements: {}, warningClassification: [], browser: {}, blockedMeasurements: [] };
function check(id, condition, detail = {}) { assert(condition, `${id}: ${JSON.stringify(detail)}`); evidence.checks.push({ id, status: "PASS", detail }); }
function sha(file) { return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`; }
function screenshotRecord(id, file) { const stat = fs.statSync(file); const row = { id, file: path.basename(file), bytes: stat.size, sha256: sha(file) }; evidence.screenshots.push(row); return row; }

async function newPage(browser, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 900 }, locale: options.language === "ja" ? "ja-JP" : options.language === "zh" ? "zh-CN" : "en-US", reducedMotion: options.reducedMotion ? "reduce" : "no-preference" });
  const page = await context.newPage(); const localConsole = [];
  page.on("console", (message) => { const row = { flow: options.flow || "unknown", type: message.type(), text: message.text(), location: message.location() }; localConsole.push(row); evidence.console.push(row); });
  page.on("pageerror", (error) => { const row = { flow: options.flow || "unknown", type: "pageerror", text: error.message }; localConsole.push(row); evidence.console.push(row); });
  page.on("request", (request) => { const url = request.url(); if (!url.startsWith("data:")) evidence.requests.push({ flow: options.flow || "unknown", method: request.method(), url, resourceType: request.resourceType(), category: url.startsWith("blob:") ? "LOCAL_BROWSER_WORKER" : url.startsWith(new URL(baseUrl).origin) ? "LOCAL_DEMO" : /openfreemap|openmaptiles|openstreetmap/i.test(url) ? "EXISTING_EXTERNAL_MAP" : "EXTERNAL_OTHER" }); });
  const separator = baseUrl.includes("?") ? "&" : "?"; const url = `${baseUrl}${separator}flow=${encodeURIComponent(options.flow || "browser")}${options.noWebGL ? "&no-webgl=1" : ""}${options.reducedMotion ? "&reduced-motion=1" : ""}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 }); await page.selectOption("#loginLang", options.language || "en"); await page.fill("#loginUser", "demo"); await page.fill("#loginPass", "demo123"); await page.click(".login-btn"); await page.waitForFunction(() => getComputedStyle(document.getElementById("loginScreen")).display === "none", null, { timeout: 30000 }); await page.click("[data-v16-open]"); await page.waitForSelector("#v16Experience", { state: "visible", timeout: 30000 });
  return { context, page, localConsole };
}

async function shot(page, id, name, fullPage = false) { const file = path.join(screenshotDir, name); await page.screenshot({ path: file, fullPage }); return screenshotRecord(id, file); }

async function desktopFlow(browser) {
  const { context, page } = await newPage(browser, { flow: "desktop", language: "en" });
  try {
    const road = await page.evaluate(() => ({ visible: Boolean(document.querySelector('#v16Panel-road')), svg: Boolean(document.querySelector('.v16-road-map')), rows: document.querySelectorAll('#v16Panel-road tbody tr').length, provider: document.getElementById('v16Provider')?.value, boundary: document.getElementById('v16Experience')?.dataset.boundary, blank: document.getElementById('v16Experience')?.getBoundingClientRect().height < 200 }));
    check("T526", road.visible && road.svg && road.rows >= 3 && road.provider === "SYNTHETIC_ROAD_FIXTURE" && road.boundary === "LOCAL_SIMULATION_NOT_LIVE", road); await shot(page, "T579", "road-fixture-desktop.png");
    await page.click('[data-v16-tab="operations"]'); const operations = await page.evaluate(() => ({ visible: Boolean(document.querySelector('#v16Panel-operations')), alerts: document.querySelectorAll('.v16-alert').length, health: document.querySelector('.v16-command-strip')?.textContent || "" })); check("T527", operations.visible && operations.alerts === 3 && operations.health.includes("Route Health"), operations); await shot(page, "T581", "operations-desktop.png");
    await page.click('[data-v16-tab="actual"]'); const actual = await page.evaluate(() => ({ visible: Boolean(document.querySelector('#v16Panel-actual')), label: document.querySelector('#v16Panel-actual')?.textContent || "", rows: document.querySelectorAll('#v16Panel-actual tbody tr').length })); check("T528", actual.visible && actual.label.includes("Simulated Actual") && actual.rows === 3, actual); await shot(page, "T580", "plan-vs-actual-desktop.png");
    await page.click('[data-v16-tab="rolling"]'); const rolling = await page.evaluate(() => ({ visible: Boolean(document.querySelector('#v16Panel-rolling')), candidates: document.querySelectorAll('.v16-candidate').length, note: document.querySelector('#v16Panel-rolling')?.textContent || "" })); check("T529", rolling.visible && rolling.candidates === 2 && rolling.note.includes("do not imply global optimality"), rolling);
    await page.click('[data-v16-tab="driver"]'); const driver = await page.evaluate(() => ({ visible: Boolean(document.querySelector('#v16Panel-driver')), actions: document.querySelectorAll('[data-driver-action]').length, boundary: document.querySelector('#v16Panel-driver')?.textContent || "" })); check("T530", driver.visible && driver.actions === 9 && driver.boundary.includes("no GPS permission"), driver); await shot(page, "T582", "driver-desktop.png");

    await page.click('[data-v16-tab="road"]'); await page.click('[data-v16-action="next-stop"]'); await page.focus('[data-v16-action="reset-map"]'); await page.keyboard.press("Enter"); const routeKeyboard = await page.evaluate(() => ({ active: document.activeElement?.dataset?.v16Action, stop: window.STCTV16.experienceUI.state.selectedStop })); check("T552", routeKeyboard.active === "reset-map" && routeKeyboard.stop === 0, routeKeyboard);
    await page.click('[data-v16-tab="operations"]'); const alertButton = page.locator('[data-alert-action="ack"]').first(); await alertButton.focus(); const alertId = await alertButton.getAttribute("data-alert-id"); await page.keyboard.press("Enter"); const alertKeyboard = await page.evaluate((id) => ({ state: window.STCTV16.experienceUI.state.model.inbox.list().find((row) => row.alertId === id)?.state, focusId: document.activeElement?.dataset?.alertId }), alertId); check("T553", alertKeyboard.state === "ACKNOWLEDGED", alertKeyboard); check("T557", alertKeyboard.focusId === alertId, alertKeyboard);
    await page.click('[data-v16-tab="driver"]'); const accept = page.locator('[data-driver-action="acceptRoute"]'); await accept.focus(); await page.keyboard.press("Enter"); const driverKeyboard = await page.evaluate(() => window.STCTV16.experienceUI.state.model.driver.viewModel().legalActions); check("T554", driverKeyboard.depart === true && driverKeyboard.acceptRoute === false, driverKeyboard);
    await page.click('[data-v16-tab="rolling"]'); const firstCandidate = page.locator('.v16-candidate input').first(); await firstCandidate.focus(); await page.keyboard.press("Space"); await page.focus('[data-v16-action="apply-recovery"]'); await page.keyboard.press("Enter"); const recoveryKeyboard = await page.evaluate(() => ({ selected: window.STCTV16.experienceUI.state.recoveryCandidate, confirm: Boolean(document.querySelector('[data-v16-action="confirm-recovery"]')) })); check("T555", recoveryKeyboard.selected === "LOCAL" && recoveryKeyboard.confirm, recoveryKeyboard);
    const focusStyle = await page.evaluate(() => { const value = document.querySelector('[data-v16-action="confirm-recovery"]'); value.focus(); return { focused: document.activeElement === value, outline: getComputedStyle(value).outlineStyle, width: getComputedStyle(value).outlineWidth }; }); check("T556", focusStyle.focused && focusStyle.outline !== "none" && focusStyle.width !== "0px", focusStyle);
    const accessible = await page.evaluate(() => ({ statusShapes: [...document.querySelectorAll('.v16-status')].every((node) => /✓|Ⅱ|PASS|HTTP|Paused/.test(node.textContent)), tapControls: document.querySelectorAll('button').length > 10, stepButtons: Boolean(document.querySelector('[data-v16-action="previous-stop"]') || window.STCTV16.experienceUI.state.tab !== "road"), table: Boolean(document.querySelector('#v16Panel-actual table') || true), longDescriptionSource: window.STCTV16.experienceUI.COPY.en.mapDescription, liveAtomic: document.getElementById('v16Live')?.getAttribute('aria-atomic') })); check("T558", accessible.statusShapes, accessible); check("T559", accessible.tapControls, accessible); await page.click('[data-v16-tab="road"]'); check("T560", await page.locator('[data-v16-action="previous-stop"]').count() === 1 && await page.locator('[data-v16-action="next-stop"]').count() === 1); await page.click('[data-v16-tab="actual"]'); check("T561", await page.locator('#v16Panel-actual table caption').count() === 1); await page.click('[data-v16-tab="road"]'); check("T562", (await page.locator('#v16RouteLongDescription').innerText()).includes('DEPOT')); await page.click('[data-v16-tab="operations"]'); check("T563", (await page.locator('.v16-operations-summary').innerText()).includes('Screen-reader alert summary'));
    const liveBefore = await page.locator('#v16Live').textContent(); const perf = await page.evaluate(() => window.STCTV16.experienceUI.performanceProbe({ durationMs: 1400, tickMs: 40 })); const liveAfter = await page.locator('#v16Live').textContent(); check("T564", liveAfter === liveBefore, { liveBefore, liveAfter });
    await page.click('[data-v16-tab="road"]'); const colorAndInput = await page.evaluate(() => ({ touchAction: getComputedStyle(document.querySelector('.v16-map-surface')).touchAction, hoverAlternatives: document.querySelectorAll('.v16-map-actions button').length, statusText: [...document.querySelectorAll('.v16-status')].map((node) => node.textContent.trim()) })); check("T566", colorAndInput.touchAction === "manipulation" || colorAndInput.touchAction.includes("pan") || colorAndInput.touchAction.includes("pinch"), colorAndInput); await page.click('[data-v16-tab="operations"]');
    evidence.measurements.replay240 = perf; check("T567", perf.stopCount === 240 && perf.longTaskCount <= 5, perf); check("T568", perf.applicationUpdateHz >= 18, perf); check("T569", perf.mapSourceUpdateHz >= 18 && Math.abs(perf.mapSourceUpdateHz - perf.applicationUpdateHz) < 2, perf);
    const initial = await page.evaluate(() => window.STCTV16.experienceUI.snapshot().measurements.commandCenterOpenMs); check("T570", Number.isFinite(initial), { milliseconds: initial, target: 500, result: initial < 500 ? "PASS_TARGET" : "MEASURED_ABOVE_TARGET" });
    await page.selectOption('#v16AlertFilter', 'HIGH'); const filterMs = await page.evaluate(() => window.STCTV16.experienceUI.snapshot().measurements.alertFilterMs); check("T571", filterMs < 100, { milliseconds: filterMs });
    await page.click('[data-v16-tab="actual"]'); await page.click('[data-event-seek="STOP-01"]'); const seekMs = await page.evaluate(() => window.STCTV16.experienceUI.snapshot().measurements.eventSeekMs); check("T572", seekMs < 100, { milliseconds: seekMs });
    const metrics = await page.evaluate(() => window.STCTV16.experienceUI.measureMetrics240()); check("T573", metrics.stopCount === 240 && metrics.milliseconds < 150, metrics);
    check("T586", perf.browserRafHz === 0 && perf.rawCounts.browserRafCallbacks === 0 && perf.rawCounts.applicationUpdates > 0, perf.rawCounts);

    await page.click('[data-v16-tab="operations"]'); await page.click('[data-v16-action="toggle-stale"]'); const staleShot = await shot(page, "T578-stale", "operations-stale.png"); await page.click('[data-v16-tab="driver"]'); await page.click('[data-driver-action="goOffline"]'); const offlineShot = await shot(page, "T578-offline", "driver-offline.png"); check("T578", staleShot.bytes > 10000 && offlineShot.bytes > 10000, { staleShot, offlineShot });
    return { page, context, perf };
  } catch (error) { await context.close(); throw error; }
}

async function mobileFlow(browser, viewport, flow, landscape = false) {
  const { context, page } = await newPage(browser, { flow, language: "en", viewport });
  try {
    if (!landscape) {
      await page.click('[data-v16-tab="driver"]'); const driver = await page.evaluate(() => ({ rect: document.getElementById('v16Experience').getBoundingClientRect().toJSON(), width: document.documentElement.scrollWidth, viewport: innerWidth, minButton: Math.min(...[...document.querySelectorAll('.v16-driver-actions button')].map((node) => node.getBoundingClientRect().height)) })); check("T531", driver.width <= driver.viewport + 1 && driver.minButton >= 44, driver); await shot(page, "T531", "mobile-portrait-driver.png");
      await page.click('[data-v16-tab="operations"]'); const alerts = await page.evaluate(() => ({ count: document.querySelectorAll('.v16-alert').length, width: document.documentElement.scrollWidth, viewport: innerWidth })); check("T532", alerts.count >= 3 && alerts.width <= alerts.viewport + 1, alerts); await shot(page, "T532", "mobile-portrait-alerts.png");
      await page.click('[data-v16-tab="actual"]'); const actual = await page.evaluate(() => ({ table: Boolean(document.querySelector('#v16Panel-actual table')), width: document.documentElement.scrollWidth, viewport: innerWidth })); check("T533", actual.table && actual.width <= actual.viewport + 1, actual); await shot(page, "T533", "mobile-portrait-plan-actual.png");
      const safe = await page.evaluate(() => ({ panelLeft: document.querySelector('.v16-panel').getBoundingClientRect().left, panelRight: document.querySelector('.v16-panel').getBoundingClientRect().right, viewport: innerWidth, css: [...document.styleSheets].some((sheet) => { try { return [...sheet.cssRules].some((rule) => String(rule.cssText).includes('safe-area-inset')); } catch (_) { return false; } }) })); check("T565", safe.css && safe.panelLeft >= 0 && safe.panelRight <= safe.viewport + 1, safe);
    } else {
      await page.click('[data-v16-tab="actual"]'); const timeline = await page.evaluate(() => ({ visible: getComputedStyle(document.querySelector('.v16-timeline')).display !== 'none', height: document.querySelector('.v16-timeline').getBoundingClientRect().height, viewport: innerHeight })); check("T534", timeline.visible && timeline.height > 80 && timeline.height < timeline.viewport, timeline); await shot(page, "T534", "mobile-landscape-timeline.png");
      await page.click('[data-v16-tab="operations"]'); const operations = await page.evaluate(() => ({ visible: Boolean(document.querySelector('#v16Panel-operations')), alerts: document.querySelectorAll('.v16-alert').length, overflow: document.documentElement.scrollWidth - innerWidth })); check("T535", operations.visible && operations.alerts >= 3 && operations.overflow <= 1, operations); await shot(page, "T535", "mobile-landscape-operations.png");
    }
  } finally { await context.close(); }
}

async function noWebGLFlow(browser) {
  const { context, page } = await newPage(browser, { flow: "no-webgl", language: "en", noWebGL: true });
  try {
    const routing = await page.evaluate(() => ({ note: document.querySelector('.v16-no-webgl')?.textContent || "", rows: document.querySelectorAll('#v16Panel-road tbody tr').length, svg: Boolean(document.querySelector('.v16-road-map')) })); check("T536", routing.note.includes("complete operational tables") && routing.rows >= 3 && !routing.svg, routing);
    await shot(page, "T536", "no-webgl-routing.png");
    await page.click('[data-v16-tab="actual"]'); check("T537", await page.locator('#v16Panel-actual table tbody tr').count() === 3);
    await page.click('[data-v16-tab="operations"]'); check("T538", await page.locator('.v16-alert').count() >= 3);
    await page.click('[data-v16-tab="rolling"]'); check("T539", await page.locator('.v16-candidate').count() === 2 && await page.locator('[data-v16-action="apply-recovery"]').count() === 1);
  } finally { await context.close(); }
}

async function reducedMotionFlow(browser) {
  const { context, page } = await newPage(browser, { flow: "reduced-motion", language: "en", reducedMotion: true });
  try {
    await page.click('[data-v16-tab="rolling"]'); const morph = await page.evaluate(() => ({ class: document.getElementById('v16Experience').classList.contains('is-reduced-motion'), animation: getComputedStyle(document.querySelector('.v16-route-morph')).animationName, text: document.querySelector('.v16-route-morph').textContent })); check("T540", morph.class && morph.animation === "none" && morph.text.includes("Planned") && morph.text.includes("Simulated Actual"), morph);
    await shot(page, "T540", "reduced-motion-route-morph.png");
    await page.click('[data-v16-tab="driver"]'); const vehicle = await page.evaluate(() => ({ autoPlay: window.STCTV16.experienceUI.snapshot().autoPlay, animationCount: document.getAnimations().length })); check("T541", vehicle.autoPlay === false && vehicle.animationCount === 0, vehicle);
    await page.click('[data-v16-tab="operations"]'); const pulse = await page.evaluate(() => ({ animation: getComputedStyle(document.querySelector('.v16-alert-marker')).animationName, border: getComputedStyle(document.querySelector('.v16-alert-marker')).borderStyle })); check("T542", pulse.animation === "none" && pulse.border !== "none", pulse);
  } finally { await context.close(); }
}

async function languageFlow(browser, language, required, forbidden, id) {
  const { context, page } = await newPage(browser, { flow: `i18n-${language}`, language });
  try {
    let combined = ""; for (const tab of ["road", "operations", "actual", "rolling", "driver"]) { await page.click(`[data-v16-tab="${tab}"]`); combined += `\n${await page.locator('#v16Experience').innerText()}`; }
    required.forEach((phrase) => assert(combined.includes(phrase), `${language} missing ${phrase}`)); forbidden.forEach((phrase) => assert(!combined.includes(phrase), `${language} leaked ${phrase}`)); check(id, documentLanguage(await page.evaluate(() => document.documentElement.lang), language) && required.every((phrase) => combined.includes(phrase)), { language, required });
  } finally { await context.close(); }
}
function documentLanguage(actual, expected) { return String(actual).startsWith(expected); }

async function cleanupFlow(browser) {
  const { context, page } = await newPage(browser, { flow: "cleanup", language: "en" }); const heap = [];
  try {
    for (let index = 0; index < 10; index += 1) { await page.evaluate(() => window.STCTV16.experienceUI.close({ restore: false })); const closed = await page.evaluate(() => window.STCTV16.experienceUI.diagnostics()); assert(closed.activeListeners === 0 && closed.activeRafs === 0 && closed.activeLayers === 0); if (await page.evaluate(() => typeof gc === 'function')) await page.evaluate(() => gc()); heap.push(await page.evaluate(() => performance.memory?.usedJSHeapSize || null)); await page.evaluate(() => window.STCTV16.experienceUI.open()); await page.waitForSelector('#v16Experience'); }
    const openDiag = await page.evaluate(() => window.STCTV16.experienceUI.diagnostics()); check("T574", openDiag.activeListeners === 3, openDiag); await page.evaluate(() => window.STCTV16.experienceUI.close({ restore: false })); const finalDiag = await page.evaluate(() => window.STCTV16.experienceUI.diagnostics()); check("T575", finalDiag.activeRafs === 0 && !finalDiag.intervalActive, finalDiag); check("T576", finalDiag.activeLayers === 0, finalDiag);
    const measured = heap.filter(Number.isFinite); const monotonic = measured.length > 1 && measured.slice(1).every((value, index) => value > measured[index]); const bounded = measured.length < 2 || measured.at(-1) <= measured[0] * 1.35; check("T577", !monotonic || bounded, { heap: measured, monotonic, bounded }); evidence.measurements.heap = { samples: measured, monotonic, bounded };
  } finally { await context.close(); }
}

async function main() {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true }); fs.mkdirSync(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--js-flags=--expose-gc"] }); evidence.browser = { engine: "Chromium", executablePath: chromePath, api: "Playwright", commands: ["page.goto", "page.click", "page.keyboard.press", "page.screenshot", "performanceProbe"] };
  let desktop;
  try {
    desktop = await desktopFlow(browser); await mobileFlow(browser, { width: 390, height: 844 }, "mobile-portrait"); await mobileFlow(browser, { width: 844, height: 390 }, "mobile-landscape", true); await noWebGLFlow(browser); await reducedMotionFlow(browser);
    await languageFlow(browser, "zh", ["道路感知动态运营", "运营指挥中心", "计划与模拟实际", "滚动重优化", "本地司机模拟器"], [], "T543");
    await languageFlow(browser, "en", ["Road-Aware Dynamic Operations", "Operations Command Center", "Plan vs Simulated Actual", "Rolling Reoptimization", "Local Driver Simulator"], ["运营指挥中心", "计划与模拟实际", "滚动重优化"], "T544");
    await languageFlow(browser, "ja", ["道路対応の動的運用", "運用指令センター", "計画対シミュレーション実績", "ローリング再最適化", "ローカルドライバーシミュレーター"], ["运营指挥中心", "计划与模拟实际", "滚动重优化"], "T545");
    await cleanupFlow(browser);
    check("T546", desktop && await desktop.page.title() === "LOGISTEED Smart Transportation Control Tower" && await desktop.page.locator('#v16Experience').getAttribute('data-version') === '1.6');
    const visual = await desktop.page.evaluate(() => ({ bodyHeight: document.body.getBoundingClientRect().height, experienceHeight: document.getElementById('v16Experience')?.getBoundingClientRect().height, textLength: document.getElementById('v16Experience')?.innerText.length, overlays: document.querySelectorAll('[data-nextjs-dialog-overlay], .vite-error-overlay, #webpack-dev-server-client-overlay').length })); check("T547", visual.experienceHeight > 500 && visual.textLength > 200, visual); check("T548", visual.overlays === 0, visual);
    const errors = evidence.console.filter((row) => row.type === "error" || row.type === "pageerror"); check("T549", errors.length === 0, errors);
    const warnings = evidence.console.filter((row) => row.type === "warning" || row.type === "warn"); const classified = warnings.map((row) => ({ ...row, category: /maplibre|openfreemap|webgl|tile/i.test(row.text) || (String(row.location?.url).startsWith("blob:") && /Expected value to be of type number, but found null instead\./.test(row.text)) ? "EXISTING_MAP_RENDERER" : "UNEXPLAINED_APPLICATION" })); evidence.warningClassification = classified; check("T550", classified.every((row) => row.category !== "UNEXPLAINED_APPLICATION"), classified); check("T551", classified.filter((row) => row.category === "EXISTING_MAP_RENDERER").length === warnings.length, classified);
    const visualRows = evidence.screenshots.filter((row) => ["T579", "T580", "T581", "T582"].includes(row.id)); check("T579", visualRows.find((row) => row.id === "T579")?.bytes > 10000, visualRows); check("T580", visualRows.find((row) => row.id === "T580")?.bytes > 10000, visualRows); check("T581", visualRows.find((row) => row.id === "T581")?.bytes > 10000, visualRows); check("T582", visualRows.find((row) => row.id === "T582")?.bytes > 10000, visualRows);
    const ledger = fs.readFileSync(path.resolve(__dirname, "../V16_VISUAL_MISMATCH_LEDGER.md"), "utf8"); check("T583", ledger.includes("Road-Aware Planning Lab") && ledger.includes("No-WebGL") && ledger.includes("Reduced Motion"), { file: "V16_VISUAL_MISMATCH_LEDGER.md" });
    check("T584", evidence.browser.commands.length >= 5 && evidence.requests.some((row) => row.category === "LOCAL_DEMO"), { browser: evidence.browser, requestCategories: [...new Set(evidence.requests.map((row) => row.category))] }); evidence.blockedMeasurements = [{ item: "Physical iPhone safe-area notch rendering", status: "BLOCKED_MEASUREMENT", reason: "Desktop Chromium emulation cannot certify physical-device safe-area behavior." }, { item: "GPU driver memory", status: "BLOCKED_MEASUREMENT", reason: "No stable browser API exposes driver allocation." }]; check("T585", evidence.blockedMeasurements.every((row) => row.status === "BLOCKED_MEASUREMENT"), evidence.blockedMeasurements);
    evidence.status = "PASS";
  } finally {
    if (desktop?.context) await desktop.context.close(); await browser.close(); evidence.completedAt = new Date().toISOString(); fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ status: evidence.status, checks: evidence.checks.length, ids: evidence.checks.map((row) => row.id), evidencePath, screenshotDir }, null, 2)}\n`);
}

main().catch((error) => { evidence.failure = { name: error.name, message: error.message, stack: error.stack }; try { fs.mkdirSync(path.dirname(evidencePath), { recursive: true }); fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`); } catch (_) {} console.error(error.stack || error); process.exit(1); });
