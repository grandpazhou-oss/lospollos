(function (root, factory) {
  "use strict";
  const events = root?.STCTV15?.domainEvents || (typeof require === "function" ? require("./domain-events-v15.js") : null);
  const api = factory(events);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.engines = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (DomainEvents) {
  "use strict";

  if (!DomainEvents) throw new Error("Engine Registry v1.5 requires Domain Events v1.5.");

  const VERSION = "stct-engine-registry-v1.5";
  const AVAILABILITY = Object.freeze({
    AVAILABLE: "AVAILABLE",
    UNAVAILABLE_DEPENDENCY: "UNAVAILABLE_DEPENDENCY",
    DISABLED_BY_CONFIGURATION: "DISABLED_BY_CONFIGURATION",
  });
  const CAPABILITY_KEYS = Object.freeze([
    "timeWindows", "multiDepot", "multiTrip", "pickupDelivery", "skills", "breaks",
    "openRoute", "customMatrix", "priority", "pinning", "cancellation",
  ]);

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function now() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }

  function error(code, message, detail = {}) {
    const result = new Error(message);
    result.code = code;
    result.detail = clone(detail);
    return result;
  }

  function normalizedCapabilities(source = {}) {
    return Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, source[key] === true]));
  }

  function createEngine(specification = {}) {
    const id = text(specification.id).toUpperCase();
    if (!id) throw error("ENGINE_ID_REQUIRED", "Optimization engine id is required.");
    const availability = text(specification.availability || AVAILABILITY.DISABLED_BY_CONFIGURATION);
    if (!Object.values(AVAILABILITY).includes(availability)) throw error("ENGINE_AVAILABILITY_INVALID", `Invalid engine availability: ${availability}`);
    const capabilities = normalizedCapabilities(specification.capabilities);
    const solveAdapter = specification.solve;
    let cancelled = false;
    let solveCalls = 0;

    function validateScenario(scenario, requiredCapabilities = []) {
      const required = [...new Set([...(scenario?.requiredCapabilities || []), ...(requiredCapabilities || [])].map(text).filter(Boolean))];
      const unknown = required.filter((key) => !CAPABILITY_KEYS.includes(key));
      const unsupported = required.filter((key) => CAPABILITY_KEYS.includes(key) && !capabilities[key]);
      return {
        status: unknown.length || unsupported.length ? "BLOCKED_UNSUPPORTED_CAPABILITY" : "PASS",
        required,
        unsupported,
        unknown,
      };
    }

    async function solve(request, context = {}) {
      cancelled = false;
      if (availability !== AVAILABILITY.AVAILABLE) throw error(availability, `${id} is not available.`, { availability });
      const capability = validateScenario(request?.scenario, request?.requiredCapabilities);
      if (capability.status !== "PASS") throw error("BLOCKED_UNSUPPORTED_CAPABILITY", `${id} does not support: ${[...capability.unsupported, ...capability.unknown].join(", ")}`, capability);
      if (typeof solveAdapter !== "function") throw error("ENGINE_ADAPTER_MISSING", `${id} has no configured solve adapter.`);
      solveCalls += 1;
      const result = await solveAdapter(clone(request), { ...context, engineId: id, isCancelled: () => cancelled });
      if (cancelled) throw error("ENGINE_REQUEST_CANCELLED", `${id} request was cancelled.`);
      return clone(result);
    }

    function cancel(context = {}) {
      cancelled = true;
      if (typeof specification.cancel === "function") specification.cancel(context);
      return { status: "CANCELLED", engineId: id };
    }

    function normalize(result, request) {
      return typeof specification.normalize === "function" ? clone(specification.normalize(clone(result), clone(request))) : clone(result);
    }

    function provenance(status = availability) {
      return {
        id,
        displayName: text(specification.displayName || id),
        version: text(specification.version || "unknown"),
        status: text(status),
        availability,
        capabilities: clone(capabilities),
        source: text(specification.source || "local-demo"),
      };
    }

    return {
      id,
      displayName: text(specification.displayName || id),
      version: text(specification.version || "unknown"),
      availability,
      capabilities: () => clone(capabilities),
      validateScenario,
      solve,
      cancel,
      normalize,
      provenance,
      get solveCalls() { return solveCalls; },
    };
  }

  function createRegistry(options = {}) {
    const engines = new Map();
    const ortoolsAvailable = typeof options.ortoolsAdapter === "function";
    const heuristicAvailable = typeof options.heuristicAdapter === "function";
    const vroomConfigured = typeof options.vroomAdapter === "function" && options.vroomEndpointApproved === true;
    const ortoolsCapabilities = {
      timeWindows: true,
      multiDepot: false,
      multiTrip: false,
      pickupDelivery: false,
      skills: false,
      breaks: false,
      openRoute: false,
      customMatrix: false,
      priority: true,
      pinning: false,
      cancellation: true,
    };
    const heuristicCapabilities = {
      timeWindows: true,
      multiDepot: false,
      multiTrip: false,
      pickupDelivery: false,
      skills: false,
      breaks: false,
      openRoute: false,
      customMatrix: false,
      priority: true,
      pinning: false,
      cancellation: false,
    };
    const vroomCapabilities = vroomConfigured ? normalizedCapabilities(options.vroomCapabilities) : normalizedCapabilities({});
    [
      createEngine({ id: "OR_TOOLS", displayName: "OR-Tools", version: options.ortoolsVersion || "configured-local", availability: ortoolsAvailable ? AVAILABILITY.AVAILABLE : AVAILABILITY.DISABLED_BY_CONFIGURATION, capabilities: ortoolsCapabilities, solve: options.ortoolsAdapter, cancel: options.ortoolsCancel, normalize: options.ortoolsNormalize, source: "local-optimizer-service" }),
      createEngine({ id: "DEMO_HEURISTIC", displayName: "Demo Heuristic", version: options.heuristicVersion || "1.5", availability: heuristicAvailable ? AVAILABILITY.AVAILABLE : AVAILABILITY.DISABLED_BY_CONFIGURATION, capabilities: heuristicCapabilities, solve: options.heuristicAdapter, cancel: options.heuristicCancel, normalize: options.heuristicNormalize, source: "in-browser-local-demo" }),
      createEngine({ id: "VROOM", displayName: "VROOM", version: options.vroomVersion || "not-configured", availability: vroomConfigured ? AVAILABILITY.AVAILABLE : AVAILABILITY.UNAVAILABLE_DEPENDENCY, capabilities: vroomCapabilities, solve: options.vroomAdapter, cancel: options.vroomCancel, normalize: options.vroomNormalize, source: vroomConfigured ? "explicit-approved-adapter" : "not-configured" }),
    ].forEach((engine) => engines.set(engine.id, engine));

    function register(engine) {
      if (!engine?.id || typeof engine.solve !== "function" || typeof engine.capabilities !== "function") throw error("ENGINE_CONTRACT_INVALID", "Engine does not satisfy the OptimizationEngine contract.");
      if (engines.has(engine.id)) throw error("ENGINE_ALREADY_REGISTERED", `Engine already registered: ${engine.id}`);
      engines.set(engine.id, engine);
      return engine;
    }

    function get(id) {
      const engine = engines.get(text(id).toUpperCase());
      if (!engine) throw error("ENGINE_NOT_REGISTERED", `Unknown engine: ${id}`);
      return engine;
    }

    function list() {
      return [...engines.values()].map((engine) => engine.provenance()).sort((a, b) => a.id.localeCompare(b.id));
    }

    function capabilityMatrix() {
      return {
        version: VERSION,
        columns: CAPABILITY_KEYS,
        engines: [...engines.values()].map((engine) => ({ ...engine.provenance(), capabilityMatch: engine.capabilities() })),
      };
    }

    return { register, get, list, capabilityMatrix };
  }

  function createRaceController(options = {}) {
    const registry = options.registry;
    const verifier = options.verifier;
    const eventStore = options.eventStore || DomainEvents.createEventStore({ clock: options.eventClock });
    const ownsEventStore = !options.eventStore;
    if (!registry || typeof registry.get !== "function") throw error("ENGINE_REGISTRY_REQUIRED", "Solver Race requires an engine registry.");
    if (typeof verifier !== "function") throw error("UNIFIED_VERIFIER_REQUIRED", "Solver Race requires the unified verifier.");
    let generation = 0;
    let active = null;
    const completedRequests = new Map();
    const inFlight = new Map();

    function contextFields(request, engine, overrides = {}) {
      return {
        aggregateType: "CANDIDATE",
        aggregateId: text(overrides.aggregateId || request.requestHash),
        scenarioId: text(request.scenario?.scenarioId),
        inputHash: text(request.inputHash || request.scenario?.inputHash),
        basePlanHash: text(request.basePlanHash),
        resultingPlanHash: text(overrides.resultingPlanHash),
        source: text(overrides.source || `solver-race:${engine.id}`),
        logicalTime: overrides.logicalTime,
        correlationId: text(overrides.correlationId || `RACE-${request.requestHash}`),
        causationId: text(overrides.causationId),
        payload: clone(overrides.payload || {}),
      };
    }

    async function solveOne(request, engineId, token) {
      const engine = registry.get(engineId);
      const row = {
        engineId: engine.id,
        engineVersion: engine.version,
        availability: engine.availability,
        capability: engine.validateScenario(request.scenario, request.requiredCapabilities),
        matrixProvider: text(request.matrixProvider || "HAVERSINE_FALLBACK"),
        status: "PENDING",
        solveTimeMs: 0,
        verifierTimeMs: 0,
        candidate: null,
        verification: null,
        provenance: engine.provenance(),
      };
      if (row.capability.status !== "PASS") {
        row.status = "BLOCKED_UNSUPPORTED_CAPABILITY";
        row.blocker = clone(row.capability);
        return row;
      }
      if (engine.availability !== AVAILABILITY.AVAILABLE) {
        row.status = engine.availability;
        return row;
      }
      try {
        const solveStarted = now();
        const raw = await engine.solve(request, { token: token.id });
        row.solveTimeMs = now() - solveStarted;
        if (token.cancelled || token.generation !== generation) return { ...row, status: "STALE_RESPONSE", candidate: null };
        const candidate = engine.normalize(raw, request);
        const generated = eventStore.append("CANDIDATE_GENERATED", contextFields(request, engine, {
          aggregateId: text(candidate?.planHash || `${request.requestHash}:${engine.id}`),
          resultingPlanHash: text(candidate?.planHash),
          payload: { engine: engine.provenance("GENERATED"), solveTimeMs: row.solveTimeMs },
        }), { dedupeKey: `${request.requestHash}:${engine.id}:generated` });
        const verifyStarted = now();
        const verification = await verifier(candidate, request.scenario);
        row.verifierTimeMs = now() - verifyStarted;
        if (token.cancelled || token.generation !== generation) return { ...row, status: "STALE_RESPONSE", candidate: null, verification: null };
        row.verification = clone(verification);
        eventStore.append("CANDIDATE_VERIFIED", contextFields(request, engine, {
          aggregateId: text(candidate?.planHash || `${request.requestHash}:${engine.id}`),
          resultingPlanHash: text(verification.computedPlanHash || candidate?.planHash),
          causationId: generated.eventId,
          payload: { engine: engine.provenance(verification.status), verificationStatus: verification.status, verifierTimeMs: row.verifierTimeMs },
        }), { dedupeKey: `${request.requestHash}:${engine.id}:verified` });
        if (verification.status !== "PASS") {
          row.status = "VERIFIER_FAIL";
          row.candidate = null;
          return row;
        }
        const normalizedPlan = clone(verification.recomputedPlan || candidate);
        normalizedPlan.verification = { ...clone(verification), recomputedPlan: undefined };
        normalizedPlan.meta = { ...(normalizedPlan.meta || {}), engineProvenance: engine.provenance("VERIFIED"), solveTimeMs: row.solveTimeMs, verifierTimeMs: row.verifierTimeMs, matrixProvider: row.matrixProvider };
        row.status = "VERIFIED";
        row.candidate = normalizedPlan;
        row.provenance = engine.provenance("VERIFIED");
        return row;
      } catch (caught) {
        if (token.cancelled || token.generation !== generation || caught.code === "ENGINE_REQUEST_CANCELLED") return { ...row, status: "STALE_RESPONSE", candidate: null };
        row.status = caught.code === "BLOCKED_UNSUPPORTED_CAPABILITY" ? caught.code : "ENGINE_FAILED";
        row.error = { code: text(caught.code || "ENGINE_FAILED"), message: text(caught.message) };
        eventStore.appendFailure("CANDIDATE_GENERATED", caught, contextFields(request, engine, { aggregateId: `${request.requestHash}:${engine.id}`, payload: { engineId: engine.id } }), { dedupeKey: `${request.requestHash}:${engine.id}:failed` });
        return row;
      }
    }

    function run(request = {}, engineIds = []) {
      const requestHash = text(request.requestHash);
      if (!requestHash) return Promise.reject(error("REQUEST_HASH_REQUIRED", "Solver Race requestHash is required."));
      if (completedRequests.has(requestHash)) return Promise.resolve({ status: "DUPLICATE_IGNORED", requestHash, prior: clone(completedRequests.get(requestHash)) });
      if (inFlight.has(requestHash)) return inFlight.get(requestHash);
      generation += 1;
      const token = { id: `RACE-${String(generation).padStart(6, "0")}`, generation, cancelled: false, requestHash };
      active = token;
      const ids = [...new Set(engineIds.map((id) => text(id).toUpperCase()))];
      const promise = Promise.all(ids.map((id) => solveOne(clone(request), id, token))).then((rows) => {
        const result = {
          version: VERSION,
          requestHash,
          status: token.cancelled ? "CANCELLED" : token.generation !== generation ? "STALE_RUN" : "COMPLETED",
          rows,
          candidates: rows.filter((row) => row.status === "VERIFIED" && row.candidate).map((row) => clone(row.candidate)),
        };
        if (!token.cancelled && token.generation === generation) completedRequests.set(requestHash, result);
        inFlight.delete(requestHash);
        if (active === token) active = null;
        return clone(result);
      }, (caught) => {
        inFlight.delete(requestHash);
        if (active === token) active = null;
        throw caught;
      });
      inFlight.set(requestHash, promise);
      return promise;
    }

    function cancel(reason = "user") {
      if (!active) return { status: "NO_ACTIVE_REQUEST" };
      active.cancelled = true;
      generation += 1;
      registry.list().forEach((row) => {
        try { registry.get(row.id).cancel({ requestHash: active.requestHash, reason }); } catch (_error) {}
      });
      const result = { status: "CANCELLED", requestHash: active.requestHash, reason };
      active = null;
      return result;
    }

    function destroy() {
      cancel("destroy");
      if (ownsEventStore) eventStore.destroy();
      inFlight.clear();
    }

    return {
      run,
      cancel,
      destroy,
      get eventStore() { return eventStore; },
      get state() { return { generation, activeRequestHash: active?.requestHash || "", completedRequestHashes: [...completedRequests.keys()] }; },
    };
  }

  return {
    VERSION,
    AVAILABILITY,
    CAPABILITY_KEYS,
    normalizedCapabilities,
    createEngine,
    createRegistry,
    createRaceController,
  };
});
