#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Fixture = require("../road-network-fixture-v16.js");
const Routing = require("../road-routing-v16.js");
const Providers = require("../routing-provider-registry-v16.js");
const Integrity = require("../integrity-hash-v151.js");

const checks = [];
function check(id, condition, detail = {}) { assert(condition, `${id}: ${JSON.stringify(detail)}`); checks.push({ id, status: "PASS", detail }); }
async function rejectsCode(promise, expected) { try { await promise; } catch (error) { return expected.includes(error.code); } return false; }
const graph = Fixture.createFixture();
const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node]));
function point(nodeId, pointId = nodeId) { const node = nodes.get(nodeId); return { pointId, lon: node.lon, lat: node.lat }; }
function request(pointIds, overrides = {}) {
  return {
    schemaVersion: "stct-routing-request-v1.6",
    providerId: "SYNTHETIC_ROAD_FIXTURE",
    profile: "light-truck",
    points: pointIds.map((id) => point(id)),
    distanceUnit: "km",
    durationUnit: "minutes",
    snapToleranceMeters: 120,
    ...overrides,
  };
}
function heavy() { return { vehicleType: "HEAVY_TRUCK", heightM: 3.6, widthM: 2.5, lengthM: 9, grossWeightKg: 12000, axleWeightKg: 7000, hazmat: false }; }
function light() { return { vehicleType: "LIGHT_TRUCK", heightM: 2.8, widthM: 2.1, lengthM: 6, grossWeightKg: 6500, axleWeightKg: 3500, hazmat: false }; }

async function main() {
  const validation = Routing.validateGraph(graph);
  check("T071", validation.status === "PASS" && validation.graphHash === graph.graphHash && Fixture.createFixture().graphHash === graph.graphHash, validation);
  check("T072", new Set(graph.nodes.map((node) => node.nodeId)).size === graph.nodes.length);
  check("T073", new Set(graph.edges.map((edge) => edge.edgeId)).size === graph.edges.length);
  const nodeIds = new Set(graph.nodes.map((node) => node.nodeId));
  check("T074", graph.edges.every((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId)));
  check("T075", graph.edges.every((edge) => edge.distanceMeters > 0));
  check("T076", graph.edges.every((edge) => edge.baseDurationSeconds > 0));
  check("T077", graph.edges.every((edge) => JSON.stringify(edge.geometry[0]) === JSON.stringify([nodes.get(edge.fromNodeId).lon, nodes.get(edge.fromNodeId).lat]) && JSON.stringify(edge.geometry.at(-1)) === JSON.stringify([nodes.get(edge.toNodeId).lon, nodes.get(edge.toNodeId).lat])));

  const registry = Providers.createRegistry(); const provider = registry.get("SYNTHETIC_ROAD_FIXTURE");
  const reverse = await provider.route(request(["B", "A"]));
  check("T078", !reverse.edgeIds.includes("E_A_B_ONEWAY") && reverse.totalDistance > 0.5, reverse.edgeIds);
  const detour = await provider.route(request(["DEPOT", "C"]));
  check("T079", !detour.edgeIds.some((edgeId, index) => edgeId === "E_A_B_ONEWAY" && detour.edgeIds[index + 1] === "E_B_C"), detour.edgeIds);
  const tall = await provider.route(request(["C", "H"], { vehicleProfile: heavy() }));
  check("T080", !tall.edgeIds.includes("E_C_H_LOW") && tall.totalDistance > 0.43, tall.edgeIds);
  const wide = await provider.route(request(["A", "S1"], { vehicleProfile: { ...light(), widthM: 2.5 } }));
  check("T081", !wide.edgeIds.includes("E_A_S1_NARROW"), wide.edgeIds);
  const overweight = await provider.route(request(["S2", "S3"], { vehicleProfile: { ...light(), grossWeightKg: 8000 } }));
  check("T082", !overweight.edgeIds.includes("E_S2_S3_WEIGHT"), overweight.edgeIds);
  const hazmat = await provider.route(request(["S1", "S2"], { vehicleProfile: { ...light(), hazmat: true } }));
  check("T083", !hazmat.edgeIds.includes("E_S1_S2_HAZMAT"), hazmat.edgeIds);
  const heavyLightOnly = provider.route(request(["C", "LIGHT_ONLY"], { vehicleProfile: heavy() }));
  check("T084", await rejectsCode(heavyLightOnly, ["ROAD_ROUTE_UNREACHABLE"]));
  const toll = await provider.route(request(["C", "ZONE_B"]));
  check("T085", toll.tollSummary.tollEdgeIds.includes("E_C_ZONE_B_TOLL"), toll.tollSummary);
  const free = await provider.route(request(["C", "ZONE_B"], { avoidTolls: true }));
  check("T086", free.tollSummary.tollEdgeCount === 0 && free.totalDistance > toll.totalDistance, { free: free.edgeIds, toll: toll.edgeIds });
  const baselineClosure = await provider.route(request(["H", "ZONE_B"]));
  const closed = await provider.route(request(["H", "ZONE_B"], { closures: ["E_H_ZONE_B_FREE"] }));
  check("T087", !closed.edgeIds.includes("E_H_ZONE_B_FREE"), closed.edgeIds);
  check("T088", closed.totalDistance > baselineClosure.totalDistance && closed.restrictionsApplied.some((row) => row.type === "CLOSURE"), { baseline: baselineClosure.totalDistance, closed: closed.totalDistance });
  check("T089", await rejectsCode(provider.route(request(["C", "LIGHT_ONLY"], { vehicleProfile: heavy() })), ["ROAD_ROUTE_UNREACHABLE"]));
  const lightReachable = await provider.route(request(["C", "LIGHT_ONLY"], { vehicleProfile: light() }));
  check("T090", lightReachable.edgeIds.includes("E_C_LIGHT_ONLY"), lightReachable.edgeIds);
  check("T091", await rejectsCode(provider.route(request(["DEPOT", "ISOLATED"])), ["ROAD_ROUTE_UNREACHABLE"]));

  const asymmetric = await provider.matrix(request(["A", "B"]));
  check("T092", asymmetric.distances[0][1] !== asymmetric.distances[1][0] && asymmetric.asymmetry.asymmetric, asymmetric.distances);
  const straightMeters = Routing.haversineMeters([nodes.get("DEPOT").lon, nodes.get("DEPOT").lat], [nodes.get("C").lon, nodes.get("C").lat]) * 1.35;
  check("T093", detour.totalDistance * 1000 > straightMeters * 1.25, { roadMeters: detour.totalDistance * 1000, estimatedMeters: straightMeters });

  const snapHigh = Routing.snapPoint(graph, graph.snapPoints.HIGH, { snapToleranceMeters: 120 });
  const snapMedium = Routing.snapPoint(graph, graph.snapPoints.MEDIUM, { snapToleranceMeters: 120 });
  const snapLow = Routing.snapPoint(graph, graph.snapPoints.LOW, { snapToleranceMeters: 120 });
  const snapFailed = Routing.snapPoint(graph, graph.snapPoints.FAILED, { snapToleranceMeters: 120 });
  check("T094", snapHigh.confidence === "HIGH", snapHigh);
  check("T095", snapMedium.confidence === "MEDIUM", snapMedium);
  check("T096", snapLow.confidence === "LOW", snapLow);
  check("T097", snapFailed.confidence === "FAILED" && snapFailed.status === "FAILED", snapFailed);
  const snapMulti = Routing.snapPoint(graph, graph.snapPoints.MULTI, { snapToleranceMeters: 120 });
  check("T098", snapMulti.alternatives.length >= 1 && [snapMulti.nodeId, ...snapMulti.alternatives.map((row) => row.nodeId)].includes("SNAP_A") && [snapMulti.nodeId, ...snapMulti.alternatives.map((row) => row.nodeId)].includes("SNAP_B"), snapMulti);
  const lowRequest = request(["DEPOT", "C"], { points: [graph.snapPoints.LOW, point("C")] });
  check("T099", await rejectsCode(provider.route(lowRequest), ["LOW_CONFIDENCE_SNAP_BLOCKED"]));
  check("T100", Routing.requestHash(lowRequest) !== Routing.requestHash({ ...lowRequest, allowLowConfidenceSnap: true }));

  const matrix = await provider.matrix(request(["DEPOT", "B", "C"]));
  check("T101", JSON.stringify(matrix.sourceIds) === JSON.stringify(["DEPOT", "B", "C"]) && JSON.stringify(matrix.sourceIds) === JSON.stringify(matrix.targetIds), matrix.sourceIds);
  const matrixMeters = await provider.matrix(request(["DEPOT", "B"], { distanceUnit: "m" }));
  const matrixKm = await provider.matrix(request(["DEPOT", "B"], { distanceUnit: "km" }));
  check("T102", Math.abs(matrixMeters.distances[0][1] / 1000 - matrixKm.distances[0][1]) < 1e-9);
  const matrixSeconds = await provider.matrix(request(["DEPOT", "B"], { durationUnit: "seconds" }));
  const matrixMinutes = await provider.matrix(request(["DEPOT", "B"], { durationUnit: "minutes" }));
  check("T103", Math.abs(matrixSeconds.durations[0][1] / 60 - matrixMinutes.durations[0][1]) < 1e-9);
  const unreachable = await provider.matrix(request(["DEPOT", "ISOLATED"]));
  check("T104", unreachable.distances[0][1] === null && unreachable.unreachablePairs.some((row) => row.sourceId === "DEPOT" && row.targetId === "ISOLATED"), unreachable.unreachablePairs);
  check("T105", unreachable.distances[0][1] === null && !Number.isFinite(unreachable.distances[0][1]));
  check("T106", matrix.asymmetry.asymmetric === true, matrix.asymmetry);
  check("T107", matrix.metricity.nonMetric === true && matrix.metricity.violations.length > 0, matrix.metricity);
  const matrixChanged = await provider.matrix(request(["DEPOT", "B", "C"], { closures: ["E_B_C"] }));
  check("T108", matrix.matrixHash !== matrixChanged.matrixHash);
  check("T109", detour.routeHash !== (await provider.route(request(["DEPOT", "C"], { closures: ["E_N2_N3"] }))).routeHash);
  check("T110", detour.routeHash !== (await provider.route(request(["C", "DEPOT"]))).routeHash);
  check("T111", Math.abs(detour.legs.reduce((sum, leg) => sum + leg.distance, 0) - detour.totalDistance) < 1e-9);
  check("T112", Math.abs(detour.legs.reduce((sum, leg) => sum + leg.duration, 0) - detour.totalDuration) < 1e-9);
  const edgeMap = new Map(graph.edges.map((edge) => [edge.edgeId, edge]));
  check("T113", detour.legs.every((leg) => leg.edgeIds.every((edgeId) => edgeMap.has(edgeId))) && detour.geometry.length >= detour.edgeIds.length + 1);
  check("T114", detour.restrictionsApplied.some((row) => row.type === "NO_TURN" && row.enforced === true), detour.restrictionsApplied);
  check("T115", toll.tollSummary.tollEdgeCount === toll.edgeIds.filter((edgeId) => edgeMap.get(edgeId).toll).length, toll.tollSummary);

  const pairMatrix = await provider.matrix(request(["DEPOT", "C"]));
  const consistent = Routing.sampleRouteConsistency(pairMatrix, [detour]);
  check("T116", consistent.status === "CONSISTENT", consistent);
  const nearRoute = { ...detour, totalDistance: detour.totalDistance + 0.0005, totalDuration: detour.totalDuration + 0.01 };
  check("T117", Routing.sampleRouteConsistency(pairMatrix, [nearRoute], { distance: 0.001, duration: 0.02 }).status === "WITHIN_TOLERANCE");
  const badRoute = { ...detour, totalDistance: detour.totalDistance + 1, totalDuration: detour.totalDuration + 10 };
  check("T118", Routing.sampleRouteConsistency(pairMatrix, [badRoute]).status === "INCONSISTENT");
  check("T119", Routing.verifyRoadAwareCandidate(pairMatrix, [badRoute]).status === "FAIL" && Routing.verifyRoadAwareCandidate(pairMatrix, [badRoute]).roadAwareStatus !== "ROAD_AWARE_PASS");

  const estimated = registry.get("ESTIMATED_HAVERSINE_FALLBACK");
  const estimatedRoute = await estimated.route(request(["DEPOT", "C"], { providerId: estimated.id }));
  check("T120", estimatedRoute.estimated === true && estimatedRoute.warnings.includes("ESTIMATED_NOT_ROAD_AWARE") && detour.providerProvenance.mode === "ROAD_FIXTURE");
  const lightUnderpass = await provider.route(request(["C", "H"], { vehicleProfile: light() }));
  const truckMorph = Routing.routeMorph(lightUnderpass, tall, { beforeLabel: "Light Truck", afterLabel: "Heavy Truck" });
  check("T121", truckMorph.changedEdges.length > 0 && truckMorph.before.label === "Light Truck" && truckMorph.after.label === "Heavy Truck", truckMorph);
  const closureMorph = Routing.routeMorph(baselineClosure, closed, { beforeLabel: "Base", afterLabel: "Closure" });
  check("T122", closureMorph.changedEdges.includes("E_H_ZONE_B_FREE"), closureMorph.changedEdges);
  check("T123", Routing.routeMorph(baselineClosure, closed, { reducedMotion: true }).mode === "STATIC_BEFORE_AFTER");
  const noWebGL = Routing.noWebGLTable(pairMatrix, detour);
  check("T124", noWebGL.mode === "NO_WEBGL_OPERATIONAL" && noWebGL.rows.length === detour.legs.length && noWebGL.matrixHash === pairMatrix.matrixHash, noWebGL);
  check("T125", ["providerId", "providerVersion", "profile", "snapSummary", "restrictionsApplied"].every((key) => key === "profile" ? Boolean(pairMatrix.profile) : Object.hasOwn(detour, key)), { route: detour, matrix: pairMatrix });
  const zone = Routing.zoneDiagnostic(graph, await provider.route(request(["DEPOT", "ZONE_B"])));
  check("T126", zone.crossesServiceZone === true && zone.zoneIds.includes("ZONE_A") && zone.zoneIds.includes("ZONE_B"), zone);
  check("T127", graph.customerRoadClaim === false && graph.graphId.includes("SYNTHETIC"));
  check("T128", graph.dataClassification === "SYNTHETIC" && graph.zones.every((row) => row.classification === "SYNTHETIC"));

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "stct-road-fixture-"));
  const fixturePath = path.join(temp, "fixture.json"); fs.writeFileSync(fixturePath, `${JSON.stringify(graph)}\n`);
  const replayed = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  check("T129", Routing.validateGraph(replayed).status === "PASS" && Routing.validateGraph(replayed).graphHash === graph.graphHash, { temp });
  fs.rmSync(temp, { recursive: true, force: true });
  const exported = JSON.parse(JSON.stringify(detour));
  check("T130", exported.providerProvenance?.providerOwned === true && exported.providerProvenance?.provenanceHash && Integrity.hashValue(Routing.routeIdentity(exported)) === exported.routeHash, exported.providerProvenance);

  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks.map((row) => row.id), graphHash: graph.graphHash }, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
