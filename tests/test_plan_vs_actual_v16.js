#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Integrity = require("../integrity-hash-v151.js");
const Twin = require("../execution-twin-v16.js");
const Stores = require("../execution-store-v16.js");
const Analytics = require("../plan-vs-actual-v16.js");

const checks = [];
function check(id, condition, detail = {}) { assert(condition, `${id}: ${JSON.stringify(detail)}`); checks.push({ id, status: "PASS", detail }); }

function build() {
  const geometry = [[121.45, 31.2], [121.46, 31.2], [121.47, 31.205], [121.475, 31.2]];
  const plan = { schemaVersion: "stct-plan-v1.6-test", planHash: Integrity.hashValue({ plan: "PVA" }), logicalStartMinute: 480, matrixProfile: "light-truck", verification: { status: "PASS", verifiedAt: "fixture" }, reportedMetrics: { onTimeStopRate: 999 }, vehicles: [{ id: "V1", maxVolume: 10 }], routes: [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1", "O2"], etaByOrder: { O1: 500, O2: 550 }, serviceMinutesByOrder: { O1: 10, O2: 10 }, volumeByOrder: { O1: 2, O2: 3 }, totalDistance: 8, maxVolume: 10, baselinesByMatrixProfile: { "light-truck": 8, "heavy-truck": 12 }, geometry, plannedTravel: [{ start: 480, end: 500 }, { start: 518, end: 550 }], timeWindows: [{ orderId: "O1", start: 495, end: 505 }, { orderId: "O2", start: 545, end: 555 }] }] };
  const run = Twin.createRun({ scenarioId: "PVA-S", inputHash: Integrity.hashValue({ input: "PVA" }), planHash: plan.planHash, routeGeometryHash: Integrity.hashValue(geometry), matrixHash: Integrity.hashValue({ matrix: "PVA" }), providerProvenance: { providerId: "SYNTHETIC_ROAD_FIXTURE", mode: "ROAD_FIXTURE" }, simulationSeed: "7", executionProfile: "ON_TIME", logicalStartMinute: 480, revision: 1 });
  const store = Stores.createStore({ run, plan }); let sequence = 0;
  const add = (eventType, logicalTime, fields = {}) => { sequence += 1; const event = Twin.createEvent(run, { eventId: `PVA-E${sequence}`, sequence, eventType, logicalTime, routeId: fields.routeId ?? (["RUN_RELEASED", "RUN_COMPLETED"].includes(eventType) ? "" : "R1"), vehicleId: fields.vehicleId ?? (["RUN_RELEASED", "RUN_COMPLETED"].includes(eventType) ? "" : "V1"), orderId: fields.orderId || "", coordinate: fields.coordinate, roadEdgeId: fields.roadEdgeId, source: "LOCAL_SIMULATION", ackId: fields.ackId, payload: { planRevision: 1, ...(fields.payload || {}) } }); const result = store.append(event); assert.strictEqual(result.status, "ACCEPTED", JSON.stringify(result)); };
  add("RUN_RELEASED", 480); add("ROUTE_ACCEPTED", 480); add("VEHICLE_DEPARTED", 480);
  add("POSITION_RECORDED", 490, { coordinate: geometry[1], payload: { segmentDistanceKm: 5, roadMatched: true } });
  add("STOP_ARRIVED", 505, { orderId: "O1" }); add("SERVICE_STARTED", 506, { orderId: "O1" }); add("SERVICE_COMPLETED", 518, { orderId: "O1", ackId: "ACK-O1" });
  add("POSITION_RECORDED", 530, { coordinate: geometry[2], payload: { segmentDistanceKm: 4, roadMatched: true } });
  add("UNPLANNED_STOP", 535, { coordinate: geometry[2] }); add("OFF_ROUTE_DETECTED", 540, { coordinate: [121.471, 31.206], payload: { distanceMeters: 1000 } });
  add("POSITION_RECORDED", 545, { coordinate: [121.471, 31.206], payload: { segmentDistanceKm: 1, roadMatched: false, offRoute: true } }); add("ROUTE_REJOINED", 550, { coordinate: geometry[3] });
  add("STOP_ARRIVED", 560, { orderId: "O2" }); add("SERVICE_STARTED", 561, { orderId: "O2" }); add("SERVICE_COMPLETED", 575, { orderId: "O2", ackId: "ACK-O2" }); add("RUN_COMPLETED", 576);
  return { plan, run, store, state: store.snapshot(), geometry };
}

function main() {
  const f = build(); const report = Analytics.compute({ plan: f.plan, executionState: f.state, tolerances: { earlyMinutes: 5, lateMinutes: 5 }, matrixProfile: "light-truck" }); const m = report.metrics;
  check("T264", m.onTimeTolerance.earlyMinutes === 5 && m.onTimeTolerance.lateMinutes === 5 && report.formulas.onTimeStopRate.includes("tolerance"), m.onTimeTolerance);
  check("T265", m.onTimeStopRate === 50, m);
  check("T266", m.completionRate === 100, m);
  check("T267", m.etaMaeMinutes === 7.5, m);
  check("T268", m.etaP90AbsoluteErrorMinutes === 10, m);
  check("T269", m.dwellVarianceMinutes === 3, m);
  check("T270", m.distanceVarianceKm === 2, m);
  check("T271", m.durationVarianceMinutes === 15, m);
  check("T272", m.routeAdherencePercent === 90 && report.formulas.routeAdherencePercent.includes("matched"), m);
  check("T273", m.offRouteDistanceKm === 1, m);
  check("T274", m.unplannedStopCount === 1, m);
  check("T275", m.missedStopCount === 0, m);
  check("T276", m.failedStopCount === 0, m);
  check("T277", m.latestCompletionVarianceMinutes === 15, m);
  check("T278", m.vehicleUtilizationActualPercent === 50, m);
  check("T279", report.dataSource === "VERIFIED_PLAN_PLUS_ACCEPTED_EXECUTION_EVENTS" && report.planHash === f.plan.planHash && report.acceptedEventHashes.length === f.state.acceptedEvents.length, report);
  const tamperedPlan = structuredClone(f.plan); tamperedPlan.reportedMetrics.onTimeStopRate = -500; const tamperReport = Analytics.compute({ plan: tamperedPlan, executionState: f.state });
  check("T280", tamperReport.metrics.onTimeStopRate === report.metrics.onTimeStopRate && tamperReport.metrics.onTimeStopRate !== tamperedPlan.reportedMetrics.onTimeStopRate);
  const partialState = structuredClone(f.state); partialState.run.status = "RUNNING"; partialState.acceptedEvents = partialState.acceptedEvents.filter((event) => event.eventType !== "RUN_COMPLETED"); const partial = Analytics.compute({ plan: f.plan, executionState: partialState });
  check("T281", partial.status === "PARTIAL" && partial.partialReason.includes("not completed"), partial.partialReason);
  const missingState = structuredClone(partialState); missingState.acceptedEvents = missingState.acceptedEvents.filter((event) => !(event.orderId === "O2" && ["STOP_ARRIVED", "SERVICE_STARTED", "SERVICE_COMPLETED"].includes(event.eventType))); const missing = Analytics.compute({ plan: f.plan, executionState: missingState });
  check("T282", missing.metrics.completionRate === 50 && missing.stops.find((stop) => stop.orderId === "O2").completed === false, missing.metrics);
  const shuffledState = structuredClone(f.state); shuffledState.acceptedEvents.reverse(); const shuffled = Analytics.compute({ plan: f.plan, executionState: shuffledState });
  check("T283", shuffled.metricReportHash === report.metricReportHash && shuffled.metrics.etaMaeMinutes === report.metrics.etaMaeMinutes);
  const heavy = Analytics.compute({ plan: f.plan, executionState: f.state, matrixProfile: "heavy-truck" });
  check("T284", heavy.metrics.plannedDistanceKm === 12 && heavy.metrics.distanceVarianceKm === -2, heavy.metrics);

  const alerts = [{ alertId: "A1", routeId: "R1", logicalTime: 540, severity: "HIGH" }]; const handovers = [{ cutoffLogicalMinute: 525, revision: 2 }]; const visual = Analytics.visualModel({ plan: f.plan, executionState: f.state, report, alerts, handovers, closures: [{ id: "C1" }], serviceZones: [{ id: "Z1" }] }); const layer = (id) => visual.layers.find((row) => row.id === id); const lane = (type) => visual.timeline[0].lanes.find((row) => row.type === type);
  check("T285", layer("planned-route-ghost").data[0].geometry.length === f.geometry.length);
  check("T286", layer("simulated-actual-route").data.length === 3);
  check("T287", layer("completed-actual-segment").data.length === 3);
  check("T288", layer("remaining-planned-segment").data[0].geometry.length >= 1);
  check("T289", layer("off-route-segment").data.length === 2);
  check("T290", layer("current-vehicle-position").data.coordinate[0] === 121.471);
  const failedReport = structuredClone(report); failedReport.stops[1].failed = true; const failedVisual = Analytics.visualModel({ plan: f.plan, executionState: f.state, report: failedReport }); const failedStop = failedVisual.layers.find((row) => row.id === "planned-stops").data.find((row) => row.orderId === "O2");
  check("T291", failedStop.state === "FAILED" && failedStop.label.includes("Failed stop"), failedStop);
  check("T292", visual.layers.every((row, index) => index === 0 || visual.layers[index - 1].z < row.z), visual.layers.map((row) => [row.id, row.z]));
  check("T293", layer("planned-route-ghost").lineStyle !== layer("simulated-actual-route").lineStyle && layer("planned-route-ghost").colorRole !== layer("simulated-actual-route").colorRole);
  check("T294", lane("PLANNED_TRAVEL").data.length === 2);
  check("T295", lane("ACTUAL_TRAVEL").data.length === 3);
  check("T296", lane("PLANNED_SERVICE").data[0].start === 500 && lane("PLANNED_SERVICE").data[0].end === 510);
  check("T297", lane("ACTUAL_SERVICE").data[0].start === 505 && lane("ACTUAL_SERVICE").data[0].end === 518);
  check("T298", lane("TIME_WINDOW").data.length === 2);
  check("T299", lane("ALERT_MARKER").data[0].alertId === "A1");
  check("T300", lane("RECOVERY_HANDOVER").data[0].revision === 2);
  const selectionEvents = []; const selection = Analytics.createSelectionController({ onMap: (value) => selectionEvents.push(["map", value]), onTimeline: (value) => selectionEvents.push(["timeline", value]) });
  check("T301", selection.fromMap({ routeId: "R1" }).source === "MAP" && selectionEvents.at(-1)[0] === "timeline");
  check("T302", selection.fromTimeline({ orderId: "O1" }).source === "TIMELINE" && selection.snapshot().routeId === "R1");
  check("T303", selection.fromEvent({ eventId: "PVA-E4", orderId: "O1" }).source === "EVENT" && selection.snapshot().eventId === "PVA-E4");
  check("T304", selection.fromAlert({ alertId: "A1", routeId: "R1" }).source === "ALERT" && selection.snapshot().alertId === "A1");
  const inspector = Analytics.varianceInspector(report, "O2");
  check("T305", inspector.planned.arrival === 550 && inspector.simulatedActual.arrival === 560 && inspector.delta.etaMinutes === 10, inspector);
  check("T306", inspector.reason.includes("later") && inspector.relatedEventIds.length > 0, inspector);
  check("T307", inspector.confidence === "DETERMINISTIC_ACCEPTED_EVENTS", inspector);
  check("T308", visual.tableEquivalent.length === 2 && visual.tableEquivalent.every((row) => Object.hasOwn(row, "deltaMinutes")));
  check("T309", visual.noWebGL.status === "OPERATIONAL" && visual.noWebGL.rows.length === visual.tableEquivalent.length);
  check("T310", visual.reducedMotion.status === "STATIC_EQUIVALENT" && visual.reducedMotion.timeline.length === visual.timeline.length);
  check("T311", visual.mobile.portrait.primary === "TABLE_AND_MAP_TABS" && visual.mobile.portrait.rows.length === 2);
  check("T312", visual.mobile.landscape.primary === "TIMELINE" && visual.mobile.landscape.timeline.length === 1);
  const exported = Analytics.exportReport(report, visual);
  check("T313", exported.exportHash.startsWith("sha256:") && exported.report.metricReportHash === report.metricReportHash && exported.tableEquivalent.length === 2);
  check("T314", Object.keys(exported.formulas).length >= 8 && exported.formulas.routeAdherencePercent.includes("/") && exported.formulas.onTimeStopRate.includes("early tolerance"), exported.formulas);
  const visibleText = JSON.stringify({ report, visual, exported });
  check("T315", !visibleText.includes("Real GPS") && !visibleText.includes("真实 GPS") && !visibleText.includes("真实GPS"));
  check("T316", !visibleText.includes("Real-time traffic ETA") && !visibleText.includes("实时交通 ETA") && !visibleText.includes("真实交通 ETA"));
  check("T317", report.actualLabel === "Simulated Actual" && visual.alwaysVisibleLabels.includes("Simulated Actual") && exported.report.actualLabel === "Simulated Actual");
  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks.map((row) => row.id) }, null, 2)}\n`);
}

main();
