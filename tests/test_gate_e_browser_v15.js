#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

function option(name, fallback) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
const baseUrl = option("--base-url", "http://127.0.0.1:8877/index.html?v=v15-gate-e-browser");
const evidencePath = path.resolve(option("--evidence", "/tmp/lospollos-v15-gate-e-browser.json"));
const chromePath = process.env.STCT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const evidence = { version: "v1.5-gate-e-browser", status: "FAIL", checks: [], metrics: {}, console: [], warningClassification: [] };
function check(id, condition, detail) { assert(condition, `${id}: ${JSON.stringify(detail)}`); evidence.checks.push({ id, status: "PASS", detail }); }
function percentile(values, fraction) { const sorted = values.slice().sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]; }
function candidate(base, index) {
  const plan = clone(base); plan.planId = `PLAN-GATE-E-${index}`; plan.planHash = `sha256:plan-gate-e-${index}`; plan.requestHash = `sha256:request-gate-e-${index}`; plan.verification.computedPlanHash = plan.planHash;
  const metrics = { totalCost: 900 + index * 31, estimatedRoadKm: 145 + (index * 17) % 65, totalCO2: 28 + index * 2.5, usedVehicles: 7 + index % 2, utilizationScore: 58 + index * 4, latestEndMinutes: 970 + index * 9 };
  plan.verification.recomputedMetrics = { ...plan.verification.recomputedMetrics, ...metrics }; plan.metrics = { ...plan.metrics, ...metrics }; plan.labels = [`candidate-${index}`]; plan.meta = { ...plan.meta, goalLabel: `Observed candidate ${index}` }; return plan;
}

async function main() {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  await context.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener; const remove = EventTarget.prototype.removeEventListener; const rows = [];
    const capture = (options) => typeof options === "boolean" ? options : Boolean(options?.capture);
    EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) { if (listener && !rows.some((row) => row.target === this && row.type === type && row.listener === listener && row.capture === capture(options))) rows.push({ target: this, type, listener, capture: capture(options) }); return add.call(this, type, listener, options); };
    EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) { const index = rows.findIndex((row) => row.target === this && row.type === type && row.listener === listener && row.capture === capture(options)); if (index >= 0) rows.splice(index, 1); return remove.call(this, type, listener, options); };
    window.__stctListenerCount = (type) => rows.filter((row) => !type || row.type === type).length;
  });
  const page = await context.newPage();
  page.on("console", (message) => evidence.console.push({ type: message.type(), text: message.text(), location: message.location() }));
  page.on("pageerror", (error) => evidence.console.push({ type: "pageerror", text: error.message }));
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120000 }); await page.selectOption("#loginLang", "en"); await page.fill("#loginUser", "demo"); await page.fill("#loginPass", "demo123"); await page.click(".login-btn");
    await page.waitForFunction(() => getComputedStyle(document.getElementById("loginScreen")).display === "none", null, { timeout: 30000 });
    const fixture = buildFixture({ orderCount: 60, routeCount: 7, planSuffix: "GATE-E", inputSuffix: "GATE-E" }); fixture.scenario.meta = { synthetic: true, dataClassification: "SYNTHETIC_DEMO" };
    const plans = Array.from({ length: 6 }, (_, index) => candidate(fixture.plan, index + 1));
    await page.evaluate(({ scenario, values }) => { const state = window.STCTPlanning.state; state.phase = "applied"; state.scenario = scenario; state.candidates = values; state.selectedPlanId = values[0].planId; state.selectedScenarioId = values[0].planId; state.baseline = { plan: values[0], scenario, selectedPlanId: values[0].planId }; state.whatIfResults = []; state.manual = null; }, { scenario: fixture.scenario, values: plans });
    await page.evaluate(() => window.STCTExperienceUI.open("replay")); await page.waitForSelector(".exp-replay"); await page.waitForFunction(() => window.STCTExperienceUI.mapAdapter.replayReady, null, { timeout: 30000 });

    const eventSeek = await page.evaluate(async () => {
      const rows = [...document.querySelectorAll("#expEventFeed .exp-event[data-event-id]")].slice(0, 30); const latencies = []; const failures = [];
      for (const button of rows) {
        const expected = button.querySelector("time")?.textContent?.trim(); const started = performance.now(); button.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const actual = document.getElementById("expReplayTime")?.textContent?.trim(); latencies.push(performance.now() - started); if (actual !== expected) failures.push({ expected, actual, eventId: button.dataset.eventId });
      }
      return { count: rows.length, latencies, failures };
    });
    evidence.metrics.eventSeekVisibleP95Ms = percentile(eventSeek.latencies, .95);
    check("T249", eventSeek.count >= 5 && eventSeek.failures.length === 0 && evidence.metrics.eventSeekVisibleP95Ms < 100, { ...eventSeek, p95Ms: evidence.metrics.eventSeekVisibleP95Ms });

    const listenerBefore = await page.evaluate(() => ({ total: window.__stctListenerCount(), visibility: window.__stctListenerCount("visibilitychange"), keydown: window.__stctListenerCount("keydown"), mapHandlers: window.STCTExperienceUI.mapAdapter.handlers.length, incidentListeners: window.STCTV15.incidentUI.state.listenerCount }));
    const cycles = await page.evaluate(async () => {
      const button = document.querySelector("[data-replay-toggle]"); const rows = [];
      for (let index = 0; index < 10; index += 1) {
        button.click(); await new Promise((resolve) => setTimeout(resolve, 45)); button.click(); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        rows.push({ cycle: index + 1, status: window.STCTExperienceUI.state.replay.state.status, raf: window.STCTExperienceUI.state.raf, mapHandlers: window.STCTExperienceUI.mapAdapter.handlers.length });
      }
      return rows;
    });
    const listenerAfter = await page.evaluate(() => ({ total: window.__stctListenerCount(), visibility: window.__stctListenerCount("visibilitychange"), keydown: window.__stctListenerCount("keydown"), mapHandlers: window.STCTExperienceUI.mapAdapter.handlers.length, incidentListeners: window.STCTV15.incidentUI.state.listenerCount }));
    check("T259", cycles.every((row) => row.status === "paused" && row.raf === 0 && row.mapHandlers === listenerBefore.mapHandlers)
      && listenerAfter.total <= listenerBefore.total
      && listenerAfter.visibility === listenerBefore.visibility
      && listenerAfter.keydown === listenerBefore.keydown
      && listenerAfter.mapHandlers === listenerBefore.mapHandlers
      && listenerAfter.incidentListeners === listenerBefore.incidentListeners, { listenerBefore, listenerAfter, cycles });

    await page.evaluate(() => window.STCTExperienceUI.switchMode("arena")); await page.waitForSelector("#expV15Arena [data-v15-frontier]");
    const frontier = await page.evaluate(async () => {
      const buttons = [...document.querySelectorAll(".exp-v15-candidate")]; const latencies = []; const failures = [];
      for (const button of buttons) {
        const hash = button.dataset.planHash; const started = performance.now(); button.click(); await new Promise((resolve) => requestAnimationFrame(resolve)); latencies.push(performance.now() - started);
        if (document.getElementById("expArenaB")?.value !== hash || window.STCTV15.ui.state.arena.selectedPlanHash !== hash) failures.push(hash);
      }
      return { count: buttons.length, latencies, failures, chartCount: document.querySelectorAll(".exp-v15-point").length, listCount: buttons.length };
    });
    evidence.metrics.frontierClickP95Ms = percentile(frontier.latencies, .95);
    check("T253", frontier.count === 6 && frontier.failures.length === 0 && evidence.metrics.frontierClickP95Ms < 150, { ...frontier, p95Ms: evidence.metrics.frontierClickP95Ms });
    check("T268", frontier.chartCount === frontier.listCount && frontier.listCount === 6, frontier);

    const colorIndependent = await page.evaluate(() => ({ candidates: [...document.querySelectorAll(".exp-v15-candidate")].every((item) => /Frontier|Dominated/.test(item.textContent)), engineStatuses: [...document.querySelectorAll(".exp-v15-engine-row .status")].every((item) => item.textContent.trim().length > 0), matrixBoundary: document.querySelector(".exp-v15-matrix-lab")?.textContent.includes("Road Matrix unavailable") }));
    check("T267", Object.values(colorIndependent).every(Boolean), colorIndependent);

    const arenaFocus = await page.evaluate(async () => {
      const first = document.querySelector(".exp-v15-candidate"); first.focus(); const before = window.STCTV15.ui.state.arena.selectedPlanHash; first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await new Promise((resolve) => requestAnimationFrame(resolve));
      return { before, after: window.STCTV15.ui.state.arena.selectedPlanHash, activeTag: document.activeElement?.tagName, positiveTabIndex: [...document.querySelectorAll("[tabindex]")].filter((item) => Number(item.getAttribute("tabindex")) > 0).length };
    });
    await page.evaluate(() => window.STCTExperienceUI.switchMode("replay")); await page.waitForSelector("#expIncidentOpen");
    await page.focus("#expIncidentOpen"); await page.keyboard.press("Enter"); await page.waitForSelector("#expIncidentStudio", { state: "visible" }); await page.waitForFunction(() => document.activeElement?.classList.contains("exp-incident-close"));
    const dialogFocus = await page.evaluate(() => ({ activeClass: document.activeElement?.className, role: document.getElementById("expIncidentStudio")?.getAttribute("role"), modal: document.getElementById("expIncidentStudio")?.getAttribute("aria-modal") }));
    await page.keyboard.press("Escape"); await page.waitForSelector("#expIncidentStudio", { state: "hidden" });
    const focusReturned = await page.evaluate(() => document.activeElement?.id === "expIncidentOpen");
    check("T266", arenaFocus.before !== arenaFocus.after && arenaFocus.positiveTabIndex === 0 && dialogFocus.role === "dialog" && dialogFocus.modal === "true" && focusReturned, { arenaFocus, dialogFocus, focusReturned });

    await page.emulateMedia({ reducedMotion: "reduce" }); await page.evaluate(() => window.STCTExperienceUI.close({ restore: false })); await page.evaluate(() => window.STCTExperienceUI.open("replay")); await page.waitForSelector("#expIncidentOpen");
    await page.click("[data-replay-toggle]"); await page.waitForTimeout(120); await page.click("[data-replay-toggle]");
    await page.click("#expIncidentOpen"); await page.selectOption('[data-incident-field="type"]', "VEHICLE_BREAKDOWN"); await page.selectOption('[data-incident-field="targetId"]', "VEH-1"); await page.click('[data-incident-action="inject"]'); await page.waitForFunction(() => window.STCTV15.incidentUI.state?.phase === "INJECTED"); await page.waitForTimeout(180);
    const reduced = await page.evaluate(() => ({ reducedMotion: window.STCTExperience.state.reducedMotion, pulseFrames: window.STCTExperienceUI.mapAdapter.incidentPulseFrames, animationFrame: window.STCTExperienceUI.mapAdapter.incidentAnimationFrame, replayOperable: window.STCTExperienceUI.state.replay.state.currentMinute >= window.STCTExperienceUI.state.replay.model.startMinute, trustTransition: getComputedStyle(document.querySelector(".exp-v15-trust-lab")).transitionDuration }));
    check("T245", reduced.reducedMotion && reduced.pulseFrames === 0 && reduced.animationFrame === 0 && reduced.replayOperable && ["0s", "0ms"].includes(reduced.trustTransition), reduced);
    await page.click('[data-incident-action="close"]');

    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(120);
    const safeArea = await page.evaluate(async () => {
      const css = await fetch("./experience-v15.css").then((response) => response.text()); const trust = document.querySelector(".exp-v15-trust-lab").getBoundingClientRect(); const nav = document.querySelector(".navrail").getBoundingClientRect();
      return { cssHasInsets: ["safe-area-inset-left", "safe-area-inset-right", "safe-area-inset-bottom"].every((value) => css.includes(value)), trust: trust.toJSON(), nav: nav.toJSON(), viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    check("T270", safeArea.cssHasInsets && safeArea.trust.left >= 0 && safeArea.trust.right <= safeArea.viewport.width + 1 && safeArea.trust.bottom <= safeArea.nav.top + 1 && safeArea.overflow <= 1, safeArea);

    const framework = await page.evaluate(() => ({ overlays: ["vite-error-overlay", "#webpack-dev-server-client-overlay", "nextjs-portal", "#react-error-overlay"].filter((selector) => document.querySelector(selector)).length, bodyText: document.body.innerText.includes("Unhandled Runtime Error") }));
    check("T263", framework.overlays === 0 && !framework.bodyText, framework);
    const appErrors = evidence.console.filter((entry) => entry.type === "error" || entry.type === "pageerror");
    check("T264", appErrors.length === 0, appErrors);
    evidence.warningClassification = evidence.console.filter((entry) => entry.type === "warning" || entry.type === "warn").map((entry) => ({ ...entry, classification: /MapLibre|OpenFreeMap|tile|glyph|Expected value to be of type number/i.test(entry.text) || /openfreemap|maplibre/i.test(entry.location?.url || "") ? "EXTERNAL_MAP" : "APPLICATION" }));
    check("T265", evidence.warningClassification.every((entry) => entry.classification === "EXTERNAL_MAP"), evidence.warningClassification);
    evidence.status = "PASS";
  } finally {
    await context.close(); await browser.close(); evidence.completedAt = new Date().toISOString(); fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ status: evidence.status, evidencePath, checks: evidence.checks.length, metrics: evidence.metrics }, null, 2)}\n`);
}

main().catch((error) => { evidence.failure = { name: error.name, message: error.message, stack: error.stack }; try { fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`); } catch (_error) {} console.error(error.stack || error); process.exitCode = 1; });
