#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
global.window = { crypto: globalThis.crypto };
vm.runInThisContext(fs.readFileSync(path.join(root, "canonical.js"), "utf8"), { filename: "canonical.js" });
window.STCTCanonical.configure(JSON.parse(fs.readFileSync(path.join(root, "shared", "planning-contract-v13.json"), "utf8")));
vm.runInThisContext(fs.readFileSync(path.join(root, "verifier.js"), "utf8"), { filename: "verifier.js" });
const contract = window.STCTCanonical.getContract();

async function main() {
  const date = "2026-05-01";
  const scenarioSource = {
    planningMode: "SINGLE_DAY", planningDate: date,
    depot: { id: "D1", name: "Depot", address: "D", lon: 0, lat: 0 },
    orders: [
      { id: "O1", code: "O1", name: "O1", address: "A", date, lon: 0.001, lat: 0, count: 1, volume: 1, weight: 1, serviceMin: 0, twStart: "09:00", twEnd: "18:00", priority: "high", priorityWeight: 3, prioritySource: "mapped", orderType: "", requiredVehicleType: "" },
      { id: "O2", code: "O2", name: "O2", address: "B", date, lon: 0.002, lat: 0, count: 1, volume: 1, weight: 1, serviceMin: 0, twStart: "09:00", twEnd: "18:00", priority: "normal", priorityWeight: 1, prioritySource: "mapped", orderType: "", requiredVehicleType: "" },
    ],
    vehicles: [{ id: "V1", name: "V1", type: "van", availableDate: date, maxVolume: 10, maxWeight: 10, start: "09:00", end: "18:00", fixedCost: 100, perKmCost: 2, perMinuteCost: 0.5, perStopCost: 5, emissionFactor: 0.2, sourceVehicleId: "V1", isVirtual: false, enabled: true }],
    constraints: { singleTrip: true, maxWaitingMinutes: 90, workStart: "09:00", workEnd: "18:00", maxOrders: 500, maxSolveSeconds: 45, allowUnassigned: true, capacityScale: 1000, weightScale: 1000, maxStops: 500, maxRouteMinutes: 540, shiftExtensionMinutes: 0 },
    assumptions: { roadDistanceFactor: 1, averageSpeedKmh: 60, defaultServiceMin: 0, costModelVersion: "stct-cost-v1", emissionModelVersion: "stct-emission-v1", priorityMappingVersion: "priority-map-v1", missingVehicleDatePolicy: "blank-means-daily", missingTimeWindowPolicy: "reject-order", overnightPolicy: "end-before-start-means-next-day", distanceModel: "haversine-road-factor", roadMetersRounding: "half-up", travelMinutesRounding: "ceil", costMinuteBasis: "driving", defaultEmissionFactor: 0.2, lowUtilizationThreshold: 35, balancedWeightUsedVehicles: 20, balancedWeightDistance: 20, balancedWeightCost: 20, balancedWeightCarbon: 15, balancedWeightLatestEnd: 15, balancedWeightUtilization: 10 },
  };
  const identity = await window.STCTCanonical.scenarioIdentity(scenarioSource);
  const searchConfiguration = { firstSolutionStrategy: "parallel-cheapest-insertion", localSearchMetaheuristic: "guided-local-search", randomSeed: 13, logSearch: false, servicePolicy: "priority-score-then-assigned-count-then-business-objective" };
  const requestIdentity = await window.STCTCanonical.requestIdentity(identity.inputHash, { objective: "distance", timeLimitSeconds: 1, engineRequested: "ortools", searchConfiguration });
  const body = {
    version: "v1.4-trust-closure-mission-control", contractVersion: contract.contractVersion, canonicalVersion: contract.canonicalVersion,
    requestId: "REQ-CROSS-PARITY", requestSequence: 1, canonicalScenario: identity.scenario,
    claimedContentHash: identity.contentHash, claimedInputHash: identity.inputHash, claimedRequestHash: requestIdentity.requestHash,
    objective: "distance", timeLimitSeconds: 1, engineRequested: "ortools", searchConfiguration,
  };
  const response = await fetch(`${process.env.OPTIMIZER_URL || "http://127.0.0.1:19127"}/optimize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.strictEqual(response.status, 200);
  const envelope = await response.json();
  const plan = envelope.plan;
  const scenario = { ...identity.scenario, scenarioId: plan.scenarioId, contentHash: identity.contentHash, inputHash: identity.inputHash };
  const verification = await window.STCTVerifier.verify(plan, scenario);
  assert.strictEqual(plan.engine, "OR-Tools");
  assert.strictEqual(plan.serverHashVerified, true);
  assert.strictEqual(verification.status, "PASS", JSON.stringify(verification.hardViolations));
  for (const field of ["assigned", "unassigned", "blocked", "servicePriorityScore", "usedVehicles", "roadMeters", "estimatedRoadKm", "latestEndMinutes", "totalCost", "totalCO2", "utilizationScore"]) {
    assert.strictEqual(verification.recomputedMetrics[field], plan.reportedMetrics[field], field);
  }
  if (process.env.STCT_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.STCT_EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.STCT_EVIDENCE_DIR, "representative-optimize-request.json"), `${JSON.stringify(body, null, 2)}\n`);
    fs.writeFileSync(path.join(process.env.STCT_EVIDENCE_DIR, "representative-optimize-response.json"), `${JSON.stringify(envelope, null, 2)}\n`);
    fs.writeFileSync(path.join(process.env.STCT_EVIDENCE_DIR, "representative-verification.json"), `${JSON.stringify(verification, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ status: "PASS", tests: 5, inputHash: plan.inputHash, requestHash: plan.requestHash, planHash: plan.planHash, actualOrtoolsVersion: plan.meta.actualEngineVersion, verifierStatus: verification.status }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
