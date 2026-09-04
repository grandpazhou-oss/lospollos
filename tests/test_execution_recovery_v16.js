#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const net = require("net");
const path = require("path");
const Integrity = require("../integrity-hash-v151.js");
const Twin = require("../execution-twin-v16.js");
const Stores = require("../execution-store-v16.js");
const Alerts = require("../operations-alerts-v16.js");
const RollingRecovery = require("../rolling-recovery-v16.js");
const Reoptimization = require("../reoptimization-v16.js");
const Recovery = require("../execution-recovery-v16.js");
const Fixture = require("./fixtures/rolling-v16-fixture.js");

const ROOT = path.resolve(__dirname, ".."); const checks = [];
function check(id, condition, detail = {}) { assert(condition, `${id}: ${JSON.stringify(detail)}`); checks.push({ id, status: "PASS", detail }); }
function throwsCode(run, code) { try { run(); } catch (error) { return error.code === code; } return false; }
async function freePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
async function startService() { const port = await freePort(); const process = childProcess.spawn("python3", ["optimizer/ortools_service.py"], { cwd: ROOT, env: { ...global.process.env, OPT_PORT: String(port), MAX_SOLVE_SECONDS: "5" }, stdio: ["ignore", "pipe", "pipe"] }); let output = ""; process.stdout.on("data", (chunk) => { output += chunk; }); process.stderr.on("data", (chunk) => { output += chunk; }); const endpoint = `http://127.0.0.1:${port}`; for (let attempt = 0; attempt < 60; attempt += 1) { try { if ((await fetch(`${endpoint}/health`)).ok) return { process, endpoint, output: () => output }; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); } process.kill("SIGTERM"); throw new Error(output || "optimizer start timeout"); }
async function stopService(service) { if (!service || service.process.exitCode !== null) return; service.process.kill("SIGTERM"); await Promise.race([new Promise((resolve) => service.process.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 1000))]); if (service.process.exitCode === null) service.process.kill("SIGKILL"); }

async function build() {
  const f = await Fixture.create(); const closureId = "E_H_ZONE_B_FREE";
  const matrix = await f.provider.matrix({ schemaVersion: "stct-routing-request-v1.6", providerId: f.provider.id, profile: "light-truck", points: f.points, distanceUnit: "km", durationUnit: "minutes", snapToleranceMeters: 120, closures: [closureId] });
  const baseScenario = structuredClone(f.baseScenario); baseScenario.inputHash = Integrity.hashValue({ scenarioId: baseScenario.scenarioId, orders: baseScenario.orders, vehicles: baseScenario.vehicles });
  const basePlan = structuredClone(f.basePlan); basePlan.routes[0].edgeIds = ["E_DEPOT_A", "E_A_B_ONEWAY"]; basePlan.routes[1].edgeIds = [closureId]; basePlan.planHash = Integrity.hashValue({ planId: basePlan.planId, revision: basePlan.revision, routes: basePlan.routes });
  const run = Twin.createRun({ scenarioId: baseScenario.scenarioId, inputHash: baseScenario.inputHash, planHash: basePlan.planHash, routeGeometryHash: Integrity.hashValue(basePlan.routes.map((route) => route.edgeIds)), matrixHash: matrix.matrixHash, providerProvenance: matrix.providerProvenance, simulationSeed: "19", executionProfile: "MIXED_RISK", logicalStartMinute: 480, revision: basePlan.revision });
  const store = Stores.createStore({ run, plan: basePlan }); let sequence = 0; const add = (eventType, logicalTime, fields = {}) => { sequence += 1; const event = Twin.createEvent(run, { eventId: `REC-E${sequence}`, sequence, eventType, logicalTime, routeId: fields.routeId ?? (["RUN_RELEASED", "RUN_COMPLETED"].includes(eventType) ? "" : "R1"), vehicleId: fields.vehicleId ?? (["RUN_RELEASED", "RUN_COMPLETED"].includes(eventType) ? "" : "V1"), orderId: fields.orderId || "", coordinate: fields.coordinate, source: "LOCAL_SIMULATION", payload: { planRevision: run.revision } }); const result = store.append(event); assert.strictEqual(result.status, "ACCEPTED", JSON.stringify(result)); return event; };
  add("RUN_RELEASED", 480); add("ROUTE_ACCEPTED", 481); add("VEHICLE_DEPARTED", 482); add("POSITION_RECORDED", 490, { coordinate: [f.nodes.get("DEPOT").lon, f.nodes.get("DEPOT").lat] }); add("STOP_ARRIVED", 495, { orderId: "O1" }); add("SERVICE_STARTED", 496, { orderId: "O1" }); add("SERVICE_COMPLETED", 500, { orderId: "O1" }); add("STOP_ARRIVED", 505, { orderId: "O2" }); add("SERVICE_STARTED", 506, { orderId: "O2" }); add("ROUTE_ACCEPTED", 507, { routeId: "R2", vehicleId: "V2" }); add("VEHICLE_DEPARTED", 508, { routeId: "R2", vehicleId: "V2" }); add("POSITION_RECORDED", 510, { routeId: "R2", vehicleId: "V2", coordinate: [f.nodes.get("H").lon, f.nodes.get("H").lat] });
  const executionState = store.snapshot(); const inbox = Alerts.createInbox(); const alert = Alerts.alertFromRule("ETA_RISK", { executionRunHash: run.executionRunHash, routeId: "R2", vehicleId: "V2", orderId: "O4", logicalTime: 510, etaRiskMinutes: 20, source: "ACCEPTED_EXECUTION_EVENTS", relatedEventIds: ["REC-E12"] }); inbox.add(alert);
  const coordinatorOptions = { basePlan, baseScenario, executionState, matrix, closures: [closureId], transferPolicy: "LOCK_LOADED_ORDERS_TO_VEHICLE", loadedOrderAssignments: [{ orderId: "O3", vehicleId: "V1", loaded: true }], currentRoadNodeByVehicle: { V1: "V1_START", V2: "V2_START" }, currentLoadByVehicle: { V1: 1, V2: 0 }, shiftMinutesByVehicle: { V1: 600, V2: 600 }, endPointByVehicle: { V1: "DEPOT_END", V2: "DEPOT_END" }, projectedStops: [{ orderId: "O4", predictedArrival: 700, windowEnd: 650 }], inbox, generatedAt: "2026-08-31T00:00:00.000Z" };
  return { ...f, matrix, baseScenario, basePlan, run, store, executionState, inbox, alert, closureId, coordinatorOptions };
}

async function main() {
  const f = await build();
  const manual = Recovery.createIncident({ source: "MANUAL", executionRunHash: f.run.executionRunHash, logicalTime: 510, correlationId: "CORR-1", causationId: "USER-1" });
  check("T432", manual.executionRunHash === f.run.executionRunHash && manual.source === "MANUAL");
  const fromAlert = Recovery.createIncident({ source: "OPERATIONAL_ALERT", executionRunHash: f.run.executionRunHash, logicalTime: 510, alertId: f.alert.alertId });
  check("T433", fromAlert.alertIds.includes(f.alert.alertId));
  const fromEvent = Recovery.createIncident({ source: "EXECUTION_EVENT", executionRunHash: f.run.executionRunHash, logicalTime: 510, eventId: "REC-E12" });
  check("T434", fromEvent.eventIds.includes("REC-E12"));
  const fromDriver = Recovery.createIncident({ source: "DRIVER_FAILURE", executionRunHash: f.run.executionRunHash, logicalTime: 510, eventId: "DRV-FAIL", reason: "Synthetic driver failure" });
  check("T435", fromDriver.source === "DRIVER_FAILURE" && fromDriver.reason.includes("driver"));
  check("T436", manual.correlationId === "CORR-1");
  check("T437", manual.causationId === "USER-1" && fromAlert.causationId === f.alert.alertId);

  const coordinator = Recovery.createCoordinator(f.coordinatorOptions); const prepared = coordinator.prepare({ source: "ROAD_CLOSURE", correlationId: "CORR-REC", causationId: f.closureId, routeIds: ["R2"], vehicleIds: ["V2"], orderIds: ["O4"] }); const snapshot = prepared.snapshot; const radius = prepared.blastRadius;
  check("T438", snapshot.cutoffLogicalMinute === f.executionState.latestLogicalTime && snapshot.cutoffLogicalMinute === 510, snapshot.cutoffLogicalMinute);
  check("T439", snapshot.completedStopIds.join(",") === "O1" && snapshot.fixedRoutePrefixes.find((row) => row.routeId === "R1").stopIds.join(",") === "O1", snapshot.completedStopIds);
  check("T440", snapshot.activeStopIds.join(",") === "O2" && snapshot.vehicleStates.find((row) => row.vehicleId === "V1").activeStopId === "O2");
  check("T441", snapshot.vehicleStates.find((row) => row.vehicleId === "V1").currentCoordinate[0] === f.nodes.get("DEPOT").lon && snapshot.vehicleStates.find((row) => row.vehicleId === "V2").currentCoordinate[0] === f.nodes.get("H").lon, snapshot.vehicleStates);
  check("T442", snapshot.vehicleStates.every((row) => row.remainingShiftMinutes === 570), snapshot.vehicleStates);
  check("T443", snapshot.loadedOrderAssignments[0].orderId === "O3" && snapshot.vehicleStates.find((row) => row.vehicleId === "V1").remainingLoadedOrderIds.includes("O3"));
  check("T444", snapshot.closures.includes(f.closureId) && f.matrix.closureIds.includes(f.closureId) && snapshot.matrixHash === f.matrix.matrixHash, snapshot.closures);
  const unreachableSnapshot = structuredClone(snapshot); unreachableSnapshot.unreachablePairs = [{ sourceId: "O3", targetId: "O4" }]; const unreachableRadius = Recovery.blastRadius(unreachableSnapshot, { plan: f.basePlan, projectedStops: f.coordinatorOptions.projectedStops });
  check("T445", unreachableRadius.unreachablePairs.length === 1 && unreachableRadius.unreachablePairs[0].targetId === "O4");
  check("T446", radius.affectedRouteIds.includes("R2"), radius);
  check("T447", radius.affectedVehicleIds.includes("V2"), radius);
  check("T448", radius.affectedOrderIds.includes("O4"), radius);
  check("T449", radius.projectedLateStops.length === 1 && radius.projectedLateStops[0].orderId === "O4");
  check("T450", snapshot.alertHashes.includes(f.alert.alertHash) && radius.alertHashes.includes(f.alert.alertHash));

  let service;
  try {
    service = await startService(); const generated = await coordinator.generate({ fullAdapter: Reoptimization.createHttpAdapter({ endpoint: service.endpoint }), timeLimitSeconds: 2, timeoutMs: 10000 }); const full = generated.candidates.find((candidate) => candidate.candidateType === "FULL_REOPTIMIZATION_OR_TOOLS"); const local = generated.candidates.find((candidate) => candidate.candidateType === "LOCAL_REGRET_INSERTION");
    check("T451", local.contextHash === prepared.context.contextHash && local.routes.find((route) => route.vehicleId === "V1").orderIds[0] === "O2", local.routes);
    check("T452", full.contextHash === prepared.context.contextHash && full.integrationEvidence.status === "VERIFIED_HTTP_INTEGRATION", full.integrationEvidence);
    check("T453", generated.candidates.filter((candidate) => !candidate.reference).every((candidate) => candidate.matrixHash === f.matrix.matrixHash));
    check("T454", generated.candidates.filter((candidate) => !candidate.reference).every((candidate) => candidate.inputHash === prepared.scenario.inputHash));
    check("T455", new Set(generated.candidates.map((candidate) => candidate.pinningHash)).size === 1 && full.pinningHash.startsWith("sha256:"));
    check("T456", generated.comparison.metricDefinitions.join(",") === "assignedOrders,unassignedOrders,roadDistanceKm,changePenalty" && generated.comparison.rows.length === generated.candidates.length, generated.comparison);
    const preview = coordinator.preview(full.planHash); check("T457", preview.handoverMarker.cutoffLogicalMinute === 510 && preview.handoverMarker.before.includes("Simulated Actual"), preview.handoverMarker);
    const applied = coordinator.apply(full.planHash);
    check("T458", applied.planRevision.schemaVersion === "stct-execution-plan-revision-v1.6" && applied.planRevision.revisionHash.startsWith("sha256:"), applied.planRevision);
    check("T459", applied.planRevision.parentPlanHash === f.basePlan.planHash);
    check("T460", applied.planRevision.effectiveFromLogicalMinute === snapshot.cutoffLogicalMinute);
    check("T461", JSON.stringify(applied.cutoffActualEventHashes) === JSON.stringify(snapshot.acceptedEventHashesBeforeCutoff) && JSON.stringify(applied.handover.beforeAcceptedEventHashes) === JSON.stringify(snapshot.acceptedEventHashesBeforeCutoff));
    check("T462", applied.futurePlannedPlanHash === full.planHash && applied.handover.newPlanHash === full.planHash);
    const postRun = coordinator.postRecoveryRun(applied.planRevision); check("T463", postRun.revision === applied.planRevision.revision && postRun.planHash === full.planHash && postRun.logicalStartMinute === snapshot.cutoffLogicalMinute, postRun);
    const undone = coordinator.undo(); check("T464", undone.status === "UNDONE" && undone.plan.planHash === f.basePlan.planHash, undone);
    const appliedAgain = coordinator.apply(full.planHash); coordinator.recordPostRecoveryEvent({ eventId: "POST-ACK", eventHash: Integrity.hashValue({ event: "POST-ACK" }), eventType: "EVENT_ACKNOWLEDGED", logicalTime: snapshot.cutoffLogicalMinute + 1, ackId: "ACK-POST", accepted: true });
    check("T465", throwsCode(() => coordinator.undo(), "RECOVERY_UNDO_BLOCKED_BY_ACK"));
    const counter = coordinator.counterRecovery("POST_RECOVERY_ACK_ACCEPTED"); check("T466", counter.counterRecoveryHash.startsWith("sha256:") && counter.parentRecoveryPlanHash === appliedAgain.plan.planHash, counter);
    const counterCapsule = coordinator.capsule(); check("T467", counterCapsule.sessionLineage.actions.some((row) => row.action === "COUNTER_RECOVERY_CREATED") && counterCapsule.sessionLineage.postRecoveryAckEventHashes.length === 1, counterCapsule.sessionLineage);
    check("T468", coordinator.domainEvents().some((event) => event.eventType === "RECOVERY_PLAN_APPLIED" && event.eventHash.startsWith("sha256:")));
    check("T469", coordinator.domainEvents().some((event) => event.eventType === "RECOVERY_PLAN_UNDONE"));
    check("T471", throwsCode(() => coordinator.apply("sha256:unknown"), "STALE_RECOVERY_CANDIDATE"));
    check("T470", coordinator.inbox.list().some((alert) => alert.ruleId === "RECOVERY_REQUIRED") && coordinator.domainEvents().some((event) => event.eventType === "RECOVERY_CONFLICT"));
    coordinator.refreshEnvironment({ matrix: { ...f.matrix, matrixHash: Integrity.hashValue({ changed: "matrix" }) } }); check("T472", throwsCode(() => coordinator.apply(full.planHash), "STALE_RECOVERY_MATRIX")); coordinator.refreshEnvironment({ matrix: f.matrix });
    coordinator.refreshEnvironment({ providerProvenance: { ...f.matrix.providerProvenance, providerId: "OTHER_PROVIDER" } }); check("T473", throwsCode(() => coordinator.apply(full.planHash), "STALE_RECOVERY_PROVIDER")); coordinator.refreshEnvironment({ providerProvenance: f.matrix.providerProvenance });
    coordinator.refreshEnvironment({ transferPolicy: "VIRTUAL_CROSS_DOCK_SIMULATION" }); check("T474", throwsCode(() => coordinator.apply(full.planHash), "STALE_RECOVERY_TRANSFER_POLICY")); coordinator.refreshEnvironment({ transferPolicy: "LOCK_LOADED_ORDERS_TO_VEHICLE" });
    coordinator.refreshEnvironment({ closures: [] }); check("T475", throwsCode(() => coordinator.apply(full.planHash), "STALE_RECOVERY_CLOSURES")); coordinator.refreshEnvironment({ closures: [f.closureId] });
    const completedCoordinator = Recovery.createCoordinator({ ...f.coordinatorOptions, executionState: { ...f.executionState, run: { ...f.executionState.run, status: "COMPLETED" } } }); check("T476", throwsCode(() => completedCoordinator.apply(full.planHash), "RECOVERY_RUN_COMPLETED"));
    const cancelledCoordinator = Recovery.createCoordinator({ ...f.coordinatorOptions, executionState: { ...f.executionState, run: { ...f.executionState.run, status: "CANCELLED" } } }); check("T477", throwsCode(() => cancelledCoordinator.apply(full.planHash), "RECOVERY_RUN_CANCELLED"));
    const fallback = coordinator.fallbackLocal(); check("T478", fallback.length === 2 && fallback.every((candidate) => candidate.verification.status === "PASS"));
    check("T479", RollingRecovery.fullAvailability(f.matrix, { available: false, status: "UNAVAILABLE_DEPENDENCY" }).status === "SKIPPED_DEPENDENCY");
    const view = coordinator.viewModel(); check("T480", view.noWebGL.operational === true && view.noWebGL.comparison.rows.length === generated.candidates.length);
    check("T481", view.mobile.flow === "ALERT_INCIDENT_COMPARE_APPLY" && view.steps.join(",") === "Alert or event,Incident,Compare,Preview,Apply");
    check("T482", view.reducedMotion.morph === "STATIC_BEFORE_AFTER" && view.reducedMotion.handovers.length >= 2);
    const capsule = coordinator.capsule(); check("T483", capsule.capsuleHash.startsWith("sha256:") && capsule.incident.incidentHash && capsule.cutoffSnapshot.cutoffSnapshotHash && capsule.blastRadius.blastRadiusHash && capsule.handovers.every((handover) => handover.handoverHash), capsule);
    const imported = coordinator.importCapsule(capsule); check("T484", imported.status === "READ_ONLY_REPLAY" && imported.autoApply === false && imported.externalRequests === false);
    check("T485", view.executedOperationClaim === false && applied.handover.executedOperationClaim === false && capsule.claimBoundary.includes("Simulated"));
  } catch (error) { if (service) console.error(service.output()); throw error; } finally { await stopService(service); }
  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks.map((row) => row.id) }, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
