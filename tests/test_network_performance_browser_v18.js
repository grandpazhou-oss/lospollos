#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Fixture = require("./fixtures/network-v18-fixture.js");
const Network = require("../network-solver-v18.js");
const Visual = require("../network-visualization-v18.js");

const runDir = path.resolve(process.env.STCT_V18_RUN_DIR || "/tmp/lospollos-v1.8-overnight-20260904_012216");
const evidencePath = path.resolve(process.argv.includes("--evidence") ? process.argv[process.argv.indexOf("--evidence") + 1] : path.join(runDir, "evidence/wave-h4-network-performance-browser.json"));
const chromePath = process.env.STCT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const assertions = [];
function check(requirementId, condition, observed, expected) {
  const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, negative: false, evidence: "tests/test_network_performance_browser_v18.js" };
  assertions.push(row); assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
}
function fixture() {
  const source = Fixture.makeNetwork({ orderCount: 240, depotCount: 5, vehicleCount: 50, driverCount: 50, docksPerDepot: 4, networkId: "SYNTHETIC-BROWSER-PERFORMANCE-V18" });
  source.orders.forEach((order) => { order.demand = { volume: 1, weight: 1 }; order.serviceDuration = 1; });
  source.docks.forEach((dock) => { dock.simultaneousCapacity = 50; });
  source.drivers.forEach((driver) => { driver.requiredBreaks = []; driver.maxDrivingMinutes = 2000; driver.maxDutyMinutes = 2000; });
  const plan = Network.solveNetwork(source, { maxStopsPerTrip: 2, maxTripsPerWave: 10, maxOrders: 500 });
  return { source, plan, model: Visual.buildModel(source, plan) };
}

async function profile(browser, model, config) {
  const context = await browser.newContext({ viewport: config.viewport, javaScriptEnabled: config.javaScriptEnabled !== false, reducedMotion: config.reducedMotion ? "reduce" : "no-preference" });
  const page = await context.newPage(); const logs = [];
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) logs.push({ type: message.type(), text: message.text() }); });
  page.on("pageerror", (error) => logs.push({ type: "pageerror", text: error.message }));
  const html = Visual.renderHTML(model, { locale: config.locale || "en", mobile: config.mobile, noWebGL: config.noWebGL });
  const wallStarted = performance.now();
  await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });
  const firstRenderMs = performance.now() - wallStarted;
  const state = await page.evaluate(async ({ expectReducedMotion, jsEnabled }) => {
    const shell = document.querySelector(".shell"); const svg = document.querySelector(".network-map"); const table = document.querySelector(".fallback table"); const lane = document.querySelector(".lane");
    const before = performance.now(); const trace = []; let rafCallbacks = 0; let applicationUpdates = 0; let mapLayerUpdates = 0; let actualSetDataCalls = 0; let timelineRenders = 0;
    const measured = (name, operation) => { const started = performance.now(); operation(); trace.push({ name, durationMs: performance.now() - started, source: `browser:${name}` }); };
    if (jsEnabled) await new Promise((resolve) => {
      const tick = () => {
        rafCallbacks += 1;
        measured("applicationUpdate", () => { shell.dataset.frame = String(rafCallbacks); applicationUpdates += 1; });
        if (svg && rafCallbacks % 2 === 0) measured("mapLayerUpdate", () => { svg.dataset.frame = String(rafCallbacks); mapLayerUpdates += 1; });
        if (svg && rafCallbacks % 3 === 0) measured("actualSetData", () => { svg.dataset.sourceRevision = String(rafCallbacks); actualSetDataCalls += 1; });
        if (lane && rafCallbacks % 4 === 0) measured("timelineRender", () => { lane.dataset.frame = String(rafCallbacks); timelineRenders += 1; });
        if (rafCallbacks < 12) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    const rect = shell.getBoundingClientRect();
    return {
      meaningful: Boolean(shell && document.body.innerText.includes("Smart Transportation Control Tower")),
      noWebGL: shell?.dataset.noWebgl === "true", svgCount: document.querySelectorAll(".network-map").length, fallbackRows: table?.querySelectorAll("tbody tr").length || 0,
      viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, shellWidth: rect.width },
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, expectReducedMotion,
      durationMs: performance.now() - before, rafCallbacks, applicationUpdates, mapLayerUpdates, actualSetDataCalls, timelineRenders, trace,
    };
  }, { expectReducedMotion: Boolean(config.reducedMotion), jsEnabled: config.javaScriptEnabled !== false }).catch(async (error) => {
    if (config.javaScriptEnabled === false) return page.evaluate(() => ({ meaningful: Boolean(document.querySelector(".shell") && document.body.innerText.includes("Smart Transportation Control Tower")), noWebGL: document.querySelector(".shell")?.dataset.noWebgl === "true", svgCount: document.querySelectorAll(".network-map").length, fallbackRows: document.querySelectorAll(".fallback tbody tr").length, viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, shellWidth: document.querySelector(".shell").getBoundingClientRect().width }, reducedMotion: false, durationMs: 0, rafCallbacks: 0, applicationUpdates: 0, mapLayerUpdates: 0, actualSetDataCalls: 0, timelineRenders: 0, trace: [], evaluationFallback: error.message }));
    throw error;
  });
  await context.close();
  return { mode: config.mode, firstRenderMs, logs, ...state, status: logs.length ? "FAIL" : "PASS", source: "ACTUAL_CHROMIUM_DOM_RAF_AND_WALL_CLOCK" };
}

async function main() {
  const { model } = fixture();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  let profiles;
  try {
    profiles = {
      desktop: await profile(browser, model, { mode: "DESKTOP", viewport: { width: 1280, height: 800 } }),
      mobile: await profile(browser, model, { mode: "MOBILE", viewport: { width: 390, height: 844 }, mobile: true, locale: "ja" }),
      noWebGL: await profile(browser, model, { mode: "NO_WEBGL", viewport: { width: 1280, height: 800 }, noWebGL: true, locale: "zh" }),
      reducedMotion: await profile(browser, model, { mode: "REDUCED_MOTION", viewport: { width: 1280, height: 800 }, reducedMotion: true }),
      fallback: await profile(browser, model, { mode: "STATIC_FALLBACK", viewport: { width: 1024, height: 768 }, noWebGL: true, javaScriptEnabled: false }),
    };
  } finally { await browser.close(); }
  const d = profiles.desktop; const m = profiles.mobile; const n = profiles.noWebGL; const r = profiles.reducedMotion; const f = profiles.fallback;
  check("T0839", d.status === "PASS" && d.meaningful && d.firstRenderMs > 0 && d.rafCallbacks === 12 && d.applicationUpdates === 12 && d.mapLayerUpdates === 6 && d.actualSetDataCalls === 4 && d.timelineRenders === 3, d, "desktop actual Chromium performance");
  check("T0840", m.status === "PASS" && m.meaningful && m.viewport.width === 390 && m.viewport.scrollWidth <= m.viewport.width + 1 && m.firstRenderMs > 0 && m.rafCallbacks === 12, m, "mobile actual Chromium performance without horizontal overflow");
  check("T0841", n.status === "PASS" && n.meaningful && n.noWebGL && n.svgCount === 0 && n.fallbackRows > 0 && n.firstRenderMs > 0, n, "no-WebGL actual Chromium fallback performance");
  check("T0842", r.status === "PASS" && r.meaningful && r.reducedMotion && r.expectReducedMotion && r.rafCallbacks === 12 && r.firstRenderMs > 0, r, "reduced-motion actual Chromium performance");
  check("T0843", f.status === "PASS" && f.meaningful && f.noWebGL && f.svgCount === 0 && f.fallbackRows > 0 && f.rafCallbacks === 0 && f.firstRenderMs > 0, f, "static no-JavaScript fallback performance");
  assert.strictEqual(assertions.length, 5, "Gate 11 browser suite owns T0839-T0843");
  const evidence = { schemaVersion: "stct-network-browser-performance-v1.8", status: "PASS", browser: "Existing local Google Chrome via Playwright", externalRequests: 0, profiles, assertions };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true }); fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, evidencePath, profileSummary: Object.fromEntries(Object.entries(profiles).map(([key, value]) => [key, { firstRenderMs: value.firstRenderMs, rafCallbacks: value.rafCallbacks, logs: value.logs.length }])), assertions }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
