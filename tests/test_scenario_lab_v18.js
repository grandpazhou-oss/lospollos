#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Contract = require("../network-contract-v18.js");
const Network = require("../network-solver-v18.js");
const Scenario = require("../scenario-lab-v18.js");
const { makeNetwork } = require("./fixtures/network-v18-fixture.js");

const assertions = [];
function check(requirementId, condition, observed, expected, negative = false) {
  const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, negative, evidence: "tests/test_scenario_lab_v18.js" };
  assertions.push(row);
  assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
}
const clone = (value) => structuredClone(value);
function sourceFixture(orderCount = 20, depotCount = 2, vehicleCount = 4) {
  const source = makeNetwork({ depotCount, vehicleCount, orderCount });
  source.depots.forEach((depot) => {
    depot.capacity.dailyOrders = 100000;
    depot.capacity.volume = 100000;
    depot.capacity.weight = 100000;
    depot.capacity.handlingMinutes = 100000;
  });
  return source;
}

const source = sourceFixture();
const base = Scenario.baseline(source);
check("T0551", base.type === "BASELINE" && base.inputHash === Contract.identityBundle(source).networkInputHash, { type: base.type, inputHash: base.inputHash }, "canonical baseline scenario");

const added = Scenario.applyScenario(base, "ADD_DEPOT", { depotId: "D-TEST", name: "Test Depot", coordinate: [117.4, 39.2] });
check("T0552", added.scenario.depots.some((row) => row.depotId === "D-TEST") && added.scenario.docks.filter((row) => row.depotId === "D-TEST").length === 2, { depots: added.scenario.depots.length, docks: added.scenario.docks.length }, "depot and docks added");
const removed = Scenario.applyScenario(added, "REMOVE_DEPOT", { depotId: "D-TEST" });
check("T0553", !removed.scenario.depots.some((row) => row.depotId === "D-TEST") && removed.scenario.depots.length === base.scenario.depots.length, removed.scenario.depots.map((row) => row.depotId), "unused depot removed");
const capacityChanged = Scenario.applyScenario(base, "DEPOT_CAPACITY_CHANGE", { depotId: "D1", field: "volume", value: 7777 });
check("T0554", capacityChanged.scenario.depots.find((row) => row.depotId === "D1").capacity.volume === 7777, capacityChanged.scenario.depots[0].capacity, "depot capacity changed");
const typeAdded = Scenario.applyScenario(base, "ADD_VEHICLE_TYPE", { vehicleTypeId: "VT-HYBRID", capacity: { volume: 30, weight: 1500 }, cost: { fixed: 130, trip: 19, perKm: 0.9, perMinute: 0.19 }, emission: { loadedKgPerKm: 0.3, emptyKgPerKm: 0.2 } });
check("T0555", typeAdded.scenario.vehicleTypes.some((row) => row.vehicleTypeId === "VT-HYBRID") && typeAdded.scenario.depots.every((row) => row.allowedVehicleTypes.includes("VT-HYBRID")), typeAdded.scenario.vehicleTypes.map((row) => row.vehicleTypeId), "vehicle type added compatibly");
const mixChanged = Scenario.applyScenario(base, "FLEET_MIX_CHANGE", { depotId: "D1", vehicleTypeId: "VT-DIESEL", count: 2, capacity: { volume: 40, weight: 2000 } });
check("T0556", mixChanged.scenario.vehicles.length === base.scenario.vehicles.length + 2 && mixChanged.scenario.drivers.length === base.scenario.drivers.length + 2, { vehicles: mixChanged.scenario.vehicles.length, drivers: mixChanged.scenario.drivers.length }, "fleet mix adds paired vehicle and driver resources");
const demandPeak = Scenario.applyScenario(base, "DEMAND_PEAK", { factor: 1.25 });
check("T0557", demandPeak.scenario.orders[0].demand.volume === base.scenario.orders[0].demand.volume * 1.25, demandPeak.scenario.orders[0].demand, "demand peak applied");
const zoneChanged = Scenario.applyScenario(base, "ZONE_CHANGE", { zoneId: "Z1", mode: "PREFERRED", depotIds: ["D1", "D2"] });
check("T0558", zoneChanged.scenario.zones.find((row) => row.zoneId === "Z1").mode === "PREFERRED" && zoneChanged.scenario.zones.find((row) => row.zoneId === "Z1").depotIds.length === 2, zoneChanged.scenario.zones.find((row) => row.zoneId === "Z1"), "zone policy changed");
const dockChanged = Scenario.applyScenario(base, "DOCK_CAPACITY_CHANGE", { dockId: "DOCK-1-A", value: 3 });
check("T0559", dockChanged.scenario.docks.find((row) => row.dockId === "DOCK-1-A").simultaneousCapacity === 3, dockChanged.scenario.docks.find((row) => row.dockId === "DOCK-1-A"), "dock capacity changed");
const waveChanged = Scenario.applyScenario(base, "WAVE_POLICY_CHANGE", { wavePolicy: "PRIORITY" });
check("T0560", waveChanged.scenario.policies.wavePolicy === "PRIORITY", waveChanged.scenario.policies.wavePolicy, "wave policy changed");
const closureChanged = Scenario.applyScenario(base, "ROAD_CLOSURE", { closureId: "CLOSE-1", from: "A", to: "B" });
check("T0561", closureChanged.scenario.routingContext.closures.some((row) => row.closureId === "CLOSE-1" && row.status === "CLOSED") && Contract.identityBundle(closureChanged.scenario).routingContextHash !== Contract.identityBundle(base.scenario).routingContextHash, { closures: closureChanged.scenario.routingContext.closures, routingContextHash: Contract.identityBundle(closureChanged.scenario).routingContextHash }, "road closure recorded in routing identity");
const crossDockChanged = Scenario.applyScenario(base, "CROSS_DOCK_ENABLE", { depotId: "D2" });
check("T0562", crossDockChanged.scenario.depots.find((row) => row.depotId === "D2").transferSupported && crossDockChanged.scenario.policies.crossDockEnabled, crossDockChanged.scenario.depots.find((row) => row.depotId === "D2"), "cross-dock enabled");
check("T0563", [added, capacityChanged, typeAdded, mixChanged, demandPeak, zoneChanged, dockChanged, waveChanged, crossDockChanged].every((row) => row.inputHash !== base.inputHash), "business scenario mutations changed network input hash", "different scenario input hashes");
check("T0564", Scenario.compareResults({ networkInputHash: base.inputHash }, { networkInputHash: base.inputHash }).wording === "SAME_INPUT_OPTIMIZATION", Scenario.compareResults({ networkInputHash: base.inputHash }, { networkInputHash: base.inputHash }), "same-input optimization wording");
check("T0565", Scenario.compareResults({ networkInputHash: base.inputHash }, { networkInputHash: demandPeak.inputHash }).wording === "SCENARIO_CHANGED", Scenario.compareResults({ networkInputHash: base.inputHash }, { networkInputHash: demandPeak.inputHash }), "different-input Scenario Changed wording");
check("T0566", demandPeak.parentScenarioId === base.scenarioId && demandPeak.parentInputHash === base.inputHash && demandPeak.revision === base.revision + 1, { parentScenarioId: demandPeak.parentScenarioId, parentInputHash: demandPeak.parentInputHash, revision: demandPeak.revision }, "scenario lineage");
let state = Scenario.history(source); state = Scenario.pushHistory(state, "DEMAND_PEAK", { factor: 1.1 });
check("T0567", Scenario.restoreBaseline(state).inputHash === base.inputHash && Scenario.restoreBaseline(state).type === "BASELINE", Scenario.restoreBaseline(state), "restore baseline");
const changedInputHash = Scenario.active(state).inputHash; state = Scenario.undo(state);
check("T0568", Scenario.active(state).inputHash === base.inputHash && Scenario.active(state).inputHash !== changedInputHash, { cursor: state.cursor, active: Scenario.active(state).inputHash }, "undo to prior scenario");
check("T0569", Scenario.resultStaleness(demandPeak, { networkInputHash: base.inputHash }).status === "STALE_REJECTED", Scenario.resultStaleness(demandPeak, { networkInputHash: base.inputHash }), "stale scenario result rejected", true);

const mixPayload = { depotId: "D1", vehicleTypeId: "VT-DIESEL", count: 2, capacity: { volume: 40, weight: 2000 }, cost: { fixed: 100 }, emission: { loadedKgPerKm: 0.5 } };
const mixResult = Scenario.evaluateFleetMix(base, mixPayload, { maxStopsPerTrip: 4 });
check("T0570", mixResult.metrics.vehicles === source.vehicles.length + 2, mixResult.metrics.vehicles, "fleet mix vehicle count");
check("T0571", mixResult.typeCompatibility === true, mixResult.typeCompatibility, "fleet mix type compatibility");
check("T0572", mixResult.metrics.peakRequirement >= 0 && mixResult.configuration.capacity.volume === 40, { peakRequirement: mixResult.metrics.peakRequirement, capacity: mixResult.configuration.capacity }, "fleet mix capacity is evaluated");
check("T0573", Number.isFinite(mixResult.metrics.cost) && mixResult.metrics.cost > 0 && Boolean(mixResult.accountingHash), mixResult.metrics.cost, "fleet mix cost");
check("T0574", Number.isFinite(mixResult.metrics.carbonKg) && mixResult.metrics.carbonKg > 0, mixResult.metrics.carbonKg, "fleet mix carbon");
check("T0575", Object.values(mixResult.depotAllocation).reduce((sum, value) => sum + value, 0) === mixResult.metrics.vehicles && mixResult.depotAllocation.D1 >= 2, mixResult.depotAllocation, "fleet mix depot allocation");
check("T0576", Number.isFinite(mixResult.metrics.service) && mixResult.metrics.service >= 0 && mixResult.metrics.service <= 1, mixResult.metrics.service, "fleet mix service");
check("T0577", Number.isInteger(mixResult.metrics.trips) && mixResult.metrics.trips > 0, mixResult.metrics.trips, "fleet mix trips");
check("T0578", Number.isFinite(mixResult.metrics.dockCongestion) && mixResult.metrics.dockCongestion >= 0, mixResult.metrics.dockCongestion, "fleet mix dock congestion");
check("T0579", Number.isFinite(mixResult.metrics.emptyDistanceKm) && mixResult.metrics.emptyDistanceKm >= 0, mixResult.metrics.emptyDistanceKm, "fleet mix empty distance");
check("T0580", mixResult.label === "Best found in tested configurations", mixResult.label, "tested configuration wording");
check("T0581", mixResult.optimalityWording === "Not a global fleet optimum.", mixResult.optimalityWording, "explicitly not a global optimum");

const shock10 = Scenario.applyShock(base, "DEMAND_10");
const shock25 = Scenario.applyShock(base, "DEMAND_25");
const shock50 = Scenario.applyShock(base, "DEMAND_50");
check("T0582", shock10.scenario.orders[0].demand.volume === base.scenario.orders[0].demand.volume * 1.1, shock10.scenario.orders[0].demand.volume, "demand +10%");
check("T0583", shock25.scenario.orders[0].demand.volume === base.scenario.orders[0].demand.volume * 1.25, shock25.scenario.orders[0].demand.volume, "demand +25%");
check("T0584", shock50.scenario.orders[0].demand.volume === base.scenario.orders[0].demand.volume * 1.5, shock50.scenario.orders[0].demand.volume, "demand +50%");
const regional = Scenario.applyShock(base, "REGIONAL_PEAK", { zoneId: "Z1", factor: 1.5 });
check("T0585", regional.scenario.orders.filter((row) => row.zoneId === "Z1").every((row) => row.demand.volume > base.scenario.orders.find((item) => item.orderId === row.orderId).demand.volume) && regional.scenario.orders.filter((row) => row.zoneId !== "Z1").every((row) => row.demand.volume === base.scenario.orders.find((item) => item.orderId === row.orderId).demand.volume), regional.scenario.orders.slice(0, 4).map((row) => ({ orderId: row.orderId, zoneId: row.zoneId, volume: row.demand.volume })), "regional peak only changes selected zone");
const tightened = Scenario.applyShock(base, "TIME_WINDOW_TIGHTEN", { start: "10:00", end: "12:00" });
check("T0586", tightened.scenario.orders.every((row) => row.timeWindows[0].start === "10:00" && row.timeWindows[0].end === "12:00"), tightened.scenario.orders[0].timeWindows, "time-window tightening");
const outage = Scenario.applyShock(base, "DEPOT_OUTAGE", { depotId: "D1" });
check("T0587", outage.scenario.vehicles.filter((row) => row.homeDepotId === "D1").every((row) => row.availabilityWindows.length === 0), outage.scenario.vehicles.filter((row) => row.homeDepotId === "D1").map((row) => row.availabilityWindows), "depot outage disables home fleet");
const dockFailure = Scenario.applyShock(base, "DOCK_FAILURE", { depotId: "D1" });
check("T0588", dockFailure.scenario.docks.filter((row) => row.depotId === "D1").every((row) => row.type === "UNLOAD"), dockFailure.scenario.docks.filter((row) => row.depotId === "D1"), "dock failure removes load capability");

const shockResult = Scenario.evaluateShock(base, "DEMAND_10", {}, { maxStopsPerTrip: 4 });
check("T0589", Number.isInteger(shockResult.propagation.assignment.assigned) && Number.isInteger(shockResult.propagation.assignment.unassigned), shockResult.propagation.assignment, "shock assignment propagation");
check("T0590", Number.isFinite(shockResult.propagation.dock.reservationCount) && Number.isFinite(shockResult.propagation.dock.congestionReservations), shockResult.propagation.dock, "shock dock propagation");
check("T0591", Number.isFinite(shockResult.propagation.wave.waveCount), shockResult.propagation.wave, "shock wave propagation");
check("T0592", Number.isFinite(shockResult.propagation.trip.tripCount) && Number.isFinite(shockResult.propagation.route.distanceKm), { trip: shockResult.propagation.trip, route: shockResult.propagation.route }, "shock trip and route propagation");
check("T0593", Number.isFinite(shockResult.propagation.service) && shockResult.propagation.service >= 0 && shockResult.propagation.service <= 1, shockResult.propagation.service, "shock service propagation");
check("T0594", Number.isFinite(shockResult.propagation.cost) && shockResult.propagation.cost > 0, shockResult.propagation.cost, "shock cost propagation");
check("T0595", Number.isFinite(shockResult.propagation.carbonKg) && shockResult.propagation.carbonKg > 0, shockResult.propagation.carbonKg, "shock carbon propagation");
check("T0596", Array.isArray(shockResult.propagation.alerts), shockResult.propagation.alerts, "shock alerts propagation");

const frontierMetrics = { service: 1, cost: 100, carbonKg: 20, vehicles: 4, trips: 5, dockCongestion: 0, emptyDistanceKm: 2, transferCount: 0, latestCompletion: 900, blockedCount: 0, serviceLayer: "SERVICE_FIRST" };
const candidateA = { scenarioId: "A", networkInputHash: base.inputHash, metrics: frontierMetrics };
const candidateB = { scenarioId: "B", networkInputHash: base.inputHash, metrics: { ...frontierMetrics, cost: 110, carbonKg: 25 } };
const candidateDifferentInput = { scenarioId: "C", networkInputHash: demandPeak.inputHash, metrics: { ...frontierMetrics, cost: 90 } };
const candidateDifferentLayer = { scenarioId: "D", networkInputHash: base.inputHash, metrics: { ...frontierMetrics, serviceLayer: "COST_FIRST" } };
const candidateBlocked = { scenarioId: "E", networkInputHash: base.inputHash, metrics: { ...frontierMetrics, blockedCount: 1 } };
const frontier = Scenario.observedFrontier([candidateA, candidateB, candidateDifferentInput, candidateDifferentLayer, candidateBlocked]);
check("T0597", frontier.sameInputHash === base.inputHash && frontier.excluded === 3 && frontier.frontier.every((row) => row.networkInputHash === base.inputHash), { sameInputHash: frontier.sameInputHash, excluded: frontier.excluded }, "network Pareto same input only");
check("T0598", frontier.serviceLayer === "SERVICE_FIRST" && frontier.frontier.every((row) => row.metrics.serviceLayer === frontier.serviceLayer), frontier.serviceLayer, "service layer equal");
check("T0599", frontier.blockedCount === 0 && frontier.frontier.every((row) => row.metrics.blockedCount === frontier.blockedCount), frontier.blockedCount, "blocked count equal");
check("T0600", frontier.frontier.length === 1 && frontier.frontier[0].scenarioId === "A", frontier.frontier.map((row) => row.scenarioId), "dominance uses service MAX and burdens MIN");
const missingMetric = { scenarioId: "MISSING", networkInputHash: base.inputHash, metrics: { ...frontierMetrics } }; delete missingMetric.metrics.carbonKg;
const missingFrontier = Scenario.observedFrontier([candidateA, missingMetric]);
check("T0601", missingFrontier.excluded === 1 && missingFrontier.frontier.length === 1, missingFrontier, "missing metric excluded", true);

const sync = Scenario.arenaSync(shock10, shockResult);
check("T0602", sync.map.depotCount === shock10.scenario.depots.length && sync.map.closureCount === shock10.scenario.routingContext.closures.length, sync.map, "Scenario Arena map sync");
check("T0603", sync.trips.count === shockResult.propagation.trip.tripCount, sync.trips, "Scenario Arena trip sync");
check("T0604", sync.docks.count === shock10.scenario.docks.length && sync.docks.congestion === shockResult.propagation.dock.congestionReservations, sync.docks, "Scenario Arena dock sync");
check("T0605", sync.heatmap.points === shock10.scenario.orders.length && sync.heatmap.source === "CANONICAL_SCENARIO_DEMAND", sync.heatmap, "Scenario Arena heatmap sync");
const mobile = Scenario.mobileCompare(mixResult, shockResult);
check("T0606", mobile.layout === "STACKED_SCENARIO_SHEETS" && mobile.rows.length === 2 && mobile.closeAction === "RETURN_TO_SCENARIO_LIST", mobile, "mobile scenario compare");
const table = Scenario.scenarioTable([mixResult, shockResult]);
check("T0607", table.length === 2 && table.every((row) => row.networkInputHash && Number.isFinite(row.cost)), table, "no-WebGL scenario table");
check("T0608", Scenario.animationPolicy(true).animatePropagation === false && Scenario.animationPolicy(true).staticRelationsVisible === true, Scenario.animationPolicy(true), "reduced-motion static compare");
check("T0609", Scenario.networkStory(mixResult).autoApply === false && Scenario.networkStory(mixResult).applyRequiresConfirmation === true, Scenario.networkStory(mixResult), "network story no auto apply");
const basePlan = Network.solveNetwork(source, { maxStopsPerTrip: 4 });
const drilldown = Scenario.costDrilldown(source, basePlan);
check("T0610", [drilldown.order, drilldown.zone, drilldown.depot, drilldown.trip, drilldown.wave, drilldown.vehicleType].every((rows) => Array.isArray(rows) && rows.length > 0) && Boolean(drilldown.accountingHash), { allocationMethod: drilldown.allocationMethod, dimensions: ["order", "zone", "depot", "trip", "wave", "vehicleType"].map((key) => drilldown[key].length) }, "cost-to-serve drilldown");
const mixExport = JSON.parse(Scenario.exportResult("FLEET_MIX", mixResult));
check("T0611", mixExport.schemaVersion === "stct-fleet_mix-export-v1.8" && mixExport.networkInputHash === mixResult.networkInputHash && Boolean(mixExport.exportHash), { schemaVersion: mixExport.schemaVersion, exportHash: mixExport.exportHash }, "fleet mix export");
const shockExport = JSON.parse(Scenario.exportResult("SHOCK", shockResult));
check("T0612", shockExport.schemaVersion === "stct-shock-export-v1.8" && shockExport.networkInputHash === shockResult.networkInputHash && Boolean(shockExport.exportHash), { schemaVersion: shockExport.schemaVersion, exportHash: shockExport.exportHash }, "shock export");
const capsule = Scenario.createCapsule(shock10, shockResult);
check("T0613", Scenario.replay(capsule).status === "EQUIVALENT" && capsule.networkInputHash === shock10.inputHash, { replay: Scenario.replay(capsule), capsuleHash: capsule.capsuleHash }, "Scenario Capsule replay");
check("T0614", !Scenario.observedFrontier([candidateA, candidateDifferentInput]).frontier.some((row) => row.scenarioId === "C") && Scenario.observedFrontier([candidateA, candidateDifferentInput]).excluded === 1, Scenario.observedFrontier([candidateA, candidateDifferentInput]), "different-input frontier mutation caught", true);
check("T0615", Scenario.validateNarrative("Globally optimal network plan").status === "REJECTED" && Scenario.validateNarrative("Best found in tested configurations").status === "PASS", { rejected: Scenario.validateNarrative("Globally optimal network plan"), accepted: Scenario.validateNarrative("Best found in tested configurations") }, "global-optimum label mutation caught", true);
const scenarioStarted = performance.now(); Scenario.applyScenario(base, "DEMAND_PEAK", { factor: 1.1 }); const scenarioElapsed = performance.now() - scenarioStarted;
check("T0616", Number.isFinite(scenarioElapsed) && scenarioElapsed >= 0, scenarioElapsed, "scenario mutation performance measured");
const fiveHundredSource = sourceFixture(500, 1, 100); fiveHundredSource.docks.forEach((dock) => { dock.simultaneousCapacity = 100; }); const fiveHundredBase = Scenario.baseline(fiveHundredSource); const largeStarted = performance.now(); const fiveHundredShock = Scenario.evaluateShock(fiveHundredBase, "DEMAND_10", {}, { maxStopsPerTrip: 10, maxOrders: 500 }); const largeElapsed = performance.now() - largeStarted;
check("T0617", fiveHundredShock.propagation.assignment.assigned === 500 && Number.isFinite(largeElapsed), { assigned: fiveHundredShock.propagation.assignment.assigned, elapsedMs: largeElapsed }, "500-order demand shock");
check("T0618", ["zh", "en", "ja"].every((locale) => ["BASELINE", "FLEET_MIX", "DEMAND_SHOCK", "SCENARIO_CHANGED", "TESTED_CONFIGURATION"].every((code) => Scenario.term(code, locale) !== code)), ["zh", "en", "ja"].map((locale) => Scenario.term("DEMAND_SHOCK", locale)), "Chinese English Japanese labels");
check("T0619", shockResult.audit.length === 2 && shockResult.audit[0].action === "CAPTURE_BASELINE" && shockResult.audit[1].action === "APPLY_SCENARIO" && shockResult.planHash && shockResult.accountingHash, { audit: shockResult.audit, planHash: shockResult.planHash, accountingHash: shockResult.accountingHash }, "complete scenario audit");

assert.strictEqual(assertions.length, 69, "Gate 8 must contain exactly T0551-T0619");
process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, scenarioPerformanceMs: scenarioElapsed, largeFixtureMs: largeElapsed, baselineInputHash: base.inputHash, fleetMix: mixResult.metrics, shock: shockResult.propagation, assertions }, null, 2)}\n`);
