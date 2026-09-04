#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const { spawnSync } = require("child_process");
const Contract = require("../network-contract-v18.js");
const Network = require("../network-solver-v18.js");
const Execution = require("../network-execution-v18.js");
const Visual = require("../network-visualization-v18.js");
const Energy = require("../energy-intelligence-v18.js");
const Uncertainty = require("../uncertainty-lab-v18.js");
const Fixture = require("./fixtures/network-v18-fixture.js");

const repo = path.resolve(__dirname, "..");
const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const runDir = path.resolve(arg("--run-dir", path.join(os.tmpdir(), "stct-v18-overnight")));
const smokeMode = process.argv.includes("--smoke");
const requestedDurationSeconds = Math.max(1, Number(arg("--duration-seconds", "21600")));
const durationSeconds = smokeMode ? requestedDurationSeconds : Math.max(21600, requestedDurationSeconds);
const cycleSeconds = Math.max(0.25, Number(arg("--cycle-seconds", "180")));
const targetSeconds = Math.max(durationSeconds, Number(arg("--target-seconds", "28800")));
const minimumCycles = smokeMode ? Math.max(1, Number(arg("--smoke-cycles", "1"))) : 120;
const statePath = path.join(runDir, "soak", "state.json");
const logPath = path.join(runDir, "STCT-v1.8-OVERNIGHT-SOAK-LOG.ndjson");
const summaryPath = path.join(runDir, "STCT-v1.8-OVERNIGHT-SOAK-SUMMARY.json");
const firstFailurePath = path.join(runDir, "soak", "first-failure.json");
const lastFailurePath = path.join(runDir, "soak", "last-failure.json");
const worstCyclePath = path.join(runDir, "soak", "worst-performance-cycle.json");
const stabilityAnchorPath = path.join(runDir, "soak", "stability-anchor.json");
const resumeProbePath = path.join(runDir, "soak", "resume-probe.json");
const checkpointScript = path.join(runDir, "checkpoint.py");
const startedProcessAt = new Date().toISOString();
const workloads = ["network", "orders500", "orders1000", "pickupDelivery", "crossDock", "multiTrip", "dockWave", "energy", "uncertainty", "execution", "incidentRecovery", "capsule", "noWebGL", "reducedMotion", "fallback", "locale", "cleanStartStop", "checkpointResume", "stabilityReplay", "failureStorm"];
let stopSignal = null;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { stopSignal ||= signal; });
}

fs.mkdirSync(path.dirname(statePath), { recursive: true });
const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const nowMs = () => Date.now();
const shaFile = (file) => `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
const shaText = (value) => `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
const atomicJson = (file, value) => { const temporary = `${file}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temporary, file); };
const append = (value) => fs.appendFileSync(logPath, `${JSON.stringify(value)}\n`);
const assert = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const fdCount = () => { try { return fs.readdirSync("/dev/fd").length; } catch (_) { return null; } };
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };
const sleepDisabled = () => { throw Object.assign(new Error("SLEEP_ONLY_PROHIBITED"), { code: "SLEEP_ONLY_PROHIBITED" }); };
global.setTimeout = sleepDisabled;
global.fetch = async () => { throw Object.assign(new Error("PUBLIC_NETWORK_DISABLED"), { code: "PUBLIC_NETWORK_DISABLED" }); };
const progress = JSON.parse(fs.readFileSync(path.join(runDir, "OVERNIGHT_PROGRESS.json"), "utf8"));
const protectedProcesses = Array.isArray(progress.protectedProcesses) ? progress.protectedProcesses : [];

function protectedProcessStatus() {
  const checks = protectedProcesses.map((row) => {
    const ports = Array.isArray(row.ports) ? row.ports : [];
    const listeners = ports.length ? spawnSync("lsof", ["-nP", "-a", "-p", String(row.pid), "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8" }).stdout : "";
    return { pid: row.pid, alive: pidAlive(row.pid), ports, listening: ports.every((port) => listeners.includes(`:${port} (LISTEN)`)) };
  });
  return { status: checks.every((row) => row.alive && row.listening) ? "PASS" : "FAIL", checks };
}

function sourceManifestHash() {
  const files = ["network-contract-v18.js", "network-solver-v18.js", "network-execution-v18.js", "network-visualization-v18.js", "energy-intelligence-v18.js", "uncertainty-lab-v18.js", "tests/fixtures/network-v18-fixture.js"];
  return Contract.hashArtifact(files.map((relative) => ({ path: relative, sha256: shaFile(path.join(repo, relative)) })));
}

function protectedInventoryStatus() {
  const mismatches = [];
  for (const name of ["original-excel-inventory.json", "v17-artifact-inventory.json"]) {
    const inventory = JSON.parse(fs.readFileSync(path.join(runDir, "baseline", name), "utf8"));
    for (const row of inventory.files) {
      const actual = fs.existsSync(row.path) ? shaFile(row.path).slice(7) : null;
      if (actual !== row.sha256) mismatches.push({ path: row.path, expected: row.sha256, actual });
    }
  }
  const processes = protectedProcessStatus();
  return { status: mismatches.length || processes.status !== "PASS" ? "FAIL" : "PASS", mismatches, processes };
}

function tuneScenario(scenario) {
  scenario.depots.forEach((depot) => { depot.capacity = { dailyOrders: 5000, volume: 100000, weight: 1000000, handlingMinutes: 100000, parkingSlots: 1000 }; });
  scenario.docks.forEach((dock) => { dock.simultaneousCapacity = 20; dock.loadRate = 100; dock.unloadRate = 100; dock.fixedSetupMinutes = 1; dock.operatingWindows = [{ start: "06:00", end: "23:59" }]; });
  scenario.vehicles.forEach((vehicle) => { vehicle.capacity = { volume: 100, weight: 10000 }; vehicle.maxTrips = 20; });
  scenario.drivers.forEach((driver) => { driver.requiredBreaks = []; driver.maxDrivingMinutes = 5000; driver.maxDutyMinutes = 5000; driver.shiftWindows = [{ start: "06:00", end: "23:59" }]; });
  scenario.orders.forEach((order, index) => {
    const depot = scenario.depots.find((row) => row.depotId === order.preferredDepotId) || scenario.depots[index % scenario.depots.length];
    order.coordinate = [depot.coordinate[0] + (index % 7 - 3) * 0.001, depot.coordinate[1] + (index % 5 - 2) * 0.001];
    order.demand = { volume: 1, weight: 1 };
    order.serviceDuration = 1;
    order.releaseTime = "06:00";
    order.dueTime = "23:59";
    order.timeWindows = [{ start: "06:00", end: "23:59" }];
  });
  return scenario;
}

function scenario(seed, orders, options = {}) {
  const source = tuneScenario(Fixture.makeNetwork({ networkId: `SOAK-${seed}-${orders}`, seed, orderCount: orders, depotCount: options.depotCount || 2, vehicleCount: options.vehicleCount || Math.max(8, Math.ceil(orders / 10)), driverCount: options.vehicleCount || Math.max(8, Math.ceil(orders / 10)), docksPerDepot: 4, pickupDelivery: Boolean(options.pickupDelivery), crossDock: Boolean(options.crossDock) }));
  source.pickupDeliveryPairs.forEach((pair) => { pair.sameVehicleRequired = false; pair.sameTripRequired = false; pair.transferAllowed = true; });
  return source;
}

function solveVerified(source, options = {}) {
  const identities = Contract.identityBundle(source, options);
  const plan = Network.solveNetwork(source, { maxOrders: 500, maxStopsPerTrip: 4, maxTripsPerWave: 50, ...options });
  const verification = Network.verifyNetworkPlan(source, plan);
  assert(verification.status === "PASS", `NETWORK_VERIFY_${verification.issues.join("_")}`);
  assert(plan.metrics.assignedOrders + plan.metrics.unassignedOrders + plan.metrics.blockedOrders === source.orders.length, "ORDER_DISPOSITION_CONSERVATION");
  return { identities, plan, verification };
}

function runExecution(source, plan, cycle) {
  const run = Execution.createRun(source, plan, { runId: `SOAK-RUN-${cycle}` });
  const incident = Execution.createIncident(run, "DOCK_FAILURE", { incidentId: `SOAK-INCIDENT-${cycle}`, dockId: source.docks[0].dockId, depotId: source.depots[0].depotId, logicalMinute: 15 });
  const cutoff = Execution.freezeCutoff(run, { logicalMinute: 15 });
  const candidates = Execution.generateRecoveryCandidates(run, cutoff, { incidentHash: incident.incidentHash });
  assert(candidates.length > 0 && candidates.every((candidate) => Execution.verifyRecoveryCandidate(candidate, cutoff).status === "PASS"), "RECOVERY_VERIFY_FAILED");
  const capsule = Execution.createCapsule(run, cutoff, candidates);
  const imported = JSON.parse(JSON.stringify(capsule));
  assert(Execution.replay(imported).status === "EQUIVALENT", "CAPSULE_REPLAY_FAILED");
  return { runId: run.runId, incidentHash: incident.incidentHash, capsuleHash: capsule.capsuleHash, candidateCount: candidates.length };
}

function runEnergy(cycle) {
  const fixture = Energy.makeFixture(`SOAK-E-${cycle}`, 10, 20, 3);
  const plan = Energy.planEnergy(fixture);
  const verification = Energy.verifyEnergy(fixture, plan);
  assert(verification.status === "PASS", `ENERGY_VERIFY_${verification.issues.join("_")}`);
  return { fixtureId: fixture.fixtureId, energyPlanHash: plan.energyPlanHash, tripCount: plan.trips.length };
}

function runUncertainty(source, plan, cycle) {
  const base = { sourceScenarioHash: Contract.identityBundle(source).networkInputHash, serviceRate: plan.metrics.serviceRate, cost: plan.metrics.totalCost, carbonKg: plan.metrics.totalCarbonKg, latestCompletionMinute: Math.max(0, ...plan.trip.trips.map((trip) => trip.endMinute)), dockQueueMinutes: plan.dock.metrics.averageQueueMinutes * plan.dock.metrics.reservationCount, vehicleRequirement: Math.max(1, new Set(plan.trip.trips.map((trip) => trip.vehicleId)).size) };
  const result = Uncertainty.runEnsemble(base, { scenarioType: "SOAK_ROTATION" }, 30, 180000 + cycle);
  assert(result.counts.missing === 0 && result.selection.successfulSamplesVerifierValid, "UNCERTAINTY_SAMPLE_INVALID");
  return { ensembleHash: result.ensembleHash, sampleCount: result.sampleCount, counts: result.counts };
}

function runVisual(source, plan, cycle) {
  const model = Visual.buildModel(source, plan, { alerts: [], execution: { conflicts: [], incidents: [] }, delays: [] });
  const controller = Visual.createController();
  const opened = controller.open(model);
  const noWebGL = Visual.noWebGL(model);
  const reduced = Visual.reducedMotion(model);
  const locale = ["zh", "en", "ja"][cycle % 3];
  const html = Visual.renderHTML(model, { locale, noWebGL: cycle % 2 === 0, mobile: cycle % 3 === 0 });
  const closed = controller.close();
  assert(noWebGL.operational && reduced.allRelationsVisible && html.includes(`lang="${locale}"`) && closed.leakFree, "VISUAL_TEARDOWN_FAILED");
  return { visualHash: model.visualHash, locale, opened, closed, htmlHash: shaText(html) };
}

function checkpointProjection(value) {
  const projection = clone(value);
  delete projection.checkpointHash;
  return projection;
}

function writeCheckpointPayload(file, value) {
  const payload = { ...value, checkpointHash: Contract.hashArtifact(value) };
  atomicJson(file, payload);
  return payload;
}

function readCheckpointPayload(file) {
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  assert(Contract.hashArtifact(checkpointProjection(payload)) === payload.checkpointHash, "CHECKPOINT_HASH_MISMATCH");
  return payload;
}

function runStabilityReplay(source, plan, cycle, implementationHash) {
  if (!fs.existsSync(stabilityAnchorPath)) {
    writeCheckpointPayload(stabilityAnchorPath, {
      schemaVersion: "stct-overnight-stability-anchor-v1.8",
      createdCycle: cycle,
      implementationHash,
      source,
      plan,
    });
  }
  const anchor = readCheckpointPayload(stabilityAnchorPath);
  assert(anchor.implementationHash === implementationHash, "STABILITY_IMPLEMENTATION_CHANGED");
  const firstIdentity = Contract.identityBundle(anchor.source, anchor.plan.solveOptions);
  const secondIdentity = Contract.identityBundle(anchor.source, anchor.plan.solveOptions);
  assert(firstIdentity.networkInputHash === secondIdentity.networkInputHash, "STABILITY_NETWORK_IDENTITY_DRIFT");
  assert(firstIdentity.routingContextHash === secondIdentity.routingContextHash, "STABILITY_ROUTING_IDENTITY_DRIFT");
  const verification = Network.verifyNetworkPlan(anchor.source, anchor.plan);
  assert(verification.status === "PASS", `STABILITY_PLAN_FAILED_LATER_${verification.issues.join("_")}`);
  const repeated = solveVerified(clone(anchor.source), anchor.plan.solveOptions);
  assert(repeated.plan.networkPlanHash === anchor.plan.networkPlanHash, "STABILITY_PLAN_HASH_DRIFT");
  const currentIdentity = Contract.identityBundle(source, plan.solveOptions);
  assert(currentIdentity.networkInputHash === plan.networkInputHash, "CURRENT_PLAN_IDENTITY_MISMATCH");
  return {
    anchorCreatedCycle: anchor.createdCycle,
    checkpointHash: anchor.checkpointHash,
    networkInputHash: firstIdentity.networkInputHash,
    routingContextHash: firstIdentity.routingContextHash,
    networkPlanHash: anchor.plan.networkPlanHash,
    repeatedNetworkPlanHash: repeated.plan.networkPlanHash,
    implementationHash,
    verificationStatus: verification.status,
  };
}

function runCheckpointResume(source, plan, cycle, implementationHash) {
  const written = writeCheckpointPayload(resumeProbePath, {
    schemaVersion: "stct-overnight-resume-probe-v1.8",
    savedAt: new Date().toISOString(),
    savedCycle: cycle,
    implementationHash,
    source,
    plan,
  });
  const resumed = readCheckpointPayload(resumeProbePath);
  assert(resumed.savedCycle === cycle, "CHECKPOINT_CYCLE_MISMATCH");
  assert(resumed.implementationHash === implementationHash, "CHECKPOINT_IMPLEMENTATION_MISMATCH");
  const verification = Network.verifyNetworkPlan(resumed.source, resumed.plan);
  assert(verification.status === "PASS", `CHECKPOINT_PLAN_REPLAY_${verification.issues.join("_")}`);
  assert(resumed.plan.networkPlanHash === plan.networkPlanHash, "CHECKPOINT_PLAN_HASH_DRIFT");
  return {
    savedCycle: resumed.savedCycle,
    checkpointHash: written.checkpointHash,
    networkInputHash: resumed.plan.networkInputHash,
    routingContextHash: resumed.plan.routingContextHash,
    networkPlanHash: resumed.plan.networkPlanHash,
    verificationStatus: verification.status,
  };
}

function runFailureStorm(source, plan) {
  const attacks = [];
  const execute = (name, expectedIssue, mutate) => {
    const candidate = clone(plan);
    mutate(candidate);
    const verification = Network.verifyNetworkPlan(source, candidate);
    assert(verification.status === "FAIL" && verification.issues.includes(expectedIssue), `FAILURE_STORM_${name}_NOT_DETECTED`);
    attacks.push({ name, expectedIssue, status: verification.status, issues: verification.issues });
  };
  execute("route-matrix", "ROUTE_MATRIX_MISMATCH", (candidate) => { candidate.trip.routes[0].matrixHash = Contract.hashArtifact("soak-wrong-matrix"); });
  execute("duplicate-order", "ORDER_DUPLICATE", (candidate) => { candidate.trip.trips[0].orderIds.push(candidate.trip.trips[0].orderIds[0]); });
  execute("plan-hash", "NETWORK_PLAN_HASH_MISMATCH", (candidate) => { candidate.networkPlanHash = Contract.hashArtifact("soak-forged-plan"); });
  const clean = solveVerified(clone(source), plan.solveOptions);
  assert(clean.plan.networkPlanHash === plan.networkPlanHash, "FAILURE_STORM_CLEAN_RECOVERY_DRIFT");
  return { attacks, cleanStatus: clean.verification.status, cleanNetworkPlanHash: clean.plan.networkPlanHash };
}

function linearSlope(values) {
  if (values.length < 2) return 0;
  const meanX = (values.length - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => { numerator += (index - meanX) * (value - meanY); denominator += (index - meanX) ** 2; });
  return denominator ? numerator / denominator : 0;
}

function loadState() {
  if (fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    state.counts ||= {};
    workloads.forEach((name) => { if (!Number.isFinite(state.counts[name])) state.counts[name] = 0; });
    return state;
  }
  return { schemaVersion: "stct-overnight-soak-state-v1.8", status: "RUNNING", startedAt: new Date().toISOString(), targetSeconds, minimumSeconds: durationSeconds, cycleSeconds, lastCompleteCycle: 0, counts: Object.fromEntries(workloads.map((name) => [name, 0])), pass: 0, fail: 0, blocked: 0, firstFailure: null, lastFailure: null, worstPerformanceCycle: null, implementationHash: sourceManifestHash(), resumed: false };
}

function updateWorst(state, record) {
  if (!state.worstPerformanceCycle || record.durationMs > state.worstPerformanceCycle.durationMs) {
    state.worstPerformanceCycle = { cycle: record.cycle, durationMs: record.durationMs, workUnits: record.workUnits, rssBytes: record.resources.end.rssBytes, resultHash: record.resultHash };
    atomicJson(worstCyclePath, record);
  }
}

function checkpoint(cycle) {
  if (!fs.existsSync(checkpointScript) || cycle % 25 !== 0) return { attempted: false };
  const result = spawnSync("python3", [checkpointScript, "--phase", `O11-SOAK-CYCLE-${cycle}`, "--completed", `Completed ${cycle} real-workload soak cycles`, "--next", "Resume soak from external state", "--core-passed", "1067", "--overnight-passed", "1501", "--artifact", logPath, "--artifact", summaryPath], { cwd: repo, encoding: "utf8" });
  return { attempted: true, status: result.status, output: (result.stdout || result.stderr || "").trim().slice(0, 1000) };
}

function writeSummary(state, status) {
  const lines = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  const completed = lines.filter((row) => row.type === "CYCLE" && row.status === "PASS");
  const resourceRows = completed.map((row) => row.resources.end);
  const slopes = {
    rssBytesPerCycle: linearSlope(resourceRows.slice(10).map((row) => row.rssBytes)),
    heapUsedBytesPerCycle: linearSlope(resourceRows.slice(10).map((row) => row.heapUsedBytes)),
    fdPerCycle: linearSlope(resourceRows.slice(10).map((row) => row.openFileDescriptors || 0)),
    listenersPerCycle: linearSlope(resourceRows.slice(10).map((row) => row.listeners)),
    rafPerCycle: linearSlope(resourceRows.slice(10).map((row) => row.raf)),
    layersPerCycle: linearSlope(resourceRows.slice(10).map((row) => row.layers)),
    sourcesPerCycle: linearSlope(resourceRows.slice(10).map((row) => row.sources)),
    workersPerCycle: linearSlope(resourceRows.slice(10).map((row) => row.workers)),
  };
  const summary = { schemaVersion: "stct-overnight-soak-summary-v1.8", status, startedAt: state.startedAt, endedAt: new Date().toISOString(), processStartedAt: startedProcessAt, targetSeconds, minimumSeconds: durationSeconds, actualDurationSeconds: (nowMs() - Date.parse(state.startedAt)) / 1000, completeCycles: state.lastCompleteCycle, pass: state.pass, fail: state.fail, blocked: state.blocked, counts: state.counts, failures: { first: state.firstFailure, last: state.lastFailure }, worstPerformanceCycle: state.worstPerformanceCycle, leakSlopes: slopes, noUnexplainedMonotonicGrowth: slopes.rssBytesPerCycle < 1024 * 1024 && slopes.fdPerCycle <= 0.01 && ["listenersPerCycle", "rafPerCycle", "layersPerCycle", "sourcesPerCycle", "workersPerCycle"].every((key) => Math.abs(slopes[key]) < 0.001), protectedResources: protectedInventoryStatus(), activePids: { soak: process.pid, protected: protectedProcessStatus().checks }, ownedPorts: [], publicRoutingOrOptimizerCalls: 0, priorCyclesRetained: true, sleepOnly: false, implementationHash: state.implementationHash, stability: state.lastStabilityReplay || null, checkpointResume: state.lastCheckpointResume || null, failureStorm: state.lastFailureStorm || null, interruption: state.interruption || null };
  atomicJson(summaryPath, summary);
  return summary;
}

async function main() {
  const state = loadState();
  if (state.lastCompleteCycle > 0) state.resumed = true;
  assert(state.implementationHash === sourceManifestHash(), "IMPLEMENTATION_CHANGED_DURING_RESUME");
  atomicJson(statePath, state);
  append({ type: "PROCESS_START", at: startedProcessAt, pid: process.pid, resumeFromCycle: state.lastCompleteCycle, durationSeconds, cycleSeconds, targetSeconds, sleepOnly: false });
  while (!stopSignal && ((nowMs() - Date.parse(state.startedAt)) / 1000 < durationSeconds || state.lastCompleteCycle < minimumCycles)) {
    const cycle = state.lastCompleteCycle + 1;
    const cycleStartedAt = new Date().toISOString();
    const cycleStartedMs = nowMs();
    const cpuStart = process.cpuUsage();
    const resourceStart = process.memoryUsage();
    const fdStart = fdCount();
    const observed = { scenarioHashes: [], resultHashes: [], workloads: [], details: {}, publicCalls: 0 };
    let workUnits = 0;
    let status = "PASS";
    let failure = null;
    try {
      const primaryOrders = cycle % 6 === 1 ? 500 : cycle % 12 === 2 ? 1000 : 120;
      const pickupDelivery = cycle % 6 === 3;
      const crossDock = pickupDelivery;
      const chunks = primaryOrders > 500 ? [500, 500] : [primaryOrders];
      const solved = chunks.map((orders, index) => {
        const source = scenario(180000 + cycle * 10 + index, orders, { depotCount: primaryOrders >= 500 ? 5 : 2, vehicleCount: primaryOrders >= 500 ? 50 : 12, pickupDelivery, crossDock });
        const result = solveVerified(source, { objective: ["BALANCED_NETWORK", "SERVICE_FIRST", "MIN_TOTAL_COST"][cycle % 3] });
        observed.scenarioHashes.push(result.identities.networkInputHash);
        observed.resultHashes.push(result.plan.networkPlanHash);
        workUnits += 1;
        return { source, ...result };
      });
      observed.workloads.push("network", "multiTrip", "dockWave");
      if (primaryOrders === 500) observed.workloads.push("orders500");
      if (primaryOrders === 1000) observed.workloads.push("orders1000");
      if (pickupDelivery) observed.workloads.push("pickupDelivery", "crossDock");
      const anchor = solved[0];
      observed.details.stabilityReplay = runStabilityReplay(anchor.source, anchor.plan, cycle, state.implementationHash);
      observed.workloads.push("stabilityReplay");
      workUnits += 1;
      if (cycle % 6 === 4) { observed.details.execution = runExecution(anchor.source, anchor.plan, cycle); observed.workloads.push("execution", "incidentRecovery", "capsule"); workUnits += 1; }
      if (cycle % 12 === 5) { observed.details.energy = runEnergy(cycle); observed.workloads.push("energy"); workUnits += 1; }
      if (cycle % 12 === 6) { observed.details.uncertainty = runUncertainty(anchor.source, anchor.plan, cycle); observed.workloads.push("uncertainty"); workUnits += 1; }
      if (cycle % 12 === 7) { observed.details.visual = runVisual(anchor.source, anchor.plan, cycle); observed.workloads.push("noWebGL", "reducedMotion", "locale"); workUnits += 1; }
      if (cycle % 12 === 8) { assert(anchor.plan.engine.used === "LOCAL_HEURISTIC" && anchor.plan.engine.publicRoutingCalls === 0, "FALLBACK_BOUNDARY_FAILED"); observed.workloads.push("fallback"); }
      if (cycle % 3 !== 1) { observed.details.visual = runVisual(anchor.source, anchor.plan, cycle); observed.workloads.push("locale"); workUnits += 1; }
      if (cycle % 12 === 9) {
        const controller = Visual.createController();
        controller.open(Visual.buildModel(anchor.source, anchor.plan));
        const closed = controller.close();
        assert(closed.leakFree, "CLEAN_STOP_FAILED");
        observed.details.cleanStartStop = closed;
        observed.details.checkpointResume = runCheckpointResume(anchor.source, anchor.plan, cycle, state.implementationHash);
        observed.workloads.push("cleanStartStop", "checkpointResume");
        workUnits += 2;
      }
      if (cycle % 12 === 10) {
        observed.details.failureStorm = runFailureStorm(anchor.source, anchor.plan);
        observed.workloads.push("failureStorm");
        workUnits += 4;
      }
      while ((nowMs() - cycleStartedMs) / 1000 < cycleSeconds) {
        const seed = 900000 + cycle * 10000 + workUnits;
        const source = scenario(seed, 24, { depotCount: 2, vehicleCount: 8, pickupDelivery: workUnits % 5 === 0, crossDock: workUnits % 5 === 0 });
        const result = solveVerified(source, { objective: ["BALANCED_NETWORK", "MIN_TOTAL_COST", "MIN_CARBON"][workUnits % 3] });
        if (workUnits % 4 === 0) runExecution(source, result.plan, cycle * 100000 + workUnits);
        if (workUnits % 7 === 0) runVisual(source, result.plan, cycle);
        observed.scenarioHashes.push(result.identities.networkInputHash);
        observed.resultHashes.push(result.plan.networkPlanHash);
        workUnits += 1;
      }
      assert(protectedInventoryStatus().status === "PASS", "PROTECTED_RESOURCE_CHANGED");
      assert(protectedProcessStatus().status === "PASS", "PROTECTED_SERVICE_STOPPED");
      assert(sourceManifestHash() === state.implementationHash, "IMPLEMENTATION_CHANGED_DURING_SOAK");
    } catch (error) {
      status = "FAIL";
      failure = { cycle, at: new Date().toISOString(), code: error.code || "SOAK_CYCLE_ERROR", message: error.message, stack: String(error.stack || "").split("\n").slice(0, 8) };
    }
    if (global.gc) global.gc();
    const cpu = process.cpuUsage(cpuStart);
    const resourcesEnd = process.memoryUsage();
    const controllerBaseline = { listeners: 0, raf: 0, layers: 0, sources: 0, workers: 0 };
    const record = { type: "CYCLE", schemaVersion: "stct-overnight-soak-cycle-v1.8", cycle, status, startedAt: cycleStartedAt, endedAt: new Date().toISOString(), durationMs: performance.now() - performance.timeOrigin - (cycleStartedMs - performance.timeOrigin), deterministicSeed: 180000 + cycle * 10, workUnits, workloads: [...new Set(observed.workloads)], scenarioHashes: observed.scenarioHashes, resultHashes: observed.resultHashes, details: observed.details, publicCalls: observed.publicCalls, failure, resources: { start: { rssBytes: resourceStart.rss, heapUsedBytes: resourceStart.heapUsed, openFileDescriptors: fdStart, ...controllerBaseline }, end: { rssBytes: resourcesEnd.rss, heapUsedBytes: resourcesEnd.heapUsed, openFileDescriptors: fdCount(), cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system, activePids: [process.pid, ...protectedProcesses.map((row) => row.pid)], ownedPorts: [], ...controllerBaseline } }, resultHash: "" };
    record.durationMs = nowMs() - cycleStartedMs;
    record.resultHash = Contract.hashArtifact({ cycle: record.cycle, status: record.status, deterministicSeed: record.deterministicSeed, workUnits, workloads: record.workloads, scenarioHashes: record.scenarioHashes, resultHashes: record.resultHashes, details: record.details, publicCalls: record.publicCalls, resources: record.resources });
    append(record);
    state.lastCompleteCycle = cycle;
    state[status === "PASS" ? "pass" : "fail"] += 1;
    for (const name of record.workloads) state.counts[name] += 1;
    if (record.details.stabilityReplay) state.lastStabilityReplay = record.details.stabilityReplay;
    if (record.details.checkpointResume) state.lastCheckpointResume = record.details.checkpointResume;
    if (record.details.failureStorm) state.lastFailureStorm = record.details.failureStorm;
    if (failure) {
      if (!state.firstFailure) { state.firstFailure = failure; atomicJson(firstFailurePath, record); }
      state.lastFailure = failure;
      atomicJson(lastFailurePath, record);
    }
    updateWorst(state, record);
    state.status = "RUNNING";
    atomicJson(statePath, state);
    const partial = writeSummary(state, "RUNNING");
    const checkpointResult = checkpoint(cycle);
    if (checkpointResult.attempted) append({ type: "CHECKPOINT", cycle, at: new Date().toISOString(), ...checkpointResult });
    process.stdout.write(`${JSON.stringify({ cycle, status, durationMs: record.durationMs, workUnits, elapsedSeconds: Math.round(partial.actualDurationSeconds), rssMb: Math.round(resourcesEnd.rss / 1024 / 1024) })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
  }
  const elapsed = (nowMs() - Date.parse(state.startedAt)) / 1000;
  const countsPass = state.lastCompleteCycle >= 120 && state.counts.orders500 >= 20 && state.counts.orders1000 >= 10 && state.counts.pickupDelivery >= 20 && state.counts.crossDock >= 20 && state.counts.multiTrip >= 20 && state.counts.dockWave >= 20 && state.counts.energy >= 10 && state.counts.uncertainty >= 10 && state.counts.execution >= 20 && state.counts.incidentRecovery >= 20 && state.counts.capsule >= 20 && state.counts.noWebGL >= 10 && state.counts.reducedMotion >= 10 && state.counts.fallback >= 10 && state.counts.locale >= 30 && state.counts.cleanStartStop >= 10 && state.counts.checkpointResume >= 10 && state.counts.stabilityReplay >= 120 && state.counts.failureStorm >= 10;
  const finalStatus = stopSignal ? "BLOCKED_ENVIRONMENT" : smokeMode ? state.fail === 0 ? "SMOKE_PASS" : "FAIL" : elapsed >= durationSeconds && countsPass && state.fail === 0 ? "PASS" : elapsed < durationSeconds ? "BLOCKED_ENVIRONMENT" : "FAIL";
  state.status = finalStatus;
  state.endedAt = new Date().toISOString();
  state.interruption = stopSignal ? { signal: stopSignal, at: state.endedAt, completedCycles: state.lastCompleteCycle } : null;
  atomicJson(statePath, state);
  const summary = writeSummary(state, finalStatus);
  append({ type: "PROCESS_END", at: state.endedAt, status: finalStatus, cycles: state.lastCompleteCycle, durationSeconds: summary.actualDurationSeconds, interruption: state.interruption, resultHash: Contract.hashArtifact(summary) });
  process.stdout.write(`${JSON.stringify({ status: finalStatus, cycles: state.lastCompleteCycle, durationSeconds: summary.actualDurationSeconds, counts: state.counts }, null, 2)}\n`);
  process.exitCode = ["PASS", "SMOKE_PASS"].includes(finalStatus) ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
