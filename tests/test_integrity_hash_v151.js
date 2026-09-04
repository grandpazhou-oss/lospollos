#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const Integrity = require("../integrity-hash-v151.js");
const Events = require("../domain-events-v15.js");
const Incidents = require("../incident-v15.js");
const Impact = require("../impact-analysis-v15.js");
const Recovery = require("../recovery-v15.js");
const Matrix = require("../matrix-provider-v15.js");
const Capsule = require("../scenario-capsule-v15.js");
const Zones = require("../service-zone-v15.js");
const { buildFixture } = require("./experience_fixture_v14.js");

const SHA256 = /^sha256:[0-9a-f]{64}$/;
function isSha(name, value) { assert(SHA256.test(value), `${name}: ${value}`); }

async function main() {
  assert.strictEqual(Integrity.sha256Text("abc"), `sha256:${crypto.createHash("sha256").update("abc").digest("hex")}`);
  assert.strictEqual(Integrity.hashValue({ b: "e\u0301", a: -0 }), Integrity.hashValue({ a: 0, b: "é" }));
  assert.throws(() => Integrity.hashValue({ invalid: Infinity }), (caught) => caught.code === "NON_FINITE_CANONICAL_NUMBER");

  const fixture = buildFixture({ orderCount: 12, routeCount: 3, planSuffix: "HASH151", inputSuffix: "HASH151" });
  const store = Events.createEventStore({ clock: () => "2026-08-31T00:00:00.000Z" });
  const event = store.append("SCENARIO_OPENED", {
    aggregateType: "SCENARIO", aggregateId: fixture.scenario.scenarioId, scenarioId: fixture.scenario.scenarioId,
    inputHash: fixture.scenario.inputHash, basePlanHash: fixture.plan.planHash, resultingPlanHash: fixture.plan.planHash,
    source: "integrity-v151-test", logicalTime: 0, payload: {},
  });
  isSha("eventHash", event.eventHash);
  isSha("eventStreamHash", store.eventStreamHash());

  const incident = Incidents.createIncident({
    type: "ORDER_CANCELLED", baseInputHash: fixture.scenario.inputHash, basePlanHash: fixture.plan.planHash,
    logicalMinute: 0, affectedEntityIds: [fixture.scenario.orders[0].id], parameters: { orderId: fixture.scenario.orders[0].id },
  });
  isSha("incidentHash", incident.incidentHash);
  const derived = Incidents.deriveScenario(fixture.scenario, incident);
  const pinning = Impact.createPinningSnapshot(fixture.plan, 0);
  isSha("pinningHash", pinning.pinningHash);
  const request = Recovery.createRecoveryRequest({
    basePlanHash: fixture.plan.planHash, derivedInputHash: derived.derivedInputHash, incidentHash: incident.incidentHash,
    objective: "MINIMUM_CHANGE", pinningSnapshot: pinning,
  });
  isSha("recoveryRequestHash", request.recoveryRequestHash);
  const generated = await Recovery.generateRecoveryCandidates({
    basePlan: fixture.plan, baseScenario: fixture.scenario, derivedScenario: derived.derivedScenario,
    incidents: [incident], pinning, objectives: ["MINIMUM_CHANGE"],
  });
  assert.strictEqual(generated.candidates.length, 1);
  isSha("recoveryPlanHash", generated.candidates[0].planHash);

  const matrix = await Matrix.createHaversineProvider().matrix({
    points: [fixture.scenario.depot, ...fixture.scenario.orders.slice(0, 2)],
    profile: "car", distanceUnit: "km", durationUnit: "minutes",
  });
  isSha("matrixHash", matrix.matrixHash);
  const python = spawnSync("python3", ["-c", "import json,sys; from optimizer.matrix_contract import computed_matrix_hash; print(computed_matrix_hash(json.load(sys.stdin)))"], {
    cwd: require("path").resolve(__dirname, ".."), input: JSON.stringify(matrix), encoding: "utf8",
  });
  assert.strictEqual(python.status, 0, python.stderr);
  assert.strictEqual(python.stdout.trim(), matrix.matrixHash, "JS/Python matrix hash drift");

  const zones = Zones.createSyntheticZones({ scenario: fixture.scenario });
  isSha("serviceZoneHash", zones.metadata.serviceZoneHash);
  assert.strictEqual(zones.metadata.zoneHash, zones.metadata.serviceZoneHash);

  const simulationHash = Integrity.hashValue({ activePlanHash: fixture.plan.planHash, revision: 0 });
  const capsule = Capsule.createCapsule({
    canonicalScenario: fixture.scenario, plans: [fixture.plan], selectedPlanHash: fixture.plan.planHash,
    domainEvents: store.snapshot(), simulationState: { activePlanHash: fixture.plan.planHash, simulationHash, activeEvents: [], simulationRevision: 0 },
    incidents: [incident], recoveryCandidates: generated.candidates,
    engineProvenance: [{ engineId: "DEMO_HEURISTIC", version: "1.5.1", status: "VERIFIED" }],
    matrixProvenance: [matrix.provenance], dataClassification: "SYNTHETIC_DEMO",
  }, { clock: () => "2026-08-31T00:00:00.000Z" });
  isSha("capsuleHash", capsule.capsuleHash);

  store.destroy();
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    identities: ["eventHash", "eventStreamHash", "incidentHash", "pinningHash", "recoveryRequestHash", "recoveryPlanHash", "matrixHash", "capsuleHash", "serviceZoneHash"],
    matrixCrossRuntime: "PASS",
  }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
