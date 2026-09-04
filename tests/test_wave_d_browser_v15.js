#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

function option(name, fallback) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
const baseUrl = option("--base-url", "http://127.0.0.1:8877/index.html?v=v15-wave-d-browser");
const evidencePath = path.resolve(option("--evidence", "/tmp/lospollos-v15-wave-d-browser.json"));
const screenshotDir = path.resolve(option("--screenshots", path.join(path.dirname(evidencePath), "wave-d-browser-shots")));
const chromePath = process.env.STCT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const checks = []; const consoleEntries = [];
function check(id, condition, detail = {}) { assert(condition, `${id}: ${JSON.stringify(detail)}`); checks.push({ id, status: "PASS", detail }); }

async function loginAndSeed(page, fixture, url = baseUrl, language = "zh") {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.selectOption("#loginLang", language);
  await page.fill("#loginUser", "demo"); await page.fill("#loginPass", "demo123"); await page.click(".login-btn");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("loginScreen")).display === "none", null, { timeout: 30000 });
  await page.evaluate(({ scenario, plan }) => {
    const state = window.STCTPlanning.state;
    state.phase = "applied"; state.scenario = scenario; state.candidates = [plan]; state.selectedPlanId = plan.planId; state.selectedScenarioId = plan.planId;
    state.baseline = { plan, scenario, selectedPlanId: plan.planId }; state.whatIfResults = []; state.manual = null;
  }, fixture);
  await page.evaluate(() => window.STCTExperienceUI.open("replay"));
  await page.waitForSelector(".exp-v15-trust-lab");
  await page.waitForFunction(() => window.STCTV15.trustLab.state?.matrixStatus === "PASS", null, { timeout: 30000 });
}

async function main() {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true }); fs.mkdirSync(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const fixture = buildFixture({ orderCount: 40, routeCount: 6, planSuffix: "WAVE-D-UI", inputSuffix: "WAVE-D-UI" });
  fixture.scenario.meta = { synthetic: true, dataClassification: "SYNTHETIC_DEMO" };
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await context.newPage();
  page.on("console", (message) => consoleEntries.push({ type: message.type(), text: message.text(), location: message.location() }));
  page.on("pageerror", (error) => consoleEntries.push({ type: "pageerror", text: error.message }));
  try {
    await loginAndSeed(page, { scenario: clone(fixture.scenario), plan: clone(fixture.plan) });
    await page.waitForFunction(() => window.STCTExperienceUI.mapAdapter.layerRegistry?.snapshot?.("SERVICE_ZONE")?.mounted === true, null, { timeout: 30000 });
    const initial = await page.evaluate(() => ({
      modules: ["matrixProviders", "capsules", "mapLayers", "serviceZones", "trustLab"].every((key) => Boolean(window.STCTV15[key])),
      registered: window.STCTExperienceUI.mapAdapter.layerRegistry?.list?.() || [],
      trust: { ...window.STCTV15.trustLab.state, matrixPromise: undefined },
      hidden: document.querySelector(".exp-v15-trust-body")?.hidden,
      matrixText: document.querySelector(".exp-v15-matrix-lab")?.textContent || "",
      zoneText: document.querySelector(".exp-v15-zone-lab")?.textContent || "",
      serviceZone: window.STCTExperienceUI.mapAdapter.layerRegistry?.snapshot?.("SERVICE_ZONE"),
      map: document.querySelector(".exp-map-stage")?.getBoundingClientRect().toJSON(),
    }));
    check("D-browser-modules", initial.modules && ["REPLAY", "ARENA", "TIMELINE_SELECTION", "INCIDENT", "BLAST_RADIUS", "RECOVERY_MORPH", "SERVICE_ZONE", "EXPLANATION"].every((id) => initial.registered.includes(id)), initial);
    check("D-matrix-lab", initial.trust.matrixStatus === "PASS" && initial.matrixText.includes("HAVERSINE_FALLBACK") && initial.matrixText.includes("Road Matrix unavailable") && initial.matrixText.includes("Haversine estimate active"), initial);
    check("D-trust-default-collapsed", initial.hidden === true && initial.trust.expanded === false, initial);
    check("D-service-zone-overlay", initial.serviceZone?.mounted === true && initial.serviceZone.sources.length === 1 && initial.serviceZone.layers.length === 2 && initial.zoneText.includes("Not solver-enforced"), initial.serviceZone);

    await page.click(".exp-v15-trust-toggle");
    await page.waitForFunction(() => window.STCTV15.trustLab.state?.expanded === true);
    const expanded = await page.evaluate(() => ({
      panelCount: document.querySelectorAll(".exp-v15-trust-detail").length,
      preCount: document.querySelectorAll(".exp-v15-trust-detail > pre").length,
      hasHtmlDescendant: Boolean(document.querySelector(".exp-v15-json script, .exp-v15-json img, .exp-v15-json iframe")),
      body: document.querySelector(".exp-v15-trust-body")?.getBoundingClientRect().toJSON(),
      map: document.querySelector(".exp-map-stage")?.getBoundingClientRect().toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth - innerWidth,
    }));
    check("D-trust-panels-text", expanded.panelCount === 15 && expanded.preCount === 15 && !expanded.hasHtmlDescendant, expanded);
    check("T241-wave-d", expanded.body.left >= 0 && expanded.body.right <= expanded.viewport.width + 1 && expanded.overflow <= 1 && expanded.map.height > 300 && Math.abs(expanded.map.height - initial.map.height) <= 1, { initialMap: initial.map, ...expanded });

    await page.click(".exp-v15-capsule-actions button:first-child");
    await page.waitForFunction(() => Boolean(window.STCTV15.trustLab.state?.capsuleHash), null, { timeout: 30000 });
    const sealed = await page.evaluate(() => ({
      capsuleHash: window.STCTV15.trustLab.state.capsuleHash,
      sealText: [...document.querySelectorAll(".exp-v15-trust-detail")].find((row) => row.querySelector("summary")?.textContent === "Capsule Seal")?.querySelector("pre")?.textContent || "",
      exportEnabled: !document.querySelector(".exp-v15-capsule-actions button:last-child")?.disabled,
    }));
    check("T240-browser", Boolean(sealed.capsuleHash) && sealed.exportEnabled && ["schema", "inputHash", "planHash", "simulationHash", "incidentHash", "capsuleHash", "verifier", "engine", "matrix", "dataClassification"].every((key) => sealed.sealText.includes(`\"${key}\"`)), sealed);

    const desktopShot = path.join(screenshotDir, "trust-lab-desktop.png"); await page.screenshot({ path: desktopShot, fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(160);
    const portrait = await page.evaluate(() => { const lab = document.querySelector(".exp-v15-trust-lab").getBoundingClientRect(); const toggle = document.querySelector(".exp-v15-trust-toggle").getBoundingClientRect(); return { lab: lab.toJSON(), toggle: toggle.toJSON(), viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth - innerWidth }; });
    check("T242-wave-d", portrait.lab.left >= 0 && portrait.lab.right <= portrait.viewport.width + 1 && portrait.toggle.right <= portrait.viewport.width + 1 && portrait.overflow <= 1, portrait);
    const portraitShot = path.join(screenshotDir, "trust-lab-portrait.png"); await page.screenshot({ path: portraitShot, fullPage: false });

    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(160);
    const landscape = await page.evaluate(() => { const lab = document.querySelector(".exp-v15-trust-lab").getBoundingClientRect(); const body = document.querySelector(".exp-v15-trust-body").getBoundingClientRect(); return { lab: lab.toJSON(), body: body.toJSON(), viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth - innerWidth, bodyOverflow: getComputedStyle(document.querySelector(".exp-v15-trust-body")).overflowY }; });
    check("T243-wave-d", landscape.lab.left >= 0 && landscape.lab.right <= landscape.viewport.width + 1 && landscape.overflow <= 1 && ["auto", "scroll"].includes(landscape.bodyOverflow), landscape);
    const landscapeShot = path.join(screenshotDir, "trust-lab-landscape.png"); await page.screenshot({ path: landscapeShot, fullPage: false });

    await page.evaluate(() => window.STCTExperienceUI.close({ restore: false }));
    const cleanup = await page.evaluate(() => ({ registry: window.STCTExperienceUI.mapAdapter.layerRegistry?.registrySnapshot?.(), mapLayers: window.STCTExperienceUI.mapAdapter.map?.getStyle?.().layers?.filter((layer) => layer.id.startsWith("stct-v15-")).length || 0, mapSources: Object.keys(window.STCTExperienceUI.mapAdapter.map?.getStyle?.().sources || {}).filter((id) => id.startsWith("stct-v15-")).length }));
    check("T261-browser", cleanup.registry.mountedCount === 0 && cleanup.mapLayers === 0 && cleanup.mapSources === 0, cleanup);

    const noWebglContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
    const noWebglPage = await noWebglContext.newPage();
    noWebglPage.on("pageerror", (error) => consoleEntries.push({ type: "pageerror", text: error.message, context: "no-webgl" }));
    await loginAndSeed(noWebglPage, { scenario: clone(fixture.scenario), plan: clone(fixture.plan) }, `${baseUrl}&noWebGL=1`, "en");
    const noWebgl = await noWebglPage.evaluate(() => ({ webgl: window.STCTExperience.state.webglAvailable, matrix: window.STCTV15.trustLab.state.matrixStatus, zoneText: document.querySelector(".exp-v15-zone-lab")?.textContent || "", zoneDisabled: document.querySelector(".exp-v15-zone-toggle input")?.disabled, overlay: window.STCTExperienceUI.mapAdapter.layerRegistry?.snapshot?.("SERVICE_ZONE")?.mounted || false }));
    check("T244-wave-d", noWebgl.webgl === false && noWebgl.matrix === "PASS" && noWebgl.zoneDisabled && !noWebgl.overlay && noWebgl.zoneText.includes("No-WebGL"), noWebgl);
    await noWebglContext.close();

    const appErrors = consoleEntries.filter((entry) => entry.type === "pageerror" || entry.type === "error");
    check("D-console", appErrors.length === 0, { appErrors });
    const evidence = { version: "v1.5-wave-d", status: "PASS", completedAt: new Date().toISOString(), checks, console: consoleEntries, screenshots: [desktopShot, portraitShot, landscapeShot] };
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ status: "PASS", evidencePath, checks: checks.length, screenshots: evidence.screenshots }, null, 2)}\n`);
  } catch (error) {
    fs.writeFileSync(evidencePath, `${JSON.stringify({ version: "v1.5-wave-d", status: "FAIL", completedAt: new Date().toISOString(), checks, console: consoleEntries, error: { name: error.name, message: error.message, stack: error.stack } }, null, 2)}\n`);
    throw error;
  } finally { await context.close(); await browser.close(); }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
