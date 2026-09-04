#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { buildFixture } = require("./experience_fixture_v14.js");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const baseUrl = option("--base-url", process.env.STCT_BASE_URL || "http://127.0.0.1:8876/index.html?optPort=8890");
const outputPath = path.resolve(option("--evidence", process.env.STCT_PERFORMANCE_EVIDENCE || "/tmp/stct-v14-experience-performance.json"));
const chromePath = process.env.STCT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const knownMapWarning = "Expected value to be of type number, but found null instead.";
const evidence = {
  version: "v1.4-trust-closure-mission-control",
  status: "FAIL",
  measurement: "headless Chrome requestAnimationFrame and visible DOM update latency",
  target: { stops: 60, vehicles: 7, replayRafFpsMin: 30, scrubMsMax: 50, vehicleSelectionMsMax: 100, viewSwitchMsMax: 400 },
  metrics: {},
  resourceChecks: {},
  largeData: {},
  consoleErrors: [],
  consoleWarnings: [],
};

function percentileMax(values) {
  return Number(Math.max(...values).toFixed(3));
}

(async () => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  await context.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const rows = [];
    const capture = (options) => typeof options === "boolean" ? options : Boolean(options?.capture);
    EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
      if (listener && !rows.some((row) => row.target === this && row.type === type && row.listener === listener && row.capture === capture(options))) {
        rows.push({ target: this, type, listener, capture: capture(options) });
      }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
      const index = rows.findIndex((row) => row.target === this && row.type === type && row.listener === listener && row.capture === capture(options));
      if (index >= 0) rows.splice(index, 1);
      return remove.call(this, type, listener, options);
    };
    window.__stctListenerCount = (type) => rows.filter((row) => !type || row.type === type).length;
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") evidence.consoleErrors.push({ text: message.text(), location: message.location() });
    if (message.type() === "warning") evidence.consoleWarnings.push({ text: message.text(), location: message.location() });
  });
  page.on("pageerror", (error) => evidence.consoleErrors.push({ text: error.message, type: "pageerror" }));

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.fill("#loginUser", "demo");
    await page.fill("#loginPass", "demo123");
    await page.click(".login-btn");
    await page.waitForFunction(() => getComputedStyle(document.getElementById("loginScreen")).display === "none", null, { timeout: 30000 });

    const baselineListeners = await page.evaluate(() => ({
      visibilitychange: window.__stctListenerCount("visibilitychange"),
      keydown: window.__stctListenerCount("keydown"),
    }));
    const primary = buildFixture({ orderCount: 60, routeCount: 7, planSuffix: "PERF-A", inputSuffix: "PERF-60" });
    const alternate = buildFixture({ orderCount: 60, routeCount: 7, planSuffix: "PERF-B", inputSuffix: "PERF-60" });
    await page.evaluate(({ first, second }) => {
      const state = window.STCTPlanning.state;
      state.phase = "applied";
      state.scenario = first.scenario;
      state.candidates = [first.plan, second.plan];
      state.selectedPlanId = first.plan.planId;
      state.baseline = { plan: first.plan, scenario: first.scenario, selectedPlanId: first.plan.planId };
      state.whatIfResults = [];
      state.manual = null;
    }, { first: primary, second: alternate });

    const replayOpenMs = await page.evaluate(async () => {
      const started = performance.now();
      await window.STCTExperienceUI.open("replay");
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return performance.now() - started;
    });
    await page.waitForSelector(".exp-replay");
    await page.waitForFunction(() => window.STCTExperienceUI.mapAdapter.replayReady, null, { timeout: 30000 });
    const scale = await page.evaluate(() => ({
      stops: window.STCTExperienceUI.state.replay.model.schedules.reduce((sum, route) => sum + route.stops.length, 0),
      vehicles: window.STCTExperienceUI.state.replay.model.schedules.length,
    }));
    assert.deepStrictEqual(scale, { stops: 60, vehicles: 7 });

    const replayFrame = await page.evaluate(async () => {
      document.querySelector("[data-replay-toggle]").click();
      const started = performance.now();
      let frames = 0;
      const ended = await new Promise((resolve) => {
        const frame = (time) => {
          frames += 1;
          if (time - started >= 1200) resolve(time);
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      document.querySelector("[data-replay-toggle]").click();
      return { frames, durationMs: ended - started, fps: frames / ((ended - started) / 1000), advancedMinute: window.STCTExperienceUI.state.replay.state.currentMinute };
    });

    const interactionLatency = await page.evaluate(async () => {
      const afterPaint = () => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())));
      const scrub = document.getElementById("expReplayScrub");
      const vehicle = document.getElementById("expReplayVehicle");
      const scrubRows = [];
      const vehicleRows = [];
      for (let index = 0; index < 5; index += 1) {
        let started = performance.now();
        scrub.value = String(Number(scrub.min) + 5 + index);
        scrub.dispatchEvent(new Event("input", { bubbles: true }));
        scrubRows.push(await afterPaint() - started);
        started = performance.now();
        vehicle.selectedIndex = (vehicle.selectedIndex + 1) % vehicle.options.length;
        vehicle.dispatchEvent(new Event("change", { bubbles: true }));
        vehicleRows.push(await afterPaint() - started);
      }
      return { scrubRows, vehicleRows };
    });

    const replayListeners = await page.evaluate(() => ({
      visibilitychange: window.__stctListenerCount("visibilitychange"),
      keydown: window.__stctListenerCount("keydown"),
      mapHandlers: window.STCTExperienceUI.mapAdapter.handlers.length,
    }));
    const cycleEvidence = await page.evaluate(async () => {
      const toggle = document.querySelector("[data-replay-toggle]");
      const rows = [];
      for (let index = 0; index < 5; index += 1) {
        toggle.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        toggle.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        rows.push({ status: window.STCTExperienceUI.state.replay.state.status, raf: window.STCTExperienceUI.state.raf, handlers: window.STCTExperienceUI.mapAdapter.handlers.length });
      }
      toggle.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      window.STCTExperienceUI.state.replay.handleVisibility(true);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        rows,
        hidden: { status: window.STCTExperienceUI.state.replay.state.status, raf: window.STCTExperienceUI.state.raf },
        listeners: { visibilitychange: window.__stctListenerCount("visibilitychange"), keydown: window.__stctListenerCount("keydown") },
      };
    });

    async function switchMetric(mode) {
      return page.evaluate(async (target) => {
        const started = performance.now();
        await window.STCTExperienceUI.switchMode(target);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return performance.now() - started;
      }, mode);
    }
    const arenaSwitchMs = await switchMetric("arena");
    const timelineSwitchMs = await switchMetric("timeline");
    const replaySwitchMs = await switchMetric("replay");

    const large = buildFixture({ orderCount: 240, routeCount: 7, planSuffix: "PERF-240", inputSuffix: "PERF-240" });
    await page.evaluate(({ scenario, plan }) => {
      window.STCTExperienceUI.close({ restore: false });
      const state = window.STCTPlanning.state;
      state.scenario = scenario;
      state.candidates = [plan];
      state.selectedPlanId = plan.planId;
      state.baseline = null;
      state.whatIfResults = [];
      state.manual = null;
    }, large);
    const timeline240RenderMs = await page.evaluate(async () => {
      const started = performance.now();
      await window.STCTExperienceUI.open("timeline");
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return performance.now() - started;
    });
    await page.click('[data-timeline-stop="ORDER-240"]');
    const largeData = await page.evaluate(() => ({
      lanes: window.STCTExperienceUI.state.timeline.snapshot().timeline.lanes.length,
      serviceBlocks: window.STCTExperienceUI.state.timeline.snapshot().timeline.lanes.flatMap((lane) => lane.blocks).filter((block) => block.type === "SERVICE").length,
      selectedOrderId: window.STCTExperienceUI.state.timeline.state.selectedOrderId,
    }));
    assert.deepStrictEqual(largeData, { lanes: 7, serviceBlocks: 240, selectedOrderId: "ORDER-240" });

    await page.evaluate(() => window.STCTExperienceUI.close({ restore: false }));
    await page.waitForTimeout(80);
    const cleanup = await page.evaluate(() => {
      const map = window.STCTExperienceUI.mapAdapter.map;
      return {
        raf: window.STCTExperienceUI.state.raf,
        mapHandlers: window.STCTExperienceUI.mapAdapter.handlers.length,
        layers: (map?.getStyle?.().layers || []).filter((layer) => layer.id.startsWith("stct-v14-")).length,
        sources: Object.keys(map?.getStyle?.().sources || {}).filter((id) => id.startsWith("stct-v14-")).length,
        listeners: { visibilitychange: window.__stctListenerCount("visibilitychange"), keydown: window.__stctListenerCount("keydown") },
      };
    });

    evidence.metrics = {
      replayOpenMs: Number(replayOpenMs.toFixed(3)),
      replayRafFps: Number(replayFrame.fps.toFixed(3)),
      replayRafFrames: replayFrame.frames,
      replayRafDurationMs: Number(replayFrame.durationMs.toFixed(3)),
      scrubMaxMs: percentileMax(interactionLatency.scrubRows),
      vehicleSelectionMaxMs: percentileMax(interactionLatency.vehicleRows),
      arenaSwitchMs: Number(arenaSwitchMs.toFixed(3)),
      timelineSwitchMs: Number(timelineSwitchMs.toFixed(3)),
      replaySwitchMs: Number(replaySwitchMs.toFixed(3)),
      viewSwitchMaxMs: Number(Math.max(arenaSwitchMs, timelineSwitchMs, replaySwitchMs).toFixed(3)),
      timeline240RenderMs: Number(timeline240RenderMs.toFixed(3)),
    };
    evidence.resourceChecks = { baselineListeners, replayListeners, fivePlayStopCycles: cycleEvidence.rows, hiddenVisibilityHandler: cycleEvidence.hidden, listenersAfterCycles: cycleEvidence.listeners, cleanup };
    evidence.largeData = { replay: scale, timeline240: largeData };

    assert(evidence.metrics.replayRafFps >= evidence.target.replayRafFpsMin, `Replay rAF cadence ${evidence.metrics.replayRafFps}`);
    assert(evidence.metrics.scrubMaxMs < evidence.target.scrubMsMax, `Scrub ${evidence.metrics.scrubMaxMs}ms`);
    assert(evidence.metrics.vehicleSelectionMaxMs < evidence.target.vehicleSelectionMsMax, `Vehicle selection ${evidence.metrics.vehicleSelectionMaxMs}ms`);
    assert(evidence.metrics.viewSwitchMaxMs < evidence.target.viewSwitchMsMax, `View switch ${evidence.metrics.viewSwitchMaxMs}ms`);
    assert(cycleEvidence.rows.every((row) => row.status === "paused" && row.raf === 0 && row.handlers === replayListeners.mapHandlers));
    assert.deepStrictEqual(cycleEvidence.listeners, { visibilitychange: replayListeners.visibilitychange, keydown: replayListeners.keydown });
    assert.deepStrictEqual(cycleEvidence.hidden, { status: "paused", raf: 0 });
    assert.strictEqual(cleanup.raf, 0);
    assert.strictEqual(cleanup.mapHandlers, 0);
    assert.strictEqual(cleanup.layers, 0);
    assert.strictEqual(cleanup.sources, 0);
    assert.deepStrictEqual(cleanup.listeners, baselineListeners);
    assert.strictEqual(evidence.consoleErrors.length, 0, JSON.stringify(evidence.consoleErrors));
    assert(evidence.consoleWarnings.every((warning) => warning.text === knownMapWarning), JSON.stringify(evidence.consoleWarnings));
    evidence.status = "PASS";
  } catch (error) {
    evidence.failure = { name: error.name, message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
    evidence.completedAt = new Date().toISOString();
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ status: evidence.status, outputPath, metrics: evidence.metrics, failure: evidence.failure || null }, null, 2)}\n`);
  }
})();
