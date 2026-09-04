(function (root, factory) {
  "use strict";
  const events = root?.STCTV15?.domainEvents || (typeof require === "function" ? require("./domain-events-v15.js") : null);
  const api = factory(events);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.matrixProviders = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (DomainEvents) {
  "use strict";

  if (!DomainEvents) throw new Error("Matrix Provider v1.5 requires Domain Events v1.5 stable identity utilities.");

  const VERSION = "stct-matrix-provider-v1.5";
  const DISTANCE_UNITS = Object.freeze(["km", "m"]);
  const DURATION_UNITS = Object.freeze(["minutes", "seconds"]);
  const PRIVACY_NOTICE = "Coordinates will be sent to configured routing provider.";
  const EXTERNAL_PROVIDER_IDS = Object.freeze(["OSRM_COMPATIBLE", "VALHALLA_COMPATIBLE"]);

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function text(value) { return String(value ?? "").trim(); }
  function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
  function compare(left, right) { return text(left).localeCompare(text(right), "en"); }
  function error(code, message, detail = {}) { const result = new Error(message); result.code = code; result.detail = clone(detail); return result; }
  function hashValue(value) { return DomainEvents.hashValue(value); }

  function coordinate(point) {
    const lon = Number(point?.lon ?? point?.lng ?? point?.longitude ?? point?.coordinate?.[0]);
    const lat = Number(point?.lat ?? point?.latitude ?? point?.coordinate?.[1]);
    return [lon, lat];
  }

  function pointId(point, index, prefix) { return text(point?.id || point?.pointId || point?.orderId || point?.code || `${prefix}-${index + 1}`); }

  function normalizePoints(points, prefix) {
    if (!Array.isArray(points) || !points.length) throw error("MATRIX_POINTS_REQUIRED", `${prefix} points are required.`);
    const ids = new Set();
    return points.map((point, index) => {
      const id = pointId(point, index, prefix);
      const [lon, lat] = coordinate(point);
      if (!id) throw error("MATRIX_POINT_ID_REQUIRED", `${prefix} point ${index} has no id.`);
      if (ids.has(id)) throw error("MATRIX_POINT_ID_DUPLICATE", `Duplicate ${prefix} point id: ${id}`);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) throw error("MATRIX_POINT_COORDINATE_INVALID", `Invalid coordinate for ${id}.`);
      ids.add(id);
      return { id, lon, lat };
    });
  }

  function normalizeRequest(request = {}) {
    const sourceInput = request.sources || request.points;
    const targetInput = request.targets || request.points;
    const profile = text(request.profile);
    const distanceUnit = text(request.distanceUnit || request.units?.distance);
    const durationUnit = text(request.durationUnit || request.units?.duration);
    if (!profile) throw error("MATRIX_PROFILE_REQUIRED", "Matrix request profile is required.");
    if (!distanceUnit || !durationUnit) throw error("MATRIX_UNITS_REQUIRED", "Matrix request distance and duration units are required.");
    if (!DISTANCE_UNITS.includes(distanceUnit) || !DURATION_UNITS.includes(durationUnit)) throw error("MATRIX_UNITS_UNSUPPORTED", `Unsupported matrix units: ${distanceUnit}/${durationUnit}`);
    return {
      sources: normalizePoints(sourceInput, "SOURCE"),
      targets: normalizePoints(targetInput, "TARGET"),
      profile,
      distanceUnit,
      durationUnit,
      departureTime: request.departureTime || null,
      requestId: text(request.requestId),
    };
  }

  function validateRequest(request) {
    try { const normalized = normalizeRequest(request); return { status: "PASS", normalized, errors: [] }; }
    catch (caught) { return { status: "FAIL", normalized: null, errors: [{ code: text(caught.code || "MATRIX_REQUEST_INVALID"), message: text(caught.message), detail: clone(caught.detail || {}) }] }; }
  }

  function haversineKm(left, right) {
    const radius = 6371.0088;
    const rad = (value) => Number(value) * Math.PI / 180;
    const dLat = rad(right.lat - left.lat);
    const dLon = rad(right.lon - left.lon);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(left.lat)) * Math.cos(rad(right.lat)) * Math.sin(dLon / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function distanceFromKm(value, unit) { return unit === "m" ? value * 1000 : value; }
  function durationFromMinutes(value, unit) { return unit === "seconds" ? value * 60 : value; }

  function identityEnvelope(matrix) {
    return {
      schemaVersion: "stct-routing-matrix-v1.5",
      providerId: text(matrix.providerId || matrix.provider?.id),
      providerVersion: text(matrix.providerVersion || matrix.provider?.version),
      profile: text(matrix.profile),
      sourceIds: clone(matrix.sourceIds || []),
      targetIds: clone(matrix.targetIds || []),
      distances: clone(matrix.distances || []),
      durations: clone(matrix.durations || []),
      distanceUnit: text(matrix.distanceUnit || matrix.units?.distance),
      durationUnit: text(matrix.durationUnit || matrix.units?.duration),
      trafficMode: text(matrix.trafficMode),
      roadRestrictions: text(matrix.roadRestrictions),
      departureTimeApplied: matrix.departureTimeApplied === true,
      factor: matrix.factor === undefined ? null : Number(matrix.factor),
      averageSpeedKph: matrix.averageSpeedKph === undefined ? null : Number(matrix.averageSpeedKph),
      unreachablePairs: clone(matrix.unreachablePairs || []),
    };
  }

  function computedMatrixHash(matrix) { return hashValue(identityEnvelope(matrix)); }

  function finiteOrUnreachable(value, row, column, kind, policy, unreachablePairs) {
    if (Number.isNaN(Number(value))) throw error("MATRIX_VALUE_NAN", `${kind}[${row}][${column}] is NaN.`);
    if (value === Infinity || Number(value) === Infinity || value === null) {
      if (policy !== "ALLOW_INFINITY") throw error("MATRIX_VALUE_INFINITY", `${kind}[${row}][${column}] is unreachable but policy rejects it.`);
      unreachablePairs.add(`${row}:${column}`);
      return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw error("MATRIX_VALUE_NON_FINITE", `${kind}[${row}][${column}] is not finite.`);
    if (parsed < 0) throw error("MATRIX_VALUE_NEGATIVE", `${kind}[${row}][${column}] is negative.`);
    return parsed;
  }

  function validateDimensions(rows, rowCount, columnCount, kind) {
    if (!Array.isArray(rows) || rows.length !== rowCount || rows.some((row) => !Array.isArray(row) || row.length !== columnCount)) {
      throw error("MATRIX_DIMENSION_MISMATCH", `${kind} must be ${rowCount} x ${columnCount}.`, { rowCount, columnCount });
    }
  }

  function detectAsymmetry(matrix, tolerance = 1e-9) {
    if (matrix.sourceIds.length !== matrix.targetIds.length || matrix.sourceIds.some((id, index) => id !== matrix.targetIds[index])) return { comparable: false, asymmetric: null, pairs: [] };
    const pairs = [];
    for (let row = 0; row < matrix.distances.length; row += 1) {
      for (let column = row + 1; column < matrix.distances.length; column += 1) {
        const a = matrix.distances[row][column]; const b = matrix.distances[column][row];
        if (a === null || b === null ? a !== b : Math.abs(a - b) > tolerance) pairs.push({ sourceId: matrix.sourceIds[row], targetId: matrix.targetIds[column], forward: a, reverse: b });
      }
    }
    return { comparable: true, asymmetric: pairs.length > 0, pairs };
  }

  function detectNonMetric(matrix, tolerance = 1e-9) {
    if (matrix.sourceIds.length !== matrix.targetIds.length || matrix.sourceIds.some((id, index) => id !== matrix.targetIds[index])) return { testable: false, nonMetric: null, violations: [] };
    const values = matrix.distances; const violations = [];
    for (let a = 0; a < values.length; a += 1) {
      for (let b = 0; b < values.length; b += 1) {
        for (let c = 0; c < values.length; c += 1) {
          if (a === b || b === c || a === c || values[a][c] === null || values[a][b] === null || values[b][c] === null) continue;
          if (values[a][c] > values[a][b] + values[b][c] + tolerance) violations.push({ from: matrix.sourceIds[a], via: matrix.sourceIds[b], to: matrix.sourceIds[c] });
          if (violations.length >= 20) return { testable: true, nonMetric: true, violations };
        }
      }
    }
    return { testable: true, nonMetric: violations.length > 0, violations };
  }

  function validateMatrix(input, options = {}) {
    try {
      const matrix = clone(input || {});
      const sourceIds = (matrix.sourceIds || []).map(text);
      const targetIds = (matrix.targetIds || []).map(text);
      if (!sourceIds.length || !targetIds.length || sourceIds.some((id) => !id) || targetIds.some((id) => !id)) throw error("MATRIX_POINT_IDS_REQUIRED", "Matrix sourceIds and targetIds are required.");
      if (new Set(sourceIds).size !== sourceIds.length || new Set(targetIds).size !== targetIds.length) throw error("MATRIX_POINT_ID_DUPLICATE", "Matrix sourceIds and targetIds must be unique.");
      if (!text(matrix.profile)) throw error("MATRIX_PROFILE_REQUIRED", "Matrix profile is required.");
      if (!text(matrix.providerId || matrix.provider?.id) || !text(matrix.providerVersion || matrix.provider?.version)) throw error("MATRIX_PROVIDER_VERSION_REQUIRED", "Matrix provider id and version are required.");
      const distanceUnit = text(matrix.distanceUnit || matrix.units?.distance);
      const durationUnit = text(matrix.durationUnit || matrix.units?.duration);
      if (!distanceUnit || !durationUnit) throw error("MATRIX_UNITS_REQUIRED", "Matrix units are required.");
      if (!DISTANCE_UNITS.includes(distanceUnit) || !DURATION_UNITS.includes(durationUnit)) throw error("MATRIX_UNITS_UNSUPPORTED", `Unsupported matrix units: ${distanceUnit}/${durationUnit}`);
      validateDimensions(matrix.distances, sourceIds.length, targetIds.length, "distances");
      validateDimensions(matrix.durations, sourceIds.length, targetIds.length, "durations");
      const unreachablePairs = new Set(); const policy = options.unreachablePolicy || matrix.unreachablePolicy || "ALLOW_INFINITY";
      matrix.distances = matrix.distances.map((row, rowIndex) => row.map((value, columnIndex) => finiteOrUnreachable(value, rowIndex, columnIndex, "distances", policy, unreachablePairs)));
      matrix.durations = matrix.durations.map((row, rowIndex) => row.map((value, columnIndex) => finiteOrUnreachable(value, rowIndex, columnIndex, "durations", policy, unreachablePairs)));
      const warnings = [];
      if (sourceIds.length === targetIds.length && sourceIds.every((id, index) => id === targetIds[index])) {
        sourceIds.forEach((id, index) => {
          if (matrix.distances[index][index] !== 0 || matrix.durations[index][index] !== 0) {
            if ((options.diagonalPolicy || "WARN") === "REJECT") throw error("MATRIX_DIAGONAL_NONZERO", `Diagonal value is nonzero for ${id}.`);
            warnings.push({ code: "MATRIX_DIAGONAL_NONZERO", pointId: id });
          }
        });
      }
      matrix.providerId = text(matrix.providerId || matrix.provider?.id);
      matrix.providerVersion = text(matrix.providerVersion || matrix.provider?.version);
      matrix.sourceIds = sourceIds; matrix.targetIds = targetIds; matrix.distanceUnit = distanceUnit; matrix.durationUnit = durationUnit;
      matrix.trafficMode = text(matrix.trafficMode || "UNKNOWN"); matrix.roadRestrictions = text(matrix.roadRestrictions || "UNKNOWN"); matrix.departureTimeApplied = matrix.departureTimeApplied === true;
      matrix.unreachablePairs = [...unreachablePairs].map((key) => { const [row, column] = key.split(":").map(Number); return { sourceId: sourceIds[row], targetId: targetIds[column] }; }).sort((a, b) => compare(`${a.sourceId}:${a.targetId}`, `${b.sourceId}:${b.targetId}`));
      const asymmetry = detectAsymmetry(matrix, number(options.asymmetryTolerance, 1e-9));
      const metricity = detectNonMetric(matrix, number(options.metricTolerance, 1e-9));
      if (metricity.nonMetric) warnings.push({ code: "MATRIX_NON_METRIC_DISCLOSED", violationCount: metricity.violations.length });
      const expectedHash = computedMatrixHash(matrix);
      if (text(input.matrixHash) && text(input.matrixHash) !== expectedHash) throw error("MATRIX_HASH_STALE", "Matrix hash does not match matrix content.", { expectedHash, actualHash: input.matrixHash });
      matrix.matrixHash = expectedHash;
      return { status: "PASS", matrix, warnings, asymmetry, metricity, unreachablePairs: clone(matrix.unreachablePairs) };
    } catch (caught) {
      return { status: "FAIL", matrix: null, warnings: [], error: { code: text(caught.code || "MATRIX_INVALID"), message: text(caught.message), detail: clone(caught.detail || {}) } };
    }
  }

  function assertValidMatrix(matrix, options = {}) {
    const result = validateMatrix(matrix, options);
    if (result.status !== "PASS") throw error(result.error.code, result.error.message, result.error.detail);
    return result;
  }

  function provenance(matrix, additions = {}) {
    const validation = assertValidMatrix(matrix, { unreachablePolicy: "ALLOW_INFINITY" });
    const value = validation.matrix;
    return {
      providerId: value.providerId,
      providerVersion: value.providerVersion,
      profile: value.profile,
      matrixHash: value.matrixHash,
      pointCount: new Set([...value.sourceIds, ...value.targetIds]).size,
      sourceCount: value.sourceIds.length,
      targetCount: value.targetIds.length,
      distanceUnit: value.distanceUnit,
      durationUnit: value.durationUnit,
      trafficMode: value.trafficMode,
      departureTimeApplied: value.departureTimeApplied,
      generatedAt: text(value.generatedAt),
      generatedAtExcludedFromIdentity: true,
      cacheHit: additions.cacheHit === true || value.cacheHit === true,
      cacheHitExcludedFromIdentity: true,
      snapSummary: clone(additions.snapSummary || value.snapSummary || { supported: false, snapped: 0 }),
      unreachablePairs: clone(value.unreachablePairs),
      asymmetry: clone(validation.asymmetry),
      metricity: clone(validation.metricity),
      roadRestrictions: value.roadRestrictions,
      factor: value.factor ?? null,
      averageSpeedKph: value.averageSpeedKph ?? null,
      buildTimeMs: number(additions.buildTimeMs ?? value.buildTimeMs),
    };
  }

  function buildMatrixResult(fields, options = {}) {
    const validation = assertValidMatrix(fields, options);
    const matrix = { ...validation.matrix, generatedAt: text(fields.generatedAt || new Date().toISOString()), generatedAtExcludedFromIdentity: true, cacheHit: fields.cacheHit === true };
    matrix.provenance = provenance(matrix, { cacheHit: matrix.cacheHit, buildTimeMs: fields.buildTimeMs, snapSummary: fields.snapSummary });
    return matrix;
  }

  function createHaversineProvider(options = {}) {
    const factor = number(options.roadDistanceFactor, 1.35);
    const averageSpeedKph = number(options.averageSpeedKph, 32);
    if (factor <= 0 || averageSpeedKph <= 0) throw error("HAVERSINE_PROVIDER_CONFIG_INVALID", "Road factor and average speed must be positive.");
    const id = "HAVERSINE_FALLBACK"; const version = text(options.version || "1.5.0");
    const cache = new Map();
    return {
      id, version, availability: "AVAILABLE", networkCalls: 0,
      capabilities: () => ({ matrix: true, route: true, snap: false, match: false, traffic: false, roadRestrictions: false, approximation: true }),
      validateRequest,
      async matrix(request) {
        const normalized = normalizeRequest(request); const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
        const requestKey = hashValue({ normalized, factor, averageSpeedKph });
        if (cache.has(requestKey)) { const cached = clone(cache.get(requestKey)); cached.cacheHit = true; cached.provenance = provenance(cached, { cacheHit: true, buildTimeMs: 0 }); return cached; }
        const distances = normalized.sources.map((source) => normalized.targets.map((target) => distanceFromKm(haversineKm(source, target) * factor, normalized.distanceUnit)));
        const durations = normalized.sources.map((source, row) => normalized.targets.map((target, column) => durationFromMinutes((normalized.distanceUnit === "m" ? distances[row][column] / 1000 : distances[row][column]) / averageSpeedKph * 60, normalized.durationUnit)));
        normalized.sources.forEach((source, row) => normalized.targets.forEach((target, column) => { if (source.id === target.id && source.lon === target.lon && source.lat === target.lat) { distances[row][column] = 0; durations[row][column] = 0; } }));
        const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
        const result = buildMatrixResult({
          schemaVersion: "stct-routing-matrix-v1.5", providerId: id, providerVersion: version, profile: normalized.profile,
          sourceIds: normalized.sources.map((point) => point.id), targetIds: normalized.targets.map((point) => point.id), distances, durations,
          distanceUnit: normalized.distanceUnit, durationUnit: normalized.durationUnit, factor, averageSpeedKph,
          trafficMode: "NONE", roadRestrictions: "NONE", departureTimeApplied: false, generatedAt: options.clock?.() || new Date().toISOString(),
          cacheHit: false, buildTimeMs: Math.max(0, endedAt - startedAt), unreachablePairs: [], snapSummary: { supported: false, snapped: 0 },
        });
        cache.set(requestKey, clone(result)); return result;
      },
      async route(request) {
        const normalized = normalizeRequest({ ...request, sources: [request.source], targets: [request.target] });
        const matrix = await this.matrix(normalized);
        return { providerId: id, providerVersion: version, profile: normalized.profile, distance: matrix.distances[0][0], duration: matrix.durations[0][0], distanceUnit: matrix.distanceUnit, durationUnit: matrix.durationUnit, geometry: [[normalized.sources[0].lon, normalized.sources[0].lat], [normalized.targets[0].lon, normalized.targets[0].lat]], estimated: true, matrixHash: matrix.matrixHash };
      },
      snap: (points) => ({ status: "UNSUPPORTED", providerId: id, points: clone(points || []), sentExternally: false }),
      match: () => ({ status: "UNSUPPORTED", providerId: id, sentExternally: false }),
      provenance: (matrix) => provenance(matrix),
      clearCache: () => cache.clear(),
    };
  }

  function createFixtureProvider(fixture = {}, options = {}) {
    const id = "FIXTURE_MATRIX"; const version = text(options.version || fixture.providerVersion || "1.5.0-fixture");
    const profiles = fixture.profiles || { [fixture.profile || "car"]: fixture };
    return {
      id, version, availability: "AVAILABLE", networkCalls: 0,
      capabilities: () => ({ matrix: true, route: true, snap: true, match: true, traffic: false, roadRestrictions: true, deterministicFixture: true }),
      validateRequest,
      async matrix(request) {
        const normalized = normalizeRequest(request); const profileFixture = profiles[normalized.profile];
        if (!profileFixture) throw error("FIXTURE_PROFILE_NOT_FOUND", `Fixture has no profile: ${normalized.profile}`);
        const sourceIds = normalized.sources.map((point) => point.id); const targetIds = normalized.targets.map((point) => point.id);
        const fixtureSourceIds = (profileFixture.sourceIds || fixture.sourceIds || []).map(text); const fixtureTargetIds = (profileFixture.targetIds || fixture.targetIds || []).map(text);
        const sourceIndexes = sourceIds.map((idValue) => fixtureSourceIds.indexOf(idValue)); const targetIndexes = targetIds.map((idValue) => fixtureTargetIds.indexOf(idValue));
        if (sourceIndexes.some((index) => index < 0) || targetIndexes.some((index) => index < 0)) throw error("FIXTURE_POINT_ID_NOT_FOUND", "Fixture source/target IDs do not match request.", { sourceIds, targetIds });
        const pick = (rows) => sourceIndexes.map((row) => targetIndexes.map((column) => rows[row][column]));
        return buildMatrixResult({
          schemaVersion: "stct-routing-matrix-v1.5", providerId: id, providerVersion: version, profile: normalized.profile,
          sourceIds, targetIds, distances: pick(profileFixture.distances), durations: pick(profileFixture.durations),
          distanceUnit: normalized.distanceUnit, durationUnit: normalized.durationUnit, trafficMode: text(profileFixture.trafficMode || "FIXTURE"),
          roadRestrictions: text(profileFixture.roadRestrictions || "FIXTURE_ONLY"), departureTimeApplied: profileFixture.departureTimeApplied === true,
          generatedAt: options.clock?.() || "FIXTURE_GENERATED_AT_EXCLUDED", cacheHit: false,
        }, { unreachablePolicy: profileFixture.unreachablePolicy || "ALLOW_INFINITY", diagonalPolicy: profileFixture.diagonalPolicy || "WARN" });
      },
      async route(request) {
        const normalized = normalizeRequest({ ...request, sources: [request.source], targets: [request.target] });
        const matrix = await this.matrix(normalized); const key = `${normalized.profile}:${normalized.sources[0].id}:${normalized.targets[0].id}`;
        const routeFixture = fixture.routes?.[key] || null;
        return { providerId: id, providerVersion: version, profile: normalized.profile, distance: routeFixture?.distance ?? matrix.distances[0][0], duration: routeFixture?.duration ?? matrix.durations[0][0], distanceUnit: matrix.distanceUnit, durationUnit: matrix.durationUnit, geometry: clone(routeFixture?.geometry || [[normalized.sources[0].lon, normalized.sources[0].lat], [normalized.targets[0].lon, normalized.targets[0].lat]]), fixture: true, matrixHash: matrix.matrixHash };
      },
      snap: (points) => ({ status: "PASS", providerId: id, points: clone(points || []), fixture: true, sentExternally: false }),
      match: (trace) => ({ status: "PASS", providerId: id, trace: clone(trace || []), fixture: true, sentExternally: false }),
      provenance: (matrix) => provenance(matrix),
    };
  }

  function createExternalProvider(providerId, options = {}) {
    const id = text(providerId).toUpperCase();
    if (!EXTERNAL_PROVIDER_IDS.includes(id)) throw error("EXTERNAL_PROVIDER_UNKNOWN", `Unknown external provider: ${id}`);
    const version = text(options.version || "1.5.0-adapter"); let networkCalls = 0;
    const enabled = options.enabled === true; const endpoint = text(options.endpoint);
    async function call(kind, request) {
      if (!enabled) throw error("EXTERNAL_PROVIDER_DISABLED", `${id} is disabled by default.`, { privacyNotice: PRIVACY_NOTICE, networkCalls });
      if (!endpoint) throw error("EXTERNAL_PROVIDER_ENDPOINT_REQUIRED", `${id} endpoint is not configured.`, { privacyNotice: PRIVACY_NOTICE, networkCalls });
      if (options.coordinateDisclosureAccepted !== true) throw error("COORDINATE_DISCLOSURE_REQUIRED", PRIVACY_NOTICE, { privacyNotice: PRIVACY_NOTICE, networkCalls });
      if (typeof options.fetch !== "function") throw error("EXTERNAL_PROVIDER_FETCH_NOT_CONFIGURED", `${id} fetch adapter is not configured.`, { networkCalls });
      networkCalls += 1;
      return options.fetch({ kind, endpoint, request: clone(request), providerId: id });
    }
    return {
      id, version, get availability() { return enabled && endpoint ? "CONFIGURED" : "DISABLED"; }, get networkCalls() { return networkCalls; }, privacyNotice: PRIVACY_NOTICE,
      capabilities: () => ({ matrix: true, route: true, snap: true, match: true, traffic: id === "VALHALLA_COMPATIBLE", roadRestrictions: true, externalCoordinates: true }),
      validateRequest,
      matrix: (request) => call("matrix", request), route: (request) => call("route", request), snap: (request) => call("snap", request), match: (request) => call("match", request),
      provenance: (matrix) => provenance(matrix),
    };
  }

  function sampleRouteConsistency(matrix, route, options = {}) {
    const validation = assertValidMatrix(matrix, { unreachablePolicy: "ALLOW_INFINITY" });
    const sourceIndex = validation.matrix.sourceIds.indexOf(text(options.sourceId || route.sourceId));
    const targetIndex = validation.matrix.targetIds.indexOf(text(options.targetId || route.targetId));
    if (sourceIndex < 0 || targetIndex < 0) throw error("ROUTE_MATRIX_POINT_NOT_FOUND", "Route sample source/target is absent from matrix.");
    const matrixDistance = validation.matrix.distances[sourceIndex][targetIndex]; const routeDistance = Number(route.distance);
    if (matrixDistance === null || !Number.isFinite(routeDistance)) return { status: "UNKNOWN", withinTolerance: false, reason: "UNREACHABLE_OR_MISSING_ROUTE_DISTANCE" };
    const absoluteDelta = Math.abs(routeDistance - matrixDistance); const tolerance = number(options.tolerance, Math.max(0.01, matrixDistance * .05));
    return { status: absoluteDelta <= tolerance ? "PASS" : "MISMATCH", withinTolerance: absoluteDelta <= tolerance, matrixDistance, routeDistance, absoluteDelta, tolerance };
  }

  function attachToSolverRequest(request, matrix) {
    const value = assertValidMatrix(matrix, { unreachablePolicy: "ALLOW_INFINITY" }).matrix;
    return { ...clone(request || {}), matrixProvider: { id: value.providerId, version: value.providerVersion, profile: value.profile, matrixHash: value.matrixHash, trafficMode: value.trafficMode, departureTimeApplied: value.departureTimeApplied } };
  }

  async function createMatrixContext(provider, scenario = {}, options = {}) {
    if (!provider || typeof provider.matrix !== "function") throw error("MATRIX_CONTEXT_PROVIDER_REQUIRED", "MatrixContext requires a provider with matrix().");
    const depotId = text(scenario.depot?.id || "DEPOT");
    const points = [
      { ...clone(scenario.depot || {}), id: depotId },
      ...(scenario.orders || []).map((order, index) => ({ ...clone(order), id: text(order.id || order.orderId || order.code || `ORDER-${index + 1}`) })),
    ];
    if (new Set(points.map((point) => point.id)).size !== points.length) throw error("MATRIX_CONTEXT_POINT_ID_DUPLICATE", "MatrixContext depot and order ids must be unique.");
    const matrix = await provider.matrix({
      points,
      profile: text(options.profile || "car"),
      distanceUnit: "km",
      durationUnit: "minutes",
      departureTime: options.departureTime || null,
      requestId: text(options.requestId),
    });
    const validation = assertValidMatrix(matrix, { unreachablePolicy: options.unreachablePolicy || "ALLOW_INFINITY" });
    const value = validation.matrix;
    const sourceIndex = new Map(value.sourceIds.map((id, index) => [id, index]));
    const targetIndex = new Map(value.targetIds.map((id, index) => [id, index]));
    const actualProvenance = provider.provenance ? provider.provenance(value) : provenance(value);
    function leg(fromId, toId) {
      const row = sourceIndex.get(text(fromId)); const column = targetIndex.get(text(toId));
      if (row === undefined || column === undefined) throw error("MATRIX_CONTEXT_POINT_NOT_FOUND", `MatrixContext has no leg ${fromId} -> ${toId}.`, { fromId, toId });
      const distanceKm = value.distanceUnit === "m" ? value.distances[row][column] / 1000 : value.distances[row][column];
      const durationMinutes = value.durationUnit === "seconds" ? value.durations[row][column] / 60 : value.durations[row][column];
      if (!Number.isFinite(distanceKm) || !Number.isFinite(durationMinutes)) throw error("MATRIX_CONTEXT_LEG_UNREACHABLE", `MatrixContext leg is unreachable: ${fromId} -> ${toId}.`, { fromId, toId });
      return { fromId: text(fromId), toId: text(toId), distanceKm, durationMinutes };
    }
    return {
      version: "stct-matrix-context-v1.5.1",
      providerId: value.providerId,
      providerVersion: value.providerVersion,
      depotId,
      pointIds: value.sourceIds.slice(),
      matrixHash: value.matrixHash,
      provenance: clone(actualProvenance),
      matrix: clone(value),
      leg,
    };
  }

  function createProviderRegistry(options = {}) {
    const providers = new Map();
    const register = (provider) => { if (!provider?.id || typeof provider.matrix !== "function") throw error("MATRIX_PROVIDER_INVALID", "Provider requires id and matrix()."); providers.set(provider.id, provider); return provider; };
    register(createHaversineProvider(options.haversine || {}));
    if (options.fixture) register(createFixtureProvider(options.fixture, options.fixtureOptions));
    register(createExternalProvider("OSRM_COMPATIBLE", options.osrm || {}));
    register(createExternalProvider("VALHALLA_COMPATIBLE", options.valhalla || {}));
    return { register, get: (id) => providers.get(text(id).toUpperCase()) || null, list: () => [...providers.values()].map((provider) => ({ id: provider.id, version: provider.version, availability: provider.availability, capabilities: provider.capabilities(), privacyNotice: provider.privacyNotice || null })) };
  }

  return {
    VERSION,
    PRIVACY_NOTICE,
    DISTANCE_UNITS,
    DURATION_UNITS,
    normalizeRequest,
    validateRequest,
    validateMatrix,
    assertValidMatrix,
    computedMatrixHash,
    provenance,
    detectAsymmetry,
    detectNonMetric,
    sampleRouteConsistency,
    attachToSolverRequest,
    createMatrixContext,
    createHaversineProvider,
    createFixtureProvider,
    createExternalProvider,
    createProviderRegistry,
    hashValue,
  };
});
