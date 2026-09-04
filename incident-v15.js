(function (root, factory) {
  "use strict";
  const events = root?.STCTV15?.domainEvents || (typeof require === "function" ? require("./domain-events-v15.js") : null);
  const diff = root?.STCTV15?.canonicalDiff || (typeof require === "function" ? require("./canonical-diff-v15.js") : null);
  const canonical = root?.STCTCanonical || root?.window?.STCTCanonical || (typeof require === "function" ? require("./canonical.js") : null);
  if (canonical && typeof require === "function") {
    try { canonical.getContract(); } catch (_) { canonical.configure(require("./shared/planning-contract-v13.json")); }
  }
  const api = factory(events, diff, canonical);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.incidents = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (DomainEvents, CanonicalDiff, Canonical) {
  "use strict";

  if (!DomainEvents || !CanonicalDiff || !Canonical?.scenarioIdentitySync) throw new Error("Incident v1.5.1 requires Domain Events, Canonical Diff, and the Canonical Scenario pipeline.");

  const VERSION = "stct-incident-v1.5";
  const INCIDENT_TYPES = Object.freeze([
    "VEHICLE_BREAKDOWN",
    "STOP_DELAY",
    "EMERGENCY_ORDER",
    "ORDER_CANCELLED",
    "TIME_WINDOW_CHANGED",
    "DEPOT_DELAY",
    "ROAD_CLOSURE_SIMULATION",
  ]);
  const REQUIRED_FIELDS = Object.freeze([
    "incidentId", "type", "baseInputHash", "basePlanHash", "logicalMinute",
    "affectedEntityIds", "parameters", "incidentHash",
  ]);

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function compare(left, right) {
    return text(left).localeCompare(text(right), "en");
  }

  function error(code, message, detail = {}) {
    const result = new Error(message);
    result.code = code;
    result.detail = clone(detail);
    return result;
  }

  function canonicalParameters(value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(canonicalParameters);
    return Object.keys(value).sort(compare).reduce((result, key) => {
      if (!["recordedAt", "generatedAt", "createdAt"].includes(key)) result[key] = canonicalParameters(value[key]);
      return result;
    }, {});
  }

  function incidentCore(specification = {}) {
    return {
      version: VERSION,
      type: text(specification.type).toUpperCase(),
      baseInputHash: text(specification.baseInputHash),
      basePlanHash: text(specification.basePlanHash),
      logicalMinute: number(specification.logicalMinute, NaN),
      affectedEntityIds: [...new Set((specification.affectedEntityIds || []).map(text).filter(Boolean))].sort(compare),
      parameters: canonicalParameters(clone(specification.parameters || {})),
    };
  }

  function hashValue(value) {
    return DomainEvents.hashValue(value);
  }

  function computedIncidentHash(incident) {
    const core = incidentCore(incident);
    return hashValue({ version: VERSION, baseInputHash: core.baseInputHash, basePlanHash: core.basePlanHash, canonicalIncident: { incidentId: text(incident.incidentId), ...core } });
  }

  function validateTypeParameters(incident) {
    const parameters = incident?.parameters || {};
    const ids = incident?.affectedEntityIds || [];
    const failures = [];
    const hasTarget = (...keys) => ids.length || keys.some((key) => text(parameters[key]));
    if (incident.type === "VEHICLE_BREAKDOWN" && !hasTarget("vehicleId")) failures.push("VEHICLE_ID_REQUIRED");
    if (incident.type === "STOP_DELAY") {
      if (!hasTarget("orderId")) failures.push("ORDER_ID_REQUIRED");
      if (number(parameters.delayMinutes) <= 0) failures.push("POSITIVE_DELAY_REQUIRED");
    }
    if (incident.type === "EMERGENCY_ORDER") {
      const order = parameters.order;
      if (!order || typeof order !== "object" || Array.isArray(order)) failures.push("EMERGENCY_ORDER_REQUIRED");
      else if (!text(order.id || order.orderId)) failures.push("EMERGENCY_ORDER_ID_REQUIRED");
    }
    if (incident.type === "ORDER_CANCELLED" && !hasTarget("orderId")) failures.push("ORDER_ID_REQUIRED");
    if (incident.type === "TIME_WINDOW_CHANGED") {
      if (!hasTarget("orderId")) failures.push("ORDER_ID_REQUIRED");
      if (!text(parameters.twStart) && !text(parameters.twEnd)) failures.push("TIME_WINDOW_VALUE_REQUIRED");
    }
    if (incident.type === "DEPOT_DELAY" && number(parameters.delayMinutes) <= 0) failures.push("POSITIVE_DELAY_REQUIRED");
    if (incident.type === "ROAD_CLOSURE_SIMULATION") {
      if (!hasTarget("routeId", "segmentId")) failures.push("SIMULATED_ROUTE_OR_SEGMENT_REQUIRED");
      if (parameters.simulationOnly === false) failures.push("ROAD_CLOSURE_MUST_BE_SIMULATION_ONLY");
    }
    return failures;
  }

  function validateIncident(incident, options = {}) {
    const errors = [];
    if (!incident || typeof incident !== "object" || Array.isArray(incident)) errors.push("INCIDENT_NOT_OBJECT");
    else {
      REQUIRED_FIELDS.forEach((field) => { if (!Object.hasOwn(incident, field)) errors.push(`MISSING_${field.toUpperCase()}`); });
      if (!text(incident.incidentId)) errors.push("INCIDENT_ID_REQUIRED");
      if (!INCIDENT_TYPES.includes(text(incident.type).toUpperCase())) errors.push("INCIDENT_TYPE_UNKNOWN");
      if (!text(incident.baseInputHash)) errors.push("BASE_INPUT_HASH_REQUIRED");
      if (!text(incident.basePlanHash)) errors.push("BASE_PLAN_HASH_REQUIRED");
      if (!Number.isFinite(Number(incident.logicalMinute)) || Number(incident.logicalMinute) < 0) errors.push("LOGICAL_MINUTE_INVALID");
      if (!Array.isArray(incident.affectedEntityIds)) errors.push("AFFECTED_ENTITY_IDS_INVALID");
      if (!incident.parameters || typeof incident.parameters !== "object" || Array.isArray(incident.parameters)) errors.push("INCIDENT_PARAMETERS_INVALID");
      errors.push(...validateTypeParameters(incident));
      if (!text(incident.incidentHash)) errors.push("INCIDENT_HASH_REQUIRED");
      else if (options.verifyHash !== false && computedIncidentHash(incident) !== incident.incidentHash) errors.push("INCIDENT_HASH_MISMATCH");
    }
    return { status: errors.length ? "FAIL" : "PASS", errors };
  }

  function createIncident(specification = {}) {
    const core = incidentCore(specification);
    if (!INCIDENT_TYPES.includes(core.type)) throw error("INCIDENT_TYPE_UNKNOWN", `Unknown incident type: ${core.type || "(empty)"}`);
    if (!core.baseInputHash || !core.basePlanHash) throw error("INCIDENT_BASE_IDENTITY_REQUIRED", "Incident requires baseInputHash and basePlanHash.");
    if (!Number.isFinite(core.logicalMinute) || core.logicalMinute < 0) throw error("INCIDENT_LOGICAL_MINUTE_INVALID", "Incident logicalMinute must be a non-negative finite number.");
    if (core.type === "ROAD_CLOSURE_SIMULATION") core.parameters.simulationOnly = true;
    const idSeed = hashValue(core).split(":").at(-1).slice(0, 12).toUpperCase();
    const incident = { incidentId: text(specification.incidentId || `INC-${idSeed}`), ...core, incidentHash: "" };
    incident.incidentHash = computedIncidentHash(incident);
    const validation = validateIncident(incident);
    if (validation.status !== "PASS") throw error("INCIDENT_SCHEMA_INVALID", validation.errors.join(", "), validation);
    return clone(incident);
  }

  function orderId(order) {
    return text(order?.id || order?.orderId || order?.code);
  }

  function vehicleId(vehicle) {
    return text(vehicle?.id || vehicle?.vehicleId || vehicle?.code);
  }

  function targetId(incident, key) {
    return text(incident.parameters?.[key] || incident.affectedEntityIds?.[0]);
  }

  function timeToMinutes(value, fallback = 0) {
    if (Number.isFinite(Number(value))) return Number(value);
    const match = /^(\d{1,2}):(\d{2})$/.exec(text(value));
    return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
  }

  function timeText(minutes) {
    const value = Math.max(0, Math.round(number(minutes)));
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  }

  function canonicalDerivedIdentity(scenario) {
    return Canonical.scenarioIdentitySync(scenario);
  }

  function ensureOrder(scenario, id, incident) {
    const order = (scenario.orders || []).find((row) => orderId(row) === id);
    if (!order) throw error("INCIDENT_TARGET_NOT_FOUND", `Incident target order is unavailable: ${id}`, { incidentId: incident.incidentId, orderId: id });
    return order;
  }

  function ensureVehicle(scenario, id, incident) {
    const vehicle = (scenario.vehicles || []).find((row) => vehicleId(row) === id);
    if (!vehicle) throw error("INCIDENT_TARGET_NOT_FOUND", `Incident target vehicle is unavailable: ${id}`, { incidentId: incident.incidentId, vehicleId: id });
    return vehicle;
  }

  function applyOne(scenario, incident) {
    if (incident.type === "VEHICLE_BREAKDOWN") {
      const id = targetId(incident, "vehicleId");
      const vehicle = ensureVehicle(scenario, id, incident);
      if (vehicle.enabled === false && vehicle.unavailableIncidentHash) throw error("INCIDENT_COMBINATION_CONFLICT", `Vehicle already unavailable: ${id}`, { vehicleId: id });
      vehicle.enabled = false;
      vehicle.unavailableFromMinute = incident.logicalMinute;
      vehicle.unavailableReason = "VEHICLE_BREAKDOWN";
      vehicle.unavailableIncidentHash = incident.incidentHash;
    } else if (incident.type === "STOP_DELAY") {
      const id = targetId(incident, "orderId");
      const order = ensureOrder(scenario, id, incident);
      order.incidentDelayMinutes = number(order.incidentDelayMinutes) + number(incident.parameters.delayMinutes);
      order.serviceMin = number(order.serviceMin) + number(incident.parameters.delayMinutes);
    } else if (incident.type === "EMERGENCY_ORDER") {
      const order = clone(incident.parameters.order);
      const id = orderId(order);
      if ((scenario.orders || []).some((row) => orderId(row) === id)) throw error("INCIDENT_COMBINATION_CONFLICT", `Emergency order already exists: ${id}`, { orderId: id });
      order.id = id;
      order.date = text(order.date || scenario.planningDate);
      order.weight = number(order.weight);
      order.priority = text(order.priority || "high");
      order.prioritySource = text(order.prioritySource || "explicit");
      order.orderType = text(order.orderType || "EMERGENCY");
      order.requiredVehicleType = text(order.requiredVehicleType);
      order.emergency = true;
      order.incidentHash = incident.incidentHash;
      scenario.orders = [...(scenario.orders || []), order];
    } else if (incident.type === "ORDER_CANCELLED") {
      const id = targetId(incident, "orderId");
      ensureOrder(scenario, id, incident);
      scenario.orders = (scenario.orders || []).filter((row) => orderId(row) !== id);
      scenario.cancelledOrderIds = [...new Set([...(scenario.cancelledOrderIds || []), id])].sort(compare);
    } else if (incident.type === "TIME_WINDOW_CHANGED") {
      const id = targetId(incident, "orderId");
      const order = ensureOrder(scenario, id, incident);
      if (text(incident.parameters.twStart)) order.twStart = text(incident.parameters.twStart);
      if (text(incident.parameters.twEnd)) order.twEnd = text(incident.parameters.twEnd);
      order.timeWindowChangedByIncidentHash = incident.incidentHash;
    } else if (incident.type === "DEPOT_DELAY") {
      const delay = number(incident.parameters.delayMinutes);
      scenario.constraints = clone(scenario.constraints || scenario.constraintsSnapshot || {});
      const canonicalStart = timeToMinutes(scenario.constraints.workStart, 0);
      scenario.constraints.workStart = timeText(canonicalStart + delay);
      scenario.constraintsSnapshot = clone(scenario.constraintsSnapshot || scenario.constraints || {});
      const start = timeToMinutes(scenario.constraintsSnapshot.workStart, 0);
      scenario.constraintsSnapshot.workStart = timeText(start + delay);
      scenario.constraintsSnapshot.depotDelayMinutes = number(scenario.constraintsSnapshot.depotDelayMinutes) + delay;
      scenario.constraintsSnapshot.earliestDepartureMinutes = start + delay;
      scenario.depot = { ...(scenario.depot || {}), availableFromMinute: start + delay, delayIncidentHash: incident.incidentHash };
    } else if (incident.type === "ROAD_CLOSURE_SIMULATION") {
      scenario.assumptions = clone(scenario.assumptions || scenario.assumptionsSnapshot || {});
      const multiplier = Math.max(1, number(incident.parameters.distanceMultiplier, 1));
      scenario.assumptions.roadDistanceFactor = number(scenario.assumptions.roadDistanceFactor, 1) * multiplier;
      scenario.assumptionsSnapshot = clone(scenario.assumptionsSnapshot || scenario.assumptions || {});
      const closure = {
        routeId: targetId(incident, "routeId"),
        segmentId: text(incident.parameters.segmentId || incident.affectedEntityIds?.[1]),
        delayMinutes: Math.max(0, number(incident.parameters.delayMinutes)),
        distanceMultiplier: multiplier,
        logicalMinute: incident.logicalMinute,
        simulationOnly: true,
        realTimeRoadClosure: false,
        incidentHash: incident.incidentHash,
      };
      scenario.assumptionsSnapshot.roadClosureSimulations = [...(scenario.assumptionsSnapshot.roadClosureSimulations || []), closure];
    }
    return scenario;
  }

  function validateCombination(incidents) {
    const ids = new Map();
    const hashes = new Set();
    const cancelled = new Set();
    const broken = new Set();
    incidents.forEach((incident) => {
      const validation = validateIncident(incident);
      if (validation.status !== "PASS") throw error("INCIDENT_SCHEMA_INVALID", validation.errors.join(", "), validation);
      if (ids.has(incident.incidentId) && ids.get(incident.incidentId) !== incident.incidentHash) throw error("INCIDENT_ID_CONFLICT", `Incident id has conflicting content: ${incident.incidentId}`);
      if (hashes.has(incident.incidentHash)) throw error("DUPLICATE_INCIDENT", `Duplicate incident content: ${incident.incidentHash}`);
      ids.set(incident.incidentId, incident.incidentHash);
      hashes.add(incident.incidentHash);
      const orderTarget = targetId(incident, "orderId");
      if (orderTarget && cancelled.has(orderTarget)) throw error("INCIDENT_TARGET_UNAVAILABLE", `Order was cancelled by an earlier incident: ${orderTarget}`, { incidentId: incident.incidentId });
      if (incident.type === "ORDER_CANCELLED") cancelled.add(orderTarget);
      if (incident.type === "VEHICLE_BREAKDOWN") {
        const id = targetId(incident, "vehicleId");
        if (broken.has(id)) throw error("INCIDENT_COMBINATION_CONFLICT", `Vehicle breakdown repeated: ${id}`);
        broken.add(id);
      }
    });
    return { status: "PASS", incidentCount: incidents.length };
  }

  function deriveScenario(baseScenario, incidentSource = []) {
    const incidents = (Array.isArray(incidentSource) ? incidentSource : [incidentSource]).map((incident) => clone(incident));
    validateCombination(incidents);
    const original = clone(baseScenario || {});
    const derived = clone(baseScenario || {});
    incidents.forEach((incident) => applyOne(derived, incident));
    const baseInputHash = text(baseScenario?.inputHash || incidents[0]?.baseInputHash);
    if (!incidents.length) {
      return { derivedScenario: derived, derivedInputHash: baseInputHash, scenarioDiff: CanonicalDiff.scenarioDiff(original, derived, { synthetic: original?.meta?.synthetic === true }), incidents: [] };
    }
    const identity = canonicalDerivedIdentity(derived);
    Object.assign(derived, identity.scenario);
    derived.canonicalScenario = clone(identity.scenario);
    derived.derivedFromInputHash = baseInputHash;
    derived.incidentHashes = incidents.map((incident) => incident.incidentHash);
    derived.contentHash = identity.contentHash;
    derived.inputHash = identity.inputHash;
    derived.derivedInputHash = derived.inputHash;
    derived.scenarioId = incidents.length ? `${text(baseScenario?.scenarioId || "SCENARIO")}-INC-${derived.inputHash.split(":").at(-1).slice(0, 10).toUpperCase()}` : text(baseScenario?.scenarioId);
    const canonicalOriginal = canonicalDerivedIdentity(original).scenario;
    derived.scenarioDiff = CanonicalDiff.scenarioDiff(canonicalOriginal, identity.scenario, { synthetic: original?.meta?.synthetic === true });
    return { derivedScenario: derived, derivedInputHash: derived.inputHash, scenarioDiff: clone(derived.scenarioDiff), incidents: clone(incidents) };
  }

  function createIncidentController(options = {}) {
    const baseScenario = clone(options.baseScenario || {});
    const basePlan = clone(options.basePlan || {});
    if (!text(baseScenario.inputHash) || !text(basePlan.planHash)) throw error("INCIDENT_BASE_REQUIRED", "Incident controller requires base scenario and plan identity.");
    const eventStore = options.eventStore || DomainEvents.createEventStore({ clock: options.eventClock });
    const ownsEventStore = !options.eventStore;
    let incidents = [];
    let derived = deriveScenario(baseScenario, []);
    let destroyed = false;

    function ensureActive() {
      if (destroyed) throw error("INCIDENT_CONTROLLER_DESTROYED", "Incident controller has been destroyed.");
    }

    function snapshot() {
      ensureActive();
      return { version: VERSION, baseScenario: clone(baseScenario), basePlan: clone(basePlan), incidents: clone(incidents), ...clone(derived) };
    }

    function inject(specification) {
      ensureActive();
      const incident = createIncident({ ...specification, baseInputHash: baseScenario.inputHash, basePlanHash: basePlan.planHash });
      const next = [...incidents, incident];
      validateCombination(next);
      const nextDerived = deriveScenario(baseScenario, next);
      incidents = next;
      derived = nextDerived;
      eventStore.append("INCIDENT_INJECTED", {
        aggregateType: "INCIDENT",
        aggregateId: incident.incidentId,
        scenarioId: derived.derivedScenario.scenarioId,
        inputHash: derived.derivedInputHash,
        basePlanHash: basePlan.planHash,
        incidentHash: incident.incidentHash,
        source: text(specification.source || "incident-controller-v15"),
        logicalTime: incident.logicalMinute,
        payload: { incidentId: incident.incidentId, type: incident.type, affectedEntityIds: incident.affectedEntityIds, derivedInputHash: derived.derivedInputHash },
      }, { dedupeKey: `incident-injected:${incident.incidentHash}` });
      return snapshot();
    }

    function clear(incidentId = "") {
      ensureActive();
      const target = text(incidentId);
      const removed = target ? incidents.filter((incident) => incident.incidentId === target) : [...incidents];
      if (target && !removed.length) throw error("INCIDENT_NOT_FOUND", `Unknown incident: ${target}`);
      incidents = target ? incidents.filter((incident) => incident.incidentId !== target) : [];
      derived = deriveScenario(baseScenario, incidents);
      removed.forEach((incident) => eventStore.append("INCIDENT_CLEARED", {
        aggregateType: "INCIDENT",
        aggregateId: incident.incidentId,
        scenarioId: derived.derivedScenario.scenarioId,
        inputHash: derived.derivedInputHash,
        basePlanHash: basePlan.planHash,
        incidentHash: incident.incidentHash,
        source: "incident-controller-v15",
        logicalTime: incident.logicalMinute,
        payload: { incidentId: incident.incidentId, remainingIncidentCount: incidents.length, restoredBaseDerivedState: incidents.length === 0 },
      }, { dedupeKey: `incident-cleared:${incident.incidentHash}:${incidents.length}` }));
      return snapshot();
    }

    function destroy() {
      if (destroyed) return;
      if (ownsEventStore) eventStore.destroy();
      destroyed = true;
    }

    return { get eventStore() { return eventStore; }, snapshot, inject, clear, destroy };
  }

  return {
    VERSION,
    INCIDENT_TYPES,
    REQUIRED_FIELDS,
    createIncident,
    validateIncident,
    computedIncidentHash,
    validateCombination,
    deriveScenario,
    canonicalDerivedIdentity,
    createIncidentController,
    hashValue,
  };
});
