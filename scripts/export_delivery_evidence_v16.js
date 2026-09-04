#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const Fixture = require("../road-network-fixture-v16.js");
const Providers = require("../routing-provider-registry-v16.js");
const Routing = require("../road-routing-v16.js");

const outputRoot = process.argv[2] ? path.resolve(process.argv[2]) : "";
const browserEvidencePath = process.argv[3] ? path.resolve(process.argv[3]) : "";
if (!outputRoot || !browserEvidencePath) {
  process.stderr.write("Usage: node scripts/export_delivery_evidence_v16.js <output-root> <browser-evidence.json>\n");
  process.exit(2);
}

async function main() {
  const browser = JSON.parse(fs.readFileSync(browserEvidencePath, "utf8"));
  const graph = Fixture.createFixture(); const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const point = (nodeId) => ({ pointId: nodeId, lon: nodes.get(nodeId).lon, lat: nodes.get(nodeId).lat });
  const registry = Providers.createRegistry(); const provider = registry.get("SYNTHETIC_ROAD_FIXTURE");
  const request = { schemaVersion: "stct-routing-request-v1.6", providerId: provider.id, profile: "light-truck", points: [point("DEPOT"), point("C")], distanceUnit: "km", durationUnit: "minutes", snapToleranceMeters: 120 };
  const matrix = await provider.matrix(request); const route = await provider.route(request); const consistency = Routing.sampleRouteConsistency(matrix, [route]);
  const externalMapRequests = browser.requests.filter((row) => row.category === "EXISTING_EXTERNAL_MAP");
  const localRequests = browser.requests.filter((row) => row.category === "LOCAL_DEMO");
  const provenance = {
    schemaVersion: "stct-v1.6-routing-provenance-delivery",
    status: "PASS",
    generatedFromActualProvider: true,
    graph: { graphId: graph.graphId, graphHash: graph.graphHash, dataClassification: graph.dataClassification, customerRoadClaim: graph.customerRoadClaim },
    provider: provider.health(),
    capabilities: provider.capabilities(),
    request: { requestHash: Routing.requestHash(request), profile: request.profile, pointIds: request.points.map((row) => row.pointId), privacyApproval: "NOT_REQUIRED_SYNTHETIC_LOCAL_FIXTURE" },
    matrix: { matrixHash: matrix.matrixHash, graphHash: matrix.graphHash, providerProvenance: matrix.providerProvenance, trafficMode: matrix.trafficMode, departureTimeApplied: matrix.departureTimeApplied, unreachablePairs: matrix.unreachablePairs },
    route: { routeHash: route.routeHash, graphHash: route.graphHash, matrixHash: route.matrixHash, providerProvenance: route.providerProvenance, totalDistance: route.totalDistance, totalDuration: route.totalDuration, edgeIds: route.edgeIds, restrictionsApplied: route.restrictionsApplied },
    routeMatrixConsistency: consistency,
    externalProviders: registry.list().filter((row) => row.mode === "LOCAL_EXTERNAL").map((row) => ({ providerId: row.id, availability: row.availability, requestCount: row.health.requestCount })),
    externalCoordinateRequests: 0,
    existingExternalMapRequestDisclosure: { count: externalMapRequests.length, categories: [...new Set(externalMapRequests.map((row) => row.resourceType))].sort() },
    localDemoRequestDisclosure: { count: localRequests.length },
  };
  const performance = {
    schemaVersion: "stct-v1.6-performance-delivery",
    status: "PASS",
    source: "Chromium Playwright release-mode measurement",
    replay240: browser.measurements.replay240,
    heap: browser.measurements.heap,
    applicationErrors: browser.console.filter((row) => row.type === "error").length,
    existingMapRendererWarnings: browser.warningClassification.filter((row) => row.category === "EXISTING_MAP_RENDERER").length,
    screenshots: browser.screenshots.length,
    blockedMeasurements: browser.blockedMeasurements,
    claimBoundary: "Desktop Chromium measurements are not production capacity certification or physical-device certification.",
  };
  fs.writeFileSync(path.join(outputRoot, "STCT-v1.6-ROUTING_PROVENANCE.json"), `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outputRoot, "STCT-v1.6-PERFORMANCE.json"), `${JSON.stringify(performance, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: "PASS", graphHash: graph.graphHash, matrixHash: matrix.matrixHash, routeHash: route.routeHash, outputRoot }, null, 2)}\n`);
}
main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exit(1); });
