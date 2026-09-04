(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const api = factory(integrity);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.domainEvents = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash) {
  "use strict";

  if (!IntegrityHash) throw new Error("Domain Events v1.5.1 requires Integrity Hash v1.5.1.");

  const VERSION = "stct-domain-events-v1.5";
  const SCHEMA_VERSION = "1.0";
  const EVENT_TYPES = Object.freeze([
    "SCENARIO_OPENED",
    "CANDIDATE_GENERATED",
    "CANDIDATE_VERIFIED",
    "PLAN_SELECTED",
    "PLAN_APPLIED",
    "MANUAL_OPERATION_PROPOSED",
    "MANUAL_OPERATION_COMMITTED",
    "MANUAL_OPERATION_REJECTED",
    "MANUAL_UNDO",
    "SIMULATION_EVENT_ADDED",
    "SIMULATION_EVENT_UNDONE",
    "SIMULATION_RESET",
    "INCIDENT_INJECTED",
    "INCIDENT_CLEARED",
    "BLAST_RADIUS_COMPUTED",
    "RECOVERY_REQUESTED",
    "RECOVERY_CANDIDATE_GENERATED",
    "RECOVERY_CANDIDATE_VERIFIED",
    "RECOVERY_PLAN_APPLIED",
    "RECOVERY_UNDO",
    "CAPSULE_EXPORTED",
    "CAPSULE_IMPORTED",
    "REPLAY_VEHICLE_DEPARTED",
    "REPLAY_STOP_ARRIVED",
    "REPLAY_SERVICE_STARTED",
    "REPLAY_SERVICE_COMPLETED",
    "REPLAY_VEHICLE_RETURNED",
    "OPERATION_FAILED",
  ]);
  const REQUIRED_FIELDS = Object.freeze([
    "schemaVersion", "eventId", "sequence", "type", "aggregateType", "aggregateId",
    "scenarioId", "inputHash", "basePlanHash", "resultingPlanHash", "simulationHash",
    "incidentHash", "correlationId", "causationId", "source", "logicalTime", "recordedAt",
    "payload", "eventHash",
  ]);

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  const compare = IntegrityHash.utf8Compare;

  const stableStringify = IntegrityHash.canonicalString;

  function nonSecurityUiCacheFNV1a64(value) {
    return IntegrityHash.nonSecurityFNV1a64(value).split(":").at(-1);
  }

  function contractError(code, message, detail = {}) {
    const error = new Error(message);
    error.code = code;
    error.detail = clone(detail);
    return error;
  }

  function eventSemanticEnvelope(event) {
    const result = {};
    REQUIRED_FIELDS.filter((field) => !["recordedAt", "eventHash"].includes(field)).forEach((field) => {
      result[field] = clone(event[field]);
    });
    return result;
  }

  function computedEventHash(event) {
    return IntegrityHash.hashValue(eventSemanticEnvelope(event));
  }

  function computedEventId(event) {
    const envelope = eventSemanticEnvelope({ ...event, eventId: "" });
    return `EVT-${String(event.sequence).padStart(6, "0")}-${IntegrityHash.hashValue(envelope).split(":").at(-1).slice(0, 12)}`;
  }

  function validateEvent(event, options = {}) {
    const errors = [];
    if (!event || typeof event !== "object" || Array.isArray(event)) errors.push("EVENT_NOT_OBJECT");
    else {
      REQUIRED_FIELDS.forEach((field) => {
        if (!Object.hasOwn(event, field)) errors.push(`MISSING_${field.toUpperCase()}`);
      });
      if (event.schemaVersion !== SCHEMA_VERSION) errors.push("SCHEMA_VERSION_UNSUPPORTED");
      if (!text(event.eventId)) errors.push("EVENT_ID_REQUIRED");
      if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) errors.push("SEQUENCE_INVALID");
      if (!EVENT_TYPES.includes(text(event.type)) && !options.allowUnknown) errors.push("EVENT_TYPE_UNKNOWN");
      if (!text(event.aggregateType)) errors.push("AGGREGATE_TYPE_REQUIRED");
      if (!text(event.aggregateId)) errors.push("AGGREGATE_ID_REQUIRED");
      if (!text(event.source)) errors.push("SOURCE_REQUIRED");
      if (event.logicalTime === undefined || event.logicalTime === null || event.logicalTime === "") errors.push("LOGICAL_TIME_REQUIRED");
      if (!text(event.recordedAt) || Number.isNaN(Date.parse(event.recordedAt))) errors.push("RECORDED_AT_INVALID");
      if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) errors.push("PAYLOAD_INVALID");
      if (!text(event.eventHash)) errors.push("EVENT_HASH_REQUIRED");
    }
    return { status: errors.length ? "FAIL" : "PASS", errors };
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function safeEventHtml(event) {
    const validation = validateEvent(event, { allowUnknown: true });
    if (validation.status !== "PASS") throw contractError("INVALID_DOMAIN_EVENT", validation.errors.join(", "), validation);
    return `<article data-event-id="${escapeHtml(event.eventId)}"><b>${escapeHtml(event.type)}</b><span>${escapeHtml(event.aggregateType)} · ${escapeHtml(event.aggregateId)}</span><pre>${escapeHtml(JSON.stringify(event.payload, null, 2))}</pre></article>`;
  }

  function entityValue(event, key) {
    const direct = text(event[key]);
    if (direct) return direct;
    const payload = event.payload || {};
    return text(payload[key] ?? payload.target?.[key] ?? payload.entity?.[key]);
  }

  function matchesFilter(event, filter = {}) {
    const types = Array.isArray(filter.types) ? filter.types.map(text) : filter.type ? [text(filter.type)] : [];
    if (types.length && !types.includes(event.type)) return false;
    const mappings = { vehicleId: "vehicleId", routeId: "routeId", orderId: "orderId" };
    return Object.entries(mappings).every(([filterKey, entityKey]) => !text(filter[filterKey]) || entityValue(event, entityKey) === text(filter[filterKey]));
  }

  function createEventStore(options = {}) {
    const clock = typeof options.clock === "function" ? options.clock : () => new Date().toISOString();
    let events = [];
    let nextSequence = 1;
    let destroyed = false;
    const eventIds = new Set();
    const dedupe = new Map();
    const listeners = new Set();

    function ensureActive() {
      if (destroyed) throw contractError("DOMAIN_EVENT_STORE_DESTROYED", "Domain event store has been destroyed.");
    }

    function snapshot() {
      return clone(events);
    }

    function append(type, fields = {}, appendOptions = {}) {
      ensureActive();
      const normalizedType = text(type).toUpperCase();
      if (!EVENT_TYPES.includes(normalizedType)) throw contractError("UNKNOWN_DOMAIN_EVENT_TYPE", `Unknown domain event type: ${normalizedType || "(empty)"}`);
      const dedupeKey = text(appendOptions.dedupeKey || fields.dedupeKey);
      if (dedupeKey && dedupe.has(dedupeKey)) return clone(dedupe.get(dedupeKey));
      const sequence = nextSequence;
      const parent = text(fields.causationId) ? events.find((event) => event.eventId === text(fields.causationId)) : null;
      if (text(fields.causationId) && !parent) throw contractError("CAUSATION_EVENT_NOT_FOUND", `Unknown causationId: ${fields.causationId}`);
      const event = {
        schemaVersion: SCHEMA_VERSION,
        eventId: "",
        sequence,
        type: normalizedType,
        aggregateType: text(fields.aggregateType || "STCT"),
        aggregateId: text(fields.aggregateId || fields.scenarioId || fields.basePlanHash || `AGG-${sequence}`),
        scenarioId: text(fields.scenarioId),
        inputHash: text(fields.inputHash),
        basePlanHash: text(fields.basePlanHash),
        resultingPlanHash: text(fields.resultingPlanHash),
        simulationHash: text(fields.simulationHash),
        incidentHash: text(fields.incidentHash),
        correlationId: text(fields.correlationId || parent?.correlationId || `CORR-${String(sequence).padStart(6, "0")}`),
        causationId: text(fields.causationId),
        source: text(fields.source || "stct-local-demo"),
        logicalTime: clone(fields.logicalTime ?? `SEQ-${String(sequence).padStart(6, "0")}`),
        recordedAt: text(fields.recordedAt || clock()),
        payload: clone(fields.payload || {}),
        eventHash: "",
      };
      event.eventId = computedEventId(event);
      event.eventHash = computedEventHash(event);
      const validation = validateEvent(event);
      if (validation.status !== "PASS") throw contractError("INVALID_DOMAIN_EVENT", validation.errors.join(", "), validation);
      if (eventIds.has(event.eventId)) throw contractError("DUPLICATE_DOMAIN_EVENT_ID", `Duplicate domain eventId: ${event.eventId}`);
      events.push(event);
      eventIds.add(event.eventId);
      nextSequence += 1;
      if (dedupeKey) dedupe.set(dedupeKey, event);
      listeners.forEach((listener) => listener(clone(event)));
      return clone(event);
    }

    function appendFailure(attemptedType, error, fields = {}, appendOptions = {}) {
      return append("OPERATION_FAILED", {
        ...fields,
        payload: {
          ...(fields.payload || {}),
          attemptedType: text(attemptedType),
          status: "FAILED",
          errorCode: text(error?.code || "OPERATION_FAILED"),
          errorMessage: text(error?.message || error),
        },
      }, appendOptions);
    }

    function filter(filterSpec = {}) {
      ensureActive();
      return clone(events.filter((event) => matchesFilter(event, filterSpec)));
    }

    function chain(eventId) {
      ensureActive();
      const result = [];
      const seen = new Set();
      let current = events.find((event) => event.eventId === text(eventId));
      while (current) {
        if (seen.has(current.eventId)) throw contractError("CAUSATION_CYCLE", `Causation cycle at ${current.eventId}`);
        seen.add(current.eventId);
        result.unshift(clone(current));
        current = current.causationId ? events.find((event) => event.eventId === current.causationId) : null;
      }
      return result;
    }

    function exportEvents() {
      ensureActive();
      return `${stableStringify({ schemaVersion: SCHEMA_VERSION, eventCount: events.length, events: [...events].sort((a, b) => a.sequence - b.sequence) })}\n`;
    }

    function importEvents(source, importOptions = {}) {
      ensureActive();
      const parsed = typeof source === "string" ? JSON.parse(source) : clone(source);
      const rows = Array.isArray(parsed) ? parsed : parsed?.events;
      if (!Array.isArray(rows)) throw contractError("EVENT_IMPORT_INVALID", "Event import requires an events array.");
      let priorSequence = 0;
      const importedIds = new Set();
      rows.forEach((event) => {
        const validation = validateEvent(event, { allowUnknown: importOptions.allowUnknown === true });
        if (validation.status !== "PASS") throw contractError("EVENT_IMPORT_SCHEMA_INVALID", validation.errors.join(", "), validation);
        if (event.sequence <= priorSequence) throw contractError("EVENT_SEQUENCE_INVALID", "Imported event sequence must be strictly increasing.");
        if (importedIds.has(event.eventId)) throw contractError("DUPLICATE_DOMAIN_EVENT_ID", `Duplicate imported eventId: ${event.eventId}`);
        if (computedEventId(event) !== event.eventId || computedEventHash(event) !== event.eventHash) throw contractError("EVENT_HASH_MISMATCH", `Imported event identity mismatch: ${event.eventId}`);
        if (event.causationId && !importedIds.has(event.causationId)) throw contractError("CAUSATION_EVENT_NOT_FOUND", `Imported causationId is not earlier in the stream: ${event.causationId}`);
        priorSequence = event.sequence;
        importedIds.add(event.eventId);
      });
      events = clone(rows);
      eventIds.clear();
      events.forEach((event) => eventIds.add(event.eventId));
      nextSequence = (events.at(-1)?.sequence || 0) + 1;
      dedupe.clear();
      return snapshot();
    }

    function eventStreamHash() {
      return IntegrityHash.hashValue(events.map((event) => ({ eventId: event.eventId, eventHash: event.eventHash, sequence: event.sequence })));
    }

    function subscribe(listener) {
      ensureActive();
      if (typeof listener !== "function") throw contractError("INVALID_EVENT_LISTENER", "Domain event listener must be a function.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function destroy() {
      destroyed = true;
      listeners.clear();
    }

    return {
      get state() { return { version: VERSION, eventCount: events.length, nextSequence, eventStreamHash: eventStreamHash() }; },
      append,
      appendFailure,
      filter,
      chain,
      snapshot,
      exportEvents,
      importEvents,
      eventStreamHash,
      subscribe,
      destroy,
    };
  }

  return {
    VERSION,
    SCHEMA_VERSION,
    EVENT_TYPES,
    REQUIRED_FIELDS,
    createEventStore,
    validateEvent,
    eventSemanticEnvelope,
    computedEventHash,
    computedEventId,
    stableStringify,
    hashValue: IntegrityHash.hashValue,
    nonSecurityUiCacheFNV1a64,
    escapeHtml,
    safeEventHtml,
    matchesFilter,
  };
});
