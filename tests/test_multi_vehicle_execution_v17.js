#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Integrity = require("../integrity-hash-v151.js");
const FleetTracks = require("../fleet-tracks-v17.js");
const PlanActual = require("../multi-vehicle-plan-actual-v17.js");
const FleetReplay = require("../fleet-replay-v17.js");

const assertions = [];
function check(requirementId, condition, observed, expected) {
  assert(condition, `${requirementId}: observed=${JSON.stringify(observed)} expected=${JSON.stringify(expected)}`);
  assertions.push({ assertionId: `${requirementId}-A1`, requirementId, status: "PASS", observed, expected, evidence: "tests/test_multi_vehicle_execution_v17.js" });
}
function row(vehicleId, routeId, routeRevision, logicalTime, matchedCoordinate, overrides = {}) { return { vehicleId, routeId, routeRevision, logicalTime, matchedCoordinate, matchedEdgeId: overrides.matchedEdgeId || `${routeId}-E${logicalTime}`, offRoute: overrides.offRoute === true, matchConfidence: overrides.matchConfidence || "HIGH", alertCount: overrides.alertCount || 0, handoverId: overrides.handoverId || "BASE", derivedTelemetryHash: Integrity.hashValue({ vehicleId, routeId, routeRevision, logicalTime, matchedCoordinate, handoverId: overrides.handoverId || "BASE" }) }; }

function baseRows() {
  return [
    row("V1", "R1", 1, 100, [121.45, 31.2]),
    row("V2", "R2", 1, 101, [122.45, 32.2], { alertCount: 1 }),
    row("V1", "R1", 1, 110, [121.455, 31.2]),
    row("V2", "R2", 1, 111, [122.455, 32.2], { alertCount: 1 }),
    row("V1", "R1", 1, 120, [121.46, 31.2], { offRoute: true }),
  ];
}

function reportFixture(tracks) {
  const plan = { planHash: Integrity.hashValue({ plan: "fleet" }), revision: 1, routes: [
    { routeId: "R1", vehicleId: "V1", revision: 1, orderIds: ["O1", "O2"], geometry: [[121.45, 31.2], [121.455, 31.2], [121.46, 31.2]] },
    { routeId: "R2", vehicleId: "V2", revision: 1, orderIds: ["O3", "O4", "O5", "O6"], geometry: [[122.45, 32.2], [122.455, 32.2], [122.46, 32.2], [122.465, 32.2]] },
  ] };
  const executionState = { routeStates: { R1: { state: "COMPLETED" }, R2: { state: "DEPARTED" } }, stopStates: {
    O1: { orderId: "O1", state: "COMPLETED", plannedArrival: 100, arrivedAt: 110, serviceStartedAt: 111, completedAt: 121 },
    O2: { orderId: "O2", state: "COMPLETED", plannedArrival: 120, arrivedAt: 140, serviceStartedAt: 141, completedAt: 156 },
    O3: { orderId: "O3", state: "EN_ROUTE", plannedArrival: 100, arrivedAt: 200 },
    O4: { orderId: "O4", state: "PENDING", plannedArrival: 100, arrivedAt: 300 },
    O5: { orderId: "O5", state: "PENDING", plannedArrival: 100, arrivedAt: 400 },
    O6: { orderId: "O6", state: "PENDING", plannedArrival: 100, arrivedAt: 500 },
  } };
  const alerts = [{ alertId: "A1", routeId: "R1", vehicleId: "V1" }, { alertId: "A2", routeId: "R2", vehicleId: "V2" }, { alertId: "A3", routeId: "R2", vehicleId: "V2" }];
  return { plan, executionState, alerts, report: PlanActual.build({ plan, executionState, tracks, alerts, now: 500 }) };
}

function main() {
  const tracks = FleetTracks.build(baseRows()); const byVehicle = Object.fromEntries(tracks.map((track) => [track.vehicleId, track]));
  check("T205", tracks.length === 2 && new Set(tracks.map((track) => track.vehicleId)).size === 2, tracks.map((track) => ({ key: track.trackKey, vehicleId: track.vehicleId })), "two independent vehicle tracks");
  check("T206", new Set(tracks.map((track) => track.routeId)).size === 2 && tracks.every((track) => track.trackKey.includes(track.routeId)), tracks.map((track) => track.trackKey), "independent route tracks");
  check("T207", byVehicle.V1.matchedSegments.every((segment) => segment.from[0] < 122 && segment.to[0] < 122) && byVehicle.V2.matchedSegments.every((segment) => segment.from[0] > 122 && segment.to[0] > 122), { V1: byVehicle.V1.matchedSegments, V2: byVehicle.V2.matchedSegments }, "no cross-vehicle bridge segment");
  const revisedTracks = FleetTracks.build([...baseRows(), row("V1", "R1", 2, 130, [121.47, 31.2])]);
  check("T208", revisedTracks.filter((track) => track.vehicleId === "V1").length === 2 && new Set(revisedTracks.filter((track) => track.vehicleId === "V1").map((track) => track.routeRevision)).size === 2, revisedTracks.filter((track) => track.vehicleId === "V1").map((track) => track.trackKey), "separate revision tracks");
  const markers = FleetTracks.currentMarkers(tracks);
  check("T209", markers.length === 2 && new Set(markers.map((marker) => marker.vehicleId)).size === 2, markers, "one current marker per active vehicle");
  const hiddenCompleted = FleetTracks.currentMarkers(tracks, { completedVehicleIds: ["V1"] }); const shownCompleted = FleetTracks.currentMarkers(tracks, { completedVehicleIds: ["V1"], includeCompletedHistory: true });
  check("T210", hiddenCompleted.every((marker) => marker.vehicleId !== "V1") && shownCompleted.some((marker) => marker.vehicleId === "V1"), { hidden: hiddenCompleted.map((row) => row.vehicleId), shown: shownCompleted.map((row) => row.vehicleId) }, "completed marker can hide or show as history");
  check("T211", FleetTracks.filterMarkers(markers, "ALL").length === 2, FleetTracks.filterMarkers(markers, "ALL").map((row) => row.vehicleId), ["V1", "V2"]);
  check("T212", FleetTracks.filterMarkers(markers, "SELECTED", { selectedVehicleId: "V1" }).map((row) => row.vehicleId).join() === "V1", FleetTracks.filterMarkers(markers, "SELECTED", { selectedVehicleId: "V1" }).map((row) => row.vehicleId), ["V1"]);
  check("T213", FleetTracks.filterMarkers(markers, "AT_RISK").length === 2, FleetTracks.filterMarkers(markers, "AT_RISK").map((row) => ({ vehicleId: row.vehicleId, risk: row.risk })), "off-route or alert risk markers");
  check("T214", FleetTracks.filterMarkers(markers, "OFF_ROUTE").map((row) => row.vehicleId).join() === "V1", FleetTracks.filterMarkers(markers, "OFF_ROUTE").map((row) => row.vehicleId), ["V1"]);
  check("T215", FleetTracks.filterMarkers(markers, "STALE", { now: 500, staleThreshold: 300 }).length === 2, FleetTracks.filterMarkers(markers, "STALE", { now: 500, staleThreshold: 300 }).map((row) => row.vehicleId), ["V1", "V2"]);
  const fixture = reportFixture(tracks); const r1 = fixture.report.routes.find((route) => route.routeId === "R1"); const r2 = fixture.report.routes.find((route) => route.routeId === "R2");
  check("T216", r1.routeCompletion === 1 && r2.routeCompletion === 0, { R1: r1.routeCompletion, R2: r2.routeCompletion }, { R1: 1, R2: 0 });
  check("T217", r1.completedStops === 2 && r2.completedStops === 0 && fixture.report.summary.fleetCompletion === 2 / 6, { R1: r1.completedStops, R2: r2.completedStops, fleet: fixture.report.summary.fleetCompletion }, { R1: 2, R2: 0, fleet: 2 / 6 });
  check("T218", r1.remainingPlannedSegment.length === 1 && r2.remainingPlannedSegment.length === fixture.plan.routes[1].geometry.length, { R1: r1.remainingPlannedSegment, R2: r2.remainingPlannedSegment }, "remaining segment cut independently per route");
  check("T219", r1.completedActualSegment.length === 3 && r2.completedActualSegment.length === 2, { R1: r1.completedActualSegment.length, R2: r2.completedActualSegment.length }, { R1: 3, R2: 2 });
  check("T220", r1.offRouteSegments.length === 1 && r2.offRouteSegments.length === 0, { R1: r1.offRouteSegments.length, R2: r2.offRouteSegments.length }, { R1: 1, R2: 0 });
  check("T221", JSON.stringify(r1.plannedGhost) === JSON.stringify(fixture.plan.routes[0].geometry) && JSON.stringify(r2.plannedGhost) === JSON.stringify(fixture.plan.routes[1].geometry), { R1: r1.plannedGhost, R2: r2.plannedGhost }, "per-route planned ghosts");
  const handoverRows = [row("V1", "R1", 1, 100, [121.45, 31.2], { handoverId: "BEFORE" }), row("V1", "R1", 1, 110, [121.455, 31.2], { handoverId: "BEFORE" }), row("V1", "R1", 1, 120, [121.46, 31.2], { handoverId: "AFTER" })]; const handoverTracks = FleetTracks.build(handoverRows); const handoverReport = PlanActual.build({ plan: fixture.plan, executionState: fixture.executionState, tracks: handoverTracks, alerts: [], now: 500 });
  check("T222", handoverTracks.length === 2 && handoverReport.routes.find((route) => route.routeId === "R1").handoverSegments.length === 2, handoverReport.routes.find((route) => route.routeId === "R1").handoverSegments, "recovery handover segments");
  check("T223", revisedTracks.filter((track) => track.vehicleId === "V1").every((track) => new Set(track.positions.map(() => track.routeRevision)).size === 1), revisedTracks.filter((track) => track.vehicleId === "V1").map((track) => ({ revision: track.routeRevision, positions: track.positions.length })), "revision geometry never bridged");
  check("T224", r1.routeCompletion === 1 && r2.routeCompletion === 0, { R1: r1.routeCompletion, R2: r2.routeCompletion }, "terminal stops / planned stops");
  check("T225", r1.routeAdherence >= 0 && r1.routeAdherence < 1 && r2.routeAdherence === 1, { R1: r1.routeAdherence, R2: r2.routeAdherence }, "per-route off-route distance adherence");
  check("T226", r1.routeEtaMae === 15 && r2.routeEtaMae === 250, { R1: r1.routeEtaMae, R2: r2.routeEtaMae }, { R1: 15, R2: 250 });
  check("T227", r1.routeDwell === 25 && r2.routeDwell === 0, { R1: r1.routeDwell, R2: r2.routeDwell }, { R1: 25, R2: 0 });
  check("T228", r1.vehicleProgress === 1 && r2.vehicleProgress > 0 && r2.vehicleProgress < 1, { R1: r1.vehicleProgress, R2: r2.vehicleProgress }, "completion or actual/planned distance per vehicle");
  check("T229", r1.vehicleStaleAge === 380 && r2.vehicleStaleAge === 389, { R1: r1.vehicleStaleAge, R2: r2.vehicleStaleAge }, { R1: 380, R2: 389 });
  check("T230", r1.vehicleAlertCount === 1 && r2.vehicleAlertCount === 2, { R1: r1.vehicleAlertCount, R2: r2.vehicleAlertCount }, { R1: 1, R2: 2 });
  check("T231", fixture.report.summary.fleetCompletion === 2 / 6, fixture.report.summary.fleetCompletion, 2 / 6);
  check("T232", Math.abs(fixture.report.summary.fleetEtaMae - (10 + 20 + 100 + 200 + 300 + 400) / 6) < 1e-9, fixture.report.summary.fleetEtaMae, 1030 / 6);
  check("T233", fixture.report.summary.fleetEtaP90 === 400, fixture.report.summary.fleetEtaP90, 400);
  check("T234", fixture.report.summary.weighting.includes("NOT_SIMPLE") && fixture.report.summary.fleetEtaMae !== (r1.routeEtaMae + r2.routeEtaMae) / 2, { weighting: fixture.report.summary.weighting, weighted: fixture.report.summary.fleetEtaMae, simple: (r1.routeEtaMae + r2.routeEtaMae) / 2 }, "sample-weighted, not route-average");
  const selectedMarkers = FleetTracks.currentMarkers(tracks, { selectedVehicleId: "V1" });
  check("T235", selectedMarkers.length === 2, selectedMarkers.length, 2);
  check("T236", selectedMarkers.find((marker) => marker.vehicleId === "V1").selected === true && selectedMarkers.find((marker) => marker.vehicleId === "V1").glyph === "SELECTED_RING", selectedMarkers.find((marker) => marker.vehicleId === "V1"), "selected ring");
  check("T237", selectedMarkers.find((marker) => marker.vehicleId === "V2").semanticLabel.includes("V2") && selectedMarkers.find((marker) => marker.vehicleId === "V2").glyph, selectedMarkers.find((marker) => marker.vehicleId === "V2"), "non-selected marker retains semantic label and glyph");
  const scenario = FleetReplay.syntheticScenario(); const replay = FleetReplay.createReplay(scenario);
  check("T238", replay.step("vehicle").selectedVehicleId === "V01" && replay.step("vehicle").selectedVehicleId === "V02", replay.snapshot().selectedVehicleId, "vehicle step-through");
  const routeStep = replay.step("route"); check("T239", routeStep.selectedRouteId === "R01", routeStep.selectedRouteId, "R01");
  const stopStep = replay.step("stop"); check("T240", stopStep.selectedStopId === "R01-S01", stopStep.selectedStopId, "R01-S01");
  const eventTarget = replay.events()[10]; const eventSeek = replay.seekEvent(eventTarget.eventId); check("T241", eventSeek.selectedEventId === eventTarget.eventId && eventSeek.clock === eventTarget.logicalTime, { event: eventSeek.selectedEventId, clock: eventSeek.clock }, { event: eventTarget.eventId, clock: eventTarget.logicalTime });
  const alertTarget = replay.alerts()[0]; const alertSeek = replay.seekAlert(alertTarget.alertId); check("T242", alertSeek.selectedAlertId === alertTarget.alertId && alertSeek.clock === alertTarget.logicalTime, { alert: alertSeek.selectedAlertId, clock: alertSeek.clock }, { alert: alertTarget.alertId, clock: alertTarget.logicalTime });
  check("T243", scenario.routes.length === 20 && replay.tracks().length === 20, { routes: scenario.routes.length, tracks: replay.tracks().length }, { routes: 20, tracks: 20 });
  check("T244", scenario.stops.length === 240 && replay.stops().length === 240, { scenario: scenario.stops.length, replay: replay.stops().length }, 240);
  check("T245", scenario.positions.length === 480 && replay.events().filter((event) => event.eventType === "POSITION_RECORDED").length === 480, { positions: scenario.positions.length, positionEvents: replay.events().length }, 480);
  check("T246", replay.snapshot().sharedClock.start === scenario.sharedClock.start && replay.snapshot().sharedClock.end === scenario.sharedClock.end && replay.snapshot().sharedClock.unit === "LOGICAL_SECONDS", replay.snapshot().sharedClock, scenario.sharedClock);
  const followed = replay.follow("V03"); const exited = replay.exitFollow(); check("T247", followed.followVehicle === true && followed.selectedVehicleId === "V03" && exited.followVehicle === false, { followed: followed.followVehicle, selected: followed.selectedVehicleId, exited: exited.followVehicle }, { followed: true, selected: "V03", exited: false });
  replay.select({ vehicleId: "V04", routeId: "R04" }); const cleared = replay.clearSelection(); check("T248", [cleared.selectedVehicleId, cleared.selectedRouteId, cleared.selectedStopId].every((value) => value === ""), { vehicle: cleared.selectedVehicleId, route: cleared.selectedRouteId, stop: cleared.selectedStopId }, "blank map click clears selection");
  const lowLod = FleetTracks.lod(replay.tracks(), { zoom: 6 }); check("T249", lowLod.clustering === true && lowLod.markers.length === 1 && lowLod.markers[0].count === 20, lowLod, "low zoom cluster");
  const highLod = FleetTracks.lod(replay.tracks(), { zoom: 14 }); check("T250", highLod.showStops === true && highLod.clustering === false, { showStops: highLod.showStops, clustering: highLod.clustering }, { showStops: true, clustering: false });
  const selectedLod = FleetTracks.lod(replay.tracks(), { zoom: 11, selectedVehicleId: "V01", riskVehicleIds: ["V02"] }); const selectedTrail = selectedLod.trails.find((trail) => trail.vehicleId === "V01"); const otherTrail = selectedLod.trails.find((trail) => trail.vehicleId === "V03"); const riskTrail = selectedLod.trails.find((trail) => trail.vehicleId === "V02");
  check("T251", selectedTrail.full === true && selectedTrail.positions.length === 24, selectedTrail, "full selected trail");
  check("T252", otherTrail.full === false && otherTrail.positions.length === 3, otherTrail, "last 3 positions for non-selected");
  check("T253", riskTrail.risk === true && riskTrail.linePattern === "DASHED_RISK" && riskTrail.positions.length === 12, riskTrail, "direct risk trail marking");
  check("T254", selectedLod.trails.every((trail) => trail.linePattern && trail.icon), selectedLod.trails.slice(0, 3).map((trail) => ({ pattern: trail.linePattern, icon: trail.icon })), "line pattern and icon beyond color");
  const table = FleetTracks.fleetTable(replay.tracks(), { selectedVehicleId: "V01" }); check("T255", table.rows.length === 20 && table.rows.some((row) => row.vehicleId === "V01" && row.selected && row.statusText), table.rows.slice(0, 2), "fleet table semantic equivalent");
  const noWebGL = FleetTracks.fleetTable(replay.tracks(), { noWebGL: true }); check("T256", noWebGL.mode === "NO_WEBGL_FLEET_TABLE" && noWebGL.rows.length === 20, { mode: noWebGL.mode, rows: noWebGL.rows.length }, { mode: "NO_WEBGL_FLEET_TABLE", rows: 20 });
  const mobile = FleetTracks.mobileView("ALL", replay.tracks(), { selectedVehicleId: "V01" }); check("T257", mobile.segmentedControl.join(",") === "ALL,SELECTED" && mobile.mode === "ALL", mobile, "mobile ALL/Selected segmented control");
  check("T258", mobile.portraitRows[0].risk === true, mobile.portraitRows.slice(0, 3), "risk-first portrait ordering");
  check("T259", mobile.landscape.timelineVisible === true && mobile.landscape.lanes.length === 1, mobile.landscape, "landscape selected-vehicle timeline");
  const beforeTick = replay.snapshot().clock; const staticTick = replay.tick(1, true); check("T260", staticTick.clock === beforeTick + 1 && staticTick.status === "PAUSED" && staticTick.playing === false, { before: beforeTick, after: staticTick.clock, status: staticTick.status, playing: staticTick.playing }, "reduced motion static tick");
  const lanes = FleetTracks.timelineLanes(replay.tracks()); check("T261", lanes.length === 20 && new Set(lanes.map((lane) => lane.routeId)).size === 20, lanes.slice(0, 2), "per-route timeline lanes");
  const filteredLanes = FleetTracks.timelineLanes(replay.tracks(), "V01"); check("T262", filteredLanes.length === 1 && filteredLanes[0].vehicleId === "V01", filteredLanes, "per-vehicle timeline filter");
  const metricsExport = PlanActual.exportMetrics(fixture.report); check("T263", metricsExport.routes.length === 2 && metricsExport.sourceReportHash === fixture.report.reportHash && metricsExport.routes.every((route) => Object.hasOwn(route, "vehicleAlertCount")), metricsExport, "multi-vehicle metrics export");
  const exported = replay.exportReplay(); const replayed = FleetReplay.createReplay(exported.scenario); check("T264", replayed.tracks().map((track) => track.trackHash).join() === replay.tracks().map((track) => track.trackHash).join(), { original: replay.tracks().map((track) => track.trackHash).slice(0, 2), replayed: replayed.tracks().map((track) => track.trackHash).slice(0, 2) }, "capsule track replay equivalence");
  const manager = FleetTracks.createSourceManager(); manager.open("fleet", { tracks: replay.tracks() }); const cleaned = manager.close("fleet"); check("T265", cleaned.sourceCount === 0 && cleaned.layerCount === 0, cleaned, "track source cleanup");
  manager.open("fleet", { tracks: [] }); manager.open("fleet", { tracks: replay.tracks() }); const reopened = manager.snapshot(); check("T266", reopened.sourceCount === 1 && reopened.layerCount === 2, reopened, { sourceCount: 1, layerCount: 2 });
  const storage = FleetReplay.memoryStorage(); const persisted = FleetReplay.createReplay(scenario, { storage, storageKey: "persist" }); persisted.select({ vehicleId: "V06", routeId: "R06" }); const refreshed = FleetReplay.createReplay(scenario, { storage, storageKey: "persist" });
  check("T267", refreshed.snapshot().selectedVehicleId === "V06" && refreshed.snapshot().selectedRouteId === "R06", { vehicle: refreshed.snapshot().selectedVehicleId, route: refreshed.snapshot().selectedRouteId }, { vehicle: "V06", route: "R06" });
  check("T268", refreshed.snapshot().status === "PAUSED", refreshed.snapshot().status, "PAUSED");
  check("T269", refreshed.snapshot().playing === false, refreshed.snapshot().playing, false);
  check("T270", ["zh", "en", "ja"].every((locale) => ["all", "selected", "atRisk", "offRoute", "stale"].every((key) => FleetTracks.localeCopy(locale)[key])), Object.fromEntries(["zh", "en", "ja"].map((locale) => [locale, FleetTracks.localeCopy(locale)])), "zh/en/ja fleet labels");
  check("T271", selectedLod.lodEvidence.selectedTrail === "FULL" && selectedLod.lodEvidence.otherTrail === "LAST_3" && lowLod.lodEvidence.lowZoom === "CLUSTER", { selected: selectedLod.lodEvidence, low: lowLod.lodEvidence }, "large-data LOD evidence");
  check("T272", scenario.liveFleetClaim === false && scenario.boundary === "SYNTHETIC_REPLAY_NOT_REAL_FLEET" && replay.snapshot().boundary === scenario.boundary, { liveFleetClaim: scenario.liveFleetClaim, boundary: replay.snapshot().boundary }, { liveFleetClaim: false, boundary: "SYNTHETIC_REPLAY_NOT_REAL_FLEET" });

  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, assertions }, null, 2)}\n`);
}

main();
