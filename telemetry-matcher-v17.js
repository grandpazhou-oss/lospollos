(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const telemetry = root?.STCTV17?.telemetry || (typeof require === "function" ? require("./telemetry-v17.js") : null);
  const roadRouting = root?.STCTV16?.roadRouting || (typeof require === "function" ? require("./road-routing-v16.js") : null);
  const api = factory(integrity, telemetry, roadRouting);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV17 = root.STCTV17 || { version: "1.7.0" }; root.STCTV17.telemetryMatcher = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash, Telemetry, RoadRouting) {
  "use strict";
  if (!IntegrityHash?.hashValue || !Telemetry?.createDerived || !RoadRouting?.haversineMeters) throw new Error("Telemetry Matcher v1.7 dependencies are missing.");
  const VERSION = "stct-telemetry-matcher-v1.7";
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();

  function closestDistance(coordinate, geometry = []) { return geometry.length ? Math.min(...geometry.map((point) => RoadRouting.haversineMeters(coordinate, point))) : 0; }
  function confidence(providerConfidence, accuracyMeters, unmatched) {
    if (unmatched) return "UNMATCHED";
    const rank = { HIGH: 3, MEDIUM: 2, LOW: 1, FAILED: 0 }; let score = rank[providerConfidence] ?? 0;
    if (accuracyMeters > 100) score = Math.min(score, 1); else if (accuracyMeters > 35) score = Math.min(score, 2);
    return ["FAILED", "LOW", "MEDIUM", "HIGH"][score];
  }
  function edgeDistance(graph, edgeId, coordinate) {
    const edge = graph?.edges?.find((row) => row.edgeId === edgeId); if (!edge) return null;
    return closestDistance(coordinate, edge.geometry || []);
  }
  function plausibility(input) {
    const reasons = []; let status = "PASS";
    const add = (reason, severity = "WARN") => { if (!reasons.includes(reason)) reasons.push(reason); if (severity === "REJECT" || status === "PASS") status = severity; };
    if (input.duration < 0) add("TIME_MOVED_BACKWARDS", "REJECT");
    if (input.duration === 0 && input.distance > 0) add("ZERO_DURATION_MOVEMENT", "REJECT");
    if (input.speed > 180) add("IMPOSSIBLE_SPEED", "REJECT"); else if (input.speed > 120) add("IMPOSSIBLE_SPEED", "WARN");
    if (input.distance > 1000 && input.duration > 0 && input.duration <= 5) add("TELEPORT", input.distance > 2000 ? "REJECT" : "WARN");
    if (input.unknownClaimedEdge) add("ROAD_EDGE_NOT_IN_GRAPH", "WARN");
    if (input.claimedEdgeDistance > 250) add("COORDINATE_TOO_FAR_FROM_CLAIMED_EDGE", "WARN");
    if (input.matchStatus !== "ROAD_MATCHED") add("UNMATCHED_ESTIMATE", "WARN");
    if (input.matchConfidence === "LOW" || input.matchConfidence === "FAILED") add("LOW_MATCH_CONFIDENCE", "WARN");
    if (input.closedMatchedEdge) add("MATCHED_EDGE_CLOSED", "WARN");
    if (input.routeCorridorDistance > input.offRouteThreshold) add("OUTSIDE_ROUTE_CORRIDOR", "WARN");
    return { status, reasons };
  }

  async function derive(observation, previous = null, options = {}) {
    const graph = options.graph || null; const routeGeometry = clone(options.routeGeometry || []); const offRouteThreshold = Number(options.offRouteThresholdMeters || 150); const closures = clone(options.closures || []); const provider = options.provider;
    let match = null; let providerProvenance = { providerId: "ESTIMATED_HAVERSINE_FALLBACK", providerVersion: "1.7", graphHash: graph?.graphHash || null, dataClassification: "SYNTHETIC", privacyMode: "NO_EXTERNAL_COORDINATE_TRANSMISSION" }; let matchStatus = "UNMATCHED_ESTIMATE";
    if (provider?.match) {
      try {
        const anchor = previous?.matchedCoordinate || observation.coordinate;
        const response = await provider.match({ providerId: provider.id, profile: text(options.profile || "LIGHT_TRUCK"), points: [{ pointId: `${observation.observationId}-ANCHOR`, lon: anchor[0], lat: anchor[1] }, { pointId: observation.observationId, lon: observation.coordinate[0], lat: observation.coordinate[1] }], vehicleProfile: clone(options.vehicleProfile || { vehicleType: "LIGHT_TRUCK" }), closures, snapToleranceMeters: Number(options.snapToleranceMeters || 120), distanceUnit: "m", durationUnit: "seconds", allowLowConfidenceSnap: true, requestId: observation.observationId });
        match = response.matches?.at(-1) || null; providerProvenance = { ...clone(response.providerProvenance || {}), providerId: response.providerId || provider.id, providerVersion: response.providerVersion || provider.version, graphHash: response.graphHash || response.providerProvenance?.graphHash || graph?.graphHash || null };
        if (match?.status === "SNAPPED" && match?.edgeId) matchStatus = "ROAD_MATCHED";
      } catch (error) { providerProvenance = { ...providerProvenance, fallbackReason: text(error.code || error.message) }; }
    }
    const closedIds = new Set(closures.map((row) => text(typeof row === "string" ? row : row.edgeId))); const closedMatchedEdge = match?.edgeId && closedIds.has(match.edgeId);
    if (closedMatchedEdge) matchStatus = "UNMATCHED_ESTIMATE";
    const matchedCoordinate = matchStatus === "ROAD_MATCHED" ? clone(match.snappedCoordinate) : clone(observation.coordinate); const matchedEdgeId = matchStatus === "ROAD_MATCHED" ? text(match.edgeId) : "";
    const previousCoordinate = previous?.matchedCoordinate || previous?.coordinate || null; const distance = previousCoordinate ? RoadRouting.haversineMeters(previousCoordinate, matchedCoordinate) : 0; const duration = previous ? Number(observation.logicalTime) - Number(previous.logicalTime) : 0; const speed = duration > 0 ? distance / duration * 3.6 : distance > 0 ? Infinity : 0; const corridor = closestDistance(matchedCoordinate, routeGeometry); const unknownClaimedEdge = Boolean(observation.reportedRoadEdgeId && graph && !graph.edges?.some((edge) => edge.edgeId === observation.reportedRoadEdgeId)); const claimedEdgeDistance = observation.reportedRoadEdgeId && graph ? edgeDistance(graph, observation.reportedRoadEdgeId, observation.coordinate) : null; const matchConfidence = confidence(match?.confidence || "FAILED", observation.accuracyMeters, matchStatus !== "ROAD_MATCHED");
    const checks = plausibility({ duration, distance, speed, unknownClaimedEdge, claimedEdgeDistance, matchStatus, matchConfidence, closedMatchedEdge, routeCorridorDistance: corridor, offRouteThreshold });
    return Telemetry.createDerived({ observationHash: observation.observationHash, previousObservationHash: previous?.observationHash || "", executionRunHash: observation.executionRunHash, vehicleId: observation.vehicleId, logicalTime: observation.logicalTime, matchedCoordinate, matchedEdgeId, snapDistanceMeters: Number(match?.distanceMeters || 0), matchConfidence, matchStatus, derivedSegmentDistanceMeters: Number(distance.toFixed(3)), derivedDurationSeconds: duration, derivedSpeedKph: Number.isFinite(speed) ? Number(speed.toFixed(3)) : 999999, routeCorridorDistanceMeters: Number(corridor.toFixed(3)), offRoute: corridor > offRouteThreshold || matchStatus !== "ROAD_MATCHED", plausibility: checks, providerProvenance });
  }

  return { VERSION, closestDistance, confidence, edgeDistance, plausibility, derive };
});
