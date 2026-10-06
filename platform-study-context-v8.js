(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.studyContext = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA_VERSION = "stct-platform-study-context-v8";
  const STUDY_KINDS = Object.freeze(["SUPPLY_CHAIN_PERIOD", "FACILITY", "NETWORK_ORDERS", "OPERATIONS_PLAN"]);
  const IDENTITY_FIELDS = Object.freeze(["studyKind", "studyId", "projectId", "datasetVersion", "scenarioId", "runId", "inputHash", "resultHash", "classification", "backendIdentity"]);
  const BACKEND_FIELDS = Object.freeze(["endpoint", "instanceId", "startedAt", "buildFingerprint", "protocolVersion", "modelVersion", "runSpecHash", "buildMatch", "capabilities", "buildPolicy", "expectedBuildFingerprint"]);

  function fail(code) { throw Object.assign(new Error(code), { code }); }
  function optionalText(value) {
    if (value == null || value === "") return null;
    if (typeof value !== "string" || value.length > 512) fail("STUDY_CONTEXT_IDENTITY_INVALID");
    return value;
  }
  function normalizeBackend(value) {
    if (value == null) return null;
    if (typeof value !== "object" || Array.isArray(value)) fail("STUDY_CONTEXT_BACKEND_INVALID");
    if (Object.keys(value).some((key) => !BACKEND_FIELDS.includes(key))) fail("STUDY_CONTEXT_BACKEND_FIELD_UNSUPPORTED");
    const result = {};
    for (const field of BACKEND_FIELDS) {
      if (field === "buildMatch") {
        result[field] = value[field] == null ? null : value[field];
        if (result[field] !== null && typeof result[field] !== "boolean") fail("STUDY_CONTEXT_BACKEND_INVALID");
      } else if (field === "capabilities") {
        const items = value[field];
        if (items == null) result[field] = null;
        else {
          if (!Array.isArray(items) || items.length > 32 || items.some((item) => typeof item !== "string" || !item || item.length > 64)) fail("STUDY_CONTEXT_BACKEND_INVALID");
          result[field] = Object.freeze(items.slice());
        }
      } else if (field === "buildPolicy") {
        if (value[field] == null) continue; // Preserve historical context identity shape.
        if (!["STRICT_PINNED", "COMPATIBLE_WARN"].includes(value[field])) fail("STUDY_CONTEXT_BACKEND_INVALID");
        result[field] = value[field];
      } else if (field === "expectedBuildFingerprint") {
        if (!Object.hasOwn(value, field)) continue;
        if (value[field] != null && (typeof value[field] !== "string" || !/^[a-f0-9]{64}$/.test(value[field]))) fail("STUDY_CONTEXT_BACKEND_INVALID");
        result[field] = value[field] ?? null;
      } else result[field] = optionalText(value[field]);
    }
    if (result.endpoint) {
      let url;
      try { url = new URL(result.endpoint); } catch (_error) { fail("STUDY_CONTEXT_BACKEND_INVALID"); }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail("STUDY_CONTEXT_BACKEND_INVALID");
    }
    return Object.freeze(result);
  }
  function normalizeIdentity(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("STUDY_CONTEXT_IDENTITY_INVALID");
    if (Object.keys(value).some((key) => !IDENTITY_FIELDS.includes(key))) fail("STUDY_CONTEXT_FIELD_UNSUPPORTED");
    if (!STUDY_KINDS.includes(value.studyKind) || typeof value.studyId !== "string" || !value.studyId.trim() || value.studyId.length > 512) fail("STUDY_CONTEXT_IDENTITY_INVALID");
    return Object.freeze({
      studyKind: value.studyKind,
      studyId: value.studyId,
      projectId: optionalText(value.projectId),
      datasetVersion: optionalText(value.datasetVersion),
      scenarioId: optionalText(value.scenarioId),
      runId: optionalText(value.runId),
      inputHash: optionalText(value.inputHash),
      resultHash: optionalText(value.resultHash),
      classification: optionalText(value.classification),
      backendIdentity: normalizeBackend(value.backendIdentity),
    });
  }

  function createContext(initial = null) {
    let state = Object.freeze({ schemaVersion: SCHEMA_VERSION, generation: 0, pending: false, current: initial == null ? null : normalizeIdentity(initial) });
    let pendingTicket = null;
    const listeners = new Set();
    function publish(next) {
      state = Object.freeze(next);
      listeners.forEach((listener) => listener(state));
      return state;
    }
    function superseded() { return { ok: false, code: "STUDY_SELECTION_SUPERSEDED", snapshot: state }; }
    return Object.freeze({
      snapshot() { return state; },
      subscribe(listener) {
        if (typeof listener !== "function") fail("STUDY_CONTEXT_LISTENER_INVALID");
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      select(identity) {
        const current = normalizeIdentity(identity);
        pendingTicket = null;
        return publish({ schemaVersion: SCHEMA_VERSION, generation: state.generation + 1, pending: false, current });
      },
      clear() {
        pendingTicket = null;
        return publish({ schemaVersion: SCHEMA_VERSION, generation: state.generation + 1, pending: false, current: null });
      },
      beginSelection() {
        const generation = state.generation + 1;
        pendingTicket = Object.freeze({ generation });
        publish({ schemaVersion: SCHEMA_VERSION, generation, pending: true, current: state.current });
        return pendingTicket;
      },
      completeSelection(ticket, identity) {
        if (!ticket || ticket !== pendingTicket) return superseded();
        const current = normalizeIdentity(identity);
        pendingTicket = null;
        return { ok: true, snapshot: publish({ schemaVersion: SCHEMA_VERSION, generation: state.generation, pending: false, current }) };
      },
      abortSelection(ticket) {
        if (!ticket || ticket !== pendingTicket) return superseded();
        pendingTicket = null;
        return { ok: true, snapshot: publish({ schemaVersion: SCHEMA_VERSION, generation: state.generation + 1, pending: false, current: state.current }) };
      },
    });
  }

  return Object.freeze({ SCHEMA_VERSION, STUDY_KINDS, createContext });
});
