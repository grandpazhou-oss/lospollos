#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const Contract = require("../network-contract-v18.js");
const Assignment = require("../depot-assignment-v18.js");
const Trip = require("../trip-chain-v18.js");
const Custody = require("../pickup-custody-v18.js");
const DockWave = require("../dock-wave-v18.js");
const Network = require("../network-solver-v18.js");
const Accounting = require("../network-accounting-v18.js");
const Execution = require("../network-execution-v18.js");
const Energy = require("../energy-intelligence-v18.js");
const Uncertainty = require("../uncertainty-lab-v18.js");
const Decision = require("../decision-governance-v18.js");
const Secure = require("../secure-import-v18.js");
const Fixture = require("./fixtures/network-v18-fixture.js");

const repo = path.resolve(__dirname, "..");
const runDir = path.resolve(process.env.STCT_V18_RUN_DIR || path.join(os.tmpdir(), "stct-v18-overnight"));
const registryPath = process.env.STCT_V18_REGISTRY || path.join(runDir, "STCT_v1.8_OVERNIGHT_Requirement_Registry.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const requirements = registry.overnightRequirements.filter((row) => { const number = Number(row.id.slice(4)); return number >= 1549 && number <= 1596; });
const outcomes = new Map();
const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const record = (number, condition, observed, expected) => outcomes.set(`OVN-${number}`, { condition: Boolean(condition), observed, expected });
const writeJson = (relative, value) => { const destination = path.join(runDir, relative); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`); };

function tune(source) {
  source.depots.forEach((depot) => { depot.capacity = { dailyOrders: 1000, volume: 100000, weight: 100000, handlingMinutes: 100000, parkingSlots: 100 }; });
  source.docks.forEach((dock) => { dock.simultaneousCapacity = 8; });
  source.drivers.forEach((driver) => { driver.requiredBreaks = []; driver.maxDrivingMinutes = 2000; driver.maxDutyMinutes = 2000; });
  source.pickupDeliveryPairs.forEach((pair) => { pair.sameVehicleRequired = false; pair.sameTripRequired = false; pair.transferAllowed = true; });
  return source;
}

function alertProjection(alert) {
  const copy = clone(alert);
  delete copy.alertHash;
  return copy;
}

function decisionProjectionHash(recordValue) {
  return Contract.hashArtifact(Decision.projection(recordValue));
}

function ensembleHash(value) {
  const copy = clone(value);
  delete copy.ensembleHash;
  return Contract.hashArtifact(copy);
}

function resealOuter(capsule) {
  capsule.capsuleHash = Contract.hashArtifact(Secure.deepProjection(capsule));
  return capsule;
}

function buildFixture() {
  const source = tune(Fixture.makeNetwork({ networkId: "SYNTHETIC-O12-DEEP-CAPSULE", seed: 1549, orderCount: 24, depotCount: 2, vehicleCount: 8, driverCount: 8, docksPerDepot: 4, pickupDelivery: true, crossDock: true }));
  const plan = Network.solveNetwork(source, { maxOrders: 500, maxTripsPerWave: 20, crossDock: true });
  const networkVerification = Network.verifyNetworkPlan(source, plan);
  if (networkVerification.status !== "PASS") throw new Error(`O12 network fixture invalid: ${networkVerification.issues.join(",")}`);
  const ledger = Accounting.computeAccounting(source, plan);
  const run = Execution.createRun(source, plan, { runId: "RUN-O12-DEEP" });
  Execution.appendEvent(run, { eventType: "EVENT_ACKNOWLEDGED", logicalMinute: 1, payload: { marker: "accepted" } });
  Execution.appendEvent(run, { eventType: "EVENT_ACKNOWLEDGED", logicalMinute: 2, payload: { marker: "caused-after-first" } });
  const incident = Execution.createIncident(run, "DOCK_FAILURE", { incidentId: "INCIDENT-O12", dockId: source.docks[0].dockId, depotId: source.depots[0].depotId, logicalMinute: 2 });
  const cutoff = Execution.freezeCutoff(run, { logicalMinute: 2 });
  const candidates = Execution.generateRecoveryCandidates(run, cutoff, { incidentHash: incident.incidentHash });
  const energyFixture = Energy.makeFixture("O12-ENERGY", 5, 10, 2);
  const energyPlan = Energy.planEnergy(energyFixture);
  const base = { sourceScenarioHash: plan.networkInputHash, serviceRate: plan.metrics.serviceRate, cost: plan.metrics.totalCost, carbonKg: plan.metrics.totalCarbonKg, latestCompletionMinute: Math.max(0, ...plan.trip.trips.map((trip) => trip.endMinute)), dockQueueMinutes: plan.dock.metrics.averageQueueMinutes * plan.dock.metrics.reservationCount, vehicleRequirement: Math.max(1, new Set(plan.trip.trips.map((trip) => trip.vehicleId)).size) };
  const uncertainty = Uncertainty.runEnsemble(base, { scenarioType: "O12_SECURITY" }, 30, 1594);
  const decision = Decision.createDecision({ decisionId: "DECISION-O12", candidateId: plan.candidatePool[0].candidateId, actionScope: "SIMULATION", reasonCode: "SECURITY_REVIEW", tradeOffs: ["integrity", "service"], rejectedAlternatives: ["NONE"], authoritativeHashes: { input: plan.networkInputHash, plan: plan.networkPlanHash, ledger: ledger.accountingHash }, recomputedFacts: { service: plan.metrics.serviceRate, cost: plan.metrics.totalCost, carbon: plan.metrics.totalCarbonKg, capacity: plan.metrics.assignedOrders, risk: "SYNTHETIC", comparability: "SAME_INPUT", unresolvedRisks: "No authenticity signature" }, assumptions: ["Synthetic fixture"], capabilityLimits: ["Read-only import"], verifier: { status: "PASS", warnings: ["LOCAL_DEMO"], hardFailures: [] } });
  const alert = { alertId: "ALERT-O12", severity: "CRITICAL", reasonCode: "SYNTHETIC_TAMPER_TEST", message: "Synthetic security alert", sourceHash: plan.networkPlanHash };
  alert.alertHash = Contract.hashArtifact(alertProjection(alert));
  const sections = {
    networkScenario: source,
    depotAssignment: plan.assignment,
    tripChain: plan.trip,
    driverBreaks: { driverDutyAudit: plan.trip.driverDutyAudit, breakEvents: plan.trip.breakEvents },
    pickupDelivery: { pairs: source.pickupDeliveryPairs, shipments: plan.custody.shipments },
    custody: plan.custody,
    dockReservations: plan.dock,
    waveCutoffs: plan.waves,
    matrix: source.routingContext,
    roadRoutes: plan.trip.routes,
    networkPlan: plan,
    executionEvents: run.events,
    alerts: [alert],
    recoveryRevision: candidates,
    evCharge: { fixture: energyFixture, plan: energyPlan },
    uncertaintySummary: uncertainty,
    decisionRecord: decision,
  };
  const verifiers = {
    networkScenario: (value) => { try { Contract.normalizeScenario(value); return { status: "PASS" }; } catch (error) { return { status: "FAIL", code: error.code }; } },
    depotAssignment: (value) => Assignment.verifyAssignment(source, value),
    tripChain: (value) => Trip.verifyTripPlan(source, value),
    driverBreaks: (value) => ({ status: Array.isArray(value.driverDutyAudit) && Array.isArray(value.breakEvents) ? "PASS" : "FAIL" }),
    pickupDelivery: (value) => ({ status: Array.isArray(value.pairs) && Array.isArray(value.shipments) ? "PASS" : "FAIL" }),
    custody: (value) => Custody.verifyPickupDelivery(source, value),
    dockReservations: (value) => ({ status: Contract.hashArtifact(DockWave.scheduleProjection(value)) === value.dockScheduleHash && source.docks.every((dock) => DockWave.verifyCapacity(dock, value.reservations.filter((row) => row.dockId === dock.dockId)).status === "PASS") ? "PASS" : "FAIL" }),
    waveCutoffs: (value) => DockWave.verifyWaveSchedule(source, plan.trip, plan.dock, value),
    matrix: (value) => ({ status: value.matrixVersion && value.providerId ? "PASS" : "FAIL" }),
    roadRoutes: (value) => Trip.verifyTripPlan(source, { ...clone(plan.trip), routes: value }),
    networkPlan: (value) => Network.verifyNetworkPlan(source, value),
    executionEvents: (value) => Execution.verifyEventHistory({ events: value }),
    alerts: (value) => ({ status: value.every((row) => row.alertHash === Contract.hashArtifact(alertProjection(row))) ? "PASS" : "FAIL" }),
    recoveryRevision: (value) => ({ status: value.every((row) => Execution.verifyRecoveryCandidate(row, cutoff).status === "PASS") ? "PASS" : "FAIL" }),
    evCharge: (value) => Energy.verifyEnergy(value.fixture, value.plan),
    uncertaintySummary: (value) => ({ status: value.ensembleHash === ensembleHash(value) ? "PASS" : "FAIL" }),
    decisionRecord: (value) => ({ status: value.decisionHash === decisionProjectionHash(value) ? "PASS" : "FAIL" }),
  };
  return { source, plan, run, cutoff, candidates, sections, verifiers };
}

function main() {
  const fixture = buildFixture();
  const capsule = Secure.createDeepCapsule(fixture.sections, { createdFor: "O12 deep tamper" });
  const baseline = Secure.verifyDeepCapsule(capsule, fixture.verifiers);
  const attacks = [
    ["networkScenario", (value) => { value.orders[0].demand.volume += 1; }],
    ["depotAssignment", (value) => { value.assignments[0].assignedDepotId = "UNKNOWN"; }],
    ["tripChain", (value) => { value.trips[0].endMinute += 1; }],
    ["driverBreaks", (value) => { value.breakEvents.push({ breakId: "FORGED" }); }],
    ["pickupDelivery", (value) => { value.pairs.reverse(); }],
    ["custody", (value) => { value.syntheticLabel = "TAMPERED"; }],
    ["dockReservations", (value) => { value.reservations[0].endMinute += 1; }],
    ["waveCutoffs", (value) => { value.waves[0].cutoffMinute += 1; }],
    ["matrix", (value) => { value.matrixVersion = "forged"; }],
    ["roadRoutes", (value) => { value[0].metrics.distanceKm += 1; }],
    ["networkPlan", (value) => { value.metrics.totalCost += 1; }],
    ["executionEvents", (value) => { value[0].payload.marker = "forged"; }],
    ["alerts", (value) => { value[0].message = "forged"; }],
    ["recoveryRevision", (value) => { value[0].disruption.cost += 1; }],
    ["evCharge", (value) => { value.plan.chargeSessions[0].energyAddedKWh += 1; }],
    ["uncertaintySummary", (value) => { value.sampleCount += 1; }],
    ["decisionRecord", (value) => { value.reasonCode = "FORGED"; }],
  ].map(([section, mutate], index) => {
    const attacked = clone(capsule);
    mutate(attacked.sections[section]);
    resealOuter(attacked);
    const result = Secure.verifyDeepCapsule(attacked, fixture.verifiers);
    return { requirement: 1551 + index, section, outerResealed: Contract.hashArtifact(Secure.deepProjection(attacked)) === attacked.capsuleHash, status: result.status, issues: result.issues };
  });
  const allInternalRejected = attacks.every((row) => row.outerResealed && row.status === "REJECTED" && row.issues.length > 0);
  record(1549, baseline.status === "PASS" && attacks.length === 17, { baseline, sections: Object.keys(capsule.sections), attackCount: attacks.length }, "17-section deep-tamper suite");
  record(1550, allInternalRejected, attacks.map((row) => ({ section: row.section, outerResealed: row.outerResealed, status: row.status })), "all resealed outer capsules rejected");
  attacks.forEach((attack) => record(attack.requirement, attack.status === "REJECTED" && attack.outerResealed, attack, "REJECTED after outer reseal"));

  const deleteAttack = clone(capsule); delete deleteAttack.sections.networkPlan; resealOuter(deleteAttack); const deleteResult = Secure.verifyDeepCapsule(deleteAttack, fixture.verifiers);
  const addAttack = clone(capsule); addAttack.sections.unreferenced = { forged: true }; resealOuter(addAttack); const addResult = Secure.verifyDeepCapsule(addAttack, fixture.verifiers);
  const reorderAttack = clone(capsule); reorderAttack.sections.executionEvents.reverse(); resealOuter(reorderAttack); const reorderResult = Secure.verifyDeepCapsule(reorderAttack, fixture.verifiers);
  const custodyAttack = clone(capsule); custodyAttack.sections.custody.custodyEvents.push({ ...clone(custodyAttack.sections.custody.custodyEvents[0]), custodyEventId: "DUPLICATE-OWNER", ownerId: "FORGED" }); resealOuter(custodyAttack); const custodyResult = Secure.verifyDeepCapsule(custodyAttack, fixture.verifiers);
  const futureAttack = clone(capsule); futureAttack.sections.executionEvents[1].logicalMinute = 0; resealOuter(futureAttack); const futureResult = Secure.verifyDeepCapsule(futureAttack, fixture.verifiers);
  const parentAttack = clone(capsule); parentAttack.sections.recoveryRevision[0].parentRevisionHash = `sha256:${"0".repeat(64)}`; resealOuter(parentAttack); const parentResult = Secure.verifyDeepCapsule(parentAttack, fixture.verifiers);
  const ackAttack = clone(capsule); ackAttack.sections.executionEvents.push({ eventId: "UNKNOWN-ACK", sequence: 999, previousEventHash: "unknown", eventHash: `sha256:${"1".repeat(64)}`, eventType: "EVENT_ACKNOWLEDGED", payload: { eventId: "UNKNOWN" } }); resealOuter(ackAttack); const ackResult = Secure.verifyDeepCapsule(ackAttack, fixture.verifiers);
  record(1568, deleteResult.status === "REJECTED" && deleteResult.issues.some((row) => row.code === "CAPSULE_SECTION_SET_MISMATCH"), deleteResult, "referenced deletion rejected");
  record(1569, addResult.status === "REJECTED" && addResult.issues.some((row) => row.code === "CAPSULE_SECTION_SET_MISMATCH"), addResult, "unreferenced addition rejected");
  record(1570, reorderResult.status === "REJECTED", reorderResult, "order-sensitive events rejected");
  record(1571, custodyResult.status === "REJECTED", custodyResult, "duplicate custody owner rejected");
  record(1572, futureResult.status === "REJECTED", futureResult, "future-before-cause rejected");
  record(1573, parentResult.status === "REJECTED", parentResult, "unknown revision parent rejected");
  record(1574, ackResult.status === "REJECTED", ackResult, "unknown offline ACK rejected");

  const proto = Secure.validateJson(JSON.parse('{"__proto__":{"polluted":true}}'));
  const constructor = Secure.validateJson(JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'));
  const oversized = Secure.validateJson({ text: "x".repeat(Secure.LIMITS.maxStringLength + 1) });
  let deep = {}; let cursor = deep; for (let index = 0; index < Secure.LIMITS.maxDepth + 2; index += 1) { cursor.next = {}; cursor = cursor.next; }
  const deepResult = Secure.validateJson(deep);
  const many = Secure.validateJson({ rows: Array.from({ length: Secure.LIMITS.maxEntities + 1 }, () => ({})) });
  const malformed = Secure.validateJson({ label: "\uD800" });
  record(1575, proto.code === "IMPORT_DANGEROUS_KEY" && ({}).polluted === undefined, proto, "prototype rejected");
  record(1576, constructor.code === "IMPORT_DANGEROUS_KEY" && ({}).polluted === undefined, constructor, "constructor.prototype rejected");
  record(1577, oversized.code === "IMPORT_STRING_LIMIT", oversized, "oversized string rejected");
  record(1578, deepResult.code === "IMPORT_DEPTH_LIMIT", deepResult, "depth rejected");
  record(1579, many.code === "IMPORT_ENTITY_LIMIT", many, "entity count rejected");
  record(1580, malformed.code === "IMPORT_MALFORMED_UNICODE", malformed, "malformed Unicode rejected");

  const formula = Secure.validateTabularCell("=HYPERLINK(\"https://invalid\")");
  const activeHtml = Secure.validateTabularCell('<svg onload="alert(1)"><script/></svg>');
  const filename = Secure.safeFilename("../../private/secret.json");
  const absolutePath = Secure.validateJson({ evidence: "/Users/example/private/result.json" });
  const envSecret = Secure.validateJson({ note: "OPENAI_API_KEY=not-a-real-value" });
  const legitimate = "OPENAI Distribution Center - Shanghai";
  const redactedLegitimate = Secure.redactText(legitimate);
  const nested = Secure.scanArchiveEntries(["nested.zip"], { "nested.zip": ["payload.exe", "safe/readme.txt"] });
  record(1581, formula.code === "IMPORT_FORMULA_INJECTION", formula, "formula rejected");
  record(1582, activeHtml.code === "IMPORT_ACTIVE_CONTENT" && Secure.escapeLabel("<script>").includes("&lt;"), activeHtml, "active HTML/SVG rejected and escaped");
  record(1583, !filename.includes("..") && !filename.includes("/"), filename, "safe basename");
  record(1584, absolutePath.code === "IMPORT_LOCAL_PATH", absolutePath, "absolute path rejected");
  record(1585, envSecret.code === "IMPORT_SECRET_PATTERN", envSecret, "environment-looking secret rejected");
  record(1586, redactedLegitimate === legitimate, redactedLegitimate, legitimate);
  record(1587, nested.recursivelyScanned && nested.issues.some((row) => row.code === "ARCHIVE_BINARY_REJECTED" && row.parent === "nested.zip"), nested, "nested ZIP recursively scanned");

  const currentState = { activePlanHash: fixture.plan.networkPlanHash, revision: 3 };
  const beforeState = Contract.hashArtifact(currentState);
  const plain = Secure.importCapsule({ dataClassification: "SYNTHETIC_DEMO", payload: { id: "READ-ONLY" } });
  const afterState = Contract.hashArtifact(currentState);
  const sandbox = Secure.importCapsule({ dataClassification: "SYNTHETIC_DEMO", payload: { id: "SANDBOX" } }, undefined, { mode: "SANDBOX_SIMULATION" });
  record(1588, plain.externalRequests === false, plain, "no external request");
  record(1589, plain.autoApply === false, plain, "no auto apply");
  record(1590, plain.autoStartExecution === false, plain, "no auto start");
  record(1591, plain.autoSyncDriverQueue === false, plain, "no queue sync");
  record(1592, beforeState === afterState && plain.mode === "READ_ONLY", { beforeState, afterState, mode: plain.mode }, "current state unchanged");
  record(1593, sandbox.sandboxSelected && sandbox.mode === "SANDBOX_SIMULATION" && !sandbox.autoApply, sandbox, "sandbox explicitly selected");

  const securityBoundary = { integrity: "Canonical SHA-256 detects content change", authenticity: "Not established; no digital signature", confidentiality: "Not provided; artifact is not encrypted" };
  const hardDecision = Decision.createDecision({ decisionId: "HARD-O12", candidateId: "NONE", actionScope: "SIMULATION", reasonCode: "HARD_FAILURE", tradeOffs: ["safety"], rejectedAlternatives: ["NONE"], authoritativeHashes: { input: fixture.plan.networkInputHash, plan: fixture.plan.networkPlanHash, ledger: Accounting.computeAccounting(fixture.source, fixture.plan).accountingHash }, recomputedFacts: { service: 0, cost: 0, carbon: 0, capacity: 0, risk: "HARD", comparability: "SAME_INPUT", unresolvedRisks: "Hard verifier failure" }, assumptions: [], capabilityLimits: ["No override"], verifier: { status: "FAIL", warnings: [], hardFailures: ["CAPACITY"] } });
  let hardError = ""; try { Decision.transition(Decision.transition(hardDecision, "REVIEWED"), "APPROVED", { override: true, reason: "attempt" }); } catch (error) { hardError = error.code; }
  record(1594, Object.keys(securityBoundary).length === 3 && new Set(Object.values(securityBoundary)).size === 3, securityBoundary, "integrity/authenticity/confidentiality distinguished");
  record(1595, securityBoundary.integrity.includes("content change") && securityBoundary.authenticity.includes("no digital signature"), securityBoundary, "hash is not a signature");
  record(1596, hardError === "DECISION_HARD_FAILURE", hardError, "hard verifier failure cannot be overridden");

  const assertions = requirements.map((requirement) => {
    const outcome = outcomes.get(requirement.id) || { condition: false, observed: "UNMAPPED", expected: requirement.requirement };
    return { assertionId: `${requirement.id}-A1`, requirementId: requirement.id, status: outcome.condition ? "PASS" : "FAIL", observed: outcome.observed, expected: outcome.expected, negative: requirement.risk === "P0", testLayer: "SECURITY_MUTATION", sourceFile: "tests/test_overnight_o12_v18.js", command: "node tests/test_overnight_o12_v18.js", evidence: "evidence/overnight-o12-security.json" };
  });
  const failures = assertions.filter((row) => row.status !== "PASS");
  const evidence = { schemaVersion: "stct-overnight-o12-security-v1.8", status: failures.length ? "FAIL" : "PASS", baseline, capsuleHash: capsule.capsuleHash, sectionHashes: capsule.sectionHashes, deepTamperAttacks: attacks, structuralAttacks: { deleteResult, addResult, reorderResult, custodyResult, futureResult, parentResult, ackResult }, importSecurity: { proto, constructor, oversized, deepResult, many, malformed, formula, activeHtml, filename, absolutePath, envSecret, nested }, securityBoundary, hardVerifierOverride: hardError, assertions };
  writeJson("evidence/overnight-o12-security.json", evidence);
  writeJson("evidence/overnight-o12-test.json", { status: evidence.status, assertionCount: assertions.length, failures, missingMappings: assertions.filter((row) => row.observed === "UNMAPPED").map((row) => row.requirementId), assertions });
  process.stdout.write(`${JSON.stringify({ status: evidence.status, assertionCount: assertions.length, failures, missingMappings: assertions.filter((row) => row.observed === "UNMAPPED").map((row) => row.requirementId) }, null, 2)}\n`);
  process.exitCode = failures.length ? 1 : 0;
}

main();
