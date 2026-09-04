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

const baseUrl = option("--base-url", "http://127.0.0.1:8877/index.html?v=v15-wave-b-browser");
const evidencePath = path.resolve(option("--evidence", "/tmp/lospollos-v15-wave-b-browser.json"));
const screenshotDir = path.resolve(option("--screenshots", path.join(path.dirname(evidencePath), "wave-b-screenshots")));
const chromePath = process.env.STCT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const checks = [];
const evidence = { version: "v1.5-wave-b", status: "FAIL", checks, console: [], screenshots: [] };

function check(id, condition, detail = {}) {
  assert(condition, `${id}: ${JSON.stringify(detail)}`);
  checks.push({ id, status: "PASS", detail });
}

function candidate(base, suffix, metrics, labels) {
  const result = clone(base);
  result.planId = `PLAN-${suffix}`;
  result.planHash = `sha256:plan-${suffix}`;
  result.requestHash = `sha256:request-${suffix}`;
  result.verification.computedPlanHash = result.planHash;
  result.metrics = { ...result.metrics, ...metrics };
  result.verification.recomputedMetrics = { ...result.verification.recomputedMetrics, ...metrics };
  result.labels = labels;
  result.meta = { ...result.meta, goal: labels[0], goalLabel: labels.join(" / ") };
  return result;
}

async function main() {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.mkdirSync(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-US" });
  const page = await context.newPage();
  page.on("console", (message) => evidence.console.push({ type: message.type(), text: message.text(), location: message.location() }));
  page.on("pageerror", (error) => evidence.console.push({ type: "pageerror", text: error.message }));

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.selectOption("#loginLang", "en");
    await page.fill("#loginUser", "demo");
    await page.fill("#loginPass", "demo123");
    await page.click(".login-btn");
    await page.waitForFunction(() => getComputedStyle(document.getElementById("loginScreen")).display === "none", null, { timeout: 30000 });

    const base = buildFixture({ orderCount: 24, routeCount: 4, planSuffix: "WB-A", inputSuffix: "WB-SAME" });
    const planA = candidate(base.plan, "WB-A", { totalCost: 1180, estimatedRoadKm: 192, totalCO2: 38, usedVehicles: 4, utilizationScore: 61, latestEndMinutes: 1020 }, ["balanced"]);
    const planB = candidate(base.plan, "WB-B", { totalCost: 1060, estimatedRoadKm: 210, totalCO2: 35, usedVehicles: 4, utilizationScore: 67, latestEndMinutes: 1000 }, ["cost"]);
    const planC = candidate(base.plan, "WB-C", { totalCost: 1120, estimatedRoadKm: 175, totalCO2: 31, usedVehicles: 5, utilizationScore: 58, latestEndMinutes: 980 }, ["distance", "carbon"]);
    const other = buildFixture({ orderCount: 12, routeCount: 3, planSuffix: "WB-X", inputSuffix: "WB-OTHER" });
    const planX = candidate(other.plan, "WB-X", { totalCost: 620, estimatedRoadKm: 88, totalCO2: 18 }, ["what-if"]);
    await page.evaluate(({ scenario, planAValue, planBValue, planCValue, scenarioX, planXValue }) => {
      const state = window.STCTPlanning.state;
      state.phase = "applied";
      state.scenario = scenario;
      state.candidates = [planAValue, planBValue, planCValue];
      state.selectedPlanId = planAValue.planId;
      state.selectedScenarioId = planAValue.planId;
      state.baseline = { plan: planAValue, scenario, selectedPlanId: planAValue.planId };
      state.whatIfResults = [{
        id: "WB-OTHER",
        label: "Different input",
        scenarioId: scenarioX.scenarioId,
        selectedPlan: planXValue,
        scenario: scenarioX,
        metrics: planXValue.metrics,
        delta: { assigned: 0 },
        template: null,
        serviceFirst: { solverStatus: "PASS" },
        balancedSeed: { solverStatus: "PASS" },
        baselinePlanHash: planAValue.planHash,
        verification: planXValue.verification,
      }];
      state.manual = null;
    }, { scenario: base.scenario, planAValue: planA, planBValue: planB, planCValue: planC, scenarioX: other.scenario, planXValue: planX });

    await page.evaluate(() => window.STCTExperienceUI.open("arena"));
    await page.waitForSelector("#expV15Arena [data-v15-frontier='observed']");
    const initial = await page.evaluate(() => {
      const chart = document.querySelector(".exp-v15-chart-host");
      const list = document.querySelector(".exp-v15-candidate-list");
      return {
        label: document.querySelector("#expV15Arena .exp-v15-section-head .exp-section-label")?.textContent,
        chartHashes: chart?.dataset.candidateHashes,
        listHashes: list?.dataset.candidateHashes,
        groupOptions: document.querySelectorAll(".exp-v15-controls label:first-child option").length,
        observed: document.querySelector("[data-v15-frontier]")?.dataset.v15Frontier,
      };
    });
    check("T120-browser", initial.label === "Observed Candidate Frontier" && initial.observed === "observed", initial);
    check("T112-browser", initial.groupOptions === 2, initial);
    check("T125-browser", initial.chartHashes === initial.listHashes && initial.chartHashes.split(",").length === 3, initial);

    const axisBefore = initial.chartHashes;
    await page.selectOption(".exp-v15-controls label:nth-child(2) select", "totalCO2");
    await page.selectOption(".exp-v15-controls label:nth-child(3) select", "utilizationScore");
    const axisAfter = await page.evaluate(() => ({
      chart: document.querySelector(".exp-v15-chart-host")?.dataset.candidateHashes,
      list: document.querySelector(".exp-v15-candidate-list")?.dataset.candidateHashes,
    }));
    check("T121-browser", axisAfter.chart === axisBefore && axisAfter.list === axisBefore, axisAfter);

    await page.locator(`.exp-v15-candidate[data-plan-hash="${planB.planHash}"]`).click();
    await page.waitForFunction((planHash) => document.getElementById("expArenaB")?.value === planHash, planB.planHash);
    const pointerSync = await page.evaluate(() => ({
      selector: document.getElementById("expArenaB")?.value,
      sync: { ...window.STCTV15.ui.state.arena.sync },
      datasets: { ...document.querySelector(".exp-v15-sync")?.dataset },
      whyPlanHash: document.querySelector(".exp-v15-sync")?.dataset.whyPlanHash,
    }));
    check("T122-browser", Object.values(pointerSync.sync).every((hash) => hash === planB.planHash)
      && pointerSync.selector === planB.planHash
      && pointerSync.whyPlanHash === planB.planHash, pointerSync);

    const selectedPoint = page.locator(`.exp-v15-point[data-plan-hash="${planB.planHash}"]`);
    await selectedPoint.focus();
    await selectedPoint.press("ArrowRight");
    const keyboardSync = await page.evaluate(() => ({
      selected: window.STCTV15.ui.state.arena.selectedPlanHash,
      selector: document.getElementById("expArenaB")?.value,
      sync: { ...window.STCTV15.ui.state.arena.sync },
    }));
    check("T123-browser", keyboardSync.selected !== planB.planHash
      && keyboardSync.selector === keyboardSync.selected
      && Object.values(keyboardSync.sync).every((hash) => hash === keyboardSync.selected), keyboardSync);

    const noWebgl = await page.evaluate(({ entries, baseline }) => {
      const host = document.createElement("div");
      host.id = "waveBNoWebglHost";
      document.body.appendChild(host);
      const cleanup = window.STCTV15.ui.mountArena({ host, entries, baseline, selectedPlanHash: entries[0].plan.planHash, webglAvailable: false });
      const result = {
        note: host.querySelector(".exp-v15-no-webgl")?.textContent,
        chart: host.querySelector(".exp-v15-chart-host")?.dataset.candidateHashes,
        list: host.querySelector(".exp-v15-candidate-list")?.dataset.candidateHashes,
        buttons: host.querySelectorAll(".exp-v15-candidate").length,
      };
      cleanup?.();
      host.remove();
      return result;
    }, { entries: [{ plan: planA, scenario: base.scenario, label: "A" }, { plan: planB, scenario: base.scenario, label: "B" }, { plan: planC, scenario: base.scenario, label: "C" }], baseline: { plan: planA, scenario: base.scenario } });
    check("T124-browser", Boolean(noWebgl.note) && noWebgl.chart === noWebgl.list && noWebgl.buttons === 3, noWebgl);

    await page.evaluate(() => window.STCTExperienceUI.switchMode("replay"));
    await page.waitForSelector(".exp-v15-event-lane");
    await page.evaluate(() => {
      window.STCTExperience.appendDomainEvent("SIMULATION_EVENT_ADDED", {
        aggregateType: "SIMULATION",
        aggregateId: "SIM-WB",
        source: "wave-b-browser-test",
        logicalTime: 510,
        payload: { vehicleId: "VEH-2", routeId: "R-2", orderId: "ORDER-002", status: "TEST_EVENT", unsafe: "<img src=x onerror=alert(1)>" },
      });
    });
    await page.waitForFunction(() => Number(document.querySelector(".exp-v15-event-list")?.dataset.eventCount) >= 2);
    const eventSource = await page.evaluate(() => ({
      shared: document.querySelector(".exp-v15-event-lane")?.dataset.sharedSource,
      identity: window.STCTExperienceUI.state.replay.eventStore === window.STCTExperience.eventStore,
      images: document.querySelectorAll(".exp-v15-event-lane img").length,
      text: document.querySelector(".exp-v15-event-list")?.textContent,
    }));
    check("T078-browser", eventSource.images === 0 && eventSource.text.includes("SIMULATION_EVENT_ADDED"), eventSource);
    check("T084-browser", eventSource.shared === "true" && eventSource.identity, eventSource);

    await page.selectOption(".exp-v15-event-filters select:nth-child(1)", "SIMULATION_EVENT_ADDED");
    await page.selectOption(".exp-v15-event-filters select:nth-child(2)", "VEH-2");
    await page.selectOption(".exp-v15-event-filters select:nth-child(3)", "R-2");
    await page.selectOption(".exp-v15-event-filters select:nth-child(4)", "ORDER-002");
    const filtered = await page.evaluate(() => ({
      count: Number(document.querySelector(".exp-v15-event-list")?.dataset.eventCount),
      text: document.querySelector(".exp-v15-event-list")?.textContent,
    }));
    check("T077-browser", filtered.count === 1 && filtered.text.includes("ORDER-002"), filtered);
    await page.locator(".exp-v15-domain-event").click();
    const eventSelection = await page.evaluate(() => ({
      vehicleId: window.STCTExperience.state.selectedVehicleId,
      orderId: window.STCTExperience.state.selectedOrderId,
      replayVehicleId: window.STCTExperienceUI.state.replay.state.selectedVehicleId,
    }));
    check("B-event-jump", eventSelection.vehicleId === "VEH-2" && eventSelection.orderId === "ORDER-002" && eventSelection.replayVehicleId === "VEH-2", eventSelection);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".exp-v15-event-toggle").click();
    const collapsed = await page.evaluate(() => ({
      collapsed: document.querySelector(".exp-v15-event-lane")?.classList.contains("collapsed"),
      expanded: document.querySelector(".exp-v15-event-toggle")?.getAttribute("aria-expanded"),
      rect: document.querySelector(".exp-v15-event-lane")?.getBoundingClientRect().toJSON(),
    }));
    check("B-event-mobile-collapse", collapsed.collapsed && collapsed.expanded === "false" && collapsed.rect.right <= 390, collapsed);

    await page.evaluate(() => window.STCTExperienceUI.switchMode("arena"));
    await page.waitForSelector("#expV15Arena [data-v15-frontier='observed']");
    const mobile = await page.evaluate(() => ({
      chart: document.querySelector(".exp-v15-chart-host")?.dataset.candidateHashes,
      list: document.querySelector(".exp-v15-candidate-list")?.dataset.candidateHashes,
      rect: document.querySelector(".exp-v15-lab")?.getBoundingClientRect().toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
    }));
    check("T125-mobile-browser", mobile.chart === mobile.list && mobile.rect.left >= 0 && mobile.rect.right <= mobile.viewport.width, mobile);

    await page.locator("#expV15Arena").scrollIntoViewIfNeeded();
    const desktopShot = path.join(screenshotDir, "wave-b-arena-mobile.png");
    await page.screenshot({ path: desktopShot });
    evidence.screenshots.push(desktopShot);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const arenaShot = path.join(screenshotDir, "wave-b-arena-desktop.png");
    await page.screenshot({ path: arenaShot, fullPage: true });
    evidence.screenshots.push(arenaShot);

    const errors = evidence.console.filter((entry) => entry.type === "pageerror" || entry.type === "error");
    check("B-console", errors.length === 0, { errors });
    evidence.status = "PASS";
    evidence.completedAt = new Date().toISOString();
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify({ status: evidence.status, evidencePath, checks: checks.length, screenshots: evidence.screenshots.length }, null, 2));
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
