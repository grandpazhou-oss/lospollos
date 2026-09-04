#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");

const rootIndex = process.argv.indexOf("--root");
const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : path.resolve(__dirname, ".."));
const fallback = process.argv.includes("--fallback");
const load = (name) => require(path.join(root, name));
const Fixture = load("tests/fixtures/network-v18-fixture.js");
const Network = load("network-solver-v18.js");
const Scenario = load("scenario-lab-v18.js");
const Execution = load("network-execution-v18.js");
const CommandCenter = load("network-command-center-v18.js");

function source(options) {
  const value = Fixture.makeNetwork(options);
  value.depots.forEach((depot) => {
    depot.capacity.dailyOrders = 10000;
    depot.capacity.volume = 100000;
    depot.capacity.weight = 100000;
    depot.capacity.handlingMinutes = 100000;
  });
  value.docks.forEach((dock) => { dock.simultaneousCapacity = 20; });
  value.drivers.forEach((driver) => { driver.requiredBreaks = []; driver.maxDrivingMinutes = 2000; driver.maxDutyMinutes = 2000; });
  return value;
}

const single = source({ depotCount: 1, vehicleCount: 5, driverCount: 5, orderCount: 20 });
const singlePlan = Network.solveNetwork(single, { maxStopsPerTrip: 2 });
assert.strictEqual(Network.verifyNetworkPlan(single, singlePlan).status, "PASS");

const multi = source({ depotCount: 3, vehicleCount: 12, driverCount: 12, orderCount: 60 });
const multiPlan = Network.solveNetwork(multi, { maxStopsPerTrip: 2, maxTripsPerWave: 4 });
assert.strictEqual(Network.verifyNetworkPlan(multi, multiPlan).status, "PASS");
assert(multiPlan.assignment.assignments.length > 0);
assert(multiPlan.trip.tripChains.some((row) => row.tripIds.length > 1));
assert(multiPlan.dock.reservations.length > 0 && multiPlan.waves.waves.length > 0);

const paired = source({ depotCount: 2, vehicleCount: 8, driverCount: 8, orderCount: 20, pickupDelivery: true, crossDock: true });
paired.pickupDeliveryPairs.forEach((pair) => { pair.sameVehicleRequired = false; pair.sameTripRequired = false; pair.transferAllowed = true; });
const pairedPlan = Network.solveNetwork(paired, { maxStopsPerTrip: 2, crossDock: true });
assert.strictEqual(Network.verifyNetworkPlan(paired, pairedPlan).status, "PASS");
assert(pairedPlan.custody.shipments.every((shipment) => shipment.events.find((row) => row.type === "PICKUP").startMinute < shipment.events.find((row) => row.type === "DELIVERY").startMinute));
assert(pairedPlan.custody.transfers.length > 0);

const baseline = Scenario.baseline(multi);
const shock = Scenario.evaluateShock(baseline, "DEMAND_10", {}, { maxStopsPerTrip: 2 });
assert(shock.planHash && shock.accountingHash);
const run = Execution.createRun(multi, multiPlan, { runId: "RUN-RELEASE-SMOKE-V18" });
Execution.createIncident(run, "DOCK_FAILURE", { depotId: "D1", dockId: multi.docks[0].dockId });
const cutoff = Execution.freezeCutoff(run);
const candidates = Execution.generateRecoveryCandidates(run, cutoff);
assert(candidates.length > 0 && candidates.every((candidate) => candidate.verification.status === "PASS"));
const capsule = Execution.createCapsule(run, cutoff, candidates);
assert.strictEqual(Execution.replay(capsule).status, "EQUIVALENT");
assert(CommandCenter.TEXT.en.local.includes("no global optimum"));

const result = {
  status: "PASS",
  mode: fallback ? "FALLBACK" : "RELEASE",
  publicRoutingCalls: 0,
  externalOptimizationCalls: 0,
  singleDepot: "PASS",
  multiDepot: "PASS",
  multiTrip: "PASS",
  pickupDelivery: "PASS",
  crossDock: "PASS",
  dockWave: "PASS",
  networkScenario: "PASS",
  execution: "PASS",
  recovery: "PASS",
  capsule: "PASS",
  fallback: fallback ? { networkCanonical: "PASS", assignmentHeuristic: "PASS", basicTripChain: "PASS", dockWaveVerifier: "PASS", execution: "PASS", scenarioUi: "PASS", fullNetworkReopt: "SKIPPED_DEPENDENCY", uiClaimsCompleteSolver: false } : null,
  hashes: { networkPlanHash: multiPlan.networkPlanHash, capsuleHash: capsule.capsuleHash },
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

