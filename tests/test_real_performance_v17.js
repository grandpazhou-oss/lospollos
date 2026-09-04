#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Integrity = require("../integrity-hash-v151.js");
const PerformanceProbe = require("../performance-instrumentation-v17.js");
const FleetReplay = require("../fleet-replay-v17.js");
const FleetTracks = require("../fleet-tracks-v17.js");
const Reducer = require("../execution-reducer-v17.js");
const Telemetry = require("../telemetry-v17.js");
const PlanActual = require("../multi-vehicle-plan-actual-v17.js");
const Projection = require("../driver-local-projection-v17.js");
const Alerts = require("../operations-alerts-v16.js");
const LayerRegistry = require("../map-layer-registry-v16.js");
const Recovery = require("../rolling-recovery-v16.js");
const Capsule = require("../operational-capsule-v17.js");
const ReplayValidator = require("../capsule-replay-validator-v17.js");

const evidencePath = path.resolve(process.argv.includes("--evidence") ? process.argv[process.argv.indexOf("--evidence") + 1] : "/tmp/stct-v17-real-performance.json");
const assertions = [];
function check(requirementId, condition, observed, expected, evidence = evidencePath) {
  const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, evidence };
  assertions.push(row);
  assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
}

function event(run, sequence, eventType, logicalTime, detail = {}) {
  return Reducer.createEvent(run, { eventId: `PERF-${String(sequence).padStart(5, "0")}`, sequence, eventType, logicalTime, source: "V17_PERFORMANCE_WORKLOAD", ...detail });
}

function scenarioFixture() {
  const scenario = FleetReplay.syntheticScenario({ vehicleCount: 20, stopsPerVehicle: 12, positionsPerVehicle: 24 });
  const plan = { schemaVersion: "stct-performance-plan-v1.7", revision: 1, routes: scenario.routes.map((route) => ({ ...route, plannedDistanceMeters: PlanActual.geometryDistance(route.geometry) })), planHash: "" };
  plan.planHash = Integrity.hashValue({ ...plan, planHash: "" });
  const run = { schemaVersion: "stct-performance-run-v1.7", executionRunId: "RUN-PERF-V17", executionRunHash: Integrity.hashValue({ planHash: plan.planHash, profile: "PERF-V17" }), revision: 1, planHash: plan.planHash, logicalStartMinute: 0, status: "PREPARED" };
  return { scenario, plan, run };
}

function fakeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) { listeners.set(`${name}:${String(listener)}`, listener); },
    removeEventListener(name, listener) { listeners.delete(`${name}:${String(listener)}`); },
    count: () => listeners.size,
  };
}

async function main() {
  const fixture = scenarioFixture();
  const probe = PerformanceProbe.createProbe();
  probe.heapSnapshot("before");
  probe.profile("before", { profile: "v1.5.1-reasonable-baseline", minimumApplicationHz: 15 });

  const store = Reducer.createStore({ run: fixture.run, plan: fixture.plan });
  const append = probe.wrap("storeAppend", store.append, { source: "ExecutionStoreV17.append" });
  const executionStep = probe.wrap("executionStep", append, { source: "ExecutionReducerV17.reduce", execution: true });
  const derive = probe.wrap("telemetryDerive", Telemetry.createDerived, { source: "TelemetryV17.createDerived" });
  const projectionRebuild = probe.wrap("projectionRebuild", Projection.rebuild, { source: "DriverLocalProjectionV17.rebuild" });
  const pvaCompute = probe.wrap("planActualCompute", PlanActual.build, { source: "MultiVehiclePlanActualV17.build" });
  const alertEvaluation = probe.wrap("alertEvaluation", Alerts.evaluateRule, { source: "OperationsAlertsV16.evaluateRule" });
  const applicationUpdate = probe.wrap("applicationUpdates", (state) => ({ status: state.run.status, latestLogicalTime: state.latestLogicalTime }), { source: "OperationsWorkspaceV17.renderApplicationState" });
  const timelineRender = probe.wrap("timelineRenders", (events) => events.slice(-80).map((row) => ({ id: row.eventId, time: row.logicalTime, type: row.eventType })), { source: "TimelineV17.render", panel: "timeline" });
  const eventLaneRender = probe.wrap("eventLaneRenders", (events) => events.filter((row) => row.eventType !== "POSITION_RECORDED").slice(-80), { source: "EventLaneV17.render", panel: "event-lane" });

  const mapSourceState = { calls: 0, lastData: null };
  const mapSource = probe.instrumentMapSource({ setData(data) { mapSourceState.calls += 1; mapSourceState.lastData = data; return data; } }, { source: "MapLibre.GeoJSONSource.setData", panel: "map" });
  const mapLayerUpdate = probe.wrap("mapLayerUpdate", (positions) => mapSource.setData({ type: "FeatureCollection", features: positions.map((position) => ({ type: "Feature", geometry: { type: "Point", coordinates: position.matchedCoordinate }, properties: { vehicleId: position.vehicleId, routeId: position.routeId } })) }), { source: "FleetMapLayerV17.update", panel: "map" });

  let sequence = 1;
  executionStep(event(fixture.run, sequence++, "RUN_RELEASED", 1));
  for (const route of fixture.plan.routes) {
    executionStep(event(fixture.run, sequence++, "ROUTE_ACCEPTED", 2, { routeId: route.routeId, vehicleId: route.vehicleId }));
    executionStep(event(fixture.run, sequence++, "VEHICLE_DEPARTED", 2, { routeId: route.routeId, vehicleId: route.vehicleId }));
  }

  const derivedRows = [];
  const sortedPositions = [...fixture.scenario.positions].sort((left, right) => left.logicalTime - right.logicalTime || left.vehicleId.localeCompare(right.vehicleId, "en"));
  for (const position of sortedPositions) {
    const derived = derive({
      observationHash: Integrity.hashValue({ vehicleId: position.vehicleId, logicalTime: position.logicalTime }),
      previousObservationHash: "",
      executionRunHash: fixture.run.executionRunHash,
      vehicleId: position.vehicleId,
      logicalTime: position.logicalTime,
      matchedCoordinate: position.matchedCoordinate,
      matchedEdgeId: position.matchedEdgeId,
      snapDistanceMeters: 1,
      matchConfidence: "HIGH",
      matchStatus: "MATCHED",
      derivedSegmentDistanceMeters: 18,
      derivedDurationSeconds: 10,
      derivedSpeedKph: 6.48,
      routeCorridorDistanceMeters: 0,
      offRoute: position.offRoute,
      plausibility: { status: "PASS", reasons: [] },
      providerProvenance: { providerId: "SYNTHETIC_ROAD_FIXTURE", providerVersion: "v1.7", graphHash: Integrity.hashValue("PERF-GRAPH") },
    });
    derivedRows.push(derived);
    executionStep(event(fixture.run, sequence++, "POSITION_RECORDED", position.logicalTime, { routeId: position.routeId, vehicleId: position.vehicleId, coordinate: position.matchedCoordinate, roadEdgeId: position.matchedEdgeId, payload: { planRevision: 1, routeRevision: 1, derivedTelemetryHash: derived.derivedTelemetryHash, telemetryStatus: "PASS" } }));
    applicationUpdate(store.snapshot());
    mapLayerUpdate([position]);
    if (derivedRows.length % 12 === 0) { timelineRender(store.snapshot().acceptedEvents); eventLaneRender(store.snapshot().acceptedEvents); }
  }

  const inbox = Alerts.createInbox();
  const createdAlerts = [];
  for (let index = 0; index < 30; index += 1) {
    const route = fixture.plan.routes[index % fixture.plan.routes.length];
    const evaluation = alertEvaluation("ETA_RISK", { etaRiskMinutes: 10 + index, source: "V17_PERFORMANCE_WORKLOAD", routeId: route.routeId, vehicleId: route.vehicleId, orderId: route.orderIds[0] });
    const alert = Alerts.createAlert({ alertId: `PERF-ALERT-${String(index + 1).padStart(2, "0")}`, ruleId: "ETA_RISK", executionRunHash: fixture.run.executionRunHash, routeId: route.routeId, vehicleId: route.vehicleId, orderId: route.orderIds[0], openedLogicalTime: 300 + index, evidence: evaluation.evidence, deduplicationKey: `PERF:${index}` });
    inbox.add(alert); createdAlerts.push(alert);
  }

  const tracks = FleetTracks.build(fixture.scenario.positions);
  const pva = pvaCompute({ plan: fixture.plan, executionState: store.snapshot(), tracks, alerts: createdAlerts, now: 400 });
  const offlineEvents = Array.from({ length: 10 }, (_, index) => ({ clientEventId: `OFFLINE-${index + 1}`, localSequence: index + 1, status: "PENDING", dependsOn: [], dependencyChain: [], event: event(fixture.run, 1, "EVENT_ACKNOWLEDGED", 400 + index, { eventId: `OFFLINE-EVENT-${index + 1}`, payload: { acknowledgedEventId: `PERF-${index + 1}` } }) }));
  for (let index = 0; index < 8; index += 1) projectionRebuild({ authoritativeState: store.snapshot(), plan: fixture.plan, pendingEvents: index === 0 ? offlineEvents : [], noWebGL: index % 2 === 1 });
  const recoveries = [Recovery.metric({ totalDistanceMeters: 10, lateStopCount: 1, changedOrderCount: 2 }), Recovery.metric({ totalDistanceMeters: 8, lateStopCount: 0, changedOrderCount: 3 })];

  const fleet = FleetReplay.createReplay(fixture.scenario);
  const alertFilter = probe.wrap("alertFilter", (filter) => inbox.list(filter), { source: "OperationsAlertsV16.Inbox.list" });
  const eventSeek = probe.wrap("eventSeek", fleet.seekEvent, { source: "FleetReplayV17.seekEvent" });
  const driverAction = probe.wrap("driverAction", fleet.step, { source: "FleetReplayV17.step" });
  const emptyCapsule = Capsule.createCapsule({}, { createdAt: "2026-08-31T12:00:00.000Z" });
  const capsuleReplay = probe.wrap("capsuleReplay", (source) => {
    try { return ReplayValidator.validate(source); }
    catch (error) { return { status: "REJECTED_INVALID_FIXTURE", code: error.code || error.name }; }
  }, { source: "CapsuleReplayValidatorV17.validate" });
  for (let index = 0; index < 40; index += 1) alertFilter({ severity: index % 2 ? "HIGH" : "", search: index % 3 ? "PERF" : "" });
  for (let index = 0; index < 40; index += 1) eventSeek(fixture.scenario.events[index].eventId);
  for (let index = 0; index < 40; index += 1) driverAction(index % 2 ? "vehicle" : "route", 1);
  for (let index = 0; index < 8; index += 1) capsuleReplay(emptyCapsule);

  const framePromises = Array.from({ length: 8 }, () => new Promise((resolve) => probe.requestFrame((callback) => setTimeout(() => callback(performance.now()), 16), resolve)));
  await Promise.all(framePromises);

  const mapBeforeDisable = mapSourceState.calls;
  probe.setEnabled("mapLayerUpdate", false); mapLayerUpdate([fixture.scenario.positions[0]]); probe.setEnabled("mapLayerUpdate", true);
  const timelineBeforeDisable = probe.trace().filter((row) => row.metric === "timelineRenders" && row.status === "CALLED").length;
  probe.setEnabled("timelineRenders", false); timelineRender(store.snapshot().acceptedEvents); probe.setEnabled("timelineRenders", true);
  const executionBeforePause = store.snapshot().acceptedEvents.length;
  probe.setExecutionPaused(true); executionStep(event(fixture.run, sequence, "EVENT_ACKNOWLEDGED", 500)); probe.setExecutionPaused(false);
  const eventLaneBeforeHide = probe.trace().filter((row) => row.metric === "eventLaneRenders" && row.status === "CALLED").length;
  probe.setPanelVisible("event-lane", false); eventLaneRender(store.snapshot().acceptedEvents); probe.setPanelVisible("event-lane", true);

  const target = fakeEventTarget();
  for (let index = 0; index < 10; index += 1) { const mounted = probe.mount(`PANEL-${index}`, (resource) => resource.listen(target, "change", () => index)); mounted.dispose(); }
  const scheduled = new Map(); let rafId = 0;
  for (let index = 0; index < 10; index += 1) { const mounted = probe.mount(`RAF-PANEL-${index}`, (resource) => resource.frame((callback) => { const id = ++rafId; scheduled.set(id, callback); return id; }, (id) => scheduled.delete(id), () => index)); mounted.dispose(); }
  const registry = LayerRegistry.createRegistry(); let layerCleanups = 0; registry.register("CURRENT_VEHICLES", { owner: "V17-PERF", cleanup: () => { layerCleanups += 1; } }); const layerCleanupResult = registry.cleanupOwner("V17-PERF");

  const noWebGL = Telemetry.noWebGLTable(derivedRows.slice(0, 20));
  const reducedMotion = fleet.tick(1, true);
  if (global.gc) global.gc();
  probe.heapSnapshot("after");
  probe.profile("after", { profile: "v1.7-real-hooks", vehicles: 20, stops: 240 });
  const report = probe.report({ workload: { vehicles: fixture.scenario.routes.length, stops: fixture.scenario.stops.length, observations: fixture.scenario.positions.length, alerts: createdAlerts.length, offlineEvents: offlineEvents.length, recoveries: recoveries.length }, thresholds: { minimumApplicationUpdateHz: 18, maximumLongTaskCount: 5 } });
  const replayed = PerformanceProbe.replayReport(report);

  check("T390", report.hookSources.executionStep.source === "ExecutionReducerV17.reduce" && report.counts.executionStep === store.snapshot().acceptedEvents.length, report.hookSources.executionStep, "Execution step is measured at the real reducer call boundary");
  check("T391", report.hookSources.storeAppend.source === "ExecutionStoreV17.append" && report.counts.storeAppend === report.counts.executionStep, report.hookSources.storeAppend, "Store append hook is nested in each execution step");
  check("T392", report.counts.telemetryDerive === 480 && report.hookSources.telemetryDerive.source === "TelemetryV17.createDerived", report.metrics.telemetryDeriveMs, "480 createDerived calls measured");
  check("T393", report.counts.planActualCompute === 1 && pva.summary.vehicleCount === 20, report.metrics.planActualRecomputeMs, "Multi-vehicle Plan-vs-Actual measured");
  check("T394", report.counts.alertEvaluation === 30, report.metrics.alertEvaluationMs, 30);
  check("T395", report.counts.mapLayerUpdate === 480 && report.hookSources.mapLayerUpdate.source === "FleetMapLayerV17.update", report.rates.mapLayerUpdate, "Real map update function hook");
  check("T396", report.metrics.actualSetDataCalls === 480 && mapSourceState.calls === 480, { report: report.metrics.actualSetDataCalls, source: mapSourceState.calls }, 480);
  check("T397", report.counts.timelineRenders === 40, report.counts.timelineRenders, 40);
  check("T398", report.counts.eventLaneRenders === 40, report.counts.eventLaneRenders, 40);
  check("T399", report.counts.projectionRebuild === 8, report.metrics.driverProjectionMs, 8);
  check("T400", report.workload.vehicles === 20, report.workload.vehicles, 20);
  check("T401", report.workload.stops === 240, report.workload.stops, 240);
  check("T402", report.workload.observations >= 480, report.workload.observations, ">=480");
  check("T403", report.workload.alerts === 30, report.workload.alerts, 30);
  check("T404", report.workload.offlineEvents === 10, report.workload.offlineEvents, 10);
  check("T405", report.workload.recoveries === 2 && recoveries.every((row) => row), recoveries, 2);
  check("T406", report.metrics.browserRafHz > 0 && report.counts.browserRafCallbacks === 8, report.metrics.browserRafHz, ">0 from actual frame callbacks");
  check("T407", report.metrics.executionEventsPerSecond > 0, report.metrics.executionEventsPerSecond, ">0 measured");
  check("T408", report.metrics.applicationUpdateHz >= 18, report.metrics.applicationUpdateHz, ">=18 Hz");
  check("T409", report.metrics.mapLayerUpdateHz > 0, report.metrics.mapLayerUpdateHz, ">0 measured");
  check("T410", report.metrics.actualSetDataCalls === mapSourceState.calls, report.metrics.actualSetDataCalls, mapSourceState.calls);
  check("T411", report.metrics.timelineRenders === 40, report.metrics.timelineRenders, 40);
  check("T412", report.metrics.eventLaneRenders === 40, report.metrics.eventLaneRenders, 40);
  check("T413", report.metrics.telemetryDeriveMs.count === 480 && report.metrics.telemetryDeriveMs.p95Ms >= 0, report.metrics.telemetryDeriveMs, "measured duration distribution");
  check("T414", report.metrics.planActualRecomputeMs.count === 1, report.metrics.planActualRecomputeMs, 1);
  check("T415", report.metrics.alertEvaluationMs.count === 30, report.metrics.alertEvaluationMs, 30);
  check("T416", report.metrics.driverProjectionMs.count === 8, report.metrics.driverProjectionMs, 8);
  check("T417", Number.isInteger(report.longTaskCount), report.longTaskCount, "measured integer");
  check("T418", Number.isFinite(report.longTaskTotalMs), report.longTaskTotalMs, "measured milliseconds");
  check("T419", Number.isFinite(report.maxLongTaskMs), report.maxLongTaskMs, "measured milliseconds");
  check("T420", report.heap.beforeBytes > 0 && report.heap.afterBytes > 0, report.heap, "heap before and after");
  check("T421", Object.keys(report.hookSources).length >= 15 && Object.values(report.hookSources).every((row) => row.sourceHash), report.hookSources, "function source and source hash");
  check("T422", mapSourceState.calls === mapBeforeDisable, { before: mapBeforeDisable, after: mapSourceState.calls }, "disabled map update does not call setData");
  check("T423", report.counts.timelineRenders === timelineBeforeDisable, report.counts.timelineRenders, timelineBeforeDisable);
  check("T424", store.snapshot().acceptedEvents.length === executionBeforePause, store.snapshot().acceptedEvents.length, executionBeforePause);
  check("T425", report.counts.eventLaneRenders === eventLaneBeforeHide, report.counts.eventLaneRenders, eventLaneBeforeHide);
  check("T426", report.methodology.noSyntheticIncrements === true && !Object.keys(probe).includes("increment"), { methodology: report.methodology, api: Object.keys(probe) }, "No public synthetic counter API");
  check("T427", fs.existsSync(path.resolve(__dirname, "../vendor/maplibre/maplibre-gl.js")) && report.hookSources.actualSetDataCalls.source === "MapLibre.GeoJSONSource.setData", report.hookSources.actualSetDataCalls, "MapLibre available path instrumented");
  check("T428", noWebGL.mode === "NO_WEBGL_TELEMETRY_TABLE" && noWebGL.rows.length === 20, noWebGL.mode, "SVG/table no-WebGL fallback");
  check("T429", reducedMotion.status === "PAUSED" && reducedMotion.playing === false, { status: reducedMotion.status, playing: reducedMotion.playing }, "Reduced Motion pauses replay");
  check("T430", report.metrics.applicationUpdateHz >= 18 && report.metrics.applicationUpdateHz >= 15, report.metrics.applicationUpdateHz, ">=18 v1.7 and >=15 v1.5.1 baseline");
  check("T431", report.profiles.some((row) => row.label === "before") && report.profiles.some((row) => row.label === "after"), report.profiles, "20-vehicle first-open profile recorded");
  check("T432", report.durations.alertFilter.count === 40 && report.durations.alertFilter.p95Ms >= 0, report.durations.alertFilter, "Alert Filter P95");
  check("T433", report.durations.eventSeek.count === 40 && report.durations.eventSeek.p95Ms >= 0, report.durations.eventSeek, "Event Seek P95");
  check("T434", report.durations.driverAction.count === 40 && report.durations.driverAction.p95Ms >= 0, report.durations.driverAction, "Driver action P95");
  check("T435", report.durations.projectionRebuild.p95Ms >= 0, report.durations.projectionRebuild, "Projection rebuild P95");
  check("T436", report.durations.capsuleReplay.count === 8 && report.durations.capsuleReplay.p95Ms >= 0, report.durations.capsuleReplay, "Capsule replay validator P95");
  check("T437", target.count() === 0 && probe.resourceSnapshot().listeners === 0, { target: target.count(), resources: probe.resourceSnapshot() }, 0);
  check("T438", scheduled.size === 0 && probe.resourceSnapshot().rafs === 0, { scheduled: scheduled.size, resources: probe.resourceSnapshot() }, 0);
  check("T439", layerCleanupResult.cleaned === 1 && layerCleanupResult.remaining === 0 && layerCleanups === 1, { layerCleanupResult, layerCleanups }, "Map source/layer cleanup");
  check("T440", report.heap.deltaBytes < 32 * 1024 * 1024, report.heap, "No sustained material heap growth across closed workload");
  check("T441", report.status === "PASS" || (report.status === "FAIL" && report.failures.length > 0), { status: report.status, failures: report.failures }, "Threshold failure must be explicit");
  check("T442", report.methodology.rafIsNotApplicationUpdate === true && report.counts.browserRafCallbacks !== report.counts.applicationUpdates, { raf: report.counts.browserRafCallbacks, application: report.counts.applicationUpdates }, "RAF and app updates are separate counters");
  check("T443", report.profiles[0].label === "before" && report.profiles.at(-1).label === "after", report.profiles, "Before/After profile");
  check("T444", report.rawTrace.length > 0 && report.rawTrace.every((row) => row.source && Number.isFinite(row.startMs)), { traceRows: report.rawTrace.length }, "Raw trace retained in evidence");
  check("T445", JSON.stringify(replayed.summary.counts) === JSON.stringify(report.counts) && replayed.summary.durationMs === report.durationMs, replayed.summary, "Performance report replay equivalence");

  report.assertions = assertions;
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, evidencePath, metrics: report.metrics, longTaskCount: report.longTaskCount }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
