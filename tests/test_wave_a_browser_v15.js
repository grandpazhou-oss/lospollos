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

const baseUrl = option("--base-url", "http://127.0.0.1:8877/index.html?v=v15-wave-a-browser");
const evidencePath = path.resolve(option("--evidence", "/tmp/lospollos-v15-wave-a-browser.json"));
const screenshotDir = path.resolve(option("--screenshots", path.join(path.dirname(evidencePath), "wave-a-screenshots")));
const chromePath = process.env.STCT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const checks = [];
const evidence = { version: "v1.5-wave-a", status: "FAIL", checks, console: [], screenshots: [] };

function check(id, condition, detail = {}) {
  assert(condition, `${id}: ${JSON.stringify(detail)}`);
  checks.push({ id, status: "PASS", detail });
}

async function main() {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.mkdirSync(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  await context.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const rows = [];
    const capture = (options) => typeof options === "boolean" ? options : Boolean(options?.capture);
    EventTarget.prototype.addEventListener = function trackedAdd(type, listener, options) {
      if (listener && !rows.some((row) => row.target === this && row.type === type && row.listener === listener && row.capture === capture(options))) rows.push({ target: this, type, listener, capture: capture(options) });
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function trackedRemove(type, listener, options) {
      const index = rows.findIndex((row) => row.target === this && row.type === type && row.listener === listener && row.capture === capture(options));
      if (index >= 0) rows.splice(index, 1);
      return remove.call(this, type, listener, options);
    };
    window.__listenerCounts = () => ({ visibilitychange: rows.filter((row) => row.type === "visibilitychange").length, keydown: rows.filter((row) => row.type === "keydown").length });
  });
  const page = await context.newPage();
  page.on("console", (message) => evidence.console.push({ type: message.type(), text: message.text(), location: message.location() }));
  page.on("pageerror", (error) => evidence.console.push({ type: "pageerror", text: error.message }));

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.fill("#loginUser", "demo");
    await page.fill("#loginPass", "demo123");
    await page.click(".login-btn");
    await page.waitForFunction(() => getComputedStyle(document.getElementById("loginScreen")).display === "none", null, { timeout: 30000 });
    const fixture = buildFixture({ orderCount: 60, routeCount: 7, planSuffix: "WAVE-A", inputSuffix: "WAVE-A" });
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

    await page.evaluate(() => window.STCTExperienceUI.open("replay"));
    await page.waitForSelector(".exp-replay");
    await page.waitForFunction(() => window.STCTExperienceUI.mapAdapter.replayReady, null, { timeout: 30000 });
    const versions = await page.evaluate(() => ({ simulation: window.STCTSimulationStoreFactory.VERSION, experience: window.STCTExperience.VERSION, replay: window.STCTReplay.VERSION, timeline: window.STCTTimeline.VERSION }));
    check("A-runtime-versions", Object.values(versions).every((value) => String(value).includes("v1.5")), versions);

    await page.selectOption("#expReplayVehicle", "ALL");
    const allScope = await page.evaluate(() => ({ state: window.STCTExperienceUI.state.replay.state, inspector: document.getElementById("expReplayInspector").textContent, selectedFilterDisabled: document.querySelector('[data-event-filter="SELECTED_VEHICLE"]').disabled }));
    check("T031-browser", allScope.state.vehicleScope === "ALL" && allScope.inspector.includes("Fleet Summary"));
    check("T032-browser", allScope.state.followVehicle === false && allScope.selectedFilterDisabled);

    await page.selectOption("#expReplayVehicle", "VEH-3");
    const singleScope = await page.evaluate(() => window.STCTExperienceUI.state.replay.state);
    check("T033-browser", singleScope.vehicleScope === "SINGLE" && singleScope.selectedVehicleId === "VEH-3");

    await page.click('[data-delay-minutes="15"]');
    await page.waitForFunction(() => window.STCTExperience.state.activeEvents.length === 1);
    const afterDelay = await page.evaluate(() => ({ experience: window.STCTExperience.state, replay: window.STCTExperienceUI.state.replay.snapshot() }));
    check("A-single-write", afterDelay.experience.activeEvents.length === 1 && afterDelay.replay.simulationEvents.length === 1 && afterDelay.experience.simulationRevision === 1);
    await page.click("[data-delay-undo]");
    await page.waitForFunction(() => window.STCTExperience.state.activeEvents.length === 0);
    await page.click('[data-delay-minutes="30"]');
    await page.waitForFunction(() => window.STCTExperience.state.activeEvents.length === 1);
    await page.click("[data-delay-reset]");
    await page.waitForFunction(() => window.STCTExperience.state.activeEvents.length === 0);
    check("A-undo-reset", await page.evaluate(() => window.STCTExperience.state.simulationOperationLog.length === 4));

    await page.click('[data-delay-minutes="15"]');
    await page.waitForFunction(() => window.STCTExperience.state.activeEvents.length === 1);
    await page.locator("#expReplayScrub").evaluate((scrub) => {
      scrub.value = String(Number(scrub.max) - 1);
      scrub.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.click('[data-event-filter="EXCEPTION"]');
    const exceptionFeed = await page.evaluate(() => ({ filter: window.STCTExperienceUI.state.replay.state.eventFilter, rows: [...document.querySelectorAll(".exp-event")].map((row) => row.textContent) }));
    check("T035-browser", exceptionFeed.filter === "EXCEPTION" && exceptionFeed.rows.length > 0);
    await page.click('[data-event-filter="ALL"]');

    const eventTarget = await page.evaluate(() => {
      const button = [...document.querySelectorAll(".exp-event")].at(-1);
      const id = button.dataset.eventId;
      const event = window.STCTReplay.allReplayEvents(window.STCTExperienceUI.state.replay.model).find((row) => row.eventId === id);
      return { id, event, planHash: window.STCTExperienceUI.state.activePlan.planHash, simulationHash: window.STCTExperience.state.simulationHash };
    });
    await page.evaluate(() => window.STCTExperienceUI.state.replay.play());
    await page.locator(`[data-event-id="${eventTarget.id}"]`).click();
    const afterSeek = await page.evaluate(() => ({ replay: window.STCTExperienceUI.state.replay.snapshot(), experience: window.STCTExperience.state }));
    check("T038-browser", afterSeek.replay.status === "paused" && afterSeek.replay.currentMinute === eventTarget.event.minute && afterSeek.replay.selectedVehicleId === eventTarget.event.vehicleId);
    check("T039-browser", !eventTarget.event.orderId || afterSeek.replay.selectedOrderId === eventTarget.event.orderId);
    check("T037-browser", afterSeek.experience.simulationHash === eventTarget.simulationHash && windowHash(afterSeek.experience.activePlanHash) === windowHash(eventTarget.planHash));
    check("T040-browser", afterSeek.experience.replayState.currentMinute === eventTarget.event.minute);
    check("A-event-selected", afterSeek.replay.selectedEventId === eventTarget.id && await page.locator(`[data-event-id="${eventTarget.id}"]`).evaluate((row) => row.classList.contains("selected")));

    await page.uncheck("#expReplayStops");
    const stopVisibility = await page.evaluate(() => ({ state: window.STCTExperienceUI.state.replay.state.stopMarkersVisible, layer: window.STCTExperienceUI.mapAdapter.map.getLayoutProperty("stct-v14-replay-stops", "visibility") }));
    check("T044-browser", stopVisibility.state === false && stopVisibility.layer === "none", stopVisibility);
    check("T045-browser", (await page.textContent("#expRouteSummary")).includes("planned") && (await page.textContent("#expRouteSummary")).includes("waiting"));

    const desktopShot = path.join(screenshotDir, "wave-a-desktop.png");
    await page.screenshot({ path: desktopShot, fullPage: true });
    evidence.screenshots.push(desktopShot);

    await page.evaluate(() => window.STCTExperienceUI.close({ restore: false }));
    const baselineListeners = await page.evaluate(() => window.__listenerCounts());
    for (let index = 0; index < 10; index += 1) {
      await page.evaluate(() => window.STCTExperienceUI.open("replay"));
      await page.waitForSelector(".exp-replay");
      await page.evaluate(() => window.STCTExperienceUI.close({ restore: false }));
    }
    const cleanup = await page.evaluate(() => {
      const map = window.STCTExperienceUI.mapAdapter.map;
      return {
        listeners: window.__listenerCounts(),
        raf: window.STCTExperienceUI.state.raf,
        handlers: window.STCTExperienceUI.mapAdapter.handlers.length,
        layers: (map?.getStyle?.().layers || []).filter((layer) => layer.id.startsWith("stct-v14-")).length,
        sources: Object.keys(map?.getStyle?.().sources || {}).filter((id) => id.startsWith("stct-v14-")).length,
      };
    });
    check("T027", cleanup.raf === 0 && cleanup.handlers === 0 && cleanup.layers === 0 && cleanup.sources === 0, cleanup);
    check("T028", JSON.stringify(cleanup.listeners) === JSON.stringify(baselineListeners), { baselineListeners, after: cleanup.listeners });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.STCTExperienceUI.open("replay"));
    await page.waitForSelector(".exp-replay");
    await page.locator("#expReplayScrub").evaluate((scrub) => {
      scrub.value = scrub.max;
      scrub.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const mobileEventId = await page.locator(".exp-event").last().getAttribute("data-event-id");
    await page.locator(`[data-event-id="${mobileEventId}"]`).click();
    const mobileRect = await page.locator(`[data-event-id="${mobileEventId}"]`).boundingBox();
    check("T049", mobileRect && mobileRect.y >= 0 && mobileRect.y + mobileRect.height <= 844, mobileRect || {});
    const portraitShot = path.join(screenshotDir, "wave-a-mobile-portrait.png");
    await page.screenshot({ path: portraitShot, fullPage: true });
    evidence.screenshots.push(portraitShot);

    await page.setViewportSize({ width: 844, height: 390 });
    const controlsRect = await page.locator(".exp-replay-controls").boundingBox();
    check("T050", controlsRect && controlsRect.y >= 0 && controlsRect.y < 390 && controlsRect.height > 0, controlsRect || {});
    const landscapeShot = path.join(screenshotDir, "wave-a-mobile-landscape.png");
    await page.screenshot({ path: landscapeShot, fullPage: true });
    evidence.screenshots.push(landscapeShot);

    const appErrors = evidence.console.filter((row) => row.type === "pageerror" || row.type === "error" && !row.text.includes("Expected value to be of type number"));
    check("A-console", appErrors.length === 0, { appErrors });
    evidence.status = "PASS";
  } finally {
    await context.close();
    await browser.close();
    evidence.completedAt = new Date().toISOString();
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
}

function windowHash(value) {
  return String(value || "");
}

main().then(() => {
  process.stdout.write(`${JSON.stringify({ status: evidence.status, evidencePath, checks: checks.length, screenshots: evidence.screenshots.length }, null, 2)}\n`);
}).catch((error) => {
  evidence.failure = { name: error.name, message: error.message, stack: error.stack };
  try { fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8"); } catch (_error) {}
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
