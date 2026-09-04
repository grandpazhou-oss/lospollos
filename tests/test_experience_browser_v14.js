#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const baseUrl = option("--base-url", process.env.STCT_BASE_URL || "http://127.0.0.1:8876/index.html?optPort=8890");
const evidencePath = path.resolve(option("--evidence", process.env.STCT_BROWSER_EVIDENCE || "/tmp/stct-v14-browser-evidence.json"));
const screenshotDir = path.resolve(option("--screenshots", process.env.STCT_BROWSER_SCREENSHOTS || path.join(path.dirname(evidencePath), "screenshots")));
const chromePath = process.env.STCT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const timeout = Number(process.env.STCT_BROWSER_TIMEOUT || 180000);
const onlyFlow = option("--only", "all");

fs.mkdirSync(screenshotDir, { recursive: true });

const evidence = {
  version: "v1.4-trust-closure-mission-control",
  status: "FAIL",
  engine: "OR-Tools",
  engines: {},
  viewports: { desktop: "FAIL", mobilePortrait: "FAIL", mobileLandscape: "FAIL" },
  features: { replay: "FAIL", arena: "FAIL", timeline: "FAIL", director: "FAIL", fallback: "FAIL", reducedMotion: "FAIL", noWebGL: "FAIL" },
  i18n: { zh: "FAIL", en: "FAIL", ja: "FAIL" },
  consoleErrors: 0,
  pageErrors: 0,
  consoleWarnings: [],
  localAssetFailures: [],
  interactions: [],
  screenshots: [],
  flows: {},
};

function mark(message, detail = {}) {
  evidence.interactions.push({ at: new Date().toISOString(), message, ...detail });
  process.stdout.write(`[browser] ${message}\n`);
}

function screenshotPath(name) {
  const file = path.join(screenshotDir, `${name}.png`);
  evidence.screenshots.push(path.relative(path.dirname(evidencePath), file));
  return file;
}

function trackPage(page, label) {
  page.on("console", (message) => {
    const row = { at: new Date().toISOString(), page: label, type: message.type(), text: message.text(), location: message.location() };
    if (message.type() === "error") {
      evidence.consoleErrors += 1;
      evidence.consoleWarnings.push(row);
    } else if (message.type() === "warning") evidence.consoleWarnings.push(row);
  });
  page.on("pageerror", (error) => {
    evidence.pageErrors += 1;
    evidence.consoleWarnings.push({ page: label, type: "pageerror", text: error.message });
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && /^https?:\/\/(127\.0\.0\.1|localhost)/.test(response.url())) {
      evidence.localAssetFailures.push({ page: label, status: response.status(), url: response.url() });
    }
  });
  page.on("requestfailed", (request) => {
    if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(request.url())) {
      evidence.localAssetFailures.push({ page: label, status: "REQUEST_FAILED", url: request.url(), reason: request.failure()?.errorText || "unknown" });
    }
  });
}

function urlWith(...pairs) {
  const url = new URL(baseUrl);
  for (const [key, value] of pairs) url.searchParams.set(key, value);
  return url.toString();
}

async function login(page, url, language = "zh") {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await page.waitForSelector("#loginForm", { state: "visible", timeout });
  assert.strictEqual(await page.title(), "LOGISTEED Smart Transportation Control Tower");
  await page.selectOption("#loginLang", language);
  await page.fill("#loginUser", "demo");
  await page.fill("#loginPass", "demo123");
  await page.click(".login-btn");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("loginScreen")).display === "none", null, { timeout });
  await page.waitForSelector(".app:not(.locked)", { timeout });
  mark(`${language} mock login`, { url: page.url() });
}

async function switchLanguage(page, language, expectedText) {
  await page.evaluate((value) => {
    const select = document.getElementById("loginLang");
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, language);
  await page.waitForFunction((value) => window.STCTCore?.getLanguage?.() === value, language, { timeout });
  if (await page.evaluate(() => Boolean(window.STCTExperience?.state?.opened))) await page.evaluate(() => window.STCTExperienceUI.rerender());
  await page.waitForFunction((value) => document.querySelector(".exp-title h2")?.textContent.includes(value), expectedText, { timeout });
  evidence.i18n[language] = "PASS";
  mark(`Mission Control language ${language}`, { expectedText });
}

async function loadSyntheticAndGenerate(page, { whatIf = true } = {}) {
  await page.click('[data-view="uploadView"]');
  await page.waitForSelector("#loadBundledDemo", { timeout });
  await page.click("#loadBundledDemo");
  await page.waitForSelector("#applyBatchBtn:not([disabled])", { timeout });
  await page.click("#applyBatchBtn");
  await page.waitForFunction(() => window.STCTPlanning?.state?.raw?.orders?.length > 0, null, { timeout });
  await page.click('[data-view="optimizerView"]');
  await page.waitForSelector("#generateScenarioBtn:not([disabled])", { timeout });
  await page.selectOption("#optimizerLimit", "60");
  await page.click("#generateScenarioBtn");
  await page.waitForFunction(() => !window.STCTPlanning.state.generating && window.STCTPlanning.state.candidates.length >= 2, null, { timeout });
  const summary = await page.evaluate(() => ({
    engine: window.STCTPlanning.currentCandidate()?.meta?.engine,
    candidates: window.STCTPlanning.state.candidates.length,
    verified: window.STCTPlanning.state.candidates.every((plan) => plan.verification?.status === "PASS"),
    inputHash: window.STCTPlanning.state.scenario?.inputHash,
    planHash: window.STCTPlanning.currentCandidate()?.planHash,
  }));
  assert(summary.candidates >= 2, "Candidate pool must contain at least two verified plans.");
  assert.strictEqual(summary.verified, true, "Every visible candidate must be verifier PASS.");
  mark("Candidate pool ready", summary);
  await page.waitForSelector("#saveBaselineBtn:not([disabled])", { timeout });
  await page.click("#saveBaselineBtn");
  await page.waitForFunction(() => Boolean(window.STCTPlanning.state.baseline?.plan), null, { timeout });
  if (whatIf) {
    await page.waitForSelector("#runWhatIfBtn:not([disabled])", { timeout });
    await page.click("#runWhatIfBtn");
    await page.waitForFunction(() => !window.STCTPlanning.state.whatIfRunning && window.STCTPlanning.state.whatIfResults.length > 0, null, { timeout });
    await page.waitForTimeout(200);
  }
  await page.waitForSelector("#applyScenarioBtn:not([disabled])", { timeout });
  await page.click("#applyScenarioBtn");
  try {
    await page.waitForFunction(() => window.STCTPlanning.state.phase === "applied" && document.getElementById("mapView").classList.contains("active"), null, { timeout: 10000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      phase: window.STCTPlanning.state.phase,
      staleReason: window.STCTPlanning.state.staleReason,
      scenarioInputHash: window.STCTPlanning.state.scenario?.inputHash,
      planInputHash: window.STCTPlanning.currentCandidate()?.inputHash,
      planHash: window.STCTPlanning.currentCandidate()?.planHash,
      verification: window.STCTPlanning.currentCandidate()?.verification?.status,
      toast: [...document.querySelectorAll(".toast")].map((row) => row.textContent),
      activeView: document.querySelector(".view.active")?.id,
    }));
    throw new Error(`Apply selected failed: ${JSON.stringify(diagnostic)}`);
  }
  await page.waitForFunction(() => !document.querySelector(".toast"), null, { timeout: 8000 });
  mark("Synthetic data generated and verified", summary);
  return summary;
}

async function openExperience(page, mode = "replay") {
  if (!await page.evaluate(() => Boolean(window.STCTExperience?.state?.opened))) await page.click("[data-experience-open]");
  await page.waitForSelector(".exp-app", { timeout });
  await page.evaluate((value) => window.STCTExperienceUI.switchMode(value), mode);
  await page.waitForSelector(`.exp-${mode}`, { timeout });
  const state = await page.evaluate(() => ({ opened: window.STCTExperience.state.opened, mode: window.STCTExperience.state.activeMode, identity: window.STCTExperience.state.identity }));
  assert.strictEqual(state.opened, true);
  assert.strictEqual(state.mode, mode);
  return state;
}

async function waitForRenderedMapLayer(page, layerId, split = false) {
  try {
    await page.waitForFunction(({ id, useSplit }) => {
      const adapter = window.STCTExperienceUI?.mapAdapter;
      const map = useSplit ? adapter?.splitMap : adapter?.map;
      if (!map?.getLayer?.(id) || map?.isMoving?.()) return false;
      try {
        return map.queryRenderedFeatures({ layers: [id] }).length > 0;
      } catch (_error) {
        return false;
      }
    }, { id: layerId, useSplit: split }, { timeout: 12000 });
    await page.evaluate((useSplit) => new Promise((resolve) => {
      const adapter = window.STCTExperienceUI?.mapAdapter;
      const map = useSplit ? adapter?.splitMap : adapter?.map;
      if (!map) return resolve();
      let frames = 0;
      let timer = 0;
      const done = () => {
        window.clearTimeout(timer);
        map.off?.("render", onRender);
        resolve();
      };
      const onRender = () => {
        frames += 1;
        if (frames >= 2) done();
        else map.triggerRepaint?.();
      };
      map.on?.("render", onRender);
      map.resize?.();
      map.triggerRepaint?.();
      timer = window.setTimeout(done, 1200);
    }), split);
    await page.waitForTimeout(60);
  } catch (_error) {
    const diagnostic = await page.evaluate(({ id, useSplit }) => {
      const adapter = window.STCTExperienceUI?.mapAdapter;
      const map = useSplit ? adapter?.splitMap : adapter?.map;
      const layer = map?.getLayer?.(id);
      const sourceId = layer?.source;
      const rect = map?.getContainer?.().getBoundingClientRect();
      return {
        layer: Boolean(layer),
        visibility: layer ? map.getLayoutProperty(id, "visibility") || "visible" : null,
        sourceId,
        sourceFeatures: sourceId ? map.querySourceFeatures(sourceId).length : 0,
        renderedFeatures: layer ? map.queryRenderedFeatures({ layers: [id] }).length : 0,
        center: map?.getCenter?.().toArray?.(),
        zoom: map?.getZoom?.(),
        moving: map?.isMoving?.(),
        styleLoaded: map?.isStyleLoaded?.(),
        rect: rect ? { width: rect.width, height: rect.height } : null,
      };
    }, { id: layerId, useSplit: split });
    throw new Error(`Map layer did not render (${layerId}): ${JSON.stringify(diagnostic)}`);
  }
}

async function replayFlow(page, label) {
  await openExperience(page, "replay");
  await waitForRenderedMapLayer(page, "stct-v14-replay-future");
  const before = await page.evaluate(() => ({ identity: window.STCTExperience.state.identity, minute: window.STCTExperienceUI.state.replay.state.currentMinute }));
  await page.click("[data-replay-toggle]");
  await page.waitForTimeout(650);
  await page.click("[data-replay-toggle]");
  const played = await page.evaluate(() => window.STCTExperienceUI.state.replay.state.currentMinute);
  assert(played > before.minute, "Replay play must advance time.");
  await page.$eval("#expReplayScrub", (element) => {
    element.value = String(Math.min(Number(element.max), Number(element.min) + 15));
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click('[data-delay-minutes="15"]');
  await page.waitForFunction(() => window.STCTExperience.state.simulationEvents.length === 1, null, { timeout });
  const delayed = await page.evaluate(() => ({ identity: window.STCTExperience.state.identity, simulationHash: window.STCTExperience.state.simulationHash, count: window.STCTExperience.state.simulationEvents.length }));
  assert.deepStrictEqual(delayed.identity, before.identity, "Replay and delay simulation cannot mutate planning identity.");
  assert(delayed.simulationHash && delayed.simulationHash !== before.identity.planHash, "Simulation hash must be independent from planHash.");
  await page.click("[data-delay-reset]");
  await page.waitForFunction(() => window.STCTExperience.state.simulationEvents.length === 0, null, { timeout });
  await page.screenshot({ path: screenshotPath(`${label}-replay`), fullPage: false });
  mark(`${label} Replay play/pause/scrub/delay/reset`, { simulationHash: delayed.simulationHash });
}

async function arenaFlow(page, label, { mobile = false } = {}) {
  await openExperience(page, "arena");
  let mobileMapEvidence = null;
  const options = await page.$$eval("#expArenaB option", (nodes) => nodes.map((node) => node.value));
  assert(options.length >= 2, "Arena needs at least two verified plans.");
  const left = await page.inputValue("#expArenaA");
  const right = options.find((value) => value !== left) || options[0];
  await page.selectOption("#expArenaB", right);
  await page.waitForFunction((value) => window.STCTExperienceUI.state.arena.state.rightPlanHash === value, right, { timeout });
  if (mobile) {
    await page.click('[data-arena-side="B"]');
    assert.strictEqual(await page.evaluate(() => window.STCTExperienceUI.state.arena.state.mobileSide), "B");
    await waitForRenderedMapLayer(page, "stct-v14-arena-b");
    const mobileOpacity = await page.evaluate(() => ({
      planA: window.STCTExperienceUI.mapAdapter.map.getPaintProperty("stct-v14-arena-a", "line-opacity"),
      planB: window.STCTExperienceUI.mapAdapter.map.getPaintProperty("stct-v14-arena-b", "line-opacity"),
    }));
    assert.strictEqual(mobileOpacity.planA, 0);
    assert.strictEqual(mobileOpacity.planB, 0.95);
    mobileMapEvidence = await page.evaluate(() => {
      const map = window.STCTExperienceUI.mapAdapter.map;
      const host = document.getElementById("expMapHost");
      const mapNode = document.getElementById("map");
      const canvas = map.getCanvas();
      const fallback = document.getElementById("expArenaFallback");
      const describe = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, display: style.display, visibility: style.visibility, opacity: style.opacity, zIndex: style.zIndex, background: style.backgroundColor };
      };
      return {
        host: describe(host),
        map: describe(mapNode),
        canvas: { ...describe(canvas), width: canvas.width, height: canvas.height },
        fallback: { ...describe(fallback), contentLength: fallback.textContent.length },
        loaded: map.loaded(),
        moving: map.isMoving(),
        sourceFeatures: map.querySourceFeatures("stct-v14-arena-b").length,
        renderedFeatures: map.queryRenderedFeatures({ layers: ["stct-v14-arena-b"] }).length,
        center: map.getCenter().toArray(),
        zoom: map.getZoom(),
      };
    });
  } else {
    await page.click('[data-arena-mode="split"]');
    assert.strictEqual(await page.evaluate(() => window.STCTExperienceUI.state.arena.state.visualMode), "split");
    await page.waitForFunction(() => window.STCTExperienceUI.mapAdapter.splitMap?.isStyleLoaded?.() && Boolean(document.querySelector("#expSplitMap canvas")), null, { timeout });
    await waitForRenderedMapLayer(page, "stct-v14-arena-a");
    await waitForRenderedMapLayer(page, "stct-v14-arena-split-b", true);
    const splitGeometry = await page.evaluate(() => {
      const stage = document.querySelector(".exp-arena-map").getBoundingClientRect();
      const leftMap = document.getElementById("expMapHost").getBoundingClientRect();
      const rightMap = document.getElementById("expSplitMap").getBoundingClientRect();
      return { stage: { width: stage.width, height: stage.height }, left: { width: leftMap.width, height: leftMap.height }, right: { width: rightMap.width, height: rightMap.height } };
    });
    assert(splitGeometry.left.width > 250 && splitGeometry.right.width > 250, `Arena split maps must each occupy a usable half: ${JSON.stringify(splitGeometry)}`);
    assert(splitGeometry.left.height >= splitGeometry.stage.height - 2 && splitGeometry.right.height >= splitGeometry.stage.height - 2, `Arena split maps must fill the stage height: ${JSON.stringify(splitGeometry)}`);
  }
  const comparison = await page.evaluate(() => window.STCTExperienceUI.state.arena.snapshot().comparison);
  assert.strictEqual(comparison.planA.verificationStatus, "PASS");
  assert.strictEqual(comparison.planB.verificationStatus, "PASS");
  await page.screenshot({ path: screenshotPath(`${label}-arena`), fullPage: false });
  mark(`${label} Arena compare`, { sameInputHash: comparison.sameInputHash, changes: comparison.changes.length, mode: mobile ? "mobile-B" : "split", mobileMapEvidence });
}

async function performManualMove(page) {
  await page.click("[data-timeline-edit]");
  const combinations = await page.evaluate(() => {
    const plan = window.STCTExperienceUI.state.activePlan;
    const result = [];
    for (const source of plan.routes || []) {
      for (const orderId of (source.orderIds || []).slice().reverse()) {
        for (const target of plan.routes || []) {
          if (target.routeId !== source.routeId) result.push({ orderId, targetRouteId: target.routeId });
        }
      }
    }
    return result.slice(0, 80);
  });
  const originalHash = await page.evaluate(() => window.STCTExperienceUI.state.activePlan.planHash);
  for (const combination of combinations) {
    await page.selectOption("#expManualOrder", combination.orderId);
    await page.selectOption("#expManualRoute", combination.targetRouteId);
    await page.selectOption("#expManualInsert", "AUTO_MIN_DELTA");
    await page.click("[data-manual-apply]");
    await page.waitForTimeout(80);
    const result = await page.evaluate((hash) => ({
      hash: window.STCTExperienceUI.state.activePlan.planHash,
      manualHash: window.STCTPlanning.state.manual?.plan?.planHash,
      status: document.getElementById("expManualStatus")?.textContent || "",
      verifier: window.STCTPlanning.state.manual?.plan?.verification?.status,
    }), originalHash);
    if (result.hash !== originalHash) {
      assert.strictEqual(result.verifier, "PASS");
      await page.click("[data-manual-undo]");
      await page.waitForFunction((hash) => window.STCTExperienceUI.state.activePlan.planHash === hash, originalHash, { timeout });
      return { ...combination, changedHash: result.hash, restoredHash: originalHash };
    }
  }
  throw new Error("No feasible Timeline manual move was found in the generated candidate.");
}

async function timelineFlow(page, label, { manual = true } = {}) {
  await openExperience(page, "timeline");
  await page.click('[data-timeline-lens="capacity"]');
  await waitForRenderedMapLayer(page, "stct-v14-xray-routes");
  const firstStop = await page.getAttribute("[data-timeline-stop]", "data-timeline-stop");
  assert(firstStop, "Timeline must expose selectable stops.");
  await page.click(`[data-timeline-stop="${firstStop}"]`);
  await page.waitForFunction((value) => window.STCTExperience.state.selectedOrderId === value, firstStop, { timeout });
  let manualResult = null;
  if (manual) manualResult = await performManualMove(page);
  await page.screenshot({ path: screenshotPath(`${label}-timeline`), fullPage: false });
  mark(`${label} Timeline lens/select/manual/undo`, { selectedOrderId: firstStop, manualResult });
}

async function directorFlow(page, label) {
  await openExperience(page, "director");
  const before = await page.evaluate(() => ({ identity: window.STCTExperience.state.identity, simulationCount: window.STCTExperience.state.simulationEvents.length }));
  assert.strictEqual(await page.locator("[data-director-scene]").count(), 7);
  await page.click('[data-director-scene="5"]');
  await page.waitForFunction(() => window.STCTExperienceUI.state.director.state.sceneIndex === 5, null, { timeout });
  await page.click("[data-director-previous]");
  await page.click("[data-director-next]");
  await page.click("[data-director-play]");
  await page.waitForTimeout(180);
  await page.click("[data-director-play]");
  await waitForRenderedMapLayer(page, "stct-v14-replay-future");
  await page.screenshot({ path: screenshotPath(`${label}-director`), fullPage: false });
  await page.click("[data-director-exit]");
  await page.waitForFunction(() => window.STCTExperience.state.activeMode === "timeline", null, { timeout });
  const after = await page.evaluate(() => ({ identity: window.STCTExperience.state.identity, simulationCount: window.STCTExperience.state.simulationEvents.length }));
  assert.deepStrictEqual(after.identity, before.identity, "Director cannot mutate planning identity.");
  assert.strictEqual(after.simulationCount, before.simulationCount, "Director temporary simulation must be restored on exit.");
  mark(`${label} Director seven scenes/navigation/restore`, { identity: after.identity });
}

async function capturePlanningSnapshot(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify({
    raw: window.STCTPlanning.state.raw,
    batchId: window.STCTPlanning.state.batchId,
    scenario: window.STCTPlanning.state.scenario,
    candidates: window.STCTPlanning.state.candidates,
    sourceCandidates: window.STCTPlanning.state.sourceCandidates,
    goalLinks: window.STCTPlanning.state.goalLinks,
    selectedPlanId: window.STCTPlanning.state.selectedPlanId,
    selectedScenarioId: window.STCTPlanning.state.selectedScenarioId,
    baseline: window.STCTPlanning.state.baseline,
    whatIfResults: window.STCTPlanning.state.whatIfResults,
  })));
}

async function restorePlanningSnapshot(page, snapshot) {
  await page.evaluate(async (payload) => {
    window.STCTCore.loadRawData(payload.raw);
    window.STCTPlanning.setRawData(payload.raw, payload.batchId || "E2E-SNAPSHOT");
    Object.assign(window.STCTPlanning.state, payload, { phase: "candidates", manual: null, generating: false, whatIfRunning: false });
    window.STCTCore.setOptimizerPlan(window.STCTPlanning.currentCandidate());
  }, snapshot);
  await page.waitForFunction(() => window.STCTPlanning.state.candidates.length >= 2 && Boolean(window.STCTPlanning.currentCandidate()?.planHash), null, { timeout });
}

async function reducedMotionFlow(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (await page.evaluate(() => Boolean(window.STCTExperience.state.opened))) await page.evaluate(() => window.STCTExperienceUI.close({ restore: false }));
  await openExperience(page, "replay");
  await waitForRenderedMapLayer(page, "stct-v14-replay-future");
  assert.strictEqual(await page.evaluate(() => window.STCTExperience.state.reducedMotion), true);
  const before = await page.evaluate(() => window.STCTExperienceUI.state.replay.state.currentMinute);
  await page.click("[data-replay-toggle]");
  await page.waitForTimeout(420);
  await page.click("[data-replay-toggle]");
  const after = await page.evaluate(() => window.STCTExperienceUI.state.replay.state.currentMinute);
  assert(after >= before, "Reduced-motion Replay state must remain operable.");
  await page.screenshot({ path: screenshotPath("reduced-motion-replay"), fullPage: false });
  evidence.features.reducedMotion = "PASS";
  mark("Reduced motion operational", { before, after });
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

async function noWebglFlow(browser, snapshot) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  const page = await context.newPage();
  trackPage(page, "no-webgl");
  await login(page, urlWith(["noWebGL", "1"]), "en");
  await restorePlanningSnapshot(page, snapshot);
  await openExperience(page, "replay");
  assert.strictEqual(await page.evaluate(() => window.STCTExperience.state.webglAvailable), false);
  await page.waitForSelector(".exp-replay .exp-no-webgl", { timeout });
  await page.click("[data-replay-toggle]");
  await page.waitForTimeout(120);
  await page.click("[data-replay-toggle]");
  await openExperience(page, "arena");
  await page.waitForSelector(".exp-arena .exp-no-webgl", { timeout });
  await openExperience(page, "timeline");
  await page.waitForSelector(".exp-timeline .exp-no-webgl", { timeout });
  await openExperience(page, "director");
  await page.waitForSelector(".exp-director .exp-no-webgl", { timeout });
  const noWebglLayout = await page.evaluate(() => {
    const boundary = document.querySelector(".exp-director-stage .exp-map-boundary").getBoundingClientRect();
    const fallbackTitle = document.querySelector("#expDirectorFallback .exp-fallback-title").getBoundingClientRect();
    const fallback = document.querySelector("#expDirectorFallback .exp-no-webgl").getBoundingClientRect();
    const callout = document.getElementById("expSceneCallout").getBoundingClientRect();
    return { boundaryBottom: boundary.bottom, fallbackTitleTop: fallbackTitle.top, fallbackBottom: fallback.bottom, calloutTop: callout.top };
  });
  assert(noWebglLayout.fallbackTitleTop >= noWebglLayout.boundaryBottom, `No-WebGL fallback must not overlap the presentation boundary: ${JSON.stringify(noWebglLayout)}`);
  assert(noWebglLayout.fallbackBottom <= noWebglLayout.calloutTop, `No-WebGL fallback and scene conclusion must occupy separate regions: ${JSON.stringify(noWebglLayout)}`);
  await page.screenshot({ path: screenshotPath("no-webgl-director"), fullPage: false });
  await page.evaluate(() => window.STCTExperienceUI.close());
  await page.waitForFunction(() => !window.STCTExperience.state.opened && document.querySelector(".view.active")?.id !== "experienceView", null, { timeout });
  const restoredView = await page.evaluate(() => document.querySelector(".view.active")?.id);
  evidence.features.noWebGL = "PASS";
  mark("No-WebGL equivalent paths", { replay: true, arena: true, timeline: true, director: true, businessViewRestored: restoredView });
  await context.close();
}

async function fallbackFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "zh-CN" });
  const page = await context.newPage();
  trackPage(page, "fallback");
  await login(page, urlWith(["forceHeuristic", "1"]), "zh");
  const summary = await loadSyntheticAndGenerate(page, { whatIf: true });
  assert.strictEqual(summary.engine, "Demo Heuristic");
  evidence.engines.fallback = summary.engine;
  await replayFlow(page, "fallback");
  await arenaFlow(page, "fallback");
  await timelineFlow(page, "fallback", { manual: false });
  await directorFlow(page, "fallback");
  await page.setViewportSize({ width: 390, height: 844 });
  await arenaFlow(page, "fallback-mobile", { mobile: true });
  evidence.features.fallback = "PASS";
  evidence.flows.fallback = { status: "PASS", ...summary };
  await context.close();
}

async function releaseFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await context.newPage();
  trackPage(page, "release");
  await login(page, baseUrl, "zh");
  evidence.i18n.zh = "PASS";
  const summary = await loadSyntheticAndGenerate(page, { whatIf: true });
  assert.strictEqual(summary.engine, "OR-Tools");
  evidence.engines.release = summary.engine;
  await replayFlow(page, "desktop");
  evidence.features.replay = "PASS";
  await switchLanguage(page, "en", "Mission Control Replay");
  await switchLanguage(page, "ja", "運行リプレイ");
  await switchLanguage(page, "zh", "运行回放");
  await arenaFlow(page, "desktop");
  evidence.features.arena = "PASS";
  await timelineFlow(page, "desktop", { manual: true });
  evidence.features.timeline = "PASS";
  await directorFlow(page, "desktop");
  evidence.features.director = "PASS";
  evidence.viewports.desktop = "PASS";

  await page.setViewportSize({ width: 390, height: 844 });
  await openExperience(page, "replay");
  await waitForRenderedMapLayer(page, "stct-v14-replay-future");
  await page.click("[data-replay-toggle]");
  await page.waitForTimeout(120);
  await page.click("[data-replay-toggle]");
  await page.screenshot({ path: screenshotPath("mobile-portrait-replay"), fullPage: false });
  await arenaFlow(page, "mobile-portrait", { mobile: true });
  await timelineFlow(page, "mobile-portrait", { manual: true });
  await directorFlow(page, "mobile-portrait");
  evidence.viewports.mobilePortrait = "PASS";

  await page.setViewportSize({ width: 844, height: 390 });
  await openExperience(page, "replay");
  await waitForRenderedMapLayer(page, "stct-v14-replay-future");
  await page.screenshot({ path: screenshotPath("mobile-landscape-replay"), fullPage: false });
  assert((await page.locator(".exp-app").boundingBox()).height <= 390);
  evidence.viewports.mobileLandscape = "PASS";

  await page.setViewportSize({ width: 1440, height: 900 });
  await reducedMotionFlow(page);
  const snapshot = await capturePlanningSnapshot(page);
  evidence.flows.release = { status: "PASS", ...summary };
  await context.close();
  return snapshot;
}

(async () => {
  assert(fs.existsSync(chromePath), `Chrome executable not found: ${chromePath}`);
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
  try {
    if (onlyFlow === "fallback") {
      await fallbackFlow(browser);
      evidence.partialRun = "fallback";
    } else {
      assert.strictEqual(onlyFlow, "all", `Unsupported --only value: ${onlyFlow}`);
      const snapshot = await releaseFlow(browser);
      await noWebglFlow(browser, snapshot);
      await fallbackFlow(browser);
    }
    assert.strictEqual(evidence.consoleErrors, 0, `Console errors: ${JSON.stringify(evidence.consoleWarnings, null, 2)}`);
    assert.strictEqual(evidence.pageErrors, 0, `Page errors: ${JSON.stringify(evidence.consoleWarnings, null, 2)}`);
    assert(evidence.consoleWarnings.every((warning) => warning.type === "warning" && warning.text === "Expected value to be of type number, but found null instead."), `Unexpected console warning: ${JSON.stringify(evidence.consoleWarnings, null, 2)}`);
    assert.deepStrictEqual(evidence.localAssetFailures, [], `Local asset failures: ${JSON.stringify(evidence.localAssetFailures, null, 2)}`);
    if (onlyFlow === "all") {
      assert(Object.values(evidence.viewports).every((status) => status === "PASS"));
      assert(Object.values(evidence.features).every((status) => status === "PASS"));
      assert(Object.values(evidence.i18n).every((status) => status === "PASS"));
    } else assert.strictEqual(evidence.features.fallback, "PASS");
    evidence.status = "PASS";
  } catch (error) {
    evidence.failure = { name: error.name, message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    await browser.close();
    evidence.completedAt = new Date().toISOString();
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ status: evidence.status, evidencePath, screenshots: evidence.screenshots.length, failure: evidence.failure || null }, null, 2)}\n`);
  }
})();
