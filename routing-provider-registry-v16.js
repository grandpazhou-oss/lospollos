(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const fixture = root?.STCTV16?.roadFixture || (typeof require === "function" ? require("./road-network-fixture-v16.js") : null);
  const routing = root?.STCTV16?.roadRouting || (typeof require === "function" ? require("./road-routing-v16.js") : null);
  const provenance = root?.STCTV16?.routingProvenance || (typeof require === "function" ? require("./routing-provenance-v16.js") : null);
  const api = factory(integrity, fixture, routing, provenance);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV16 = root.STCTV16 || { version: "1.6.0" };
    root.STCTV16.routingProviders = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash, RoadFixture, RoadRouting, RoutingProvenance) {
  "use strict";

  if (!IntegrityHash?.hashValue || !RoadFixture || !RoadRouting || !RoutingProvenance) throw new Error("Routing Provider Registry v1.6 dependencies are missing.");
  const VERSION = "stct-routing-provider-registry-v1.6";
  const AVAILABILITY = Object.freeze(["READY", "DISABLED_BY_CONFIGURATION", "UNAVAILABLE_DEPENDENCY", "DEGRADED", "ERROR"]);
  const MODES = Object.freeze(["ESTIMATED", "ROAD_FIXTURE", "LOCAL_EXTERNAL"]);
  const CAPABILITY_KEYS = Object.freeze(["snap", "matrix", "route", "match", "oneWay", "turnRestrictions", "truckDimensions", "weightRestrictions", "hazmat", "tolls", "closures", "departureTime", "traffic", "sideOfStreet", "alternativeRoutes"]);
  const COPY = Object.freeze({
    zh: { READY: "可用", DISABLED_BY_CONFIGURATION: "未配置", UNAVAILABLE_DEPENDENCY: "依赖不可用", DEGRADED: "降级", ERROR: "错误", privacy: "默认不向外部发送坐标" },
    en: { READY: "Ready", DISABLED_BY_CONFIGURATION: "Disabled by configuration", UNAVAILABLE_DEPENDENCY: "Dependency unavailable", DEGRADED: "Degraded", ERROR: "Error", privacy: "No external coordinate transmission by default" },
    ja: { READY: "利用可能", DISABLED_BY_CONFIGURATION: "設定により無効", UNAVAILABLE_DEPENDENCY: "依存関係を利用不可", DEGRADED: "縮退", ERROR: "エラー", privacy: "既定では座標を外部送信しません" },
  });
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
  function fail(code, message, detail = {}) { const error = new Error(message); error.code = code; error.detail = clone(detail); throw error; }

  function normalizeCapabilities(input = {}) {
    return Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, input[key] === true]));
  }

  function validateSpec(spec) {
    if (!text(spec?.id)) fail("PROVIDER_ID_REQUIRED", "Provider id is required.");
    if (!text(spec?.version)) fail("PROVIDER_VERSION_REQUIRED", "Provider version is required.");
    if (!MODES.includes(text(spec?.mode))) fail("PROVIDER_MODE_INVALID", `Invalid provider mode: ${spec?.mode}`);
    if (!AVAILABILITY.includes(text(spec?.availability))) fail("PROVIDER_AVAILABILITY_INVALID", `Invalid provider availability: ${spec?.availability}`);
  }

  function requestedCapabilities(input, request, action) {
    const required = [action];
    if ((request.closures || []).length) required.push("closures");
    if (request.avoidTolls) required.push("tolls");
    if (request.departureLogicalTime !== null && request.departureLogicalTime !== undefined) required.push("departureTime");
    const vehicle = input?.vehicleProfile || {};
    if (vehicle.heightM !== undefined || vehicle.widthM !== undefined || vehicle.lengthM !== undefined) required.push("truckDimensions");
    if (vehicle.grossWeightKg !== undefined || vehicle.axleWeightKg !== undefined) required.push("weightRestrictions");
    if (vehicle.hazmat === true) required.push("hazmat");
    return [...new Set(required)];
  }

  function createProvider(specification) {
    validateSpec(specification);
    const spec = { ...specification, id: text(specification.id).toUpperCase(), version: text(specification.version), mode: text(specification.mode), availability: text(specification.availability) };
    const capabilities = normalizeCapabilities(spec.capabilities);
    let availability = spec.availability; let requestCount = 0; let pointCount = 0; let generation = 0; let active = null;
    const requestLog = [];

    function assertReady() {
      if (availability !== "READY" && !(spec.mode === "ESTIMATED" && availability === "DEGRADED")) fail(availability, `${spec.id} is not ready.`, { availability });
    }
    function validateRequest(input, action = "route") {
      const normalized = RoadRouting.normalizeRequest(input, { maxPoints: spec.maxPoints || 256 });
      if (normalized.providerId !== spec.id) fail("PROVIDER_REQUEST_MISMATCH", `Request targets ${normalized.providerId}, not ${spec.id}.`);
      const unsupported = requestedCapabilities(input, normalized, action).filter((key) => !capabilities[key]);
      if (unsupported.length) fail("UNSUPPORTED_CAPABILITY", `${spec.id} does not support ${unsupported.join(", ")}.`, { unsupported });
      return normalized;
    }
    function record(request, action, startedAt) {
      requestCount += 1; pointCount += request.points.length;
      const row = RoutingProvenance.redact({ providerId: spec.id, providerVersion: spec.version, mode: spec.mode, action, profile: request.profile, privacyMode: spec.privacyMode || "NO_EXTERNAL_COORDINATE_TRANSMISSION", endpointCategory: spec.endpointCategory || "NONE", pointCount: request.points.length, requestCount, timestamp: new Date().toISOString(), durationMs: Math.max(0, now() - startedAt) });
      requestLog.push(row); return row;
    }
    async function invoke(action, input) {
      assertReady();
      if (typeof spec[action] !== "function" || !capabilities[action]) fail("UNSUPPORTED_CAPABILITY", `${spec.id} does not support ${action}.`, { unsupported: [action] });
      const request = validateRequest(input, action); const startedAt = now(); const token = { generation: ++generation, cancelled: false }; active = token;
      const result = await spec[action](clone(request), { isCancelled: () => token.cancelled, generation: token.generation });
      if (token.cancelled) fail("PROVIDER_REQUEST_CANCELLED", `${spec.id} request was cancelled.`);
      if (token.generation !== generation) fail("PROVIDER_STALE_RESPONSE", `${spec.id} returned a stale response.`);
      record(request, action, startedAt);
      const context = { profile: request.profile, requestHash: RoadRouting.requestHash(request), matrixHash: result.matrixHash, routeHash: result.routeHash, graphHash: result.graphHash, trafficMode: result.trafficMode || (spec.mode === "ROAD_FIXTURE" ? "SYNTHETIC" : "NONE"), departureTimeApplied: result.departureTimeApplied === true, privacyMode: spec.privacyMode, endpointCategory: spec.endpointCategory, pointCount: request.points.length, requestCount, dataClassification: spec.mode === "LOCAL_EXTERNAL" ? "CONFIGURED_LOCAL_PROVIDER" : "SYNTHETIC" };
      const owned = RoutingProvenance.create(provider, context);
      result.providerId = spec.id; result.providerVersion = spec.version; result.providerProvenance = owned;
      return result;
    }
    function cancel() { generation += 1; if (active) active.cancelled = true; spec.cancel?.(); return { status: "CANCELLED", providerId: spec.id, generation }; }
    function health() { return { schemaVersion: "stct-routing-provider-health-v1.6", providerId: spec.id, providerVersion: spec.version, availability, mode: spec.mode, checkedAt: new Date().toISOString(), requestCount, pointCount, message: text(spec.healthMessage || availability) }; }
    const provider = {
      id: spec.id,
      version: spec.version,
      mode: spec.mode,
      get availability() { return availability; },
      capabilities: () => clone(capabilities),
      validateRequest: (request, action = "route") => { try { return { status: "PASS", normalized: validateRequest(request, action), errors: [] }; } catch (error) { return { status: "FAIL", normalized: null, errors: [{ code: text(error.code || "PROVIDER_REQUEST_INVALID"), message: error.message, detail: clone(error.detail || {}) }] }; } },
      snap: (request) => invoke("snap", request),
      matrix: (request) => invoke("matrix", request),
      route: (request) => invoke("route", request),
      match: (request) => invoke("match", request),
      health,
      provenance: (context = {}) => RoutingProvenance.create(provider, { ...RoutingProvenance.redact(context), requestCount, pointCount, privacyMode: spec.privacyMode, endpointCategory: spec.endpointCategory }),
      cancel,
      setAvailability(value) { if (!AVAILABILITY.includes(value)) fail("PROVIDER_AVAILABILITY_INVALID", `Invalid availability: ${value}`); availability = value; return health(); },
      requestLog: () => clone(requestLog),
    };
    return provider;
  }

  function estimatedProvider(options = {}) {
    const factor = Number(options.factor || 1.35); const speedKph = Number(options.speedKph || 28);
    const distance = (a, b) => RoadRouting.haversineMeters([a.lon, a.lat], [b.lon, b.lat]) * factor;
    return createProvider({
      id: "ESTIMATED_HAVERSINE_FALLBACK", version: text(options.version || "1.6.0"), mode: "ESTIMATED", availability: "DEGRADED", privacyMode: "NO_EXTERNAL_COORDINATE_TRANSMISSION", capabilities: { snap: true, matrix: true, route: true },
      async snap(request) { return { status: "ESTIMATED", requestHash: RoadRouting.requestHash(request), results: request.points.map((point) => ({ pointId: point.pointId, sourceCoordinate: [point.lon, point.lat], snappedCoordinate: [point.lon, point.lat], nodeId: null, edgeId: null, distanceMeters: 0, confidence: "HIGH", alternatives: [], status: "ESTIMATED_NO_SNAP" })), graphHash: null, warnings: ["ESTIMATED_NOT_ROAD_AWARE"] }; },
      async matrix(request) {
        const distances = request.points.map((from) => request.points.map((to) => request.distanceUnit === "km" ? distance(from, to) / 1000 : distance(from, to)));
        const durations = distances.map((row) => row.map((value) => request.durationUnit === "minutes" ? (request.distanceUnit === "km" ? value : value / 1000) / speedKph * 60 : (request.distanceUnit === "km" ? value : value / 1000) / speedKph * 3600));
        const result = { schemaVersion: "stct-estimated-matrix-v1.6", profile: request.profile, sourceIds: request.points.map((point) => point.pointId), targetIds: request.points.map((point) => point.pointId), distances, durations, distanceUnit: request.distanceUnit, durationUnit: request.durationUnit, unreachablePairs: [], requestHash: RoadRouting.requestHash(request), graphHash: null, trafficMode: "NONE", departureTimeApplied: false, estimated: true, approximation: "HAVERSINE_X_FACTOR", factor, averageSpeedKph: speedKph };
        result.matrixHash = IntegrityHash.hashValue(result); return result;
      },
      async route(request) {
        const legs = request.points.slice(0, -1).map((from, index) => { const to = request.points[index + 1]; const meters = distance(from, to); return { fromPointId: from.pointId, toPointId: to.pointId, distance: request.distanceUnit === "km" ? meters / 1000 : meters, duration: request.durationUnit === "minutes" ? meters / 1000 / speedKph * 60 : meters / 1000 / speedKph * 3600, geometry: [[from.lon, from.lat], [to.lon, to.lat]], edgeIds: [], roadClasses: ["ESTIMATED"], toll: false, restrictionNotes: [] }; });
        const result = { schemaVersion: "stct-estimated-route-v1.6", routeId: `EST-${RoadRouting.requestHash(request).slice(-12)}`, requestHash: RoadRouting.requestHash(request), graphHash: null, pointIds: request.points.map((point) => point.pointId), legs, totalDistance: legs.reduce((sum, leg) => sum + leg.distance, 0), totalDuration: legs.reduce((sum, leg) => sum + leg.duration, 0), distanceUnit: request.distanceUnit, durationUnit: request.durationUnit, geometry: legs.flatMap((leg, index) => leg.geometry.slice(index ? 1 : 0)), edgeIds: [], matrixHash: null, snapSummary: { HIGH: request.points.length, MEDIUM: 0, LOW: 0, FAILED: 0 }, restrictionsApplied: [], tollSummary: { tollEdgeCount: 0, tollEdgeIds: [], avoided: false }, warnings: ["ESTIMATED_NOT_ROAD_AWARE"], estimated: true };
        result.routeHash = IntegrityHash.hashValue(result); return result;
      },
      async match() { fail("UNSUPPORTED_CAPABILITY", "Estimated provider does not support match."); },
    });
  }

  function fixtureProvider(options = {}) {
    const graph = options.graph || RoadFixture.createFixture();
    const validation = RoadRouting.validateGraph(graph); if (validation.status !== "PASS") fail("ROAD_GRAPH_INVALID", validation.errors.join(", "));
    return createProvider({
      id: "SYNTHETIC_ROAD_FIXTURE", version: text(options.version || "1.6.0-fixture"), mode: "ROAD_FIXTURE", availability: "READY", privacyMode: "NO_EXTERNAL_COORDINATE_TRANSMISSION", capabilities: { snap: true, matrix: true, route: true, match: true, oneWay: true, turnRestrictions: true, truckDimensions: true, weightRestrictions: true, hazmat: true, tolls: true, closures: true },
      async snap(request) { const report = RoadRouting.snap(graph, request.points, request); return { ...report, requestHash: RoadRouting.requestHash(request), graphHash: graph.graphHash, trafficMode: "SYNTHETIC", departureTimeApplied: false }; },
      async matrix(request) { return RoadRouting.matrix(graph, request, { id: "SYNTHETIC_ROAD_FIXTURE", version: text(options.version || "1.6.0-fixture") }); },
      async route(request) { return RoadRouting.buildRoute(graph, request, { id: "SYNTHETIC_ROAD_FIXTURE", version: text(options.version || "1.6.0-fixture") }); },
      async match(request) { const report = RoadRouting.snap(graph, request.points, request); return { status: report.status, matches: report.results, requestHash: RoadRouting.requestHash(request), graphHash: graph.graphHash, trafficMode: "SYNTHETIC", departureTimeApplied: false }; },
    });
  }

  function externalProvider(id, options = {}) {
    const enabled = options.enabled === true; const approved = options.coordinatesExternalApproved === true; const adapter = typeof options.adapter === "function" ? options.adapter : null;
    const availability = !enabled ? "DISABLED_BY_CONFIGURATION" : !approved ? "DISABLED_BY_CONFIGURATION" : !adapter ? "UNAVAILABLE_DEPENDENCY" : "READY";
    const endpoint = text(options.endpoint);
    const publicDemo = /router\.project-osrm\.org|valhalla1\.openstreetmap\.de|demo/i.test(endpoint);
    if (enabled && publicDemo) fail("PUBLIC_DEMO_ENDPOINT_FORBIDDEN", "Public routing demo endpoints are forbidden.");
    const invoke = async (action, request, context) => {
      if (!approved) fail("COORDINATE_TRANSMISSION_NOT_APPROVED", "Coordinates will be sent to the configured routing provider. Explicit approval is required.");
      if (!endpoint) fail("LOCAL_PROVIDER_ENDPOINT_REQUIRED", "Configured local provider endpoint is required.");
      return adapter({ action, endpoint, request: clone(request), signal: context });
    };
    return createProvider({ id, version: text(options.version || "not-configured"), mode: "LOCAL_EXTERNAL", availability, endpointCategory: endpoint ? "CONFIGURED_LOCAL_ENDPOINT" : "NONE", privacyMode: approved ? "EXPLICIT_COORDINATE_TRANSMISSION_APPROVAL" : "NO_EXTERNAL_COORDINATE_TRANSMISSION", maxPoints: options.maxPoints || 100, capabilities: options.capabilities || {}, snap: (request, context) => invoke("snap", request, context), matrix: (request, context) => invoke("matrix", request, context), route: (request, context) => invoke("route", request, context), match: (request, context) => invoke("match", request, context) });
  }

  function createRegistry(options = {}) {
    const providers = new Map(); const listeners = new Set();
    function register(provider) {
      if (!provider?.id || typeof provider.capabilities !== "function" || typeof provider.health !== "function") fail("PROVIDER_CONTRACT_INVALID", "Provider does not satisfy RoutingProvider.");
      if (providers.has(provider.id)) fail("PROVIDER_ALREADY_REGISTERED", `Provider already registered: ${provider.id}`);
      providers.set(provider.id, provider); return provider;
    }
    register(estimatedProvider(options.estimated));
    register(fixtureProvider(options.fixture));
    register(externalProvider("LOCAL_OSRM_COMPATIBLE", options.osrm));
    register(externalProvider("LOCAL_VALHALLA_COMPATIBLE", options.valhalla));
    function get(id) { const provider = providers.get(text(id).toUpperCase()); if (!provider) fail("PROVIDER_NOT_REGISTERED", `Unknown routing provider: ${id}`); return provider; }
    function list() { return [...providers.values()].map((provider) => ({ id: provider.id, version: provider.version, availability: provider.availability, mode: provider.mode, capabilities: provider.capabilities(), health: provider.health() })); }
    function setAvailability(id, availability) { const health = get(id).setAvailability(availability); listeners.forEach((listener) => listener({ type: "PROVIDER_AVAILABILITY_CHANGED", providerId: id, health })); return health; }
    function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
    function capabilityJSON() { return { schemaVersion: "stct-routing-provider-capabilities-v1.6", version: VERSION, providers: list().map(({ health, ...provider }) => provider) }; }
    function localizedStatus(id, language = "en") { const provider = get(id); const values = COPY[language] || COPY.en; return { providerId: id, availability: provider.availability, label: values[provider.availability], privacy: values.privacy }; }
    function noWebGLInfo() { return { mode: "NO_WEBGL_OPERATIONAL", providers: list().map((provider) => ({ id: provider.id, version: provider.version, availability: provider.availability, mode: provider.mode, capabilities: provider.capabilities })) }; }
    return { register, get, list, setAvailability, subscribe, capabilityJSON, localizedStatus, noWebGLInfo };
  }

  return { VERSION, AVAILABILITY, MODES, CAPABILITY_KEYS, COPY, normalizeCapabilities, createProvider, estimatedProvider, fixtureProvider, externalProvider, createRegistry };
});
