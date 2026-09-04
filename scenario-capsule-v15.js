(function (root, factory) {
  "use strict";
  const events = root?.STCTV15?.domainEvents || (typeof require === "function" ? require("./domain-events-v15.js") : null);
  const incidents = root?.STCTV15?.incidents || (typeof require === "function" ? require("./incident-v15.js") : null);
  const simulation = root?.STCTV15?.simulation || (typeof require === "function" ? require("./simulation-store-v15.js") : null);
  const matrices = root?.STCTV15?.matrixProviders || (typeof require === "function" ? require("./matrix-provider-v15.js") : null);
  const canonical = root?.STCTCanonical || root?.window?.STCTCanonical || (typeof require === "function" ? require("./canonical.js") : null);
  if (canonical && typeof require === "function") {
    try { canonical.getContract(); } catch (_) { canonical.configure(require("./shared/planning-contract-v13.json")); }
  }
  const api = factory(events, incidents, simulation, matrices, canonical);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.capsules = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (DomainEvents, Incidents, Simulation, Matrices, Canonical) {
  "use strict";

  if (!DomainEvents || !Incidents || !Simulation || !Matrices || !Canonical?.scenarioIdentitySync) throw new Error("Scenario Capsule v1.5.1 requires canonical, event, incident, simulation, and matrix integrity contracts.");

  const VERSION = "stct-scenario-capsule-v1.5";
  const SCHEMA_VERSION = "stct-scenario-capsule-schema-v1.5";
  const DEFAULT_LIMITS = Object.freeze({ bytes: 5 * 1024 * 1024, orders: 5000, vehicles: 1000, plans: 200, events: 10000, incidents: 500, candidates: 500, explanations: 5000 });
  const TOP_LEVEL_FIELDS = Object.freeze([
    "schemaVersion", "createdByVersion", "createdAt", "dataClassification", "canonicalScenario", "plans", "selectedPlanHash",
    "verifierResults", "explanations", "domainEvents", "simulationState", "incidents", "recoveryCandidates", "engineProvenance",
    "matrixProvenance", "viewState", "identitySeal", "capsuleHash",
  ]);
  const SAFE_VIEW_FIELDS = Object.freeze(["mode", "selectedPlanHash", "selectedVehicleId", "selectedOrderId", "activeLens", "eventFilter", "mapTheme", "zoneFilter"]);
  const FORBIDDEN_KEYS = /^(?:password|passphrase|secret|clientsecret|apikey|api_key|accesstoken|access_token|refreshtoken|refresh_token|authorization|cookie|set-cookie|privatekey|private_key)$/i;
  const FORBIDDEN_PATH_KEYS = /^(?:path|filepath|file_path|absolutePath|cwd|homeDir|tempDir)$/i;
  const ABSOLUTE_PATH = /(?:^|[\s"'])(?:file:\/\/|\/(?:Users|home|private|tmp|var|etc)\/|[A-Za-z]:[\\/])/i;
  const HTML_SCRIPT = /<\s*script\b|javascript\s*:|on(?:error|load|click)\s*=/i;
  const EXCEL_MARKER = /\.xlsx?\b|application\/(?:vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|vnd\.ms-excel)/i;
  const SECRET_MARKER = /(?:bearer\s+[A-Za-z0-9._~+\/-]{8,}|(?:api[_-]?key|secret|password|token)\s*[=:]\s*[^\s,;]{4,}|demo123)/i;

  function clone(value) { if (value === undefined) return undefined; if (typeof structuredClone === "function") return structuredClone(value); return JSON.parse(JSON.stringify(value)); }
  function text(value) { return String(value ?? "").trim(); }
  function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
  function error(code, message, detail = {}) { const result = new Error(message); result.code = code; result.detail = clone(detail); return result; }
  function hashValue(value) { return DomainEvents.hashValue(value); }
  function byteLength(value) { const source = typeof value === "string" ? value : JSON.stringify(value); return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(source).length : Buffer.byteLength(source, "utf8"); }

  function safeViewState(viewState = {}) {
    return SAFE_VIEW_FIELDS.reduce((result, key) => {
      if (!Object.hasOwn(viewState, key)) return result;
      const value = viewState[key];
      if (["string", "number", "boolean"].includes(typeof value) && Number.isFinite(typeof value === "number" ? value : 0)) result[key] = value;
      return result;
    }, {});
  }

  function scanSecurity(value, path = "$", seen = new Set()) {
    const issues = [];
    const visit = (current, currentPath) => {
      const type = typeof current;
      if (["function", "symbol", "bigint", "undefined"].includes(type)) { issues.push({ code: "CAPSULE_FORBIDDEN_VALUE_TYPE", path: currentPath, type }); return; }
      if (current === null || ["number", "boolean"].includes(type)) {
        if (type === "number" && !Number.isFinite(current)) issues.push({ code: "CAPSULE_NON_FINITE_NUMBER", path: currentPath });
        return;
      }
      if (type === "string") {
        if (HTML_SCRIPT.test(current)) issues.push({ code: "CAPSULE_HTML_SCRIPT_FORBIDDEN", path: currentPath });
        if (/^blob:/i.test(current)) issues.push({ code: "CAPSULE_BLOB_URL_FORBIDDEN", path: currentPath });
        if (ABSOLUTE_PATH.test(current)) issues.push({ code: "CAPSULE_ABSOLUTE_PATH_FORBIDDEN", path: currentPath });
        if (EXCEL_MARKER.test(current)) issues.push({ code: "CAPSULE_RAW_EXCEL_FORBIDDEN", path: currentPath });
        if (SECRET_MARKER.test(current)) issues.push({ code: "CAPSULE_SECRET_FORBIDDEN", path: currentPath });
        return;
      }
      if (seen.has(current)) { issues.push({ code: "CAPSULE_CYCLIC_VALUE", path: currentPath }); return; }
      seen.add(current);
      if (Array.isArray(current)) current.forEach((entry, index) => visit(entry, `${currentPath}[${index}]`));
      else if (current && type === "object") {
        if (typeof Blob !== "undefined" && current instanceof Blob) issues.push({ code: "CAPSULE_BLOB_FORBIDDEN", path: currentPath });
        else Object.keys(current).forEach((key) => {
          if (["__proto__", "prototype", "constructor"].includes(key)) issues.push({ code: "CAPSULE_UNSAFE_KEY", path: `${currentPath}.${key}` });
          if (FORBIDDEN_KEYS.test(key)) issues.push({ code: "CAPSULE_SECRET_KEY_FORBIDDEN", path: `${currentPath}.${key}` });
          if (FORBIDDEN_PATH_KEYS.test(key) && text(current[key])) issues.push({ code: "CAPSULE_FILE_PATH_FIELD_FORBIDDEN", path: `${currentPath}.${key}` });
          visit(current[key], `${currentPath}.${key}`);
        });
      }
      seen.delete(current);
    };
    visit(value, path);
    return issues;
  }

  function assertSecure(value) {
    const issues = scanSecurity(value);
    if (issues.length) throw error(issues[0].code, `Capsule security scan rejected ${issues[0].path}.`, { issues });
    return { status: "PASS", issues: [] };
  }

  function canonicalPlanSeal(plan) {
    return hashValue({ planHash: text(plan?.planHash), inputHash: text(plan?.inputHash), plan: clone(plan) });
  }

  function eventSequenceSeal(events) {
    return hashValue((events || []).map((event) => ({ sequence: number(event.sequence), eventId: text(event.eventId), eventHash: text(event.eventHash), causationId: text(event.causationId) })));
  }

  function createIdentitySeal(capsule) {
    return {
      inputHash: text(capsule.canonicalScenario?.inputHash),
      canonicalScenarioSeal: hashValue(clone(capsule.canonicalScenario)),
      planSeals: (capsule.plans || []).map((plan) => ({ planHash: text(plan.planHash), inputHash: text(plan.inputHash), planSeal: canonicalPlanSeal(plan) })),
      selectedPlanHash: text(capsule.selectedPlanHash),
      eventSequenceSeal: eventSequenceSeal(capsule.domainEvents),
      eventCount: capsule.domainEvents?.length || 0,
      simulationHash: text(capsule.simulationState?.simulationHash),
      incidentHashes: (capsule.incidents || []).map((incident) => text(incident.incidentHash)),
    };
  }

  function capsuleIdentity(capsule) {
    const result = clone(capsule);
    delete result.capsuleHash;
    delete result.createdAt;
    return result;
  }

  function computedCapsuleHash(capsule) { return hashValue(capsuleIdentity(capsule)); }

  function normalizeSource(source = {}, options = {}) {
    const scenario = clone(source.canonicalScenario || source.scenario || {});
    const plans = clone(source.plans || (source.plan ? [source.plan] : []));
    const events = clone(source.domainEvents || source.eventStore?.snapshot?.() || []);
    const capsule = {
      schemaVersion: SCHEMA_VERSION,
      createdByVersion: text(source.createdByVersion || options.createdByVersion || VERSION),
      createdAt: text(source.createdAt || options.clock?.() || new Date().toISOString()),
      dataClassification: text(source.dataClassification || "SYNTHETIC_DEMO"),
      canonicalScenario: scenario,
      plans,
      selectedPlanHash: text(source.selectedPlanHash || plans[0]?.planHash),
      verifierResults: clone(source.verifierResults || plans.map((plan) => ({ planHash: plan.planHash, verification: plan.verification || null }))),
      explanations: clone(source.explanations || []),
      domainEvents: events,
      simulationState: clone(source.simulationState || {}),
      incidents: clone(source.incidents || []),
      recoveryCandidates: clone(source.recoveryCandidates || []),
      engineProvenance: clone(source.engineProvenance || []),
      matrixProvenance: clone(source.matrixProvenance || []),
      viewState: safeViewState(source.viewState || {}),
      identitySeal: null,
      capsuleHash: "",
    };
    capsule.identitySeal = createIdentitySeal(capsule);
    capsule.capsuleHash = computedCapsuleHash(capsule);
    return capsule;
  }

  function createCapsule(source = {}, options = {}) {
    assertSecure(source);
    const capsule = normalizeSource(source, options);
    const result = validateCapsuleStructure(capsule, options);
    if (result.status !== "PASS") throw error(result.error.code, result.error.message, result.error.detail);
    options.eventStore?.append?.("CAPSULE_EXPORTED", {
      aggregateType: "CAPSULE", aggregateId: capsule.capsuleHash, scenarioId: capsule.canonicalScenario.scenarioId,
      inputHash: capsule.canonicalScenario.inputHash, resultingPlanHash: capsule.selectedPlanHash, simulationHash: capsule.simulationState.simulationHash,
      source: "scenario-capsule-v15", payload: { schemaVersion: SCHEMA_VERSION, dataClassification: capsule.dataClassification },
    }, { dedupeKey: `capsule-exported:${capsule.capsuleHash}` });
    return clone(capsule);
  }

  function parseSource(source, limits = DEFAULT_LIMITS) {
    if (typeof source === "string") {
      if (byteLength(source) > limits.bytes) throw error("CAPSULE_SIZE_LIMIT_EXCEEDED", `Capsule exceeds ${limits.bytes} bytes.`);
      try { return JSON.parse(source); } catch (caught) { throw error("CAPSULE_JSON_INVALID", "Capsule JSON is invalid."); }
    }
    if (!source || typeof source !== "object" || Array.isArray(source)) throw error("CAPSULE_NOT_OBJECT", "Capsule must be an object.");
    if (byteLength(source) > limits.bytes) throw error("CAPSULE_SIZE_LIMIT_EXCEEDED", `Capsule exceeds ${limits.bytes} bytes.`);
    return clone(source);
  }

  function mergeLimits(options = {}) { return { ...DEFAULT_LIMITS, ...(options.limits || {}) }; }

  function assertRecordLimits(capsule, limits) {
    const counts = {
      orders: capsule.canonicalScenario?.orders?.length || 0,
      vehicles: capsule.canonicalScenario?.vehicles?.length || 0,
      plans: capsule.plans?.length || 0,
      events: capsule.domainEvents?.length || 0,
      incidents: capsule.incidents?.length || 0,
      candidates: capsule.recoveryCandidates?.length || 0,
      explanations: capsule.explanations?.length || 0,
    };
    Object.entries(counts).forEach(([key, count]) => { if (count > limits[key]) throw error("CAPSULE_RECORD_LIMIT_EXCEEDED", `${key} count ${count} exceeds ${limits[key]}.`, { recordType: key, count, limit: limits[key] }); });
    return counts;
  }

  function assertSchema(capsule, options = {}) {
    if (capsule.schemaVersion !== SCHEMA_VERSION) throw error("CAPSULE_SCHEMA_VERSION_UNSUPPORTED", `Unsupported capsule schema: ${text(capsule.schemaVersion) || "(empty)"}`);
    if ((options.unknownFieldPolicy || "REJECT") === "REJECT") {
      const unknown = Object.keys(capsule).filter((key) => !TOP_LEVEL_FIELDS.includes(key));
      if (unknown.length) throw error("CAPSULE_UNKNOWN_FIELD", `Unknown capsule field: ${unknown[0]}`, { unknownFields: unknown });
    }
    if (!text(capsule.createdByVersion) || !text(capsule.dataClassification)) throw error("CAPSULE_REQUIRED_FIELD_MISSING", "createdByVersion and dataClassification are required.");
    if (!capsule.canonicalScenario || typeof capsule.canonicalScenario !== "object" || !text(capsule.canonicalScenario.inputHash)) throw error("CAPSULE_CANONICAL_SCENARIO_INVALID", "Canonical Scenario with inputHash is required.");
    ["plans", "verifierResults", "explanations", "domainEvents", "incidents", "recoveryCandidates", "engineProvenance", "matrixProvenance"].forEach((field) => { if (!Array.isArray(capsule[field])) throw error("CAPSULE_ARRAY_FIELD_INVALID", `${field} must be an array.`); });
    if (!capsule.identitySeal || typeof capsule.identitySeal !== "object") throw error("CAPSULE_IDENTITY_SEAL_REQUIRED", "identitySeal is required.");
    if (!text(capsule.capsuleHash)) throw error("CAPSULE_HASH_REQUIRED", "capsuleHash is required.");
  }

  function assertIdentitySeal(capsule) {
    const expected = createIdentitySeal(capsule); const actual = capsule.identitySeal;
    if (text(actual.inputHash) !== text(capsule.canonicalScenario.inputHash)) throw error("CAPSULE_INPUT_HASH_TAMPERED", "Canonical Scenario inputHash differs from the sealed inputHash.");
    if (text(actual.canonicalScenarioSeal) !== expected.canonicalScenarioSeal) throw error("CAPSULE_CANONICAL_SCENARIO_TAMPERED", "Canonical Scenario content differs from its seal.");
    if (!Array.isArray(actual.planSeals) || actual.planSeals.length !== expected.planSeals.length) throw error("CAPSULE_PLAN_HASH_TAMPERED", "Plan seal count differs.");
    expected.planSeals.forEach((row, index) => {
      const sealed = actual.planSeals[index];
      if (!sealed || text(sealed.planHash) !== row.planHash || text(sealed.inputHash) !== row.inputHash || text(sealed.planSeal) !== row.planSeal) throw error("CAPSULE_PLAN_HASH_TAMPERED", `Plan ${index} differs from its seal.`, { index });
    });
    if (text(actual.selectedPlanHash) !== text(capsule.selectedPlanHash) || (capsule.selectedPlanHash && !(capsule.plans || []).some((plan) => text(plan.planHash) === text(capsule.selectedPlanHash)))) throw error("CAPSULE_SELECTED_PLAN_TAMPERED", "Selected plan differs from its seal or is absent.");
    if (number(actual.eventCount) !== expected.eventCount || text(actual.eventSequenceSeal) !== expected.eventSequenceSeal) throw error("CAPSULE_EVENT_SEQUENCE_TAMPERED", "Domain Event sequence differs from its seal.");
    if (text(actual.simulationHash) !== text(expected.simulationHash)) throw error("CAPSULE_SIMULATION_HASH_TAMPERED", "Simulation hash differs from its seal.");
    return expected;
  }

  function assertEventChain(events) {
    let prior = 0; const ids = new Set();
    (events || []).forEach((event) => {
      if (!Number.isInteger(event.sequence) || event.sequence <= prior) throw error("CAPSULE_EVENT_SEQUENCE_INVALID", "Domain Event sequence must be strictly increasing.", { sequence: event.sequence, prior });
      if (ids.has(event.eventId)) throw error("CAPSULE_EVENT_ID_DUPLICATE", `Duplicate Domain Event id: ${event.eventId}`);
      if (event.causationId && !ids.has(event.causationId)) throw error("CAPSULE_EVENT_CAUSATION_INVALID", `Causation event must appear earlier: ${event.causationId}`);
      const validation = DomainEvents.validateEvent(event);
      if (validation.status !== "PASS") throw error("CAPSULE_EVENT_SCHEMA_INVALID", validation.errors.join(", "), validation);
      if (DomainEvents.computedEventHash(event) !== text(event.eventHash) || DomainEvents.computedEventId(event) !== text(event.eventId)) throw error("CAPSULE_EVENT_IDENTITY_INVALID", `Domain Event identity mismatch: ${text(event.eventId)}`, { sequence: event.sequence });
      ids.add(event.eventId); prior = event.sequence;
    });
  }

  function assertCanonicalScenario(scenario) {
    const identity = Canonical.scenarioIdentitySync(scenario);
    if (text(scenario.inputHash) !== identity.inputHash) throw error("CAPSULE_CANONICAL_INPUT_HASH_MISMATCH", "Canonical Scenario inputHash does not match recomputed content.", { expectedHash: identity.inputHash, actualHash: scenario.inputHash });
    if (text(scenario.contentHash) !== identity.contentHash) throw error("CAPSULE_CANONICAL_CONTENT_HASH_MISMATCH", "Canonical Scenario contentHash does not match recomputed content.", { expectedHash: identity.contentHash, actualHash: scenario.contentHash });
    return { status: "PASS", inputHash: identity.inputHash, contentHash: identity.contentHash, scenario: identity.scenario };
  }

  function assertIncidents(incidents) {
    const ids = new Set(); const hashes = new Set();
    (incidents || []).forEach((incident, index) => {
      const validation = Incidents.validateIncident(incident);
      if (validation.status !== "PASS") throw error("CAPSULE_INCIDENT_INVALID", `Incident ${index} failed validation.`, { index, validation });
      if (ids.has(incident.incidentId) || hashes.has(incident.incidentHash)) throw error("CAPSULE_INCIDENT_DUPLICATE", `Incident ${index} duplicates an earlier identity.`, { index });
      ids.add(incident.incidentId); hashes.add(incident.incidentHash);
    });
    return { incidentIds: ids, incidentHashes: hashes };
  }

  async function assertSimulationState(state, planHashes) {
    if (!state || typeof state !== "object" || !text(state.activePlanHash) || !Array.isArray(state.activeEvents)) throw error("CAPSULE_SIMULATION_STATE_INVALID", "SimulationState requires activePlanHash and activeEvents.");
    if (!planHashes.has(text(state.activePlanHash))) throw error("CAPSULE_SIMULATION_PLAN_UNKNOWN", "SimulationState references a plan absent from the capsule.", { activePlanHash: state.activePlanHash });
    if (!Number.isInteger(state.simulationRevision) || state.simulationRevision < 0) throw error("CAPSULE_SIMULATION_REVISION_INVALID", "Simulation revision must be a non-negative integer.");
    const expectedHash = await Simulation.simulationIdentity(state.activePlanHash, state.activeEvents);
    if (text(state.simulationHash) !== expectedHash) throw error("CAPSULE_SIMULATION_HASH_MISMATCH", "SimulationState hash does not match active plan and events.", { expectedHash, actualHash: state.simulationHash });
    const operations = state.operationLog || [];
    if (!Array.isArray(operations)) throw error("CAPSULE_SIMULATION_OPERATION_LOG_INVALID", "Simulation operationLog must be an array.");
    let priorSequence = 0; let priorRevision = 0; let priorAfter = "";
    operations.forEach((operation, index) => {
      if (!Number.isInteger(operation.operationSequence) || operation.operationSequence <= priorSequence || !Number.isInteger(operation.committedRevision) || operation.committedRevision <= priorRevision) throw error("CAPSULE_SIMULATION_OPERATION_ORDER_INVALID", `Simulation operation ${index} is out of order.`, { index });
      if (priorAfter && text(operation.beforeSimulationHash) !== priorAfter) throw error("CAPSULE_SIMULATION_OPERATION_CHAIN_INVALID", `Simulation operation ${index} breaks the hash chain.`, { index });
      priorSequence = operation.operationSequence; priorRevision = operation.committedRevision; priorAfter = text(operation.afterSimulationHash);
    });
    if (operations.length && (priorRevision !== state.simulationRevision || priorAfter !== state.simulationHash)) throw error("CAPSULE_SIMULATION_OPERATION_TERMINUS_INVALID", "Simulation operation log does not terminate at the exported state.");
    return { status: "PASS", expectedHash, operationCount: operations.length };
  }

  function recoveryAuthority(candidate) {
    return {
      version: "stct-recovery-v1.5",
      basePlanHash: text(candidate.basePlanHash),
      derivedInputHash: text(candidate.inputHash),
      recoveryRequestHash: text(candidate.recoveryRequestHash),
      objective: text(candidate.objective),
      routes: (candidate.routes || []).map((route) => ({ routeId: text(route.routeId), vehicleId: text(route.vehicleId), orderIds: (route.orderIds || []).map(text), historicalOnly: route.historicalOnly === true })),
      unassignedOrderIds: [...new Set((candidate.unassignedOrderIds || []).map(text).filter(Boolean))].sort(),
      recoveryRevision: number(candidate.recoveryRevision, 1),
    };
  }

  function assertRecoveryLineage(capsule, incidentHashes) {
    const planHashes = new Set((capsule.plans || []).map((plan) => text(plan.planHash)));
    const knownParents = new Set(planHashes);
    (capsule.recoveryCandidates || []).forEach((candidate, index) => {
      const required = ["planHash", "inputHash", "basePlanHash", "parentPlanHash", "incidentHash", "recoveryRequestHash", "objective"];
      const missing = required.filter((field) => !text(candidate[field]));
      if (missing.length) throw error("CAPSULE_RECOVERY_LINEAGE_MISSING", `Recovery candidate ${index} lacks lineage fields.`, { index, missing });
      if (text(candidate.inputHash) !== text(capsule.canonicalScenario.inputHash)) throw error("CAPSULE_RECOVERY_INPUT_MISMATCH", `Recovery candidate ${index} targets another scenario.`, { index });
      if (!planHashes.has(text(candidate.basePlanHash)) || !knownParents.has(text(candidate.parentPlanHash))) throw error("CAPSULE_RECOVERY_PARENT_UNKNOWN", `Recovery candidate ${index} references an unknown parent.`, { index });
      if (!incidentHashes.has(text(candidate.incidentHash))) throw error("CAPSULE_RECOVERY_INCIDENT_UNKNOWN", `Recovery candidate ${index} references an unknown incident.`, { index });
      if (!/^sha256:[0-9a-f]{64}$/.test(text(candidate.recoveryRequestHash))) throw error("CAPSULE_RECOVERY_REQUEST_HASH_INVALID", `Recovery candidate ${index} has an invalid request hash.`, { index });
      const expectedPlanHash = hashValue(recoveryAuthority(candidate));
      if (text(candidate.planHash) !== expectedPlanHash) throw error("CAPSULE_RECOVERY_PLAN_HASH_MISMATCH", `Recovery candidate ${index} plan hash is stale.`, { index, expectedPlanHash, actualHash: candidate.planHash });
      knownParents.add(text(candidate.planHash));
    });
    return { status: "PASS", recoveryCandidateCount: capsule.recoveryCandidates.length, planHashes: knownParents };
  }

  function provenanceId(value, type) { return text(type === "ENGINE" ? value?.id || value?.engineId : value?.providerId || value?.id); }

  function assertProvenance(capsule) {
    const engines = new Map();
    capsule.engineProvenance.forEach((entry, index) => {
      const id = provenanceId(entry, "ENGINE");
      if (!id || !text(entry.version) || !text(entry.status || entry.availability)) throw error("CAPSULE_ENGINE_PROVENANCE_INVALID", `Engine provenance ${index} is incomplete.`, { index });
      engines.set(`${id}|${text(entry.version)}`, entry);
    });
    const matrices = new Map();
    capsule.matrixProvenance.forEach((entry, index) => {
      const id = provenanceId(entry, "MATRIX"); const version = text(entry.providerVersion || entry.version);
      if (!id || !version || !/^sha256:[0-9a-f]{64}$/.test(text(entry.matrixHash))) throw error("CAPSULE_MATRIX_PROVENANCE_INVALID", `Matrix provenance ${index} is incomplete.`, { index });
      if (entry.distances || entry.matrix) {
        const validation = Matrices.validateMatrix(entry.matrix || entry);
        if (validation.status !== "PASS" || validation.matrix.matrixHash !== entry.matrixHash) throw error("CAPSULE_MATRIX_PROVENANCE_HASH_MISMATCH", `Matrix provenance ${index} failed content validation.`, { index, validation });
      }
      matrices.set(`${id}|${version}`, entry);
    });
    (capsule.recoveryCandidates || []).forEach((candidate, index) => {
      const engine = candidate.meta?.engine;
      if (engine && typeof engine === "object" && !engines.has(`${text(engine.id)}|${text(engine.version)}`)) throw error("CAPSULE_RECOVERY_ENGINE_PROVENANCE_MISSING", `Recovery candidate ${index} engine provenance is absent.`, { index });
      const matrix = candidate.meta?.matrixProvider;
      if (matrix && typeof matrix === "object") {
        const match = matrices.get(`${text(matrix.providerId || matrix.id)}|${text(matrix.providerVersion || matrix.version)}`);
        if (!match || text(matrix.matrixHash) && text(matrix.matrixHash) !== text(match.matrixHash)) throw error("CAPSULE_RECOVERY_MATRIX_PROVENANCE_MISSING", `Recovery candidate ${index} matrix provenance is absent or mismatched.`, { index });
      }
    });
    return { status: "PASS", engineCount: engines.size, matrixCount: matrices.size };
  }

  function validateCapsuleStructure(source, options = {}) {
    try {
      const limits = mergeLimits(options); const capsule = parseSource(source, limits);
      assertSchema(capsule, options); assertRecordLimits(capsule, limits); assertSecure(capsule); assertIdentitySeal(capsule); assertEventChain(capsule.domainEvents);
      const expectedHash = computedCapsuleHash(capsule);
      if (expectedHash !== capsule.capsuleHash) throw error("CAPSULE_HASH_MISMATCH", "Capsule hash does not match content.", { expectedHash, actualHash: capsule.capsuleHash });
      return { status: "PASS", capsule, limits, counts: assertRecordLimits(capsule, limits), expectedHash };
    } catch (caught) {
      return { status: "FAIL", capsule: null, error: { code: text(caught.code || "CAPSULE_INVALID"), message: text(caught.message), detail: clone(caught.detail || {}) } };
    }
  }

  async function importCapsule(source, options = {}) {
    const limits = mergeLimits(options); const capsule = parseSource(source, limits);
    assertSchema(capsule, options); assertRecordLimits(capsule, limits); assertSecure(capsule);
    const canonicalValidation = assertCanonicalScenario(capsule.canonicalScenario);
    if (typeof options.validateScenario === "function") {
      const externalValidation = await options.validateScenario(clone(capsule.canonicalScenario));
      if (!externalValidation || externalValidation.status !== "PASS") throw error("CAPSULE_CANONICAL_VALIDATION_FAILED", "Canonical Scenario validation failed.", { canonicalValidation: externalValidation });
    }
    assertEventChain(capsule.domainEvents);
    const incidentValidation = assertIncidents(capsule.incidents);
    const initialPlanHashes = new Set([...(capsule.plans || []), ...(capsule.recoveryCandidates || [])].map((plan) => text(plan.planHash)));
    const simulationValidation = await assertSimulationState(capsule.simulationState, initialPlanHashes);
    const recoveryValidation = assertRecoveryLineage(capsule, incidentValidation.incidentHashes);
    const provenanceValidation = assertProvenance(capsule);
    if (typeof options.verifyPlan !== "function") throw error("CAPSULE_VERIFIER_REQUIRED", "Capsule import requires a plan verifier.");
    const verifierResults = [];
    for (const plan of capsule.plans) {
      const verification = await options.verifyPlan(clone(plan), clone(capsule.canonicalScenario), { source: "capsule-import", externalProvidersEnabled: false });
      if (!verification || verification.status !== "PASS") throw error("CAPSULE_PLAN_VERIFICATION_FAILED", `Verifier rejected plan ${text(plan.planHash)}.`, { planHash: plan.planHash, verification });
      verifierResults.push({ planHash: plan.planHash, verification: clone(verification), rerun: true });
    }
    assertIdentitySeal(capsule);
    const expectedHash = computedCapsuleHash(capsule);
    if (expectedHash !== capsule.capsuleHash) throw error("CAPSULE_HASH_MISMATCH", "Capsule hash does not match content.", { expectedHash, actualHash: capsule.capsuleHash });
    const restoredViewState = safeViewState(capsule.viewState);
    options.eventStore?.append?.("CAPSULE_IMPORTED", {
      aggregateType: "CAPSULE", aggregateId: capsule.capsuleHash, scenarioId: capsule.canonicalScenario.scenarioId,
      inputHash: capsule.canonicalScenario.inputHash, resultingPlanHash: capsule.selectedPlanHash, simulationHash: capsule.simulationState.simulationHash,
      source: "scenario-capsule-v15", payload: { verifierRerunCount: verifierResults.length, autoApplied: false, externalProviderCalls: 0 },
    }, { dedupeKey: `capsule-imported:${capsule.capsuleHash}` });
    return {
      status: "PASS",
      capsule: clone(capsule),
      canonicalValidation: clone(canonicalValidation),
      incidentValidation: { status: "PASS", incidentCount: incidentValidation.incidentHashes.size },
      simulationValidation: clone(simulationValidation),
      recoveryValidation: clone({ status: recoveryValidation.status, recoveryCandidateCount: recoveryValidation.recoveryCandidateCount }),
      provenanceValidation: clone(provenanceValidation),
      verifierResults,
      restoredViewState,
      externalProviderCalls: 0,
      externalProviderInvocationAllowed: false,
      autoApplied: false,
      selectedPlan: null,
    };
  }

  function serializeCapsule(capsule, spacing = 2) {
    const validation = validateCapsuleStructure(capsule);
    if (validation.status !== "PASS") throw error(validation.error.code, validation.error.message, validation.error.detail);
    return `${JSON.stringify(validation.capsule, null, spacing)}\n`;
  }

  function capsuleSeal(capsule) {
    const validation = validateCapsuleStructure(capsule);
    if (validation.status !== "PASS") throw error(validation.error.code, validation.error.message, validation.error.detail);
    const selected = capsule.plans.find((plan) => text(plan.planHash) === text(capsule.selectedPlanHash)) || capsule.plans[0] || null;
    return {
      schema: capsule.schemaVersion,
      inputHash: capsule.canonicalScenario.inputHash,
      planHash: selected?.planHash || "",
      simulationHash: capsule.simulationState?.simulationHash || "",
      incidentHash: capsule.incidents?.at(-1)?.incidentHash || capsule.recoveryCandidates?.at(-1)?.incidentHash || "",
      capsuleHash: capsule.capsuleHash,
      verifier: selected?.verification?.status || capsule.verifierResults?.find((row) => row.planHash === selected?.planHash)?.verification?.status || "UNKNOWN",
      engine: selected?.meta?.engineProvenance || selected?.meta?.engine || capsule.engineProvenance?.[0] || null,
      matrix: selected?.meta?.matrixProvider || capsule.matrixProvenance?.[0] || null,
      dataClassification: capsule.dataClassification,
    };
  }

  return {
    VERSION,
    SCHEMA_VERSION,
    DEFAULT_LIMITS,
    TOP_LEVEL_FIELDS,
    SAFE_VIEW_FIELDS,
    safeViewState,
    scanSecurity,
    assertSecure,
    createIdentitySeal,
    computedCapsuleHash,
    createCapsule,
    validateCapsuleStructure,
    importCapsule,
    serializeCapsule,
    capsuleSeal,
    hashValue,
  };
});
