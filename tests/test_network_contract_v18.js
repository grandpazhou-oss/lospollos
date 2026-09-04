#!/usr/bin/env node
"use strict";

const assert = require("assert");
const child = require("child_process");
const path = require("path");
const Contract = require("../network-contract-v18.js");
const Integrity = require("../integrity-hash-v151.js");
const { makeNetwork } = require("./fixtures/network-v18-fixture.js");

const assertions = [];
function check(requirementId, condition, observed, expected, negative = false) {
  const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, negative, evidence: "tests/test_network_contract_v18.js" };
  assertions.push(row);
  assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
}
function rejected(requirementId, mutate, code) {
  let observed = "NO_ERROR";
  try { Contract.normalizeScenario(mutate(withPlan())); } catch (error) { observed = error.code; }
  check(requirementId, observed === code, observed, code, true);
}
function clone(value) { return structuredClone(value); }
function withPlan() {
  const scenario = makeNetwork({ orderCount: 8, pickupDelivery: true, crossDock: true });
  scenario.trips = [
    { tripId: "T1", vehicleId: "V1", driverId: "DR1", tripIndex: 1, startDepotId: "D1", endDepotId: "D1", startTime: "08:00", endTime: "10:00", routeId: "R1", predecessorTripId: "", successorTripId: "T2" },
    { tripId: "T2", vehicleId: "V1", driverId: "DR1", tripIndex: 2, startDepotId: "D1", endDepotId: "D2", startTime: "10:30", endTime: "12:00", routeId: "R2", predecessorTripId: "T1", successorTripId: "" },
  ];
  scenario.routes = [
    { routeId: "R1", tripId: "T1", stops: [{ orderId: "O0001" }, { orderId: "O0002" }], roadRouteHash: Contract.hashArtifact("R1"), matrixHash: Contract.hashArtifact("M1"), metrics: { distanceKm: 12 } },
    { routeId: "R2", tripId: "T2", stops: [{ orderId: "O0003" }, { orderId: "O0004" }], roadRouteHash: Contract.hashArtifact("R2"), matrixHash: Contract.hashArtifact("M1"), metrics: { distanceKm: 10 } },
  ];
  scenario.dockReservations = [{ reservationId: "RES1", dockId: "DOCK-1-A", vehicleId: "V1", tripId: "T1", operation: "LOAD", startTime: "07:30", endTime: "08:00", demandUnits: 1, status: "CONFIRMED" }];
  scenario.waves = [{ waveId: "W1", depotId: "D1", releaseWindow: { start: "07:00", end: "08:00" }, cutoffTime: "07:30", dockReservationIds: ["RES1"], orderIds: ["O0001", "O0002"], tripIds: ["T1"], status: "FROZEN" }];
  scenario.transfers = [{ transferId: "X1", shipmentId: "PAIR-1", fromTripId: "T1", toTripId: "T2", depotId: "D1", inboundDockId: "DOCK-1-B", outboundDockId: "DOCK-1-A", readyTime: "10:05", transferDuration: 15, latestHandover: "10:25", custodyEvents: [] }];
  return scenario;
}
function python(value, mode = "canonical", solveOptions = {}) {
  const result = child.spawnSync("python3", [path.join(__dirname, "../optimizer/network_contract_v18.py")], { input: JSON.stringify({ mode, value, solveOptions }), encoding: "utf8" });
  return { exitCode: result.status, output: JSON.parse(result.stdout || "{}"), stderr: result.stderr };
}

const raw = withPlan();
const normalized = Contract.normalizeScenario(raw);
const identity = Contract.identityBundle(raw, { objective: "BALANCED_NETWORK", engine: "LOCAL_FIXTURE" });
check("T0041", normalized.schemaVersion === "stct-network-scenario-v1.8" && normalized.depots.length === 2, normalized.schemaVersion, "valid NetworkScenario");
for (const mode of ["SINGLE_DAY", "MULTI_DAY", "MULTI_SHIFT"]) {
  const scenario = withPlan(); scenario.planningHorizon.mode = mode; Contract.normalizeScenario(scenario);
}
check("T0042", true, ["SINGLE_DAY", "MULTI_DAY", "MULTI_SHIFT"], "accepted enum");
rejected("T0043", (value) => { delete value.planningHorizon.timezone; return value; }, "NETWORK_TYPE_ERROR");
rejected("T0044", (value) => { value.planningHorizon.businessDayStart = "25:00"; return value; }, "NETWORK_TIME_ERROR");
rejected("T0045", (value) => { value.planningHorizon.crossMidnightPolicy = "SILENT"; return value; }, "NETWORK_CROSS_MIDNIGHT_POLICY");

const duplicateCases = [
  ["T0046", "depots"], ["T0047", "docks"], ["T0048", "vehicles"], ["T0049", "drivers"], ["T0050", "orders"],
  ["T0051", "trips"], ["T0052", "routes"], ["T0053", "waves"], ["T0054", "transfers"], ["T0055", "pickupDeliveryPairs"],
];
for (const [id, field] of duplicateCases) rejected(id, (value) => { value[field].push(clone(value[field][0])); return value; }, "NETWORK_DUPLICATE_ID");
rejected("T0056", (value) => { value.depots[0].coordinate = [181, 39]; return value; }, "NETWORK_NUMBER_RANGE");
rejected("T0057", (value) => { value.docks[0].depotId = "UNKNOWN"; return value; }, "NETWORK_DOCK_DEPOT_UNKNOWN");
rejected("T0058", (value) => { value.vehicles[0].homeDepotId = "UNKNOWN"; return value; }, "NETWORK_VEHICLE_DEPOT_UNKNOWN");
rejected("T0059", (value) => { value.drivers[0].homeDepotId = "UNKNOWN"; return value; }, "NETWORK_DRIVER_DEPOT_UNKNOWN");
rejected("T0060", (value) => { value.orders[0].allowedDepotIds = ["UNKNOWN"]; return value; }, "NETWORK_ORDER_DEPOT_UNKNOWN");
rejected("T0061", (value) => { value.orders[0].preferredDepotId = "D2"; return value; }, "NETWORK_PREFERRED_DEPOT_INVALID");
rejected("T0062", (value) => { value.orders[0].forbiddenDepotIds = [value.orders[0].allowedDepotIds[0]]; return value; }, "NETWORK_DEPOT_RULE_CONFLICT");
rejected("T0063", (value) => { value.orders[0].zoneId = "UNKNOWN"; return value; }, "NETWORK_ORDER_ZONE_UNKNOWN");
rejected("T0064", (value) => { value.vehicles[0].vehicleTypeId = "UNKNOWN"; return value; }, "NETWORK_VEHICLE_TYPE_UNKNOWN");
rejected("T0065", (value) => { value.drivers[0].skills = [true]; return value; }, "NETWORK_TYPE_ERROR");
rejected("T0066", (value) => { value.trips[1].predecessorTripId = ""; return value; }, "NETWORK_TRIP_LINK_MISMATCH");
rejected("T0067", (value) => { value.routes[0].tripId = "UNKNOWN"; return value; }, "NETWORK_ROUTE_TRIP_UNKNOWN");
rejected("T0068", (value) => { value.waves[0].depotId = "UNKNOWN"; return value; }, "NETWORK_WAVE_DEPOT_UNKNOWN");
rejected("T0069", (value) => { value.waves[0].orderIds = ["UNKNOWN"]; return value; }, "NETWORK_WAVE_ORDER_UNKNOWN");
rejected("T0070", (value) => { value.waves[0].tripIds = ["UNKNOWN"]; return value; }, "NETWORK_WAVE_TRIP_UNKNOWN");
rejected("T0071", (value) => { value.transfers[0].toTripId = "UNKNOWN"; return value; }, "NETWORK_TRANSFER_TRIP_UNKNOWN");
rejected("T0072", (value) => { value.pickupDeliveryPairs[0].pickupOrderId = "UNKNOWN"; return value; }, "NETWORK_PAIR_ORDER_UNKNOWN");
rejected("T0073", (value) => { value.pickupDeliveryPairs.push({ ...value.pickupDeliveryPairs[0], pairId: "PAIR-X" }); return value; }, "NETWORK_ORDER_MULTIPLE_PAIRS");

for (const [id, field] of [["T0074", "networkContentHash"], ["T0075", "networkInputHash"], ["T0076", "routingContextHash"], ["T0077", "solveContextHash"]]) check(id, Contract.isSha256(identity[field]), identity[field], "sha256:<64 hex>");
for (const [id, artifact] of [["T0078", normalized], ["T0079", normalized.trips], ["T0080", normalized.dockReservations], ["T0081", normalized.waves], ["T0082", { plan: normalized.routes, execution: [] }]]) check(id, Contract.isSha256(Contract.hashArtifact(artifact)), Contract.hashArtifact(artifact), "sha256:<64 hex>");
const reordered = withPlan();
for (const field of ["depots", "docks", "zones", "orders", "vehicles", "drivers", "vehicleTypes"]) reordered[field].reverse();
check("T0083", Contract.identityBundle(reordered).networkInputHash === Contract.identityBundle(raw).networkInputHash, Contract.identityBundle(reordered).networkInputHash, identity.networkInputHash);
for (const [id, field, mutate] of [
  ["T0084", "depots", (row) => { row[0].fixedOperatingCost += 1; }],
  ["T0085", "docks", (row) => { row[0].fixedSetupMinutes += 1; }],
  ["T0086", "vehicles", (row) => { row[0].maxTrips += 1; }],
  ["T0087", "drivers", (row) => { row[0].maxDutyMinutes += 1; }],
  ["T0088", "orders", (row) => { row[0].priorityWeight += 1; }],
]) { const changed = withPlan(); mutate(changed[field]); check(id, Contract.identityBundle(changed).networkContentHash !== identity.networkContentHash, Contract.identityBundle(changed).networkContentHash, "different content hash", true); }
const policy = withPlan(); policy.policies.openRoutes = false;
check("T0089", Contract.identityBundle(policy).networkInputHash !== identity.networkInputHash, Contract.identityBundle(policy).networkInputHash, "different input hash", true);
for (const [id, field, value] of [["T0090", "uiState", { selectedDepotId: "D2" }], ["T0091", "recordedAt", "2099-01-01T00:00:00Z"]]) { const changed = withPlan(); changed[field] = value; check(id, Contract.identityBundle(changed).networkInputHash === identity.networkInputHash, Contract.identityBundle(changed).networkInputHash, identity.networkInputHash); }
const nfc = withPlan(); nfc.networkId = "Cafe\u0301-网络"; const composed = withPlan(); composed.networkId = "Café-网络";
check("T0092", Contract.identityBundle(nfc).networkInputHash === Contract.identityBundle(composed).networkInputHash, Contract.identityBundle(nfc).networkInputHash, Contract.identityBundle(composed).networkInputHash);
const utfValues = ["A", "_", "中", "日本", "😀"].map((value) => value.normalize("NFC")); const sorted = [...utfValues].sort(Contract.utf8Compare);
check("T0093", sorted.join("|") === ["A", "_", "中", "日本", "😀"].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).join("|"), sorted, "UTF-8 byte order");
for (const [id, value] of [["T0094", { id: "天津仓" }], ["T0095", { id: "東京倉庫" }], ["T0096", { id: "EV-🚚" }]]) { const js = Contract.canonicalString(Contract.safeValue(value)); const py = python(value); check(id, py.exitCode === 0 && py.output.canonical === js, { js, py: py.output.canonical }, "exact JS/Python bytes"); }
const decimals = { amount: "12.340000", negativeZero: 0, integer: 9007199254740991 };
check("T0097", python(decimals).output.canonical === Contract.canonicalString(Contract.safeValue(decimals)), python(decimals).output.canonical, "fixed decimal string parity");
check("T0098", Contract.canonicalString(Contract.safeValue({ value: -0 })) === '{"value":0}', Contract.canonicalString(Contract.safeValue({ value: -0 })), '{"value":0}');
rejected("T0099", (value) => { value.networkId = true; return value; }, "NETWORK_TYPE_ERROR");
rejected("T0100", (value) => { value.networkId = null; return value; }, "NETWORK_TYPE_ERROR");
rejected("T0101", (value) => { value.orders[0].releaseTime = "8:00"; return value; }, "NETWORK_TIME_ERROR");
const pyScenario = python(normalized); const jsCanonical = Contract.canonicalString(normalized);
check("T0102", pyScenario.exitCode === 0 && pyScenario.output.canonical === jsCanonical, { jsBytes: Buffer.byteLength(jsCanonical), pyBytes: Buffer.byteLength(pyScenario.output.canonical || "") }, "exact canonical bytes");
check("T0103", [identity.networkContentHash, identity.networkInputHash, identity.routingContextHash, identity.solveContextHash].every(Contract.isSha256), identity, "all authoritative hashes valid");
check("T0104", !Object.values(identity).some((value) => typeof value === "string" && value.startsWith("ui-fnv")), identity, "no FNV authority");
rejected("T0105", (value) => { value.unknownBusinessField = 1; return value; }, "NETWORK_UNKNOWN_FIELD");
rejected("T0106", () => JSON.parse(JSON.stringify(withPlan()).replace(/"policies":\{/, '"policies":{"__proto__":{},')), "NETWORK_DANGEROUS_KEY");
let deep = {}; let cursor = deep; for (let index = 0; index < 30; index += 1) { cursor.next = {}; cursor = cursor.next; }
rejected("T0107", (value) => { value.assumptions.deep = deep; return value; }, "NETWORK_DEPTH_LIMIT");
rejected("T0108", (value) => { value.assumptions.large = Array.from({ length: Contract.LIMITS.maxArrayLength + 1 }, () => 0); return value; }, "NETWORK_ARRAY_LIMIT");
rejected("T0109", (value) => { value.networkId = "x".repeat(Contract.LIMITS.maxStringLength + 1); return value; }, "NETWORK_STRING_LIMIT");
check("T0110", normalized.dataClassification === "SYNTHETIC" && normalized.assumptions.synthetic === true, normalized.dataClassification, "SYNTHETIC");
let stableA; let stableB; try { Contract.normalizeScenario({}); } catch (error) { stableA = error.code; } try { Contract.normalizeScenario({}); } catch (error) { stableB = error.code; }
check("T0111", stableA === stableB && stableA === "NETWORK_TYPE_ERROR", [stableA, stableB], "stable code");
check("T0112", Object.keys(identity).filter((key) => key.endsWith("Hash")).length === 4, Object.keys(identity), "identity evidence exported");
check("T0113", [identity.networkContentHash, identity.networkInputHash, identity.routingContextHash, identity.solveContextHash].every(Boolean), "identity layers available", "Trust Lab can render all layers");

process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, identity, assertions }, null, 2)}\n`);
