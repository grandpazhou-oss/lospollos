(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const routing = root?.STCTV16?.roadRouting || (typeof require === "function" ? require("./road-routing-v16.js") : null);
  const provenance = root?.STCTV16?.routingProvenance || (typeof require === "function" ? require("./routing-provenance-v16.js") : null);
  const twin = root?.STCTV16?.executionTwin || (typeof require === "function" ? require("./execution-twin-v16.js") : null);
  const stores = root?.STCTV16?.executionStore || (typeof require === "function" ? require("./execution-store-v16.js") : null);
  const alerts = root?.STCTV16?.operationsAlerts || (typeof require === "function" ? require("./operations-alerts-v16.js") : null);
  const analytics = root?.STCTV16?.planVsActual || (typeof require === "function" ? require("./plan-vs-actual-v16.js") : null);
  const legacy = root?.STCTV15?.capsules || (typeof require === "function" ? require("./scenario-capsule-v15.js") : null);
  const api = factory(integrity, routing, provenance, twin, stores, alerts, analytics, legacy);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV16 = root.STCTV16 || { version: "1.6.0" }; root.STCTV16.dynamicOperationsCapsule = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash, RoadRouting, RoutingProvenance, Twin, Stores, Alerts, Analytics, LegacyCapsules) {
  "use strict";

  if (!IntegrityHash?.hashValue || !RoadRouting || !RoutingProvenance || !Twin || !Stores || !Alerts || !Analytics) throw new Error("Dynamic Operations Capsule v1.6 dependencies are missing.");

  const VERSION = "stct-dynamic-operations-capsule-v1.6";
  const SCHEMA_VERSION = "stct-dynamic-operations-capsule-schema-v1.6";
  const MODES = Object.freeze(["READ_ONLY_REPLAY", "SANDBOX_SIMULATION"]);
  const LOCALES = Object.freeze(["zh", "en", "ja"]);
  const DEFAULT_LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, depth: 48, sections: 20, events: 20000, alerts: 5000, revisions: 1000, routes: 5000 });
  const SECTION_NAMES = Object.freeze([
    "routingProvider", "roadGraph", "roadMatrix", "roadRoutes", "executionRun", "executionEvents", "executionState",
    "offlineQueueSummary", "alerts", "planVsActual", "planRevisions", "recoveryHandovers", "driverSimulatorState", "operationalViewState",
  ]);
  const ERROR_CODES = Object.freeze([
    "V16_CAPSULE_NOT_OBJECT", "V16_CAPSULE_JSON_INVALID", "V16_CAPSULE_SCHEMA_UNSUPPORTED", "V16_CAPSULE_REQUIRED_FIELD_MISSING",
    "V16_CAPSULE_UNKNOWN_FIELD", "V16_CAPSULE_SIZE_LIMIT", "V16_CAPSULE_DEPTH_LIMIT", "V16_CAPSULE_RECORD_LIMIT",
    "V16_CAPSULE_PROTOTYPE_POLLUTION", "V16_CAPSULE_FORBIDDEN_VALUE", "V16_CAPSULE_NON_FINITE_NUMBER", "V16_CAPSULE_ABSOLUTE_PATH",
    "V16_CAPSULE_SECRET", "V16_CAPSULE_RAW_EXCEL", "V16_CAPSULE_SECTION_MISSING", "V16_CAPSULE_SECTION_HASH_MISMATCH",
    "V16_CAPSULE_HASH_MISMATCH", "V16_PROVIDER_PROVENANCE_INVALID", "V16_ROAD_GRAPH_INVALID", "V16_ROAD_MATRIX_HASH_MISMATCH",
    "V16_ROAD_ROUTE_HASH_MISMATCH", "V16_EXECUTION_RUN_HASH_MISMATCH", "V16_EXECUTION_EVENT_CHAIN_INVALID",
    "V16_EXECUTION_EVENT_HASH_MISMATCH", "V16_EXECUTION_STATE_HASH_MISMATCH", "V16_EXECUTION_STATE_EVENT_MISMATCH",
    "V16_ALERT_HASH_MISMATCH", "V16_ALERT_EVENT_HASH_MISMATCH", "V16_PLAN_REVISION_HASH_MISMATCH", "V16_PLAN_REVISION_LINEAGE_INVALID",
    "V16_HANDOVER_HASH_MISMATCH", "V16_QUEUE_SUMMARY_INVALID", "V16_METRICS_RECOMPUTE_FAILED", "V16_METRICS_HASH_MISMATCH",
    "V16_IMPORT_MODE_UNSUPPORTED", "V16_SANDBOX_EXPLICIT_CONSENT_REQUIRED", "V16_LEGACY_CAPSULE_INVALID",
  ]);
  const COPY = Object.freeze({
    zh: { title: "动态运营胶囊", modeReadOnly: "只读回放", modeSandbox: "沙盒模拟", seal: "Capsule Seal", boundary: "本地模拟 / 非实时运营" },
    en: { title: "Dynamic Operations Capsule", modeReadOnly: "Read-only replay", modeSandbox: "Sandbox simulation", seal: "Capsule Seal", boundary: "Local Simulation / Not Live Operations" },
    ja: { title: "動的運用カプセル", modeReadOnly: "読み取り専用リプレイ", modeSandbox: "サンドボックスシミュレーション", seal: "Capsule Seal", boundary: "ローカルシミュレーション / ライブ運用ではありません" },
  });
  const TOP_LEVEL_FIELDS = new Set(["schemaVersion", "createdByVersion", "createdAt", "dataClassification", "locale", "capsuleMode", "claimBoundary", "sections", "policies", "seal", "capsuleHash"]);
  const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const SECRET_KEY = /^(?:password|passphrase|secret|clientsecret|api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|cookie|private[-_]?key)$/i;
  const SECRET_VALUE = /(?:bearer\s+[A-Za-z0-9._~+\/-]{8,}|(?:api[-_]?key|secret|password|access[-_]?token)\s*[=:]\s*[^\s,;]{4,})/i;
  const ABSOLUTE_PATH = /(?:^|[\s"'])(?:file:\/\/|\/(?:Users|home|private|tmp|var|etc)\/|[A-Za-z]:[\\/])/i;
  const EXCEL_MARKER = /\.xlsx?\b|application\/(?:vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|vnd\.ms-excel)/i;
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  function fail(code, message, detail = {}) { const error = new Error(message); error.code = code; error.detail = clone(detail); throw error; }
  function byteLength(value) { const source = typeof value === "string" ? value : JSON.stringify(value); return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(source).length : Buffer.byteLength(source, "utf8"); }
  function without(value, key) { const result = clone(value); delete result[key]; return result; }
  function hashWithout(value, key) { return IntegrityHash.hashValue(without(value, key)); }

  function scanSecurity(value, limits = DEFAULT_LIMITS) {
    const issues = []; const active = new Set();
    function visit(current, path, depth) {
      if (depth > limits.depth) { issues.push({ code: "V16_CAPSULE_DEPTH_LIMIT", path }); return; }
      const kind = typeof current;
      if (["function", "symbol", "bigint", "undefined"].includes(kind)) { issues.push({ code: "V16_CAPSULE_FORBIDDEN_VALUE", path, kind }); return; }
      if (kind === "number" && !Number.isFinite(current)) { issues.push({ code: "V16_CAPSULE_NON_FINITE_NUMBER", path }); return; }
      if (kind === "string") {
        if (ABSOLUTE_PATH.test(current)) issues.push({ code: "V16_CAPSULE_ABSOLUTE_PATH", path });
        if (SECRET_VALUE.test(current)) issues.push({ code: "V16_CAPSULE_SECRET", path });
        if (EXCEL_MARKER.test(current)) issues.push({ code: "V16_CAPSULE_RAW_EXCEL", path });
        return;
      }
      if (!current || kind !== "object") return;
      if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) { issues.push({ code: "V16_CAPSULE_PROTOTYPE_POLLUTION", path }); return; }
      if (active.has(current)) { issues.push({ code: "V16_CAPSULE_FORBIDDEN_VALUE", path, kind: "cycle" }); return; }
      active.add(current);
      if (Array.isArray(current)) current.forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
      else Object.keys(current).forEach((key) => {
        if (DANGEROUS_KEYS.has(key)) issues.push({ code: "V16_CAPSULE_PROTOTYPE_POLLUTION", path: `${path}.${key}` });
        if (SECRET_KEY.test(key)) issues.push({ code: "V16_CAPSULE_SECRET", path: `${path}.${key}` });
        visit(current[key], `${path}.${key}`, depth + 1);
      });
      active.delete(current);
    }
    visit(value, "$", 0);
    return issues;
  }

  function assertSecure(value, limits) { const issues = scanSecurity(value, limits); if (issues.length) fail(issues[0].code, `Capsule security scan rejected ${issues[0].path}.`, { issues }); return { status: "PASS", issues: [] }; }
  function section(payload) { const body = clone(payload); return { payload: body, payloadHash: IntegrityHash.hashValue(body) }; }
  function normalizeSource(source = {}) {
    return {
      routingProvider: clone(source.routingProvider || source.providerProvenance || {}),
      roadGraph: clone(source.roadGraph || {}),
      roadMatrix: clone(source.roadMatrix || {}),
      roadRoutes: clone(source.roadRoutes || []),
      executionRun: clone(source.executionRun || {}),
      executionEvents: clone(source.executionEvents || source.executionState?.acceptedEvents || []),
      executionState: clone(source.executionState || {}),
      offlineQueueSummary: clone(source.offlineQueueSummary || {}),
      alerts: clone(source.alerts || { alerts: [], auditEvents: [] }),
      planVsActual: clone(source.planVsActual || {}),
      planRevisions: clone(source.planRevisions || []),
      recoveryHandovers: clone(source.recoveryHandovers || []),
      driverSimulatorState: clone(source.driverSimulatorState || {}),
      operationalViewState: clone(source.operationalViewState || {}),
    };
  }
  function capsuleIdentity(value) { return without(value, "capsuleHash"); }
  function computedCapsuleHash(value) { return IntegrityHash.hashValue(capsuleIdentity(value)); }

  function createCapsule(source = {}, options = {}) {
    const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) }; assertSecure(source, limits);
    const locale = LOCALES.includes(options.locale) ? options.locale : "en"; const normalized = normalizeSource(source);
    const sections = Object.fromEntries(SECTION_NAMES.map((name) => [name, section(normalized[name])]));
    const value = {
      schemaVersion: SCHEMA_VERSION,
      createdByVersion: VERSION,
      createdAt: text(options.createdAt || new Date().toISOString()),
      dataClassification: text(options.dataClassification || "SYNTHETIC_DEMO"),
      locale,
      capsuleMode: "READ_ONLY_REPLAY",
      claimBoundary: COPY[locale].boundary,
      sections,
      policies: { autoRelease: false, autoPlay: false, autoApplyRecovery: false, writeCurrentState: false, externalRequests: false },
      seal: { label: "Capsule Seal", purpose: "SHA-256 integrity and provenance verification", algorithm: "SHA-256", notDigitalSignature: true },
      capsuleHash: "",
    };
    value.capsuleHash = computedCapsuleHash(value);
    const audit = auditCapsule(value, { limits }); if (audit.status !== "PASS") fail(audit.errors[0].code, audit.errors[0].message, audit.errors[0].detail);
    return clone(value);
  }

  function parseSource(source, limits) {
    if (typeof source === "string") {
      if (byteLength(source) > limits.bytes) fail("V16_CAPSULE_SIZE_LIMIT", `Capsule exceeds ${limits.bytes} bytes.`);
      let parsed; try { parsed = JSON.parse(source); } catch (_) { fail("V16_CAPSULE_JSON_INVALID", "Capsule JSON is invalid."); }
      assertSecure(parsed, limits); return parsed;
    }
    if (!source || typeof source !== "object" || Array.isArray(source)) fail("V16_CAPSULE_NOT_OBJECT", "Capsule must be an object.");
    if (byteLength(source) > limits.bytes) fail("V16_CAPSULE_SIZE_LIMIT", `Capsule exceeds ${limits.bytes} bytes.`);
    assertSecure(source, limits); return clone(source);
  }

  function assertStructure(capsule, limits) {
    if (capsule.schemaVersion !== SCHEMA_VERSION) fail("V16_CAPSULE_SCHEMA_UNSUPPORTED", `Unsupported capsule schema: ${text(capsule.schemaVersion) || "(empty)"}.`);
    const unknown = Object.keys(capsule).filter((key) => !TOP_LEVEL_FIELDS.has(key)); if (unknown.length) fail("V16_CAPSULE_UNKNOWN_FIELD", `Unknown capsule field: ${unknown[0]}.`, { unknown });
    if (!text(capsule.createdByVersion) || !text(capsule.dataClassification) || !LOCALES.includes(capsule.locale) || capsule.capsuleMode !== "READ_ONLY_REPLAY") fail("V16_CAPSULE_REQUIRED_FIELD_MISSING", "Capsule identity fields are incomplete.");
    if (!capsule.sections || typeof capsule.sections !== "object" || Array.isArray(capsule.sections)) fail("V16_CAPSULE_REQUIRED_FIELD_MISSING", "Capsule sections are required.");
    if (Object.keys(capsule.sections).length > limits.sections) fail("V16_CAPSULE_RECORD_LIMIT", "Capsule section count exceeds the limit.");
    const unknownSections = Object.keys(capsule.sections).filter((key) => !SECTION_NAMES.includes(key)); if (unknownSections.length) fail("V16_CAPSULE_UNKNOWN_FIELD", `Unknown capsule section: ${unknownSections[0]}.`, { unknownSections });
    SECTION_NAMES.forEach((name) => { const value = capsule.sections[name]; if (!value || !Object.hasOwn(value, "payload") || !text(value.payloadHash)) fail("V16_CAPSULE_SECTION_MISSING", `Capsule section is missing: ${name}.`); if (value.payloadHash !== IntegrityHash.hashValue(value.payload)) fail("V16_CAPSULE_SECTION_HASH_MISMATCH", `Capsule section hash mismatch: ${name}.`, { section: name }); });
    const counts = { events: capsule.sections.executionEvents.payload.length, alerts: capsule.sections.alerts.payload.alerts?.length || 0, revisions: capsule.sections.planRevisions.payload.length, routes: capsule.sections.roadRoutes.payload.length };
    Object.entries(counts).forEach(([key, count]) => { if (!Number.isInteger(count) || count < 0 || count > limits[key]) fail("V16_CAPSULE_RECORD_LIMIT", `${key} count exceeds the limit.`, { key, count, limit: limits[key] }); });
    if (!capsule.policies || Object.values(capsule.policies).some((flag) => flag !== false)) fail("V16_CAPSULE_REQUIRED_FIELD_MISSING", "Capsule import policies must be disabled by default.");
    if (capsule.seal?.label !== "Capsule Seal" || capsule.seal?.algorithm !== "SHA-256" || capsule.seal?.notDigitalSignature !== true) fail("V16_CAPSULE_REQUIRED_FIELD_MISSING", "Capsule Seal must describe integrity verification and must not claim a digital signature.");
  }

  function assertProvider(value) { const result = RoutingProvenance.validate(value); if (result.status !== "PASS") fail("V16_PROVIDER_PROVENANCE_INVALID", "Routing Provider provenance failed validation.", result); }
  function assertGraph(value) { const result = RoadRouting.validateGraph(value); if (result.status !== "PASS" || value.graphHash !== result.graphHash) fail("V16_ROAD_GRAPH_INVALID", "Road Graph failed identity validation.", result); }
  function assertMatrix(value) { if (!value?.matrixHash || value.matrixHash !== IntegrityHash.hashValue(RoadRouting.matrixIdentity(value))) fail("V16_ROAD_MATRIX_HASH_MISMATCH", "Road Matrix identity mismatch."); }
  function assertRoutes(values) { values.forEach((route, index) => { if (!route?.routeHash || route.routeHash !== IntegrityHash.hashValue(RoadRouting.routeIdentity(route))) fail("V16_ROAD_ROUTE_HASH_MISMATCH", `Road Route identity mismatch at ${index}.`, { index }); }); }
  function assertRun(value) { if (!value?.executionRunHash || value.executionRunHash !== IntegrityHash.hashValue(Twin.runIdentity(value))) fail("V16_EXECUTION_RUN_HASH_MISMATCH", "ExecutionRun identity mismatch."); }
  function assertEvents(values, run) {
    let previousTime = -Infinity;
    values.forEach((event, index) => {
      if (event.sequence !== index + 1 || event.executionRunHash !== run.executionRunHash || event.executionRevision !== run.revision || event.logicalTime < previousTime) fail("V16_EXECUTION_EVENT_CHAIN_INVALID", `Execution Event chain is invalid at ${index}.`, { index });
      if (event.eventHash !== IntegrityHash.hashValue(Twin.eventIdentity(event))) fail("V16_EXECUTION_EVENT_HASH_MISMATCH", `Execution Event identity mismatch at ${index}.`, { index });
      previousTime = event.logicalTime;
    });
  }
  function assertExecutionState(state, events) {
    if (!state?.executionStateHash || state.executionStateHash !== IntegrityHash.hashValue(Stores.stateIdentity(state))) fail("V16_EXECUTION_STATE_HASH_MISMATCH", "Execution State identity mismatch.");
    const expected = events.map((event) => event.eventHash); const actual = (state.acceptedEvents || []).map((event) => event.eventHash);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("V16_EXECUTION_STATE_EVENT_MISMATCH", "Execution State accepted events differ from the sealed event chain.");
  }
  function assertAlerts(value) {
    (value.alerts || []).forEach((alert, index) => { if (alert.alertHash !== IntegrityHash.hashValue(Alerts.alertIdentity(alert))) fail("V16_ALERT_HASH_MISMATCH", `Alert identity mismatch at ${index}.`, { index }); });
    (value.auditEvents || []).forEach((event, index) => { if (event.eventHash !== hashWithout(event, "eventHash")) fail("V16_ALERT_EVENT_HASH_MISMATCH", `Alert audit identity mismatch at ${index}.`, { index }); });
  }
  function assertRevisions(values) {
    let previous = null;
    values.forEach((revision, index) => {
      if (revision.revisionHash !== hashWithout(revision, "revisionHash")) fail("V16_PLAN_REVISION_HASH_MISMATCH", `Plan Revision identity mismatch at ${index}.`, { index });
      if (previous && (revision.parentPlanHash !== previous.newPlanHash || Number(revision.revision) <= Number(previous.revision))) fail("V16_PLAN_REVISION_LINEAGE_INVALID", `Plan Revision lineage is invalid at ${index}.`, { index });
      previous = revision;
    });
  }
  function assertHandovers(values) { values.forEach((value, index) => { if (value.handoverHash !== hashWithout(value, "handoverHash")) fail("V16_HANDOVER_HASH_MISMATCH", `Recovery Handover identity mismatch at ${index}.`, { index }); }); }
  function assertQueue(value) {
    const countTotal = value?.counts && typeof value.counts === "object" ? Object.values(value.counts).reduce((sum, count) => sum + (Number.isInteger(count) && count >= 0 ? count : NaN), 0) : NaN;
    if (value?.schemaVersion !== "stct-offline-queue-v1.6" || !Number.isInteger(value.total) || value.total < 0 || countTotal !== value.total || value.containsLocalPath !== false) fail("V16_QUEUE_SUMMARY_INVALID", "Driver Queue Summary is invalid.");
  }
  function assertMetrics(value) {
    let report; try { report = Analytics.compute({ plan: value.plan, executionState: value.executionState, ...(value.options || {}) }); } catch (error) { fail("V16_METRICS_RECOMPUTE_FAILED", "Plan-vs-Actual metrics could not be recomputed.", { cause: error.code || error.message }); }
    if (report.metricReportHash !== value.report?.metricReportHash || IntegrityHash.hashValue(report) !== IntegrityHash.hashValue(value.report)) fail("V16_METRICS_HASH_MISMATCH", "Plan-vs-Actual metrics differ from recomputed evidence.");
  }

  function auditCapsule(source, options = {}) {
    const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
    try {
      const capsule = parseSource(source, limits); assertStructure(capsule, limits);
      const payload = (name) => capsule.sections[name].payload;
      assertProvider(payload("routingProvider")); assertGraph(payload("roadGraph")); assertMatrix(payload("roadMatrix")); assertRoutes(payload("roadRoutes"));
      assertRun(payload("executionRun")); assertEvents(payload("executionEvents"), payload("executionRun")); assertExecutionState(payload("executionState"), payload("executionEvents"));
      assertAlerts(payload("alerts")); assertRevisions(payload("planRevisions")); assertHandovers(payload("recoveryHandovers")); assertQueue(payload("offlineQueueSummary")); assertMetrics(payload("planVsActual"));
      const expectedHash = computedCapsuleHash(capsule); if (expectedHash !== capsule.capsuleHash) fail("V16_CAPSULE_HASH_MISMATCH", "Capsule root hash does not match its content.", { expectedHash, actualHash: capsule.capsuleHash });
      return { status: "PASS", errors: [], capsule, expectedHash, sectionHashes: Object.fromEntries(SECTION_NAMES.map((name) => [name, capsule.sections[name].payloadHash])), errorCodes: clone(ERROR_CODES) };
    } catch (error) {
      return { status: "FAIL", errors: [{ code: text(error.code || "V16_CAPSULE_INVALID"), message: text(error.message), detail: clone(error.detail || {}) }], capsule: null, errorCodes: clone(ERROR_CODES) };
    }
  }

  function importLegacy(source, options = {}) {
    if (options.mode && options.mode !== "READ_ONLY_REPLAY") fail("V16_IMPORT_MODE_UNSUPPORTED", "Legacy v1.5.1 capsules can only be opened as read-only replay.");
    const validation = LegacyCapsules?.validateCapsuleStructure?.(source); if (!validation || validation.status !== "PASS") fail("V16_LEGACY_CAPSULE_INVALID", "Legacy v1.5.1 Capsule failed structural validation.", validation?.error || {});
    return { status: "READ_ONLY_REPLAY", mode: "READ_ONLY_REPLAY", legacy: true, capsule: clone(validation.capsule), autoRelease: false, autoPlay: false, autoApplyRecovery: false, writesCurrentState: false, externalRequests: false };
  }
  function importCapsule(source, options = {}) {
    const parsed = typeof source === "string" ? (() => { try { return JSON.parse(source); } catch (_) { return null; } })() : source;
    if (parsed?.schemaVersion === LegacyCapsules?.SCHEMA_VERSION) return importLegacy(source, options);
    const audit = auditCapsule(source, options); if (audit.status !== "PASS") fail(audit.errors[0].code, audit.errors[0].message, audit.errors[0].detail);
    const mode = text(options.mode || "READ_ONLY_REPLAY").toUpperCase(); if (!MODES.includes(mode)) fail("V16_IMPORT_MODE_UNSUPPORTED", `Unsupported capsule mode: ${mode}.`); if (mode === "SANDBOX_SIMULATION" && options.allowSandboxSimulation !== true) fail("V16_SANDBOX_EXPLICIT_CONSENT_REQUIRED", "Sandbox simulation requires explicit consent.");
    return { status: mode, mode, legacy: false, locale: audit.capsule.locale, copy: clone(COPY[audit.capsule.locale]), capsule: clone(audit.capsule), autoRelease: false, autoPlay: false, autoApplyRecovery: false, writesCurrentState: false, externalRequests: false, externalProviderCalls: 0, selectedPlan: null, audit: { status: "PASS", expectedHash: audit.expectedHash, sectionHashes: clone(audit.sectionHashes), errorCodes: clone(ERROR_CODES) } };
  }
  function extractSection(source, sectionName) { const audit = auditCapsule(source); if (audit.status !== "PASS") fail(audit.errors[0].code, audit.errors[0].message, audit.errors[0].detail); if (!SECTION_NAMES.includes(sectionName)) fail("V16_CAPSULE_SECTION_MISSING", `Unknown Capsule section: ${sectionName}.`); const value = audit.capsule.sections[sectionName]; return { sectionName, payload: clone(value.payload), payloadHash: value.payloadHash, verified: value.payloadHash === IntegrityHash.hashValue(value.payload) }; }
  function randomExtraction(source, seed = 0) { const index = Math.abs(Number(seed) || 0) % SECTION_NAMES.length; return extractSection(source, SECTION_NAMES[index]); }
  function serializeCapsule(source, spacing = 2) { const audit = auditCapsule(source); if (audit.status !== "PASS") fail(audit.errors[0].code, audit.errors[0].message, audit.errors[0].detail); return `${JSON.stringify(audit.capsule, null, spacing)}\n`; }
  function capsuleSeal(source) { const audit = auditCapsule(source); if (audit.status !== "PASS") fail(audit.errors[0].code, audit.errors[0].message, audit.errors[0].detail); return { label: "Capsule Seal", algorithm: "SHA-256", capsuleHash: audit.capsule.capsuleHash, sectionHashes: clone(audit.sectionHashes), digitalSignature: false, note: "Integrity seal only; not a digital signature." }; }

  return { VERSION, SCHEMA_VERSION, MODES, LOCALES, DEFAULT_LIMITS, SECTION_NAMES, ERROR_CODES, COPY, scanSecurity, createCapsule, computedCapsuleHash, auditCapsule, importCapsule, extractSection, randomExtraction, serializeCapsule, capsuleSeal };
});
