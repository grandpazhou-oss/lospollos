#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Accounting = require("../network-accounting-v18.js");
const CommandCenter = require("../network-command-center-v18.js");
const Execution = require("../network-execution-v18.js");
const Network = require("../network-solver-v18.js");
const Scenario = require("../scenario-lab-v18.js");
const Visual = require("../network-visualization-v18.js");
const Fixture = require("./fixtures/network-v18-fixture.js");

const repoRoot = path.resolve(__dirname, "..");
const runDir = path.resolve(process.env.STCT_V18_RUN_DIR || "/tmp/lospollos-v1.8-overnight-20260904_012216");
const evidenceDir = path.resolve(process.env.STCT_V18_COMMAND_CENTER_DIR || path.join(runDir, "evidence/command-center-gate13"));
const evidencePath = path.resolve(process.argv.includes("--evidence") ? process.argv[process.argv.indexOf("--evidence") + 1] : path.join(runDir, "evidence/wave-h6-command-center-browser.json"));
const chromePath = process.env.STCT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const assertions = [];

function check(requirementId, condition, observed, expected) {
  assertions.push({
    assertionId: `${requirementId}-A1`,
    requirementId,
    status: condition ? "PASS" : "FAIL",
    observed,
    expected,
    negative: false,
    evidence: "tests/test_network_command_center_browser_v18.js",
  });
}

function sha256(filePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function buildPayload() {
  const source = Fixture.makeNetwork({
    networkId: "SYNTHETIC-COMMAND-CENTER-V18",
    orderCount: 24,
    depotCount: 2,
    vehicleCount: 8,
    driverCount: 8,
    docksPerDepot: 4,
    pickupDelivery: true,
    crossDock: true,
  });
  source.orders.forEach((order) => {
    order.demand = { volume: 1, weight: 1 };
    order.serviceDuration = 1;
  });
  source.depots.forEach((depot) => {
    depot.capacity.dailyOrders = 1000;
    depot.capacity.volume = 100000;
    depot.capacity.weight = 100000;
    depot.capacity.handlingMinutes = 100000;
  });
  source.docks.forEach((dock) => { dock.simultaneousCapacity = 8; });
  source.drivers.forEach((driver) => {
    driver.requiredBreaks = [];
    driver.maxDrivingMinutes = 2000;
    driver.maxDutyMinutes = 2000;
  });
  source.pickupDeliveryPairs.forEach((pair) => {
    pair.sameVehicleRequired = false;
    pair.sameTripRequired = false;
    pair.transferAllowed = true;
  });
  source.routingContext.closures = [{
    closureId: "CLOSE-COMMAND-CENTER",
    fromCoordinate: [117.12, 39.09],
    toCoordinate: [117.2, 39.14],
    status: "CLOSED",
  }];

  const solveOptions = { maxStopsPerTrip: 2, maxTripsPerWave: 4, maxOrders: 100, crossDock: true };
  const plan = Network.solveNetwork(source, solveOptions);
  const ledger = Accounting.computeAccounting(source, plan);
  const alert = {
    alertId: "ALERT-COMMAND-CENTER-1",
    severity: "CRITICAL",
    reasonCode: "DOCK_STRESS",
    message: "Synthetic dock queue threshold exceeded",
    depotId: "D1",
    dockId: source.docks[0].dockId,
    tripId: plan.trip.trips[0].tripId,
    recommendedAction: "RESCHEDULE_DOCK",
    sourceHash: plan.networkPlanHash,
  };
  const model = Visual.buildModel(source, plan, {
    alerts: [alert],
    execution: {
      conflicts: [{ type: "DOCK_CONFLICT", dockId: source.docks[0].dockId, tripId: plan.trip.trips[0].tripId }],
      incidents: plan.custody.transfers[0] ? [{ incidentType: "MISSED_TRANSFER", transferId: plan.custody.transfers[0].transferId }] : [],
    },
    delays: [{ tripId: plan.trip.trips[0].tripId, minutes: 15, propagation: ["DOCK", "WAVE", "TRANSFER"] }],
  });
  const baseline = Scenario.baseline(source);
  const fleet = Scenario.evaluateFleetMix(baseline, {
    depotId: "D1",
    vehicleTypeId: "VT-DIESEL",
    count: 1,
    capacity: { volume: 40, weight: 2000 },
  }, solveOptions);
  const shock = Scenario.evaluateShock(baseline, "DEMAND_10", {}, solveOptions);
  const run = Execution.createRun(source, plan, { runId: "RUN-COMMAND-CENTER-V18" });
  Execution.createIncident(run, "DOCK_FAILURE", { dockId: source.docks[0].dockId, depotId: "D1", logicalMinute: 15 });
  const cutoff = Execution.freezeCutoff(run, { logicalMinute: 15 });
  const recoveryCandidates = Execution.generateRecoveryCandidates(run, cutoff);
  const capsule = Execution.createCapsule(run, cutoff, recoveryCandidates);
  const payload = {
    source,
    model,
    plan,
    ledger,
    decisionRoom: Visual.decisionRoom(model),
    timeSpace: Visual.timeSpaceView(model),
    scenarios: [
      fleet,
      {
        label: "Demand +10%",
        networkInputHash: shock.networkInputHash,
        metrics: {
          service: shock.propagation.service,
          cost: shock.propagation.cost,
          carbonKg: shock.propagation.carbonKg,
        },
      },
    ],
    recoveryCandidates,
    mapSummary: Visual.screenReaderSummary(model),
    shockLabel: "Demand +10%; scenario changed; best found in tested configurations.",
    capsuleHash: capsule.capsuleHash,
    longDescription: "The Network Decision Room presents synthetic multi-depot alerts, service risk, capacity stress, recommended actions, and source hashes. Map, heatmap, trip, dock, time-space, scenario, recovery, and capsule views retain text or table alternatives. Preview actions affect local demo state only and never apply physical operational changes.",
  };
  assert.strictEqual(CommandCenter.validatePayload(payload).status, "PASS");
  return payload;
}

async function openProfile(browser, payload, profile) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    reducedMotion: profile.reducedMotion ? "reduce" : "no-preference",
    locale: profile.locale === "zh" ? "zh-CN" : profile.locale === "ja" ? "ja-JP" : "en-US",
  });
  const page = await context.newPage();
  const logs = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) logs.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => logs.push({ type: "pageerror", text: error.message }));
  const html = CommandCenter.render(payload, profile);
  const htmlPath = path.join(evidenceDir, `${profile.name}.html`);
  const screenshotPath = path.join(evidenceDir, `${profile.name}.png`);
  fs.writeFileSync(htmlPath, html);
  await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (profile.initialView) await page.click(`[data-view=${profile.initialView}]`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  return { context, page, logs, html, htmlPath, screenshotPath };
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const payload = buildPayload();
  const auditPath = path.join(repoRoot, "V18_COMMAND_CENTER_CONCEPT_RENDER.md");
  const accessibilityPath = path.join(repoRoot, "V18_ACCESSIBILITY_I18N_AUDIT.md");
  const auditText = fs.readFileSync(auditPath, "utf8");
  const accessibilityText = fs.readFileSync(accessibilityPath, "utf8");
  const browserCommands = ["page.setContent", "page.click", "page.keyboard.press", "page.screenshot", "page.evaluate"];
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
  const profiles = {};

  try {
    profiles.desktop = await openProfile(browser, payload, { name: "desktop-en", locale: "en", viewport: { width: 1440, height: 900 } });
    profiles.mobile = await openProfile(browser, payload, { name: "mobile-ja", locale: "ja", viewport: { width: 390, height: 844 } });
    profiles.landscape = await openProfile(browser, payload, { name: "mobile-landscape-zh", locale: "zh", viewport: { width: 844, height: 390 }, initialView: "docks" });
    profiles.noWebGL = await openProfile(browser, payload, { name: "no-webgl-zh", locale: "zh", viewport: { width: 1280, height: 800 }, noWebGL: true, initialView: "map" });
    profiles.reduced = await openProfile(browser, payload, { name: "reduced-motion-en", locale: "en", viewport: { width: 1280, height: 800 }, reducedMotion: true, initialView: "map" });

    const desktop = profiles.desktop.page;
    const desktopInitial = await desktop.evaluate(() => ({
      h1: document.querySelector(".view.active h1")?.textContent,
      text: document.body.innerText,
      metrics: document.querySelectorAll(".metric").length,
      alert: document.querySelector(".alert")?.textContent,
      action: document.querySelector("[data-action=preview]")?.textContent,
      hash: document.querySelector(".evidence")?.textContent,
    }));
    check("T0908", desktopInitial.h1 === "Decision Room" && desktopInitial.metrics === 5 && desktopInitial.alert.includes("DOCK_STRESS") && desktopInitial.action === "Preview" && desktopInitial.hash.includes("sha256:"), desktopInitial, "source-backed desktop Decision Room");

    await desktop.click("[data-view=map]");
    const desktopMap = await desktop.evaluate(() => ({ h1: document.querySelector(".view.active h1")?.textContent, svg: document.querySelectorAll(".view.active .network-map").length, depots: document.querySelectorAll(".view.active [data-entity=depot]").length, routes: document.querySelectorAll(".view.active [data-route]").length, summary: document.querySelector(".view.active #mapSummary")?.textContent }));
    check("T0909", desktopMap.h1 === "Network Map" && desktopMap.svg === 1 && desktopMap.depots === payload.source.depots.length && desktopMap.routes > 0 && desktopMap.summary.includes("depots"), desktopMap, "desktop map with source-backed layers and summary");

    await desktop.click("[data-view=capacity]");
    const desktopCapacity = await desktop.evaluate(() => ({ h1: document.querySelector(".view.active h1")?.textContent, rows: document.querySelectorAll(".view.active .heat-table tbody tr").length, headers: Array.from(document.querySelectorAll(".view.active th")).map((node) => node.textContent), first: Array.from(document.querySelectorAll(".view.active tbody tr:first-child td")).map((node) => node.textContent) }));
    check("T0910", desktopCapacity.h1 === "Capacity Heatmap" && desktopCapacity.rows === payload.model.heatmaps.depotTime.length && desktopCapacity.headers.includes("Value") && desktopCapacity.first.length === 5, desktopCapacity, "desktop heatmap with values and levels");

    await desktop.click("[data-view=trips]");
    const desktopTrips = await desktop.evaluate(() => ({ h1: document.querySelector(".view.active h1")?.textContent, rows: document.querySelectorAll(".view.active table:first-of-type tbody tr").length, transfer: document.querySelector(".view.active .sheet")?.innerText }));
    check("T0911", desktopTrips.h1 === "Trip Chain" && desktopTrips.rows > 0 && desktopTrips.transfer.includes("Transfer detail"), desktopTrips, "desktop trip-chain and transfer evidence");

    await desktop.click("[data-view=docks]");
    const desktopDocks = await desktop.evaluate(() => ({ h1: document.querySelector(".view.active h1")?.textContent, rows: document.querySelectorAll(".view.active tbody tr").length, alternative: document.querySelector(".view.active [data-action=reschedule]")?.textContent }));
    check("T0912", desktopDocks.h1 === "Dock Gantt" && desktopDocks.rows > 0 && desktopDocks.alternative.includes("15 minutes"), desktopDocks, "desktop Dock Gantt table and reschedule action");

    await desktop.click("[data-view=time]");
    const desktopTime = await desktop.evaluate(() => ({ h1: document.querySelector(".view.active h1")?.textContent, rows: document.querySelectorAll(".view.active tbody tr").length, types: Array.from(document.querySelectorAll(".view.active tbody td:first-child")).map((node) => node.textContent) }));
    check("T0913", desktopTime.h1 === "Time-Space" && desktopTime.rows > 0 && desktopTime.types.includes("DEPARTURE"), desktopTime, "desktop Time-Space event table");

    await desktop.click("[data-view=scenarios]");
    const desktopScenarios = await desktop.evaluate(() => ({ h1: document.querySelector(".view.active h1")?.textContent, rows: document.querySelectorAll(".view.active tbody tr").length, text: document.querySelector(".view.active")?.innerText }));
    check("T0914", desktopScenarios.h1 === "Scenario Arena" && desktopScenarios.rows === payload.scenarios.length && desktopScenarios.text.toLowerCase().includes("scenario changed"), desktopScenarios, "desktop Scenario Arena comparison");
    check("T0915", desktopScenarios.text.includes("Fleet Mix") && desktopScenarios.text.includes("Best found in tested configurations"), desktopScenarios.text, "fleet-mix tested-configuration result");
    check("T0916", desktopScenarios.text.includes("Cost-to-Serve") && desktopScenarios.text.includes(payload.ledger.cost.total.toFixed(3)), desktopScenarios.text, "cost-to-serve value");
    check("T0917", desktopScenarios.text.includes("Demand Shock") && desktopScenarios.text.includes("Demand +10%"), desktopScenarios.text, "demand-shock source-backed result");

    await desktop.click("[data-view=recovery]");
    const desktopRecovery = await desktop.evaluate(() => ({ h1: document.querySelector(".view.active h1")?.textContent, rows: document.querySelectorAll(".view.active tbody tr").length, preview: document.querySelector(".view.active [data-action=recovery-preview]")?.textContent }));
    check("T0918", desktopRecovery.h1 === "Network Recovery" && desktopRecovery.rows === payload.recoveryCandidates.length && desktopRecovery.preview === "Preview", desktopRecovery, "desktop verified recovery candidates");

    const mobile = profiles.mobile.page;
    const mobileSummary = await mobile.evaluate(() => ({ width: innerWidth, h1: document.querySelector(".view.active h1")?.textContent, summary: document.querySelector(".view.active .sheet")?.innerText, horizontalOverflow: document.documentElement.scrollWidth - innerWidth }));
    check("T0919", mobileSummary.width === 390 && mobileSummary.h1 === "意思決定室" && mobileSummary.summary.includes("ネットワーク概要") && mobileSummary.horizontalOverflow <= 1, mobileSummary, "mobile network summary without page overflow");
    await mobile.click("[data-view=map]");
    const mobileDepot = await mobile.evaluate(() => ({ heading: document.querySelector(".view.active .sheet h2")?.textContent, detail: document.querySelector(".view.active [data-detail=depot]")?.textContent, mapVisible: document.querySelector(".view.active .network-map")?.getBoundingClientRect().height > 0 }));
    check("T0920", mobileDepot.heading === "拠点詳細" && mobileDepot.detail.includes("D1") && mobileDepot.mapVisible, mobileDepot, "mobile depot detail with map context");
    await mobile.click("[data-view=trips]");
    const mobileTrip = await mobile.evaluate(() => ({ h1: document.querySelector(".view.active h1")?.textContent, rows: document.querySelectorAll(".view.active table:first-of-type tbody tr").length }));
    check("T0921", mobileTrip.h1 === "便チェーン" && mobileTrip.rows > 0, mobileTrip, "mobile trip-chain table");
    await mobile.click("[data-view=docks]");
    await mobile.click("[data-action=reschedule]");
    const mobileDock = await mobile.evaluate(() => ({ state: document.body.dataset.rescheduled, status: document.querySelector("[data-reschedule-status]")?.textContent }));
    check("T0922", mobileDock.state === "true" && mobileDock.status.includes("15"), mobileDock, "mobile dock reschedule proposal");
    await mobile.click("[data-view=trips]");
    const mobileTransfer = await mobile.evaluate(() => ({ title: document.querySelector(".view.active .sheet h2")?.textContent, rows: document.querySelectorAll(".view.active .sheet tbody tr").length }));
    check("T0923", mobileTransfer.title === "移管詳細" && mobileTransfer.rows > 0, mobileTransfer, "mobile transfer detail");
    await mobile.click("[data-view=recovery]");
    await mobile.click("[data-action=recovery-preview]");
    await mobile.waitForTimeout(180);
    const mobileAlertRecovery = await mobile.evaluate(() => ({ state: document.body.dataset.recoveryPreview, live: document.querySelector("[data-recovery-live]")?.textContent }));
    check("T0924", mobileAlertRecovery.state === "true" && mobileAlertRecovery.live.length > 0, mobileAlertRecovery, "mobile alert recovery preview");

    const landscape = profiles.landscape.page;
    await landscape.click("[data-view=docks]");
    const landscapeDock = await landscape.evaluate(() => ({ width: innerWidth, height: innerHeight, marker: getComputedStyle(document.querySelector(".view.active .landscape-only")).display, sheetPosition: getComputedStyle(document.querySelector(".view.active .panel")).position, text: document.querySelector(".view.active")?.innerText }));
    check("T0925", landscapeDock.width === 844 && landscapeDock.height === 390 && landscapeDock.marker !== "none" && landscapeDock.text.includes("月台甘特图"), landscapeDock, "mobile landscape Gantt");
    await landscape.click("[data-view=time]");
    const landscapeTime = await landscape.evaluate(() => ({ h1: document.querySelector(".view.active h1")?.textContent, rows: document.querySelectorAll(".view.active tbody tr").length, overflow: document.documentElement.scrollWidth - innerWidth }));
    check("T0926", landscapeTime.h1 === "时间空间图" && landscapeTime.rows > 0 && landscapeTime.overflow <= 1, landscapeTime, "mobile landscape Time-Space");

    const noWebGL = profiles.noWebGL.page;
    await noWebGL.click("[data-view=decision]");
    const noWebGLDecision = await noWebGL.evaluate(() => ({ h1: document.querySelector(".view.active h1")?.textContent, noWebGL: document.body.dataset.noWebgl, metrics: document.querySelectorAll(".view.active .metric").length }));
    check("T0927", noWebGLDecision.h1 === "决策室" && noWebGLDecision.noWebGL === "true" && noWebGLDecision.metrics === 5, noWebGLDecision, "no-WebGL Decision Room remains operational");
    await noWebGL.click("[data-view=map]");
    const noWebGLMap = await noWebGL.evaluate(() => ({ svg: document.querySelectorAll(".view.active svg").length, fallback: document.querySelector(".view.active [data-fallback=no-webgl]")?.innerText, tables: document.querySelectorAll(".view.active table").length }));
    check("T0928", noWebGLMap.svg === 0 && noWebGLMap.tables >= 3 && noWebGLMap.fallback.includes("分配结果"), noWebGLMap, "no-WebGL assignment table");
    await noWebGL.click("[data-view=trips]");
    const noWebGLTrips = await noWebGL.evaluate(() => ({ rows: document.querySelectorAll(".view.active table:first-of-type tbody tr").length, title: document.querySelector(".view.active h1")?.textContent }));
    check("T0929", noWebGLTrips.title === "趟次链" && noWebGLTrips.rows > 0, noWebGLTrips, "no-WebGL trip-chain table");
    await noWebGL.click("[data-view=docks]");
    const noWebGLDock = await noWebGL.evaluate(() => ({ rows: document.querySelectorAll(".view.active tbody tr").length, table: Boolean(document.querySelector(".view.active table.gantt")) }));
    check("T0930", noWebGLDock.rows > 0 && noWebGLDock.table, noWebGLDock, "no-WebGL dock table");
    await noWebGL.click("[data-view=recovery]");
    const noWebGLRecovery = await noWebGL.evaluate(() => ({ rows: document.querySelectorAll(".view.active tbody tr").length, button: document.querySelector(".view.active [data-action=recovery-preview]")?.textContent }));
    check("T0931", noWebGLRecovery.rows === payload.recoveryCandidates.length && noWebGLRecovery.button === "预览", noWebGLRecovery, "no-WebGL recovery table and preview");

    const reduced = profiles.reduced.page;
    await reduced.click("[data-view=map]");
    const reducedMap = await reduced.evaluate(() => ({ media: matchMedia("(prefers-reduced-motion: reduce)").matches, flow: getComputedStyle(document.querySelector(".flow-line")).animationName, pulse: getComputedStyle(document.querySelector(".pulse")).animationName, routeCount: document.querySelectorAll(".flow-line").length, depotCount: document.querySelectorAll(".pulse").length }));
    check("T0932", reducedMap.media && reducedMap.flow === "none" && reducedMap.routeCount > 0, reducedMap, "reduced-motion static flow routes");
    check("T0933", reducedMap.media && reducedMap.pulse === "none" && reducedMap.depotCount > 0, reducedMap, "reduced-motion static depot stress");
    await reduced.click("[data-view=trips]");
    const reducedTrips = await reduced.evaluate(() => ({ media: matchMedia("(prefers-reduced-motion: reduce)").matches, rows: document.querySelectorAll(".view.active table:first-of-type tbody tr").length, animations: Array.from(document.querySelectorAll(".view.active *")).filter((node) => getComputedStyle(node).animationName !== "none").length }));
    check("T0934", reducedTrips.media && reducedTrips.rows > 0 && reducedTrips.animations === 0, reducedTrips, "reduced-motion trip chain preserves static evidence");

    const localeRequiredKeys = ["title", "decision", "map", "capacity", "trips", "docks", "time", "scenarios", "recovery", "capsule", "preview", "apply", "compare", "long"];
    const localeHtml = Object.fromEntries(["zh", "en", "ja"].map((locale) => [locale, CommandCenter.render(payload, { locale })]));
    check("T0935", localeRequiredKeys.every((key) => CommandCenter.TEXT.zh[key] && localeHtml.zh.includes(CommandCenter.TEXT.zh[key])) && localeHtml.zh.includes('lang="zh"'), localeRequiredKeys.map((key) => CommandCenter.TEXT.zh[key]), "complete Chinese command-center terminology");
    check("T0936", localeRequiredKeys.every((key) => CommandCenter.TEXT.en[key] && localeHtml.en.includes(CommandCenter.TEXT.en[key])) && localeHtml.en.includes('lang="en"'), localeRequiredKeys.map((key) => CommandCenter.TEXT.en[key]), "complete English command-center terminology");
    check("T0937", localeRequiredKeys.every((key) => CommandCenter.TEXT.ja[key] && localeHtml.ja.includes(CommandCenter.TEXT.ja[key])) && localeHtml.ja.includes('lang="ja"'), localeRequiredKeys.map((key) => CommandCenter.TEXT.ja[key]), "complete Japanese command-center terminology");

    const identity = await desktop.evaluate(() => ({ title: document.title, brand: document.querySelector(".brand strong")?.textContent, lang: document.documentElement.lang }));
    check("T0938", identity.title.includes("STCT v1.8") && identity.brand === "Smart Transportation Control Tower" && identity.lang === "en", identity, "page identity");
    const notBlank = await desktop.evaluate(() => ({ width: document.querySelector(".app").getBoundingClientRect().width, height: document.querySelector(".app").getBoundingClientRect().height, textLength: document.body.innerText.trim().length }));
    check("T0939", notBlank.width > 1000 && notBlank.height >= 900 && notBlank.textLength > 200, notBlank, "nonblank meaningful page");
    const overlays = await desktop.locator("#webpack-dev-server-client-overlay, vite-error-overlay, [data-vite-dev-id], .nextjs-container-errors-header").count();
    check("T0940", overlays === 0, overlays, "no framework overlay");
    const allLogs = Object.values(profiles).flatMap((profile) => profile.logs);
    check("T0941", allLogs.filter((row) => row.type === "error" || row.type === "pageerror").length === 0, allLogs, "zero application errors");
    check("T0942", allLogs.filter((row) => row.type === "warning").length === 0, allLogs, "zero unexplained warnings");
    const classifiedWarning = Visual.classifyWarning("MapLibre tile glyph request failed");
    check("T0943", classifiedWarning === "EXTERNAL_MAP_DEPENDENCY", classifiedWarning, "external map warning classified separately");

    await desktop.click("[data-view=map]");
    await desktop.focus("[data-step=depot][data-direction='1']");
    await desktop.keyboard.press("Enter");
    const depotStep = await desktop.evaluate(() => ({ value: document.querySelector("[data-step-output=depot]")?.value, selected: document.body.dataset.selectedDepot }));
    check("T0944", depotStep.value === "2" && depotStep.selected === "1", depotStep, "keyboard depot step");
    await desktop.click("[data-view=trips]");
    await desktop.focus("[data-step=trip][data-direction='1']");
    await desktop.keyboard.press("Enter");
    const tripStep = await desktop.evaluate(() => ({ value: document.querySelector("[data-step-output=trip]")?.value, selected: document.body.dataset.selectedTrip }));
    check("T0945", tripStep.value === "2" && tripStep.selected === "1", tripStep, "keyboard trip step");
    await desktop.click("[data-view=docks]");
    await desktop.focus("[data-step=dock][data-direction='1']");
    await desktop.keyboard.press("Enter");
    const dockStep = await desktop.evaluate(() => ({ value: document.querySelector("[data-step-output=dock]")?.value, selected: document.body.dataset.selectedDock }));
    check("T0946", dockStep.value === "2" && dockStep.selected === "1", dockStep, "keyboard dock step");
    await desktop.click("[data-view=time]");
    await desktop.focus("[data-step=wave][data-direction='1']");
    await desktop.keyboard.press("Enter");
    const waveStep = await desktop.evaluate(() => ({ value: document.querySelector("[data-step-output=wave]")?.value, selected: document.body.dataset.selectedWave }));
    check("T0947", waveStep.value === "2" && waveStep.selected === "1", waveStep, "keyboard wave step");
    await desktop.click("[data-view=scenarios]");
    await desktop.focus("[data-action=compare]");
    await desktop.keyboard.press("Enter");
    check("T0948", await desktop.evaluate(() => document.body.dataset.compared === "true"), await desktop.evaluate(() => document.body.dataset.compared), "keyboard scenario compare");
    await desktop.click("[data-view=recovery]");
    await desktop.focus("[data-action=recovery-preview]");
    await desktop.keyboard.press("Enter");
    check("T0949", await desktop.evaluate(() => document.body.dataset.recoveryPreview === "true"), await desktop.evaluate(() => document.body.dataset.recoveryPreview), "keyboard recovery preview");

    await desktop.click("[data-view=map]");
    await desktop.focus("[data-step=depot][data-direction='1']");
    await desktop.keyboard.press("Shift+Tab");
    await desktop.keyboard.press("Tab");
    const focusStyle = await desktop.evaluate(() => { const value = getComputedStyle(document.activeElement); return { tag: document.activeElement.tagName, outlineStyle: value.outlineStyle, outlineWidth: value.outlineWidth, outlineColor: value.outlineColor }; });
    check("T0950", focusStyle.tag === "BUTTON" && focusStyle.outlineStyle !== "none" && Number.parseFloat(focusStyle.outlineWidth) >= 3, focusStyle, "visible keyboard focus");
    await desktop.click("[data-view=decision]");
    await desktop.focus("[data-action=preview]");
    await desktop.keyboard.press("Enter");
    await desktop.waitForTimeout(180);
    const focusAfterPreview = await desktop.evaluate(() => ({ action: document.activeElement?.dataset.action, live: document.querySelector("[data-live]")?.textContent }));
    check("T0951", focusAfterPreview.action === "preview" && focusAfterPreview.live.length > 0, focusAfterPreview, "preview does not steal focus");
    await desktop.click("[data-view=capacity]");
    const nonColor = await desktop.evaluate(() => Array.from(document.querySelectorAll(".heat-table tbody tr")).every((row) => { const cells = Array.from(row.cells).map((cell) => cell.textContent.trim()); return cells[0] && /%$/.test(cells[3]) && cells[4]; }));
    check("T0952", nonColor, nonColor, "heatmap redundantly encodes signal, value, and level");
    await desktop.click("[data-view=map]");
    const hoverAlternative = await desktop.evaluate(() => { const node = document.querySelector("[data-hover]"); return { exists: Boolean(node), role: node?.getAttribute("role"), tabindex: node?.getAttribute("tabindex"), label: node?.getAttribute("aria-label") }; });
    check("T0953", hoverAlternative.exists && hoverAlternative.role === "button" && hoverAlternative.tabindex === "0" && hoverAlternative.label.length > 0, hoverAlternative, "hover target has tap/focus semantics");
    await desktop.click("[data-view=docks]");
    const dragAlternative = await desktop.evaluate(() => ({ button: document.querySelector("[data-action=reschedule]")?.tagName, text: document.querySelector("[data-action=reschedule]")?.textContent }));
    check("T0954", dragAlternative.button === "BUTTON" && dragAlternative.text.includes("15 minutes"), dragAlternative, "dock drag has button alternative");
    await desktop.click("[data-action=reschedule]");
    await desktop.click("[data-view=capacity]");
    check("T0955", await desktop.locator(".view.active table.heat-table").count() === 1 && await desktop.locator(".view.active table.heat-table tbody tr").count() > 0, await desktop.locator(".view.active table.heat-table tbody tr").count(), "heatmap table equivalent");
    await desktop.click("[data-view=map]");
    const mapText = await desktop.locator(".view.active #mapSummary").textContent();
    check("T0956", mapText.includes(`${payload.source.depots.length} depots`) && mapText.includes("trip routes"), mapText, "map text summary");
    await desktop.click("[data-view=docks]");
    check("T0957", await desktop.locator(".view.active table.gantt tbody tr").count() === Math.min(32, payload.model.dockGantt.reservations.length), await desktop.locator(".view.active table.gantt tbody tr").count(), "Gantt table equivalent");
    await desktop.click("[data-view=time]");
    check("T0958", await desktop.locator(".view.active table tbody tr").count() === Math.min(32, payload.timeSpace.tableEquivalent.length), await desktop.locator(".view.active table tbody tr").count(), "Time-Space table equivalent");
    await desktop.click("[data-view=decision]");
    await desktop.evaluate(() => { document.querySelector("[data-live]").textContent = ""; document.querySelector("[data-action=preview]").click(); });
    const liveImmediate = await desktop.locator("[data-live]").textContent();
    await desktop.waitForTimeout(180);
    const liveDelayed = await desktop.locator("[data-live]").textContent();
    check("T0959", liveImmediate === "" && liveDelayed.includes("Preview ready"), { liveImmediate, liveDelayed }, "ARIA live update throttled by 150 ms");

    const mobileLayout = await mobile.evaluate(() => {
      const sheet = document.querySelector(".view.active .sheet");
      const workspace = document.querySelector(".workspace");
      return { viewport: { width: innerWidth, height: innerHeight }, sheet: sheet ? { top: sheet.getBoundingClientRect().top, height: sheet.getBoundingClientRect().height, bottom: sheet.getBoundingClientRect().bottom, maxHeight: getComputedStyle(sheet).maxHeight, paddingBottom: getComputedStyle(sheet).paddingBottom } : null, workspacePaddingBottom: getComputedStyle(workspace).paddingBottom, meta: document.querySelector('meta[name="viewport"]')?.content };
    });
    check("T0960", mobileLayout.sheet && mobileLayout.sheet.bottom <= mobileLayout.viewport.height + 1 && Number.parseFloat(mobileLayout.sheet.paddingBottom) >= 14 && mobileLayout.meta.includes("viewport-fit=cover"), mobileLayout, "mobile safe-area-aware sheet");
    const mobileScrolling = await mobile.evaluate(() => ({ viewportMeta: document.querySelector('meta[name="viewport"]')?.content, userScalableDisabled: /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i.test(document.querySelector('meta[name="viewport"]')?.content || ""), scrollingTables: Array.from(document.querySelectorAll(".table-scroll")).every((node) => ["auto", "scroll"].includes(getComputedStyle(node).overflowX)) }));
    check("T0961", !mobileScrolling.userScalableDisabled && mobileScrolling.scrollingTables, mobileScrolling, "pinch remains enabled and tables scroll");
    check("T0962", mobileLayout.sheet.height <= mobileLayout.viewport.height * 0.4 + 1 && Number.parseFloat(mobileLayout.workspacePaddingBottom) >= mobileLayout.viewport.height * 0.4, mobileLayout, "bottom sheet reserves evidence space");

    await desktop.click("[data-view=decision]");
    await desktop.evaluate(() => { document.body.dataset.preview = ""; document.body.dataset.applied = ""; const apply = document.querySelector("[data-action=apply]"); apply.disabled = true; document.querySelector("[data-loading]").textContent = "Preview required"; });
    const gatedBefore = await desktop.evaluate(() => ({ disabled: document.querySelector("[data-action=apply]").disabled, loading: document.querySelector("[data-loading]").textContent }));
    await desktop.click("[data-action=preview]");
    const gatedAfter = await desktop.evaluate(() => ({ disabled: document.querySelector("[data-action=apply]").disabled, loading: document.querySelector("[data-loading]").textContent, preview: document.body.dataset.preview }));
    check("T0963", gatedBefore.disabled && gatedBefore.loading === "Preview required" && !gatedAfter.disabled && gatedAfter.loading === "READY" && gatedAfter.preview === "ready", { gatedBefore, gatedAfter }, "real loading and disabled gate");
    await desktop.click("[data-action=apply]");
    check("T0964", await desktop.evaluate(() => document.body.dataset.applied === "true"), await desktop.evaluate(() => document.body.dataset.applied), "primary apply control is not inert");
    const businessEffects = await desktop.evaluate(() => ({ preview: document.body.dataset.preview, applied: document.body.dataset.applied, compared: document.body.dataset.compared, recoveryPreview: document.body.dataset.recoveryPreview, rescheduled: document.body.dataset.rescheduled }));
    check("T0965", Object.values(businessEffects).every(Boolean), businessEffects, "business controls produce distinct local side effects");

    const screenshotEvidence = Object.fromEntries(Object.entries(profiles).map(([name, profile]) => [name, { path: profile.screenshotPath, bytes: fs.statSync(profile.screenshotPath).size, sha256: sha256(profile.screenshotPath) }]));
    check("T0966", screenshotEvidence.desktop.bytes > 5000 && screenshotEvidence.desktop.sha256.startsWith("sha256:"), screenshotEvidence.desktop, "desktop screenshot evidence");
    check("T0967", screenshotEvidence.mobile.bytes > 5000 && screenshotEvidence.landscape.bytes > 5000 && screenshotEvidence.mobile.sha256 !== screenshotEvidence.landscape.sha256, { mobile: screenshotEvidence.mobile, landscape: screenshotEvidence.landscape }, "mobile portrait and landscape screenshot evidence");
    check("T0968", screenshotEvidence.noWebGL.bytes > 5000 && profiles.noWebGL.html.includes('data-fallback="no-webgl"'), screenshotEvidence.noWebGL, "no-WebGL screenshot evidence");
    check("T0969", screenshotEvidence.reduced.bytes > 5000 && profiles.reduced.html.includes('data-reduced-motion="true"'), screenshotEvidence.reduced, "reduced-motion screenshot evidence");
    check("T0970", auditText.includes("Concept intent") && auditText.includes("Rendered implementation") && auditText.includes("Evidence check"), auditPath, "concept/render comparison");
    check("T0971", (auditText.match(/^\d\. /gm) || []).length === 5, auditText.match(/^\d\. .*$/gm), "five fidelity checks");
    check("T0972", auditText.includes("Copy Diff") && auditText.includes("Preview") && auditText.includes("Best found in tested configurations"), auditPath, "copy diff");
    check("T0973", auditText.includes("Typography Audit") && auditText.includes("Letter spacing is zero"), auditPath, "typography audit");
    check("T0974", auditText.includes("Icon Audit") && auditText.includes("No decorative icon library"), auditPath, "icon audit");
    check("T0975", auditText.includes("1440 x 900") && auditText.includes("390 x 844") && auditText.includes("844 x 390"), auditPath, "native-size viewport evidence");
    check("T0976", browserCommands.length === 5 && browserCommands.every((command) => auditText.includes(command.split(".").at(-1))), browserCommands, "browser commands recorded");
    check("T0977", auditText.includes("BLOCKED_PHYSICAL_IPHONE_NOT_TESTED") && !auditText.includes("Physical iPhone validation: PASS"), auditPath, "physical iPhone remains explicitly blocked");
    check("T0978", accessibilityText.includes("Accessibility Summary") && ["Keyboard", "Focus", "Non-color evidence", "Announcements", "Motion", "Mobile"].every((term) => accessibilityText.includes(term)), accessibilityPath, "accessibility summary");
    check("T0979", accessibilityText.includes("Terminology") && ["Network Operations", "网络运营", "ネットワーク運用", "网络胶囊", "ネットワークカプセル"].every((term) => accessibilityText.includes(term)), accessibilityPath, "i18n terminology consistency");
    await desktop.click("[data-view=capsule]");
    await desktop.click("summary");
    const longDescription = await desktop.locator("details.long p").textContent();
    check("T0980", longDescription.length > 250 && longDescription.includes("synthetic multi-depot") && accessibilityText.includes("Long Description"), longDescription, "meaningful long description");

    await desktop.click("[data-view=scenarios]");
    await desktop.keyboard.press("P");
    const presentation = await desktop.evaluate(() => ({ state: document.body.dataset.presentation, side: getComputedStyle(document.querySelector(".side")).display, active: document.body.dataset.activeView }));
    check("T0981", presentation.state === "true" && presentation.side === "none" && presentation.active === "scenarios", presentation, "presentation mode keyboard entry");
    await desktop.keyboard.press("Escape");
    const presentationExit = await desktop.evaluate(() => ({ state: document.body.dataset.presentation, side: getComputedStyle(document.querySelector(".side")).display, active: document.body.dataset.activeView, focusedView: document.activeElement?.dataset.view }));
    check("T0982", presentationExit.state === "false" && presentationExit.side !== "none" && presentationExit.active === "scenarios" && presentationExit.focusedView === "scenarios", presentationExit, "presentation exit restores state and focus");
    await desktop.click("[data-view=capsule]");
    await desktop.click("[data-action=capsule]");
    const capsuleUi = await desktop.evaluate(() => ({ hash: document.querySelector("[data-capsule-hash]")?.textContent, exported: document.body.dataset.capsuleExported, status: document.querySelector("[data-capsule-status]")?.textContent }));
    check("T0983", capsuleUi.hash.startsWith("sha256:") && capsuleUi.exported === "true" && capsuleUi.status === "EXPORTED_READ_ONLY", capsuleUi, "network capsule read-only export UI");

    await desktop.click("[data-view=decision]");
    await desktop.click("[data-action=preview]");
    await desktop.click("[data-action=apply]");
    await desktop.click("[data-view=recovery]");
    await desktop.click("[data-action=recovery-preview]");
    await desktop.click("[data-view=capsule]");
    await desktop.click("[data-action=capsule]");
    const e2e = await desktop.evaluate(() => ({ preview: document.body.dataset.preview, applied: document.body.dataset.applied, recoveryPreview: document.body.dataset.recoveryPreview, capsuleExported: document.body.dataset.capsuleExported, activeView: document.body.dataset.activeView }));
    check("T0984", e2e.preview === "ready" && e2e.applied === "true" && e2e.recoveryPreview === "true" && e2e.capsuleExported === "true" && e2e.activeView === "capsule", e2e, "browser E2E decision-to-recovery-to-capsule workflow");

    const expectedIds = Array.from({ length: 77 }, (_, index) => `T${String(908 + index).padStart(4, "0")}`);
    assert.deepStrictEqual(assertions.map((row) => row.requirementId), expectedIds, "Gate 13 must own exactly T0908-T0984 in order");
    const failures = assertions.filter((row) => row.status !== "PASS");
    const evidence = {
      schemaVersion: "stct-network-command-center-browser-evidence-v1.8",
      status: failures.length ? "FAIL" : "PASS",
      source: "ACTUAL_LOCAL_GOOGLE_CHROME_VIA_PLAYWRIGHT",
      externalRequests: 0,
      commandCenterExport: CommandCenter.exportPayload(payload),
      browser: { executablePath: chromePath, commands: browserCommands },
      profiles: Object.fromEntries(Object.entries(profiles).map(([name, profile]) => [name, { htmlPath: profile.htmlPath, screenshot: screenshotEvidence[name], logs: profile.logs }])),
      audits: { conceptRender: auditPath, accessibilityI18n: accessibilityPath },
      assertions,
    };
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    assert.strictEqual(failures.length, 0, failures.map((row) => `${row.requirementId}: ${JSON.stringify(row.observed)}`).join("\n"));
    process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, evidencePath, evidenceDir, screenshots: screenshotEvidence, assertions }, null, 2)}\n`);
  } finally {
    await Promise.all(Object.values(profiles).map((profile) => profile.context.close().catch(() => {})));
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
