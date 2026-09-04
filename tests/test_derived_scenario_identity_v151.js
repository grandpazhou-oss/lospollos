#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");
const Canonical = require("../canonical.js");
const Incidents = require("../incident-v15.js");
const contract = require("../shared/planning-contract-v13.json");

Canonical.configure(contract);
const date = "2026-09-01";
const searchConfiguration = { firstSolutionStrategy: "parallel-cheapest-insertion", localSearchMetaheuristic: "guided-local-search", randomSeed: 13, logSearch: false, servicePolicy: "priority-score-then-assigned-count-then-business-objective" };

function source() {
  return {
    planningMode: "SINGLE_DAY", planningDate: date,
    depot: { id: "D1", name: "Depot", address: "Synthetic", lon: 121.1, lat: 31.1 },
    orders: [
      { id: "O1", code: "O1", name: "Stop 1", address: "A", date, lon: 121.101, lat: 31.101, count: 1, volume: 1, weight: 0, serviceMin: 5, twStart: "18:00", twEnd: "23:59", priority: "high", priorityWeight: 3, prioritySource: "mapped", orderType: "", requiredVehicleType: "" },
      { id: "O2", code: "O2", name: "Stop 2", address: "B", date, lon: 121.102, lat: 31.102, count: 1, volume: 1, weight: 0, serviceMin: 5, twStart: "18:00", twEnd: "23:59", priority: "normal", priorityWeight: 1, prioritySource: "mapped", orderType: "", requiredVehicleType: "" },
    ],
    vehicles: [{ id: "V1", name: "Vehicle 1", type: "van", availableDate: date, maxVolume: 10, maxWeight: 10, start: "18:00", end: "23:59", fixedCost: 100, perKmCost: 2, perMinuteCost: 0.5, perStopCost: 5, emissionFactor: 0.2, sourceVehicleId: "V1", isVirtual: false, enabled: true }],
    constraints: { singleTrip: true, maxWaitingMinutes: 90, workStart: "18:00", workEnd: "23:59", maxOrders: 500, maxSolveSeconds: 45, allowUnassigned: true, capacityScale: 1000, weightScale: 1000, maxStops: 500, maxRouteMinutes: 540, shiftExtensionMinutes: 0 },
    assumptions: { roadDistanceFactor: 1.35, averageSpeedKmh: 35, defaultServiceMin: 5, costModelVersion: contract.models.costModelVersion, emissionModelVersion: contract.models.emissionModelVersion, priorityMappingVersion: contract.priorityMapping.version, missingVehicleDatePolicy: "blank-means-daily", missingTimeWindowPolicy: contract.time.missingTimeWindowPolicy, overnightPolicy: contract.time.overnightPolicy, distanceModel: contract.distance.model, roadMetersRounding: contract.distance.roadMetersRounding, travelMinutesRounding: contract.distance.travelMinutesRounding, costMinuteBasis: contract.time.costMinuteBasis, defaultEmissionFactor: 0.2, lowUtilizationThreshold: contract.utilization.lowRouteThresholdPercent, balancedWeightUsedVehicles: 20, balancedWeightDistance: 20, balancedWeightCost: 20, balancedWeightCarbon: 15, balancedWeightLatestEnd: 15, balancedWeightUtilization: 10 },
  };
}

async function bodyFor(derived, claimedInputHash = derived.inputHash) {
  const request = await Canonical.requestIdentity(derived.inputHash, { objective: "distance", timeLimitSeconds: 1, engineRequested: "ortools", searchConfiguration });
  return {
    version: "v1.5.1-integrity-closure", contractVersion: contract.contractVersion, canonicalVersion: contract.canonicalVersion,
    requestId: "DERIVED-V151", requestSequence: 1, batchId: "DERIVED-V151", canonicalScenario: derived.canonicalScenario,
    claimedContentHash: derived.contentHash, claimedInputHash, claimedRequestHash: request.requestHash,
    objective: "distance", timeLimitSeconds: 1, engineRequested: "ortools", searchConfiguration,
  };
}

async function main() {
  const baseIdentity = Canonical.scenarioIdentitySync(source());
  const base = { ...baseIdentity.scenario, canonicalScenario: baseIdentity.scenario, scenarioId: "SCN-BASE", contentHash: baseIdentity.contentHash, inputHash: baseIdentity.inputHash, constraintsSnapshot: { ...baseIdentity.scenario.constraints }, assumptionsSnapshot: { ...baseIdentity.scenario.assumptions } };
  const incident = Incidents.createIncident({ type: "TIME_WINDOW_CHANGED", baseInputHash: base.inputHash, basePlanHash: `sha256:${"1".repeat(64)}`, logicalMinute: 1080, affectedEntityIds: ["O2"], parameters: { orderId: "O2", twStart: "19:00", twEnd: "22:00" } });
  const result = Incidents.deriveScenario(base, incident);
  const recomputed = Canonical.scenarioIdentitySync(result.derivedScenario);
  assert.strictEqual(result.derivedScenario.contentHash, recomputed.contentHash);
  assert.strictEqual(result.derivedInputHash, recomputed.inputHash);
  assert.deepStrictEqual(result.derivedScenario.canonicalScenario, recomputed.scenario);
  assert.notStrictEqual(result.derivedInputHash, base.inputHash);

  const python = spawnSync("python3", ["-c", "import json,sys; from optimizer.canonical_contract import scenario_identity; r=scenario_identity(json.load(sys.stdin)); print(json.dumps({'contentHash':r['contentHash'],'inputHash':r['inputHash']},separators=(',',':')))"], {
    cwd: path.resolve(__dirname, ".."), input: JSON.stringify(result.derivedScenario.canonicalScenario), encoding: "utf8",
  });
  assert.strictEqual(python.status, 0, python.stderr);
  const pythonIdentity = JSON.parse(python.stdout);
  assert.strictEqual(pythonIdentity.contentHash, result.derivedScenario.contentHash);
  assert.strictEqual(pythonIdentity.inputHash, result.derivedInputHash);

  const http = { executed: false };
  if (process.env.OPTIMIZER_URL) {
    const send = async (body) => {
      const response = await fetch(`${process.env.OPTIMIZER_URL}/optimize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const accepted = await send(await bodyFor(result.derivedScenario));
    const rejected = await send(await bodyFor(result.derivedScenario, `sha256:${"0".repeat(64)}`));
    assert.strictEqual(accepted.status, 200, JSON.stringify(accepted.body));
    assert.strictEqual(accepted.body.serverInputHash, result.derivedInputHash);
    assert.strictEqual(accepted.body.serverHashVerified, true);
    assert.strictEqual(rejected.status, 400, JSON.stringify(rejected.body));
    assert.strictEqual(rejected.body.error.code, "INPUT_HASH_MISMATCH");
    Object.assign(http, { executed: true, accepted: 200, fakeClaimedHash: 400 });
  }

  process.stdout.write(`${JSON.stringify({ status: "PASS", canonicalPipeline: "PASS", jsPythonParity: "PASS", http }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
