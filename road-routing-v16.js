(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const api = factory(integrity);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV16 = root.STCTV16 || { version: "1.6.0" };
    root.STCTV16.roadRouting = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash) {
  "use strict";

  if (!IntegrityHash?.hashValue) throw new Error("Road routing v1.6 requires the v1.5.1 SHA-256 utility.");
  const VERSION = "stct-road-routing-v1.6";
  const SCHEMA_VERSION = "stct-routing-request-v1.6";
  const ALLOWED_REQUEST_FIELDS = new Set(["schemaVersion", "providerId", "profile", "points", "departureLogicalTime", "vehicleProfile", "avoidTolls", "closures", "restrictions", "snapToleranceMeters", "alternatives", "distanceUnit", "durationUnit", "allowLowConfidenceSnap", "requestId"]);
  const VEHICLE_TYPES = new Set(["LIGHT_TRUCK", "HEAVY_TRUCK", "VAN"]);
  const DISTANCE_UNITS = new Set(["m", "km"]);
  const DURATION_UNITS = new Set(["seconds", "minutes"]);

  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  const number = (value, fallback = NaN) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
  function fail(code, message, detail = {}) { const error = new Error(message); error.code = code; error.detail = clone(detail); throw error; }
  function coordinate(value) { return [number(value?.lon ?? value?.lng ?? value?.coordinate?.[0]), number(value?.lat ?? value?.coordinate?.[1])]; }
  function validCoordinate(pair) { return Number.isFinite(pair[0]) && Number.isFinite(pair[1]) && pair[0] >= -180 && pair[0] <= 180 && pair[1] >= -90 && pair[1] <= 90; }

  function haversineMeters(left, right) {
    const radius = 6371008.8;
    const rad = (value) => value * Math.PI / 180;
    const dLat = rad(right[1] - left[1]); const dLon = rad(right[0] - left[0]);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(left[1])) * Math.cos(rad(right[1])) * Math.sin(dLon / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function validateGraph(graph) {
    const errors = [];
    if (!text(graph?.schemaVersion)) errors.push("GRAPH_SCHEMA_REQUIRED");
    if (!text(graph?.graphId)) errors.push("GRAPH_ID_REQUIRED");
    if (!text(graph?.coordinateReference)) errors.push("GRAPH_CRS_REQUIRED");
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph?.edges) ? graph.edges : [];
    const nodeIds = nodes.map((node) => text(node.nodeId)); const edgeIds = edges.map((edge) => text(edge.edgeId));
    if (!nodes.length) errors.push("GRAPH_NODES_REQUIRED");
    if (!edges.length) errors.push("GRAPH_EDGES_REQUIRED");
    if (nodeIds.some((id) => !id) || new Set(nodeIds).size !== nodeIds.length) errors.push("GRAPH_NODE_IDS_INVALID");
    if (edgeIds.some((id) => !id) || new Set(edgeIds).size !== edgeIds.length) errors.push("GRAPH_EDGE_IDS_INVALID");
    const byNode = new Map(nodes.map((node) => [text(node.nodeId), node]));
    nodes.forEach((node) => { if (!validCoordinate(coordinate(node))) errors.push(`GRAPH_NODE_COORDINATE_INVALID:${text(node.nodeId)}`); });
    edges.forEach((edge) => {
      const from = byNode.get(text(edge.fromNodeId)); const to = byNode.get(text(edge.toNodeId));
      if (!from || !to) errors.push(`GRAPH_EDGE_NODE_MISSING:${text(edge.edgeId)}`);
      if (!(number(edge.distanceMeters, 0) > 0)) errors.push(`GRAPH_EDGE_DISTANCE_INVALID:${text(edge.edgeId)}`);
      if (!(number(edge.baseDurationSeconds, 0) > 0)) errors.push(`GRAPH_EDGE_DURATION_INVALID:${text(edge.edgeId)}`);
      const geometry = edge.geometry;
      if (!Array.isArray(geometry) || geometry.length < 2 || !geometry.every(validCoordinate)) errors.push(`GRAPH_EDGE_GEOMETRY_INVALID:${text(edge.edgeId)}`);
      else if (from && to && (JSON.stringify(geometry[0]) !== JSON.stringify(coordinate(from)) || JSON.stringify(geometry.at(-1)) !== JSON.stringify(coordinate(to)))) errors.push(`GRAPH_EDGE_GEOMETRY_ENDPOINT_MISMATCH:${text(edge.edgeId)}`);
    });
    const semantic = clone(graph || {}); delete semantic.graphHash; delete semantic.snapPoints; delete semantic.scenarios;
    const expectedHash = IntegrityHash.hashValue(semantic);
    if (text(graph?.graphHash) && graph.graphHash !== expectedHash) errors.push("GRAPH_HASH_STALE");
    return { status: errors.length ? "FAIL" : "PASS", errors, graphHash: expectedHash };
  }

  function normalizeVehicleProfile(input = {}) {
    const profile = {
      vehicleType: text(input.vehicleType || "LIGHT_TRUCK").toUpperCase(),
      heightM: number(input.heightM, 2.8),
      widthM: number(input.widthM, 2.1),
      lengthM: number(input.lengthM, 6.0),
      grossWeightKg: number(input.grossWeightKg, 6500),
      axleWeightKg: number(input.axleWeightKg, 3500),
      hazmat: input.hazmat === true,
    };
    if (!VEHICLE_TYPES.has(profile.vehicleType)) fail("VEHICLE_TYPE_UNSUPPORTED", `Unsupported vehicleType: ${profile.vehicleType}`);
    ["heightM", "widthM", "lengthM", "grossWeightKg", "axleWeightKg"].forEach((field) => {
      if (!(profile[field] > 0)) fail(`VEHICLE_${field.replace(/[a-z]/g, (character) => `_${character.toUpperCase()}`).replace(/^_/, "")}_INVALID`, `${field} must be positive.`);
    });
    return profile;
  }

  function normalizePoints(points, maxPoints) {
    if (!Array.isArray(points) || points.length < 2) fail("ROUTING_POINTS_REQUIRED", "At least two routing points are required.");
    if (points.length > maxPoints) fail("ROUTING_POINT_LIMIT", `Routing request exceeds ${maxPoints} points.`);
    const ids = new Set();
    return points.map((point, index) => {
      if (!point || typeof point !== "object" || Array.isArray(point)) fail("ROUTING_POINT_TYPE_INVALID", `Point ${index} must be an object.`);
      const pointId = text(point.pointId || point.id);
      const pair = coordinate(point);
      if (!pointId) fail("ROUTING_POINT_ID_REQUIRED", `Point ${index} has no pointId.`);
      if (ids.has(pointId)) fail("ROUTING_POINT_ID_DUPLICATE", `Duplicate pointId: ${pointId}`);
      if (!validCoordinate(pair)) fail("ROUTING_POINT_COORDINATE_INVALID", `Invalid coordinate for ${pointId}.`);
      ids.add(pointId);
      return { pointId, lon: pair[0], lat: pair[1] };
    });
  }

  function normalizeClosures(closures) {
    if (closures === undefined) return [];
    if (!Array.isArray(closures)) fail("ROUTING_CLOSURES_TYPE_INVALID", "closures must be an array.");
    const rows = new Map();
    closures.forEach((closure, index) => {
      const edgeId = text(typeof closure === "string" ? closure : closure?.edgeId || closure?.closureId);
      if (!edgeId) fail("ROUTING_CLOSURE_ID_REQUIRED", `Closure ${index} has no edgeId.`);
      if (!rows.has(edgeId)) rows.set(edgeId, { edgeId, reason: text(closure?.reason || "SYNTHETIC_CLOSURE") });
    });
    return [...rows.values()].sort((a, b) => a.edgeId.localeCompare(b.edgeId, "en"));
  }

  function normalizeRequest(input = {}, options = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) fail("ROUTING_REQUEST_TYPE_INVALID", "Routing request must be an object.");
    const unknownFields = Object.keys(input).filter((field) => !ALLOWED_REQUEST_FIELDS.has(field));
    if (unknownFields.length && options.unknownFieldPolicy !== "IGNORE") fail("ROUTING_UNKNOWN_FIELD", `Unknown routing fields: ${unknownFields.join(", ")}`, { unknownFields });
    const providerId = text(input.providerId).toUpperCase(); const profile = text(input.profile);
    const distanceUnit = text(input.distanceUnit); const durationUnit = text(input.durationUnit);
    if (!providerId) fail("ROUTING_PROVIDER_REQUIRED", "providerId is required.");
    if (!profile) fail("ROUTING_PROFILE_REQUIRED", "profile is required.");
    if (!distanceUnit || !durationUnit) fail("ROUTING_UNITS_REQUIRED", "distanceUnit and durationUnit are required.");
    if (!DISTANCE_UNITS.has(distanceUnit) || !DURATION_UNITS.has(durationUnit)) fail("ROUTING_UNITS_UNSUPPORTED", `Unsupported units: ${distanceUnit}/${durationUnit}`);
    const snapToleranceMeters = number(input.snapToleranceMeters, 120);
    if (!(snapToleranceMeters > 0 && snapToleranceMeters <= 2000)) fail("SNAP_TOLERANCE_INVALID", "snapToleranceMeters must be between 0 and 2000.");
    const normalized = {
      schemaVersion: text(input.schemaVersion || SCHEMA_VERSION),
      providerId,
      profile,
      points: normalizePoints(input.points, number(options.maxPoints, 256)),
      departureLogicalTime: input.departureLogicalTime === undefined || input.departureLogicalTime === null ? null : number(input.departureLogicalTime),
      vehicleProfile: normalizeVehicleProfile(input.vehicleProfile || {}),
      avoidTolls: input.avoidTolls === true,
      closures: normalizeClosures(input.closures),
      restrictions: clone(input.restrictions || {}),
      snapToleranceMeters,
      alternatives: Math.max(0, Math.min(3, Math.trunc(number(input.alternatives, 0)))),
      distanceUnit,
      durationUnit,
      allowLowConfidenceSnap: input.allowLowConfidenceSnap === true,
      requestId: text(input.requestId),
    };
    if (normalized.schemaVersion !== SCHEMA_VERSION) fail("ROUTING_SCHEMA_UNSUPPORTED", `Unsupported routing schema: ${normalized.schemaVersion}`);
    if (input.departureLogicalTime !== undefined && input.departureLogicalTime !== null && !Number.isFinite(normalized.departureLogicalTime)) fail("DEPARTURE_LOGICAL_TIME_INVALID", "departureLogicalTime must be finite.");
    return normalized;
  }

  function requestHash(request, options = {}) {
    const normalized = normalizeRequest(request, options);
    return IntegrityHash.hashValue({ ...normalized, requestId: "" });
  }

  function nodeIndexes(graph) {
    const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node]));
    const edges = new Map(graph.edges.map((edge) => [edge.edgeId, edge]));
    const outgoing = new Map(graph.nodes.map((node) => [node.nodeId, []]));
    graph.edges.forEach((edge) => outgoing.get(edge.fromNodeId)?.push(edge));
    outgoing.forEach((rows) => rows.sort((a, b) => a.edgeId.localeCompare(b.edgeId, "en")));
    return { nodes, edges, outgoing };
  }

  function confidenceFor(distance, tolerance) {
    if (distance <= 15) return "HIGH";
    if (distance <= 45) return "MEDIUM";
    if (distance <= tolerance) return "LOW";
    return "FAILED";
  }

  function snapPoint(graph, point, options = {}) {
    const tolerance = number(options.snapToleranceMeters, 120); const sourceCoordinate = coordinate(point);
    if (!validCoordinate(sourceCoordinate)) fail("SNAP_COORDINATE_INVALID", `Invalid coordinate for ${text(point?.pointId || point?.id)}.`);
    const ranked = graph.nodes.map((node) => ({ node, distanceMeters: haversineMeters(sourceCoordinate, [node.lon, node.lat]) })).sort((a, b) => a.distanceMeters - b.distanceMeters || a.node.nodeId.localeCompare(b.node.nodeId, "en"));
    const best = ranked[0]; const confidence = confidenceFor(best.distanceMeters, tolerance);
    const alternatives = ranked.slice(1).filter((row) => row.distanceMeters <= Math.max(tolerance, best.distanceMeters + 25)).slice(0, 3).map((row) => ({ nodeId: row.node.nodeId, snappedCoordinate: [row.node.lon, row.node.lat], distanceMeters: Number(row.distanceMeters.toFixed(3)), confidence: confidenceFor(row.distanceMeters, tolerance) }));
    const outgoing = graph.edges.find((edge) => edge.fromNodeId === best.node.nodeId);
    return {
      pointId: text(point?.pointId || point?.id),
      sourceCoordinate,
      snappedCoordinate: [best.node.lon, best.node.lat],
      nodeId: confidence === "FAILED" ? null : best.node.nodeId,
      edgeId: confidence === "FAILED" ? null : outgoing?.edgeId || null,
      distanceMeters: Number(best.distanceMeters.toFixed(3)),
      confidence,
      alternatives,
      status: confidence === "FAILED" ? "FAILED" : "SNAPPED",
    };
  }

  function snap(graph, points, options = {}) {
    const results = points.map((point) => snapPoint(graph, point, options));
    const counts = ["HIGH", "MEDIUM", "LOW", "FAILED"].reduce((out, key) => ({ ...out, [key]: results.filter((result) => result.confidence === key).length }), {});
    return { status: counts.FAILED ? "FAILED" : counts.LOW ? "LOW_CONFIDENCE" : "PASS", results, summary: { pointCount: results.length, ...counts, allowLowConfidenceSnap: options.allowLowConfidenceSnap === true } };
  }

  function edgeEligibility(edge, request, previousEdgeId, graph) {
    const reasons = [];
    const vehicle = request.vehicleProfile;
    if (request.closures.some((closure) => closure.edgeId === edge.edgeId)) reasons.push("CLOSURE");
    if (request.avoidTolls && edge.toll) reasons.push("AVOID_TOLL");
    if (edge.maxHeightM !== null && vehicle.heightM > edge.maxHeightM) reasons.push("MAX_HEIGHT");
    if (edge.maxWidthM !== null && vehicle.widthM > edge.maxWidthM) reasons.push("MAX_WIDTH");
    if (edge.maxWeightKg !== null && vehicle.grossWeightKg > edge.maxWeightKg) reasons.push("MAX_WEIGHT");
    if (vehicle.hazmat && edge.hazmatAllowed === false) reasons.push("HAZMAT_FORBIDDEN");
    if (Array.isArray(edge.vehicleTypes) && !edge.vehicleTypes.includes(vehicle.vehicleType)) reasons.push("VEHICLE_TYPE");
    if (graph.restrictions.some((restriction) => restriction.type === "NO_TURN" && restriction.fromEdgeId === previousEdgeId && restriction.toEdgeId === edge.edgeId)) reasons.push("NO_TURN");
    return { allowed: reasons.length === 0, reasons };
  }

  function shortestPath(graph, fromNodeId, toNodeId, request) {
    const indexes = nodeIndexes(graph);
    if (!indexes.nodes.has(fromNodeId) || !indexes.nodes.has(toNodeId)) fail("ROUTING_NODE_NOT_FOUND", `Unknown node: ${fromNodeId} or ${toNodeId}`);
    if (fromNodeId === toNodeId) return { status: "PASS", nodeIds: [fromNodeId], edges: [], distanceMeters: 0, durationSeconds: 0, rejected: [] };
    const queue = [{ nodeId: fromNodeId, previousEdgeId: "", distance: 0, duration: 0, edges: [], rejected: [] }];
    const best = new Map();
    while (queue.length) {
      queue.sort((a, b) => a.distance - b.distance || a.duration - b.duration || `${a.nodeId}:${a.previousEdgeId}`.localeCompare(`${b.nodeId}:${b.previousEdgeId}`, "en"));
      const current = queue.shift(); const stateKey = `${current.nodeId}|${current.previousEdgeId}`;
      if (best.has(stateKey) && best.get(stateKey) < current.distance) continue;
      if (current.nodeId === toNodeId) return { status: "PASS", nodeIds: [fromNodeId, ...current.edges.map((edge) => edge.toNodeId)], edges: current.edges, distanceMeters: current.distance, durationSeconds: current.duration, rejected: current.rejected };
      for (const edge of indexes.outgoing.get(current.nodeId) || []) {
        const eligibility = edgeEligibility(edge, request, current.previousEdgeId, graph);
        if (!eligibility.allowed) continue;
        const nextDistance = current.distance + edge.distanceMeters; const nextKey = `${edge.toNodeId}|${edge.edgeId}`;
        if (best.has(nextKey) && best.get(nextKey) <= nextDistance) continue;
        best.set(nextKey, nextDistance);
        queue.push({ nodeId: edge.toNodeId, previousEdgeId: edge.edgeId, distance: nextDistance, duration: current.duration + edge.baseDurationSeconds, edges: [...current.edges, edge], rejected: current.rejected });
      }
    }
    return { status: "UNREACHABLE", nodeIds: [], edges: [], distanceMeters: null, durationSeconds: null, rejected: [] };
  }

  function routeIdentity(route) {
    return {
      schemaVersion: "stct-road-route-v1.6",
      providerId: route.providerId,
      providerVersion: route.providerVersion,
      graphHash: route.graphHash,
      requestHash: route.requestHash,
      matrixHash: route.matrixHash || null,
      pointIds: route.pointIds,
      legs: route.legs,
      totalDistance: route.totalDistance,
      totalDuration: route.totalDuration,
      geometry: route.geometry,
      edgeIds: route.edgeIds,
      restrictionsApplied: route.restrictionsApplied,
      tollSummary: route.tollSummary,
    };
  }

  function restrictionsApplied(edges, request, graph) {
    const rows = [];
    if (request.avoidTolls) rows.push({ type: "AVOID_TOLLS", value: true });
    request.closures.forEach((closure) => rows.push({ type: "CLOSURE", edgeId: closure.edgeId }));
    edges.forEach((edge) => {
      if (edge.maxHeightM !== null) rows.push({ type: "MAX_HEIGHT", edgeId: edge.edgeId, limit: edge.maxHeightM });
      if (edge.maxWidthM !== null) rows.push({ type: "MAX_WIDTH", edgeId: edge.edgeId, limit: edge.maxWidthM });
      if (edge.maxWeightKg !== null) rows.push({ type: "MAX_WEIGHT", edgeId: edge.edgeId, limit: edge.maxWeightKg });
      if (edge.hazmatAllowed === false) rows.push({ type: "HAZMAT_FORBIDDEN", edgeId: edge.edgeId });
      if (edge.toll) rows.push({ type: "TOLL", edgeId: edge.edgeId });
    });
    graph.restrictions.filter((restriction) => restriction.type === "NO_TURN").forEach((restriction) => rows.push({ type: "NO_TURN", restrictionId: restriction.restrictionId, enforced: true }));
    return rows.filter((row, index, all) => all.findIndex((item) => JSON.stringify(item) === JSON.stringify(row)) === index);
  }

  function buildRoute(graph, input, provider = {}) {
    const request = normalizeRequest(input); const requestIdentity = requestHash(request);
    const snapReport = snap(graph, request.points, request);
    if (snapReport.summary.FAILED) fail("SNAP_FAILED", "One or more points could not be snapped.", snapReport);
    if (snapReport.summary.LOW && !request.allowLowConfidenceSnap) fail("LOW_CONFIDENCE_SNAP_BLOCKED", "Low-confidence snap requires explicit Demo override.", snapReport);
    const legs = []; const allEdges = []; const geometry = [];
    for (let index = 0; index < snapReport.results.length - 1; index += 1) {
      const from = snapReport.results[index]; const to = snapReport.results[index + 1];
      const path = shortestPath(graph, from.nodeId, to.nodeId, request);
      if (path.status !== "PASS") fail("ROAD_ROUTE_UNREACHABLE", `Road route is unreachable: ${from.pointId} -> ${to.pointId}`, { fromPointId: from.pointId, toPointId: to.pointId });
      const legGeometry = path.edges.flatMap((edge, edgeIndex) => edge.geometry.slice(edgeIndex ? 1 : 0));
      const tollEdges = path.edges.filter((edge) => edge.toll).map((edge) => edge.edgeId);
      const leg = {
        fromPointId: from.pointId,
        toPointId: to.pointId,
        distance: request.distanceUnit === "km" ? path.distanceMeters / 1000 : path.distanceMeters,
        duration: request.durationUnit === "minutes" ? path.durationSeconds / 60 : path.durationSeconds,
        geometry: legGeometry,
        edgeIds: path.edges.map((edge) => edge.edgeId),
        roadClasses: [...new Set(path.edges.map((edge) => edge.roadClass))],
        toll: tollEdges.length > 0,
        restrictionNotes: restrictionsApplied(path.edges, request, graph),
      };
      legs.push(leg); allEdges.push(...path.edges); geometry.push(...legGeometry.slice(index ? 1 : 0));
    }
    const totalDistance = legs.reduce((sum, leg) => sum + leg.distance, 0); const totalDuration = legs.reduce((sum, leg) => sum + leg.duration, 0);
    const route = {
      schemaVersion: "stct-road-route-v1.6",
      routeId: `ROAD-${requestIdentity.split(":").at(-1).slice(0, 12)}`,
      providerId: text(provider.id || request.providerId),
      providerVersion: text(provider.version || "1.6.0"),
      graphHash: graph.graphHash,
      requestHash: requestIdentity,
      pointIds: request.points.map((point) => point.pointId),
      legs,
      totalDistance,
      totalDuration,
      distanceUnit: request.distanceUnit,
      durationUnit: request.durationUnit,
      geometry,
      edgeIds: allEdges.map((edge) => edge.edgeId),
      matrixHash: null,
      snapSummary: snapReport.summary,
      restrictionsApplied: restrictionsApplied(allEdges, request, graph),
      tollSummary: { tollEdgeCount: allEdges.filter((edge) => edge.toll).length, tollEdgeIds: allEdges.filter((edge) => edge.toll).map((edge) => edge.edgeId), avoided: request.avoidTolls },
      warnings: snapReport.summary.LOW ? ["LOW_CONFIDENCE_SNAP_OVERRIDE"] : [],
      providerProvenance: null,
    };
    route.routeHash = IntegrityHash.hashValue(routeIdentity(route));
    return route;
  }

  function matrixIdentity(matrix) {
    return {
      schemaVersion: matrix.schemaVersion,
      providerId: matrix.providerId,
      providerVersion: matrix.providerVersion,
      graphHash: matrix.graphHash,
      requestHash: matrix.requestHash,
      profile: matrix.profile,
      sourceIds: matrix.sourceIds,
      targetIds: matrix.targetIds,
      distances: matrix.distances,
      durations: matrix.durations,
      distanceUnit: matrix.distanceUnit,
      durationUnit: matrix.durationUnit,
      unreachablePairs: matrix.unreachablePairs,
      closureIds: matrix.closureIds,
      vehicleProfile: matrix.vehicleProfile,
      avoidTolls: matrix.avoidTolls,
      trafficMode: matrix.trafficMode,
      departureTimeApplied: matrix.departureTimeApplied,
    };
  }

  function matrix(graph, input, provider = {}) {
    const request = normalizeRequest(input); const requestIdentity = requestHash(request);
    const snapReport = snap(graph, request.points, request);
    if (snapReport.summary.FAILED) fail("SNAP_FAILED", "One or more matrix points could not be snapped.", snapReport);
    if (snapReport.summary.LOW && !request.allowLowConfidenceSnap) fail("LOW_CONFIDENCE_SNAP_BLOCKED", "Low-confidence snap requires explicit Demo override.", snapReport);
    const distances = []; const durations = []; const unreachablePairs = [];
    for (let row = 0; row < request.points.length; row += 1) {
      const distanceRow = []; const durationRow = [];
      for (let column = 0; column < request.points.length; column += 1) {
        const path = shortestPath(graph, snapReport.results[row].nodeId, snapReport.results[column].nodeId, request);
        if (path.status !== "PASS") {
          distanceRow.push(null); durationRow.push(null);
          unreachablePairs.push({ sourceId: request.points[row].pointId, targetId: request.points[column].pointId });
        } else {
          distanceRow.push(request.distanceUnit === "km" ? path.distanceMeters / 1000 : path.distanceMeters);
          durationRow.push(request.durationUnit === "minutes" ? path.durationSeconds / 60 : path.durationSeconds);
        }
      }
      distances.push(distanceRow); durations.push(durationRow);
    }
    const result = {
      schemaVersion: "stct-road-matrix-v1.6",
      providerId: text(provider.id || request.providerId),
      providerVersion: text(provider.version || "1.6.0"),
      graphHash: graph.graphHash,
      requestHash: requestIdentity,
      profile: request.profile,
      sourceIds: request.points.map((point) => point.pointId),
      targetIds: request.points.map((point) => point.pointId),
      distances,
      durations,
      distanceUnit: request.distanceUnit,
      durationUnit: request.durationUnit,
      unreachablePairs,
      closureIds: request.closures.map((closure) => closure.edgeId),
      vehicleProfile: request.vehicleProfile,
      avoidTolls: request.avoidTolls,
      trafficMode: "SYNTHETIC",
      departureTimeApplied: false,
      snapSummary: snapReport.summary,
      providerProvenance: null,
    };
    result.asymmetry = detectAsymmetry(result);
    result.metricity = detectMetricity(result);
    result.matrixHash = IntegrityHash.hashValue(matrixIdentity(result));
    return result;
  }

  function detectAsymmetry(value, tolerance = 1e-9) {
    const pairs = [];
    for (let row = 0; row < value.distances.length; row += 1) for (let column = row + 1; column < value.distances.length; column += 1) {
      const forward = value.distances[row][column]; const reverse = value.distances[column][row];
      if (forward === null || reverse === null ? forward !== reverse : Math.abs(forward - reverse) > tolerance) pairs.push({ sourceId: value.sourceIds[row], targetId: value.sourceIds[column], forward, reverse });
    }
    return { comparable: true, asymmetric: pairs.length > 0, pairs };
  }

  function detectMetricity(value, tolerance = 1e-9) {
    const violations = [];
    for (let a = 0; a < value.distances.length; a += 1) for (let b = 0; b < value.distances.length; b += 1) for (let c = 0; c < value.distances.length; c += 1) {
      const direct = value.distances[a][c]; const first = value.distances[a][b]; const second = value.distances[b][c];
      if (a === b || b === c || a === c || direct === null || first === null || second === null) continue;
      if (direct > first + second + tolerance) violations.push({ from: value.sourceIds[a], via: value.sourceIds[b], to: value.sourceIds[c], direct, viaDistance: first + second });
      if (violations.length >= 20) return { testable: true, nonMetric: true, violations };
    }
    return { testable: true, nonMetric: violations.length > 0, violations };
  }

  function sampleRouteConsistency(matrixResult, routeResults, tolerance = {}) {
    const distanceTolerance = number(tolerance.distance, matrixResult.distanceUnit === "km" ? 0.001 : 1);
    const durationTolerance = number(tolerance.duration, matrixResult.durationUnit === "minutes" ? 0.02 : 1);
    const samples = routeResults.map((route) => {
      const fromId = route.pointIds[0]; const toId = route.pointIds.at(-1); const row = matrixResult.sourceIds.indexOf(fromId); const column = matrixResult.targetIds.indexOf(toId);
      if (row < 0 || column < 0) return { fromId, toId, status: "UNSUPPORTED_COMPARISON" };
      const matrixDistance = matrixResult.distances[row][column]; const matrixDuration = matrixResult.durations[row][column];
      if (matrixDistance === null) return { fromId, toId, status: "INCONSISTENT", reason: "REACHABILITY_MISMATCH" };
      const distanceDelta = Math.abs(matrixDistance - route.totalDistance); const durationDelta = Math.abs(matrixDuration - route.totalDuration);
      const exact = distanceDelta <= Number.EPSILON && durationDelta <= Number.EPSILON;
      return { fromId, toId, status: exact ? "CONSISTENT" : distanceDelta <= distanceTolerance && durationDelta <= durationTolerance ? "WITHIN_TOLERANCE" : "INCONSISTENT", matrixDistance, routeDistance: route.totalDistance, matrixDuration, routeDuration: route.totalDuration, distanceDelta, durationDelta };
    });
    return { status: samples.some((sample) => sample.status === "INCONSISTENT") ? "INCONSISTENT" : samples.some((sample) => sample.status === "WITHIN_TOLERANCE") ? "WITHIN_TOLERANCE" : samples.every((sample) => sample.status === "UNSUPPORTED_COMPARISON") ? "UNSUPPORTED_COMPARISON" : "CONSISTENT", samples };
  }

  function zoneDiagnostic(graph, route) {
    const zoneIds = [...new Set(route.edgeIds.flatMap((edgeId) => graph.edges.find((edge) => edge.edgeId === edgeId)?.zoneIds || []))];
    return { crossesServiceZone: zoneIds.length > 1, zoneIds, boundaryCount: Math.max(0, zoneIds.length - 1), classification: "SYNTHETIC" };
  }

  function routeMorph(before, after, options = {}) {
    const reducedMotion = options.reducedMotion === true;
    return {
      mode: reducedMotion ? "STATIC_BEFORE_AFTER" : "SAME_OBJECT_ROUTE_MORPH",
      before: { routeHash: before.routeHash, geometry: clone(before.geometry), edgeIds: clone(before.edgeIds), label: text(options.beforeLabel || "Before") },
      after: { routeHash: after.routeHash, geometry: clone(after.geometry), edgeIds: clone(after.edgeIds), label: text(options.afterLabel || "After") },
      changedEdges: [...new Set([...before.edgeIds, ...after.edgeIds])].filter((edgeId) => before.edgeIds.includes(edgeId) !== after.edgeIds.includes(edgeId)),
      evidenceBearing: true,
    };
  }

  function verifyRoadAwareCandidate(matrixResult, routes, tolerance = {}) {
    const consistency = sampleRouteConsistency(matrixResult, routes, tolerance);
    return {
      status: consistency.status === "INCONSISTENT" ? "FAIL" : "PASS",
      roadAwareStatus: consistency.status === "INCONSISTENT" ? "ROAD_AWARE_INCONSISTENT" : "ROAD_AWARE_PASS",
      consistency,
      matrixHash: matrixResult.matrixHash,
      routeHashes: routes.map((route) => route.routeHash),
    };
  }

  function noWebGLTable(matrixResult, route) {
    return {
      mode: "NO_WEBGL_OPERATIONAL",
      boundary: "Map rendering unavailable - operations remain available",
      provider: { id: route.providerId, version: route.providerVersion, provenance: clone(route.providerProvenance) },
      profile: matrixResult.profile,
      matrixHash: matrixResult.matrixHash,
      routeHash: route.routeHash,
      rows: route.legs.map((leg, index) => ({ sequence: index + 1, fromPointId: leg.fromPointId, toPointId: leg.toPointId, distance: leg.distance, duration: leg.duration, toll: leg.toll, edgeIds: clone(leg.edgeIds), restrictions: clone(leg.restrictionNotes) })),
      unreachablePairs: clone(matrixResult.unreachablePairs),
    };
  }

  return {
    VERSION,
    SCHEMA_VERSION,
    validateGraph,
    normalizeVehicleProfile,
    normalizeRequest,
    requestHash,
    snapPoint,
    snap,
    shortestPath,
    buildRoute,
    matrix,
    matrixIdentity,
    routeIdentity,
    detectAsymmetry,
    detectMetricity,
    sampleRouteConsistency,
    zoneDiagnostic,
    routeMorph,
    verifyRoadAwareCandidate,
    noWebGLTable,
    haversineMeters,
  };
});
