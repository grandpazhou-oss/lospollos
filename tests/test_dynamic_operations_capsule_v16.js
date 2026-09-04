#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Integrity = require("../integrity-hash-v151.js");
const Providers = require("../routing-provider-registry-v16.js");
const Fixture = require("../road-network-fixture-v16.js");
const Twin = require("../execution-twin-v16.js");
const Stores = require("../execution-store-v16.js");
const Alerts = require("../operations-alerts-v16.js");
const Analytics = require("../plan-vs-actual-v16.js");
const Queue = require("../offline-queue-v16.js");
const Capsule = require("../dynamic-operations-capsule-v16.js");
const LegacyCapsule = require("../scenario-capsule-v15.js");
const DomainEvents = require("../domain-events-v15.js");
const Incidents = require("../incident-v15.js");
const LegacyMatrix = require("../matrix-provider-v15.js");
const Canonical = require("../canonical.js");
const Simulation = require("../simulation-store-v15.js");
const contract = require("../shared/planning-contract-v13.json");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

const checks = [];
function check(id, condition, detail = {}) { assert(condition, `${id}: ${JSON.stringify(detail)}`); checks.push({ id, status: "PASS", detail }); }
function throwsCode(action, code) { try { action(); } catch (error) { return error.code === code; } return false; }
function reseal(capsule, sectionName) { capsule.sections[sectionName].payloadHash = Integrity.hashValue(capsule.sections[sectionName].payload); capsule.capsuleHash = Capsule.computedCapsuleHash(capsule); return capsule; }
function tamperAudit(capsule, sectionName, mutate) { const value = structuredClone(capsule); mutate(value.sections[sectionName].payload); reseal(value, sectionName); return Capsule.auditCapsule(value); }

function event(run, sequence, eventType, fields = {}) {
  return Twin.createEvent(run, { eventId: fields.eventId || `CAP-${sequence}-${eventType}`, sequence, eventType, logicalTime: fields.logicalTime ?? 480 + sequence, routeId: fields.routeId ?? (eventType === "RUN_RELEASED" ? "" : "R1"), vehicleId: fields.vehicleId ?? (eventType === "RUN_RELEASED" ? "" : "V1"), orderId: fields.orderId || "", coordinate: fields.coordinate, roadEdgeId: fields.roadEdgeId, ackId: fields.ackId, payload: { planRevision: run.revision, ...(fields.payload || {}) } });
}

async function v16Fixture() {
  const graph = Fixture.createFixture(); const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node])); const provider = Providers.createRegistry().get("SYNTHETIC_ROAD_FIXTURE");
  const points = ["DEPOT", "B", "C"].map((nodeId, index) => ({ pointId: index ? `O${index}` : "DEPOT", lon: nodes.get(nodeId).lon, lat: nodes.get(nodeId).lat }));
  const request = { schemaVersion: "stct-routing-request-v1.6", providerId: provider.id, profile: "light-truck", points, distanceUnit: "km", durationUnit: "minutes", snapToleranceMeters: 120 };
  const route = await provider.route(request); const matrix = await provider.matrix(request);
  const plan = { schemaVersion: "stct-plan-v1.6-test", planId: "CAPSULE-PLAN", planHash: Integrity.hashValue({ plan: "CAPSULE-PLAN" }), revision: 1, logicalStartMinute: 480, verification: { status: "PASS" }, vehicles: [{ id: "V1", maxVolume: 10 }], routes: [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1", "O2"], etaByOrder: { O1: 490, O2: 510 }, serviceMinutesByOrder: { O1: 5, O2: 5 }, volumeByOrder: { O1: 2, O2: 3 }, geometry: route.geometry, edgeIds: route.edgeIds, totalDistance: route.totalDistance, maxVolume: 10 }] };
  const run = Twin.createRun({ scenarioId: "CAPSULE-SCENARIO", inputHash: Integrity.hashValue({ scenario: "CAPSULE-SCENARIO" }), planHash: plan.planHash, routeGeometryHash: route.routeHash, matrixHash: matrix.matrixHash, providerProvenance: route.providerProvenance, simulationSeed: "616", executionProfile: "ON_TIME", logicalStartMinute: 480, revision: 1 });
  const store = Stores.createStore({ run, plan, clock: () => "2026-08-31T00:00:00.000Z" });
  const events = [
    event(run, 1, "RUN_RELEASED", { logicalTime: 480 }), event(run, 2, "ROUTE_ACCEPTED", { logicalTime: 481 }), event(run, 3, "VEHICLE_DEPARTED", { logicalTime: 482 }),
    event(run, 4, "POSITION_RECORDED", { logicalTime: 485, coordinate: route.geometry[1], roadEdgeId: route.edgeIds[0], payload: { segmentDistanceKm: 0.5, roadMatched: true } }),
    event(run, 5, "STOP_ARRIVED", { logicalTime: 490, orderId: "O1" }), event(run, 6, "SERVICE_STARTED", { logicalTime: 490, orderId: "O1" }), event(run, 7, "SERVICE_COMPLETED", { logicalTime: 495, orderId: "O1", ackId: "ACK-O1" }),
  ];
  events.forEach((row) => { const result = store.append(row); assert.equal(result.status, "ACCEPTED"); });
  const executionState = store.snapshot();
  const inbox = Alerts.createInbox(); inbox.add(Alerts.createAlert({ ruleId: "ETA_RISK", executionRunHash: run.executionRunHash, routeId: "R1", vehicleId: "V1", orderId: "O2", openedLogicalTime: 496, evidence: [{ metric: "etaRiskMinutes", actualValue: 14, thresholdOperator: ">=", thresholdValue: 10, source: "ACCEPTED_EXECUTION_EVENTS" }], relatedEventIds: [events.at(-1).eventId] }));
  const queue = Queue.createQueue(); queue.enqueue(events.at(-1));
  const report = Analytics.compute({ plan, executionState, matrixProfile: "light-truck", tolerances: { earlyMinutes: 5, lateMinutes: 5 } });
  const revision1 = { schemaVersion: "stct-execution-plan-revision-v1.6", revision: 2, parentRevision: 1, parentPlanHash: plan.planHash, newPlanHash: Integrity.hashValue({ plan: "RECOVERY-1" }), incidentHash: Integrity.hashValue({ incident: 1 }), recoveryRequestHash: Integrity.hashValue({ request: 1 }), cutoffLogicalMinute: 496, effectiveFromLogicalMinute: 496 }; revision1.revisionHash = Integrity.hashValue(revision1);
  const revision2 = { schemaVersion: "stct-execution-plan-revision-v1.6", revision: 3, parentRevision: 2, parentPlanHash: revision1.newPlanHash, newPlanHash: Integrity.hashValue({ plan: "RECOVERY-2" }), incidentHash: Integrity.hashValue({ incident: 2 }), recoveryRequestHash: Integrity.hashValue({ request: 2 }), cutoffLogicalMinute: 500, effectiveFromLogicalMinute: 500 }; revision2.revisionHash = Integrity.hashValue(revision2);
  const handover = { schemaVersion: "stct-recovery-handover-v1.6", cutoffLogicalMinute: 496, beforeAcceptedEventHashes: events.map((row) => row.eventHash), parentPlanHash: plan.planHash, newPlanHash: revision1.newPlanHash, revision: 2, effectiveFromLogicalMinute: 496, label: "Simulated recovery plan handover", executedOperationClaim: false }; handover.handoverHash = Integrity.hashValue(handover);
  const source = { routingProvider: route.providerProvenance, roadGraph: graph, roadMatrix: matrix, roadRoutes: [route], executionRun: run, executionEvents: events, executionState, offlineQueueSummary: queue.summary(), alerts: inbox.snapshot(), planVsActual: { plan, executionState, options: { matrixProfile: "light-truck", tolerances: { earlyMinutes: 5, lateMinutes: 5 } }, report }, planRevisions: [revision1, revision2], recoveryHandovers: [handover], driverSimulatorState: { mode: "LOCAL_SIMULATION", queueStatus: queue.summary(), selectedRouteId: "R1" }, operationalViewState: { activeLens: "PLAN_VS_SIMULATED_ACTUAL", selectedVehicleId: "V1", selectedOrderId: "O1", noWebGLOperational: true } };
  return { source, route, matrix, run, events, executionState, report, capsule: Capsule.createCapsule(source, { locale: "en", createdAt: "2026-08-31T06:16:00.000Z" }) };
}

async function legacyFixture() {
  const fixture = buildFixture({ orderCount: 6, routeCount: 2, planSuffix: "V16-LEGACY", inputSuffix: "V16-LEGACY" }); Canonical.configure(contract);
  const identity = Canonical.scenarioIdentitySync(fixture.scenario); fixture.scenario = { ...fixture.scenario, ...identity.scenario, canonicalScenario: identity.scenario, contentHash: identity.contentHash, inputHash: identity.inputHash, inputFingerprint: identity.inputHash, meta: { synthetic: true } }; fixture.plan.inputHash = identity.inputHash; fixture.plan.contentHash = identity.contentHash;
  const eventStore = DomainEvents.createEventStore({ clock: () => "2026-08-31T00:00:00.000Z" }); eventStore.append("SCENARIO_OPENED", { aggregateType: "SCENARIO", aggregateId: fixture.scenario.scenarioId, scenarioId: fixture.scenario.scenarioId, inputHash: fixture.scenario.inputHash, basePlanHash: fixture.plan.planHash, resultingPlanHash: fixture.plan.planHash, source: "v16-legacy-test", logicalTime: 480, payload: { verification: "PASS" } });
  const incident = Incidents.createIncident({ type: "STOP_DELAY", baseInputHash: fixture.scenario.inputHash, basePlanHash: fixture.plan.planHash, logicalMinute: 500, affectedEntityIds: [fixture.scenario.orders[0].id], parameters: { orderId: fixture.scenario.orders[0].id, delayMinutes: 10 } });
  const matrix = await LegacyMatrix.createHaversineProvider({ clock: () => "2026-08-31T00:00:00.000Z" }).matrix({ points: fixture.scenario.orders.slice(0, 3).map((order) => ({ id: order.id, lon: order.lon, lat: order.lat })), profile: "car", distanceUnit: "km", durationUnit: "minutes" });
  const simulationHash = await Simulation.simulationIdentity(fixture.plan.planHash, []);
  return LegacyCapsule.createCapsule({ canonicalScenario: fixture.scenario, plans: [fixture.plan], selectedPlanHash: fixture.plan.planHash, verifierResults: [{ planHash: fixture.plan.planHash, verification: fixture.plan.verification }], explanations: [], domainEvents: eventStore.snapshot(), simulationState: { activePlanHash: fixture.plan.planHash, simulationHash, activeEvents: [], simulationRevision: 0, operationLog: [], rejectedEvents: [] }, incidents: [incident], recoveryCandidates: [], engineProvenance: [{ engineId: "LOCAL_HEURISTIC", version: "1.5", status: "VERIFIED" }], matrixProvenance: [matrix.provenance], dataClassification: "SYNTHETIC_DEMO", viewState: { mode: "replay" } }, { clock: () => "2026-08-31T00:00:00.000Z" });
}

async function main() {
  const f = await v16Fixture(); const capsule = f.capsule; const audit = Capsule.auditCapsule(capsule);
  check("T486", audit.status === "PASS" && capsule.schemaVersion === Capsule.SCHEMA_VERSION && Capsule.SECTION_NAMES.every((name) => capsule.sections[name]));
  check("T487", /^sha256:[a-f0-9]{64}$/.test(capsule.capsuleHash) && capsule.capsuleHash === Capsule.computedCapsuleHash(capsule));
  check("T488", capsule.sections.routingProvider.payload.provenanceHash.startsWith("sha256:") && audit.status === "PASS");
  check("T489", capsule.sections.roadGraph.payload.graphHash.startsWith("sha256:") && audit.status === "PASS");
  check("T490", capsule.sections.roadMatrix.payload.matrixHash.startsWith("sha256:") && audit.status === "PASS");
  check("T491", capsule.sections.roadRoutes.payload[0].routeHash.startsWith("sha256:") && audit.status === "PASS");
  check("T492", capsule.sections.executionRun.payload.executionRunHash === f.run.executionRunHash && audit.status === "PASS");
  check("T493", capsule.sections.executionEvents.payload.every((row, index) => row.sequence === index + 1 && row.eventHash.startsWith("sha256:")) && audit.status === "PASS");
  check("T494", capsule.sections.executionState.payload.executionStateHash === f.executionState.executionStateHash && audit.status === "PASS");
  check("T495", capsule.sections.alerts.payload.alerts.every((row) => row.alertHash.startsWith("sha256:")) && capsule.sections.alerts.payload.auditEvents.every((row) => row.eventHash.startsWith("sha256:")) && audit.status === "PASS");
  check("T496", capsule.sections.planRevisions.payload.length === 2 && capsule.sections.planRevisions.payload[1].parentPlanHash === capsule.sections.planRevisions.payload[0].newPlanHash && audit.status === "PASS");
  check("T497", capsule.sections.recoveryHandovers.payload[0].handoverHash.startsWith("sha256:") && capsule.sections.recoveryHandovers.payload[0].executedOperationClaim === false && audit.status === "PASS");
  check("T498", capsule.sections.offlineQueueSummary.payload.total === 1 && capsule.sections.offlineQueueSummary.payload.containsLocalPath === false && audit.status === "PASS");
  check("T499", Analytics.compute({ plan: f.source.planVsActual.plan, executionState: f.source.planVsActual.executionState, ...f.source.planVsActual.options }).metricReportHash === f.report.metricReportHash && audit.status === "PASS");
  const imported = Capsule.importCapsule(capsule); check("T500", imported.mode === "READ_ONLY_REPLAY" && imported.status === "READ_ONLY_REPLAY");
  check("T501", throwsCode(() => Capsule.importCapsule(capsule, { mode: "SANDBOX_SIMULATION" }), "V16_SANDBOX_EXPLICIT_CONSENT_REQUIRED") && Capsule.importCapsule(capsule, { mode: "SANDBOX_SIMULATION", allowSandboxSimulation: true }).mode === "SANDBOX_SIMULATION");
  check("T502", imported.autoRelease === false && imported.capsule.policies.autoRelease === false);
  check("T503", imported.autoPlay === false && imported.capsule.policies.autoPlay === false);
  check("T504", imported.autoApplyRecovery === false && imported.capsule.policies.autoApplyRecovery === false);
  check("T505", imported.externalRequests === false && imported.externalProviderCalls === 0 && imported.capsule.policies.externalRequests === false);
  check("T506", tamperAudit(capsule, "executionEvents", (events) => { events[0].payload.changed = true; }).errors[0].code === "V16_EXECUTION_EVENT_HASH_MISMATCH");
  check("T507", tamperAudit(capsule, "roadMatrix", (matrix) => { matrix.distances[0][1] += 1; }).errors[0].code === "V16_ROAD_MATRIX_HASH_MISMATCH");
  check("T508", tamperAudit(capsule, "roadRoutes", (routes) => { routes[0].geometry[0][0] += 0.01; }).errors[0].code === "V16_ROAD_ROUTE_HASH_MISMATCH");
  check("T509", tamperAudit(capsule, "executionState", (state) => { state.routeStates.R1.state = "COMPLETED"; }).errors[0].code === "V16_EXECUTION_STATE_HASH_MISMATCH");
  check("T510", tamperAudit(capsule, "alerts", (value) => { value.alerts[0].state = "RESOLVED"; }).errors[0].code === "V16_ALERT_HASH_MISMATCH");
  check("T511", tamperAudit(capsule, "planRevisions", (values) => { values[1].parentPlanHash = "sha256:tampered"; }).errors[0].code === "V16_PLAN_REVISION_HASH_MISMATCH");
  check("T512", tamperAudit(capsule, "routingProvider", (value) => { value.mode = "EXTERNAL"; }).errors[0].code === "V16_PROVIDER_PROVENANCE_INVALID");
  check("T513", tamperAudit(capsule, "offlineQueueSummary", (value) => { value.total += 1; }).errors[0].code === "V16_QUEUE_SUMMARY_INVALID");
  const unknown = structuredClone(capsule); unknown.schemaVersion = "stct-unknown"; check("T514", Capsule.auditCapsule(unknown).errors[0].code === "V16_CAPSULE_SCHEMA_UNSUPPORTED");
  check("T515", Capsule.auditCapsule(JSON.stringify(capsule), { limits: { bytes: 100 } }).errors[0].code === "V16_CAPSULE_SIZE_LIMIT");
  check("T516", Capsule.auditCapsule('{"schemaVersion":"x","__proto__":{"polluted":true}}').errors[0].code === "V16_CAPSULE_PROTOTYPE_POLLUTION" && ({}).polluted === undefined);
  check("T517", Capsule.scanSecurity(capsule).every((row) => row.code !== "V16_CAPSULE_ABSOLUTE_PATH") && Capsule.scanSecurity({ path: "/Users/example/private/data.json" }).some((row) => row.code === "V16_CAPSULE_ABSOLUTE_PATH"));
  check("T518", Capsule.scanSecurity(capsule).every((row) => row.code !== "V16_CAPSULE_SECRET") && Capsule.scanSecurity({ apiKey: "example-not-real" }).some((row) => row.code === "V16_CAPSULE_SECRET"));
  check("T519", !JSON.stringify(capsule).match(/\.xlsx?\b/i) && Capsule.scanSecurity({ source: "customer-raw.xlsx" }).some((row) => row.code === "V16_CAPSULE_RAW_EXCEL"));
  const legacy = await legacyFixture(); const legacyImport = Capsule.importCapsule(legacy); check("T520", legacyImport.legacy === true && legacyImport.mode === "READ_ONLY_REPLAY" && legacyImport.autoApplyRecovery === false);
  const extracted = Capsule.randomExtraction(capsule, 9); check("T521", extracted.verified === true && Capsule.SECTION_NAMES.includes(extracted.sectionName) && extracted.payloadHash === Integrity.hashValue(extracted.payload));
  check("T522", Capsule.LOCALES.every((locale) => { const value = Capsule.createCapsule(f.source, { locale, createdAt: "2026-08-31T06:16:00.000Z" }); const replay = Capsule.importCapsule(Capsule.serializeCapsule(value)); return replay.locale === locale && replay.copy.title; }));
  const seal = Capsule.capsuleSeal(capsule); check("T523", seal.label === "Capsule Seal" && seal.digitalSignature === false && /not a digital signature/i.test(seal.note));
  check("T524", imported.status === "READ_ONLY_REPLAY" && !JSON.stringify(imported.capsule).match(/\/(?:Users|private|tmp)\//) && imported.externalRequests === false);
  check("T525", audit.errorCodes.length >= 35 && ["V16_CAPSULE_HASH_MISMATCH", "V16_EXECUTION_EVENT_HASH_MISMATCH", "V16_METRICS_HASH_MISMATCH", "V16_SANDBOX_EXPLICIT_CONSENT_REQUIRED"].every((code) => audit.errorCodes.includes(code)));
  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks.map((row) => row.id), capsuleHash: capsule.capsuleHash }, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
