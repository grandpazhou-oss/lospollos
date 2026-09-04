#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const Capsule = require("../scenario-capsule-v15.js");
const DomainEvents = require("../domain-events-v15.js");
const Incidents = require("../incident-v15.js");
const Matrix = require("../matrix-provider-v15.js");
const Canonical = require("../canonical.js");
const Simulation = require("../simulation-store-v15.js");
const contract = require("../shared/planning-contract-v13.json");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

const checks = [];
function check(id, condition, detail = {}) { assert(condition, `${id}: ${JSON.stringify(detail)}`); checks.push({ id, status: "PASS", detail }); }

async function expectCode(action, code) {
  try { await action(); } catch (caught) { return caught.code === code ? caught : Promise.reject(caught); }
  throw new Error(`Expected ${code}`);
}

async function main() {
  const fixture = buildFixture({ orderCount: 12, routeCount: 3, planSuffix: "CAPSULE", inputSuffix: "CAPSULE" });
  Canonical.configure(contract);
  const identity = Canonical.scenarioIdentitySync(fixture.scenario);
  fixture.scenario = { ...fixture.scenario, ...identity.scenario, canonicalScenario: identity.scenario, contentHash: identity.contentHash, inputHash: identity.inputHash, inputFingerprint: identity.inputHash };
  fixture.plan.inputHash = identity.inputHash;
  fixture.plan.contentHash = identity.contentHash;
  fixture.scenario.meta = { synthetic: true };
  const eventStore = DomainEvents.createEventStore({ clock: () => "2026-08-31T00:00:00.000Z" });
  const opened = eventStore.append("SCENARIO_OPENED", {
    aggregateType: "SCENARIO", aggregateId: fixture.scenario.scenarioId, scenarioId: fixture.scenario.scenarioId,
    inputHash: fixture.scenario.inputHash, basePlanHash: fixture.plan.planHash, resultingPlanHash: fixture.plan.planHash,
    source: "capsule-test", logicalTime: 480, payload: { verification: "PASS" },
  });
  const incident = Incidents.createIncident({ type: "STOP_DELAY", baseInputHash: fixture.scenario.inputHash, basePlanHash: fixture.plan.planHash, logicalMinute: 535, affectedEntityIds: ["ORDER-004"], parameters: { orderId: "ORDER-004", delayMinutes: 30 } });
  const injected = eventStore.append("INCIDENT_INJECTED", {
    aggregateType: "INCIDENT", aggregateId: incident.incidentId, scenarioId: fixture.scenario.scenarioId,
    inputHash: fixture.scenario.inputHash, basePlanHash: fixture.plan.planHash, incidentHash: incident.incidentHash,
    causationId: opened.eventId, source: "capsule-test", logicalTime: 535, payload: { type: incident.type },
  });
  const simulationHash = await Simulation.simulationIdentity(fixture.plan.planHash, []);
  eventStore.append("RECOVERY_PLAN_APPLIED", {
    aggregateType: "RECOVERY_PLAN", aggregateId: fixture.plan.planHash, scenarioId: fixture.scenario.scenarioId,
    inputHash: fixture.scenario.inputHash, basePlanHash: fixture.plan.planHash, resultingPlanHash: fixture.plan.planHash,
    simulationHash, incidentHash: incident.incidentHash, causationId: injected.eventId,
    source: "capsule-test", logicalTime: 540, payload: { recoveryRequestHash: DomainEvents.hashValue({ test: "recovery-request" }) },
  });
  const matrix = await Matrix.createHaversineProvider({ clock: () => "2026-08-31T00:00:00.000Z" }).matrix({
    points: fixture.scenario.orders.slice(0, 3).map((order) => ({ id: order.id, lon: order.lon, lat: order.lat })),
    profile: "car", distanceUnit: "km", durationUnit: "minutes",
  });
  const simulationState = { activePlanHash: fixture.plan.planHash, simulationHash, activeEvents: [], simulationRevision: 0, operationLog: [], rejectedEvents: [] };
  const source = {
    canonicalScenario: fixture.scenario,
    plans: [fixture.plan],
    selectedPlanHash: fixture.plan.planHash,
    verifierResults: [{ planHash: fixture.plan.planHash, verification: fixture.plan.verification }],
    explanations: [{ type: "WHY_THIS_PLAN", claim: "Verifier-PASS synthetic candidate" }],
    domainEvents: eventStore.snapshot(),
    simulationState,
    incidents: [incident],
    recoveryCandidates: [],
    engineProvenance: [{ engineId: "LOCAL_HEURISTIC", version: "1.5", status: "VERIFIED" }],
    matrixProvenance: [matrix.provenance],
    dataClassification: "SYNTHETIC_DEMO",
    viewState: { mode: "replay", selectedPlanHash: fixture.plan.planHash, selectedVehicleId: "VEH-1", selectedOrderId: "ORDER-004", internalPanelState: "must-not-restore" },
  };
  const capsule = Capsule.createCapsule(source, { createdByVersion: "STCT-v1.5", clock: () => "2026-08-31T01:00:00.000Z" });
  const validation = Capsule.validateCapsuleStructure(capsule);
  check("T216", validation.status === "PASS" && capsule.schemaVersion === Capsule.SCHEMA_VERSION, validation);
  const capsuleAgain = Capsule.createCapsule(source, { createdByVersion: "STCT-v1.5", clock: () => "2026-08-31T02:00:00.000Z" });
  check("T217", capsule.capsuleHash === capsuleAgain.capsuleHash, { first: capsule.capsuleHash, second: capsuleAgain.capsuleHash });
  const differentCreatedAt = { ...clone(capsule), createdAt: "2030-01-01T00:00:00.000Z" };
  check("T218", Capsule.computedCapsuleHash(differentCreatedAt) === capsule.capsuleHash, { capsuleHash: capsule.capsuleHash });
  check("T219", capsule.canonicalScenario.inputHash === fixture.scenario.inputHash && capsule.canonicalScenario.orders.length === fixture.scenario.orders.length);
  check("T220", capsule.verifierResults.length === 1 && capsule.verifierResults[0].verification.status === "PASS", capsule.verifierResults);
  check("T221", capsule.engineProvenance.length === 1 && capsule.matrixProvenance[0].matrixHash === matrix.matrixHash, { engine: capsule.engineProvenance, matrix: capsule.matrixProvenance });
  check("T222", capsule.domainEvents.length === 3 && capsule.domainEvents[1].causationId === capsule.domainEvents[0].eventId && capsule.identitySeal.eventSequenceSeal, capsule.identitySeal);
  check("T223", capsule.incidents[0].incidentHash === incident.incidentHash && capsule.recoveryCandidates.length === 0);

  const functionError = await expectCode(async () => Capsule.createCapsule({ ...source, explanations: [() => "unsafe"] }), "CAPSULE_FORBIDDEN_VALUE_TYPE");
  check("T224", functionError.code === "CAPSULE_FORBIDDEN_VALUE_TYPE", { code: functionError.code });
  const scriptError = await expectCode(async () => Capsule.createCapsule({ ...source, explanations: [{ claim: "<script>alert(1)</script>" }] }), "CAPSULE_HTML_SCRIPT_FORBIDDEN");
  check("T225", scriptError.code === "CAPSULE_HTML_SCRIPT_FORBIDDEN", { code: scriptError.code });
  const pathError = await expectCode(async () => Capsule.createCapsule({ ...source, explanations: [{ evidence: "/Users/example/private/file.json" }] }), "CAPSULE_ABSOLUTE_PATH_FORBIDDEN");
  check("T226", pathError.code === "CAPSULE_ABSOLUTE_PATH_FORBIDDEN", { code: pathError.code });
  const excelError = await expectCode(async () => Capsule.createCapsule({ ...source, explanations: [{ source: "customer-raw.xlsx" }] }), "CAPSULE_RAW_EXCEL_FORBIDDEN");
  check("T227", excelError.code === "CAPSULE_RAW_EXCEL_FORBIDDEN", { code: excelError.code });
  const secretError = await expectCode(async () => Capsule.createCapsule({ ...source, explanations: [{ apiKey: "not-a-real-key" }] }), "CAPSULE_SECRET_KEY_FORBIDDEN");
  check("T228", secretError.code === "CAPSULE_SECRET_KEY_FORBIDDEN", { code: secretError.code });

  const inputTampered = clone(capsule); inputTampered.canonicalScenario.inputHash = `sha256:${"0".repeat(64)}`;
  const inputResult = Capsule.validateCapsuleStructure(inputTampered);
  check("T229", inputResult.status === "FAIL" && inputResult.error.code === "CAPSULE_INPUT_HASH_TAMPERED", inputResult);
  const planTampered = clone(capsule); planTampered.plans[0].planHash = `sha256:${"0".repeat(64)}`;
  const planResult = Capsule.validateCapsuleStructure(planTampered);
  check("T230", planResult.status === "FAIL" && planResult.error.code === "CAPSULE_PLAN_HASH_TAMPERED", planResult);
  const eventTampered = clone(capsule); eventTampered.domainEvents[1].sequence = 99;
  const eventResult = Capsule.validateCapsuleStructure(eventTampered);
  check("T231", eventResult.status === "FAIL" && eventResult.error.code === "CAPSULE_EVENT_SEQUENCE_TAMPERED", eventResult);
  const schemaTampered = clone(capsule); schemaTampered.schemaVersion = "stct-scenario-capsule-schema-v999";
  const schemaResult = Capsule.validateCapsuleStructure(schemaTampered);
  check("T232", schemaResult.status === "FAIL" && schemaResult.error.code === "CAPSULE_SCHEMA_VERSION_UNSUPPORTED", schemaResult);
  const sizeResult = Capsule.validateCapsuleStructure(Capsule.serializeCapsule(capsule), { limits: { bytes: 100 } });
  check("T233", sizeResult.status === "FAIL" && sizeResult.error.code === "CAPSULE_SIZE_LIMIT_EXCEEDED", sizeResult);
  const recordResult = Capsule.validateCapsuleStructure(capsule, { limits: { orders: 5 } });
  check("T234", recordResult.status === "FAIL" && recordResult.error.code === "CAPSULE_RECORD_LIMIT_EXCEEDED" && recordResult.error.detail.recordType === "orders", recordResult);

  let verifierCalls = 0; let providerCalls = 0; let applyCalls = 0;
  const imported = await Capsule.importCapsule(Capsule.serializeCapsule(capsule), {
    validateScenario: async (scenario) => ({ status: scenario.inputHash === fixture.scenario.inputHash ? "PASS" : "FAIL" }),
    verifyPlan: async (plan, scenario, context) => { verifierCalls += 1; return { ...clone(plan.verification), status: plan.inputHash === scenario.inputHash && context.externalProvidersEnabled === false ? "PASS" : "FAIL", rerun: true }; },
    matrixProvider: { matrix: async () => { providerCalls += 1; } },
    applyPlan: () => { applyCalls += 1; },
  });
  check("T235", imported.status === "PASS" && verifierCalls === capsule.plans.length && imported.verifierResults.every((row) => row.rerun), imported.verifierResults);
  check("T236", providerCalls === 0 && imported.externalProviderCalls === 0 && imported.externalProviderInvocationAllowed === false, imported);
  check("T237", applyCalls === 0 && imported.autoApplied === false && imported.selectedPlan === null, imported);
  check("T238", imported.restoredViewState.mode === "replay" && imported.restoredViewState.selectedVehicleId === "VEH-1" && !Object.hasOwn(imported.restoredViewState, "internalPanelState"), imported.restoredViewState);

  const randomRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stct-capsule-test-"));
  try {
    const input = path.join(randomRoot, "input.stct.json"); const output = path.join(randomRoot, "portable.stct-capsule.zip"); const extracted = path.join(randomRoot, "extracted");
    fs.writeFileSync(input, Capsule.serializeCapsule(capsule));
    const cli = spawnSync(process.execPath, [path.resolve(__dirname, "../scripts/build_capsule_zip_v15.js"), input, output], { cwd: randomRoot, encoding: "utf8" });
    assert.strictEqual(cli.status, 0, cli.stderr);
    fs.mkdirSync(extracted); const unzip = spawnSync("unzip", ["-q", output, "-d", extracted], { encoding: "utf8" }); assert.strictEqual(unzip.status, 0, unzip.stderr);
    const verify = spawnSync("shasum", ["-a", "256", "-c", "SHA256SUMS.txt"], { cwd: path.join(extracted, "stct-scenario-capsule"), encoding: "utf8" });
    check("T239", verify.status === 0 && fs.existsSync(path.join(extracted, "stct-scenario-capsule", "scenario.stct.json")), { cli: cli.stdout.trim(), verify: verify.stdout.trim() });
  } finally { fs.rmSync(randomRoot, { recursive: true, force: true }); }

  const seal = Capsule.capsuleSeal(capsule);
  check("T240", ["schema", "inputHash", "planHash", "simulationHash", "incidentHash", "capsuleHash", "verifier", "engine", "matrix", "dataClassification"].every((key) => Object.hasOwn(seal, key)) && seal.capsuleHash === capsule.capsuleHash && seal.matrix.matrixHash === matrix.matrixHash, seal);

  eventStore.destroy();
  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks.map((row) => row.id) }, null, 2)}\n`);
}

main().catch((caught) => { process.stderr.write(`${caught.stack || caught.message}\n`); process.exit(1); });
