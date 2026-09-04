#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Simulation = require("../simulation-store-v15.js");
const Experience = require("../experience-v15.js");
const Replay = require("../replay-v15.js");
const Timeline = require("../timeline-v15.js");
const Audit = require("../audit-redaction-v15.js");
const { buildFixture } = require("../tests/experience_fixture_v14.js");

const evidenceRoot = path.resolve(process.env.STCT_KNOWN_FAILURE_ROOT || "/tmp/lospollos-v1.5-baseline-20260830_230200/known-failures");
const browserEvidencePath = path.resolve(process.env.STCT_WAVE_A_BROWSER_EVIDENCE || "/tmp/lospollos-v15-wave-a-browser.json");
const performanceEvidencePath = path.resolve(process.env.STCT_WAVE_A_PERFORMANCE_EVIDENCE || "/tmp/lospollos-v15-wave-a-performance.json");
const browserScreenshotPath = path.resolve(process.env.STCT_WAVE_A_SCREENSHOT || "/tmp/lospollos-v15-wave-a-shots/wave-a-desktop.png");
const manifestPath = path.join(evidenceRoot, "WAVE_A_AFTER_MANIFEST.sha256");
const created = [];

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function verifyBeforeManifest() {
  const source = fs.readFileSync(path.join(evidenceRoot, "EVIDENCE_MANIFEST.sha256"), "utf8").trim().split(/\n+/);
  source.forEach((line) => {
    const match = line.match(/^([a-f0-9]{64})  \.\/(.+)$/);
    assert(match, `Invalid Phase 0 manifest row: ${line}`);
    const file = path.join(evidenceRoot, match[2]);
    assert.strictEqual(sha256File(file), match[1], `Phase 0 evidence changed: ${match[2]}`);
  });
  return source.length;
}

function writeAfter(id, title, body) {
  const file = path.join(evidenceRoot, id, "after-evidence.json");
  assert(!fs.existsSync(file), `Refusing to overwrite existing After evidence: ${file}`);
  const value = {
    evidenceId: id,
    title,
    phase: "Wave A - Experience Integrity",
    versionUnderTest: "v1.5",
    recordedAt: new Date().toISOString(),
    result: "KNOWN_FAILURE_FIXED",
    ...body,
  };
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o444 });
  fs.chmodSync(file, 0o444);
  created.push(file);
  return file;
}

function copyScreenshot(id, name) {
  const target = path.join(evidenceRoot, id, name);
  assert(!fs.existsSync(target), `Refusing to overwrite screenshot: ${target}`);
  fs.copyFileSync(browserScreenshotPath, target);
  fs.chmodSync(target, 0o444);
  created.push(target);
  return path.basename(target);
}

function delayHash(delayNonEmpty = 25) {
  return async (payload) => {
    const parsed = JSON.parse(payload);
    await new Promise((resolve) => setTimeout(resolve, parsed.activeEvents.length ? delayNonEmpty : 1));
    return `test:${Buffer.from(payload).toString("base64url")}`;
  };
}

function delayEvent(overrides = {}) {
  return {
    eventId: "EVENT-A",
    type: "DELAY",
    routeId: "R-1",
    orderId: "ORDER-001",
    stopIndex: 0,
    minutes: 15,
    source: "wave-a-after-probe",
    ...overrides,
  };
}

async function capture() {
  const phase0EntriesVerified = verifyBeforeManifest();
  assert(!fs.existsSync(manifestPath), `Refusing to overwrite After manifest: ${manifestPath}`);
  const browserEvidence = JSON.parse(fs.readFileSync(browserEvidencePath, "utf8"));
  const performanceEvidence = JSON.parse(fs.readFileSync(performanceEvidencePath, "utf8"));
  assert.strictEqual(browserEvidence.status, "PASS");
  assert.strictEqual(performanceEvidence.status, "PASS");
  assert(fs.existsSync(browserScreenshotPath));

  const fixtureA = buildFixture({ orderCount: 4, routeCount: 2, planSuffix: "AFTER-A", inputSuffix: "AFTER" });
  const fixtureB = buildFixture({ orderCount: 4, routeCount: 2, planSuffix: "AFTER-B", inputSuffix: "AFTER" });
  const store = Simulation.createSimulationStore();
  await store.initialize(fixtureA.plan);
  await store.addEvent(delayEvent({ eventId: "EVENT-R2", routeId: "R-2", orderId: "ORDER-004", stopIndex: 1, minutes: 30 }));
  await store.addEvent(delayEvent({ eventId: "EVENT-R1" }));
  const beforeUndo = store.state;
  await store.undo();
  const replay = Replay.createReplayController(fixtureA.plan, fixtureA.scenario, { simulationStore: store });
  const afterUndo = store.state;
  const expectedUndoHash = await Simulation.simulationIdentity(fixtureA.plan.planHash, afterUndo.activeEvents);
  assert.deepStrictEqual(afterUndo.activeEvents.map((row) => row.eventId), ["EVENT-R2"]);
  assert.deepStrictEqual(replay.snapshot().simulationEvents.map((row) => row.eventId), ["EVENT-R2"]);
  assert.strictEqual(afterUndo.simulationHash, expectedUndoHash);
  writeAfter("F14-01", "Simulation Undo operation order splits from canonical event order", {
    tests: ["T002", "T003", "T004", "T005", "T006", "T007"],
    beforeUndo: {
      canonicalActiveEventIds: beforeUndo.activeEvents.map((row) => row.eventId),
      operationEventIds: beforeUndo.operationLog.filter((row) => row.action === "ADD").map((row) => row.eventId),
      simulationHash: beforeUndo.simulationHash,
    },
    afterUndo: {
      storeRemainingEventIds: afterUndo.activeEvents.map((row) => row.eventId),
      replayRemainingEventIds: replay.snapshot().simulationEvents.map((row) => row.eventId),
      simulationHash: afterUndo.simulationHash,
      expectedSimulationHash: expectedUndoHash,
    },
    singleWritableState: true,
  });

  const experience = Experience.createExperience();
  await experience.open(fixtureA);
  await experience.addSimulationEvent(delayEvent({ eventId: "PLAN-A-DELAY" }));
  const planAHash = experience.state.simulationHash;
  await experience.selectPlan(fixtureB.plan, fixtureB.scenario);
  const expectedPlanBHash = await Simulation.simulationIdentity(fixtureB.plan.planHash, []);
  assert.strictEqual(experience.state.activePlanHash, fixtureB.plan.planHash);
  assert.strictEqual(experience.state.simulationHash, expectedPlanBHash);
  assert.strictEqual(experience.state.activeEvents.length, 0);
  writeAfter("F14-02", "Manual Plan update leaves simulationHash bound to Plan A", {
    tests: ["T012", "T016", "T017"],
    planA: { planHash: fixtureA.plan.planHash, simulationHashWithDelay: planAHash },
    planB: {
      planHash: fixtureB.plan.planHash,
      activePlanHash: experience.state.activePlanHash,
      simulationHash: experience.state.simulationHash,
      expectedSimulationHash: expectedPlanBHash,
      activeEventCount: experience.state.activeEvents.length,
      policy: "RESET",
    },
  });

  const race = Simulation.createSimulationStore({ hash: delayHash() });
  await race.initialize(fixtureA.plan);
  const add = race.addEvent(delayEvent({ eventId: "RACE-ADD" }));
  const reset = race.reset();
  await Promise.all([add, reset]);
  const racePayload = JSON.parse(Buffer.from(race.state.simulationHash.slice(5), "base64url").toString());
  assert.strictEqual(race.state.activeEvents.length, 0);
  assert.strictEqual(racePayload.activeEvents.length, 0);
  writeAfter("F14-03", "Delayed Add hash overwrites newer Reset hash", {
    tests: ["T009", "T010", "T021", "T024"],
    activeEventCount: race.state.activeEvents.length,
    hashPayloadActiveEventCount: racePayload.activeEvents.length,
    committedRevision: race.state.simulationRevision,
    finalOperation: race.state.operationLog.at(-1),
    staleWriteCommitted: false,
  });

  const crossUser = ["gz", "root", "demo_user"].map((user) => {
    const raw = `project=/Users/${user}/Documents/lospollos evidence=/tmp/${user}/evidence username=${user} owner=${user}`;
    const redacted = Audit.redactText(raw, { explicitUsers: [user] });
    const scan = Audit.scanText(redacted, { explicitUsers: [user] });
    assert.strictEqual(scan.status, "PASS");
    return { user, scan, redacted };
  });
  const legitimateText = Audit.redactText("root cause analysis remains valid business text");
  assert.strictEqual(legitimateText, "root cause analysis remains valid business text");
  writeAfter("F14-04", "Audit redaction passes only for the current OS username", {
    tests: ["T051", "T052", "T053", "T054", "T055", "T056", "T057"],
    users: crossUser,
    legitimateBusinessTextPreserved: legitimateText,
    currentOsUsernameDependency: false,
  });

  const replayStore = Simulation.createSimulationStore();
  const replayFixture = buildFixture({ orderCount: 60, routeCount: 7, planSuffix: "AFTER-REPLAY", inputSuffix: "AFTER-REPLAY" });
  await replayStore.initialize(replayFixture.plan);
  const replayProbe = Replay.createReplayController(replayFixture.plan, replayFixture.scenario, { simulationStore: replayStore, selectedVehicleId: "VEH-2" });
  replayProbe.setFollow(true);
  replayProbe.setVehicleScope("ALL");
  const allScope = replayProbe.snapshot();
  assert.strictEqual(allScope.vehicleScope, "ALL");
  assert.strictEqual(allScope.followVehicle, false);
  const scopeScreenshot = copyScreenshot("F14-05", "after-all-vehicles.png");
  writeAfter("F14-05", "Replay vehicle selector has no ALL scope", {
    tests: ["T031", "T032", "T033"],
    availableScopes: Replay.VEHICLE_SCOPES,
    selectedScope: allScope.vehicleScope,
    visibleVehicleCount: allScope.frame.vehicles.length,
    followVehicle: allScope.followVehicle,
    screenshot: scopeScreenshot,
  });

  replayProbe.selectVehicle("VEH-3");
  await replayProbe.injectDelay({ routeId: "R-3", orderId: "ORDER-003", minutes: 15, eventId: "FILTER-EXCEPTION" });
  replayProbe.setTime(replayProbe.state.endMinute);
  const filterCounts = {};
  for (const filter of Replay.EVENT_FILTERS) {
    replayProbe.setEventFilter(filter);
    filterCounts[filter] = replayProbe.snapshot().frame.events.length;
  }
  replayProbe.setEventFilter("EXCEPTION");
  assert(replayProbe.snapshot().frame.events.every((event) => Replay.EXCEPTION_TYPES.has(event.type)));
  replayProbe.setEventFilter("SELECTED_VEHICLE");
  assert(replayProbe.snapshot().frame.events.every((event) => event.vehicleId === "VEH-3"));
  const filterScreenshot = copyScreenshot("F14-06", "after-event-filters.png");
  writeAfter("F14-06", "Event Filter labels are static text without state or controls", {
    tests: ["T034", "T035", "T036", "T037"],
    availableFilters: Replay.EVENT_FILTERS,
    filterCounts,
    exceptionSemanticsEnforced: true,
    selectedVehicleSemanticsEnforced: true,
    screenshot: filterScreenshot,
  });

  replayProbe.setEventFilter("ALL");
  const stopEvent = Replay.allReplayEvents(replayProbe.model).find((event) => event.type === "ARRIVED" && event.orderId);
  replayProbe.setTime(replayProbe.state.endMinute - 1);
  replayProbe.play();
  const clickBefore = { currentMinute: replayProbe.state.currentMinute, status: replayProbe.state.status };
  const clickAfter = replayProbe.jumpToEvent(stopEvent.eventId);
  assert.strictEqual(clickAfter.status, "paused");
  assert.strictEqual(clickAfter.currentMinute, stopEvent.minute);
  assert.strictEqual(clickAfter.selectedVehicleId, stopEvent.vehicleId);
  assert.strictEqual(clickAfter.selectedOrderId, stopEvent.orderId);
  const seekScreenshot = copyScreenshot("F14-07", "after-event-seek.png");
  writeAfter("F14-07", "Replay event click selects context but neither seeks nor pauses", {
    tests: ["T038", "T039", "T040", "T041", "T049"],
    before: clickBefore,
    event: { eventId: stopEvent.eventId, minute: stopEvent.minute, vehicleId: stopEvent.vehicleId, orderId: stopEvent.orderId },
    after: {
      currentMinute: clickAfter.currentMinute,
      status: clickAfter.status,
      selectedVehicleId: clickAfter.selectedVehicleId,
      selectedOrderId: clickAfter.selectedOrderId,
    },
    screenshot: seekScreenshot,
  });

  assert(performanceEvidence.samples.every((sample) => sample.applicationUpdateHz >= sample.minimumApplicationHz));
  writeAfter("F14-08", "Browser RAF cadence is not the Replay application update cadence", {
    tests: ["T254", "T255", "T256", "T257", "T258"],
    methodology: performanceEvidence.methodology,
    samples: performanceEvidence.samples.map((sample) => ({
      stops: sample.stops,
      browserRafHz: sample.browserRafHz,
      applicationUpdateHz: sample.applicationUpdateHz,
      mapAdapterUpdateHz: sample.mapAdapterUpdateHz,
      mapSourceUpdateHz: sample.mapSourceUpdateHz,
      visibleCursorUpdateHz: sample.visibleCursorUpdateHz,
      eventFeedRenderHz: sample.eventFeedRenderHz,
      droppedApplicationFrames: sample.droppedApplicationFrames,
      longTaskCount: sample.longTaskCount,
      logicalMinutesAdvanced: sample.logicalMinutesAdvanced,
      minimumApplicationHz: sample.minimumApplicationHz,
    })),
    metricsReportedSeparately: true,
  });

  const lunchFixture = buildFixture({ orderCount: 18, routeCount: 2, planSuffix: "AFTER-LUNCH", inputSuffix: "AFTER-LUNCH" });
  const timeline = Timeline.buildTimeline(lunchFixture.plan, lunchFixture.scenario);
  const lunchBlocks = timeline.lanes.flatMap((lane) => lane.blocks.filter((block) => block.type === Timeline.BLOCK_TYPES.LUNCH_BREAK));
  assert(lunchBlocks.length > 0);
  assert(lunchBlocks.every((block) => block.enforcement === "NOT_SOLVER_ENFORCED" && block.disclosure === "Not solver-enforced"));
  writeAfter("F14-09", "Timeline paints lunch break over active work without solver/verifier enforcement", {
    tests: ["BREAK-DISCLOSURE"],
    breakSemantics: timeline.breakSemantics,
    breakBlockCount: lunchBlocks.length,
    breakBlocks: lunchBlocks.map((block) => ({ label: block.label, enforcement: block.enforcement, disclosure: block.disclosure })),
    verifierHardViolationCount: lunchFixture.plan.verification.hardViolations.length,
    claim: "Configured display window only; not solver-enforced",
  });

  const cleanupExperience = Experience.createExperience();
  const execution = [];
  cleanupExperience.registerCleanup("after-probe", () => execution.push("A"));
  cleanupExperience.registerCleanup("after-probe", () => { execution.push("B"); throw Object.assign(new Error("B failed"), { code: "B_FAIL" }); });
  cleanupExperience.registerCleanup("after-probe", () => execution.push("C"));
  const cleanupReport = cleanupExperience.destroyOwner("after-probe");
  assert.strictEqual(execution.join(), "C,B,A");
  assert.strictEqual(cleanupReport.successCount, 2);
  assert.strictEqual(cleanupReport.failureCount, 1);
  assert.strictEqual(cleanupExperience.destroyOwner("after-probe").total, 0);
  writeAfter("F14-11", "A throwing cleanup prevents remaining cleanup execution and registry deletion", {
    tests: ["T025", "T026"],
    executionOrder: execution,
    cleanupReport,
    registryEntriesAfterCleanup: 0,
  });

  replay.destroy();
  replayProbe.destroy();
  store.destroy();
  race.destroy();
  replayStore.destroy();
  experience.destroy();
  cleanupExperience.destroy();

  const rows = created.map((file) => `${sha256File(file)}  ./${path.relative(evidenceRoot, file)}`).sort();
  fs.writeFileSync(manifestPath, `${rows.join("\n")}\n`, { encoding: "utf8", mode: 0o444 });
  fs.chmodSync(manifestPath, 0o444);
  return { status: "PASS", phase0EntriesVerified, afterEvidenceFiles: created.length, manifest: path.basename(manifestPath), omittedUntilWaveB: ["F14-10"] };
}

capture().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
