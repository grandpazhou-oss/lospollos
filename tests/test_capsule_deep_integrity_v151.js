#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Canonical = require("../canonical.js");
const Events = require("../domain-events-v15.js");
const Incidents = require("../incident-v15.js");
const Impact = require("../impact-analysis-v15.js");
const Recovery = require("../recovery-v15.js");
const Simulation = require("../simulation-store-v15.js");
const Matrix = require("../matrix-provider-v15.js");
const Capsule = require("../scenario-capsule-v15.js");
const contract = require("../shared/planning-contract-v13.json");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

Canonical.configure(contract);

async function expectCode(action, code) {
  try { await action(); } catch (caught) { assert.strictEqual(caught.code, code, caught.stack); return; }
  assert.fail(`Expected ${code}`);
}

function reseal(capsule) {
  capsule.identitySeal = Capsule.createIdentitySeal(capsule);
  capsule.capsuleHash = Capsule.computedCapsuleHash(capsule);
  return capsule;
}

async function main() {
  const fixture = buildFixture({ orderCount: 12, routeCount: 3, planSuffix: "CAP-DEEP", inputSuffix: "CAP-DEEP" });
  const baseIdentity = Canonical.scenarioIdentitySync(fixture.scenario);
  const baseScenario = { ...fixture.scenario, ...baseIdentity.scenario, canonicalScenario: baseIdentity.scenario, contentHash: baseIdentity.contentHash, inputHash: baseIdentity.inputHash };
  fixture.plan.inputHash = baseIdentity.inputHash;
  fixture.plan.contentHash = baseIdentity.contentHash;

  const incident = Incidents.createIncident({
    type: "ORDER_CANCELLED", baseInputHash: baseScenario.inputHash, basePlanHash: fixture.plan.planHash,
    logicalMinute: 0, affectedEntityIds: ["ORDER-012"], parameters: { orderId: "ORDER-012" },
  });
  const derived = Incidents.deriveScenario(baseScenario, incident).derivedScenario;
  const pinning = Impact.createPinningSnapshot(fixture.plan, 0);
  const matrixContext = await Matrix.createMatrixContext(Matrix.createHaversineProvider(), derived);
  const matrix = matrixContext.matrix;
  const engine = { id: "DEMO_HEURISTIC", version: "1.5.1", status: "VERIFIED" };
  const matrixRef = { id: matrixContext.provenance.providerId, version: matrixContext.provenance.providerVersion, matrixHash: matrix.matrixHash, status: "VERIFIED" };
  const generated = await Recovery.generateRecoveryCandidates({
    basePlan: fixture.plan, baseScenario, derivedScenario: derived, incidents: [incident], pinning,
    objectives: ["MINIMUM_CHANGE"], engine, matrixProvider: matrixRef, matrixContext,
  });
  const recovery = generated.candidates[0];
  assert.strictEqual(recovery.verification.status, "PASS");

  const store = Events.createEventStore({ clock: () => "2026-08-31T00:00:00.000Z" });
  const first = store.append("INCIDENT_INJECTED", {
    aggregateType: "INCIDENT", aggregateId: incident.incidentId, scenarioId: derived.scenarioId,
    inputHash: derived.inputHash, basePlanHash: fixture.plan.planHash, incidentHash: incident.incidentHash,
    source: "capsule-deep-test", logicalTime: 0, payload: { type: incident.type },
  });
  store.append("RECOVERY_CANDIDATE_VERIFIED", {
    aggregateType: "RECOVERY_PLAN", aggregateId: recovery.planHash, scenarioId: derived.scenarioId,
    inputHash: derived.inputHash, basePlanHash: fixture.plan.planHash, resultingPlanHash: recovery.planHash,
    incidentHash: incident.incidentHash, causationId: first.eventId, source: "capsule-deep-test", logicalTime: 1,
    payload: { status: "PASS", recoveryRequestHash: recovery.recoveryRequestHash },
  });
  const simulationHash = await Simulation.simulationIdentity(recovery.planHash, []);
  const capsule = Capsule.createCapsule({
    canonicalScenario: derived, plans: [fixture.plan], selectedPlanHash: fixture.plan.planHash,
    verifierResults: [{ planHash: fixture.plan.planHash, verification: fixture.plan.verification }],
    domainEvents: store.snapshot(), simulationState: { activePlanHash: recovery.planHash, activeEvents: [], simulationHash, simulationRevision: 0, operationLog: [], rejectedEvents: [] },
    incidents: [incident], recoveryCandidates: [recovery],
    engineProvenance: [engine], matrixProvenance: [matrixContext.provenance], dataClassification: "SYNTHETIC_DEMO",
  }, { clock: () => "2026-08-31T00:00:00.000Z" });

  let verifierCalls = 0;
  const verifyPlan = async () => { verifierCalls += 1; return { status: "PASS" }; };
  const valid = await Capsule.importCapsule(capsule, { verifyPlan });
  assert.strictEqual(valid.status, "PASS");
  assert.strictEqual(verifierCalls, capsule.plans.length);

  const adversaries = [
    ["canonical", "CAPSULE_CANONICAL_INPUT_HASH_MISMATCH", (value) => { value.canonicalScenario.orders[0].volume = "99.000"; }],
    ["event", "CAPSULE_EVENT_IDENTITY_INVALID", (value) => { value.domainEvents[0].payload.type = "TAMPERED"; }],
    ["event-chain", "CAPSULE_EVENT_CAUSATION_INVALID", (value) => {
      value.domainEvents[1].causationId = "EVT-NOT-PRESENT";
      value.domainEvents[1].eventHash = Events.computedEventHash(value.domainEvents[1]);
      value.domainEvents[1].eventId = Events.computedEventId(value.domainEvents[1]);
    }],
    ["incident", "CAPSULE_INCIDENT_INVALID", (value) => { value.incidents[0].parameters.orderId = "ORDER-001"; }],
    ["simulation", "CAPSULE_SIMULATION_HASH_MISMATCH", (value) => { value.simulationState.activeEvents = [{ eventId: "SIM-1", type: "ROAD_CLOSURE_SIMULATION", routeId: "R-1", orderId: "", vehicleId: "", stopIndex: 0, minutes: 0, source: "test", payload: {} }]; }],
    ["recovery-parent", "CAPSULE_RECOVERY_PARENT_UNKNOWN", (value) => { value.recoveryCandidates[0].parentPlanHash = `sha256:${"2".repeat(64)}`; }],
    ["recovery-plan", "CAPSULE_RECOVERY_PLAN_HASH_MISMATCH", (value) => { value.recoveryCandidates[0].routes[0].orderIds.reverse(); }],
    ["engine-provenance", "CAPSULE_RECOVERY_ENGINE_PROVENANCE_MISSING", (value) => { value.engineProvenance[0].version = "tampered"; }],
    ["matrix-provenance", "CAPSULE_RECOVERY_MATRIX_PROVENANCE_MISSING", (value) => { value.matrixProvenance[0].matrixHash = `sha256:${"3".repeat(64)}`; }],
  ];
  for (const [, code, mutate] of adversaries) {
    const value = clone(capsule); mutate(value); reseal(value);
    await expectCode(() => Capsule.importCapsule(value, { verifyPlan }), code);
  }
  await expectCode(() => Capsule.importCapsule(capsule, { verifyPlan: async () => ({ status: "FAIL" }) }), "CAPSULE_PLAN_VERIFICATION_FAILED");

  store.destroy();
  process.stdout.write(`${JSON.stringify({ status: "PASS", baselineImport: "PASS", adversarialInternalMutations: adversaries.length, verifierRerunFailureRejected: true, outerHashRecomputedForEveryMutation: true }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
