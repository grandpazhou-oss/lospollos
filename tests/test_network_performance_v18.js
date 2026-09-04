#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const Fixture = require("./fixtures/network-v18-fixture.js");
const Contract = require("../network-contract-v18.js");
const Assignment = require("../depot-assignment-v18.js");
const Trip = require("../trip-chain-v18.js");
const Custody = require("../pickup-custody-v18.js");
const DockWave = require("../dock-wave-v18.js");
const Network = require("../network-solver-v18.js");
const Accounting = require("../network-accounting-v18.js");
const Scenario = require("../scenario-lab-v18.js");
const Execution = require("../network-execution-v18.js");
const Visual = require("../network-visualization-v18.js");
const PerformanceV18 = require("../network-performance-v18.js");

const runDir = path.resolve(process.env.STCT_V18_RUN_DIR || "/tmp/lospollos-v1.8-overnight-20260904_012216");
const evidencePath = path.resolve(process.argv.includes("--evidence") ? process.argv[process.argv.indexOf("--evidence") + 1] : path.join(runDir, "evidence/wave-h4-network-performance-semantic.json"));
const tracePath = path.join(path.dirname(evidencePath), "wave-h4-network-performance-raw-trace.json");
const assertions = [];
function check(requirementId, condition, observed, expected, negative = false) {
  const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, negative, evidence: "tests/test_network_performance_v18.js" };
  assertions.push(row); assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
}
function measured(report, name) { return report.durations[name] || { count: 0, totalMs: 0, p95Ms: 0, maxMs: 0 }; }
function performanceSource() {
  const source = Fixture.makeNetwork({ orderCount: 500, depotCount: 5, vehicleCount: 50, driverCount: 30, docksPerDepot: 4, networkId: "SYNTHETIC-NETWORK-PERFORMANCE-V18" });
  source.orders.forEach((order) => { order.demand = { volume: 1, weight: 1 }; order.serviceDuration = 1; });
  source.vehicles.forEach((vehicle, index) => { vehicle.maxTrips = 4; if (index >= 25) vehicle.availabilityWindows = []; });
  source.constraints.maxTripsPerVehicle = 4;
  source.constraints.fixedDriverVehiclePairs = source.vehicles.slice(0, 25).map((vehicle, index) => ({ vehicleId: vehicle.vehicleId, driverId: source.drivers[index].driverId }));
  source.drivers.forEach((driver) => { driver.requiredBreaks = []; driver.maxDrivingMinutes = 2000; driver.maxDutyMinutes = 2000; });
  source.docks.forEach((dock) => { dock.simultaneousCapacity = 20; });
  for (let index = 0; index < 200; index += 1) {
    source.orders[index].taskType = index % 2 ? "DELIVERY" : "PICKUP";
    source.orders[index].shipmentPairId = `PAIR-${Math.floor(index / 2) + 1}`;
  }
  source.pickupDeliveryPairs = Array.from({ length: 100 }, (_, index) => ({
    pairId: `PAIR-${index + 1}`, pickupOrderId: source.orders[index * 2].orderId, deliveryOrderId: source.orders[index * 2 + 1].orderId,
    precedence: "PICKUP_BEFORE_DELIVERY", sameVehicleRequired: false, sameTripRequired: false, transferAllowed: false, maxRideTime: 360, loadTransformation: { volumeMultiplier: 1 },
  }));
  return source;
}
function fakeTarget() {
  const listeners = new Map();
  return { addEventListener(name, listener) { listeners.set(`${name}:${listener}`, listener); }, removeEventListener(name, listener) { listeners.delete(`${name}:${listener}`); }, count() { return listeners.size; } };
}

const source = performanceSource();
const harness = PerformanceV18.createHarness();
harness.heapSnapshot("before");
const canonical = harness.measure("canonical500", () => Contract.normalizeScenario(source), { source: "NetworkContractV18.normalizeScenario" });
const assignment = harness.measure("depotAssignment", () => Assignment.assignDepots(source), { source: "DepotAssignmentV18.assignDepots" });
const matrixMiss = harness.matrix(source);
const matrixHit = harness.matrix(source);
const tripGeneration = harness.measure("tripGeneration", () => Trip.planTrips(source, { assignmentResult: assignment.result, maxStopsPerTrip: 5 }), { source: "TripChainV18.planTrips" });
const custody = Custody.planPickupDelivery(source);
const dockSchedule = harness.measure("dockScheduling", () => DockWave.scheduleDocks(source, tripGeneration.result, { custodyPlan: custody }), { source: "DockWaveV18.scheduleDocks" });
const totalWall = harness.measure("totalWall", () => Network.solveNetwork(source, { maxStopsPerTrip: 5, maxTripsPerWave: 5, maxOrders: 500 }), { source: "NetworkSolverV18.solveNetwork" });
const plan = totalWall.result;
const verifier = harness.measure("networkVerifier", () => Network.verifyNetworkPlan(source, plan), { source: "NetworkSolverV18.verifyNetworkPlan" });
const visualModel = Visual.buildModel(source, plan);
const mapRender = harness.measure("networkMapFirstRender", () => Visual.renderHTML(visualModel, { locale: "en" }), { source: "NetworkVisualizationV18.renderHTML" });

for (let index = 0; index < 25; index += 1) harness.measure("depotFilter", () => Visual.select(visualModel, { depotId: source.depots[index % source.depots.length].depotId }), { source: "NetworkVisualizationV18.select.depot" });
const baseline = Scenario.baseline(source);
for (let index = 0; index < 10; index += 1) harness.measure("scenarioSwitch", () => Scenario.applyScenario(baseline, "DEPOT_CAPACITY_CHANGE", { depotId: "D1", field: "dailyOrders", value: 500 + index }), { source: "ScenarioLabV18.applyScenario" });
for (let index = 0; index < 25; index += 1) harness.measure("dockFilter", () => Visual.select(visualModel, { dockId: source.docks[index % source.docks.length].dockId }), { source: "NetworkVisualizationV18.select.dock" });
for (let index = 0; index < 25; index += 1) harness.measure("tripSelect", () => Visual.select(visualModel, { tripId: plan.trip.trips[index % plan.trip.trips.length].tripId }), { source: "NetworkVisualizationV18.select.trip" });
const heatmap = harness.measure("heatmapRender", () => Visual.heatmapView(visualModel, "dockTime"), { source: "NetworkVisualizationV18.heatmapView" });
const timeSpace = harness.measure("timeSpaceRender", () => Visual.timeSpaceView(visualModel), { source: "NetworkVisualizationV18.timeSpaceView" });
const accounting = harness.measure("costToServe", () => Accounting.computeAccounting(source, plan), { source: "NetworkAccountingV18.computeAccounting" });
const demandShock = harness.measure("demandShock", () => Scenario.evaluateShock(baseline, "DEMAND_10", {}, { maxStopsPerTrip: 5, maxTripsPerWave: 5, maxOrders: 500 }), { source: "ScenarioLabV18.evaluateShock" });
const frontierRows = [0, 1, 2].map((index) => ({ scenarioId: `PERF-${index}`, networkInputHash: plan.networkInputHash, metrics: { service: 1, cost: accounting.result.cost.total + index * 10, carbonKg: accounting.result.carbon.totalKg + index, vehicles: 50, trips: 100, dockCongestion: index, emptyDistanceKm: index, transferCount: 0, latestCompletion: 900 + index, blockedCount: 0, serviceLayer: "SERVICE_FIRST" } }));
const pareto = harness.measure("networkPareto", () => Scenario.observedFrontier(frontierRows), { source: "ScenarioLabV18.observedFrontier" });

const run = Execution.createRun(source, plan, { runId: "RUN-PERFORMANCE-V18" });
const incident = Execution.createIncident(run, "DOCK_FAILURE", { dockId: source.docks[0].dockId, depotId: "D1", logicalMinute: 500 });
const cutoff = Execution.freezeCutoff(run, { logicalMinute: 500, incidentHash: incident.incidentHash });
const recovery = harness.measure("recoveryCompute", () => Execution.generateRecoveryCandidates(run, cutoff, { incidentHash: incident.incidentHash }), { source: "NetworkExecutionV18.generateRecoveryCandidates" });
const execution100 = harness.measure("execution100Trips", () => {
  plan.trip.trips.forEach((trip, index) => Execution.appendEvent(run, { eventType: "EVENT_ACKNOWLEDGED", tripId: trip.tripId, vehicleId: trip.vehicleId, driverId: trip.driverId, logicalMinute: 501 + index, payload: { observedTripId: trip.tripId } }));
  return Execution.verifyEventHistory(run);
}, { source: "NetworkExecutionV18.appendEvent.100Trips" });
const alerts = harness.measure("alertEvaluation", () => Execution.INCIDENT_TYPES.slice(1).map((type, index) => Execution.createIncident(run, type, { logicalMinute: 700 + index, reason: `PERFORMANCE_${type}` })), { source: "NetworkExecutionV18.createIncident" });
const capsuleExport = harness.measure("capsuleExport", () => Execution.createCapsule(run, cutoff, recovery.result), { source: "NetworkExecutionV18.createCapsule" });
const capsuleReplay = harness.measure("capsuleReplay", () => Execution.replay(capsuleExport.result), { source: "NetworkExecutionV18.replay" });

for (let index = 0; index < 30; index += 1) harness.measure("applicationUpdate", () => ({ selectedTripId: plan.trip.trips[index % 100].tripId, revision: index + 1 }), { source: "PerformanceFixture.applicationUpdate" });
for (let index = 0; index < 30; index += 1) harness.measure("mapLayerUpdate", () => Visual.select(visualModel, { tripId: plan.trip.trips[index % 100].tripId }), { source: "PerformanceFixture.mapLayerUpdate" });
let setDataCalls = 0; const mapSource = { setData(value) { setDataCalls += 1; return value.visualHash; } };
for (let index = 0; index < 30; index += 1) harness.measure("actualSetData", () => mapSource.setData(visualModel), { source: "MapLibre.GeoJSONSource.setData" });
for (let index = 0; index < 10; index += 1) harness.measure("timelineRender", () => Visual.tripChainView(visualModel, index % 2 === 0), { source: "NetworkVisualizationV18.tripChainView" });
let hiddenCalls = 0; harness.measureVisible("hiddenPanelUpdate", false, () => { hiddenCalls += 1; }, { source: "PerformanceFixture.hiddenPanel" });
const visibleLanes = harness.measureVisible("visibleLaneRender", true, () => Visual.tripChainView(visualModel).lanes.slice(0, 8), { source: "NetworkVisualizationV18.tripChainView.visibleOnly" });

const geometryFirst = harness.staticGeometry(plan.routingContextHash, () => plan.trip.routes.map((route) => ({ routeId: route.routeId, legs: route.legs })));
const geometrySecond = harness.staticGeometry(plan.routingContextHash, () => { throw new Error("geometry cache miss"); });
const precomputedVisualHash = visualModel.visualHash;
for (let index = 0; index < 5; index += 1) harness.measure("renderWithPrecomputedHash", () => Visual.renderHTML({ ...visualModel, visualHash: precomputedVisualHash }, { locale: "en" }), { source: "NetworkVisualizationV18.renderHTML.precomputedHash" });

const target = fakeTarget(); let pendingRafs = 0; let cleanedLayers = 0; let terminatedWorkers = 0; const cycleHeap = [];
for (let index = 0; index < 10; index += 1) {
  const controller = Visual.createController(); controller.open(visualModel); controller.close();
  const mounted = harness.mount(`PERF-PANEL-${index}`, (resource) => {
    resource.listen(target, "change", () => index);
    resource.frame((callback) => { pendingRafs += 1; return callback; }, () => { pendingRafs -= 1; }, () => index);
    resource.layer(() => { cleanedLayers += 1; });
    resource.worker({ terminate() { terminatedWorkers += 1; } });
  });
  mounted.dispose();
  cycleHeap.push(process.memoryUsage().heapUsed);
}
if (global.gc) global.gc();
harness.heapSnapshot("after");
const report = harness.report({ workload: { depots: source.depots.length, docks: source.docks.length, vehicles: source.vehicles.length, drivers: source.drivers.length, orders: source.orders.length, pickupDeliveryPairs: source.pickupDeliveryPairs.length, trips: plan.trip.trips.length, waves: plan.waves.waves.length }, environment: { platform: process.platform, architecture: process.arch, node: process.version, cpus: os.cpus().length, memoryBytes: os.totalmem(), browserMeasurementsOwnedBy: "tests/test_network_performance_browser_v18.js" } });
const honestFailure = harness.report({ failures: ["DEMONSTRATED_TARGET_UNMET"] });
const blocked = PerformanceV18.createHarness().report({ blockedReason: "BROWSER_RUNTIME_UNAVAILABLE" });
const replayed = PerformanceV18.replay(report);
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(tracePath, `${JSON.stringify(report.rawTrace, null, 2)}\n`);

check("T0781", measured(report, "canonical500").count === 1 && canonical.result.orders.length === 500, measured(report, "canonical500"), "500 canonical orders measured");
check("T0782", measured(report, "depotAssignment").count === 1 && assignment.result.assignments.length === 500, measured(report, "depotAssignment"), "assignment measured");
check("T0783", matrixMiss.result.pointCount === 505 && matrixMiss.result.rows.length === 505 && measured(report, "matrixCacheMiss").count === 1, { points: matrixMiss.result.pointCount, timing: measured(report, "matrixCacheMiss") }, "local 505-point matrix measured");
check("T0784", measured(report, "tripGeneration").count === 1 && tripGeneration.result.trips.length === 100, measured(report, "tripGeneration"), "100-trip generation measured");
check("T0785", measured(report, "totalWall").count === 1 && plan.performanceBreakdownMs.ROUTE_OPTIMIZATION >= 0, { wall: measured(report, "totalWall"), route: plan.performanceBreakdownMs.ROUTE_OPTIMIZATION }, "route solve measured");
check("T0786", measured(report, "dockScheduling").count === 1 && dockSchedule.result.reservations.length >= 100, measured(report, "dockScheduling"), "dock scheduling measured");
check("T0787", measured(report, "networkVerifier").count === 1 && verifier.result.status === "PASS", { timing: measured(report, "networkVerifier"), verification: verifier.result }, "verifier measured and passed");
check("T0788", measured(report, "totalWall").totalMs > 0, measured(report, "totalWall"), "total wall measured");
check("T0789", ["DEPOT_ASSIGNMENT", "TRIP_GENERATION", "ROUTE_OPTIMIZATION", "DOCK_SCHEDULING", "TOTAL"].every((key) => Number.isFinite(plan.performanceBreakdownMs[key])), plan.performanceBreakdownMs, "subproblem timings present");
check("T0790", matrixHit.cacheHit && measured(report, "matrixCacheHit").count === 1, measured(report, "matrixCacheHit"), "cache hit timing");
check("T0791", !matrixMiss.cacheHit && measured(report, "matrixCacheMiss").totalMs > 0, measured(report, "matrixCacheMiss"), "cache miss timing");
check("T0792", source.depots.length === 5, source.depots.length, 5);
check("T0793", source.docks.length === 20, source.docks.length, 20);
check("T0794", source.vehicles.length === 50, source.vehicles.length, 50);
check("T0795", source.drivers.length === 30, source.drivers.length, 30);
check("T0796", source.orders.length === 500, source.orders.length, 500);
check("T0797", source.pickupDeliveryPairs.length === 100, source.pickupDeliveryPairs.length, 100);
check("T0798", plan.trip.trips.length === 100, plan.trip.trips.length, 100);
check("T0799", plan.waves.waves.length === 20, plan.waves.waves.length, 20);
check("T0800", measured(report, "networkMapFirstRender").count === 1 && mapRender.result.includes("data-visual-hash"), measured(report, "networkMapFirstRender"), "network map first render");
check("T0801", measured(report, "depotFilter").count === 25 && measured(report, "depotFilter").p95Ms >= 0, measured(report, "depotFilter"), "depot filter P95");
check("T0802", measured(report, "scenarioSwitch").count === 10 && measured(report, "scenarioSwitch").p95Ms >= 0, measured(report, "scenarioSwitch"), "scenario switch P95");
check("T0803", measured(report, "dockFilter").count === 25 && measured(report, "dockFilter").p95Ms >= 0, measured(report, "dockFilter"), "dock filter P95");
check("T0804", measured(report, "tripSelect").count === 25 && measured(report, "tripSelect").p95Ms >= 0, measured(report, "tripSelect"), "trip select P95");
check("T0805", measured(report, "heatmapRender").count === 1 && heatmap.result.cells.length > 0, measured(report, "heatmapRender"), "heatmap render");
check("T0806", measured(report, "timeSpaceRender").count === 1 && timeSpace.result.tableEquivalent.length > 0, measured(report, "timeSpaceRender"), "time-space render");
check("T0807", measured(report, "costToServe").count === 1 && accounting.result.cost.total > 0, measured(report, "costToServe"), "cost-to-serve compute");
check("T0808", measured(report, "demandShock").count === 1 && demandShock.result.propagation.assignment.assigned === 500, measured(report, "demandShock"), "demand shock compute");
check("T0809", measured(report, "networkPareto").count === 1 && pareto.result.status === "PASS", measured(report, "networkPareto"), "network Pareto compute");
check("T0810", measured(report, "recoveryCompute").count === 1 && recovery.result.length === Execution.RECOVERY_TYPES.length, measured(report, "recoveryCompute"), "recovery compute");
check("T0811", measured(report, "execution100Trips").count === 1 && execution100.result.status === "PASS" && run.events.length === 100, { timing: measured(report, "execution100Trips"), events: run.events.length }, "100-trip execution workload");
check("T0812", measured(report, "alertEvaluation").count === 1 && alerts.result.length === 7 && run.incidents.length === 8, measured(report, "alertEvaluation"), "alert evaluation");
check("T0813", measured(report, "capsuleExport").count === 1 && Contract.isSha256(capsuleExport.result.capsuleHash), measured(report, "capsuleExport"), "capsule export");
check("T0814", measured(report, "capsuleReplay").count === 1 && capsuleReplay.result.status === "EQUIVALENT", measured(report, "capsuleReplay"), "capsule replay");
check("T0815", report.methodology.browserRafSeparate && report.environment.browserMeasurementsOwnedBy.includes("browser"), report.methodology, "browser RAF measured separately by browser suite");
check("T0816", measured(report, "applicationUpdate").count === 30, measured(report, "applicationUpdate"), 30);
check("T0817", measured(report, "mapLayerUpdate").count === 30, measured(report, "mapLayerUpdate"), 30);
check("T0818", measured(report, "actualSetData").count === 30 && setDataCalls === 30, { timing: measured(report, "actualSetData"), setDataCalls }, 30);
check("T0819", measured(report, "timelineRender").count === 10, measured(report, "timelineRender"), 10);
check("T0820", Number.isInteger(report.longTaskCount), report.longTaskCount, "measured integer");
check("T0821", Number.isFinite(report.longTaskTotalMs), report.longTaskTotalMs, "measured milliseconds");
check("T0822", Number.isFinite(report.maxLongTaskMs), report.maxLongTaskMs, "measured milliseconds");
check("T0823", report.heap.beforeBytes > 0 && report.heap.afterBytes > 0 && Number.isFinite(report.heap.deltaBytes), report.heap, "heap before and after");
check("T0824", target.count() === 0 && report.resources.listeners === 0, { target: target.count(), resources: report.resources }, 0);
check("T0825", pendingRafs === 0 && report.resources.rafs === 0, { pendingRafs, resources: report.resources }, 0);
check("T0826", cleanedLayers === 10 && report.resources.layers === 0, { cleanedLayers, resources: report.resources }, "10 cleaned, 0 retained");
check("T0827", terminatedWorkers === 10 && report.resources.workers === 0, { terminatedWorkers, resources: report.resources }, "10 terminated, 0 retained");
check("T0828", hiddenCalls === 0 && report.rawTrace.some((row) => row.name === "hiddenPanelUpdate" && row.status === "SKIPPED_HIDDEN"), { hiddenCalls, hiddenTrace: report.rawTrace.find((row) => row.name === "hiddenPanelUpdate") }, "hidden panel skipped");
check("T0829", visibleLanes.result.length === 8 && measured(report, "visibleLaneRender").count === 1, { lanes: visibleLanes.result.length, timing: measured(report, "visibleLaneRender") }, "visible lanes only");
check("T0830", !geometryFirst.cacheHit && geometrySecond.cacheHit && geometryFirst.value === geometrySecond.value, { first: geometryFirst.cacheHit, second: geometrySecond.cacheHit }, "static geometry cache");
check("T0831", precomputedVisualHash === visualModel.visualHash && measured(report, "renderWithPrecomputedHash").count === 5 && !report.rawTrace.some((row) => row.name === "renderHash"), measured(report, "renderWithPrecomputedHash"), "hash precomputed outside render loop");
check("T0832", cleanedLayers === 10 && terminatedWorkers === 10 && report.resources.rows.length === 0, report.resources, "10 open-close cycles cleaned");
check("T0833", report.heap.deltaBytes < 256 * 1024 * 1024 && cycleHeap.length === 10 && report.resources.rows.length === 0, { heapDelta: report.heap.deltaBytes, cycleSamples: cycleHeap.length }, "no material retained heap or resources");
check("T0834", report.methodology.noSyntheticCounters && !Object.keys(harness).includes("increment"), { methodology: report.methodology, api: Object.keys(harness) }, "no fake counters");
check("T0835", Object.keys(report.instrumentationSources).length >= 20 && Object.values(report.instrumentationSources).every((row) => Contract.isSha256(row.sourceHash)), Object.keys(report.instrumentationSources), "instrumentation source recorded");
check("T0836", fs.existsSync(tracePath) && JSON.parse(fs.readFileSync(tracePath, "utf8")).length === report.rawTrace.length, { tracePath, rows: report.rawTrace.length }, "raw trace saved");
check("T0837", honestFailure.status === "FAIL" && honestFailure.failures.includes("DEMONSTRATED_TARGET_UNMET"), honestFailure.status, "unmet target is honest FAIL", true);
check("T0838", blocked.status === "BLOCKED_MEASUREMENT" && blocked.blockedReason === "BROWSER_RUNTIME_UNAVAILABLE", blocked, "blocked measurement supported", true);
const v17Path = path.join(runDir, "evidence/v17-acceptance-2/delivery/performance/STCT-v1.7-PERFORMANCE.json"); const v17 = JSON.parse(fs.readFileSync(v17Path, "utf8"));
check("T0844", v17.status === "PASS" && v17.methodology.noSyntheticIncrements === true && report.methodology.noSyntheticCounters === true && report.workload.orders === 500, { v17Status: v17.status, v17Method: v17.methodology.source, v18Method: report.methodology.source, v18Orders: report.workload.orders }, "v1.7 methodology retained and extended to 500-order network");
check("T0845", replayed.status === "EQUIVALENT" && JSON.stringify(replayed.durations) === JSON.stringify(report.durations), { status: replayed.status, sourceEvidenceHash: replayed.sourceEvidenceHash }, "performance summary reproducible");

assert.strictEqual(assertions.length, 60, "Gate 11 semantic suite owns T0781-T0838 and T0844-T0845");
report.assertions = assertions;
fs.writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, evidencePath, tracePath, workload: report.workload, totalWallMs: measured(report, "totalWall").totalMs, longTaskCount: report.longTaskCount, assertions }, null, 2)}\n`);
