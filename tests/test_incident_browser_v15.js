#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const baseUrl = option("--base-url", "http://127.0.0.1:8877/index.html?v=v15-incident-browser");
const evidencePath = path.resolve(option("--evidence", "/tmp/lospollos-v15-incident-browser.json"));
const screenshotDir = path.resolve(option("--screenshots", path.join(path.dirname(evidencePath), "incident-browser-shots")));
const chromePath = process.env.STCT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const checks = [];
const evidence = { version: "v1.5-wave-c", status: "FAIL", checks, console: [], screenshots: [] };

function check(id, condition, detail = {}) {
  assert(condition, `${id}: ${JSON.stringify(detail)}`);
  checks.push({ id, status: "PASS", detail });
}

async function loginAndSeed(page, fixture) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.fill("#loginUser", "demo");
  await page.fill("#loginPass", "demo123");
  await page.click(".login-btn");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("loginScreen")).display === "none", null, { timeout: 30000 });
  await page.evaluate(({ scenario, plan }) => {
    const state = window.STCTPlanning.state;
    state.phase = "applied";
    state.scenario = scenario;
    state.candidates = [plan];
    state.selectedPlanId = plan.planId;
    state.selectedScenarioId = plan.planId;
    state.baseline = { plan, scenario, selectedPlanId: plan.planId };
    state.whatIfResults = [];
    state.manual = null;
  }, fixture);
  await page.evaluate(() => window.STCTExperienceUI.open("replay"));
  await page.waitForSelector("#expIncidentOpen");
}

async function configureBreakdown(page) {
  await page.selectOption('[data-incident-field="type"]', "VEHICLE_BREAKDOWN");
  await page.selectOption('[data-incident-field="targetId"]', "VEH-1");
  await page.fill('[data-incident-field="logicalMinute"]', "535");
}

async function injectAndGenerate(page) {
  await configureBreakdown(page);
  await page.click('[data-incident-action="inject"]');
  await page.waitForFunction(() => window.STCTV15.incidentUI.state?.phase === "INJECTED");
  await page.click('[data-incident-action="generate"]');
  await page.waitForFunction(() => window.STCTV15.incidentUI.state?.phase === "COMPARED", null, { timeout: 30000 });
  await page.locator('[data-apply-allowed="true"]').first().click();
}

async function main() {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.mkdirSync(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  const page = await context.newPage();
  page.on("console", (message) => evidence.console.push({ type: message.type(), text: message.text(), location: message.location() }));
  page.on("pageerror", (error) => evidence.console.push({ type: "pageerror", text: error.message }));

  try {
    const fixture = buildFixture({ orderCount: 24, routeCount: 4, planSuffix: "INC-UI", inputSuffix: "INC-UI" });
    fixture.scenario.meta = { synthetic: true };
    await loginAndSeed(page, { scenario: clone(fixture.scenario), plan: clone(fixture.plan) });

    for (let index = 0; index < 10; index += 1) {
      await page.click("#expIncidentOpen");
      await page.waitForSelector("#expIncidentStudio", { state: "visible" });
      await page.click('[data-incident-action="close"]');
      await page.waitForSelector("#expIncidentStudio", { state: "hidden" });
    }
    const listenerState = await page.evaluate(() => ({ ...window.STCTV15.incidentUI.state }));
    check("T260", listenerState.openCount === 10 && listenerState.closeCount === 10 && listenerState.listenerCount === 5, listenerState);

    await page.click("#expIncidentOpen");
    await page.waitForSelector("#expIncidentStudio", { state: "visible" });
    const initialSimulation = await page.evaluate(() => window.STCTExperience.simulationStore.exportState());
    await configureBreakdown(page);
    await page.click('[data-incident-action="inject"]');
    await page.waitForFunction(() => window.STCTV15.incidentUI.state?.phase === "INJECTED");
    await page.waitForSelector(".exp-incident-blast");
    const injected = await page.evaluate(() => ({
      state: { ...window.STCTV15.incidentUI.state },
      incidentEvents: window.STCTExperience.eventStore.snapshot().filter((event) => event.type === "INCIDENT_INJECTED").length,
      blastMetrics: document.querySelectorAll(".exp-incident-metric").length,
      mapLayers: window.STCTExperienceUI.mapAdapter.map?.getStyle?.().layers?.filter((layer) => layer.id.startsWith("stct-v14-incident-")).map((layer) => layer.id) || [],
      pulseFrames: window.STCTExperienceUI.mapAdapter.incidentPulseFrames,
    }));
    check("C-incident-injected-browser", Boolean(injected.state.incidentHash) && injected.incidentEvents === 1 && injected.blastMetrics === 6, injected);

    const mobileBlastShot = path.join(screenshotDir, "incident-mobile-blast.png");
    await page.screenshot({ path: mobileBlastShot });
    evidence.screenshots.push(mobileBlastShot);

    await page.click('[data-incident-action="generate"]');
    await page.waitForFunction(() => window.STCTV15.incidentUI.state?.phase === "COMPARED", null, { timeout: 30000 });
    const compared = await page.evaluate(() => ({
      cards: document.querySelectorAll(".exp-incident-candidate").length,
      passCards: document.querySelectorAll('[data-apply-allowed="true"]').length,
      references: document.querySelectorAll(".exp-incident-reference").length,
      generatedEvents: window.STCTExperience.eventStore.snapshot().filter((event) => event.type === "RECOVERY_CANDIDATE_GENERATED").length,
      verifiedEvents: window.STCTExperience.eventStore.snapshot().filter((event) => event.type === "RECOVERY_CANDIDATE_VERIFIED").length,
    }));
    check("C-recovery-board-browser", compared.cards === 5 && compared.passCards > 0 && compared.references === 1 && compared.generatedEvents === 5 && compared.verifiedEvents === 5, compared);

    await page.locator('[data-apply-allowed="true"]').first().click();
    const selectedHash = await page.evaluate(() => window.STCTV15.incidentUI.state.selectedPlanHash);
    await page.click('[data-incident-action="apply"]');
    await page.waitForFunction(() => window.STCTV15.incidentUI.state?.phase === "APPLIED");
    const applied = await page.evaluate(() => ({
      activePlanHash: window.STCTExperience.simulationStore.state.activePlanHash,
      state: { ...window.STCTV15.incidentUI.state },
      applyEvents: window.STCTExperience.eventStore.snapshot().filter((event) => event.type === "RECOVERY_PLAN_APPLIED").length,
      closeDisabledByWorkflow: document.querySelector(".exp-app")?.classList.contains("exp-incident-active"),
    }));
    check("C-apply-browser", applied.activePlanHash === selectedHash && applied.state.applied && applied.applyEvents === 1 && applied.closeDisabledByWorkflow, applied);

    const mobileCompareShot = path.join(screenshotDir, "incident-mobile-applied.png");
    await page.screenshot({ path: mobileCompareShot });
    evidence.screenshots.push(mobileCompareShot);

    await page.click('[data-incident-action="undo"]');
    await page.waitForFunction(() => window.STCTV15.incidentUI.state?.phase === "UNDONE");
    const undone = await page.evaluate(() => ({
      simulation: window.STCTExperience.simulationStore.exportState(),
      state: { ...window.STCTV15.incidentUI.state },
      undoEvents: window.STCTExperience.eventStore.snapshot().filter((event) => event.type === "RECOVERY_UNDO").length,
      sheet: document.querySelector(".exp-incident-sheet")?.getBoundingClientRect().toJSON(),
      map: document.querySelector(".exp-map-stage")?.getBoundingClientRect().toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth - innerWidth,
    }));
    check("T189", undone.simulation.activePlanHash === fixture.plan.planHash
      && undone.simulation.simulationHash === initialSimulation.simulationHash
      && undone.simulation.activeEvents.length === initialSimulation.activeEvents.length
      && !undone.state.applied && undone.undoEvents === 1, undone);
    check("T242-wave-c", undone.sheet.left >= 0 && undone.sheet.right <= undone.viewport.width + 1 && undone.sheet.bottom <= undone.viewport.height + 1 && undone.sheet.top - undone.map.top >= 110 && undone.overflow <= 1, undone);

    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(100);
    const landscape = await page.evaluate(() => ({
      sheet: document.querySelector(".exp-incident-sheet")?.getBoundingClientRect().toJSON(),
      map: document.querySelector(".exp-map-stage")?.getBoundingClientRect().toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth - innerWidth,
    }));
    check("T243-wave-c", landscape.sheet.left > landscape.map.left + 120 && landscape.sheet.right <= landscape.viewport.width + 1 && landscape.sheet.bottom <= landscape.viewport.height + 1 && landscape.overflow <= 1, landscape);
    const landscapeShot = path.join(screenshotDir, "incident-mobile-landscape.png");
    await page.screenshot({ path: landscapeShot });
    evidence.screenshots.push(landscapeShot);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(100);
    const desktop = await page.evaluate(() => ({
      sheet: document.querySelector(".exp-incident-sheet")?.getBoundingClientRect().toJSON(),
      map: document.querySelector(".exp-map-stage")?.getBoundingClientRect().toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
    }));
    check("C-desktop-layout", desktop.sheet.left > desktop.map.left + 300 && desktop.sheet.right <= desktop.viewport.width + 1 && desktop.sheet.width < desktop.viewport.width * .55, desktop);
    const desktopShot = path.join(screenshotDir, "incident-desktop.png");
    await page.screenshot({ path: desktopShot });
    evidence.screenshots.push(desktopShot);

    await page.click('[data-incident-action="restore"]');
    await page.click('[data-incident-action="close"]');
    await page.waitForSelector("#expIncidentStudio", { state: "hidden" });

    await page.evaluate(() => window.STCTExperienceUI.close({ restore: false }));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.STCTExperienceUI.open("replay"));
    await page.waitForSelector("#expIncidentOpen");
    await page.click("#expIncidentOpen");
    await configureBreakdown(page);
    await page.click('[data-incident-action="inject"]');
    await page.waitForFunction(() => window.STCTV15.incidentUI.state?.phase === "INJECTED");
    await page.waitForTimeout(300);
    const reduced = await page.evaluate(() => ({
      reducedClass: document.querySelector("#expIncidentStudio")?.classList.contains("reduced-motion"),
      pulseFrames: window.STCTExperienceUI.mapAdapter.incidentPulseFrames,
      animationFrame: window.STCTExperienceUI.mapAdapter.incidentAnimationFrame,
    }));
    check("T269", reduced.reducedClass && reduced.pulseFrames === 0 && reduced.animationFrame === 0, reduced);

    const errors = evidence.console.filter((entry) => entry.type === "pageerror" || entry.type === "error");
    check("C-console", errors.length === 0, { errors });
    evidence.status = "PASS";
    evidence.completedAt = new Date().toISOString();
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify({ status: evidence.status, evidencePath, checks: checks.length, screenshots: evidence.screenshots }, null, 2));
  } catch (error) {
    evidence.failure = { name: error.name, message: error.message, stack: error.stack };
    evidence.completedAt = new Date().toISOString();
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
