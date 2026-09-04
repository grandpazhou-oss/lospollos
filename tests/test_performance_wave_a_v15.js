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

const baseUrl = option("--base-url", "http://127.0.0.1:8877/index.html?v=v15-wave-a-performance");
const evidencePath = path.resolve(option("--evidence", "/tmp/lospollos-v15-wave-a-performance.json"));
const chromePath = process.env.STCT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sampleMs = Number(option("--sample-ms", "5200"));
const scales = [
  { stops: 60, routes: 7, minimumApplicationHz: 30 },
  { stops: 120, routes: 12, minimumApplicationHz: 24 },
  { stops: 240, routes: 20, minimumApplicationHz: 15 },
];
const evidence = {
  version: "v1.5.1-integrity-closure",
  methodology: {
    sampleMs,
    logicalSpeed: "1 replay minute per wall-clock second",
    browserRafHz: "Replay scheduler requestAnimationFrame callbacks per wall-clock second",
    applicationUpdateHz: "updateReplayView calls per wall-clock second",
    mapAdapterUpdateHz: "mapAdapter.updateReplay calls per wall-clock second",
    mapSourceUpdateHz: "Successful Replay GeoJSON source.setData calls per wall-clock second",
    visibleCursorUpdateHz: "Distinct visible timeline cursor values per wall-clock second",
    droppedApplicationFrames: "Missed application update slots against the active stop-count target",
    longTaskCount: "PerformanceObserver longtask entries recorded during the sample",
  },
  status: "FAIL",
  samples: [],
  checks: [],
  console: [],
};

function check(id, condition, detail) {
  evidence.checks.push({ id, status: condition ? "PASS" : "FAIL", detail });
  assert(condition, `${id}: ${JSON.stringify(detail)}`);
}

async function installFixture(page, scale) {
  const fixture = buildFixture({
    orderCount: scale.stops,
    routeCount: scale.routes,
    planSuffix: `PERF-${scale.stops}`,
    inputSuffix: `PERF-${scale.stops}`,
  });
  await page.evaluate(({ scenario, plan }) => {
    const state = window.STCTPlanning.state;
    state.phase = "applied";
    state.scenario = scenario;
    state.candidates = [plan];
    state.selectedPlanId = plan.planId;
    state.baseline = { plan, scenario, selectedPlanId: plan.planId };
    state.whatIfResults = [];
    state.manual = null;
  }, fixture);
}

async function sampleScale(browser, scale) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  await context.addInitScript(() => {
    window.__stctLongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => window.__stctLongTasks.push(...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration }))));
      observer.observe({ type: "longtask", buffered: true });
      window.__stctLongTaskObserver = observer;
    } catch (_error) {}
  });
  const page = await context.newPage();
  page.on("console", (message) => evidence.console.push({ stops: scale.stops, type: message.type(), text: message.text(), location: message.location() }));
  page.on("pageerror", (error) => evidence.console.push({ stops: scale.stops, type: "pageerror", text: error.message }));

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.fill("#loginUser", "demo");
    await page.fill("#loginPass", "demo123");
    await page.click(".login-btn");
    await page.waitForFunction(() => getComputedStyle(document.getElementById("loginScreen")).display === "none", null, { timeout: 30000 });
    await installFixture(page, scale);
    await page.evaluate(() => window.STCTExperienceUI.open("replay"));
    await page.waitForSelector(".exp-replay");
    await page.waitForFunction(() => window.STCTExperienceUI.mapAdapter.replayReady, null, { timeout: 30000 });

    const before = await page.evaluate(() => {
      window.__stctLongTasks.length = 0;
      window.STCTExperienceUI.state.replay.restart();
      window.STCTExperienceUI.state.replay.setSpeed(1);
      window.STCTExperienceUI.resetPerformanceCounters();
      const state = window.STCTExperienceUI.state.replay.snapshot();
      return { minute: state.currentMinute, status: state.status };
    });
    await page.click("[data-replay-toggle]");
    await page.waitForTimeout(sampleMs);
    const sample = await page.evaluate(() => {
      const performanceData = window.STCTExperienceUI.performanceSnapshot();
      const replay = window.STCTExperienceUI.state.replay.snapshot();
      window.STCTExperienceUI.state.replay.pause();
      return {
        performanceData,
        replay: { currentMinute: replay.currentMinute, status: replay.status },
        longTasks: [...window.__stctLongTasks],
        model: {
          stops: window.STCTExperienceUI.state.replay.model.schedules.reduce((sum, route) => sum + route.stops.length, 0),
          vehicles: window.STCTExperienceUI.state.replay.model.schedules.length,
        },
      };
    });
    const durationSeconds = sample.performanceData.durationMs / 1000;
    const counts = sample.performanceData.counts;
    const row = {
      stops: scale.stops,
      vehicles: sample.model.vehicles,
      durationMs: sample.performanceData.durationMs,
      logicalMinutesAdvanced: Number((sample.replay.currentMinute - before.minute).toFixed(3)),
      replayStatusDuringSample: sample.replay.status,
      browserRafHz: Number((counts.browserRafCallbacks / durationSeconds).toFixed(3)),
      applicationUpdateHz: Number((counts.updateReplayView / durationSeconds).toFixed(3)),
      mapAdapterUpdateHz: Number((counts.mapAdapterUpdateReplay / durationSeconds).toFixed(3)),
      mapSourceUpdateHz: Number((counts.geoJsonSetData / durationSeconds).toFixed(3)),
      visibleCursorUpdateHz: Number((counts.visibleCursorUpdates / durationSeconds).toFixed(3)),
      eventFeedRenderHz: Number((counts.eventFeedRender / durationSeconds).toFixed(3)),
      droppedApplicationFrames: counts.droppedApplicationFrames,
      longTaskCount: sample.longTasks.length,
      longTasks: sample.longTasks,
      rawCounts: counts,
      lodMode: sample.performanceData.lod?.mode || "UNKNOWN",
      minimumApplicationHz: scale.minimumApplicationHz,
    };
    evidence.samples.push(row);
    return row;
  } finally {
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  try {
    for (const scale of scales) {
      const sample = await sampleScale(browser, scale);
      check(`T${scale.stops === 60 ? "254" : scale.stops === 120 ? "255" : "256"}`, sample.applicationUpdateHz >= scale.minimumApplicationHz && (scale.stops < 240 || sample.lodMode === "DYNAMIC_240"), sample);
      check(`PERF-${scale.stops}-logical-progress`, sample.replayStatusDuringSample === "playing" && sample.logicalMinutesAdvanced >= 4.5, sample);
      check(`PERF-${scale.stops}-separate-counters`, sample.browserRafHz > 0 && sample.applicationUpdateHz > 0 && sample.mapAdapterUpdateHz > 0 && sample.mapSourceUpdateHz > 0 && sample.mapSourceUpdateHz <= sample.mapAdapterUpdateHz, sample);
    }
    const scale240 = evidence.samples.find((row) => row.stops === 240);
    check("V151-PERF-240-LONGTASK", scale240?.longTaskCount < 15, scale240);
    check("T257", evidence.samples.every((row) => Number.isFinite(row.browserRafHz) && Number.isFinite(row.applicationUpdateHz) && Object.hasOwn(row.rawCounts, "browserRafCallbacks") && Object.hasOwn(row.rawCounts, "updateReplayView")), evidence.samples);
    check("T258", evidence.samples.every((row) => row.rawCounts.geoJsonSetData > 0 && row.mapSourceUpdateHz > 0), evidence.samples);
    const appErrors = evidence.console.filter((row) => row.type === "pageerror" || row.type === "error");
    check("PERF-console", appErrors.length === 0, appErrors);
    evidence.status = "PASS";
  } finally {
    await browser.close();
    evidence.completedAt = new Date().toISOString();
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
}

main().then(() => {
  process.stdout.write(`${JSON.stringify({ status: evidence.status, evidencePath, checks: evidence.checks.length, samples: evidence.samples }, null, 2)}\n`);
}).catch((error) => {
  evidence.failure = { name: error.name, message: error.message, stack: error.stack };
  try { fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8"); } catch (_error) {}
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
