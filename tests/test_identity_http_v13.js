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
const contract = window.STCTCanonical.getContract();
const baseUrl = process.env.OPTIMIZER_URL || "http://127.0.0.1:19129";
const date = "2026-05-01";
const searchConfiguration = { firstSolutionStrategy: "parallel-cheapest-insertion", localSearchMetaheuristic: "guided-local-search", randomSeed: 13, logSearch: false, servicePolicy: "priority-score-then-assigned-count-then-business-objective" };

function source() {
  return {
    planningMode: "SINGLE_DAY", planningDate: date,
    depot: { id: "D1", name: "Depot", address: "D", lon: 121.1, lat: 31.1 },
    orders: [{ id: "O1", code: "O1", name: "O1", address: "A", date, lon: 121.101, lat: 31.101, count: 1, volume: 1, weight: 1, serviceMin: 1, twStart: "09:00", twEnd: "18:00", priority: "high", priorityWeight: 3, prioritySource: "mapped", orderType: "", requiredVehicleType: "" }],
    vehicles: [{ id: "V1", name: "V1", type: "van", availableDate: date, maxVolume: 10, maxWeight: 10, start: "09:00", end: "18:00", fixedCost: 100, perKmCost: 2, perMinuteCost: 0.5, perStopCost: 5, emissionFactor: 0.2, sourceVehicleId: "V1", isVirtual: false, enabled: true }],
    constraints: { singleTrip: true, maxWaitingMinutes: 90, workStart: "09:00", workEnd: "18:00", maxOrders: 500, maxSolveSeconds: 45, allowUnassigned: true, capacityScale: 1000, weightScale: 1000, maxStops: 500, maxRouteMinutes: 540, shiftExtensionMinutes: 0 },
    assumptions: { roadDistanceFactor: 1.35, averageSpeedKmh: 35, defaultServiceMin: 1, costModelVersion: contract.models.costModelVersion, emissionModelVersion: contract.models.emissionModelVersion, priorityMappingVersion: contract.priorityMapping.version, missingVehicleDatePolicy: "blank-means-daily", missingTimeWindowPolicy: contract.time.missingTimeWindowPolicy, overnightPolicy: contract.time.overnightPolicy, distanceModel: contract.distance.model, roadMetersRounding: contract.distance.roadMetersRounding, travelMinutesRounding: contract.distance.travelMinutesRounding, costMinuteBasis: contract.time.costMinuteBasis, defaultEmissionFactor: 0.2, lowUtilizationThreshold: contract.utilization.lowRouteThresholdPercent, balancedWeightUsedVehicles: 20, balancedWeightDistance: 20, balancedWeightCost: 20, balancedWeightCarbon: 15, balancedWeightLatestEnd: 15, balancedWeightUtilization: 10 },
  };
}

async function makeRequest(scenarioSource, objective, batchId, claimedInputHash) {
  const identity = await window.STCTCanonical.scenarioIdentity(scenarioSource);
  const requestIdentity = await window.STCTCanonical.requestIdentity(identity.inputHash, { objective, timeLimitSeconds: 1, engineRequested: "ortools", searchConfiguration });
  return {
    identity,
    body: {
      version: "v1.4-trust-closure-mission-control", contractVersion: contract.contractVersion, canonicalVersion: contract.canonicalVersion,
      requestId: `IDENTITY-${batchId}-${objective}`, requestSequence: 1, batchId, canonicalScenario: identity.scenario,
      claimedContentHash: identity.contentHash, claimedInputHash: claimedInputHash || identity.inputHash, claimedRequestHash: requestIdentity.requestHash,
      objective, timeLimitSeconds: 1, engineRequested: "ortools", searchConfiguration,
    },
    requestHash: requestIdentity.requestHash,
  };
}

async function send(entry) {
  const response = await fetch(`${baseUrl}/optimize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entry.body) });
  return { httpStatus: response.status, body: await response.json() };
}

async function main() {
  const base = source();
  const batchA = await makeRequest(base, "distance", "BATCH-A");
  const batchB = await makeRequest(base, "distance", "BATCH-B");
  const lonSource = source(); lonSource.orders[0].lon += 10;
  const volumeSource = source(); volumeSource.orders[0].volume = 9;
  const lon = await makeRequest(lonSource, "distance", "BATCH-A");
  const volume = await makeRequest(volumeSource, "distance", "BATCH-A");
  const cost = await makeRequest(base, "cost", "BATCH-A");
  const fake = await makeRequest(base, "distance", "BATCH-FAKE", `sha256:${"0".repeat(64)}`);
  const responses = {};
  for (const [name, request] of Object.entries({ batchA, batchB, lon, volume, cost, fake })) responses[name] = await send(request);

  assert.strictEqual(batchA.identity.inputHash, batchB.identity.inputHash);
  assert.notStrictEqual(batchA.identity.inputHash, lon.identity.inputHash);
  assert.notStrictEqual(batchA.identity.inputHash, volume.identity.inputHash);
  assert.strictEqual(batchA.identity.inputHash, cost.identity.inputHash);
  assert.notStrictEqual(batchA.requestHash, cost.requestHash);
  for (const name of ["batchA", "batchB", "lon", "volume", "cost"]) {
    assert.strictEqual(responses[name].httpStatus, 200);
    assert.strictEqual(responses[name].body.serverInputHash, ({ batchA, batchB, lon, volume, cost })[name].identity.inputHash);
    assert.strictEqual(responses[name].body.serverHashVerified, true);
  }
  assert.strictEqual(responses.fake.httpStatus, 400);
  assert.strictEqual(responses.fake.body.error.code, "INPUT_HASH_MISMATCH");

  const result = {
    status: "PASS",
    tests: 10,
    cases: [
      { case: "Same data, BATCH-A", clientHash: batchA.identity.inputHash, serverHash: responses.batchA.body.serverInputHash, expected: "same", result: "PASS" },
      { case: "Same data, BATCH-B", clientHash: batchB.identity.inputHash, serverHash: responses.batchB.body.serverInputHash, expected: "same", result: "PASS" },
      { case: "lon mutation", clientHash: lon.identity.inputHash, serverHash: responses.lon.body.serverInputHash, expected: "different", result: "PASS" },
      { case: "volume mutation", clientHash: volume.identity.inputHash, serverHash: responses.volume.body.serverInputHash, expected: "different", result: "PASS" },
      { case: "objective change", clientHash: cost.identity.inputHash, serverHash: responses.cost.body.serverInputHash, requestHash: cost.requestHash, expected: "input same / request different", result: "PASS" },
      { case: "fake claimed hash", clientHash: fake.body.claimedInputHash, serverHash: responses.fake.body.error.details?.expected || null, httpStatus: responses.fake.httpStatus, errorCode: responses.fake.body.error.code, expected: "reject", result: "PASS" },
    ],
  };
  if (process.env.STCT_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.STCT_EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.STCT_EVIDENCE_DIR, "identity-http-requests.json"), `${JSON.stringify(Object.fromEntries(Object.entries({ batchA, batchB, lon, volume, cost, fake }).map(([key, value]) => [key, value.body])), null, 2)}\n`);
    fs.writeFileSync(path.join(process.env.STCT_EVIDENCE_DIR, "identity-http-responses.json"), `${JSON.stringify(responses, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
