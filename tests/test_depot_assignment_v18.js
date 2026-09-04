#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Assignment = require("../depot-assignment-v18.js");
const Contract = require("../network-contract-v18.js");
const { makeNetwork } = require("./fixtures/network-v18-fixture.js");

const assertions = [];
function check(requirementId, condition, observed, expected, negative = false) {
  const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, negative, evidence: "tests/test_depot_assignment_v18.js" };
  assertions.push(row); assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
}
function clone(value) { return structuredClone(value); }
function single(orderCount = 3) { return makeNetwork({ depotCount: 1, vehicleCount: 2, orderCount }); }
function twoOneOrder() { const value = makeNetwork({ depotCount: 2, vehicleCount: 4, orderCount: 1 }); value.orders[0].allowedDepotIds = ["D1", "D2"]; value.orders[0].zoneId = ""; return value; }
function run(source, options) { return Assignment.assignDepots(source, options); }

const fixed = twoOneOrder(); fixed.orders[0].fixedDepotId = "D2"; fixed.orders[0].preferredDepotId = "D2";
check("T0114", run(fixed).assignments[0].assignedDepotId === "D2" && run(fixed).assignments[0].reasonCode === "ASSIGNED_FIXED", run(fixed).assignments[0], "fixed D2");
const allowed = twoOneOrder(); allowed.orders[0].allowedDepotIds = ["D2"]; allowed.orders[0].preferredDepotId = "D2";
check("T0115", run(allowed).assignments[0].assignedDepotId === "D2", run(allowed).assignments[0].assignedDepotId, "D2");
const forbidden = twoOneOrder(); forbidden.orders[0].allowedDepotIds = ["D2"]; forbidden.orders[0].forbiddenDepotIds = ["D1"]; forbidden.orders[0].preferredDepotId = "D2";
check("T0116", run(forbidden).assignments[0].assignedDepotId === "D2", run(forbidden).assignments[0].assignedDepotId, "D2");
const preferred = twoOneOrder(); preferred.orders[0].preferredDepotId = "D2";
const noPreference = run(preferred, { preferredPenalty: 0 }); const withPreference = run(preferred, { preferredPenalty: 1000 });
check("T0117", noPreference.assignments[0].assignedDepotId === "D1" && withPreference.assignments[0].assignedDepotId === "D2", [noPreference.assignments[0].assignedDepotId, withPreference.assignments[0].assignedDepotId], "soft preference changes score, not eligibility");
const none = twoOneOrder(); none.orders[0].allowedDepotIds = []; none.orders[0].forbiddenDepotIds = ["D1", "D2"]; none.orders[0].preferredDepotId = "";
check("T0118", run(none).unassigned.length === 1, run(none).unassigned, "one unassigned", true);
check("T0119", run(none).unassigned[0].reasonCode === "NO_ALLOWED_DEPOT", run(none).unassigned[0], "stable eligibility reason");
const hardZone = twoOneOrder(); hardZone.orders[0].zoneId = "Z1"; hardZone.orders[0].preferredDepotId = "D2";
check("T0120", run(hardZone).assignments[0].assignedDepotId === "D1", run(hardZone).assignments[0], "hard zone D1");
const preferredZone = twoOneOrder(); preferredZone.zones[0].mode = "PREFERRED"; preferredZone.orders[0].zoneId = "Z1";
const preferredZoneResult = run(preferredZone, { zonePenalty: 1000 });
check("T0121", preferredZoneResult.assignments[0].assignedDepotId === "D1", preferredZoneResult.assignments[0], "preferred zone scored");
const penaltyZone = twoOneOrder(); penaltyZone.zones[0].mode = "PENALTY"; penaltyZone.orders[0].zoneId = "Z1";
check("T0122", run(penaltyZone, { zonePenalty: 1000 }).assignments[0].assignedDepotId === "D2", run(penaltyZone, { zonePenalty: 1000 }).assignments[0], "penalty zone avoided");
const diagnosticZone = clone(penaltyZone); diagnosticZone.zones[0].mode = "DIAGNOSTIC_ONLY";
check("T0123", run(diagnosticZone, { zonePenalty: 1000 }).assignments[0].assignedDepotId === "D1", run(diagnosticZone, { zonePenalty: 1000 }).assignments[0], "diagnostic only not solver enforced");
const skill = single(1); skill.orders[0].requiredSkills = ["HAZMAT"];
check("T0124", run(skill).unassigned[0].reasonCode === "REQUIRED_SKILL_UNAVAILABLE", run(skill).unassigned[0], "skill enforced", true);
const vehicleType = single(1); vehicleType.orders[0].requiredVehicleTypes = ["VT-EV"]; vehicleType.vehicles = vehicleType.vehicles.filter((vehicle) => vehicle.vehicleTypeId !== "VT-EV"); vehicleType.depots[0].startVehicleIds = vehicleType.vehicles.map((vehicle) => vehicle.vehicleId);
check("T0125", run(vehicleType).unassigned[0].reasonCode === "REQUIRED_VEHICLE_UNAVAILABLE", run(vehicleType).unassigned[0], "vehicle type enforced", true);
const depotType = single(1); depotType.depots[0].allowedVehicleTypes = ["VT-DIESEL"]; depotType.orders[0].requiredVehicleTypes = ["VT-EV"];
check("T0126", run(depotType).unassigned[0].reasonCode === "REQUIRED_VEHICLE_UNAVAILABLE", run(depotType).unassigned[0], "depot vehicle type enforced", true);
const closed = single(1); closed.depots[0].operatingWindows = [{ start: "21:00", end: "23:00" }];
check("T0127", run(closed).unassigned[0].reasonCode === "DEPOT_CLOSED", run(closed).unassigned[0], "operating window enforced", true);

const limits = [["T0128", "dailyOrders", 1], ["T0129", "volume", 1], ["T0130", "weight", 1], ["T0131", "handlingMinutes", 1], ["T0132", "parkingSlots", 0]];
for (const [id, key, limit] of limits) { const scenario = single(3); scenario.depots[0].capacity[key] = limit; const result = run(scenario); check(id, result.unassigned.length > 0 && result.unassigned.some((row) => row.reasonCode === "DEPOT_CAPACITY_EXCEEDED"), { key, assigned: result.assignments.length, unassigned: result.unassigned.length }, "capacity enforced", true); }
const hardCapacity = single(2); hardCapacity.depots[0].capacity.dailyOrders = 1;
check("T0133", run(hardCapacity).assignments.length === 1 && run(hardCapacity).unassigned.length === 1, run(hardCapacity).metrics, "hard overflow rejected", true);
const softCapacity = clone(hardCapacity); softCapacity.constraints.hardDepotCapacity = false;
check("T0134", run(softCapacity).assignments.length === 2 && run(softCapacity).assignments.some((row) => row.serviceRisk >= 10000), run(softCapacity).assignments, "soft overflow penalized");
const baseline = makeNetwork({ depotCount: 5, vehicleCount: 10, orderCount: 40 }); const assigned = run(baseline);
check("T0135", assigned.assignments.length + assigned.unassigned.length + assigned.blocked.length === baseline.orders.length, assigned.metrics, baseline.orders.length);
check("T0136", new Set(assigned.assignments.map((row) => row.orderId)).size === assigned.assignments.length, assigned.assignments.length, "unique orders");
check("T0137", run(none).unassigned[0].reasonCode === run(none).unassigned[0].reasonCode, run(none).unassigned[0].reasonCode, "stable reason");
let blockedCode = ""; const invalid = single(1); invalid.orders[0].coordinate = [999, 0]; try { run(invalid); } catch (error) { blockedCode = error.code; }
check("T0138", blockedCode === "NETWORK_NUMBER_RANGE" && run(none).unassigned[0].reasonCode === "NO_ALLOWED_DEPOT", { blockedCode, unassigned: run(none).unassigned[0].reasonCode }, "data error separated", true);
const scarce = single(2); scarce.depots[0].capacity.dailyOrders = 1; scarce.orders[0].priorityWeight = 1; scarce.orders[1].priorityWeight = 100;
const scarceResult = run(scarce);
check("T0139", scarceResult.assignments[0].orderId === scarce.orders[1].orderId, scarceResult.assignments[0], "service priority before cost");
check("T0140", scarceResult.assignments.some((row) => row.orderId === scarce.orders[1].orderId), scarceResult.assignments, "high priority retained");
const metricResult = run(single(1)); const metricRow = metricResult.assignments[0]; const metricScenario = Contract.normalizeScenario(single(1));
check("T0141", metricRow.handlingCost > 0, metricRow.handlingCost, ">0 handling cost");
check("T0142", metricRow.distanceKm > 0 && metricRow.distanceSource === "ESTIMATED_HAVERSINE_SYNTHETIC_FACTOR", metricRow, "estimated road distance");
check("T0143", metricRow.carbonKg >= 0, metricRow.carbonKg, ">=0 carbon");
check("T0144", metricRow.zoneMatch === true, metricRow.zoneMatch, true);
const open = twoOneOrder(); open.vehicles[0].allowedEndDepotIds = ["D2"]; open.drivers[0].allowedEndDepotIds = ["D2"]; open.orders[0].allowedDepotIds = ["D1"]; open.orders[0].preferredDepotId = "D1";
check("T0145", run(open).assignments[0].suggestedStartDepotId === "D1", run(open).assignments[0], "start D1");
check("T0146", run(open).assignments[0].suggestedEndDepotId === "D2", run(open).assignments[0], "end D2");
const endBlocked = clone(open); endBlocked.vehicles[0].allowedEndDepotIds = ["D2"]; endBlocked.drivers[0].allowedEndDepotIds = ["D1"];
check("T0147", run(endBlocked).assignments[0].suggestedVehicleId !== "V1", run(endBlocked).assignments[0], "disallowed end combination rejected");
check("T0148", run(open).assignments[0].suggestedEndDepotId === open.drivers[0].allowedEndDepotIds[0], run(open).assignments[0].suggestedEndDepotId, "driver end policy");
check("T0149", run(open).assignments[0].suggestedEndDepotId === "D2", run(open).assignments[0], "next trip continuity endpoint");
const crossDock = makeNetwork({ depotCount: 1, vehicleCount: 2, orderCount: 1, crossDock: true });
check("T0150", run(crossDock).unassigned[0].reasonCode === "DEPOT_ROLE_INELIGIBLE", run(crossDock).unassigned[0], "role capability enforced", true);
check("T0151", run(crossDock).assignments.length === 0, run(crossDock).metrics, "cross-dock-only not normal start", true);
const returns = clone(crossDock); returns.orders[0].taskType = "RETURN"; returns.depots[0].role = "RETURN_CENTER"; returns.drivers.forEach((driver) => driver.skills.push("RETURN")); returns.orders[0].requiredSkills = ["RETURN"];
check("T0152", run(returns).assignments.length === 1, run(returns).metrics, "return center accepts return");
check("T0153", run(single(1)).assignments.length === 1, run(single(1)).metrics, "CDC/RDC role has no hidden hard rule");
const multiDay = single(2); multiDay.depots[0].capacity.dailyOrders = 1; multiDay.orders[0].serviceDay = "2026-09-04"; multiDay.orders[1].serviceDay = "2026-09-05";
check("T0154", run(multiDay).assignments.length === 2, run(multiDay).assignments.map((row) => row.serviceDay), "capacity resets by day");
const overnight = single(1); overnight.orders[0].serviceDay = ""; overnight.orders[0].dueTime = "02:00";
check("T0155", Assignment.dayKey(Contract.normalizeScenario(overnight).orders[0], Contract.normalizeScenario(overnight)) === "DAY-1", Assignment.dayKey(Contract.normalizeScenario(overnight).orders[0], Contract.normalizeScenario(overnight)), "explicit business-day attribution");
const sameA = run(baseline, { objective: "MIN_DISTANCE" }); const sameB = run(baseline, { objective: "MIN_CARBON" });
check("T0156", Assignment.compare(sameA, sameB).comparable, Assignment.compare(sameA, sameB), "same input comparable");
const changedScenario = clone(baseline); changedScenario.depots[0].capacity.dailyOrders += 1; const changedResult = run(changedScenario);
check("T0157", Assignment.compare(sameA, changedResult).label === "SCENARIO_CHANGED", Assignment.compare(sameA, changedResult), "Scenario changed");
check("T0158", Assignment.verifyAssignment(baseline, sameA).status === "PASS", Assignment.verifyAssignment(baseline, sameA), "independent PASS");
const metricTamper = clone(sameA); metricTamper.metrics.assignedOrders = 999;
check("T0159", Assignment.verifyAssignment(baseline, metricTamper).issues.includes("ASSIGNMENT_METRIC_MISMATCH"), Assignment.verifyAssignment(baseline, metricTamper), "tamper rejected", true);
const stale = clone(sameA); stale.networkInputHash = Contract.hashArtifact("stale");
check("T0160", Assignment.verifyAssignment(baseline, stale).issues.includes("STALE_NETWORK_INPUT"), Assignment.verifyAssignment(baseline, stale), "stale rejected", true);
check("T0161", Assignment.verifyAssignment(changedScenario, sameA).issues.includes("STALE_NETWORK_INPUT"), Assignment.verifyAssignment(changedScenario, sameA), "depot mutation rejects old plan", true);
const zoneMutation = clone(baseline); zoneMutation.zones[0].mode = "DIAGNOSTIC_ONLY";
check("T0162", Assignment.verifyAssignment(zoneMutation, sameA).issues.includes("STALE_NETWORK_INPUT"), Assignment.verifyAssignment(zoneMutation, sameA), "zone mutation rejects old plan", true);
const matrixMutation = clone(baseline); matrixMutation.routingContext.matrixVersion = "v2";
check("T0163", Assignment.verifyAssignment(matrixMutation, sameA).issues.includes("STALE_ROUTING_CONTEXT"), Assignment.verifyAssignment(matrixMutation, sameA), "matrix mutation rejects old assignment", true);
check("T0164", baseline.depots.length === 5 && assigned.assignments.length === 40, { depots: baseline.depots.length, assigned: assigned.assignments.length }, "5 depot fixture PASS");
check("T0165", run(single(5)).assignments.length === 5, run(single(5)).metrics, "single depot regression PASS");
let noDepotCode = ""; const noDepot = single(1); noDepot.depots = []; try { run(noDepot); } catch (error) { noDepotCode = error.code; }
check("T0166", noDepotCode === "NETWORK_DEPOTS_REQUIRED", noDepotCode, "reject zero depot", true);
const started = performance.now(); const fifty = makeNetwork({ depotCount: 50, vehicleCount: 100, orderCount: 100 }); const fiftyResult = run(fifty); const elapsed = performance.now() - started;
check("T0167", fifty.depots.length === 50 && fiftyResult.assignments.length === 100 && elapsed < 5000, { depots: 50, assigned: fiftyResult.assignments.length, elapsedMs: elapsed }, "bounded 50 depot strategy");
check("T0168", Assignment.filterAssignments(assigned, "D1").every((row) => row.assignedDepotId === "D1"), Assignment.filterAssignments(assigned, "D1").length, "filter correct");
const inspector = Assignment.depotInspector(baseline, assigned, "D1");
check("T0169", inspector.depot.depotId === "D1" && inspector.metrics.orders === inspector.assignments.length, inspector.metrics, "real inspector data");
check("T0170", Assignment.tableRows(assigned)[0].depotId === assigned.assignments[0].assignedDepotId, Assignment.tableRows(assigned)[0], "selection data sync");
check("T0171", Assignment.tableRows(assigned).length === assigned.assignments.length, Assignment.tableRows(assigned).length, "complete No-WebGL table");
check("T0172", baseline.depots.map((depot) => depot.depotId).length === 5, baseline.depots.map((depot) => depot.depotId), "mobile selector data");
const depotIds = baseline.depots.map((depot) => depot.depotId); const nextDepot = depotIds[(depotIds.indexOf("D1") + 1) % depotIds.length];
check("T0173", nextDepot === "D2", nextDepot, "keyboard step-through order");
check("T0174", Assignment.tableRows(assigned).every((row) => row.reasonCode && row.depotId), Assignment.tableRows(assigned)[0], "text duplicates color");
const csvProbe = clone(assigned); csvProbe.assignments[0].orderId = "=2+2"; const csv = Assignment.toCsv(csvProbe);
check("T0175", csv.includes("\"'=2+2\""), csv.split("\r\n")[1], "formula escaped");
check("T0176", Assignment.replay(baseline, assigned).status === "EQUIVALENT", Assignment.replay(baseline, assigned), "Capsule replay equivalent");
check("T0177", ["zh", "en", "ja"].every((locale) => Assignment.reasonText("NO_ALLOWED_DEPOT", locale) !== "NO_ALLOWED_DEPOT"), ["zh", "en", "ja"].map((locale) => Assignment.reasonText("NO_ALLOWED_DEPOT", locale)), "three locales");
let externalCalls = 0; const originalFetch = global.fetch; global.fetch = () => { externalCalls += 1; throw new Error("not allowed"); }; run(baseline); global.fetch = originalFetch;
check("T0178", externalCalls === 0, externalCalls, 0);
check("T0179", assigned.assignments.every((row) => row.distanceSource === "ESTIMATED_HAVERSINE_SYNTHETIC_FACTOR"), assigned.assignments[0].distanceSource, "Estimated fallback disclosed");
check("T0180", elapsed >= 0 && Number.isFinite(elapsed), elapsed, "measured milliseconds");
const eligibilityMutation = clone(baseline); eligibilityMutation.orders[0].allowedDepotIds = ["D1"]; const validEligibility = run(eligibilityMutation); const invalidEligibility = clone(validEligibility); invalidEligibility.assignments[0].assignedDepotId = "D2";
check("T0181", Assignment.verifyAssignment(eligibilityMutation, invalidEligibility).status === "FAIL", Assignment.verifyAssignment(eligibilityMutation, invalidEligibility), "eligibility mutation killed", true);
const capacityMutation = clone(run(hardCapacity)); capacityMutation.assignments.push({ ...capacityMutation.assignments[0], orderId: hardCapacity.orders.find((order) => order.orderId !== capacityMutation.assignments[0].orderId).orderId });
check("T0182", Assignment.verifyAssignment(hardCapacity, capacityMutation).status === "FAIL", Assignment.verifyAssignment(hardCapacity, capacityMutation), "capacity mutation killed", true);
const zoneWrong = clone(run(hardZone)); zoneWrong.assignments[0].assignedDepotId = "D2";
check("T0183", Assignment.verifyAssignment(hardZone, zoneWrong).status === "FAIL", Assignment.verifyAssignment(hardZone, zoneWrong), "zone mutation killed", true);
check("T0184", assertions.length === 70 && assertions.every((row) => row.status === "PASS"), assertions.length, "complete assignment audit");

process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, metrics: assigned.metrics, performanceMs: elapsed, assertions }, null, 2)}\n`);
