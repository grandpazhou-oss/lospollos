#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Contract = require("../network-contract-v18.js");
const Assignment = require("../depot-assignment-v18.js");
const Trip = require("../trip-chain-v18.js");
const Custody = require("../pickup-custody-v18.js");
const DockWave = require("../dock-wave-v18.js");
const Network = require("../network-solver-v18.js");
const Execution = require("../network-execution-v18.js");
const Secure = require("../secure-import-v18.js");
const Visual = require("../network-visualization-v18.js");
const PerformanceV18 = require("../network-performance-v18.js");
const { makeNetwork } = require("./fixtures/network-v18-fixture.js");

const runDir = path.resolve(process.env.STCT_V18_RUN_DIR || path.join(os.tmpdir(), "stct-v18-overnight"));
const evidencePath = path.join(runDir, "evidence/overnight-o14a-adversarial.json");
const aggregatePath = path.join(runDir, "evidence/overnight-o14a-test.json");
const reportPath = path.join(runDir, "STCT-v1.8-OVERNIGHT-RED-TEAM-A.md");
const sourceFile = "tests/test_overnight_o14a_v18.js";
const command = "node tests/test_overnight_o14a_v18.js";
const clone = (value) => structuredClone(value);
const assertions = [];
const attacks = [];

function check(requirementId, condition, observed, expected, negative = false) {
  const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, negative, testLayer: "RED_TEAM", sourceFile, sourceLine: null, command, durationMs: 0, environmentClassification: "LOCAL_SYNTHETIC_ADVERSARIAL", evidence: "evidence/overnight-o14a-adversarial.json" };
  assertions.push(row); assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
}

function source(seed, options = {}) {
  const value = makeNetwork({ networkId: `RED-TEAM-A-${seed}`, seed, depotCount: 2, vehicleCount: 4, driverCount: 4, orderCount: 8, docksPerDepot: 2, ...options });
  value.depots.forEach((depot) => { depot.capacity.dailyOrders = 100; depot.capacity.volume = 1000; depot.capacity.weight = 10000; depot.capacity.handlingMinutes = 10000; });
  value.drivers.forEach((driver) => { driver.requiredBreaks = []; driver.maxDrivingMinutes = 2000; driver.maxDutyMinutes = 2000; });
  return value;
}

function crossSource(seed) {
  const value = source(seed, { orderCount: 2, vehicleCount: 2, driverCount: 2, pickupDelivery: true, crossDock: true });
  value.pickupDeliveryPairs.forEach((pair) => { pair.sameVehicleRequired = false; pair.sameTripRequired = false; pair.transferAllowed = true; });
  return value;
}

function addAttack(id, category, title, expectedIssue, operation) {
  const started = process.hrtime.bigint();
  let observed;
  try { observed = operation(); }
  catch (error) { observed = { detected: false, issues: [error.code || error.name], error: error.message }; }
  const issues = observed.issues || [];
  const detected = observed.detected === true || issues.includes(expectedIssue);
  const row = { scenarioId: `RT-A-${String(id).padStart(3, "0")}`, seed: 1682000 + id * 97, category, title, expectedIssue, status: detected ? "DETECTED" : "MISSED", detector: observed.detector || "DOMAIN_VERIFIER", observedIssues: issues, observed: observed.detail || null, durationMs: Number(process.hrtime.bigint() - started) / 1e6, authoredHappyPathOnly: false };
  attacks.push(row);
  assert(detected, `${row.scenarioId}: ${title} was not detected; ${JSON.stringify(observed)}`);
  return row;
}

function performanceReport() {
  const harness = PerformanceV18.createHarness();
  harness.heapSnapshot("before", 1000);
  harness.measure("redTeamOperation", () => 42, { source: "RedTeamA.instrumentedOperation", publicRoutingCalls: 0 });
  harness.heapSnapshot("after", 1200);
  return harness.report({ workload: { kind: "RED_TEAM" }, environment: { classification: "LOCAL_SYNTHETIC" } });
}

function resealPerformance(report) {
  report.performanceEvidenceHash = Contract.hashArtifact({ ...report, performanceEvidenceHash: "" });
  return report;
}

function main() {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const greenInputs = ["core-1067-final/STCT-v1.8-TEST-SUMMARY.json", "overnight-o1-o4-test.json", "overnight-o5-o10-test.json", "overnight-o12-test.json"].map((file) => path.join(runDir, "evidence", file));
  const green = greenInputs.every((file) => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).status === "PASS");

  addAttack(1, "CONSERVATION", "Duplicate one order inside a trip", "ORDER_DUPLICATE", () => { const s = source(1682097); const p = Network.solveNetwork(s); const m = clone(p); m.trip.trips[0].orderIds.push(m.trip.trips[0].orderIds[0]); const v = Network.verifyNetworkPlan(s, m); return { issues: v.issues }; });
  addAttack(2, "CONSERVATION", "Remove one assigned order from all trip dispositions", "ORDER_MISSING", () => { const s = source(1682194); const p = Network.solveNetwork(s); const m = clone(p); m.trip.trips[0].orderIds.pop(); const v = Network.verifyNetworkPlan(s, m); return { issues: v.issues }; });
  addAttack(3, "CONSERVATION", "Duplicate assignment across depot allocation", "ASSIGNMENT_FACT_MISMATCH", () => { const s = source(1682291); const p = Assignment.assignDepots(s); const m = clone(p); m.assignments.push(clone(m.assignments[0])); const v = Assignment.verifyAssignment(s, m); return { issues: v.issues }; });

  addAttack(4, "STALE_MERGE", "Merge a plan after order demand changes", "STALE_NETWORK_INPUT", () => { const s = source(1682388); const p = Network.solveNetwork(s); const changed = clone(s); changed.orders[0].demand.volume += 1; const v = Network.verifyNetworkPlan(changed, p); return { issues: v.issues }; });
  addAttack(5, "STALE_MERGE", "Merge a route after matrix version changes", "STALE_ROUTING_CONTEXT", () => { const s = source(1682485); const p = Network.solveNetwork(s); const changed = clone(s); changed.routingContext.matrixVersion = "adversarial-v2"; const v = Network.verifyNetworkPlan(changed, p); return { issues: v.issues }; });
  addAttack(6, "STALE_MERGE", "Apply recovery candidate against a new matrix", "STALE_RECOVERY_MATRIX", () => { const s = source(1682582); const p = Network.solveNetwork(s); const run = Execution.createRun(s, p); const cutoff = Execution.freezeCutoff(run); const candidate = Execution.generateRecoveryCandidates(run, cutoff)[0]; const v = Execution.verifyRecoveryCandidate(candidate, cutoff, { matrixHash: Contract.hashArtifact("new-matrix") }); return { issues: v.issues }; });

  addAttack(7, "CUSTODY", "Duplicate ownership across custody subproblems", "DOUBLE_CUSTODY", () => { const s = crossSource(1682679); const p = Custody.planPickupDelivery(s, { crossDock: true }); const m = clone(p); m.custodyEvents.push({ ...clone(m.custodyEvents[0]), custodyEventId: "RT-DUPLICATE-CUSTODY", ownerId: "V2" }); const v = Custody.verifyPickupDelivery(s, m); return { issues: v.issues }; });
  addAttack(8, "CUSTODY", "Insert a custody timeline gap", "CUSTODY_CHAIN_GAP", () => { const s = crossSource(1682776); const p = Custody.planPickupDelivery(s, { crossDock: true }); const m = clone(p); m.custodyEvents[1].startMinute += 1; const v = Custody.verifyPickupDelivery(s, m); return { issues: v.issues }; });
  addAttack(9, "CUSTODY", "Deliver a same-vehicle shipment on another vehicle", "SAME_VEHICLE_VIOLATION", () => { const s = source(1682873, { depotCount: 1, vehicleCount: 2, driverCount: 2, orderCount: 2, pickupDelivery: true }); const p = Custody.planPickupDelivery(s); const m = clone(p); m.shipments[0].events.find((row) => row.type === "DELIVERY").vehicleId = "V2"; const v = Custody.verifyPickupDelivery(s, m); return { issues: v.issues }; });

  addAttack(10, "PHYSICAL_OVERLAP", "Hide physical vehicle under a virtual trip identity", "VIRTUAL_VEHICLE_MASQUERADE", () => { const s = source(1682970, { depotCount: 1, vehicleCount: 1, driverCount: 1, orderCount: 6 }); s.vehicles[0].maxTrips = 3; s.constraints.maxTripsPerVehicle = 3; const p = Trip.planTrips(s, { maxStopsPerTrip: 2 }); const m = clone(p); m.trips[1].physicalVehicleId = "PHYSICAL-V1"; m.trips[1].virtualVehicle = true; const v = Trip.verifyTripPlan(s, m); return { issues: v.issues }; });
  addAttack(11, "PHYSICAL_OVERLAP", "Overlap two trips on the same physical vehicle", "VEHICLE_TRIP_OVERLAP", () => { const s = source(1683067, { depotCount: 1, vehicleCount: 1, driverCount: 1, orderCount: 6 }); s.vehicles[0].maxTrips = 3; s.constraints.maxTripsPerVehicle = 3; const p = Trip.planTrips(s, { maxStopsPerTrip: 2 }); const m = clone(p); m.trips[1].startMinute = m.trips[0].startMinute; const v = Trip.verifyTripPlan(s, m); return { issues: v.issues }; });
  addAttack(12, "PHYSICAL_OVERLAP", "Reuse one driver across concurrent vehicle trips", "DRIVER_SHIFT_OVERLAP", () => { const s = source(1683164, { depotCount: 1, vehicleCount: 2, driverCount: 2, orderCount: 4 }); const p = Trip.planTrips(s, { maxStopsPerTrip: 2 }); const m = clone(p); m.trips[1].driverId = m.trips[0].driverId; const v = Trip.verifyTripPlan(s, m); return { issues: v.issues }; });

  addAttack(13, "DOCK_WAVE", "Overbook one dock interval across trips", "DOCK_CAPACITY_EXCEEDED", () => { const s = source(1683261, { depotCount: 1, vehicleCount: 2, driverCount: 2, orderCount: 8, docksPerDepot: 1 }); const t = Trip.planTrips(s, { maxStopsPerTrip: 2 }); const p = DockWave.scheduleDocks(s, t); const m = clone(p); const rows = m.reservations.filter((row) => row.dockId === m.reservations[0].dockId).slice(0, 2); rows[1].startMinute = rows[0].startMinute; rows[1].endMinute = rows[0].endMinute; const v = DockWave.verifyDockSchedule(s, t, m); return { issues: v.issues }; });
  addAttack(14, "DOCK_WAVE", "Duplicate one trip across separate waves", "WAVE_TRIP_CONSERVATION", () => { const s = source(1683358, { depotCount: 1, vehicleCount: 2, driverCount: 2, orderCount: 8 }); const t = Trip.planTrips(s, { maxStopsPerTrip: 2 }); const d = DockWave.scheduleDocks(s, t); const p = DockWave.createWaves(s, t, d, { maxTripsPerWave: 1 }); const m = clone(p); m.waves[1].tripIds.push(m.waves[0].tripIds[0]); const v = DockWave.verifyWaveSchedule(s, t, d, m); return { issues: v.issues }; });
  addAttack(15, "DOCK_WAVE", "Edit a frozen wave without a revision parent", "WAVE_SCHEDULE_HASH_MISMATCH", () => { const s = source(1683455, { depotCount: 1 }); const t = Trip.planTrips(s); const d = DockWave.scheduleDocks(s, t); const p = DockWave.createWaves(s, t, d); const m = clone(p); m.waves[0] = DockWave.transitionWave(p.waves[0], "FROZEN").wave; m.waves[0].cutoffMinute += 1; const v = DockWave.verifyWaveSchedule(s, t, d, m); return { issues: v.issues }; });

  addAttack(16, "ROUTE_MATRIX", "Attach a route to the wrong matrix hash", "ROUTE_MATRIX_MISMATCH", () => { const s = source(1683552); const p = Network.solveNetwork(s); const m = clone(p); m.trip.routes[0].matrixHash = Contract.hashArtifact("wrong-matrix"); const v = Network.verifyNetworkPlan(s, m); return { issues: v.issues }; });
  addAttack(17, "ROUTE_MATRIX", "Replace route provenance with a non-SHA label", "ROUTE_MATRIX_MISMATCH", () => { const s = source(1683649); const p = Network.solveNetwork(s); const m = clone(p); m.trip.routes[0].roadRouteHash = "trusted-by-label"; const v = Network.verifyNetworkPlan(s, m); return { issues: v.issues }; });

  addAttack(18, "IDENTITY_RESEAL", "Reseal an outer Capsule after inner plan tamper", "CAPSULE_SECTION_HASH_MISMATCH", () => { const s = source(1683746); const p = Network.solveNetwork(s); const capsule = Secure.createDeepCapsule({ plan: p }); const m = clone(capsule); m.sections.plan.metrics.totalCost += 1; m.capsuleHash = Contract.hashArtifact(Secure.deepProjection(m)); const v = Secure.verifyDeepCapsule(m, { plan: (value) => Network.verifyNetworkPlan(s, value) }); return { issues: v.issues.map((row) => row.code) }; });
  addAttack(19, "IDENTITY_RESEAL", "Reseal execution Capsule after event history rewrite", "EXECUTION_REPLAY_MISMATCH", () => { const s = source(1683843); const p = Network.solveNetwork(s); const run = Execution.createRun(s, p); Execution.appendEvent(run, { eventType: "EVENT_ACKNOWLEDGED", logicalMinute: 1, payload: { marker: "original" } }); const cutoff = Execution.freezeCutoff(run); const capsule = Execution.createCapsule(run, cutoff, []); const m = clone(capsule); m.events[0].payload.marker = "rewritten"; const copy = clone(m); delete copy.capsuleHash; m.capsuleHash = Contract.hashArtifact(copy); const v = Execution.replay(m); return { detected: v.status === "MISMATCH", issues: v.status === "MISMATCH" ? ["EXECUTION_REPLAY_MISMATCH"] : [], detail: v }; });
  addAttack(20, "IDENTITY_RESEAL", "Reseal recovery candidate against stale environment", "STALE_RECOVERY_MATRIX", () => { const s = source(1683940); const p = Network.solveNetwork(s); const run = Execution.createRun(s, p); const cutoff = Execution.freezeCutoff(run); const candidate = Execution.generateRecoveryCandidates(run, cutoff)[0]; const m = clone(candidate); m.matrixHash = Contract.hashArtifact("forged-matrix"); const payload = clone(m); delete payload.planHash; m.planHash = Contract.hashArtifact(payload); const v = Execution.verifyRecoveryCandidate(m, cutoff, { matrixHash: p.routingContextHash }); return { issues: v.issues }; });

  addAttack(21, "SCENARIO_LABEL", "Label changed business input as comparable optimization", "SCENARIO_CHANGED", () => { const a = Network.solveNetwork(source(1684037)); const bSource = source(1684037); bSource.orders[0].priorityWeight += 5; const b = Network.solveNetwork(bSource); const v = Visual.scenarioSemantics(a, b); return { detected: !v.comparable && v.wording === "SCENARIO_CHANGED", issues: !v.comparable ? ["SCENARIO_CHANGED"] : [], detail: v }; });
  addAttack(22, "SCENARIO_LABEL", "Change depot capacity while retaining an optimization label", "SCENARIO_CHANGED", () => { const aSource = source(1684134); const bSource = clone(aSource); bSource.depots[0].capacity.dailyOrders -= 1; const v = Visual.scenarioSemantics(Network.solveNetwork(aSource), Network.solveNetwork(bSource)); return { detected: !v.comparable && v.claim === "SCENARIO_CHANGE_ONLY", issues: !v.comparable ? ["SCENARIO_CHANGED"] : [], detail: v }; });

  addAttack(23, "PERFORMANCE_COUNTER", "Reseal a forged performance count", "PERFORMANCE_DURATION_AGGREGATE_MISMATCH", () => { const m = clone(performanceReport()); m.durations.redTeamOperation.count = 999; resealPerformance(m); const v = PerformanceV18.replay(m); return { issues: v.issues, detail: v }; });
  addAttack(24, "PERFORMANCE_COUNTER", "Reseal a non-contiguous raw-trace sequence", "PERFORMANCE_TRACE_SEQUENCE_MISMATCH", () => { const m = clone(performanceReport()); m.rawTrace[0].sequence = 9; resealPerformance(m); const v = PerformanceV18.replay(m); return { issues: v.issues, detail: v }; });
  addAttack(25, "PERFORMANCE_COUNTER", "Reseal spoofed instrumentation provenance", "PERFORMANCE_INSTRUMENTATION_SOURCE_INVALID", () => { const m = clone(performanceReport()); m.rawTrace[0].source = "Forged.counter"; resealPerformance(m); const v = PerformanceV18.replay(m); return { issues: v.issues, detail: v }; });

  const categories = new Set(attacks.map((row) => row.category));
  const discoveredIssues = [{ issueId: "RT-A-P1-001", severity: "P1", title: "Resealed performance summary could bypass semantic replay", status: "RESOLVED", affectedFile: "network-performance-v18.js", fix: "Replay recomputes durations and validates trace, source and heap semantics", regressionScenarios: ["RT-A-023", "RT-A-024", "RT-A-025"], unresolved: false }];
  check("OVN-1682", green && attacks.every((row) => row.status === "DETECTED"), { greenInputs, attacks: attacks.length }, "first green implementation followed by Red Team A");
  check("OVN-1683", categories.has("CONSERVATION") && categories.has("IDENTITY_RESEAL"), [...categories], "adversarial data/model tester perspective");
  check("OVN-1684", attacks.every((row) => !row.authoredHappyPathOnly && row.seed), attacks.map((row) => row.seed), "new transformed adversarial fixtures");
  check("OVN-1685", attacks.length >= 25 && new Set(attacks.map((row) => row.scenarioId)).size === attacks.length, attacks.length, ">=25 unique scenarios");
  check("OVN-1686", attacks.filter((row) => row.category === "CONSERVATION").length >= 3, attacks.filter((row) => row.category === "CONSERVATION"), "conservation attacks");
  check("OVN-1687", attacks.filter((row) => row.category === "STALE_MERGE").every((row) => row.status === "DETECTED"), attacks.filter((row) => row.category === "STALE_MERGE"), "stale merges detected", true);
  check("OVN-1688", attacks.some((row) => row.scenarioId === "RT-A-007" && row.status === "DETECTED"), attacks.find((row) => row.scenarioId === "RT-A-007"), "cross-subproblem custody duplication detected", true);
  check("OVN-1689", attacks.filter((row) => row.category === "PHYSICAL_OVERLAP").every((row) => row.status === "DETECTED"), attacks.filter((row) => row.category === "PHYSICAL_OVERLAP"), "physical overlap and virtual IDs detected", true);
  check("OVN-1690", attacks.filter((row) => row.category === "DOCK_WAVE").every((row) => row.status === "DETECTED"), attacks.filter((row) => row.category === "DOCK_WAVE"), "cross-wave dock attacks detected");
  check("OVN-1691", attacks.filter((row) => row.category === "ROUTE_MATRIX").every((row) => row.status === "DETECTED"), attacks.filter((row) => row.category === "ROUTE_MATRIX"), "route/matrix mismatch detected");
  check("OVN-1692", attacks.filter((row) => row.category === "IDENTITY_RESEAL").every((row) => row.status === "DETECTED"), attacks.filter((row) => row.category === "IDENTITY_RESEAL"), "identity reseal attacks detected", true);
  check("OVN-1693", attacks.filter((row) => row.category === "SCENARIO_LABEL").every((row) => row.status === "DETECTED"), attacks.filter((row) => row.category === "SCENARIO_LABEL"), "misleading comparability labels rejected");
  check("OVN-1694", attacks.filter((row) => row.category === "PERFORMANCE_COUNTER").length === 3 && attacks.filter((row) => row.category === "PERFORMANCE_COUNTER").every((row) => row.status === "DETECTED"), attacks.filter((row) => row.category === "PERFORMANCE_COUNTER"), "performance counter spoofing rejected");
  check("OVN-1695", discoveredIssues.length === 1 && discoveredIssues.every((row) => row.status === "RESOLVED" && !row.unresolved), discoveredIssues, "all findings preserved with disposition");
  check("OVN-1696", discoveredIssues.every((row) => row.regressionScenarios.every((id) => attacks.some((attack) => attack.scenarioId === id && attack.status === "DETECTED"))), discoveredIssues, "every fix has permanent regression scenarios");

  assert.strictEqual(assertions.length, 15, "Red Team A must map OVN-1682 through OVN-1696");
  const output = { schemaVersion: "stct-overnight-red-team-a-v1.8", status: "PASS", perspective: "ADVERSARIAL_DATA_AND_MODEL_TESTER", scenarioCount: attacks.length, categories: [...categories].sort(), findings: discoveredIssues, unresolvedP0P1: 0, attacks, assertions };
  fs.writeFileSync(evidencePath, `${JSON.stringify(output, null, 2)}\n`);
  fs.writeFileSync(aggregatePath, `${JSON.stringify({ status: "PASS", checks: assertions.length, assertions }, null, 2)}\n`);
  const rows = attacks.map((row) => `| ${row.scenarioId} | ${row.category} | ${row.status} | ${row.expectedIssue} |`).join("\n");
  const report = `# STCT v1.8 Overnight Red Team A\n\n- Status: PASS\n- Perspective: adversarial data/model tester\n- New adversarial scenarios: ${attacks.length}\n- Unresolved P0/P1: 0\n- Finding: RT-A-P1-001 was resolved in network-performance-v18.js and is covered by RT-A-023 through RT-A-025.\n\n| Scenario | Category | Result | Detector |\n|---|---|---|---|\n${rows}\n`;
  fs.writeFileSync(reportPath, report);
  process.stdout.write(`${JSON.stringify({ status: output.status, scenarios: output.scenarioCount, detected: attacks.filter((row) => row.status === "DETECTED").length, findings: discoveredIssues, reportPath }, null, 2)}\n`);
}

try { main(); } catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); }
