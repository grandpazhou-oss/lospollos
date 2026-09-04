#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const valueAfter = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const root = path.resolve(valueAfter("--root", path.resolve(__dirname, "..")));
const mode = valueAfter("--mode", "release");
const capsuleOutput = valueAfter("--capsule-output");
const htmlOutput = valueAfter("--html-output");
const load = (name) => require(path.join(root, name));
const Contract = load("network-contract-v18.js");
const Network = load("network-solver-v18.js");
const Execution = load("network-execution-v18.js");
const Visual = load("network-visualization-v18.js");
const Energy = load("energy-intelligence-v18.js");
const Uncertainty = load("uncertainty-lab-v18.js");
const Secure = load("secure-import-v18.js");
const Fixture = load("tests/fixtures/network-v18-fixture.js");

function source(options) {
  const value = Fixture.makeNetwork(options);
  value.depots.forEach((depot) => {
    depot.capacity = { dailyOrders: 5000, volume: 100000, weight: 100000, handlingMinutes: 100000, parkingSlots: 100 };
  });
  value.docks.forEach((dock) => {
    dock.simultaneousCapacity = 12;
    dock.loadRate = 100;
    dock.unloadRate = 100;
    dock.fixedSetupMinutes = 1;
  });
  value.vehicles.forEach((vehicle) => {
    vehicle.capacity = { volume: 100, weight: 10000 };
    vehicle.maxTrips = 20;
  });
  value.drivers.forEach((driver) => {
    driver.requiredBreaks = [];
    driver.maxDrivingMinutes = 3000;
    driver.maxDutyMinutes = 3000;
  });
  value.orders.forEach((order) => {
    order.demand = { volume: 1, weight: 1 };
    order.serviceDuration = 1;
  });
  value.pickupDeliveryPairs.forEach((pair) => {
    pair.sameVehicleRequired = false;
    pair.sameTripRequired = false;
    pair.transferAllowed = true;
  });
  return value;
}

function ortoolsEvidence() {
  if (mode !== "release") return null;
  const result = spawnSync("python3", ["optimizer/network_solver_v18.py", "--nodes", "18", "--compact"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const evidence = JSON.parse(result.stdout);
  assert.strictEqual(evidence.status, "PASS");
  assert.strictEqual(evidence.actualOrtoolsRun, true);
  assert.strictEqual(evidence.publicRoutingCalls, 0);
  return evidence;
}

function uncertaintyHash(value) {
  const projection = structuredClone(value);
  delete projection.ensembleHash;
  return Contract.hashArtifact(projection);
}

function main() {
  assert(["release", "fallback", "no-webgl-reduced"].includes(mode), "Unsupported replay mode");
  const ortools = ortoolsEvidence();
  const base = source({ networkId: "OVERNIGHT-CLEAN-ROOM-" + mode, seed: 1713, depotCount: 3, vehicleCount: 12, driverCount: 12, orderCount: 60, docksPerDepot: 4 });
  const solveOptions = {
    maxOrders: 500,
    maxStopsPerTrip: 3,
    maxTripsPerWave: 12,
    engineRequested: mode === "fallback" ? "LOCAL_HEURISTIC" : "OR_TOOLS",
    actualOrtoolsEvidence: ortools,
  };
  const plan = Network.solveNetwork(base, solveOptions);
  const verification = Network.verifyNetworkPlan(base, plan);
  assert.strictEqual(verification.status, "PASS", verification.issues.join(","));
  if (mode === "release") assert(plan.engine.actualOrtoolsRun && ortools.actualOrtoolsRun);
  if (mode === "fallback") {
    assert.strictEqual(plan.engine.used, "LOCAL_HEURISTIC");
    assert.strictEqual(plan.engine.actualOrtoolsRun, false);
  }

  const paired = source({ networkId: "OVERNIGHT-CLEAN-ROOM-XDOCK-" + mode, seed: 1721, depotCount: 2, vehicleCount: 8, driverCount: 8, orderCount: 24, docksPerDepot: 4, pickupDelivery: true, crossDock: true });
  const pairedPlan = Network.solveNetwork(paired, { ...solveOptions, crossDock: true, maxStopsPerTrip: 2 });
  const pairedVerification = Network.verifyNetworkPlan(paired, pairedPlan);
  assert.strictEqual(pairedVerification.status, "PASS", pairedVerification.issues.join(","));
  assert(pairedPlan.custody.transfers.length > 0);

  const energyFixture = Energy.makeFixture("OVERNIGHT-CLEAN-ROOM-EV-" + mode, 8, 16, 3);
  const energyPlan = Energy.planEnergy(energyFixture);
  const energyVerification = Energy.verifyEnergy(energyFixture, energyPlan);
  assert.strictEqual(energyVerification.status, "PASS", energyVerification.issues.join(","));

  const uncertaintyBase = {
    sourceScenarioHash: plan.networkInputHash,
    serviceRate: plan.metrics.serviceRate,
    cost: plan.metrics.totalCost,
    carbonKg: plan.metrics.totalCarbonKg,
    latestCompletionMinute: Math.max(0, ...plan.trip.trips.map((trip) => trip.endMinute)),
    dockQueueMinutes: plan.dock.metrics.averageQueueMinutes * plan.dock.metrics.reservationCount,
    vehicleRequirement: Math.max(1, new Set(plan.trip.trips.map((trip) => trip.vehicleId)).size),
  };
  const uncertainty = Uncertainty.runEnsemble(uncertaintyBase, { scenarioType: "CLEAN_ROOM" }, 30, 1723);
  assert.strictEqual(uncertainty.counts.missing, 0);
  assert.strictEqual(uncertaintyHash(uncertainty), uncertainty.ensembleHash);

  const run = Execution.createRun(base, plan, { runId: "OVERNIGHT-CLEAN-ROOM-RUN-" + mode });
  const incident = Execution.createIncident(run, "DOCK_FAILURE", { incidentId: "OVERNIGHT-CLEAN-ROOM-INCIDENT-" + mode, dockId: base.docks[0].dockId, depotId: base.depots[0].depotId, logicalMinute: 15 });
  const cutoff = Execution.freezeCutoff(run, { logicalMinute: 15 });
  const candidates = Execution.generateRecoveryCandidates(run, cutoff, { incidentHash: incident.incidentHash });
  assert(candidates.length > 0 && candidates.every((candidate) => Execution.verifyRecoveryCandidate(candidate, cutoff).status === "PASS"));
  const executionCapsule = Execution.createCapsule(run, cutoff, candidates);
  assert.strictEqual(Execution.replay(executionCapsule).status, "EQUIVALENT");

  const model = Visual.buildModel(base, plan, { alerts: [], execution: { conflicts: [], incidents: [] }, delays: [] });
  const noWebGL = Visual.noWebGL(model);
  const reduced = Visual.reducedMotion(model);
  const html = Visual.renderHTML(model, { locale: "ja", noWebGL: mode === "no-webgl-reduced", mobile: true });
  assert(noWebGL.operational && reduced.allRelationsVisible);
  if (mode === "no-webgl-reduced") assert(html.includes('data-no-webgl="true"'));

  const deepCapsule = Secure.createDeepCapsule({
    networkScenario: base,
    networkPlan: plan,
    energy: { fixture: energyFixture, plan: energyPlan },
    uncertainty,
    executionCapsule,
  }, { replayMode: mode, source: "SYNTHETIC_CLEAN_ROOM" });
  const deepVerification = Secure.verifyDeepCapsule(deepCapsule, {
    networkScenario: (value) => {
      try {
        Contract.normalizeScenario(value);
        return { status: "PASS" };
      } catch (error) {
        return { status: "FAIL", issue: error.code || error.message };
      }
    },
    networkPlan: (value, sections) => Network.verifyNetworkPlan(sections.networkScenario, value),
    energy: (value) => Energy.verifyEnergy(value.fixture, value.plan),
    uncertainty: (value) => ({ status: uncertaintyHash(value) === value.ensembleHash ? "PASS" : "FAIL" }),
    executionCapsule: (value) => ({ status: Execution.replay(value).status === "EQUIVALENT" ? "PASS" : "FAIL" }),
  });
  assert.strictEqual(deepVerification.status, "PASS", JSON.stringify(deepVerification.issues));

  if (capsuleOutput) {
    fs.mkdirSync(path.dirname(path.resolve(capsuleOutput)), { recursive: true });
    fs.writeFileSync(path.resolve(capsuleOutput), JSON.stringify(deepCapsule, null, 2) + "\n");
  }
  if (htmlOutput) {
    fs.mkdirSync(path.dirname(path.resolve(htmlOutput)), { recursive: true });
    fs.writeFileSync(path.resolve(htmlOutput), html);
  }

  const result = {
    schemaVersion: "stct-overnight-clean-room-smoke-v1.8",
    status: "PASS",
    mode,
    sourceRoot: ".",
    manifestVerifiedBeforeExecution: false,
    publicRoutingOrOptimizerCalls: 0,
    coreNetworkSolve: verification.status,
    crossDock: pairedVerification.status,
    crossDockTransfers: pairedPlan.custody.transfers.length,
    energy: energyVerification.status,
    uncertainty: "PASS",
    execution: "PASS",
    recovery: "PASS",
    capsule: deepVerification.status,
    noWebGL: noWebGL.operational ? "PASS" : "FAIL",
    reducedMotion: reduced.allRelationsVisible ? "PASS" : "FAIL",
    ownedServices: { started: 0, closed: 0, surviving: 0 },
    engine: {
      requested: plan.engine.requested,
      used: plan.engine.used,
      actualOrtoolsRun: plan.engine.actualOrtoolsRun,
      ortoolsEvidence: ortools,
    },
    hashes: {
      networkInputHash: plan.networkInputHash,
      networkPlanHash: plan.networkPlanHash,
      routingContextHash: plan.routingContextHash,
      energyPlanHash: energyPlan.energyPlanHash,
      ensembleHash: uncertainty.ensembleHash,
      executionCapsuleHash: executionCapsule.capsuleHash,
      deepCapsuleHash: deepCapsule.capsuleHash,
    },
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

try {
  main();
} catch (error) {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exit(1);
}
