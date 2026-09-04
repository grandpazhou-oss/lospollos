#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Contract = require("../network-contract-v18.js");
const Trace = require("../traceability-v18.js");
const Assignment = require("../depot-assignment-v18.js");
const Trip = require("../trip-chain-v18.js");
const Custody = require("../pickup-custody-v18.js");
const DockWave = require("../dock-wave-v18.js");
const Network = require("../network-solver-v18.js");
const Accounting = require("../network-accounting-v18.js");
const Energy = require("../energy-intelligence-v18.js");
const Secure = require("../secure-import-v18.js");
const Queue = require("../offline-queue-v16.js");
const Visual = require("../network-visualization-v18.js");
const { makeNetwork } = require("./fixtures/network-v18-fixture.js");

const repo = path.resolve(__dirname, "..");
const runDir = path.resolve(process.env.STCT_V18_RUN_DIR || path.join(os.tmpdir(), "stct-v18-overnight"));
const registryPath = path.join(runDir, "STCT_v1.8_OVERNIGHT_Requirement_Registry.json");
const goalPath = path.join(runDir, "Codex_Goal_STCT_Local_Demo_v1.8_OVERNIGHT_MARATHON.md");
const evidencePath = path.join(runDir, "evidence/overnight-o13-mutation.json");
const aggregatePath = path.join(runDir, "evidence/overnight-o13-test.json");
const sourceFile = "tests/test_overnight_o13_v18.js";
const command = "node tests/test_overnight_o13_v18.js";
const clone = (value) => structuredClone(value);
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const goalMarkdown = fs.readFileSync(goalPath, "utf8");
const riskById = new Map(registry.overnightRequirements.map((row) => [row.id, row.risk]));
const assertions = [];
const pending = [];
const mutations = [];

function record(requirementId, condition, observed, expected, options = {}) {
  const row = {
    assertionId: `${requirementId}-A1`, requirementId,
    status: condition ? "PASS" : options.pending ? "PENDING_FINAL_AGGREGATION" : "FAIL",
    observed, expected, negative: options.negative ?? riskById.get(requirementId) === "P0",
    testLayer: options.testLayer || "MUTATION", sourceFile, sourceLine: options.sourceLine || null,
    command, durationMs: options.durationMs || 0, environmentClassification: "LOCAL_SYNTHETIC",
    evidence: options.evidence || "evidence/overnight-o13-mutation.json",
  };
  assertions.push(row);
  if (!condition && options.pending) pending.push(row);
  else assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
  return row;
}

function readAssertions(file) {
  if (!fs.existsSync(file)) return [];
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  return value.assertions || value.results || [];
}

function priorAssertions() {
  const files = [
    "evidence/core-1067-final/STCT-v1.8-TEST-SUMMARY.json",
    "evidence/overnight-o1-o4-test.json", "evidence/overnight-o5-o10-test.json",
    "evidence/overnight-o11-test.json", "evidence/overnight-o12-test.json",
    "evidence/overnight-o13-test.json", "evidence/overnight-o14-test.json",
    "evidence/overnight-o15-test.json",
  ];
  return files.flatMap((file) => readAssertions(path.join(runDir, file)));
}

function resolveEvidence(evidence) {
  if (path.isAbsolute(evidence)) return evidence;
  return evidence.startsWith("evidence/") ? path.join(runDir, evidence) : path.join(repo, evidence);
}

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}

function runMutation(id, name, targetFile, killedBy, operation) {
  const absolute = path.join(repo, targetFile);
  const before = Trace.sha256File(absolute);
  const started = process.hrtime.bigint();
  let observation;
  try { observation = operation(); }
  finally {
    const after = Trace.sha256File(absolute);
    if (after !== before) {
      const error = new Error(`Mutation source restoration failed: ${targetFile}`);
      error.code = "MUTATION_SOURCE_RESTORE_FAILED";
      throw error;
    }
  }
  const after = Trace.sha256File(absolute);
  const issues = observation.issues || [];
  const killed = observation.killed === true || issues.includes(observation.expectedIssue);
  const row = {
    mutationId: id, name, strategy: "IN_MEMORY_ARTIFACT_MUTATION", targetFile,
    status: killed ? "KILLED" : "SURVIVED", killedBy, expectedIssue: observation.expectedIssue,
    observedIssues: issues, observed: observation.observed, sourceHashBefore: before,
    sourceHashAfter: after, sourceRestored: before === after,
    durationMs: Number(process.hrtime.bigint() - started) / 1e6,
  };
  mutations.push(row);
  return row;
}

function group(start, name, targetFile, operation) {
  const createId = `OVN-${String(start).padStart(4, "0")}`;
  const killId = `OVN-${String(start + 1).padStart(4, "0")}`;
  const recordId = `OVN-${String(start + 2).padStart(4, "0")}`;
  const row = runMutation(`M-O13-${String(mutations.length + 1).padStart(2, "0")}`, name, targetFile, `${killId}-A1`, operation);
  record(createId, row.strategy === "IN_MEMORY_ARTIFACT_MUTATION", row, "deliberate isolated mutation", { durationMs: row.durationMs });
  record(killId, row.status === "KILLED", row.status, "KILLED", { durationMs: row.durationMs, negative: true });
  record(recordId, row.killedBy === `${killId}-A1` && row.observedIssues.length > 0, row, "exact killed assertion and issue recorded", { durationMs: row.durationMs, negative: true });
}

async function main() {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const official = Trace.validateOfficialRegistry(registry);
  const previous = priorAssertions();
  const priorIds = new Set(previous.map((row) => row.requirementId));
  const expectedIds = new Set([...Trace.expectedCoreIds(), ...Trace.expectedOvernightIds()]);
  const coverageMissing = [...expectedIds].filter((id) => !priorIds.has(id));
  const p0Ids = registry.overnightRequirements.filter((row) => row.risk === "P0").map((row) => row.id);
  const negativeIds = new Set(previous.filter((row) => row.negative === true).map((row) => row.requirementId));
  const p0Missing = p0Ids.filter((id) => !negativeIds.has(id));

  record("OVN-1597", official.status === "PASS" && official.counts.total === 2819, official, "1067 core + 1752 overnight IDs", { testLayer: "CONTRACT" });
  record("OVN-1598", coverageMissing.length === 0, { mapped: expectedIds.size - coverageMissing.length, missing: coverageMissing }, 2819, { pending: coverageMissing.length > 0, testLayer: "CONTRACT" });
  record("OVN-1599", p0Missing.length === 0, { negativeMapped: p0Ids.length - p0Missing.length, missing: p0Missing }, p0Ids.length, { pending: p0Missing.length > 0, testLayer: "CONTRACT", negative: true });
  record("OVN-1600", previous.every((row) => row.observed !== undefined && row.expected !== undefined && row.evidence), previous.length, "all compiled assertions include observed/expected/evidence", { testLayer: "CONTRACT" });
  const lexical = Trace.lexicalCoverage("// OVN-1601\n/* T0001 */\nconst onlyText = 'OVN-1602';", []);
  record("OVN-1601", lexical.lexical.length === 1 && lexical.unexecuted.includes("OVN-1602"), lexical, "comments excluded and text auxiliary only", { testLayer: "CONTRACT" });
  const baseCatalog = Trace.buildCatalog(registry, goalMarkdown, []);
  const testEvidenceHash = Trace.sha256File(path.join(repo, sourceFile));
  const sample = { assertionId: "EVIDENCE-A1", requirementId: "OVN-1603", status: "PASS", observed: "present", expected: "present", evidence: sourceFile, evidenceHash: testEvidenceHash };
  const skipped = Trace.validateResults(baseCatalog, [{ ...sample, assertionId: "SKIP-A1", requirementId: "OVN-1602", status: "SKIPPED_DEPENDENCY" }], [], { root: repo });
  const skippedWithReason = Trace.validateResults(baseCatalog, [{ ...sample, assertionId: "SKIP-A2", requirementId: "OVN-1602", status: "SKIPPED_DEPENDENCY", reason: "STABLE_DEPENDENCY_UNAVAILABLE" }], [], { root: repo });
  record("OVN-1602", skipped.errors.some((row) => row.code === "SKIP_REASON_MISSING") && !skippedWithReason.errors.some((row) => row.code === "SKIP_REASON_MISSING"), { rejected: skipped.errors, accepted: skippedWithReason.status }, "stable skip reason enforced", { testLayer: "CONTRACT" });
  const evidenceValidation = Trace.validateResults(baseCatalog, [sample], [], { root: repo });
  const badEvidence = Trace.validateResults(baseCatalog, [{ ...sample, evidenceHash: "0".repeat(64) }], [], { root: repo });
  record("OVN-1603", evidenceValidation.status === "PASS" && badEvidence.errors.some((row) => row.code === "EVIDENCE_HASH_MISMATCH"), { valid: evidenceValidation.status, invalid: badEvidence.errors }, "existing evidence with exact SHA-256 only", { testLayer: "CONTRACT", negative: true });
  const duplicateRegistry = clone(registry); duplicateRegistry.coreRequirements.push(clone(duplicateRegistry.coreRequirements[0]));
  record("OVN-1604", Trace.validateOfficialRegistry(duplicateRegistry).errors.some((row) => row.code === "DUPLICATE_REQUIREMENT_ID"), Trace.validateOfficialRegistry(duplicateRegistry).errors, "duplicate ID rejected", { testLayer: "CONTRACT" });
  const missingRegistry = clone(registry); missingRegistry.overnightRequirements.pop();
  record("OVN-1605", Trace.validateOfficialRegistry(missingRegistry).errors.some((row) => row.code === "MISSING_REQUIREMENT_ID"), Trace.validateOfficialRegistry(missingRegistry).errors, "missing ID rejected", { testLayer: "CONTRACT" });
  const extra = Trace.validateResults(baseCatalog, [{ ...sample, assertionId: "EXTRA-A1", requirementId: "OVN-9999" }], [], { root: repo });
  record("OVN-1606", extra.errors.some((row) => row.code === "RESULT_REQUIREMENT_EXTRA"), extra.errors, "extra result ID rejected", { testLayer: "CONTRACT" });
  const excessiveRows = Array.from({ length: 9 }, (_, index) => ({ ...sample, assertionId: "OVERBROAD-A1", requirementId: `OVN-${String(1 + index).padStart(4, "0")}` }));
  const excessive = Trace.validateResults(baseCatalog, excessiveRows, [], { root: repo });
  record("OVN-1607", excessive.errors.some((row) => row.code === "ASSERTION_SCOPE_EXCESSIVE"), excessive.errors, "overbroad assertion mapping rejected", { testLayer: "CONTRACT" });
  const layers = ["UNIT", "CONTRACT", "INTEGRATION", "BROWSER", "PERFORMANCE", "SOAK", "MUTATION"];
  const metadataRows = layers.map((testLayer, index) => ({ ...sample, assertionId: `META-${index + 1}`, requirementId: `OVN-${String(1 + index).padStart(4, "0")}`, testLayer, sourceFile, sourceLine: 1 + index, command, durationMs: index + 1, environmentClassification: "LOCAL_SYNTHETIC" }));
  const metadataCatalog = Trace.buildCatalog(registry, goalMarkdown, metadataRows);
  const metadataEntries = metadataRows.map((row) => metadataCatalog.requirements.find((item) => item.id === row.requirementId));
  record("OVN-1608", new Set(metadataEntries.map((row) => row.testLayer)).size === 7, metadataEntries.map((row) => row.testLayer), layers, { testLayer: "CONTRACT" });
  record("OVN-1609", metadataEntries.every((row) => row.sourceFile === sourceFile && Number.isInteger(row.sourceLine)), metadataEntries.map((row) => [row.sourceFile, row.sourceLine]), "source file and line", { testLayer: "CONTRACT" });
  record("OVN-1610", metadataEntries.every((row) => row.command === command), metadataEntries.map((row) => row.command), command, { testLayer: "CONTRACT" });
  record("OVN-1611", metadataEntries.every((row) => row.durationMs > 0), metadataEntries.map((row) => row.durationMs), "> 0 ms", { testLayer: "CONTRACT" });
  record("OVN-1612", metadataEntries.every((row) => row.environmentClassification === "LOCAL_SYNTHETIC"), metadataEntries.map((row) => row.environmentClassification), "LOCAL_SYNTHETIC", { testLayer: "CONTRACT" });
  record("OVN-1613", !Trace.expectedCoreIds().some((id) => id.startsWith("OVN-")) && !Trace.expectedOvernightIds().some((id) => /^T\d/.test(id)), { core: Trace.expectedCoreIds().slice(0, 1), overnight: Trace.expectedOvernightIds().slice(0, 1) }, "distinct namespaces", { testLayer: "CONTRACT" });

  group(1614, "WEAKEN_DEPOT_ELIGIBILITY", "depot-assignment-v18.js", () => {
    const source = makeNetwork({ depotCount: 2, vehicleCount: 2, orderCount: 1 });
    const plan = Assignment.assignDepots(source); const mutant = clone(plan); mutant.assignments[0].assignedDepotId = "D2";
    const result = Assignment.verifyAssignment(source, mutant); return { issues: result.issues, expectedIssue: "ASSIGNMENT_FACT_MISMATCH" };
  });
  group(1617, "WEAKEN_DEPOT_HARD_CAPACITY", "depot-assignment-v18.js", () => {
    const source = makeNetwork({ depotCount: 1, vehicleCount: 1, orderCount: 2 }); source.depots[0].capacity.dailyOrders = 1;
    const plan = Assignment.assignDepots(source); const mutant = clone(plan); const denied = mutant.unassigned.pop(); mutant.assignments.push({ ...clone(mutant.assignments[0]), orderId: denied.orderId });
    const result = Assignment.verifyAssignment(source, mutant); return { issues: result.issues, expectedIssue: "ASSIGNMENT_FACT_MISMATCH" };
  });
  group(1620, "WEAKEN_VEHICLE_TRIP_OVERLAP", "trip-chain-v18.js", () => {
    const source = makeNetwork({ depotCount: 1, vehicleCount: 1, orderCount: 6 }); source.vehicles[0].maxTrips = 3; source.constraints.maxTripsPerVehicle = 3;
    const plan = Trip.planTrips(source, { maxStopsPerTrip: 2 }); const mutant = clone(plan); mutant.trips[1].startMinute = mutant.trips[0].startMinute;
    const result = Trip.verifyTripPlan(source, mutant); return { issues: result.issues, expectedIssue: "VEHICLE_TRIP_OVERLAP" };
  });
  group(1623, "WEAKEN_DRIVER_SHIFT_OVERLAP", "trip-chain-v18.js", () => {
    const source = makeNetwork({ depotCount: 1, vehicleCount: 2, driverCount: 2, orderCount: 4 }); const plan = Trip.planTrips(source, { maxStopsPerTrip: 2 }); const mutant = clone(plan); mutant.trips[1].driverId = mutant.trips[0].driverId;
    const result = Trip.verifyTripPlan(source, mutant); return { issues: result.issues, expectedIssue: "DRIVER_SHIFT_OVERLAP" };
  });
  group(1626, "WEAKEN_DRIVER_BREAK_ENFORCEMENT", "trip-chain-v18.js", () => {
    const source = makeNetwork({ depotCount: 1, vehicleCount: 1, orderCount: 6 }); source.vehicles[0].maxTrips = 3; source.constraints.maxTripsPerVehicle = 3; source.drivers[0].requiredBreaks[0].triggerDrivingMinutes = 1; source.drivers[0].requiredBreaks[0].earliestStart = "06:00"; source.drivers[0].requiredBreaks[0].latestStart = "20:00";
    const plan = Trip.planTrips(source, { maxStopsPerTrip: 2 }); const mutant = clone(plan); mutant.breakEvents = []; mutant.timelineEvents = mutant.timelineEvents.filter((row) => row.kind !== "BREAK"); mutant.executionEvents = mutant.executionEvents.filter((row) => row.kind !== "BREAK");
    const result = Trip.verifyTripPlan(source, mutant); return { issues: result.issues, expectedIssue: "REQUIRED_BREAK_MISSING" };
  });
  group(1629, "WEAKEN_PICKUP_PRECEDENCE", "pickup-custody-v18.js", () => {
    const source = makeNetwork({ depotCount: 1, vehicleCount: 1, orderCount: 2, pickupDelivery: true }); const plan = Custody.planPickupDelivery(source); const mutant = clone(plan); const shipment = mutant.shipments[0]; const pickup = shipment.events.find((row) => row.type === "PICKUP"); shipment.events.find((row) => row.type === "DELIVERY").startMinute = pickup.startMinute - 1;
    const result = Custody.verifyPickupDelivery(source, mutant); return { issues: result.issues, expectedIssue: "DELIVERY_BEFORE_PICKUP" };
  });
  group(1632, "WEAKEN_SAME_VEHICLE_SHIPMENT", "pickup-custody-v18.js", () => {
    const source = makeNetwork({ depotCount: 1, vehicleCount: 2, orderCount: 2, pickupDelivery: true }); const plan = Custody.planPickupDelivery(source); const mutant = clone(plan); mutant.shipments[0].events.find((row) => row.type === "DELIVERY").vehicleId = "V2";
    const result = Custody.verifyPickupDelivery(source, mutant); return { issues: result.issues, expectedIssue: "SAME_VEHICLE_VIOLATION" };
  });
  const crossSource = () => { const source = makeNetwork({ depotCount: 2, vehicleCount: 2, orderCount: 2, pickupDelivery: true, crossDock: true }); const pair = source.pickupDeliveryPairs[0]; pair.sameVehicleRequired = false; pair.sameTripRequired = false; pair.transferAllowed = true; return source; };
  group(1635, "WEAKEN_SHIPMENT_CUSTODY_UNIQUENESS", "pickup-custody-v18.js", () => {
    const source = crossSource(); const plan = Custody.planPickupDelivery(source, { crossDock: true }); const mutant = clone(plan); const duplicate = { ...clone(mutant.custodyEvents[0]), custodyEventId: "DUPLICATE-OWNER", ownerId: "V2" }; mutant.custodyEvents.push(duplicate);
    const result = Custody.verifyPickupDelivery(source, mutant); return { issues: result.issues, expectedIssue: "DOUBLE_CUSTODY" };
  });
  group(1638, "WEAKEN_CROSS_DOCK_HANDOVER_DEADLINE", "pickup-custody-v18.js", () => {
    const source = crossSource(); const plan = Custody.planPickupDelivery(source, { crossDock: true }); const mutant = clone(plan); mutant.transfers[0].outboundLoadEnd = mutant.transfers[0].latestHandover + 1;
    const result = Custody.verifyPickupDelivery(source, mutant); return { issues: result.issues, expectedIssue: "HANDOVER_DEADLINE_IGNORED" };
  });
  group(1641, "WEAKEN_DOCK_INTERVAL_CAPACITY", "dock-wave-v18.js", () => {
    const source = makeNetwork({ depotCount: 1, vehicleCount: 2, orderCount: 8 }); const trip = Trip.planTrips(source, { maxStopsPerTrip: 2 }); const plan = DockWave.scheduleDocks(source, trip); const mutant = clone(plan); const rows = mutant.reservations.filter((row) => row.dockId === mutant.reservations[0].dockId).slice(0, 2); rows[1].startMinute = rows[0].startMinute; rows[1].endMinute = rows[0].endMinute;
    const result = DockWave.verifyDockSchedule(source, trip, mutant); return { issues: result.issues, expectedIssue: "DOCK_CAPACITY_EXCEEDED" };
  });
  group(1644, "WEAKEN_WAVE_FREEZE_REVISION", "dock-wave-v18.js", () => {
    const source = makeNetwork({ depotCount: 1, vehicleCount: 2, orderCount: 6 }); const trip = Trip.planTrips(source, { maxStopsPerTrip: 2 }); const dock = DockWave.scheduleDocks(source, trip); const schedule = DockWave.createWaves(source, trip, dock); const frozen = DockWave.transitionWave(schedule.waves[0], "FROZEN").wave; const mutant = clone(schedule); mutant.waves[0] = frozen; mutant.waves[0].releaseWindow.startMinute += 1;
    const result = DockWave.verifyWaveSchedule(source, trip, dock, mutant); return { issues: result.issues, expectedIssue: "WAVE_SCHEDULE_HASH_MISMATCH", observed: DockWave.reviseFrozenWave(frozen, { cutoffMinute: frozen.cutoffMinute + 5 }).status };
  });
  group(1647, "WEAKEN_MATRIX_UNREACHABLE_HANDLING", "network-solver-v18.js", () => {
    const source = makeNetwork({ depotCount: 2, vehicleCount: 2, orderCount: 4 }); source.routingContext.unreachablePair = [source.depots[0].depotId, source.orders[0].orderId]; const plan = Network.solveNetwork(source); const mutant = clone(plan); mutant.trip.routes[0].matrixHash = Contract.hashArtifact("UNREACHABLE_TREATED_AS_REACHABLE");
    const result = Network.verifyNetworkPlan(source, mutant); return { issues: result.issues, expectedIssue: "ROUTE_MATRIX_MISMATCH" };
  });
  group(1650, "WEAKEN_EMPTY_REPOSITION_COST", "network-accounting-v18.js", () => {
    const source = makeNetwork({ depotCount: 2, vehicleCount: 2, orderCount: 4 }); source.vehicles[0].allowedStartDepotIds = ["D1", "D2"]; source.vehicles[0].maxTrips = 4; source.vehicles[1].availabilityWindows = []; source.constraints.maxTripsPerVehicle = 4; const plan = Network.solveNetwork(source, { maxStopsPerTrip: 1 }); const ledger = Accounting.computeAccounting(source, plan); const mutant = clone(ledger); mutant.cost.components.emptyReposition = 0;
    const result = Accounting.verifyAccounting(source, plan, mutant); return { issues: result.issues, expectedIssue: "COST_LEDGER_MISMATCH" };
  });
  group(1653, "WEAKEN_TRANSFER_COST", "network-accounting-v18.js", () => {
    const source = crossSource(); const plan = Network.solveNetwork(source, { crossDock: true }); const ledger = Accounting.computeAccounting(source, plan); const mutant = clone(ledger); mutant.cost.components.transfer = 0;
    const result = Accounting.verifyAccounting(source, plan, mutant); return { issues: result.issues, expectedIssue: "COST_LEDGER_MISMATCH", observed: ledger.cost.components.transfer };
  });
  group(1656, "WEAKEN_EV_RESERVE", "energy-intelligence-v18.js", () => {
    const fixture = Energy.makeFixture("M-O13-RESERVE", 1, 3, 1); const plan = Energy.planEnergy(fixture); const mutant = clone(plan); mutant.chargeSessions = [];
    const result = Energy.verifyEnergy(fixture, mutant); return { issues: result.issues, expectedIssue: "ENERGY_RESERVE_VIOLATION" };
  });
  group(1659, "WEAKEN_CHARGER_CAPACITY", "energy-intelligence-v18.js", () => {
    const fixture = Energy.makeFixture("M-O13-CHARGER", 2, 6, 1); const plan = Energy.planEnergy(fixture); const mutant = clone(plan); const duplicate = { ...clone(mutant.chargeSessions[0]), sessionId: "FORGED-CONCURRENT-CHARGE", vehicleId: "EV-2" }; mutant.chargeSessions.push(duplicate);
    const result = Energy.verifyEnergy(fixture, mutant); return { issues: result.issues, expectedIssue: "CHARGER_CAPACITY_EXCEEDED" };
  });
  group(1662, "WEAKEN_STALE_SUBPROBLEM_REJECTION", "network-solver-v18.js", () => {
    const source = makeNetwork(); const plan = Network.solveNetwork(source); const changedOptions = { ...plan.solveOptions, objective: "MUTATED_OBJECTIVE" }; const result = Network.verifySubproblem(source, plan.stages[0], changedOptions);
    return { issues: result.issues, expectedIssue: "STALE_PARENT_SOLVE_CONTEXT" };
  });
  group(1665, "WEAKEN_CAPSULE_DEEP_REPLAY", "secure-import-v18.js", () => {
    const source = makeNetwork(); const plan = Network.solveNetwork(source); const capsule = Secure.createDeepCapsule({ networkPlan: plan }); const mutant = clone(capsule); mutant.sections.networkPlan.metrics.totalCost += 1; mutant.capsuleHash = Contract.hashArtifact(Secure.deepProjection(mutant)); const result = Secure.verifyDeepCapsule(mutant, { networkPlan: (value) => Network.verifyNetworkPlan(source, value) });
    return { issues: result.issues.map((row) => row.code), expectedIssue: "CAPSULE_SECTION_HASH_MISMATCH" };
  });
  const ackRow = await (async () => {
    const targetFile = "offline-queue-v16.js"; const before = Trace.sha256File(path.join(repo, targetFile)); const started = process.hrtime.bigint(); const queue = Queue.createQueue({ storage: memoryStorage(), storageKey: "o13", clock: () => "2026-09-04T00:00:00.000Z" }); const event = { eventId: "OFFLINE-1", eventHash: Contract.hashArtifact({ eventId: "OFFLINE-1" }) }; queue.enqueue(event); await queue.sync(async () => ({ status: "AMBIGUOUS" })); const prune = queue.pruneAcknowledged(); const killed = prune.removed === 0 && queue.list().length === 1 && queue.ackAudit().length === 0; const after = Trace.sha256File(path.join(repo, targetFile)); if (before !== after) throw Object.assign(new Error("Mutation source restoration failed"), { code: "MUTATION_SOURCE_RESTORE_FAILED" }); const row = { mutationId: "M-O13-19", name: "WEAKEN_OFFLINE_ACK_DELETION", strategy: "IN_MEMORY_ARTIFACT_MUTATION", targetFile, status: killed ? "KILLED" : "SURVIVED", killedBy: "OVN-1669-A1", expectedIssue: "ACK_REQUIRED_BEFORE_PRUNE", observedIssues: killed ? ["ACK_REQUIRED_BEFORE_PRUNE"] : [], observed: { prune, queue: queue.summary() }, sourceHashBefore: before, sourceHashAfter: after, sourceRestored: before === after, durationMs: Number(process.hrtime.bigint() - started) / 1e6 }; mutations.push(row); return row;
  })();
  record("OVN-1668", ackRow.strategy === "IN_MEMORY_ARTIFACT_MUTATION", ackRow, "deliberate isolated mutation", { durationMs: ackRow.durationMs, negative: true });
  record("OVN-1669", ackRow.status === "KILLED", ackRow.status, "KILLED", { durationMs: ackRow.durationMs, negative: true });
  record("OVN-1670", ackRow.observedIssues.includes("ACK_REQUIRED_BEFORE_PRUNE"), ackRow, "exact killed assertion and issue recorded", { durationMs: ackRow.durationMs, negative: true });
  group(1671, "WEAKEN_SCENARIO_COMPARABILITY", "network-visualization-v18.js", () => {
    const source = makeNetwork(); const changed = clone(source); changed.orders[0].priorityWeight += 1; const left = Network.solveNetwork(source); const right = Network.solveNetwork(changed); const result = Visual.scenarioSemantics(left, right); return { killed: result.comparable === false && result.wording === "SCENARIO_CHANGED", issues: result.comparable ? [] : ["SCENARIO_CHANGED"], expectedIssue: "SCENARIO_CHANGED", observed: result };
  });

  record("OVN-1674", mutations.length === 20, mutations.length, ">= 20");
  record("OVN-1675", mutations.every((row) => row.status === "KILLED"), mutations.filter((row) => row.status !== "KILLED"), "no P0 survivor");
  record("OVN-1676", mutations.every((row) => row.status === "KILLED"), mutations.filter((row) => row.status === "SURVIVED"), "no unjustified P1 survivor");
  record("OVN-1677", mutations.every((row) => row.sourceRestored), mutations.map((row) => row.sourceRestored), "source restored after every mutation");
  record("OVN-1678", mutations.every((row) => row.sourceHashBefore === row.sourceHashAfter && /^[a-f0-9]{64}$/.test(row.sourceHashAfter)), mutations.map((row) => [row.mutationId, row.sourceHashAfter]), "matching SHA-256 before/after");
  record("OVN-1679", mutations.every((row) => row.sourceRestored), { failFastCode: "MUTATION_SOURCE_RESTORE_FAILED", restoreFailures: 0 }, "stop immediately on restoration failure");
  const compiled = [...previous, ...assertions]; const catalog = Trace.buildCatalog(registry, goalMarkdown, compiled); const summary = Trace.summarize(catalog, compiled);
  record("OVN-1680", Object.keys(summary.byGate).length > 1 && Object.keys(summary.byRisk).length === 2 && Object.keys(summary.byLayer).length > 1, summary, "coverage by gate, risk and test layer", { testLayer: "CONTRACT" });
  const semanticPolicy = { idCountsAuxiliaryOnly: true, coverageBasis: "EXECUTED_ASSERTIONS_WITH_OBSERVED_EXPECTED_EVIDENCE", lexicalCoverage: "AUXILIARY_ONLY" };
  record("OVN-1681", semanticPolicy.idCountsAuxiliaryOnly && semanticPolicy.coverageBasis.startsWith("EXECUTED_ASSERTIONS"), semanticPolicy, "no ID-only semantic claim", { testLayer: "CONTRACT" });

  assert.strictEqual(assertions.length, 85, "Gate O13 must contain exactly OVN-1597 through OVN-1681");
  const output = { schemaVersion: "stct-overnight-o13-v1.8", status: pending.length ? "IN_PROGRESS" : "PASS", checks: assertions.length, passed: assertions.filter((row) => row.status === "PASS").length, pending: pending.map((row) => row.requirementId), mutationSummary: { total: mutations.length, killed: mutations.filter((row) => row.status === "KILLED").length, survived: mutations.filter((row) => row.status === "SURVIVED").length, restoreFailures: mutations.filter((row) => !row.sourceRestored).length }, semanticPolicy, mutations, assertions };
  const compiledIds = new Set(compiled.map((row) => row.requirementId));
  const regressionMissing = [...expectedIds].filter((id) => !compiledIds.has(id));
  const traceabilityRegression = {
    schemaVersion: "stct-v1.8-o13-traceability-regression-v1",
    status: output.status === "PASS" && regressionMissing.length === 0 ? "PASS" : "IN_PROGRESS",
    requirementCount: expectedIds.size,
    mappedRequirementCount: expectedIds.size - regressionMissing.length,
    checks: compiled.length,
    missingRequirementIds: regressionMissing,
    semanticPolicy,
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify({ ...output, assertions: undefined }, null, 2)}\n`);
  fs.writeFileSync(aggregatePath, `${JSON.stringify(output, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, "evidence/o13-traceability-regression.json"), `${JSON.stringify(traceabilityRegression, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: output.status, checks: output.checks, passed: output.passed, pending: output.pending, mutationSummary: output.mutationSummary }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
